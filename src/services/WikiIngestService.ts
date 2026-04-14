import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { buildCapabilityIndex } from "../core/retrieval/CapabilityIndexBuilder";
import { buildRelationGraph } from "../core/retrieval/RelationGraphBuilder";
import {
	IngestEvent,
	ProjectEntry,
	RawSidecarMeta,
	WikiDocIndexEntry,
	WikiIndexFile,
} from "../types/project";
import {
	evaluateTagPolicy,
	getDefaultTagPolicyAssets,
	parseTagPolicy,
	resolveContextZone,
	type GovernanceEvaluationResult,
	type TagPolicyFile,
} from "../features/wiki/TagPolicyRuntime";
import { IngestEventStore } from "./IngestEventStore";
import { ProjectContentService, RawSourceContext } from "./ProjectContentService";

export interface IngestSummary {
	processed: number;
	succeeded: number;
	failed: number;
	events: IngestEvent[];
	updatedDocs: string[];
	updatedIndex: string;
	updatedLog: string;
}

export function shouldSkipPreparedRawIngest(
	prepared: { changed: boolean; meta: { lastIngestStatus: string } },
	forceRebuild = false,
): boolean {
	return !forceRebuild && !prepared.changed && prepared.meta.lastIngestStatus === "success";
}

interface KnowledgeExtraction {
	title: string;
	summary: string;
	highlights: string[];
	keywords: string[];
	evidence: Array<{ line: number; text: string }>;
	wikilinks: string[];
}

interface CompiledWikiDoc {
	wikiPath: string;
	entry: WikiDocIndexEntry;
}

interface GovernanceContext {
	policy: TagPolicyFile;
	policyRootPath: string;
}

const EN_STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"into",
	"are",
	"was",
	"were",
	"will",
	"can",
	"you",
	"your",
	"our",
	"not",
	"use",
	"using",
	"have",
	"has",
	"had",
]);

export class WikiIngestService {
	constructor(
		private readonly vault: Vault,
		private readonly contentService: ProjectContentService,
		private readonly eventStore: IngestEventStore,
	) {}

	async ingestRawFiles(
		project: ProjectEntry,
		rawPaths: string[],
		source: RawSourceContext,
		options: { forceRebuild?: boolean } = {},
	): Promise<IngestSummary> {
		const projectRoot = normalizePath(project.projectRootPath);
		const governance = await this.loadGovernanceContext(projectRoot);
		const normalizedRawPaths = [...new Set(rawPaths.map((item) => normalizePath(item)))];
		const events: IngestEvent[] = [];
		const changedEntries = new Map<string, WikiDocIndexEntry>();
		const updatedDocs: string[] = [];
		let updatedLog = "";
		let succeeded = 0;
		let failed = 0;

		for (const rawPath of normalizedRawPaths) {
			if (!this.contentService.isRawPath(projectRoot, rawPath)) {
				continue;
			}

			const ingestId = this.createIngestId(project.slug);
			const startedAt = new Date().toISOString();
			let prepared:
				| Awaited<ReturnType<ProjectContentService["prepareRawForIngest"]>>
				| null = null;

			try {
				prepared = await this.contentService.prepareRawForIngest(project, projectRoot, rawPath, source);
				if (shouldSkipPreparedRawIngest(prepared, options.forceRebuild ?? false)) {
					continue;
				}

				const compiled = await this.compileOneRawToWiki(projectRoot, rawPath, prepared.meta, governance);
				changedEntries.set(prepared.meta.docId, compiled.entry);
				updatedDocs.push(compiled.wikiPath);

				const finishedAt = new Date().toISOString();
				const event: IngestEvent = {
					ingestId,
					docId: prepared.meta.docId,
					projectId: project.slug,
					sourceVersion: prepared.meta.sourceVersion,
					fromHash: prepared.previousHash,
					toHash: prepared.meta.contentHash,
					status: "success",
					error: "",
					startedAt,
					finishedAt,
				};
				updatedLog = await this.persistTrackingArtifacts(
					projectRoot,
					rawPath,
					ingestId,
					"success",
					finishedAt,
					event,
					updatedLog,
				);
				events.push(event);
				succeeded += 1;
			} catch (error) {
				const finishedAt = new Date().toISOString();
				const message = this.errorMessage(error);
				const event: IngestEvent = {
					ingestId,
					docId: prepared?.meta.docId ?? this.fallbackDocId(project.slug, rawPath),
					projectId: project.slug,
					sourceVersion: prepared?.meta.sourceVersion ?? 0,
					fromHash: prepared?.previousHash ?? "",
					toHash: prepared?.meta.contentHash ?? "",
					status: "failed",
					error: message,
					startedAt,
					finishedAt,
				};
				updatedLog = await this.persistTrackingArtifacts(
					projectRoot,
					rawPath,
					ingestId,
					"failed",
					finishedAt,
					event,
					updatedLog,
				);
				events.push(event);
				failed += 1;
			}
		}

		let updatedIndex = "";
		if (changedEntries.size > 0) {
			updatedIndex = await this.rebuildWikiIndexes(project, projectRoot, changedEntries);
		}

		return {
			processed: succeeded + failed,
			succeeded,
			failed,
			events,
			updatedDocs,
			updatedIndex,
			updatedLog,
		};
	}

