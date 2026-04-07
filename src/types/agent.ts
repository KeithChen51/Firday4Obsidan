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

export interface AgentRuntimeSettings {
	requireWriteConfirmation: boolean;
	toolPermissionMode: ToolPermissionMode;
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
}

export interface KnowledgeCuratorSettings {
	enabledManualOnly: boolean;
	maxSessionsPerRun: number;
	maxCharsPerSession: number;
	maxModelInputChars: number;
	staleAfterDays: number;
	confidenceThreshold: number;
}
