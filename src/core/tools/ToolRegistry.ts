import { WIKI_FEATURE_ENABLED, WIKI_TOOL_NAMES } from "../../constants/wikiFeature";
import type { ToolDefinition } from "../../types/tools";

export type AgentMode = "ask" | "research" | "write" | "organize" | "review" | "debug" | "developer";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolCategory = "read" | "write" | "delete" | "system" | "memory" | "skill" | "knowledge";

export interface ToolParameterSchema {
	[key: string]: unknown;
	type: "object";
	properties: Record<string, unknown>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface ToolContract {
	name: string;
	description: string;
	parameters: ToolParameterSchema;
	capability: string;
	handlerName: string;
	readOnly: boolean;
	primary: boolean;
	category: ToolCategory;
	riskLevel: ToolRiskLevel;
	promptArgumentLine: string;
	relatedSkillCommand?: string;
	debugOnly?: boolean;
}

export interface ToolManifestContract {
	name: string;
	capability: string;
	readOnly: boolean;
	primary: boolean;
	relatedSkillCommand?: string;
}

export interface ToolListOptions {
	agentMode?: AgentMode;
	enableExecTool?: boolean;
	disabledTools?: Iterable<string> | null;
	allowedTools?: Iterable<string> | null;
}

const TOOL_CONTRACTS: ToolContract[] = [
	{
		name: "use_skill",
		description: "Load the full instructions for a skill from SkillCatalog before continuing with the task.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", description: "Skill command from SkillCatalog." },
				reason: { type: "string", description: "Why this skill matches the current task." },
			},
			required: ["command"],
			additionalProperties: false,
		},
		capability: "skill.load",
		handlerName: "toolUseSkill",
		readOnly: true,
		primary: true,
		category: "skill",
		riskLevel: "low",
		promptArgumentLine: '- use_skill: {"command":"skill command from SkillCatalog","reason":"why the skill matches the current task"}',
	},
	{
		name: "ls",
		description: "List files and folders in a path. Uses Vault-relative path by default.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Optional path. Relative for Vault; absolute for allowed external path." },
				recursive: { type: "boolean", default: false },
				maxEntries: { type: "number", default: 120 },
			},
			additionalProperties: false,
		},
		capability: "filesystem.list",
		handlerName: "toolList",
		readOnly: true,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- ls: {"path":"optional path","recursive":false,"maxEntries":120}',
	},
	{
		name: "read",
		description: "Read file content from Vault or allowed external path.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "File path." },
				maxChars: { type: "number", default: 10000 },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "filesystem.read",
		handlerName: "toolRead",
		readOnly: true,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- read: {"path":"file path","maxChars":10000}',
	},
	{
		name: "grep",
		description: "Search text pattern in files.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				pattern: { type: "string" },
				flags: { type: "string", default: "i" },
				maxMatches: { type: "number", default: 40 },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		capability: "filesystem.search",
		handlerName: "toolGrep",
		readOnly: true,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- grep: {"path":"optional directory or file path","pattern":"regex","flags":"i","maxMatches":40}',
	},
	{
		name: "search_text",
		description: "Search plain text keywords in files.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				query: { type: "string" },
				maxMatches: { type: "number", default: 40 },
			},
			required: ["query"],
			additionalProperties: false,
		},
		capability: "filesystem.search_text",
		handlerName: "toolSearchText",
		readOnly: true,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- search_text: {"path":"optional directory or file path","query":"plain text query","maxMatches":40}',
	},
	{
		name: "glob",
		description: "Find files by glob pattern.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				pattern: { type: "string" },
				maxMatches: { type: "number", default: 80 },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		capability: "filesystem.glob",
		handlerName: "toolGlob",
		readOnly: true,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- glob: {"path":"optional directory path","pattern":"*.md","maxMatches":80}',
	},
	{
		name: "compile_wiki",
		description: "Compile active project wiki knowledge artifacts.",
		parameters: {
			type: "object",
			properties: {
				rawPaths: {
					type: "array",
					items: { type: "string" },
				},
				forceRebuild: { type: "boolean", default: false },
			},
			additionalProperties: false,
		},
		capability: "knowledge.compile",
		handlerName: "toolCompileWiki",
		readOnly: false,
		primary: true,
		category: "knowledge",
		riskLevel: "medium",
		relatedSkillCommand: "compile-wiki",
		promptArgumentLine: '- compile_wiki: {"rawPaths":["optional/raw/path.md"],"forceRebuild":false}',
	},
	{
		name: "memory",
		description: "Persist a durable fact to global or active-project memory. Writes apply on the next turn, not the current turn.",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["add", "replace", "remove"] },
				scope: { type: "string", enum: ["global", "project"] },
				content: { type: "string" },
				old_text: { type: "string" },
			},
			required: ["action", "scope"],
			additionalProperties: false,
		},
		capability: "memory.write",
		handlerName: "toolMemory",
		readOnly: false,
		primary: true,
		category: "memory",
		riskLevel: "medium",
		promptArgumentLine: '- memory: {"action":"add|replace|remove","scope":"global|project","content":"durable fact","old_text":"existing fragment"}',
	},
	{
		name: "write",
		description: "Create or update a Vault file with full content.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
				mode: { type: "string", enum: ["create", "update", "upsert"] },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
		capability: "filesystem.write",
		handlerName: "toolWrite",
		readOnly: false,
		primary: true,
		category: "write",
		riskLevel: "medium",
		promptArgumentLine: '- write: {"path":"Vault-relative path","content":"full file content","mode":"create|update|upsert"}',
	},
	{
		name: "edit",
		description: "Apply targeted search/replace edits to a Vault file.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				edits: {
					type: "array",
					items: {
						type: "object",
						properties: {
							search: { type: "string" },
							replace: { type: "string" },
							description: { type: "string" },
						},
						required: ["search", "replace"],
						additionalProperties: false,
					},
				},
			},
			required: ["path", "edits"],
			additionalProperties: false,
		},
		capability: "filesystem.patch",
		handlerName: "toolEdit",
		readOnly: false,
		primary: true,
		category: "write",
		riskLevel: "medium",
		promptArgumentLine: '- edit: {"path":"Vault-relative path","edits":[{"search":"old text","replace":"new text"}]}',
	},
	{
		name: "delete",
		description: "Delete a Vault file or folder.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "filesystem.delete",
		handlerName: "toolDelete",
		readOnly: false,
		primary: false,
		category: "delete",
		riskLevel: "high",
		promptArgumentLine: '- delete: {"path":"Vault-relative path"}',
	},
	{
		name: "exec",
		description: "Run a debug-profile command with allowlist/approval restrictions.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string" },
				args: {
					type: "array",
					items: { type: "string" },
				},
				cwd: { type: "string" },
			},
			required: ["command"],
			additionalProperties: false,
		},
		capability: "system.exec",
		handlerName: "toolExec",
		readOnly: false,
		primary: false,
		category: "system",
		riskLevel: "high",
		debugOnly: true,
		promptArgumentLine: '- exec: {"command":"command-name","args":["arg1","arg2"],"cwd":"optional-working-directory"}',
	},
];