	private async compileOneRawToWiki(
		projectRoot: string,
		rawPath: string,
		meta: RawSidecarMeta,
		governance: GovernanceContext,
	): Promise<CompiledWikiDoc> {
		const rawFile = this.vault.getAbstractFileByPath(rawPath);
		if (!(rawFile instanceof TFile)) {
			throw new Error(`Raw file not found: ${rawPath}`);
		}

		const rawText = await this.vault.cachedRead(rawFile);
		const extraction = this.extractKnowledge(rawPath, rawText);
		const governanceDecision = this.evaluateGovernanceForRaw(projectRoot, rawPath, rawText, extraction.keywords, governance);
		const wikiPath = this.getWikiDocPath(projectRoot, meta.docId);
		const now = new Date().toISOString();

		const entry: WikiDocIndexEntry = {
			docId: meta.docId,
			title: extraction.title,
			wikiPath,
			sourcePath: rawPath,
			sourceVersion: meta.sourceVersion,
			contentHash: meta.contentHash,
			summary: extraction.summary,
			keywords: extraction.keywords,
			tags: governanceDecision.tags,
			contextZone: governanceDecision.contextZone,
			targetZone: governanceDecision.targetZone,
			governanceRuleIds: governanceDecision.matchedRuleIds,
			moveTo: governanceDecision.moveTo,
			renameTo: governanceDecision.renameTo,
			suggestionOnly: governanceDecision.suggestionOnly,
			evidenceCount: extraction.evidence.length,
			updatedAt: now,
		};

		await this.writeTextFile(
			wikiPath,
			this.buildKnowledgeDocMarkdown(entry, extraction, governanceDecision.policyRootPath),
		);
		return { wikiPath, entry };
	}

