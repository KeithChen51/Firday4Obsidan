import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { normalizePath } from "obsidian";
import {
	BUILTIN_SKILL_DEFINITIONS,
	BuiltinSkillDefinition,
	getBuiltinSkillMarkdown as getBuiltinSkillPackMarkdown,
} from "../skills/packs/builtin";
import type { LocaleCode } from "../i18n/types";
import { FridaySettings } from "../types/settings";
import { WorkspaceAccessService } from "./WorkspaceAccessService";

const SKILL_FILE_NAMES = ["skill.md", "SKILL.md"];
const MAX_SCAN_SKILLS = 200;
const MAX_SCAN_DIRECTORIES = 3000;
const MAX_SCAN_FILES_PER_DIR = 200;
const MAX_SKILL_CONTEXT_CHARS = 9000;
const MAX_ASSET_CONTEXT_CHARS = 3200;
const MAX_ASSET_FILE_CHARS = 900;
const MAX_ASSET_FILES_PER_BUCKET = 4;
const MAX_CATALOG_ITEMS = 120;
const INDEX_CACHE_TTL_MS = 60_000;
const BUILTIN_COMPILE_WIKI_COMMAND = "compile-wiki";
const BUILTIN_COMPILE_WIKI_COMMAND_ALIASES = (() => {
	const compileSkill = BUILTIN_SKILL_DEFINITIONS.find((item) => item.command === BUILTIN_COMPILE_WIKI_COMMAND);
	const aliasSet = new Set<string>([normalizeBuiltinToken(BUILTIN_COMPILE_WIKI_COMMAND)]);
	if (compileSkill) {
		for (const alias of compileSkill.aliases) {
			const normalized = normalizeBuiltinToken(alias);
			if (normalized) {
				aliasSet.add(normalized);
			}
		}
	}
	return [...aliasSet];
})();
const BUILTIN_COMPILE_WIKI_INTENT_PATTERNS: RegExp[] = [
	/(^|\s)\/(?:compile-wiki|wiki-compile)\b/i,
	/(?:^|\s)\/skill\s+(?:compile-wiki|wiki-compile|编译wiki|重建wiki)\b/i,
	/(?:compile|rebuild|re-ingest|reingest|refresh|update)\s+wiki\b/i,
	/\bwiki\s+(?:compile|rebuild|re-ingest|reingest|refresh|update)\b/i,
	/(?:编译|重建|刷新|更新)\s*wiki/i,
	/wiki\s*(?:编译|重建|刷新|更新)/i,
	/(?:编译|重建|刷新|更新)\s*(?:索引|wiki索引)/i,
	/(?:wiki\s*索引|知识库\s*索引)\s*(?:编译|重建|刷新|更新)/i,
];

const OBSIDIAN_CLI_PRIORITY_PATTERNS: RegExp[] = [
	/\bobsidian\b/i,
	/\bplugin:reload\b/i,
	/\bdev:errors\b/i,
	/\bdev:screenshot\b/i,
	/\bdev:dom\b/i,
	/\bdev:css\b/i,
	/\bdev:console\b/i,
	/\bbacklinks?\b/i,
	/\bdaily(?::read|:append)?\b/i,
	/\bproperty:set\b/i,
	/\btasks?\b/i,
	/(?:重载|重新加载)\s*(?:插件|plugin)/i,
	/(?:截图|screenshot)/i,
	/(?:检查|查看)\s*(?:dom|控制台|console|错误|报错|界面)/i,
];

function normalizeBuiltinToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^[$/]+/, "")
		.replace(/\.md$/i, "")
		.replace(/\s+/g, "-")
		.replace(/_/g, "-")
		.replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function normalizePortablePath(value: string): string {
	return value.replace(/\\/g, "/");
}

export type SkillTriggerMode = "auto" | "manual";
export type SkillInvocationMode = "manual" | "auto";

export interface SkillDescriptor {
	name: string;
	description: string;
	filePath: string;
	command: string;
	aliases: string[];
	tags: string[];
	globs: string[];
	trigger: SkillTriggerMode;
}

interface SkillIndexEntry extends SkillDescriptor {
	normalizedAliases: string[];
	normalizedTags: string[];
}

interface ParsedSkillFrontmatter {
	name: string;
	description: string;
	descriptionZh: string;
	command: string;
	aliases: string[];
	tags: string[];
	globs: string[];
	trigger: SkillTriggerMode;
}

