import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import {
	IngestEvent,
	ProjectEntry,
	RawSidecarMeta,
	WikiDocIndexEntry,
	WikiIndexFile,
} from "../types/project";
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

interface KnowledgeExtraction {
	title: string;
	summary: string;
	highlights: string[];
	keywords: string[];
	evidence: Array<{ line: number; text: string }>;
}

interface CompiledWikiDoc {
	wikiPath: string;
	entry: WikiDocIndexEntry;
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

const ZH_STOPWORDS = new Set([
	"我们",
	"你们",
	"他们",
	"这个",
	"那个",
	"这些",
	"那些",
	"以及",
	"对于",
	"进行",
	"可以",
	"通过",
	"需要",
	"已经",
	"一个",
	"一种",
	"当前",
	"项目",
	"内容",
	"相关",
	"包括",
	"文件",
	"问题",
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
	): Promise<IngestSummary> {
		const projectRoot = normalizePath(project.projectRootPath);
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
				if (!prepared.changed && prepared.meta.lastIngestStatus === "success") {
					continue;
				}

				const compiled = await this.compileOneRawToWiki(projectRoot, rawPath, prepared.meta);
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
				updatedLog = await this.persistTrackingArtifacts(projectRoot, rawPath, ingestId, "success", finishedAt, event, updatedLog);
				events.push(event);
				succeeded += 1;
			} catch (error) {
				const finishedAt = new Date().toISOString();
				const message = String((error as { message?: unknown })?.message ?? error ?? "");
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
				updatedLog = await this.persistTrackingArtifacts(projectRoot, rawPath, ingestId, "failed", finishedAt, event, updatedLog);
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
	): Promise<CompiledWikiDoc> {
		const rawFile = this.vault.getAbstractFileByPath(rawPath);
		if (!(rawFile instanceof TFile)) {
			throw new Error(`Raw file not found: ${rawPath}`);
		}
		const rawText = await this.vault.cachedRead(rawFile);
		const extraction = this.extractKnowledge(rawPath, rawText);
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
			evidenceCount: extraction.evidence.length,
			updatedAt: now,
		};

		const content = this.buildKnowledgeDocMarkdown(entry, extraction);
		await this.writeTextFile(wikiPath, content);

		return {
			wikiPath,
			entry,
		};
	}

