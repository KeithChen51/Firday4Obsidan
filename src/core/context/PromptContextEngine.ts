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
	currentFilePath?: string;
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
			`{"type":"tool_call","assistant":"optional note","tool":{"name":"${toolNameUnion}","args":{...}}}`,
			"",
			"Rules:",
			"- Prefer tool evidence first; do not hallucinate filesystem facts.",
			"- Call at most one tool each step, then reason with TOOL_RESULT.",
			"- SkillCatalog is summary-only metadata. If a skill clearly helps, call use_skill first to load its full instructions.",
			"- use_skill only loads skill instructions; after TOOL_RESULT from use_skill, continue execution with the loaded skill context.",
			"- Use memory only for durable facts that should survive future turns.",
			"- File tools accept project-relative paths and canonical vault paths.",
			"- The tool layer normalizes project-relative paths under the active project when one is selected.",
			"- Example: workspace/test.md and <projectRoot>/workspace/test.md normalize to the same canonical vault path: <projectRoot>/workspace/test.md.",
			"- For ls/grep/search_text/glob, omit path or use an empty path to search the active project when one is selected.",
			"- If a TOOL_RESULT failure includes recovery.suggestedArgs, use those suggested args on the next attempt instead of repeating the failed path.",
			"- When removing a Vault file or folder, use delete instead of exec or shell builtins like rmdir/rm.",
			"- raw/ is user-curated project input. Never write, edit, or delete files under <projectRoot>/raw/.",
			"- AI-generated drafts, process files, and interim outputs must go under <projectRoot>/workspace/.",
			"- When creating a new project file without an explicit folder, default to <projectRoot>/workspace/.",
			"- If user asks to create/update/save a file, you MUST call write tool to execute it.",
			"- Never say 'I cannot create/write files' when write tool is available.",
			"- If user refers to the current or active document, prioritize current active file path.",
			"- Before final response, ensure conclusions are based on tool results.",
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
			"User: create a structured canvas",
			'Assistant: {"type":"tool_call","assistant":"Load the most relevant skill before continuing.","tool":{"name":"use_skill","args":{"command":"json-canvas","reason":"The user explicitly wants a structured canvas."}}}',
			"",
			'User: create a test note with content "hello"',
			'Assistant: {"type":"tool_call","assistant":"Create file in workspace.","tool":{"name":"write","args":{"path":"workspace/test.md","content":"hello","mode":"create"}}}',
			"",
			'User: create the same test note with its canonical project path',
			'Assistant: {"type":"tool_call","assistant":"Create file using the canonical project path.","tool":{"name":"write","args":{"path":"<projectRoot>/workspace/test.md","content":"hello","mode":"create"}}}',
			"--- End examples ---",
			"",
			`Runtime depth: ${input.depth}`,
			`Current active file: ${input.currentFilePath?.trim() || "(none)"}`,
			`Active project root: ${input.activeProjectRoot?.trim() || "(none)"}`,
			`Vault focus paths: ${input.focusPaths?.trim() || "(none)"}`,
			`External read-only paths: ${input.externalPaths?.trim() || "(none)"}`,
			`Runtime profile: ${input.runtimeProfileId} (supported=${input.runtimeSupported ?? true})`,
			`Runtime capabilities: exec=${input.runtimeCapabilities?.supportsExecTool ?? false}, externalRead=${input.runtimeCapabilities?.supportsExternalRead ?? false}`,
		];

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
