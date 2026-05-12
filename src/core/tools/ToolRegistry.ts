import { WIKI_FEATURE_ENABLED, WIKI_TOOL_NAMES } from "../../constants/wikiFeature";
import type { ToolDefinition } from "../../types/tools";

export type AgentMode = "ask" | "research" | "write" | "organize" | "review" | "debug" | "developer";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolCategory = "read" | "write" | "delete" | "system" | "memory" | "skill" | "knowledge";
export type ToolResultKind =
	| "skill"
	| "listing"
	| "document"
	| "search_results"
	| "knowledge"
	| "memory"
	| "mutation"
	| "command";

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
	concurrencySafe: boolean;
	idempotent: boolean;
	cacheable: boolean;
	mutatesVault: boolean;
	mutatesExternal: boolean;
	resultKind: ToolResultKind;
	outputBudget: number;
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
	concurrencySafe: boolean;
	idempotent: boolean;
	cacheable: boolean;
	mutatesVault: boolean;
	mutatesExternal: boolean;
	resultKind: ToolResultKind;
	outputBudget: number;
	primary: boolean;
	relatedSkillCommand?: string;
}

export interface ToolListOptions {
	agentMode?: AgentMode;
	enableExecTool?: boolean;
	disabledTools?: Iterable<string> | null;
	allowedTools?: Iterable<string> | null;
}

const DISCOVERY_PATH_DESCRIPTION =
	"Optional project-relative path or canonical vault path. Empty or omitted path uses the active project root when one is selected. Allowed external absolute paths may be read when supported.";
const READ_PATH_DESCRIPTION =
	"Project-relative path or canonical vault path. Allowed external absolute paths may be read when supported.";
const WRITE_PATH_DESCRIPTION =
	"Project-relative path or canonical vault path. Relative file names are normalized into the active project workspace when one is selected.";
const DELETE_PATH_DESCRIPTION =
	"Project-relative path or canonical vault path for the file or folder to delete.";

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
		concurrencySafe: false,
		idempotent: true,
		cacheable: false,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "skill",
		outputBudget: 12000,
		primary: true,
		category: "skill",
		riskLevel: "low",
		promptArgumentLine: '- use_skill: {"command":"skill command from SkillCatalog","reason":"why the skill matches the current task"}',
	},
	{
		name: "ls",
		description: "List files and folders. Accepts empty paths, project-relative paths, canonical vault paths, and allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
				recursive: { type: "boolean", default: false },
				maxEntries: { type: "number", default: 120 },
			},
			additionalProperties: false,
		},
		capability: "filesystem.list",
		handlerName: "toolList",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "listing",
		outputBudget: 6000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- ls: {"path":"optional project-relative directory path","recursive":false,"maxEntries":120}',
	},
	{
		name: "read",
		description: "Read file content from project-relative paths, canonical vault paths, or allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: READ_PATH_DESCRIPTION },
				maxChars: { type: "number", default: 10000 },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "filesystem.read",
		handlerName: "toolRead",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "document",
		outputBudget: 10000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- read: {"path":"project-relative or canonical file path","maxChars":10000}',
	},
	{
		name: "grep",
		description: "Search a regex pattern in files under project-relative paths, canonical vault paths, or allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
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
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "search_results",
		outputBudget: 12000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- grep: {"path":"optional project-relative directory or file path","pattern":"regex","flags":"i","maxMatches":40}',
	},
	{
		name: "search_text",
		description: "Search plain text keywords in files under project-relative paths, canonical vault paths, or allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
				query: { type: "string" },
				maxMatches: { type: "number", default: 40 },
			},
			required: ["query"],
			additionalProperties: false,
		},
		capability: "filesystem.search_text",
		handlerName: "toolSearchText",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "search_results",
		outputBudget: 12000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- search_text: {"path":"optional project-relative directory or file path","query":"plain text query","maxMatches":40}',
	},
	{
		name: "glob",
		description: "Find files by glob pattern under project-relative paths, canonical vault paths, or allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
				pattern: { type: "string" },
				maxMatches: { type: "number", default: 80 },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		capability: "filesystem.glob",
		handlerName: "toolGlob",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "listing",
		outputBudget: 6000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- glob: {"path":"optional project-relative directory path","pattern":"*.md","maxMatches":80}',
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
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "knowledge",
		outputBudget: 12000,
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
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "memory",
		outputBudget: 4000,
		primary: true,
		category: "memory",
		riskLevel: "medium",
		promptArgumentLine: '- memory: {"action":"add|replace|remove","scope":"global|project","content":"durable fact","old_text":"existing fragment"}',
	},
	{
		name: "write",
		description: "Create or update a vault file with full content. Accepts project-relative paths and canonical vault paths; bare file names normalize into the active project workspace when one is selected.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: WRITE_PATH_DESCRIPTION },
				content: { type: "string" },
				mode: { type: "string", enum: ["create", "update", "upsert"] },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
		capability: "filesystem.write",
		handlerName: "toolWrite",
		readOnly: false,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 4000,
		primary: true,
		category: "write",
		riskLevel: "medium",
		promptArgumentLine: '- write: {"path":"project-relative or canonical file path","content":"full file content","mode":"create|update|upsert"}',
	},
	{
		name: "edit",
		description: "Apply targeted search/replace edits to a vault file. Accepts project-relative paths and canonical vault paths; bare file names normalize into the active project workspace when one is selected.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: WRITE_PATH_DESCRIPTION },
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
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 4000,
		primary: true,
		category: "write",
		riskLevel: "medium",
		promptArgumentLine: '- edit: {"path":"project-relative or canonical file path","edits":[{"search":"old text","replace":"new text"}]}',
	},
	{
		name: "delete",
		description: "Delete a vault file or folder by project-relative paths or canonical vault path.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DELETE_PATH_DESCRIPTION },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "filesystem.delete",
		handlerName: "toolDelete",
		readOnly: false,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 4000,
		primary: false,
		category: "delete",
		riskLevel: "high",
		promptArgumentLine: '- delete: {"path":"project-relative or canonical path"}',
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
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: true,
		resultKind: "command",
		outputBudget: 12000,
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
				concurrencySafe: tool.concurrencySafe,
				idempotent: tool.idempotent,
				cacheable: tool.cacheable,
				mutatesVault: tool.mutatesVault,
				mutatesExternal: tool.mutatesExternal,
				resultKind: tool.resultKind,
				outputBudget: tool.outputBudget,
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
