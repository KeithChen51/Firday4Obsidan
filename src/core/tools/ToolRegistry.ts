import { WIKI_FEATURE_ENABLED, WIKI_TOOL_NAMES } from "../../constants/wikiFeature";
import type { ToolDefinition } from "../../types/tools";

export type AgentMode = "ask" | "research" | "write" | "organize" | "review" | "debug" | "developer";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolCategory = "read" | "write" | "delete" | "system" | "memory" | "skill" | "knowledge" | "planning";
export type ToolResultKind =
	| "skill"
	| "listing"
	| "document"
	| "search_results"
	| "knowledge"
	| "memory"
	| "mutation"
	| "command"
	| "plan"
	| "validation";

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
	modelOnly?: boolean;
	userVisible?: boolean;
	bypassAllowedTools?: boolean;
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
		name: "plan_write",
		description: "Create or replace the model-authored visible task bar plan. Use before complex or multi-step work, and use again to keep task status synchronized.",
		parameters: {
			type: "object",
			properties: {
				visibility: { type: "string", enum: ["task_bar", "visible", "hidden", "internal"], default: "task_bar" },
				reason: { type: "string", description: "Why the plan is being created or updated." },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							status: { type: "string", enum: ["pending", "in_progress", "completed", "skipped", "failed", "blocked"] },
							summary: { type: "string" },
						},
						required: ["id", "title", "status"],
						additionalProperties: false,
					},
				},
			},
			required: ["tasks"],
			additionalProperties: false,
		},
		capability: "harness.plan.write",
		handlerName: "toolPlanWrite",
		readOnly: true,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "plan",
		outputBudget: 2000,
		primary: true,
		category: "planning",
		riskLevel: "low",
		modelOnly: true,
		userVisible: false,
		bypassAllowedTools: true,
		promptArgumentLine: '- plan_write: {"visibility":"task_bar","reason":"why this plan is needed","tasks":[{"id":"short-stable-id","title":"concrete task","status":"pending|in_progress|completed|skipped|failed|blocked","summary":"optional status detail"}]}',
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
		name: "read_many",
		description: "Read several files in one read-only batch from project-relative paths, canonical vault paths, or allowed external absolute paths when supported.",
		parameters: {
			type: "object",
			properties: {
				paths: {
					type: "array",
					items: { type: "string" },
					description: "Project-relative or canonical file paths to read.",
				},
				maxFiles: { type: "number", default: 8 },
				maxCharsPerFile: { type: "number", default: 6000 },
			},
			required: ["paths"],
			additionalProperties: false,
		},
		capability: "filesystem.read_many",
		handlerName: "toolReadMany",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "document",
		outputBudget: 16000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- read_many: {"paths":["project-relative or canonical file path"],"maxFiles":8,"maxCharsPerFile":6000}',
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
		name: "search_and_read",
		description: "Search text or regex and return compact snippets from matching files, reducing repeated search-then-read loops.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
				query: { type: "string", description: "Plain text query. Use this unless regex is required." },
				pattern: { type: "string", description: "Regex pattern when mode is regex." },
				mode: { type: "string", enum: ["text", "regex"], default: "text" },
				flags: { type: "string", default: "i" },
				maxMatches: { type: "number", default: 20 },
				maxCharsPerMatch: { type: "number", default: 800 },
			},
			additionalProperties: false,
		},
		capability: "filesystem.search_and_read",
		handlerName: "toolSearchAndRead",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "search_results",
		outputBudget: 18000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- search_and_read: {"path":"optional project-relative directory or file path","query":"plain text query","mode":"text","maxMatches":20,"maxCharsPerMatch":800}',
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
		name: "project_tree",
		description: "Return a compact directory tree under the active project or selected project-relative path, excluding hidden and generated directories by default.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: DISCOVERY_PATH_DESCRIPTION },
				maxDepth: { type: "number", default: 3 },
				maxEntries: { type: "number", default: 160 },
			},
			additionalProperties: false,
		},
		capability: "filesystem.project_tree",
		handlerName: "toolProjectTree",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "listing",
		outputBudget: 8000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- project_tree: {"path":"optional project-relative directory path","maxDepth":3,"maxEntries":160}',
	},
	{
		name: "canvas_read",
		description: "Read an Obsidian Canvas file from project-relative paths or canonical vault paths and return a structured summary of nodes, edges, file references, and validation issues.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: READ_PATH_DESCRIPTION },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.canvas.read",
		handlerName: "toolCanvasRead",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "document",
		outputBudget: 12000,
		primary: true,
		category: "read",
		riskLevel: "low",
		relatedSkillCommand: "json-canvas",
		promptArgumentLine: '- canvas_read: {"path":"project-relative/canonical .canvas path"}',
	},
	{
		name: "canvas_apply",
		description: "Create or update an Obsidian Canvas file from structured nodes and edges using project-relative paths or canonical vault paths; preserves existing IDs and unrelated canvas data when updating.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: WRITE_PATH_DESCRIPTION },
				mode: { type: "string", enum: ["create", "update", "upsert"], default: "upsert" },
				nodes: { type: "array", items: { type: "object", additionalProperties: true } },
				edges: { type: "array", items: { type: "object", additionalProperties: true } },
				autoLayout: { type: "boolean", default: true },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.canvas.apply",
		handlerName: "toolCanvasApply",
		readOnly: false,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 6000,
		primary: true,
		category: "write",
		riskLevel: "medium",
		relatedSkillCommand: "json-canvas",
		promptArgumentLine: '- canvas_apply: {"path":".canvas path","mode":"create|update|upsert","nodes":[...],"edges":[...]}',
	},
	{
		name: "markdown_outline",
		description: "Read an Obsidian Markdown note from project-relative paths or canonical vault paths and return headings, frontmatter, wikilinks, embeds, and Markdown links.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: READ_PATH_DESCRIPTION },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.markdown.outline",
		handlerName: "toolMarkdownOutline",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "document",
		outputBudget: 12000,
		primary: true,
		category: "read",
		riskLevel: "low",
		relatedSkillCommand: "obsidian-markdown",
		promptArgumentLine: '- markdown_outline: {"path":"project-relative/canonical .md path"}',
	},
	{
		name: "frontmatter_update",
		description: "Safely update YAML frontmatter in an Obsidian Markdown note using project-relative paths or canonical vault paths without rewriting the note body.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: WRITE_PATH_DESCRIPTION },
				set: { type: "object", description: "Frontmatter key/value pairs to add or replace." },
				remove: { type: "array", items: { type: "string" } },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.markdown.frontmatter_update",
		handlerName: "toolFrontmatterUpdate",
		readOnly: false,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 6000,
		primary: true,
		category: "write",
		riskLevel: "medium",
		relatedSkillCommand: "obsidian-markdown",
		promptArgumentLine: '- frontmatter_update: {"path":".md path","set":{"key":"value"},"remove":["old_key"]}',
	},
	{
		name: "markdown_insert_reference",
		description: "Insert a wikilink, embed, or Markdown link into an Obsidian Markdown note using project-relative paths or canonical vault paths.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: WRITE_PATH_DESCRIPTION },
				reference: { type: "string", description: "The exact reference line to insert, such as [[Note]], ![[Image.png]], or [Label](Note.md)." },
				placement: { type: "string", enum: ["append", "after_heading", "before_heading"], default: "append" },
				heading: { type: "string", description: "Heading text used when placement targets a heading." },
				dedupe: { type: "boolean", default: true },
			},
			required: ["path", "reference"],
			additionalProperties: false,
		},
		capability: "obsidian.markdown.insert_reference",
		handlerName: "toolMarkdownInsertReference",
		readOnly: false,
		concurrencySafe: false,
		idempotent: false,
		cacheable: false,
		mutatesVault: true,
		mutatesExternal: false,
		resultKind: "mutation",
		outputBudget: 6000,
		primary: true,
		category: "write",
		riskLevel: "medium",
		relatedSkillCommand: "obsidian-markdown",
		promptArgumentLine: '- markdown_insert_reference: {"path":".md path","reference":"[[Note]]","placement":"append|after_heading|before_heading","heading":"optional","dedupe":true}',
	},
	{
		name: "validate_canvas",
		description: "Validate an Obsidian Canvas file from project-relative paths or canonical vault paths for JSON shape, node and edge references, duplicate IDs, and required fields.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: READ_PATH_DESCRIPTION },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.canvas.validate",
		handlerName: "toolValidateCanvas",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "validation",
		outputBudget: 8000,
		primary: true,
		category: "read",
		riskLevel: "low",
		relatedSkillCommand: "json-canvas",
		promptArgumentLine: '- validate_canvas: {"path":"project-relative/canonical .canvas path"}',
	},
	{
		name: "validate_markdown",
		description: "Validate an Obsidian Markdown note from project-relative paths or canonical vault paths for frontmatter and broken wikilinks, embeds, or local Markdown links.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: READ_PATH_DESCRIPTION },
			},
			required: ["path"],
			additionalProperties: false,
		},
		capability: "obsidian.markdown.validate",
		handlerName: "toolValidateMarkdown",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "validation",
		outputBudget: 8000,
		primary: true,
		category: "read",
		riskLevel: "low",
		relatedSkillCommand: "obsidian-markdown",
		promptArgumentLine: '- validate_markdown: {"path":"project-relative/canonical .md path"}',
	},
	{
		name: "validate_outputs",
		description: "Validate several project-relative paths or canonical vault paths after Obsidian file changes, dispatching to Canvas or Markdown validators when supported.",
		parameters: {
			type: "object",
			properties: {
				paths: {
					type: "array",
					items: { type: "string" },
					description: "Project-relative or canonical vault paths to validate.",
				},
			},
			required: ["paths"],
			additionalProperties: false,
		},
		capability: "obsidian.outputs.validate",
		handlerName: "toolValidateOutputs",
		readOnly: true,
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "validation",
		outputBudget: 12000,
		primary: true,
		category: "read",
		riskLevel: "low",
		promptArgumentLine: '- validate_outputs: {"paths":["project-relative/canonical .canvas/.md path"]}',
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
			if (allowedTools.size > 0 && !allowedTools.has(tool.name) && !tool.bypassAllowedTools) {
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
			.filter((tool) => tool.name !== "use_skill" && tool.userVisible !== false && !tool.modelOnly)
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