export interface SuggestedSkill {
	skill: SkillDescriptor;
	score: number;
	reasons: string[];
}

interface BuildSkillSystemContextOptions {
	invocationMode?: SkillInvocationMode;
	selectionReason?: string;
}

export type ParsedSkillSlashCommand =
	| { type: "none" }
	| { type: "list" }
	| { type: "invalid"; error: string }
	| { type: "use"; skillName: string; taskPrompt: string };

export class SkillCommandService {
	private cachedIndex: SkillIndexEntry[] | null = null;
	private cachedIndexWithDisabled: SkillIndexEntry[] | null = null;
	private cacheTimestamp = 0;
	private cacheLocale: LocaleCode | null = null;

	constructor(
		private readonly workspaceAccessService: WorkspaceAccessService,
		private readonly getSettings: () => FridaySettings,
		private readonly getVaultBasePath: () => string,
		private readonly getLocale: () => LocaleCode,
	) {}

	parseSlashCommand(rawPrompt: string): ParsedSkillSlashCommand {
		const prompt = rawPrompt.trim();
		if (!prompt.startsWith("/")) {
			return { type: "none" };
		}

		if (prompt === "/") {
			return { type: "list" };
		}

		if (/^\/skills?$/i.test(prompt)) {
			return { type: "list" };
		}

		const explicit = prompt.match(/^\/skill\s+([^\s]+)(?:\s+([\s\S]*))?$/i);
		if (explicit) {
			const skillName = explicit[1]?.trim() ?? "";
			const taskPrompt = explicit[2]?.trim() ?? "";
			if (!skillName) {
				return { type: "invalid", error: "命令格式错误，请使用 /skill <技能名> <任务>。" };
			}
			if (!taskPrompt) {
				return { type: "invalid", error: "请补充任务内容，例如：/skill writing-agent 优化这段文案。" };
			}
			return { type: "use", skillName, taskPrompt };
		}

		const short = prompt.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
		if (!short) {
			return { type: "none" };
		}

		const commandName = short[1]?.trim() ?? "";
		const taskPrompt = short[2]?.trim() ?? "";
		if (!commandName || this.isReservedSlashCommand(commandName)) {
			return { type: "none" };
		}
		if (!taskPrompt) {
			return {
				type: "invalid",
				error: `请补充任务内容，例如：/${commandName} 帮我整理当前项目文档。`,
			};
		}
		return { type: "use", skillName: commandName, taskPrompt };
	}

	isCompileWikiSkillIntent(rawPrompt: string): boolean {
		const prompt = rawPrompt.trim();
		if (!prompt) {
			return false;
		}

		for (const pattern of BUILTIN_COMPILE_WIKI_INTENT_PATTERNS) {
			if (pattern.test(prompt)) {
				return true;
			}
		}

		const slashSkill = prompt.match(/^\/skill\s+([^\s]+)/i)?.[1] ?? "";
		if (slashSkill && this.isCompileWikiCommand(slashSkill)) {
			return true;
		}

		const shortCommand = prompt.match(/^\/([^\s/]+)/)?.[1] ?? "";
		if (shortCommand && this.isCompileWikiCommand(shortCommand)) {
			return true;
		}

		return false;
	}

	async listSkills(limit = MAX_CATALOG_ITEMS, options?: { includeDisabled?: boolean }): Promise<SkillDescriptor[]> {
		const index = await this.buildSkillIndex(options?.includeDisabled === true);
		return index.slice(0, Math.max(1, limit)).map((entry) => this.toDescriptor(entry));
	}

	async resolveSkill(skillName: string): Promise<SkillDescriptor | null> {
		const query = this.normalizeToken(skillName);
		if (!query) {
			return null;
		}

		const index = await this.buildSkillIndex();
		if (index.length === 0) {
			return null;
		}

		const exact = index.find((entry) => entry.normalizedAliases.includes(query));
		if (exact) {
			return this.toDescriptor(exact);
		}

		const partial = index.find((entry) =>
			entry.normalizedAliases.some((alias) => alias.startsWith(query) || query.startsWith(alias)),
		);
		return partial ? this.toDescriptor(partial) : null;
	}

