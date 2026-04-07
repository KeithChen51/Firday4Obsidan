import { promises as fs } from "fs";
import type { Dirent } from "fs";
import path from "path";
import { normalizePath, TFile, Vault } from "obsidian";
import { FridaySettings } from "../types/settings";
import { WorkspaceAccessService } from "./WorkspaceAccessService";

interface ScannedFile {
	source: "vault" | "external";
	path: string;
	extension: string;
}

export interface VaultScanReport {
	scannedAt: string;
	scopePaths: string[];
	totalAccessibleFiles: number;
	vaultAccessibleFiles: number;
	externalAccessibleFiles: number;
	returnedFiles: number;
	truncated: boolean;
}

export interface VaultContextBundle {
	report: VaultScanReport;
	contextText: string;
}

export class VaultContextService {
	private readonly maxExternalFileBytes = 1024 * 1024;

	constructor(
		private readonly vault: Vault,
		private readonly workspaceAccessService: WorkspaceAccessService,
		private readonly getSettings: () => FridaySettings,
	) {}

	async buildContextForPrompt(prompt: string): Promise<VaultContextBundle> {
		const settings = this.getSettings();
		const scan = await this.scanConfiguredScope(1200);
		const keywords = this.extractKeywords(prompt);
		const scored = this.rankFilesByPrompt(scan.files, keywords);
		const topForPaths = scored.slice(0, 180);
		const topForSnippets = scored.slice(0, 18);
		const snippets = await this.readSnippets(topForSnippets, keywords);

		const maxChars = Math.max(2800, Math.min(settings.knowledgeCurator.maxModelInputChars, 20000));
		const lines: string[] = [];
		lines.push("你是运行在 Obsidian 插件中的 Agent。");
		lines.push("下面内容来自对配置范围的实时扫描，不要声称看不到 workspace。");
		lines.push(`Vault: ${this.vault.getName()}`);
		lines.push(`扫描时间: ${scan.report.scannedAt}`);
		lines.push(`扫描范围: ${scan.report.scopePaths.join(", ") || "全部 Vault"}`);
		lines.push(
			`可读文件: ${scan.report.totalAccessibleFiles} (Vault ${scan.report.vaultAccessibleFiles} + 外部 ${scan.report.externalAccessibleFiles})${scan.report.truncated ? `（上下文仅展示前 ${scan.report.returnedFiles}）` : ""}`,
		);
		if (keywords.length > 0) {
			lines.push(`查询关键词: ${keywords.join(", ")}`);
		}
		lines.push("");
		lines.push("文件路径（Top）：");
		for (const item of topForPaths) {
			lines.push(`- ${this.formatDisplayPath(item)}`);
		}
		if (snippets.length > 0) {
			lines.push("");
			lines.push("相关文件摘要（Top）：");
			for (const snippet of snippets) {
				lines.push(`### ${this.formatDisplayPath(snippet.file)}`);
				lines.push(snippet.content);
			}
		}

		let contextText = lines.join("\n");
		if (contextText.length > maxChars) {
			contextText = `${contextText.slice(0, maxChars)}\n...（上下文已截断）`;
		}

		return {
			report: scan.report,
			contextText,
		};
	}

	async scanConfiguredScope(limit: number): Promise<{ report: VaultScanReport; files: ScannedFile[] }> {
		const settings = this.getSettings();
		const safeLimit = Math.max(1, limit);
		const vaultScopePaths = settings.agentRuntime.vaultFocusPaths
			.map((item) => normalizePath(item))
			.filter((item) => item.length > 0);
		const externalRoots = this.getExternalRoots(settings);
		const allVaultFiles = this.vault.getFiles().map((item) => ({
			path: normalizePath(item.path),
			extension: item.extension.toLowerCase(),
		}));
		const accessibleVault = allVaultFiles.filter((file) =>
			this.workspaceAccessService.canReadVaultPath(file.path),
		);
		const excludedTags = this.getExcludedTagSet(settings);
		const filteredAccessibleVault =
			excludedTags.size > 0 ? await this.excludeFilesByTags(accessibleVault, excludedTags) : accessibleVault;

		const selectedVault = filteredAccessibleVault
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, safeLimit)
			.map((file) => ({
				source: "vault" as const,
				path: file.path,
				extension: file.extension,
			}));

		const files: ScannedFile[] = [...selectedVault];
		let externalTruncated = false;
		let externalAccessibleFiles = 0;

		for (const root of externalRoots) {
			if (files.length >= safeLimit) {
				externalTruncated = true;
				break;
			}
			const remaining = safeLimit - files.length;
			const result = await this.scanExternalRoot(root, remaining);
			externalAccessibleFiles += result.files.length;
			files.push(...result.files);
			if (result.truncated) {
				externalTruncated = true;
				break;
			}
		}

