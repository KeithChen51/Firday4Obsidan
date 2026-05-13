import { ContextAssembler } from "./ContextAssembler";
import type {
	MentionResolvedEntry,
	MentionSourceMapEntry,
	MentionTokenType,
} from "./mention/MentionResolver";
import {
	buildPromptToolArgumentLinesFromRegistry,
	buildPromptToolNameUnionFromRegistry,
	type AgentMode,
} from "../tools/ToolRegistry";
import {
	normalizeActiveFileContext,
	type ActiveFileContext,
} from "./ActiveFileContext";

export interface PromptMentionContext {
	resolvedCount: number;
	tokenTypes: MentionTokenType[];
	sourceMap: MentionSourceMapEntry[];
	entries: MentionResolvedEntry[];
}

export interface PromptContextBuildInput {
	mode: string;
	depth: number;
	permissionMode: string;
	runtimeProfileId: string;
	runtimeSupported?: boolean;
	runtimeCapabilities?: {
		supportsExecTool?: boolean;
		supportsExternalRead?: boolean;
	};
	focusPaths?: string;
	externalPaths?: string;
	activeFileContext?: ActiveFileContext;
	activeProjectRoot?: string;
	userPrompt: string;
	fridayMd?: string | null;
	agentProfile: string;
	extraSystemContext?: string;
	autoSkillContext?: string;
	wikiKnowledgeContext?: string;
	memoryContext?: string;
	mentionContext?: PromptMentionContext;
	enableExecTool?: boolean;
	agentMode?: AgentMode;
	hardLimit?: number;
}

export interface PromptContextSummary {
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	overflowChannels: string[];
	hasWikiContext: boolean;
	hasMemoryContext: boolean;
	hasAutoSkillContext: boolean;
	hasMentionContext: boolean;
	mentionResolvedCount: number;
	mentionTokenTypes: MentionTokenType[];
	mentionSourceMap: MentionSourceMapEntry[];
	activeFileContext?: ActiveFileContext;
}

export interface PromptContextBuildResult {
	prompt: string;
	summary: PromptContextSummary;
}

export class PromptContextEngine {
	private readonly contextAssembler = new ContextAssembler();

