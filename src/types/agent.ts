import { ToolCallingMode } from "./tools";

export interface AgentProfile {
	id: string;
	name: string;
	description: string;
	model: string;
	agentFilePath: string;
	createdAt: string;
	updatedAt: string;
}

export type ToolPermissionMode = "auto" | "standard" | "strict";
export type RuntimePolicyEffect = "allow" | "ask" | "deny";

export interface RuntimeToolPolicyRule {
	action: string;
	effect: RuntimePolicyEffect;
}

export interface AgentRuntimeSettings {
	requireWriteConfirmation: boolean;
	toolPermissionMode: ToolPermissionMode;
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
	enableSubagent: boolean;
	maxSubagentDepth: number;
	blockedCommands: string[];
	toolCallingMode: ToolCallingMode;
	projectToolPolicyRules: Record<string, RuntimeToolPolicyRule[]>;
}