	async suggestSkillsForPrompt(prompt: string, currentFilePath?: string): Promise<SuggestedSkill[]> {
		const normalizedPrompt = prompt.trim();
		if (!normalizedPrompt) {
			return [];
		}

		const entries = await this.buildSkillIndex();
		const autoEntries = entries.filter((entry) => entry.trigger === "auto");
		if (autoEntries.length === 0) {
			return [];
		}

		const promptLower = normalizedPrompt.toLowerCase();
		const tokens = this.extractIntentTokens(normalizedPrompt);
		const normalizedCurrentPath = normalizePortablePath(currentFilePath ?? "").toLowerCase();
		const fileName = normalizedCurrentPath ? path.basename(normalizedCurrentPath) : "";

		const scored: SuggestedSkill[] = [];
		for (const entry of autoEntries) {
			let score = 0;
			const reasons: string[] = [];

			if (promptLower.includes(`/${entry.command.toLowerCase()}`)) {
				score += 24;
				reasons.push("鍛戒腑鍛戒护鍒悕");
			}

			for (const alias of entry.normalizedAliases) {
				if (!alias) continue;
				if (tokens.includes(alias)) {
					score += 12;
					reasons.push(`鍛戒腑鍒悕: ${alias}`);
					continue;
				}
				if (promptLower.includes(alias) && alias.length >= 3) {
					score += 5;
					reasons.push(`璇箟鍖呭惈鍒悕: ${alias}`);
				}
			}

			for (const tag of entry.normalizedTags) {
				if (!tag) continue;
				if (tokens.includes(tag)) {
					score += 8;
					reasons.push(`鍛戒腑鏍囩: ${tag}`);
				}
			}

			const searchable = `${entry.name} ${entry.description}`.toLowerCase();
			for (const token of tokens) {
				if (token.length < 2) continue;
				if (searchable.includes(token)) {
					score += 3;
					reasons.push(`鍛戒腑鎻忚堪鍏抽敭璇? ${token}`);
				}
			}

			if (normalizedCurrentPath && entry.globs.length > 0) {
				const pathHit = entry.globs.some((glob) => this.matchGlob(glob, normalizedCurrentPath, fileName));
				if (pathHit) {
					score += 15;
					reasons.push("鍛戒腑鏂囦欢璺緞瑙勫垯");
				}
			}

			if (score > 0) {
				scored.push({
					skill: this.toDescriptor(entry),
					score,
					reasons: [...new Set(reasons)].slice(0, 4),
				});
			}
		}

		const obsidianCli = scored.find((item) => item.skill.command === "obsidian-cli");
		if (obsidianCli && this.isObsidianCliPriorityIntent(normalizedPrompt)) {
			obsidianCli.score += 80;
			obsidianCli.reasons = [...new Set(["命中 Obsidian CLI 高优先级运行态操作规则", ...obsidianCli.reasons])].slice(0, 4);
		}

		const compileEntry = autoEntries.find((entry) => this.isCompileWikiCommand(entry.command));
		if (compileEntry && this.isCompileWikiSkillIntent(normalizedPrompt)) {
			const existing = scored.find((item) => this.isCompileWikiCommand(item.skill.command));
			if (existing) {
				existing.score += 40;
				existing.reasons = [...new Set(["命中内置 compile-wiki 技能触发规则", ...existing.reasons])].slice(0, 4);
			} else {
				scored.push({
					skill: this.toDescriptor(compileEntry),
					score: 60,
					reasons: ["命中内置 compile-wiki 技能触发规则"],
				});
			}
		}

		return scored
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				return left.skill.name.localeCompare(right.skill.name, "zh-CN");
			})
			.slice(0, 6);
	}

	async buildSkillSystemContext(
		skillName: string,
		options: BuildSkillSystemContextOptions = {},
	): Promise<{ skill: SkillDescriptor; systemContext: string }> {
		const skill = await this.resolveSkill(skillName);
		if (!skill) {
			throw new Error(`未找到技能：${skillName}。可先输入 /skills 查看可用技能。`);
		}

		const markdown = this.getBuiltinSkillMarkdown(skill) ?? await this.safeReadText(skill.filePath);
		const content = this.truncateText(markdown.trim(), MAX_SKILL_CONTEXT_CHARS);
		const assets = await this.loadSkillAssetContext(skill.filePath);
		const invocationMode = options.invocationMode ?? "manual";
		const selectionReason = options.selectionReason?.trim() ?? "";
		const invocationRules = invocationMode === "auto"
			? [
				"- This skill was auto-matched to the current turn.",
				"- Apply it only when the task clearly matches the skill domain.",
				"- Prefer tool calls for evidence and file operations.",
			]
			: [
				"- User explicitly selected this skill for current turn.",
				"- Follow the skill instructions first, then complete the task.",
				"- If user asks to create/update files, call write tool directly instead of only describing steps.",
				"- Prefer tool calls for evidence and file operations.",
			];
		const systemContextLines = [
			"[SkillInvocation]",
			`mode: ${invocationMode}`,
			`name: ${skill.name}`,
			`command: ${skill.command}`,
			`file: ${skill.filePath}`,
			`trigger: ${skill.trigger}`,
			`tags: ${skill.tags.join(", ") || "(none)"}`,
			`globs: ${skill.globs.join(", ") || "(none)"}`,
			`aliases: ${skill.aliases.join(", ") || "(none)"}`,
			`description: ${skill.description || "N/A"}`,
			...(selectionReason ? [`selection_reason: ${selectionReason}`] : []),
			"rules:",
			...invocationRules,
			"",
			"skill_markdown:",
			content || "(empty)",
		];

		if (assets) {
			systemContextLines.push("");
			systemContextLines.push("skill_assets:");
			systemContextLines.push(assets);
		}

		systemContextLines.push("[/SkillInvocation]");
		return { skill, systemContext: systemContextLines.join("\n") };
	}

	invalidateCache(): void {
		this.cachedIndex = null;
		this.cachedIndexWithDisabled = null;
		this.cacheTimestamp = 0;
		this.cacheLocale = null;
	}

	private async buildSkillIndex(includeDisabled = false): Promise<SkillIndexEntry[]> {
		const now = Date.now();
		const currentLocale = this.getLocale();
		const localeUnchanged = this.cacheLocale === currentLocale;
		if (!includeDisabled && localeUnchanged && this.cachedIndex && now - this.cacheTimestamp < INDEX_CACHE_TTL_MS) {
			return this.cachedIndex;
		}
		if (includeDisabled && localeUnchanged && this.cachedIndexWithDisabled && now - this.cacheTimestamp < INDEX_CACHE_TTL_MS) {
			return this.cachedIndexWithDisabled;
		}

		const roots = this.getSkillRoots();
		const disabledSkills = new Set(
			(this.getSettings().agentRuntime.disabledSkills ?? [])
				.map((item) => this.normalizeToken(item))
				.filter((item) => item.length > 0),
		);
		const records = new Map<string, SkillIndexEntry>();
		for (const builtin of this.getBuiltinSkillEntries()) {
			if (!includeDisabled && disabledSkills.has(this.normalizeToken(builtin.command))) {
				continue;
			}
			records.set(builtin.filePath.toLowerCase(), builtin);
		}
		for (const root of roots) {
			const files = await this.collectSkillFiles(root);
			for (const filePath of files) {
				const descriptor = await this.buildDescriptor(filePath);
				if (!descriptor) continue;
				if (!includeDisabled && disabledSkills.has(this.normalizeToken(descriptor.command))) {
					continue;
				}
				records.set(descriptor.filePath.toLowerCase(), descriptor);
			}
		}

		const sorted = [...records.values()].sort((left, right) => {
			const nameOrder = left.name.localeCompare(right.name, "zh-CN");
			if (nameOrder !== 0) {
				return nameOrder;
			}
			return left.filePath.localeCompare(right.filePath);
		});

		if (includeDisabled) {
			this.cachedIndexWithDisabled = sorted;
		} else {
			this.cachedIndex = sorted;
		}
		this.cacheTimestamp = now;
		this.cacheLocale = currentLocale;
		return sorted;
	}

	private async buildDescriptor(filePath: string): Promise<SkillIndexEntry | null> {
		if (!this.workspaceAccessService.canReadExternalPath(filePath)) {
			return null;
		}

		const markdown = await this.safeReadText(filePath);
		if (!markdown) {
			return null;
		}

		const frontmatter = this.parseFrontmatter(markdown);
		const folderName = path.basename(path.dirname(filePath));
		const fallbackName = folderName || "skill";
		const name = (frontmatter.name || fallbackName).trim();
		const description = this.resolveLocalizedDescription(
			frontmatter.description,
			frontmatter.descriptionZh,
			this.extractSummary(markdown),
		).trim();
		const command = this.buildDefaultCommand(frontmatter.command, name, folderName);
		const aliases = this.buildAliases(name, folderName, command, frontmatter.aliases);
		const tags = [...new Set(frontmatter.tags.map((item) => item.trim()).filter((item) => item.length > 0))];
		const globs = [...new Set(frontmatter.globs.map((item) => normalizePath(item)).filter((item) => item.length > 0))];

		return {
			name,
			description,
			filePath: this.normalizeAbsolutePath(filePath),
			command,
			aliases,
			tags,
			globs,
			trigger: frontmatter.trigger,
			normalizedAliases: aliases.map((item) => this.normalizeToken(item)).filter((item) => item.length > 0),
			normalizedTags: tags.map((item) => this.normalizeTag(item)).filter((item) => item.length > 0),
		};
	}

	private toDescriptor(entry: SkillIndexEntry): SkillDescriptor {
		return {
			name: entry.name,
			description: entry.description,
			filePath: entry.filePath,
			command: entry.command,
			aliases: [...entry.aliases],
			tags: [...entry.tags],
			globs: [...entry.globs],
			trigger: entry.trigger,
		};
	}

	private async collectSkillFiles(rootPath: string): Promise<string[]> {
		const absoluteRoot = this.normalizeAbsolutePath(rootPath);
		if (!absoluteRoot || !this.workspaceAccessService.canReadExternalPath(absoluteRoot)) {
			return [];
		}

		let stat;
		try {
			stat = await fs.stat(absoluteRoot);
		} catch {
			return [];
		}

		if (stat.isFile()) {
			return this.isSkillFileName(path.basename(absoluteRoot)) ? [absoluteRoot] : [];
		}
		if (!stat.isDirectory()) {
			return [];
		}

		const files: string[] = [];
		const queue: string[] = [absoluteRoot];
		let visited = 0;

		while (queue.length > 0 && files.length < MAX_SCAN_SKILLS && visited < MAX_SCAN_DIRECTORIES) {
			const current = queue.shift()!;
			visited += 1;
			if (!this.workspaceAccessService.canReadExternalPath(current)) {
				continue;
			}

			let entries;
			try {
				entries = await fs.readdir(current, { withFileTypes: true });
			} catch {
				continue;
			}

			entries.sort((left, right) => left.name.localeCompare(right.name));
			for (const entry of entries.slice(0, MAX_SCAN_FILES_PER_DIR)) {
				const absoluteEntry = this.normalizeAbsolutePath(path.join(current, entry.name));
				if (!this.workspaceAccessService.canReadExternalPath(absoluteEntry)) {
					continue;
				}

				if (entry.isDirectory()) {
					queue.push(absoluteEntry);
					continue;
				}
				if (!entry.isFile()) {
					continue;
				}
				if (!this.isSkillFileName(entry.name)) {
					continue;
				}
				files.push(absoluteEntry);
				if (files.length >= MAX_SCAN_SKILLS) {
					break;
				}
			}
		}

		return files;
	}

	private async loadSkillAssetContext(skillFilePath: string): Promise<string> {
		const rootDir = path.dirname(skillFilePath);
		const chunks: string[] = [];
		let usedChars = 0;

		const appendChunk = (text: string): boolean => {
			const trimmed = text.trim();
			if (!trimmed) return true;
			if (usedChars >= MAX_ASSET_CONTEXT_CHARS) {
				return false;
			}
			const remaining = MAX_ASSET_CONTEXT_CHARS - usedChars;
			const chunk = trimmed.length <= remaining ? trimmed : `${trimmed.slice(0, remaining)}...`;
			chunks.push(chunk);
			usedChars += chunk.length + 1;
			return trimmed.length <= remaining;
		};

		for (const bucketName of ["templates", "examples"] as const) {
			const bucketPath = this.normalizeAbsolutePath(path.join(rootDir, bucketName));
			if (!this.workspaceAccessService.canReadExternalPath(bucketPath)) {
				continue;
			}

			let stat;
			try {
				stat = await fs.stat(bucketPath);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) {
				continue;
			}

			let entries;
			try {
				entries = await fs.readdir(bucketPath, { withFileTypes: true });
			} catch {
				continue;
			}

			const fileEntries = entries
				.filter((entry) => entry.isFile())
				.sort((left, right) => left.name.localeCompare(right.name))
				.slice(0, MAX_ASSET_FILES_PER_BUCKET);

			if (fileEntries.length === 0) {
				continue;
			}

			if (!appendChunk(`## ${bucketName}`)) {
				break;
			}

			for (const entry of fileEntries) {
				const absolutePath = this.normalizeAbsolutePath(path.join(bucketPath, entry.name));
				if (!this.workspaceAccessService.canReadExternalPath(absolutePath)) {
					continue;
				}

				const raw = await this.safeReadText(absolutePath);
				if (!raw.trim()) {
					continue;
				}

				const relative = normalizePath(path.relative(rootDir, absolutePath));
				const snippet = this.truncateText(raw.trim(), MAX_ASSET_FILE_CHARS);
				if (!appendChunk(`- ${relative}\n${snippet}`)) {
					break;
				}
			}
		}

		return chunks.join("\n\n");
	}

	private isSkillFileName(name: string): boolean {
		return SKILL_FILE_NAMES.some((valid) => valid.toLowerCase() === name.toLowerCase());
	}

	private getSkillRoots(): string[] {
		const items: string[] = [];

		// Vault 鍐?Skill 鐩綍
		items.push(path.join(this.getVaultBasePath(), "F.R.I.D.A.Y", "Skills"));

		// 鍏ㄥ眬 Skill 鐩綍
		items.push(path.join(os.homedir(), "F.R.I.D.A.Y", "skills"));

		// 澶栭儴閰嶇疆璺緞
		for (const ext of this.getSettings().agentRuntime.externalSkillPaths) {
			items.push(ext);
		}

		const roots = items
			.map((item) => this.normalizeAbsolutePath(item))
			.filter((item) => item.length > 0);
		return [...new Set(roots)];
	}

	private getBuiltinSkillEntries(): SkillIndexEntry[] {
		return BUILTIN_SKILL_DEFINITIONS.map((skill) => this.toBuiltinSkillIndexEntry(skill));
	}

	private toBuiltinSkillIndexEntry(skill: BuiltinSkillDefinition): SkillIndexEntry {
		return {
			name: skill.name,
			description: this.getLocale() === "zh-CN" ? skill.descriptionZh : skill.description,
			filePath: skill.filePath,
			command: skill.command,
			aliases: [...skill.aliases],
			tags: [...skill.tags],
			globs: [...skill.globs],
			trigger: skill.trigger,
			normalizedAliases: skill.aliases
				.map((item) => this.normalizeToken(item))
				.filter((item) => item.length > 0),
			normalizedTags: skill.tags
				.map((item) => this.normalizeTag(item))
				.filter((item) => item.length > 0),
		};
	}

	private getBuiltinSkillMarkdown(skill: SkillDescriptor): string | null {
		return getBuiltinSkillPackMarkdown(skill.command) ?? getBuiltinSkillPackMarkdown(skill.filePath);
	}

	private isCompileWikiCommand(raw: string): boolean {
		const normalized = this.normalizeToken(raw);
		return BUILTIN_COMPILE_WIKI_COMMAND_ALIASES.includes(normalized);
	}

	private isObsidianCliPriorityIntent(rawPrompt: string): boolean {
		const prompt = rawPrompt.trim();
		if (!prompt) {
			return false;
		}
		return OBSIDIAN_CLI_PRIORITY_PATTERNS.some((pattern) => pattern.test(prompt));
	}

	private parseFrontmatter(markdown: string): ParsedSkillFrontmatter {
		const block = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*/);
		const result: ParsedSkillFrontmatter = {
			name: "",
			description: "",
			descriptionZh: "",
			command: "",
			aliases: [],
			tags: [],
			globs: [],
			trigger: "auto",
		};
		if (!block) {
			return result;
		}

		type ListField = "aliases" | "tags" | "globs";
		let activeListField: ListField | null = null;
		const lines = (block[1] ?? "").split(/\r?\n/);
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) {
				continue;
			}

			const listItem = line.match(/^-\s+(.+)$/);
			if (listItem && activeListField) {
				this.pushFrontmatterListValue(result, activeListField, listItem[1] ?? "");
				continue;
			}

			const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
			if (!kv) {
				activeListField = null;
				continue;
			}

			const key = (kv[1] ?? "").trim().toLowerCase();
			const rawValue = (kv[2] ?? "").trim();
			if (key === "aliases" || key === "tags" || key === "globs") {
				activeListField = key;
				if (rawValue) {
					const items = this.parseFrontmatterList(rawValue);
					for (const item of items) {
						this.pushFrontmatterListValue(result, key, item);
					}
				}
				continue;
			}

			activeListField = null;
			const value = this.stripQuotes(rawValue);
			if (!value) continue;
			if (key === "name") {
				result.name = value;
			} else if (key === "description") {
				result.description = value;
			} else if (key === "descriptionzh" || key === "description_zh" || key === "description_cn" || key === "descriptionzhcn") {
				result.descriptionZh = value;
			} else if (key === "command") {
				result.command = value;
			} else if (key === "trigger") {
				result.trigger = value.toLowerCase() === "manual" ? "manual" : "auto";
			}
		}

		result.aliases = [...new Set(result.aliases)];
		result.tags = [...new Set(result.tags)];
		result.globs = [...new Set(result.globs)];
		return result;
	}

	private pushFrontmatterListValue(result: ParsedSkillFrontmatter, field: "aliases" | "tags" | "globs", raw: string): void {
		const value = this.stripQuotes(raw.trim());
		if (!value) return;
		result[field].push(value);
	}

	private parseFrontmatterList(rawValue: string): string[] {
		const value = rawValue.trim();
		if (!value) {
			return [];
		}
		const listValue = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
		return listValue
			.split(",")
			.map((item) => this.stripQuotes(item.trim()))
			.filter((item) => item.length > 0);
	}

	private stripQuotes(value: string): string {
		return value.replace(/^['"]+|['"]+$/g, "").trim();
	}

	private resolveLocalizedDescription(primary: string, zhOverride: string, fallback: string): string {
		if (this.getLocale() === "zh-CN") {
			return zhOverride || primary || fallback;
		}
		return primary || zhOverride || fallback;
	}

	private extractSummary(markdown: string): string {
		const lines = markdown.replace(/\r/g, "").split("\n");
		for (const line of lines) {
			const text = line.trim();
			if (!text || text.startsWith("#") || text.startsWith("---")) {
				continue;
			}
			return this.truncateText(text, 120);
		}
		return "";
	}

	private buildDefaultCommand(frontmatterCommand: string, name: string, folderName: string): string {
		const preferred = this.normalizeToken(frontmatterCommand || name) || this.normalizeToken(folderName);
		return preferred || "skill";
	}

	private buildAliases(name: string, folderName: string, command: string, extraAliases: string[]): string[] {
		const items = [name, folderName, command, `/${command}`, `$${command}`, ...extraAliases]
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
		return [...new Set(items)];
	}

	private extractIntentTokens(prompt: string): string[] {
		const rawTokens = prompt
			.toLowerCase()
			.match(/[a-z0-9_\-./]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
		const normalized = rawTokens
			.map((item) => item.trim())
			.filter((item) => item.length >= 2)
			.map((item) => this.normalizeToken(item))
			.filter((item) => item.length > 0);
		return [...new Set(normalized)];
	}

	private matchGlob(globPattern: string, normalizedPath: string, fileName: string): boolean {
		const normalizedGlob = normalizePath(globPattern.trim()).toLowerCase();
		if (!normalizedGlob) return false;
		const regex = this.globToRegex(normalizedGlob);
		if (regex.test(normalizedPath)) {
			return true;
		}
		// Support file-name-only patterns (for example *.md).
		return regex.test(fileName);
	}

	private globToRegex(globPattern: string): RegExp {
		let pattern = globPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		pattern = pattern.replace(/\\\*\\\*/g, "___DOUBLE_STAR___");
		pattern = pattern.replace(/\\\*/g, "[^/]*");
		pattern = pattern.replace(/\\\?/g, ".");
		pattern = pattern.replace(/___DOUBLE_STAR___/g, ".*");
		return new RegExp(`^${pattern}$`, "i");
	}

	private normalizeTag(value: string): string {
		return value.trim().toLowerCase().replace(/^#/, "");
	}

	private normalizeToken(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/^[$/]+/, "")
			.replace(/\.md$/i, "")
			.replace(/\s+/g, "-")
			.replace(/_/g, "-")
			.replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	private isReservedSlashCommand(_commandName: string): boolean {
		return false;
	}

	private normalizeAbsolutePath(inputPath: string): string {
		return path.resolve(inputPath).replace(/\\/g, "/");
	}

	private async safeReadText(filePath: string): Promise<string> {
		try {
			return await fs.readFile(filePath, "utf8");
		} catch {
			return "";
		}
	}

	private truncateText(text: string, maxChars: number): string {
		if (text.length <= maxChars) {
			return text;
		}
		return `${text.slice(0, maxChars)}...`;
	}
}