export class ToolRegistry {
	private static instance: ToolRegistry | null = null;
	private readonly tools: ToolContract[];

	private constructor() {
		this.tools = TOOL_CONTRACTS;
	}

	static getInstance(): ToolRegistry {
		if (!this.instance) {
			this.instance = new ToolRegistry();
		}
		return this.instance;
	}

	get(name: string): ToolContract | null {
		const normalized = normalizeToolName(name);
		return this.list().find((tool) => tool.name === normalized) ?? null;
	}

	list(): ToolContract[] {
		return this.tools
			.filter((tool) => WIKI_FEATURE_ENABLED || !WIKI_TOOL_NAMES.has(tool.name))
			.map((tool) => cloneToolContract(tool));
	}

	listForAgentMode(agentMode: AgentMode, options: Omit<ToolListOptions, "agentMode"> = {}): ToolContract[] {
		return this.listTools({ ...options, agentMode });
	}

	listTools(options: ToolListOptions = {}): ToolContract[] {
		const agentMode = options.agentMode ?? "ask";
		const disabledTools = normalizeSet(options.disabledTools);
		const allowedTools = normalizeSet(options.allowedTools);
		return this.list().filter((tool) => {
			if (disabledTools.has(tool.name)) {
				return false;
			}
			if (allowedTools.size > 0 && !allowedTools.has(tool.name)) {
				return false;
			}
			if (tool.debugOnly) {
				return Boolean(options.enableExecTool) && (agentMode === "debug" || agentMode === "developer");
			}
			return true;
		});
	}

	buildNativeToolDefinitions(options: ToolListOptions = {}): ToolDefinition[] {
		return this.listTools(options).map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: cloneParameters(tool.parameters),
		}));
	}

	buildPromptToolNameUnion(options: ToolListOptions = {}): string {
		return this.listTools(options).map((tool) => tool.name).join("|");
	}

	buildPromptToolArgumentLines(options: ToolListOptions = {}): string[] {
		return this.listTools(options).map((tool) => tool.promptArgumentLine);
	}

	listManifests(): ToolManifestContract[] {
		return this.list()
			.filter((tool) => tool.name !== "use_skill")
			.map((tool) => ({
				name: tool.name,
				capability: tool.capability,
				readOnly: tool.readOnly,
				primary: tool.primary,
				...(tool.relatedSkillCommand ? { relatedSkillCommand: tool.relatedSkillCommand } : {}),
			}));
	}
}

export function buildNativeToolDefinitionsFromRegistry(options: ToolListOptions = {}): ToolDefinition[] {
	return ToolRegistry.getInstance().buildNativeToolDefinitions(options);
}

export function buildPromptToolNameUnionFromRegistry(options: ToolListOptions = {}): string {
	return ToolRegistry.getInstance().buildPromptToolNameUnion(options);
}

export function buildPromptToolArgumentLinesFromRegistry(options: ToolListOptions = {}): string[] {
	return ToolRegistry.getInstance().buildPromptToolArgumentLines(options);
}

function normalizeToolName(name: string): string {
	return name.trim().toLowerCase();
}

function normalizeSet(values: Iterable<string> | null | undefined): Set<string> {
	const normalized = new Set<string>();
	if (!values) {
		return normalized;
	}
	for (const value of values) {
		const item = normalizeToolName(value);
		if (item) {
			normalized.add(item);
		}
	}
	return normalized;
}

function cloneToolContract(tool: ToolContract): ToolContract {
	return {
		...tool,
		parameters: cloneParameters(tool.parameters),
	};
}

function cloneParameters(parameters: ToolParameterSchema): ToolParameterSchema {
	return {
		...parameters,
		properties: { ...parameters.properties },
		required: parameters.required ? [...parameters.required] : undefined,
	};
}
