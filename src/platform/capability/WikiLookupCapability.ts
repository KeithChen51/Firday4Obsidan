import { normalizePath, TFile, type Vault } from "obsidian";
import type { WikiKnowledgeProvider } from "../../core/retrieval/WikiKnowledgeProvider";
import type { LookupIndexEntry, LookupRelationGraph } from "../../core/retrieval/WikiLookupService";
import type { ProjectBoundaryService } from "../../services/ProjectBoundaryService";

export class WikiLookupCapability {
	constructor(
		private readonly vault: Vault,
		private readonly projectBoundaryService: ProjectBoundaryService,
		private readonly wikiKnowledgeProvider: WikiKnowledgeProvider,
	) {}

	async execute(query: string): Promise<string> {
		return this.buildContext(query);
	}

	async buildContext(query: string): Promise<string> {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) {
			return "";
		}

		const projectRoot = this.projectBoundaryService.getActiveProjectRoot();
		if (!projectRoot) {
			return "";
		}

		const wikiRoot = normalizePath(`${projectRoot}/wiki`);
		const indexPath = normalizePath(`${wikiRoot}/index.json`);
		const graphPath = normalizePath(`${wikiRoot}/raw_relation_graph.json`);
		const indexFile = this.vault.getAbstractFileByPath(indexPath);
		if (!(indexFile instanceof TFile)) {
			return "";
		}

		try {
			const rawIndex = await this.vault.cachedRead(indexFile);
			const parsedIndex = JSON.parse(rawIndex) as {
				documents?: Array<{ title?: string; summary?: string; wikiPath?: string; keywords?: string[] }>;
			};
			const indexEntries = (parsedIndex.documents ?? [])
				.filter((item) => typeof item.wikiPath === "string" && item.wikiPath.trim())
				.map((item) => ({
					title: String(item.title ?? "").trim(),
					summary: String(item.summary ?? "").trim(),
					wikiPath: String(item.wikiPath ?? "").trim(),
					keywords: Array.isArray(item.keywords)
						? item.keywords.map((keyword) => String(keyword)).filter((keyword) => keyword.length > 0)
						: [],
				}));
			if (indexEntries.length === 0) {
				return "";
			}

			const relationGraph = await this.loadWikiRelationGraph(graphPath);
			const candidatePaths = new Set<string>();
			const topEntries = this.rankWikiIndexEntries(normalizedQuery, indexEntries, 6);
			for (const entry of topEntries) {
				candidatePaths.add(entry.wikiPath);
			}
			for (const relatedPath of this.collectRelatedWikiPaths(topEntries, relationGraph, 4)) {
				candidatePaths.add(relatedPath);
			}
			for (const filePath of this.collectCandidateProjectSourceFiles(projectRoot, normalizedQuery, 10)) {
				candidatePaths.add(filePath);
			}
			if (candidatePaths.size === 0 && indexEntries[0]?.wikiPath) {
				candidatePaths.add(indexEntries[0].wikiPath);
			}

			const documents = await this.readWikiDocuments([...candidatePaths], 18);
			return this.wikiKnowledgeProvider.buildContext(normalizedQuery, {
				query: normalizedQuery,
				indexEntries,
				documents,
				relationGraph,
			});
		} catch {
			return "";
		}
	}

	private async loadWikiRelationGraph(graphPath: string): Promise<LookupRelationGraph> {
		const relationFile = this.vault.getAbstractFileByPath(graphPath);
		if (!(relationFile instanceof TFile)) {
			return { nodes: [], edges: [] };
		}
		try {
			const rawGraph = await this.vault.cachedRead(relationFile);
			const parsedGraph = JSON.parse(rawGraph) as { nodes?: unknown[]; edges?: unknown[] };
			return {
				nodes: Array.isArray(parsedGraph.nodes) ? parsedGraph.nodes as LookupRelationGraph["nodes"] : [],
				edges: Array.isArray(parsedGraph.edges) ? parsedGraph.edges as LookupRelationGraph["edges"] : [],
			};
		} catch {
			return { nodes: [], edges: [] };
		}
	}

	private rankWikiIndexEntries(query: string, indexEntries: LookupIndexEntry[], limit: number): LookupIndexEntry[] {
		const tokens = this.tokenizeLookupQuery(query);
		if (tokens.length === 0) {
			return indexEntries.slice(0, limit);
		}
		return indexEntries
			.map((entry) => ({ entry, score: this.scoreWikiIndexEntry(tokens, entry) }))
			.filter((item) => item.score > 0)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				return left.entry.wikiPath.localeCompare(right.entry.wikiPath, "zh-CN");
			})
			.slice(0, limit)
			.map((item) => item.entry);
	}

	private scoreWikiIndexEntry(tokens: string[], entry: LookupIndexEntry): number {
		const haystack = `${entry.title} ${entry.summary} ${entry.keywords.join(" ")}`.toLowerCase();
		let score = 0;
		for (const token of tokens) {
			if (token && haystack.includes(token)) {
				score += token.length >= 4 ? 3 : 1;
			}
		}
		return score;
	}

	private collectRelatedWikiPaths(entries: LookupIndexEntry[], relationGraph: LookupRelationGraph, limit: number): string[] {
		const paths: string[] = [];
		for (const entry of entries) {
			const sourceNode = relationGraph.nodes.find((item) => item.path === entry.wikiPath);
			if (!sourceNode) {
				continue;
			}
			for (const edge of relationGraph.edges) {
				if (edge.from !== sourceNode.id) {
					continue;
				}
				const targetNode = relationGraph.nodes.find((item) => item.id === edge.to);
				if (!targetNode || paths.includes(targetNode.path)) {
					continue;
				}
				paths.push(targetNode.path);
				if (paths.length >= limit) {
					return paths;
				}
			}
		}
		return paths;
	}

	private collectCandidateProjectSourceFiles(projectRoot: string, query: string, limit: number): string[] {
		const tokens = this.tokenizeLookupQuery(query);
		if (tokens.length === 0) {
			return [];
		}
		const scored = this.vault.getFiles()
			.filter((file) => file.path.startsWith(`${projectRoot}/raw/`) || file.path.startsWith(`${projectRoot}/workspace/`))
			.map((file) => {
				const searchable = `${file.path} ${file.basename}`.toLowerCase();
				let score = 0;
				for (const token of tokens) {
					if (searchable.includes(token)) {
						score += token.length >= 4 ? 2 : 1;
					}
				}
				return { path: file.path, score };
			})
			.filter((item) => item.score > 0)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				return left.path.localeCompare(right.path, "zh-CN");
			});
		return scored.slice(0, limit).map((item) => item.path);
	}

	private async readWikiDocuments(paths: string[], limit: number): Promise<Record<string, string>> {
		const documents: Record<string, string> = {};
		for (const pathValue of [...new Set(paths)].slice(0, limit)) {
			const file = this.vault.getAbstractFileByPath(pathValue);
			if (!(file instanceof TFile)) {
				continue;
			}
			try {
				documents[pathValue] = await this.vault.cachedRead(file);
			} catch {
				// Best-effort context loading.
			}
		}
		return documents;
	}

	private tokenizeLookupQuery(input: string): string[] {
		return input.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
	}
}
