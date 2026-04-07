import { ProjectEntry } from "./project";
import { AgentProfile, AgentRuntimeSettings, KnowledgeCuratorSettings } from "./agent";
import { LocaleCode } from "../i18n/types";

export interface SlashCommandTemplate {
	id: string;
	name: string;
	template: string;
	allowedTools: string[];
	allowedModels: string[];
	enabled: boolean;
}

export interface FridaySettings {
	version: number;
	locale: LocaleCode;
	user: {
		userId: string;
		displayName: string;
		autoDetect: boolean;
	};
	llm: {
		mode: "openai" | "group";
		apiUrl: string;
		apiKey: string;
		model: string;
		temperature: number | null;
		maxTokens: number | null;
		enableStreaming: boolean;
	};
	sync: {
		autoPush: boolean;
		syncInterval: number;
		syncOnStartup: boolean;
	};
	dailyNote: {
		autoGenerate: boolean;
		templatePath: string;
	};
	projects: ProjectEntry[];
	agents: AgentProfile[];
	activeAgentId: string;
	agentRuntime: AgentRuntimeSettings;
	knowledgeCurator: KnowledgeCuratorSettings;
	slashCommands: SlashCommandTemplate[];
}

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: FridaySettings = {
	version: SETTINGS_VERSION,
	locale: "zh-CN",
	user: {
		userId: "",
		displayName: "",
		autoDetect: true,
	},
	llm: {
		mode: "openai",
		apiUrl: "",
		apiKey: "",
		model: "",
		temperature: null,
		maxTokens: null,
		enableStreaming: true,
	},
	sync: {
		autoPush: false,
		syncInterval: 0,
		syncOnStartup: true,
	},
	dailyNote: {
		autoGenerate: true,
		templatePath: "",
	},
	projects: [],
	agents: [],
	activeAgentId: "",
	agentRuntime: {
		requireWriteConfirmation: true,
		toolPermissionMode: "standard",
		enableExecTool: false,
		execTimeout: 30000,
		execWorkingDir: "vault",
		execCustomCwd: "",
		vaultFocusPaths: [],
		externalReadOnlyPaths: [],
		externalSkillPaths: [],
		excludedTags: [],
		toolRuntimeEnabled: true,
		maxToolIterations: 6,
		enableSubagent: true,
		maxSubagentDepth: 1,
		blockedCommands: [
			"rm\\s+-rf\\s+/",
			"rmdir\\s+/s",
			"format\\s+[a-zA-Z]:",
			"mkfs",
			"dd\\s+if=",
			":(){ :|:& };:",
			"shutdown",
			"reboot",
			"init\\s+0",
			"del\\s+/s\\s+/q\\s+[a-zA-Z]:",
		],
		toolCallingMode: "auto",
	},
	knowledgeCurator: {
		enabledManualOnly: true,
		maxSessionsPerRun: 30,
		maxCharsPerSession: 4000,
		maxModelInputChars: 32000,
		staleAfterDays: 30,
		confidenceThreshold: 0.6,
	},
	slashCommands: [],
};