	private buildKnowledgeDocMarkdown(
		entry: WikiDocIndexEntry,
		extraction: KnowledgeExtraction,
		policyRootPath: string,
	): string {
		const keywordLines = extraction.keywords
			.slice(0, 16)
			.map((item) => `  - "${this.escapeYamlText(item)}"`)
			.join("\n");
		const keywordTags = extraction.keywords.slice(0, 6).map((item) => `#${item}`).join(" ") || "#knowledge";
		const governanceTags = entry.tags?.map((item) => `#${item.replace(/\s+/g, "-")}`).join(" ") || "(none)";
		const governanceRules = entry.governanceRuleIds?.join(", ") || "(none)";
		const governanceTarget = entry.targetZone || "(none)";
		const archiveSuggestion = entry.moveTo || entry.renameTo
			? `${entry.moveTo || "(no move)"} | ${entry.renameTo || "(no rename)"}`
			: "(none)";
		const highlights = extraction.highlights.length > 0
			? extraction.highlights.slice(0, 8).map((item) => `- ${item}`).join("\n")
			: "- No extracted highlights.";
		const openThreads = extraction.highlights.length > 0
			? extraction.highlights.slice(0, 3).map((item) => `- Validate: ${item}`).join("\n")
			: "- None.";
		const seeAlso = extraction.wikilinks.length > 0
			? extraction.wikilinks.slice(0, 6).map((item) => `- [[${item}]]`).join("\n")
			: "- None.";
		const timeline = extraction.evidence.length > 0
			? extraction.evidence
				.slice(0, 8)
				.map((item) => `- [${entry.updatedAt.slice(0, 10)}] ${entry.sourcePath}#L${item.line}: ${item.text}`)
				.join("\n")
			: "- No extracted evidence.";

		return [
			"---",
			`slug: "${this.escapeYamlText(path.posix.basename(entry.wikiPath, ".md"))}"`,
			`docId: "${this.escapeYamlText(entry.docId)}"`,
			`title: "${this.escapeYamlText(entry.title)}"`,
			`sourcePath: "${this.escapeYamlText(entry.sourcePath)}"`,
			`sourceVersion: ${entry.sourceVersion}`,
			`contentHash: "${entry.contentHash}"`,
			`created: "${entry.updatedAt}"`,
			`updated: "${entry.updatedAt}"`,
			`contextZone: "${entry.contextZone || ""}"`,
			`targetZone: "${entry.targetZone || ""}"`,
			"suggestionOnly: " + String(Boolean(entry.suggestionOnly)),
			"governanceTags:",
			...(entry.tags && entry.tags.length > 0 ? entry.tags.map((item) => `  - "${this.escapeYamlText(item)}"`) : ['  - ""']),
			"governanceRuleIds:",
			...(entry.governanceRuleIds && entry.governanceRuleIds.length > 0 ? entry.governanceRuleIds.map((item) => `  - "${this.escapeYamlText(item)}"`) : ['  - ""']),
			"keywords:",
			keywordLines || "  - \"\"",
			"---",
			"",
			`# ${entry.title}`,
			"",
			"## Compiled Truth",
			extraction.summary,
			"",
			"**Status:** active",
			`**Owner:** ${path.posix.basename(path.posix.dirname(entry.sourcePath)) || "unknown"}`,
			`**Governance Tags:** ${governanceTags}`,
			`**Keywords:** ${keywordTags}`,
			`**Context Zone:** ${entry.contextZone || "(unknown)"}`,
			`**Target Zone:** ${governanceTarget}`,
			`**Matched Rules:** ${governanceRules}`,
			`**Archive Suggestion:** ${archiveSuggestion}`,
			`**Suggestion Only:** ${entry.suggestionOnly ? "true" : "false"}`,
			`**Policy Root:** ${policyRootPath}`,
			"",
			"### Open Threads",
			openThreads,
			"",
			"### See Also",
			seeAlso,
			"",
			"### Highlights",
			highlights,
			"",
			"---",
			"",
			"## Timeline",
			timeline,
			"",
		].join("\n");
	}