	private buildKnowledgeDocMarkdown(entry: WikiDocIndexEntry, extraction: KnowledgeExtraction): string {
		const keywordLines = extraction.keywords
			.slice(0, 16)
			.map((item) => `  - "${this.escapeYamlText(item)}"`)
			.join("\n");

		const highlightLines = extraction.highlights.length > 0
			? extraction.highlights.slice(0, 8).map((item) => `- ${item}`).join("\n")
			: "- 暂无可提取要点";

		const evidenceLines = extraction.evidence.length > 0
			? extraction.evidence
				.slice(0, 8)
				.map((item) => `- L${item.line}: > ${item.text}`)
				.join("\n")
			: "- 暂无可提取证据";

		const inlineKeywords = extraction.keywords.slice(0, 12).map((item) => `\`${item}\``).join(" ");

		return [
			"---",
			`docId: "${this.escapeYamlText(entry.docId)}"`,
			`title: "${this.escapeYamlText(entry.title)}"`,
			`sourcePath: "${this.escapeYamlText(entry.sourcePath)}"`,
			`sourceVersion: ${entry.sourceVersion}`,
			`contentHash: "${entry.contentHash}"`,
			`updatedAt: "${entry.updatedAt}"`,
			"keywords:",
			keywordLines || "  - \"\"",
			"---",
			"",
			`# ${entry.title}`,
			"",
			"## 摘要",
			extraction.summary,
			"",
			"## 关键要点",
			highlightLines,
			"",
			"## 关键词",
			inlineKeywords || "（暂无）",
			"",
			"## 证据片段",
			evidenceLines,
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

		const summarySource = candidates.slice(0, 3).map((item) => item.text).join("；");
		const summary = this.truncate(summarySource || `基于 ${path.posix.basename(rawPath)} 生成的知识条目。`, 220);
		const normalizedHighlights = this.uniqueList(highlights).slice(0, 8);
		const evidence = candidates.slice(0, 8).map((item) => ({
			line: item.line,
			text: this.truncate(item.text, 140),
		}));
		const keywords = this.extractKeywords([title, summary, ...normalizedHighlights, ...evidence.map((item) => item.text)]);

		return {
			title: this.truncate(title, 80),
			summary,
			highlights: normalizedHighlights,
			keywords,
			evidence,
		};
	}

	private extractKeywords(texts: string[]): string[] {
		const scoreMap = new Map<string, number>();
		for (const text of texts) {
			const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
			for (const token of tokens) {
				const normalized = token.toLowerCase();
				if (EN_STOPWORDS.has(normalized) || ZH_STOPWORDS.has(token)) {
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
		const existingMap = new Map<string, WikiDocIndexEntry>(
			(existing?.documents ?? []).map((item) => [item.docId, item]),
		);
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

		const jsonPath = normalizePath(`${wikiRoot}/index.json`);
		await this.writeTextFile(jsonPath, `${JSON.stringify(index, null, 2)}\n`);
		await this.writeTextFile(this.getWikiMarkdownIndexPath(projectRoot), this.buildWikiIndexMarkdown(index));
		return jsonPath;
	}

	private buildWikiIndexMarkdown(index: WikiIndexFile): string {
		const lines: string[] = [
			"# Wiki 索引",
			"",
			`更新时间：${index.generatedAt}`,
			`项目：${index.projectId}`,
			`知识页数量：${index.documents.length}`,
			"",
			"## 知识页列表",
			"",
		];
		for (const item of index.documents) {
			const rel = normalizePath(path.posix.relative(index.wikiRoot, item.wikiPath));
			lines.push(
				`- [[${rel}|${item.title}]] · \`${item.sourcePath}\` · v${item.sourceVersion} · 关键词: ${item.keywords.slice(0, 6).join(", ") || "无"}`,
			);
		}
		if (index.documents.length === 0) {
			lines.push("- 暂无知识页");
		}
		lines.push("");
		return lines.join("\n");
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
		const summary = this.extractSectionPreview(content, "## 摘要", 180);
		const keywordsText = this.extractSectionPreview(content, "## 关键词", 140);
		const keywords = (keywordsText.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []).slice(0, 12);
		const evidenceCount = this.extractSectionPreview(content, "## 证据片段", 500)
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
			summary: summary || "暂无摘要",
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
		const nextSectionIndex = afterTitle.search(/\n##\s+/);
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

		const line = [
			`- ${event.finishedAt} | ${event.status.toUpperCase()} | doc=${event.docId} | v${event.sourceVersion} | ${event.fromHash.slice(0, 8)} -> ${event.toHash.slice(0, 8)}${event.error ? ` | error=${event.error}` : ""}`,
		].join("\n");

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
				throw new Error(
					`Failed to write wiki log: path conflict at ${logPath} (type=${this.describePathType(logPath)}): ${this.errorMessage(error)}`,
				);
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
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/docs/${safeDocId}.md`);
	}

	private getWikiLogPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/log.md`);
	}

	private getWikiMarkdownIndexPath(projectRoot: string): string {
		return normalizePath(`${this.contentService.getWikiRoot(projectRoot)}/index.md`);
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
			if (current === content) {
				return;
			}
			await this.vault.modify(existing, content);
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
				throw new Error(
					`Failed to write wiki file: path conflict at ${filePath} (type=${this.describePathType(filePath)}): ${this.errorMessage(error)}`,
				);
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
				await this.renameConflictPath(existing, current, "legacy-file");
			}
			try {
				await this.vault.createFolder(current);
			} catch (error) {
				const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
				if (!message.includes("already exists")) {
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

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		const lower = normalized.toLowerCase();
		return this.vault
			.getFiles()
			.find((item) => normalizePath(item.path).toLowerCase() === lower) ?? null;
	}

	private async resolveFileConflict(filePath: string): Promise<TFile | null> {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		if (direct instanceof TFolder) {
			await this.renameConflictPath(direct, normalized, "legacy-folder");
			return null;
		}
		return this.getFileByPathRelaxed(normalized);
	}

	private async renameConflictPath(target: TFile | TFolder, originalPath: string, label: "legacy-file" | "legacy-folder"): Promise<void> {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const backup = normalizePath(`${originalPath}.${label}-${Date.now()}-${attempt}`);
			if (this.vault.getAbstractFileByPath(backup)) {
				continue;
			}
			try {
				await this.vault.rename(target, backup);
				return;
			} catch (error) {
				if (!this.isAlreadyExistsError(error)) {
					throw new Error(
						`Failed to rename conflict path ${originalPath} -> ${backup}: ${this.errorMessage(error)}`,
					);
				}
			}
		}
		throw new Error(`Failed to resolve path conflict for ${originalPath}: no available backup name.`);
	}

	private describePathType(filePath: string): "file" | "folder" | "missing" {
		const target = this.vault.getAbstractFileByPath(normalizePath(filePath));
		if (target instanceof TFile) {
			return "file";
		}
		if (target instanceof TFolder) {
			return "folder";
		}
		return "missing";
	}

	private errorMessage(error: unknown): string {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").trim();
		return message || "unknown error";
	}

	private isAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("already exists") || message.includes("eexist");
	}
}