	build(input: PromptContextBuildInput): PromptContextBuildResult {
		const trimmedExtra = input.extraSystemContext?.trim() ?? "";
		const autoSkillContext = input.autoSkillContext?.trim() ?? "";
		const wikiKnowledgeContext = input.wikiKnowledgeContext?.trim() ?? "";
		const memoryContext = input.memoryContext?.trim() ?? "";
		const mentionContextText = this.formatMentionContext(input.mentionContext);
		const activeFileContext = normalizeActiveFileContext(input.activeFileContext);
		const toolListOptions = {
			agentMode: input.agentMode ?? "ask",
			enableExecTool: input.enableExecTool ?? false,
		};
		const toolNameUnion = buildPromptToolNameUnionFromRegistry(toolListOptions);
		const toolArgumentLines = buildPromptToolArgumentLinesFromRegistry(toolListOptions);
		const lines = [
			"You are FRIDAY Agent Runtime.",
			"You must output strict JSON only. Do not output Markdown.",
			"",
			"Allowed response schema (choose one):",
			'{"type":"response","assistant":"final response for user"}',
			`{"type":"tool_call","assistant":"optional note","intake":{"interactionRoute":"direct_answer|clarify|light_task|task_with_process","statement":"first-person understanding","shouldShowProcess":true,"shouldUseVisiblePlan":true},"tool":{"name":"${toolNameUnion}","args":{...}}}`,
			'{"type":"response","assistant":"final response for user","intake":{"interactionRoute":"direct_answer|clarify|light_task|task_with_process","statement":"first-person understanding"}}',
			'Legacy compatibility only: {"plan":{"type":"plan_create"}}',
			"",
			"Rules:",
			"- Prefer model-authored intake with interactionRoute for the first response in a turn.",
			"- direct_answer: no visible process, no visible plan, direct answer only.",
			"- clarify: ask one necessary question. Do not create a multi-step plan.",
			"- light_task: may show lightweight running status, but do not create a heavy visible plan unless truly needed.",
			"- task_with_process: use plan_write first for concrete visible Task Bar steps.",
			"- For complex work, call plan_write before file tools; native mode may batch plan_write with read-only calls.",
			"- plan_write task status must be one of pending, in_progress, completed, skipped, failed, or blocked.",
			"- Legacy JSON envelope plan_create is accepted only for compatibility; prefer plan_write.",
			'- Use {"status":"blocked"} for unsafe or user-forbidden plan tasks.',
			"- Read-only requests cannot invent mutation tasks. Treat explicit read-only/no modifications/no changes/只读/不要修改 requests as analysis-only unless the user later asks for changes.",
			"- Prefer tool evidence first; do not hallucinate filesystem facts.",
			"- In native tool mode, you may return plan_write plus multiple read-only, concurrency-safe tool calls in one step; runtime applies plan_write first and preserves tool result order.",
			"- Prefer composite read-only tools when they reduce loops: project_tree for an overview, read_many for related files, and search_and_read for search plus snippets.",
			"- SkillCatalog is summary-only metadata. If a skill clearly helps, call use_skill first to load its full instructions.",
			"- use_skill only loads skill instructions; after TOOL_RESULT from use_skill, continue execution with the loaded skill context.",
			"- Use memory only for durable facts that should survive future turns.",
			"- File tools accept project-relative paths and canonical vault paths.",
			"- The tool layer normalizes project-relative paths under the active project when one is selected.",
			"- Example: workspace/test.md and <projectRoot>/workspace/test.md normalize to the same canonical vault path: <projectRoot>/workspace/test.md.",
			"- For ls/grep/search_text/glob, omit path or use an empty path to search the active project when one is selected.",
			"- If a TOOL_RESULT failure includes recovery.suggestedArgs, use those suggested args on the next attempt instead of repeating the failed path.",
			"- raw/ is user-curated project input. Never write, edit, or delete files under <projectRoot>/raw/.",
			"- AI-generated drafts, process files, and interim outputs must go under <projectRoot>/workspace/.",
			"- When creating a new project file without an explicit folder, default to <projectRoot>/workspace/.",
			"- If user asks to create/update/save a file, you MUST call write tool to execute it.",
			"- Never say 'I cannot create/write files' when write tool is available.",
			"- Only treat the active editor file as a task target when Active file context is present below.",
			"- When Active file context is present, prioritize the supplied active file path.",
			"- For deictic active-file references, use the active file path as the target and call read before using file contents.",
			"- Before final response, ensure conclusions are based on tool results.",
			"- Put short user-visible progress notes in tool_call.assistant, for example what you understood and what you will do next.",
			"- Keep final response concise; do not repeat progress notes in the final answer.",
			"",
			"Tool arguments:",
			...toolArgumentLines,
			"",
			"--- Few-shot examples ---",
			"User: list files in project root",
			'Assistant: {"type":"tool_call","assistant":"List files in root.","tool":{"name":"ls","args":{"path":"","recursive":false}}}',
			"",
			"User: read workspace/test.md",
			'Assistant: {"type":"tool_call","assistant":"Read file.","tool":{"name":"read","args":{"path":"workspace/test.md"}}}',
			"",
			"User: inspect related files before answering",
			'Assistant: {"type":"tool_call","assistant":"Read the related files together.","tool":{"name":"read_many","args":{"paths":["workspace/a.md","workspace/b.md"],"maxFiles":8,"maxCharsPerFile":6000}}}',
			"",
			"User: where is the parser state handled?",
			'Assistant: {"type":"tool_call","assistant":"Search and collect snippets from likely matches.","tool":{"name":"search_and_read","args":{"path":"workspace","query":"parser state","mode":"text","maxMatches":20,"maxCharsPerMatch":800}}}',
			"",
			"User: what is inside this project?",
			'Assistant: {"type":"tool_call","assistant":"Map the active project tree first.","tool":{"name":"project_tree","args":{"path":"","maxDepth":3,"maxEntries":160}}}',
			"",
			"User: read every workspace file and create a whiteboard showing relationships",
			'Assistant: {"type":"tool_call","assistant":"Create visible Task Bar steps first.","intake":{"interactionRoute":"task_with_process","statement":"I will read the workspace, extract relationships, and create a canvas.","shouldShowProcess":true,"shouldUseVisiblePlan":true},"tool":{"name":"plan_write","args":{"visibility":"task_bar","reason":"Create a relationship whiteboard.","tasks":[{"id":"map","title":"Map workspace files","status":"in_progress"},{"id":"read","title":"Read relevant files","status":"pending"},{"id":"relate","title":"Extract file relationships","status":"pending"},{"id":"canvas","title":"Create the canvas","status":"pending"},{"id":"verify","title":"Verify the canvas output","status":"pending"}]}}}',
			"",
			"User: TOOL_RESULT failed with recovery.suggestedArgs",
			'Assistant: {"type":"tool_call","assistant":"Retry with the suggested normalized path.","tool":{"name":"read","args":{"path":"<projectRoot>/workspace/test.md"}}}',
			"",
			"User: create a structured canvas",
			'Assistant: {"type":"tool_call","assistant":"Load the most relevant skill before continuing.","tool":{"name":"use_skill","args":{"command":"json-canvas","reason":"The user explicitly wants a structured canvas."}}}',
			"",
			'User: create a test note with content "hello"',
			'Assistant: {"type":"tool_call","assistant":"Create file in workspace.","tool":{"name":"write","args":{"path":"workspace/test.md","content":"hello","mode":"create"}}}',
			'Assistant canonical path example: {"type":"tool_call","tool":{"name":"write","args":{"path":"<projectRoot>/workspace/test.md","content":"hello","mode":"create"}}}',
			"--- End examples ---",
			"",
			`Runtime depth: ${input.depth}`,
			`Active project root: ${input.activeProjectRoot?.trim() || "(none)"}`,
			`Vault focus paths: ${input.focusPaths?.trim() || "(none)"}`,
			`External read-only paths: ${input.externalPaths?.trim() || "(none)"}`,
			`Runtime profile: ${input.runtimeProfileId} (supported=${input.runtimeSupported ?? true})`,
			`Runtime capabilities: externalRead=${input.runtimeCapabilities?.supportsExternalRead ?? false}`,
		];
		if (activeFileContext.mode !== "none") {
			lines.push(`Current active file: ${activeFileContext.path}`);
			lines.push(`Active file context mode: ${activeFileContext.mode}`);
			lines.push(`Active file context reason: ${activeFileContext.reason}`);
			lines.push(
				activeFileContext.includeContent
					? "Active file content: included through explicit mention context when available."
					: "Active file content: not included; call read before using contents.",
			);
		}

		lines.push("");
		lines.push("Current agent.md excerpt:");
		lines.push(input.agentProfile);

		const assembledContext = this.contextAssembler.assemble({
			userQuery: input.userPrompt ?? "",
			system: input.fridayMd ?? "",
			policy: trimmedExtra,
			mentions: mentionContextText ? `Mention context\n${mentionContextText}` : "",
			history: memoryContext,
			secondaryContext: autoSkillContext,
			attachments: wikiKnowledgeContext,
			hardLimit: input.hardLimit ?? 1600,
		});
		const summary: PromptContextSummary = {
			used: assembledContext.used,
			softLimit: assembledContext.softLimit,
			hardLimit: assembledContext.hardLimit,
			trimmedChannels: [...assembledContext.trimmedChannels],
			overflowChannels: [...assembledContext.overflowChannels],
			hasWikiContext: Boolean(wikiKnowledgeContext),
			hasMemoryContext: Boolean(memoryContext),
			hasAutoSkillContext: Boolean(autoSkillContext),
			hasMentionContext: Boolean(input.mentionContext?.entries?.length),
			mentionResolvedCount: input.mentionContext?.resolvedCount ?? 0,
			mentionTokenTypes: [...new Set(input.mentionContext?.tokenTypes ?? [])].sort(),
			mentionSourceMap: [...(input.mentionContext?.sourceMap ?? [])],
			activeFileContext,
		};

		if (assembledContext.text) {
			lines.push("");
			lines.push("--- Compact context package ---");
			lines.push(assembledContext.text);
			lines.push(
				`Context budget: used=${assembledContext.used}, soft=${assembledContext.softLimit}, hard=${assembledContext.hardLimit}, trimmed=${assembledContext.trimmedChannels.join(",") || "none"}`,
			);
			lines.push("--- End compact context package ---");
		}

		return {
			prompt: lines.join("\n"),
			summary,
		};
	}

	private formatMentionContext(mentionContext?: PromptMentionContext): string {
		if (!mentionContext || mentionContext.entries.length === 0) {
			return "";
		}
		const lines: string[] = [];
		for (const entry of mentionContext.entries) {
			lines.push(`[${entry.channel}] ${entry.title}`);
			lines.push(`token=${entry.tokenId} type=${entry.tokenType} target=${entry.target}`);
			lines.push(entry.body);
			lines.push("");
		}
		return lines.join("\n").trim();
	}
}
