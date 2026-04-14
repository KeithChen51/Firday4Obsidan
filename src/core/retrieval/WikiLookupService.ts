export interface LookupIndexEntry {
	title: string;
	summary: string;
	wikiPath: string;
	keywords: string[];
}

export interface LookupRelationNode {
	id: string;
	path: string;
}

export interface LookupRelationEdge {
	from: string;
	to: string;
	label: string;
}

export interface LookupRelationGraph {
	nodes: LookupRelationNode[];
	edges: LookupRelationEdge[];
}

export interface WikiLookupInput {
	query: string;
	indexEntries: LookupIndexEntry[];
	documents: Record<string, string>;
	relationGraph: LookupRelationGraph;
}

export interface WikiLookupResult {
	summary: string;
	sourceMap: {
		hitStep: "keyword_match" | "direct_read" | "relation_walk" | "fallback";
		sourcePath: string;
		sourceSection: "compiled_truth" | "timeline" | "raw";
		relationPath?: string;
	};
}

export class WikiLookupService {
	lookup(input: WikiLookupInput): WikiLookupResult {
		const queryTokens = this.tokenize(input.query);
		const directEntry = this.findBestEntry(queryTokens, input.indexEntries);
		if (directEntry) {
			const content = input.documents[directEntry.wikiPath] ?? "";
			if (content) {
				const compiledTruth = this.extractCompiledTruth(content);
				if (compiledTruth) {
					return {
						summary: compiledTruth,
						sourceMap: {
							hitStep: "direct_read",
							sourcePath: directEntry.wikiPath,
							sourceSection: "compiled_truth",
						},
					};
				}
			}
		}

		if (directEntry) {
			const relation = this.findRelatedDocument(directEntry.wikiPath, input.relationGraph, input.documents);
			if (relation) {
				return {
					summary: relation.summary,
					sourceMap: {
						hitStep: "relation_walk",
						sourcePath: relation.path,
						sourceSection: relation.section,
						relationPath: relation.relationPath,
					},
				};
			}
		}

		const fallback = this.fallbackSearch(queryTokens, input.documents);
		if (fallback) {
			return {
				summary: fallback.summary,
				sourceMap: {
					hitStep: "fallback",
					sourcePath: fallback.path,
					sourceSection: fallback.section,
				},
			};
		}

		return {
			summary: "No related knowledge found.",
			sourceMap: {
				hitStep: "fallback",
				sourcePath: "",
				sourceSection: "raw",
			},
		};
	}

	private findBestEntry(tokens: string[], entries: LookupIndexEntry[]): LookupIndexEntry | null {
		let best: LookupIndexEntry | null = null;
		let bestScore = 0;
		for (const entry of entries) {
			const haystack = `${entry.title} ${entry.summary} ${entry.keywords.join(" ")}`.toLowerCase();
			let score = 0;
			for (const token of tokens) {
				if (haystack.includes(token)) {
					score += 1;
				}
			}
			if (score > bestScore) {
				bestScore = score;
				best = entry;
			}
		}
		return bestScore > 0 ? best : null;
	}

	private extractCompiledTruth(content: string): string {
		const normalized = content.replace(/\r/g, "");
		const sectionMatch = normalized.match(/## Compiled Truth\s+([\s\S]*?)(?:\n---\n|\n## Timeline|\n#|$)/i);
		if (sectionMatch?.[1]) {
			return sectionMatch[1].trim();
		}
		return normalized.trim();
	}

	private findRelatedDocument(
		path: string,
		graph: LookupRelationGraph,
		documents: Record<string, string>,
	): { path: string; summary: string; section: "compiled_truth" | "timeline" | "raw"; relationPath: string } | null {
		const node = graph.nodes.find((item) => item.path === path);
		if (!node) {
			return null;
		}
		const edge = graph.edges.find((item) => item.from === node.id);
		if (!edge) {
			return null;
		}
		const targetNode = graph.nodes.find((item) => item.id === edge.to);
		if (!targetNode) {
			return null;
		}
		const content = documents[targetNode.path];
		if (!content) {
			return null;
		}
		return {
			path: targetNode.path,
			summary: this.extractCompiledTruth(content),
			section: targetNode.path.includes("/wiki/") ? "compiled_truth" : "raw",
			relationPath: `${node.path} -> ${edge.label} -> ${targetNode.path}`,
		};
	}

	private fallbackSearch(
		tokens: string[],
		documents: Record<string, string>,
	): { path: string; summary: string; section: "compiled_truth" | "timeline" | "raw" } | null {
		for (const [path, content] of Object.entries(documents)) {
			const normalized = content.toLowerCase();
			if (tokens.some((token) => normalized.includes(token))) {
				return {
					path,
					summary: this.truncate(content.replace(/\s+/g, " ").trim(), 220),
					section: path.includes("/wiki/") ? "compiled_truth" : "raw",
				};
			}
		}
		return null;
	}

	private tokenize(input: string): string[] {
		return (input.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []);
	}

	private truncate(value: string, maxLength: number): string {
		if (value.length <= maxLength) {
			return value;
		}
		return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
	}
}
