import { ProjectEntry, ProjectGroupEntry } from "./project";
import { AgentRuntimeSettings } from "./agent";
import { LocaleCode } from "../i18n/types";
import { OFFICIAL_CONTENT_STARTUP_DELAY_MS } from "../constants/officialContent";
import {
	GROUP_MODEL_CATALOG_BRANCH,
	GROUP_MODEL_CATALOG_FILE_PATH,
	GROUP_MODEL_CATALOG_REPO_URL,
	GROUP_MODEL_CATALOG_STARTUP_DELAY_MS,
} from "../constants/groupModelCatalog";
import { OfficialContentCatalogEntry } from "./officialContent";
import type { GroupModelCatalogDefaults, GroupModelCatalogModel } from "./groupModelCatalog";

export interface SlashCommandTemplate {
	id: string;
	name: string;
	template: string;
	allowedTools: string[];
	allowedModels: string[];
	enabled: boolean;
}

export interface LlmReasoningSettings {
	enabled: boolean;
	effort: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
	maxTokens: number | null;
	summary: "" | "auto" | "concise" | "detailed" | "none";
	enableThinking: boolean;
	thinkingBudget: number | null;
	showRawInDebug: boolean;
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
	reasoning: LlmReasoningSettings;
}

export type ModelPresetSource = "opencode" | "remote";

export type WorkbenchStartupPlacement =
	| "right-sidebar"
	| "left-sidebar";

export function isWorkbenchStartupPlacement(value: unknown): value is WorkbenchStartupPlacement {
	return (
		value === "right-sidebar" ||
		value === "left-sidebar"
	);
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
		modelPresetSource: ModelPresetSource;
		apiUrl: string;
		apiKey: string;
		extraHeaders: Record<string, string>;
		opencodeProviderId: string;
		model: string;
		temperature: number | null;
		maxTokens: number | null;
		enableStreaming: boolean;
		reasoning: LlmReasoningSettings;
		openaiConfig: LlmModeConfig;
		groupConfig: LlmModeConfig;
	};
	sync: {
		mode: "manual" | "idle_auto" | "continuous_auto";
		idleMinutes: number;
		syncOnStartup: boolean;
	};
	workbench: {
		openOnStartup: boolean;
		startupPlacement: WorkbenchStartupPlacement;
		onboardingDismissed: boolean;
	};
	update: {
		enabled: boolean;
		checkOnStartup: boolean;
		startupDelayMs: number;
		dismissedVersion: string;
		lastCheckedAt: string;
		lastResult: "idle" | "up-to-date" | "available" | "applied" | "error";
		availableVersion: string;
	};
	officialContent: {
		checkOnStartup: boolean;
		startupDelayMs: number;
		lastCheckedAt: string;
		lastCatalogVersion: string;
		catalog: OfficialContentCatalogEntry[];
		channels: Record<string, {
			subscribed: boolean;
			lastAppliedVersion: string;
			path: string;
		}>;
	};
	groupModelCatalog: {
		enabled: boolean;
		checkOnStartup: boolean;
		startupDelayMs: number;
		repoUrl: string;
		branch: string;
		filePath: string;
		lastCheckedAt: string;
		lastCatalogVersion: string;
		lastResult: "idle" | "updated" | "up-to-date" | "error";
		lastError: string;
		providerId: string;
		providerName: string;
		models: GroupModelCatalogModel[];
		defaults: GroupModelCatalogDefaults;
	};
	projectGroups: ProjectGroupEntry[];
	projects: ProjectEntry[];
	activeProjectId: string;
	activeSoulId: string;
	agentRuntime: AgentRuntimeSettings;
	slashCommands: SlashCommandTemplate[];
}

export const SETTINGS_VERSION = 11;

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
		modelPresetSource: "opencode",
		apiUrl: "",
		apiKey: "",
		extraHeaders: {},
		opencodeProviderId: "",
		model: "",
		temperature: null,
		maxTokens: null,
		enableStreaming: true,
		reasoning: {
			enabled: false,
			effort: "",
			maxTokens: null,
			summary: "auto",
			enableThinking: false,
			thinkingBudget: null,
			showRawInDebug: false,
		},
		openaiConfig: {
			apiUrl: "",
			apiKey: "",
			extraHeaders: {},
			opencodeProviderId: "",
			model: "",
			temperature: null,
			maxTokens: null,
			enableStreaming: true,
			reasoning: {
				enabled: false,
				effort: "",
				maxTokens: null,
				summary: "auto",
				enableThinking: false,
				thinkingBudget: null,
				showRawInDebug: false,
			},
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
			reasoning: {
				enabled: false,
				effort: "",
				maxTokens: null,
				summary: "auto",
				enableThinking: false,
				thinkingBudget: null,
				showRawInDebug: false,
			},
		},
	},
	sync: {
		mode: "manual",
		idleMinutes: 0,
		syncOnStartup: true,
	},
	workbench: {
		openOnStartup: true,
		startupPlacement: "right-sidebar",
		onboardingDismissed: false,
	},
	update: {
		enabled: false,
		checkOnStartup: true,
		startupDelayMs: 5000,
		dismissedVersion: "",
		lastCheckedAt: "",
		lastResult: "idle",
		availableVersion: "",
	},
	officialContent: {
		checkOnStartup: true,
		startupDelayMs: OFFICIAL_CONTENT_STARTUP_DELAY_MS,
		lastCheckedAt: "",
		lastCatalogVersion: "",
		catalog: [],
		channels: {},
	},
	groupModelCatalog: {
		enabled: true,
		checkOnStartup: true,
		startupDelayMs: GROUP_MODEL_CATALOG_STARTUP_DELAY_MS,
		repoUrl: GROUP_MODEL_CATALOG_REPO_URL,
		branch: GROUP_MODEL_CATALOG_BRANCH,
		filePath: GROUP_MODEL_CATALOG_FILE_PATH,
		lastCheckedAt: "",
		lastCatalogVersion: "",
		lastResult: "idle",
		lastError: "",
		providerId: "",
		providerName: "",
		models: [],
		defaults: {},
	},
	projectGroups: [],
	projects: [],
	activeProjectId: "",
	activeSoulId: "",
	agentRuntime: {
		requireWriteConfirmation: true,
		toolPermissionMode: "standard",
		fileMutationMode: "review",
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
