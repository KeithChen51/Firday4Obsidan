import { ToolCallingMode } from "./tools";

export interface AgentProfile {
	id: string;
	name: string;
	description: string;
	model: string;
	modelMode?: "openai" | "group";
	agentFilePath: string;
	createdAt: string;
	updatedAt: string;
}

export type ToolPermissionMode = "auto" | "standard" | "strict";
export type FileMutationMode = "review" | "autoApproved";
export type RuntimePolicyEffect = "allow" | "ask" | "deny";
export type FridayPiRuntimeSource = "obsidian-host" | "real-pi-sdk";

export const DEFAULT_FRIDAY_PI_RUNTIME_SOURCE: FridayPiRuntimeSource = "obsidian-host";

export function normalizeFridayPiRuntimeSource(value: unknown): FridayPiRuntimeSource {
	return value === "real-pi-sdk" ? "real-pi-sdk" : DEFAULT_FRIDAY_PI_RUNTIME_SOURCE;
}

export function deriveFileMutationModeFromToolPermissionMode(mode: ToolPermissionMode): FileMutationMode {
	return mode === "auto" ? "autoApproved" : "review";
}
export type RuntimeExecutionGateCode =
	| "allowed"
	| "runtime_disabled"
	| "skill_disabled"
	| "tool_disabled"
	| "capability_disabled"
	| "exec_disabled"
	| "exec_unsupported";

export interface RuntimeToolPolicyRule {
	action: string;
	effect: RuntimePolicyEffect;
}

export interface AgentRuntimeSettings {
	requireWriteConfirmation: boolean;
	toolPermissionMode: ToolPermissionMode;
	fileMutationMode: FileMutationMode;
	disabledTools: string[];
	disabledSkills: string[];
	enableExecTool: boolean;
	execTimeout: number;
	execWorkingDir: "vault" | "custom";
	execCustomCwd: string;
	vaultFocusPaths: string[];
	externalReadOnlyPaths: string[];
	externalSkillPaths: string[];
	excludedTags: string[];
	toolRuntimeEnabled: boolean;
	maxToolIterations: number;
	blockedCommands: string[];
	toolCallingMode: ToolCallingMode;
	piRuntimeSource: FridayPiRuntimeSource;
	projectToolPolicyRules: Record<string, RuntimeToolPolicyRule[]>;
}
