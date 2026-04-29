import {
	BUILTIN_COMPILE_WIKI_MARKDOWN,
	BUILTIN_JSON_CANVAS_MARKDOWN,
	BUILTIN_LOOKUP_WIKI_MARKDOWN,
	BUILTIN_OBSIDIAN_BASES_MARKDOWN,
	BUILTIN_OBSIDIAN_CLI_MARKDOWN,
	BUILTIN_OBSIDIAN_MARKDOWN_MARKDOWN,
	BUILTIN_RESOLVE_CONFLICT_MARKDOWN,
} from "./markdown";
import { WIKI_FEATURE_ENABLED, WIKI_SKILL_COMMANDS } from "../../../constants/wikiFeature";

export type BuiltinSkillTriggerMode = "auto" | "manual";

export interface BuiltinSkillDefinition {
	name: string;
	description: string;
	descriptionZh: string;
	command: string;
	aliases: string[];
	tags: string[];
	globs: string[];
	trigger: BuiltinSkillTriggerMode;
	filePath: string;
	markdown: string;
}

export const BUILTIN_SKILL_SCHEME = "builtin://";

const ALL_BUILTIN_SKILL_DEFINITIONS: BuiltinSkillDefinition[] = [
	{
		name: "Compile Wiki",
		description: "Compile active project raw files into wiki knowledge docs and index outputs.",
		descriptionZh: "把当前项目的 raw 内容编译成 wiki 知识页、索引和输出产物。",
		command: "compile-wiki",
		aliases: ["compile-wiki", "wiki-compile", "compile", "build-wiki", "sync-wiki", "compilewiki", "wikicompile", "编译", "编译wiki", "重建wiki", "知识库编译"],
		tags: ["knowledge", "wiki", "ingest", "编译", "知识库", "索引重建"],
		globs: ["**/raw/**", "**/wiki/**"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}compile-wiki/SKILL.md`,
		markdown: BUILTIN_COMPILE_WIKI_MARKDOWN,
	},
	{
		name: "Lookup Wiki",
		description: "Run Brain-First four-step lookup fallback for project knowledge retrieval.",
		descriptionZh: "执行 Brain-First 四步检索回退流程，为项目知识查询提供结果。",
		command: "lookup-wiki",
		aliases: ["lookup-wiki", "lookup", "search-wiki", "find-wiki"],
		tags: ["knowledge", "search", "retrieve"],
		globs: ["**/wiki/**", "**/raw/**"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}lookup-wiki/SKILL.md`,
		markdown: BUILTIN_LOOKUP_WIKI_MARKDOWN,
	},
	{
		name: "Resolve Conflict",
		description: "Generate fix proposals for sync/edit conflicts and submit to user approval.",
		descriptionZh: "为同步或编辑冲突生成修复提案，并提交给用户审批。",
		command: "resolve-conflict",
		aliases: ["resolve-conflict", "resolve", "fix-conflict", "merge"],
		tags: ["collaboration", "git", "merge", "conflict"],
		globs: ["**/*"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}resolve-conflict/SKILL.md`,
		markdown: BUILTIN_RESOLVE_CONFLICT_MARKDOWN,
	},
	{
		name: "Obsidian CLI",
		description: "Operate a live Obsidian vault and debug plugins/themes via the Obsidian CLI.",
		descriptionZh: "操作正在运行的 Obsidian Vault，并通过 Obsidian CLI 调试插件与主题。",
		command: "obsidian-cli",
		aliases: ["obsidian-cli", "obsidian", "vault-cli", "plugin-dev", "obsidian-dev", "插件调试", "调试插件", "调试obsidian"],
		tags: ["obsidian", "vault", "cli", "plugin", "debug", "插件", "调试"],
		globs: ["**/.obsidian/**", "**/manifest.json", "**/main.js", "**/styles.css", "**/*.md"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}obsidian-cli/SKILL.md`,
		markdown: BUILTIN_OBSIDIAN_CLI_MARKDOWN,
	},
	{
		name: "Obsidian Markdown",
		description: "Create and edit Obsidian Flavored Markdown with wikilinks, Markdown-style internal links, embeds, callouts, note properties, and safe editing rules for existing notes.",
		descriptionZh: "创建和编辑 Obsidian 风格 Markdown，支持双链、callout、嵌入和 frontmatter。",
		command: "obsidian-markdown",
		aliases: ["obsidian-markdown", "obsidian-note", "wikilink", "callout", "note-properties"],
		tags: ["obsidian", "notes", "wikilink", "callout", "embeds", "properties"],
		globs: ["**/*.md"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}obsidian-markdown/SKILL.md`,
		markdown: BUILTIN_OBSIDIAN_MARKDOWN_MARKDOWN,
	},
	{
		name: "JSON Canvas",
		description: "Create and edit Obsidian .canvas files with spec-valid nodes, edges, groups, labels, colors, and safe editing of existing canvas graphs.",
		descriptionZh: "创建和编辑 Obsidian .canvas 文件，支持节点、连线、分组和布局校验。",
		command: "json-canvas",
		aliases: ["json-canvas", "canvas", "obsidian-canvas", "whiteboard", "board", "diagram", "白板", "构建白板", "白板图", "结构图", "脑图", "关系图", "画布"],
		tags: ["obsidian", "canvas", "graph", "layout", "whiteboard", "diagram", "白板", "画布", "结构图"],
		globs: ["**/*.canvas"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}json-canvas/SKILL.md`,
		markdown: BUILTIN_JSON_CANVAS_MARKDOWN,
	},
	{
		name: "Obsidian Bases",
		description: "Create and edit Obsidian Bases configurations in .base files or embedded base code blocks with filters, formulas, properties, summaries, and views.",
		descriptionZh: "创建和编辑 Obsidian .base 文件，支持 YAML schema、筛选、公式和视图。",
		command: "obsidian-bases",
		aliases: ["obsidian-bases", "bases", "obsidian-base", "database-view"],
		tags: ["obsidian", "bases", "yaml", "database", "views"],
		globs: ["**/*.base"],
		trigger: "auto" as BuiltinSkillTriggerMode,
		filePath: `${BUILTIN_SKILL_SCHEME}obsidian-bases/SKILL.md`,
		markdown: BUILTIN_OBSIDIAN_BASES_MARKDOWN,
	},
];

export const BUILTIN_SKILL_DEFINITIONS: BuiltinSkillDefinition[] = ALL_BUILTIN_SKILL_DEFINITIONS.filter(
	(skill) => WIKI_FEATURE_ENABLED || !WIKI_SKILL_COMMANDS.has(skill.command),
);

function normalizeToken(value: string): string {
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

export function resolveBuiltinSkill(raw: string): BuiltinSkillDefinition | null {
	const token = normalizeToken(raw);
	if (!token) {
		return null;
	}

	for (const skill of BUILTIN_SKILL_DEFINITIONS) {
		if (normalizeToken(skill.command) === token) {
			return skill;
		}
		if (normalizeToken(skill.filePath) === token) {
			return skill;
		}
		if (skill.aliases.some((alias) => normalizeToken(alias) === token)) {
			return skill;
		}
	}

	return null;
}

export function getBuiltinSkillMarkdown(raw: string): string | null {
	return resolveBuiltinSkill(raw)?.markdown ?? null;
}
