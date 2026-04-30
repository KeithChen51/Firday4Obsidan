import path from "path";
import { ToolRegistry, type AgentMode } from "../tools/ToolRegistry";

export type PolicyEffectLike = "allow" | "ask" | "deny";
export type ToolApprovalRequirement = "none" | "standard" | "strict";

export interface RuntimeProfileLike {
	id: string;
	capabilities: {
		supportsExecTool?: boolean;
		supportsExternalRead?: boolean;
	};
}

export interface CapabilityPolicyInput {
	agentMode?: AgentMode;
	enableExecTool?: boolean;
	runtimeProfile?: RuntimeProfileLike;
	toolName: string;
	args?: Record<string, unknown>;
	scope?: "vault" | "external" | "any";
	targetPath?: string;
	disabledTools?: Iterable<string> | null;
	allowedTools?: Iterable<string> | null;
	policyEffect?: PolicyEffectLike;
	workspaceRoot?: string;
}

export interface ExecPolicyInput {
	agentMode?: AgentMode;
	enableExecTool?: boolean;
	command: string;
	args?: string[];
	cwd?: string;
	workspaceRoot?: string;
}

export interface CapabilityAllowDecision {
	allow: true;
	approval: ToolApprovalRequirement;
	reason: string;
}

export interface CapabilityDenyDecision {
	allow: false;
	code: string;
	reason: string;
}

export type CapabilityDecision = CapabilityAllowDecision | CapabilityDenyDecision;

const READ_APPROVAL_CATEGORIES = new Set(["read", "skill"]);
const DELETE_COMMANDS = new Set(["rm", "rmdir", "rd", "del", "erase"]);
const SHELL_CONTROL_TOKENS = new Set(["&&", "||", ";", "|", ">", ">>", "<", "`"]);

export class CapabilityPolicy {
	private readonly registry = ToolRegistry.getInstance();

	evaluateToolCall(input: CapabilityPolicyInput): CapabilityDecision {
		const toolName = normalizeToolName(input.toolName);
		const tool = this.registry.get(toolName);
		if (!tool) {
			return deny("tool_unknown", `Unknown tool: ${toolName || "(empty)"}.`);
		}

		if (normalizeSet(input.disabledTools).has(toolName)) {
			return deny("tool_disabled", `Tool ${toolName} is disabled.`);
		}

		const allowedTools = normalizeSet(input.allowedTools);
		if (allowedTools.size > 0 && !allowedTools.has(toolName)) {
			return deny("tool_not_allowed", `Tool ${toolName} is not allowed by the current command policy.`);
		}

		if (input.scope === "external" && !input.runtimeProfile?.capabilities.supportsExternalRead) {
			return deny(
				"external_read_unsupported",
				`Runtime profile ${input.runtimeProfile?.id ?? "(unknown)"} does not allow external read operations.`,
			);
		}

		if (input.policyEffect === "deny") {
			return deny("tool_policy_denied", `Policy denied tool:${toolName}.`);
		}

		if (toolName === "exec") {
			const args = input.args ?? {};
			const command = typeof args.command === "string" ? args.command : "";
			const rawArgs = Array.isArray(args.args) ? args.args.map((item) => String(item)) : [];
			const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
			const execDecision = this.evaluateExecRequest({
				agentMode: input.agentMode,
				enableExecTool: input.enableExecTool,
				command,
				args: rawArgs,
				cwd,
				workspaceRoot: input.workspaceRoot,
			});
			if (!execDecision.allow) {
				return execDecision;
			}
			return {
				allow: true,
				approval: "strict",
				reason: "Exec command is allowed by debug profile allowlist.",
			};
		}

		if (READ_APPROVAL_CATEGORIES.has(tool.category)) {
			return {
				allow: true,
				approval: "none",
				reason: `Tool ${toolName} is allowed.`,
			};
		}

		return {
			allow: true,
			approval: tool.riskLevel === "high" ? "strict" : "standard",
			reason: `Tool ${toolName} requires approval.`,
		};
	}

	evaluateExecRequest(input: ExecPolicyInput): CapabilityDecision {
		const agentMode = input.agentMode ?? "ask";
		if (!input.enableExecTool) {
			return deny("exec_disabled", "Exec tool is disabled.");
		}
		if (agentMode !== "debug" && agentMode !== "developer") {
			return deny("exec_requires_debug_profile", "Exec requires debug or developer agent mode.");
		}

		const command = normalizeCommand(input.command);
		const args = input.args ?? [];
		if (!command) {
			return deny("exec_missing_command", "Exec command is required.");
		}

		if (containsShellControl([command, ...args])) {
			return deny("exec_shell_chaining_denied", "Exec command contains shell control tokens.");
		}

		if (DELETE_COMMANDS.has(command)) {
			return deny("exec_delete_denied", "Use the native delete tool instead of shell deletion commands.");
		}

		const workspaceRoot = input.workspaceRoot?.trim();
		if (workspaceRoot && input.cwd && !isPathWithin(input.cwd, workspaceRoot)) {
			return deny("exec_cwd_outside_workspace", "Exec cwd is outside workspace.");
		}

		if (isAllowlistedExec(command, args)) {
			return {
				allow: true,
				approval: "strict",
				reason: "Exec command is allowed by debug profile allowlist.",
			};
		}

		return deny("exec_not_allowlisted", `Exec command is not in the debug profile allowlist: ${command}.`);
	}
}

function deny(code: string, reason: string): CapabilityDenyDecision {
	return {
		allow: false,
		code,
		reason,
	};
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

function normalizeCommand(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) {
		return "";
	}
	return path.basename(trimmed).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/u, "");
}

function containsShellControl(tokens: string[]): boolean {
	return tokens.some((token) => {
		const trimmed = token.trim();
		return SHELL_CONTROL_TOKENS.has(trimmed) || /[;&|<>`]/u.test(trimmed);
	});
}

function isAllowlistedExec(command: string, args: string[]): boolean {
	if (command === "npm") {
		return args.length === 1 && args[0] === "test";
	}
	if (command === "git") {
		const subcommand = args[0] ?? "";
		return subcommand === "status" || subcommand === "diff";
	}
	if (command === "rg") {
		return args.length > 0;
	}
	return false;
}

function isPathWithin(candidatePath: string, workspaceRoot: string): boolean {
	const resolvedCandidate = normalizeResolvedPath(candidatePath);
	const resolvedRoot = normalizeResolvedPath(workspaceRoot);
	return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function normalizeResolvedPath(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
