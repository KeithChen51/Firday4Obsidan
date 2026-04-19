export interface BuiltinSkillReviewNote {
	command: string;
	version: string;
	title: string;
	titleZh: string;
	original: string;
	originalZh: string;
	issues: string[];
	issuesZh: string[];
	changes: string[];
	changesZh: string[];
}

export interface ResolvedBuiltinSkillReviewNote {
	command: string;
	version: string;
	title: string;
	original: string;
	issues: string[];
	changes: string[];
}

export const BUILTIN_SKILL_REVIEW_NOTES: BuiltinSkillReviewNote[] = [
	{
		command: "obsidian-cli",
		version: "0.2.5",
		title: "CLI guidance refresh",
		titleZh: "CLI 指南修订",
		original: "The original skill assumed Obsidian had to be open, jumped straight to `obsidian help`, and did not explain Windows registration details.",
		originalZh: "原版 skill 默认 Obsidian 必须已经打开，直接从 `obsidian help` 开始，也没有解释 Windows 下的 CLI 注册细节。",
		issues: [
			"It skipped shell-local preflight and often misdiagnosed PATH problems.",
			"It did not explain the `Obsidian.com` redirector or stale installer cases on Windows.",
			"It still showed the stale `silent` flag in examples.",
		],
		issuesZh: [
			"它跳过了当前 shell 的预检，容易把 PATH 问题误诊成 CLI 本身不可用。",
			"它没有解释 Windows 下的 `Obsidian.com` redirector 和旧安装器场景。",
			"它还在示例里保留了已经过时的 `silent` 标志。",
		],
		changes: [
			"Added `where obsidian`, `obsidian version`, and `obsidian eval` as shell-local preflight.",
			"Added Windows fallback guidance for `Obsidian.com`, installer version, and shell restart.",
			"Removed stale examples and reframed the skill around reliable live-vault diagnostics.",
		],
		changesZh: [
			"补充了 `where obsidian`、`obsidian version`、`obsidian eval` 这组三段式 shell 预检。",
			"补充了 `Obsidian.com`、安装器版本和 shell 重开的 Windows 排查说明。",
			"删除了过时示例，并把 skill 重新定位成可靠的 live vault 诊断入口。",
		],
	},
	{
		command: "obsidian-markdown",
		version: "0.2.5",
		title: "Markdown editing guardrails",
		titleZh: "Markdown 编辑护栏",
		original: "The original skill treated wikilinks as the only acceptable internal-link style and used very broad aliases such as `markdown` and `frontmatter`.",
		originalZh: "原版 skill 把 wikilink 写成唯一正确的内部链接风格，而且使用了 `markdown`、`frontmatter` 这类过宽 alias。",
		issues: [
			"It encouraged unnecessary rewrites of notes that already used Markdown-style internal links.",
			"It could over-trigger on ordinary Markdown tasks that were not really Obsidian-specific.",
			"It taught syntax, but did not explain how to avoid over-editing existing notes.",
		],
		issuesZh: [
			"它会驱动 agent 去重写本来就合法的 Markdown 风格内部链接。",
			"它容易误伤普通 Markdown 任务，而这些任务并不一定需要 Obsidian 专用 skill。",
			"它主要在教语法，但没有明确告诉 agent 如何避免过度改动已有笔记。",
		],
		changes: [
			"Reframed wikilinks as the default preference, not the only valid internal-link format.",
			"Narrowed aliases and metadata so the skill triggers on Obsidian-specific tasks more precisely.",
			"Added editing guardrails about preserving note structure, link style, and existing refs.",
		],
		changesZh: [
			"把 wikilink 从“唯一正确”改成“新笔记默认优先”的建议，而不是硬规则。",
			"收窄了 alias 和元数据，让它更聚焦在真正的 Obsidian 专用任务上。",
			"新增编辑护栏，强调保留现有结构、链接风格和已有引用。",
		],
	},
	{
		command: "json-canvas",
		version: "0.2.5",
		title: "JSON Canvas spec correction",
		titleZh: "JSON Canvas 规范纠偏",
		original: "The original skill described canvas editing only at a toy-example level and invented a fixed 16-character lowercase hex ID rule.",
		originalZh: "原版 skill 只覆盖了 demo 级别的画布编辑，并且虚构了“16 位小写 hex ID”这条规则。",
		issues: [
			"The fixed ID rule does not match the JSON Canvas spec and could make agents rewrite valid files incorrectly.",
			"It mixed hard validity rules with soft layout preferences.",
			"It did not teach safe editing of existing canvases or preservation of unknown fields.",
		],
		issuesZh: [
			"这条固定 ID 规则不符合 JSON Canvas 规范，会导致 agent 错误重写合法文件。",
			"它把硬约束和布局建议混在一起，不利于 agent 判断哪些必须满足。",
			"它没有覆盖已有 canvas 的安全编辑流程，也没有强调保留未知字段。",
		],
		changes: [
			"Replaced the fake fixed-ID rule with spec-valid `unique strings` guidance.",
			"Split required validity rules from layout/readability suggestions.",
			"Added preservation guidance for existing IDs, unknown fields, edge enums, and z-order-sensitive node order.",
		],
		changesZh: [
			"把错误的固定 ID 规则改成符合规范的“唯一字符串”约束。",
			"把必需的合法性规则和布局可读性建议拆开。",
			"补充了保留现有 ID、未知字段、edge 枚举值和与 z-order 相关的 node 顺序说明。",
		],
	},
	{
		command: "obsidian-bases",
		version: "0.2.5",
		title: "Bases workflow deepening",
		titleZh: "Bases 工作流补强",
		original: "The original skill mostly showed a YAML sketch of a `.base` file, but did not teach a realistic edit workflow.",
		originalZh: "原版 skill 基本只是展示 `.base` 文件的大致 YAML 形状，没有形成真实可执行的编辑工作流。",
		issues: [
			"It was fine for tiny examples, but weak for maintaining existing Bases configs.",
			"It did not explain standalone `.base` files versus embedded `base` blocks.",
			"It lacked explicit steps for validating formula and property references before renaming or editing.",
		],
		issuesZh: [
			"它适合生成很小的例子，但不足以维护真实存在的 Bases 配置。",
			"它没有解释独立 `.base` 文件和嵌入式 `base` 代码块的差异。",
			"它缺少公式引用和属性引用的显式校验步骤。",
		],
		changes: [
			"Expanded the scope to cover standalone `.base` files and embedded `base` blocks.",
			"Added a concrete editing workflow: parse YAML, identify sections, validate references, then edit minimally.",
			"Added guardrails for preserving unrelated sections and keeping embedded fences intact.",
		],
		changesZh: [
			"把适用范围扩展到独立 `.base` 文件和嵌入式 `base` 代码块两种形态。",
			"补充了完整编辑流程：先 parse YAML，再识别 section，再校验引用，最后做最小修改。",
			"增加了保留无关 section 和保留嵌入代码块 fence 的编辑护栏。",
		],
	},
];

export function resolveBuiltinSkillReviewNote(command: string, locale: string): ResolvedBuiltinSkillReviewNote | null {
	const normalized = command.trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	const note = BUILTIN_SKILL_REVIEW_NOTES.find((item) => item.command === normalized);
	if (!note) {
		return null;
	}
	const useZh = locale.toLowerCase().startsWith("zh");
	return {
		command: note.command,
		version: note.version,
		title: useZh ? note.titleZh : note.title,
		original: useZh ? note.originalZh : note.original,
		issues: useZh ? [...note.issuesZh] : [...note.issues],
		changes: useZh ? [...note.changesZh] : [...note.changes],
	};
}
