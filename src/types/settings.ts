import { ProjectEntry, ProjectGroupEntry } from "./project";
import { AgentProfile, AgentRuntimeSettings } from "./agent";
import { LocaleCode } from "../i18n/types";

export interface SlashCommandTemplate {
	id: string;
	name: string;
	template: string;
	allowedTools: string[];
	allowedModels: string[];
	enabled: boolean;
}

export interface LlmModeConfig {
	apiUrl: string;
	apiKey: string;
	extraHeaders: Record<string, string>;
	opencodeProviderId: string;
	model: string;
	temperature: number | null;
	maxTokens: number | null;
	enableStreaming: boolean;
}

export interface FridaySettings {
	version: number;
	locale: LocaleCode;
	localeFollowSystem: boolean;
	user: {
		userId: string;
		displayName: string;
		autoDetect: boolean;
		gitUserEmail: string;
	};
	llm: {
		mode: "openai" | "group";
		apiUrl: string;
		apiKey: string;
		extraHeaders: Record<string, string>;
		opencodeProviderId: string;
		model: string;
		temperature: number | null;
		maxTokens: number | null;
		enableStreaming: boolean;
		openaiConfig: LlmModeConfig;
		groupConfig: LlmModeConfig;
	};
	sync: {
		mode: "manual" | "idle_auto" | "continuous_auto";
		idleMinutes: number;
		syncOnStartup: boolean;
	};
	projectGroups: ProjectGroupEntry[];
	projects: ProjectEntry[];
	activeProjectId: string;
	agents: AgentProfile[];
	activeAgentId: string;
	agentRuntime: AgentRuntimeSettings;
	slashCommands: SlashCommandTemplate[];
}

export const SETTINGS_VERSION = 6;

export const DEFAULT_SETTINGS: FridaySettings = {
	version: SETTINGS_VERSION,
	locale: "zh-CN",
	localeFollowSystem: true,
	user: {
		userId: "",
		displayName: "",
		autoDetect: true,
		gitUserEmail: "",
	},
	llm: {
		mode: "openai",
		apiUrl: "",
		apiKey: "",
		extraHeaders: {},
		opencodeProviderId: "",
		model: "",
		temperature: null,
		maxTokens: null,
		enableStreaming: true,
		openaiConfig: {
			apiUrl: "",
			apiKey: "",
			extraHeaders: {},
			opencodeProviderId: "",
			model: "",
			temperature: null,
			maxTokens: null,
			enableStreaming: true,
		},
		groupConfig: {
			apiUrl: "",
			apiKey: "",
			extraHeaders: {},
			opencodeProviderId: "",
			model: "",
			temperature: null,
			maxTokens: null,
			enableStreaming: true,
		},
	},
	sync: {
		mode: "manual",
		idleMinutes: 0,
		syncOnStartup: true,
	},
	projectGroups: [],
	projects: [],
	activeProjectId: "",
	agents: [],
	activeAgentId: "",
	agentRuntime: {
		requireWriteConfirmation: true,
		toolPermissionMode: "standard",
		disabledTools: [],
		disabledSkills: [],
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
		projectToolPolicyRules: {},
	},
	slashCommands: [],
};
