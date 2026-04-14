import { ContextAssembler } from "./ContextAssembler";

export interface PromptContextBuildInput {
	mode: string;
	depth: number;
	permissionMode: string;
	runtimeProfileId: string;
	runtimeSupported?: boolean;
	runtimeCapabilities?: {
		supportsExecTool?: boolean;
		supportsExternalRead?: boolean;
		supportsSubagent?: boolean;
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
	enableExecTool?: boolean;
	hardLimit?: number;
}

export interface PromptContextSummary {
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	hasWikiContext: boolean;
	hasMemoryContext: boolean;
	hasAutoSkillContext: boolean;
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
		const lines = [
			"You are F.R.I.D.A.Y Agent Runtime.",
			"You must output strict JSON only. Do not output Markdown.",
			"",
			"Allowed response schema (choose one):",
			'{"type":"response","assistant":"final response for user"}',
			'{"type":"tool_call","assistant":"optional note","tool":{"name":"ls|read|grep|search_text|glob|compile_wiki|write|edit|delete","args":{...}}}',
			'{"type":"subagent","assistant":"optional note","subagent":{"goal":"task goal","model":"optional"}}',
			"",
			"Rules:",
			"- Prefer tool evidence first; do not hallucinate filesystem facts.",
			"- Call at most one tool each step, then reason with TOOL_RESULT.",
			"- When an active project root is available, prefer scoping ls/grep/search_text/glob to that root.",
			"- For ls/grep/search_text/glob, an empty path auto-scopes to the active project root when one is selected.",
			"- Never use '/' or '\\' as the path for Vault discovery tools; use the active project root instead.",
			"- write/delete only supports Vault-relative paths.",
			"- When removing a Vault file or folder, use delete instead of exec or shell builtins like rmdir/rm.",
			"- raw/ is user-curated project input. Never write, edit, or delete files under <projectRoot>/raw/.",
			"- AI-generated drafts, process files, and interim outputs must go under <projectRoot>/workspace/.",
			"- When creating a new project file without an explicit folder, default to <projectRoot>/workspace/.",
			"- If user asks to compile/rebuild Wiki, call compile_wiki tool first.",
			"- If user asks to create/update/save a file, you MUST call write tool to execute it.",
			"- Never say 'I cannot create/write files' when write tool is available.",
			"- If user says '当前文档/这个文档', prioritize current active file path.",
			"- Before final response, ensure conclusions are based on tool results.",
			"",
			"Tool arguments:",
			'- ls: {"path":"optional path","recursive":false,"maxEntries":120}',
			'- read: {"path":"file path","maxChars":10000}',
			'- grep: {"path":"optional directory or file path","pattern":"regex","flags":"i","maxMatches":40}',
			'- search_text: {"path":"optional directory or file path","query":"plain text query","maxMatches":40}',
			'- glob: {"path":"optional directory path","pattern":"*.md","maxMatches":80}',
			'- compile_wiki: {"mode":"all|changed(optional)","path":"optional raw path","paths":["optional raw paths"]}',
			'- write: {"path":"Vault-relative path","content":"full file content","mode":"create|update|upsert"}',
			'- edit: {"path":"Vault-relative path","edits":[{"search":"old text","replace":"new text"}]}',
			'- delete: {"path":"Vault-relative path"}',
			...(input.enableExecTool
				? ['- exec: {"command":"command-name","args":["arg1","arg2"],"cwd":"optional-working-directory"}']
				: []),
			"",
			"--- Few-shot examples ---",
			"User: list files in project root",
			'Assistant: {"type":"tool_call","assistant":"List files in root.","tool":{"name":"ls","args":{"path":"","recursive":false}}}',
			"",
			"User: read notes/project-overview.md",
			'Assistant: {"type":"tool_call","assistant":"Read file.","tool":{"name":"read","args":{"path":"notes/project-overview.md"}}}',
			"",
			'User: create test.md with content "hello"',
			'Assistant: {"type":"tool_call","assistant":"Create file in workspace.","tool":{"name":"write","args":{"path":"workspace/test.md","content":"hello","mode":"create"}}}',
			"--- End examples ---",
			"",
			`Runtime depth: ${input.depth}`,
			`Current active file: ${input.currentFilePath?.trim() || "(none)"}`,
			`Active project root: ${input.activeProjectRoot?.trim() || "(none)"}`,
			`Vault focus paths: ${input.focusPaths?.trim() || "(none)"}`,
			`External read-only paths: ${input.externalPaths?.trim() || "(none)"}`,
			`Runtime profile: ${input.runtimeProfileId} (supported=${input.runtimeSupported ?? true})`,
			`Runtime capabilities: exec=${input.runtimeCapabilities?.supportsExecTool ?? false}, externalRead=${input.runtimeCapabilities?.supportsExternalRead ?? false}, subagent=${input.runtimeCapabilities?.supportsSubagent ?? false}`,
		];

		if (input.fridayMd) {
			lines.push("");
			lines.push("--- Project instructions (FRIDAY.md) ---");
			lines.push(input.fridayMd);
			lines.push("--- End project instructions ---");
		}

		lines.push("");
		lines.push("Current agent.md excerpt:");
		lines.push(input.agentProfile);

		if (trimmedExtra) {
			lines.push("");
			lines.push("Extra runtime context:");
			lines.push(trimmedExtra);
		}

		if (autoSkillContext) {
			lines.push("");
			lines.push(autoSkillContext);
		}

		if (wikiKnowledgeContext) {
			lines.push("");
			lines.push("--- Wiki knowledge context ---");
			lines.push(wikiKnowledgeContext);
			lines.push("--- End wiki knowledge context ---");
		}

		if (memoryContext) {
			lines.push("");
			lines.push("--- Memory context ---");
			lines.push(memoryContext);
			lines.push("--- End memory context ---");
		}

		const assembledContext = this.contextAssembler.assemble({
			userQuery: input.userPrompt ?? "",
			system: input.fridayMd ?? "",
			policy: trimmedExtra,
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
			hasWikiContext: Boolean(wikiKnowledgeContext),
			hasMemoryContext: Boolean(memoryContext),
			hasAutoSkillContext: Boolean(autoSkillContext),
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
}