	private extractKnowledge(rawPath: string, rawText: string): KnowledgeExtraction {
		const lines = rawText.split(/\r?\n/);
		const headingLine = lines.find((line) => /^#{1,6}\s+/.test(line.trim()))?.trim() ?? "";
		const fallbackTitle = path.posix.basename(rawPath, path.posix.extname(rawPath));
		const title = this.cleanLine(headingLine.replace(/^#{1,6}\s+/, "")) || fallbackTitle || "Untitled";

		const candidates: Array<{ line: number; text: string }> = [];
		const highlights: string[] = [];
		for (let index = 0; index < lines.length; index += 1) {
			const raw = lines[index] ?? "";
			const trimmed = raw.trim();
			if (!trimmed) {
				continue;
			}
			const cleaned = this.cleanLine(trimmed);
			if (cleaned.length < 6) {
				continue;
			}
			candidates.push({ line: index + 1, text: cleaned });
			if ((/^#{1,6}\s+/.test(trimmed) || /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) && highlights.length < 12) {
				highlights.push(cleaned);
			}
		}

		const summarySource = candidates.slice(0, 3).map((item) => item.text).join(" ");
		const summary = this.truncate(summarySource || `Knowledge extracted from ${path.posix.basename(rawPath)}.`, 220);
		const normalizedHighlights = this.uniqueList(highlights).slice(0, 8);
		const evidence = candidates.slice(0, 8).map((item) => ({
			line: item.line,
			text: this.truncate(item.text, 140),
		}));
		const keywords = this.extractKeywords([title, summary, ...normalizedHighlights, ...evidence.map((item) => item.text)]);
		const wikilinks = [...new Set((rawText.match(/\[\[([^\]]+)\]\]/g) ?? []).map((item) => item.replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean))];

		return {
			title: this.truncate(title, 80),
			summary,
			highlights: normalizedHighlights,
			keywords,
			evidence,
			wikilinks,
		};
	}

	private async loadGovernanceContext(projectRoot: string): Promise<GovernanceContext> {
		const policyRootPath = normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/_governance/tag-policy`);
		await this.ensureParentFolder(`${policyRootPath}/tag-policy.json`);
		const assets = getDefaultTagPolicyAssets();
		for (const [fileName, content] of Object.entries(assets)) {
			const targetPath = normalizePath(`${policyRootPath}/${fileName}`);
			const existing = this.vault.getAbstractFileByPath(targetPath);
			if (!(existing instanceof TFile)) {
				await this.writeTextFile(targetPath, content.endsWith("\n") ? content : `${content}\n`);
			}
		}

		const runtimePolicyPath = normalizePath(`${policyRootPath}/tag-policy.json`);
		const runtimeFile = this.vault.getAbstractFileByPath(runtimePolicyPath);
		const runtimeContent = runtimeFile instanceof TFile
			? await this.vault.cachedRead(runtimeFile)
			: (assets["tag-policy.json"] ?? "{}");
		return {
			policy: parseTagPolicy(runtimeContent),
			policyRootPath,
		};
	}

	private evaluateGovernanceForRaw(
		projectRoot: string,
		rawPath: string,
		rawText: string,
		existingTags: string[],
		governance: GovernanceContext,
	): GovernanceEvaluationResult & { contextZone: "archive_source" | "workspace_draft" | "wiki_artifact"; policyRootPath: string } {
		const relativePath = normalizePath(path.posix.relative(projectRoot, rawPath));
		const frontmatter = this.extractFrontmatter(rawText);
		const mergedTags = this.uniqueList([
			...existingTags,
			...this.extractFrontmatterTags(frontmatter),
		]);
		const contextZone = resolveContextZone(relativePath, "raw");
		const evaluated = evaluateTagPolicy(governance.policy, {
			projectRelativePath: relativePath,
			fileName: path.posix.basename(rawPath),
			contextZone,
			frontmatter,
			existingTags: mergedTags,
		});
		return {
			...evaluated,
			contextZone,
			policyRootPath: governance.policyRootPath,
		};
	}

	private extractFrontmatter(rawText: string): Record<string, unknown> {
		const normalized = rawText.replace(/\r/g, "");
		const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
		if (!match?.[1]) {
			return {};
		}
		const result: Record<string, unknown> = {};
		for (const line of match[1].split("\n")) {
			const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
			if (!kv) {
				continue;
			}
			const key = kv[1]!.trim();
			const value = kv[2]!.trim().replace(/^['"]|['"]$/g, "");
			result[key] = value;
		}
		return result;
	}

	private extractFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
		const raw = frontmatter.tags;
		if (Array.isArray(raw)) {
			return raw.map((item) => String(item).trim()).filter(Boolean);
		}
		if (typeof raw === "string") {
			return raw.split(",").map((item) => item.trim()).filter(Boolean);
		}
		return [];
	}

	private extractKeywords(texts: string[]): string[] {
		const scoreMap = new Map<string, number>();
		for (const text of texts) {
			const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
			for (const token of tokens) {
				const normalized = token.toLowerCase();
				if (EN_STOPWORDS.has(normalized)) {
					continue;
				}
				if (/^\d+$/.test(normalized)) {
					continue;
				}
				scoreMap.set(token, (scoreMap.get(token) ?? 0) + 1);
			}
		}
		return [...scoreMap.entries()]
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
			.slice(0, 12)
			.map((item) => item[0]);
	}

	private cleanLine(value: string): string {
		return value
			.replace(/!\[[^\]]*]\([^)]*\)/g, " ")
			.replace(/\[[^\]]*]\([^)]*\)/g, " ")
			.replace(/[`*_>#~|-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private async rebuildWikiIndexes(
		project: ProjectEntry,
		projectRoot: string,
		changedEntries: Map<string, WikiDocIndexEntry>,
	): Promise<string> {
		const existing = await this.readExistingIndex(projectRoot);
		const existingMap = new Map<string, WikiDocIndexEntry>((existing?.documents ?? []).map((item) => [item.docId, item]));
		for (const [docId, entry] of changedEntries) {
			existingMap.set(docId, entry);
		}

		const mergedEntries: WikiDocIndexEntry[] = [];
		const rawFiles = await this.contentService.listRawFiles(projectRoot);
		for (const rawPath of rawFiles) {
			const sidecar = await this.contentService.readSidecar(rawPath);
			if (!sidecar || sidecar.lastIngestStatus !== "success" || !sidecar.docId) {
				continue;
			}
			const existingEntry = existingMap.get(sidecar.docId);
			if (existingEntry) {
				mergedEntries.push({
					...existingEntry,
					sourceVersion: sidecar.sourceVersion,
					contentHash: sidecar.contentHash,
				});
				continue;
			}
			const fallback = await this.createFallbackEntryFromWikiDoc(projectRoot, rawPath, sidecar);
			if (fallback) {
				mergedEntries.push(fallback);
			}
		}

		mergedEntries.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
		const wikiRoot = this.contentService.getWikiRoot(projectRoot);
		const index: WikiIndexFile = {
			version: 1,
			projectId: project.slug,
			generatedAt: new Date().toISOString(),
			wikiRoot,
			documents: mergedEntries,
		};

		const indexPath = normalizePath(`${wikiRoot}/index.json`);
		await this.writeTextFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
		await this.writeTextFile(this.getWikiMarkdownIndexPath(projectRoot), this.buildWikiIndexMarkdown(index));
		await this.writeDerivedIndexes(projectRoot, mergedEntries);
		return indexPath;
	}

	private buildWikiIndexMarkdown(index: WikiIndexFile): string {
		const lines: string[] = [
			"# Wiki Index",
			"",
			`Generated: ${index.generatedAt}`,
			`Project: ${index.projectId}`,
			`Document count: ${index.documents.length}`,
			"",
			"## Pages",
			"",
		];

		for (const item of index.documents) {
			const rel = normalizePath(path.posix.relative(index.wikiRoot, item.wikiPath));
			lines.push(`- [[${rel}|${item.title}]] | source: \`${item.sourcePath}\` | v${item.sourceVersion} | zone: ${item.contextZone || "unknown"} -> ${item.targetZone || "none"} | tags: ${item.tags?.slice(0, 6).join(", ") || "none"} | keywords: ${item.keywords.slice(0, 6).join(", ") || "none"}`);
		}
		if (index.documents.length === 0) {
			lines.push("- No pages.");
		}
		lines.push("");
		return lines.join("\n");
	}

	private async writeDerivedIndexes(projectRoot: string, entries: WikiDocIndexEntry[]): Promise<void> {
		const relationDocs: Array<{ title: string; wikiPath: string; keywords: string[]; content: string }> = [];
		for (const entry of entries) {
			const file = this.vault.getAbstractFileByPath(entry.wikiPath);
			if (!(file instanceof TFile)) {
				continue;
			}
			const content = await this.vault.cachedRead(file);
			relationDocs.push({
				title: entry.title,
				wikiPath: entry.wikiPath,
				keywords: entry.keywords,
				content,
			});
		}

		const relationGraph = buildRelationGraph(relationDocs);
		const capabilityIndex = buildCapabilityIndex(entries.map((entry) => ({
			id: entry.docId,
			title: entry.title,
			summary: entry.summary,
			keywords: entry.keywords,
			links: relationGraph.edges.filter((edge) => edge.from === entry.wikiPath).length,
		})));

		await this.writeTextFile(this.getRelationGraphPath(projectRoot), `${JSON.stringify(relationGraph, null, 2)}\n`);
		await this.writeTextFile(this.getCapabilityIndexPath(projectRoot), `${JSON.stringify(capabilityIndex, null, 2)}\n`);
	}

	private async createFallbackEntryFromWikiDoc(
		projectRoot: string,
		rawPath: string,
		sidecar: RawSidecarMeta,
	): Promise<WikiDocIndexEntry | null> {
		const wikiPath = this.getWikiDocPath(projectRoot, sidecar.docId);
		const file = this.vault.getAbstractFileByPath(wikiPath);
		if (!(file instanceof TFile)) {
			return null;
		}
		const content = await this.vault.cachedRead(file);
		const title = content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.startsWith("# "))
			?.replace(/^#\s+/, "")
			?.trim()
			|| path.posix.basename(rawPath, path.posix.extname(rawPath));
		const summary = this.extractSectionPreview(content, "## Compiled Truth", 180);
		const keywordsText = this.extractSectionPreview(content, "**Tags:**", 140);
		const keywords = (keywordsText.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []).slice(0, 12);
		const evidenceCount = this.extractSectionPreview(content, "## Timeline", 500)
			.split(/\r?\n/)
			.filter((line) => line.trim().startsWith("- "))
			.length;
		return {
			docId: sidecar.docId,
			title: this.truncate(title, 80),
			wikiPath,
			sourcePath: rawPath,
			sourceVersion: sidecar.sourceVersion,
			contentHash: sidecar.contentHash,
			summary: summary || "No summary.",
			keywords: keywords.length > 0 ? this.uniqueList(keywords) : [],
			evidenceCount,
			updatedAt: sidecar.lastIngestAt || new Date().toISOString(),
		};
	}

	private extractSectionPreview(content: string, sectionTitle: string, maxChars: number): string {
		const normalized = content.replace(/\r/g, "");
		const start = normalized.indexOf(sectionTitle);
		if (start < 0) {
			return "";
		}
		const afterTitle = normalized.slice(start + sectionTitle.length);
		const nextSectionIndex = afterTitle.search(/\n##\s+|\n###\s+/);
		const section = nextSectionIndex >= 0 ? afterTitle.slice(0, nextSectionIndex) : afterTitle;
		return this.truncate(section.replace(/\n+/g, " ").trim(), maxChars);
	}

	private async readExistingIndex(projectRoot: string): Promise<WikiIndexFile | null> {
		const indexPath = normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/index.json`);
		const file = this.vault.getAbstractFileByPath(indexPath);
		if (!(file instanceof TFile)) {
			return null;
		}
		try {
			const raw = await this.vault.cachedRead(file);
			const parsed = JSON.parse(raw) as WikiIndexFile;
			if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.documents)) {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	private async appendWikiLog(projectRoot: string, event: IngestEvent): Promise<string> {
		const logPath = this.getWikiLogPath(projectRoot);
		await this.ensureParentFolder(logPath);

		const line = `- ${event.finishedAt} | ${event.status.toUpperCase()} | doc=${event.docId} | v${event.sourceVersion} | ${event.fromHash.slice(0, 8)} -> ${event.toHash.slice(0, 8)}${event.error ? ` | error=${event.error}` : ""}`;
		const existing = await this.resolveFileConflict(logPath);
		if (existing instanceof TFile) {
			const current = await this.vault.cachedRead(existing);
			await this.vault.modify(existing, `${current}\n${line}\n`);
			return logPath;
		}

		const initial = ["# Wiki Ingest Log", "", line, ""].join("\n");
		try {
			await this.vault.create(logPath, initial);
		} catch (error) {
			if (!this.isAlreadyExistsError(error)) {
				throw error;
			}
			const created = await this.resolveFileConflict(logPath);
			if (!(created instanceof TFile)) {
				throw new Error(`Failed to write wiki log: ${logPath}: ${this.errorMessage(error)}`);
			}
			const current = await this.vault.cachedRead(created);
			await this.vault.modify(created, `${current}\n${line}\n`);
		}
		return logPath;
	}

	private async persistTrackingArtifacts(
		projectRoot: string,
		rawPath: string,
		ingestId: string,
		status: "success" | "failed",
		finishedAt: string,
		event: IngestEvent,
		currentLogPath: string,
	): Promise<string> {
		let nextLogPath = currentLogPath;
		try {
			await this.eventStore.append(projectRoot, event);
		} catch (error) {
			this.warnTrackingWriteFailure("ingest-event", rawPath, error);
		}
		try {
			await this.contentService.upsertSidecar(rawPath, {
				lastIngestId: ingestId,
				lastIngestAt: finishedAt,
				lastIngestStatus: status,
			});
		} catch (error) {
			this.warnTrackingWriteFailure("sidecar", rawPath, error);
		}
		try {
			nextLogPath = await this.appendWikiLog(projectRoot, event);
		} catch (error) {
			this.warnTrackingWriteFailure("wiki-log", rawPath, error);
		}
		return nextLogPath;
	}

	private warnTrackingWriteFailure(stage: string, rawPath: string, error: unknown): void {
		console.warn("[Friday] Wiki tracking write failed:", {
			stage,
			rawPath,
			error: this.errorMessage(error),
		});
	}

	private getWikiDocPath(projectRoot: string, docId: string): string {
		const safeDocId = this.sanitizeDocId(docId);
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/pages/${safeDocId}.md`);
	}

	private getWikiLogPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/log.md`);
	}

	private getWikiMarkdownIndexPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/index.md`);
	}

	private getRelationGraphPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/raw_relation_graph.json`);
	}

	private getCapabilityIndexPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/raw_capability_index.json`);
	}

	private sanitizeDocId(docId: string): string {
		const normalized = normalizePath(docId || "doc")
			.replace(/\//g, "__")
			.replace(/[^a-zA-Z0-9_.-]/g, "_")
			.slice(0, 180)
			.replace(/^_+/, "")
			.replace(/_+$/, "");
		return normalized || "doc";
	}

	private escapeYamlText(value: string): string {
		return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
	}

	private uniqueList(values: string[]): string[] {
		const output: string[] = [];
		for (const value of values) {
			const normalized = value.trim();
			if (!normalized) {
				continue;
			}
			if (!output.includes(normalized)) {
				output.push(normalized);
			}
		}
		return output;
	}

	private truncate(value: string, maxLength: number): string {
		if (value.length <= maxLength) {
			return value;
		}
		if (maxLength <= 3) {
			return value.slice(0, maxLength);
		}
		return `${value.slice(0, maxLength - 3)}...`;
	}

	private async writeTextFile(filePath: string, content: string): Promise<void> {
		await this.ensureParentFolder(filePath);
		const existing = await this.resolveFileConflict(filePath);
		if (existing instanceof TFile) {
			const current = await this.vault.cachedRead(existing);
			if (current !== content) {
				await this.vault.modify(existing, content);
			}
			return;
		}

		try {
			await this.vault.create(filePath, content);
		} catch (error) {
			if (!this.isAlreadyExistsError(error)) {
				throw error;
			}
			const created = await this.resolveFileConflict(filePath);
			if (!(created instanceof TFile)) {
				throw error;
			}
			const current = await this.vault.cachedRead(created);
			if (current !== content) {
				await this.vault.modify(created, content);
			}
		}
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parentPath = normalizePath(path.posix.dirname(filePath));
		if (!parentPath || parentPath === ".") {
			return;
		}
		const segments = parentPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) {
				continue;
			}
			if (existing instanceof TFile) {
				await this.vault.rename(existing, `${current}.legacy-file-${Date.now()}`);
			}
			try {
				await this.vault.createFolder(current);
			} catch (error) {
				if (!this.isAlreadyExistsError(error)) {
					throw error;
				}
			}
		}
	}

	private createIngestId(projectSlug: string): string {
		const random = Math.random().toString(36).slice(2, 8);
		return `ingest-${projectSlug}-${Date.now()}-${random}`;
	}

	private fallbackDocId(projectSlug: string, rawPath: string): string {
		return `${projectSlug}__${normalizePath(rawPath).replace(/\//g, "__")}`;
	}

	private async resolveFileConflict(filePath: string): Promise<TFile | null> {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		if (direct instanceof TFolder) {
			await this.vault.rename(direct, `${normalized}.legacy-folder-${Date.now()}`);
			return null;
		}
		return this.getFileByPathRelaxed(normalized);
	}

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		const lower = normalized.toLowerCase();
		return this.vault.getFiles().find((item) => normalizePath(item.path).toLowerCase() === lower) ?? null;
	}

	private errorMessage(error: unknown): string {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").trim();
		return message || "unknown error";
	}

	private isAlreadyExistsError(error: unknown): boolean {
		const message = this.errorMessage(error).toLowerCase();
		return message.includes("already exists") || message.includes("eexist");
	}
}