		const scopePaths = [
			...(vaultScopePaths.length > 0 ? vaultScopePaths : ["<vault-root>"]),
			...externalRoots.map((root) => `external:${root}`),
		];
		const vaultTruncated = filteredAccessibleVault.length > selectedVault.length;

		return {
			report: {
				scannedAt: new Date().toISOString(),
				scopePaths,
				totalAccessibleFiles: filteredAccessibleVault.length + externalAccessibleFiles,
				vaultAccessibleFiles: filteredAccessibleVault.length,
				externalAccessibleFiles,
				returnedFiles: files.length,
				truncated: vaultTruncated || externalTruncated,
			},
			files,
		};
	}

	private extractKeywords(prompt: string): string[] {
		const tokens = (prompt.toLowerCase().match(/[a-z0-9_\-./]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? [])
			.map((item) => item.trim())
			.filter((item) => item.length >= 2)
			.filter((item) => !this.isStopWord(item));
		return [...new Set(tokens)].slice(0, 8);
	}

	private rankFilesByPrompt(
		files: ScannedFile[],
		keywords: string[],
	): Array<ScannedFile & { score: number }> {
		if (keywords.length === 0) {
			return files.map((file) => ({ ...file, score: 0 }));
		}

		const scored = files.map((file) => {
			const pathLower = file.path.toLowerCase();
			let score = 0;
			for (const keyword of keywords) {
				if (pathLower.includes(keyword)) {
					score += 4;
				}
				if (pathLower.endsWith(`/${keyword}.md`) || pathLower.endsWith(`/${keyword}.canvas`)) {
					score += 3;
				}
			}
			if (file.extension === "md" || file.extension === "canvas") {
				score += 1;
			}
			return { ...file, score };
		});

		return scored.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.path.localeCompare(right.path);
		});
	}

	private async readSnippets(
		files: ScannedFile[],
		keywords: string[],
	): Promise<Array<{ file: ScannedFile; content: string }>> {
		const snippets: Array<{ file: ScannedFile; content: string }> = [];
		for (const file of files) {
			if (!this.isReadableTextExtension(file.extension)) {
				continue;
			}

			try {
				const raw = await this.readFileText(file);
				const snippet = this.extractSnippet(raw, keywords);
				if (!snippet) {
					continue;
				}
				snippets.push({
					file,
					content: snippet,
				});
				if (snippets.length >= 12) {
					break;
				}
			} catch {
				// Ignore unreadable files.
			}
		}
		return snippets;
	}

	private extractSnippet(raw: string, keywords: string[]): string {
		const normalized = raw.replace(/\r/g, "");
		if (!normalized.trim()) {
			return "";
		}

		const lines = normalized.split("\n");
		let candidate = lines
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.find((line) => line.length > 20);

		if (keywords.length > 0) {
			const matchedLine = lines.find((line) =>
				keywords.some((keyword) => line.toLowerCase().includes(keyword)),
			);
			if (matchedLine) {
				candidate = matchedLine.trim();
			}
		}

		if (!candidate) {
			candidate = normalized.slice(0, 220).trim();
		}

		return candidate.length > 240 ? `${candidate.slice(0, 240)}…` : candidate;
	}

	private formatDisplayPath(file: ScannedFile): string {
		if (file.source === "vault") {
			return file.path;
		}
		return `[external] ${file.path}`;
	}

	private isReadableTextExtension(extension: string): boolean {
		return ["md", "canvas", "json", "txt", "yaml", "yml"].includes(extension.toLowerCase());
	}

	private async readFileText(file: ScannedFile): Promise<string> {
		if (file.source === "vault") {
			const abstract = this.vault.getAbstractFileByPath(file.path);
			if (!(abstract instanceof TFile)) {
				return "";
			}
			return this.vault.cachedRead(abstract);
		}

		try {
			const stat = await fs.stat(file.path);
			if (!stat.isFile() || stat.size > this.maxExternalFileBytes) {
				return "";
			}
			return await fs.readFile(file.path, "utf8");
		} catch {
			return "";
		}
	}

	private getExcludedTagSet(settings: FridaySettings): Set<string> {
		return new Set(
			(settings.agentRuntime.excludedTags ?? [])
				.map((item) => this.normalizeTag(item))
				.filter((item) => item.length > 0),
		);
	}

	private async excludeFilesByTags(
		files: Array<{ path: string; extension: string }>,
		excludedTags: Set<string>,
	): Promise<Array<{ path: string; extension: string }>> {
		const kept: Array<{ path: string; extension: string }> = [];
		for (const file of files) {
			if (await this.shouldExcludeFileByTags(file.path, excludedTags)) {
				continue;
			}
			kept.push(file);
		}
		return kept;
	}

	private async shouldExcludeFileByTags(filePath: string, excludedTags: Set<string>): Promise<boolean> {
		if (excludedTags.size === 0) {
			return false;
		}
		const abstract = this.vault.getAbstractFileByPath(filePath);
		if (!(abstract instanceof TFile) || abstract.extension.toLowerCase() !== "md") {
			return false;
		}
		let markdown = "";
		try {
			markdown = await this.vault.cachedRead(abstract);
		} catch {
			return false;
		}
		const tags = this.extractFrontmatterTags(markdown);
		for (const tag of tags) {
			if (excludedTags.has(this.normalizeTag(tag))) {
				return true;
			}
		}
		return false;
	}

	private extractFrontmatterTags(markdown: string): string[] {
		const block = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
		if (!block) {
			return [];
		}
		const lines = (block[1] ?? "").split(/\r?\n/);
		const tags: string[] = [];
		let inTagsList = false;
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) {
				if (inTagsList) {
					continue;
				}
				continue;
			}

			const listItem = line.match(/^-\s+(.+)$/);
			if (inTagsList && listItem) {
				tags.push(this.parseTagValue(listItem[1] ?? ""));
				continue;
			}

			const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
			if (!kv) {
				inTagsList = false;
				continue;
			}

			const key = (kv[1] ?? "").trim().toLowerCase();
			const value = (kv[2] ?? "").trim();
			if (key !== "tags") {
				inTagsList = false;
				continue;
			}
			inTagsList = !value;

			if (!value) {
				continue;
			}
			if (value.startsWith("[") && value.endsWith("]")) {
				const items = value
					.slice(1, -1)
					.split(",")
					.map((item) => this.parseTagValue(item))
					.filter((item) => item.length > 0);
				tags.push(...items);
				continue;
			}
			if (value.includes(",")) {
				const items = value
					.split(",")
					.map((item) => this.parseTagValue(item))
					.filter((item) => item.length > 0);
				tags.push(...items);
				continue;
			}
			tags.push(this.parseTagValue(value));
		}
		return tags.filter((item) => item.length > 0);
	}

	private parseTagValue(value: string): string {
		return value.trim().replace(/^['"]+|['"]+$/g, "").replace(/^#/, "");
	}

	private getExternalRoots(settings: FridaySettings): string[] {
		const roots = [
			...settings.agentRuntime.externalReadOnlyPaths,
			...settings.agentRuntime.externalSkillPaths,
		]
			.map((item) => this.normalizeAbsolutePath(item))
			.filter((item) => item.length > 0);

		return [...new Set(roots)];
	}

	private async scanExternalRoot(
		root: string,
		limit: number,
	): Promise<{ files: ScannedFile[]; truncated: boolean }> {
		if (limit <= 0) {
			return { files: [], truncated: true };
		}
		if (!this.workspaceAccessService.canReadExternalPath(root)) {
			return { files: [], truncated: false };
		}

		const files: ScannedFile[] = [];
		const queue: string[] = [root];
		let truncated = false;

		while (queue.length > 0) {
			const current = queue.shift()!;
			let entries: Dirent[] = [];
			try {
				entries = await fs.readdir(current, { withFileTypes: true });
			} catch {
				continue;
			}
			entries.sort((left, right) => left.name.localeCompare(right.name));

			for (const entry of entries) {
				const absolute = this.normalizeAbsolutePath(path.join(current, entry.name));
				if (!this.workspaceAccessService.canReadExternalPath(absolute)) {
					continue;
				}

				if (entry.isDirectory()) {
					queue.push(absolute);
					continue;
				}
				if (!entry.isFile()) {
					continue;
				}

				files.push({
					source: "external",
					path: absolute,
					extension: this.getExtension(absolute),
				});

				if (files.length >= limit) {
					truncated = true;
					break;
				}
			}

			if (truncated) {
				break;
			}
		}

		return { files, truncated };
	}

	private getExtension(filePath: string): string {
		return path.extname(filePath).replace(".", "").toLowerCase();
	}

	private normalizeTag(value: string): string {
		return value.trim().toLowerCase().replace(/^#/, "");
	}

	private normalizeAbsolutePath(inputPath: string): string {
		return normalizePath(path.resolve(inputPath));
	}

	private isStopWord(token: string): boolean {
		return [
			"当前",
			"这个",
			"那个",
			"有没有",
			"什么",
			"如何",
			"please",
			"vault",
			"workspace",
		].includes(token);
	}
}
