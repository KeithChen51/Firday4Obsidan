import { hostname } from "os";
import { Notice, Plugin, TAbstractFile, WorkspaceLeaf, addIcon, normalizePath } from "obsidian";
import { registerInitCommand } from "./commands/initCommand";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerSyncCommands } from "./commands/syncCommands";
import { FRIDAY_SETTINGS_CHANGED_EVENT, PROJECT_STATE_CHANGED_EVENT } from "./constants/events";
import { FRIDAY_ICON_ID, FRIDAY_ICON_SVG } from "./constants/icon";
import { PRIMARY_PATHS } from "./constants/paths";
import { WIKI_FEATURE_ENABLED } from "./constants/wikiFeature";
import { resolveLocale, translate } from "./i18n";
import { I18nParams, LocaleCode } from "./i18n/types";
import { AgentActionService } from "./services/AgentActionService";
import { AgentRuntimeService } from "./services/AgentRuntimeService";
import { AgentService } from "./services/AgentService";
import { AIService } from "./services/AIService";
import { CanvasService } from "./services/CanvasService";
import { CommandExecService } from "./services/CommandExecService";
import { ConversationService } from "./services/ConversationService";
import { DataService } from "./services/DataService";
import { InlineEditService } from "./services/InlineEditService";
import { SkillCommandService } from "./services/SkillCommandService";
import { SlashCommandService } from "./services/SlashCommandService";
import { SyncService } from "./services/SyncService";
import { ToolApprovalService } from "./services/ToolApprovalService";
import { WorkspaceAccessService } from "./services/WorkspaceAccessService";
import { ProjectBoundaryService } from "./services/ProjectBoundaryService";
import { PluginUpdateService } from "./services/PluginUpdateService";
import { GroupModelCatalogService } from "./services/GroupModelCatalogService";
import { OfficialContentService } from "./services/OfficialContentService";
import { OnboardingService } from "./services/OnboardingService";
import { ProjectContentService, RawSourceContext } from "./services/ProjectContentService";
import { IngestEventStore } from "./services/IngestEventStore";
import { LocalStateRootService } from "./services/LocalStateRootService";
import { RuntimeStateStore } from "./services/RuntimeStateStore";
import { SettingsMirrorService } from "./services/SettingsMirrorService";
import { SoulStore } from "./services/SoulStore";
import { LegacyFridayRootMigrationService } from "./services/LegacyFridayRootMigrationService";
import { LegacyAgentMigrationService } from "./services/LegacyAgentMigrationService";
import { LegacyAgentCleanupService } from "./services/LegacyAgentCleanupService";
import { IngestSummary, WikiIngestService } from "./services/WikiIngestService";
import { WorkbenchStateStore } from "./features/workbench/WorkbenchStateStore";
import { AutoSyncManager } from "./features/sync/AutoSyncManager";
import { SyncEventBus } from "./features/sync/SyncEventBus";
import { SyncRuntimeStore } from "./features/sync/SyncRuntimeStore";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { EventRouter } from "./core/execution/EventRouter";
import { ExecutionPlanner } from "./core/execution/ExecutionPlanner";
import { ExecutionOrchestrator } from "./core/execution/ExecutionOrchestrator";
import { AgentLoopController } from "./core/agent-kernel/AgentLoopController";
import { AgentKernel, AgentRuntimeFacade } from "./core/agent-kernel/AgentKernel";
import { normalizeLlmSettings, switchLlmMode } from "./core/llm/LlmSettingsResolver";
import { SecureStorage } from "./platform/obsidian/SecureStorage";
import { detectRuntimeProfile } from "./platform/runtime/RuntimeProfile";
import { AgentProfile } from "./types/agent";
import type { OfficialContentCatalogEntry } from "./types/officialContent";
import { FridayPluginApi } from "./types/plugin";
import { ProjectEntry, ProjectGitCredential, ProjectGroupEntry, SourceType } from "./types/project";
import { DEFAULT_SETTINGS, FridaySettings, SETTINGS_VERSION, isWorkbenchStartupPlacement } from "./types/settings";
import { SoulDefinition, SoulSummary } from "./types/soul";
import { DailyBoardView, VIEW_TYPE_DAILY_BOARD } from "./views/DailyBoardView";
import { FridaySettingTab, isFridaySettingsSection } from "./settings/FridaySettingTab";

const DEFAULT_PROJECT_GROUP_ID = "default-group";
const ROOT_INDEX_RECOVERY_STORAGE_KEY = "friday:root-index-recovery";
const ROOT_INDEX_RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1000;
const NATIVE_FRIDAY_SOUL_PRESET_VERSION = 2;
const LEGACY_NATIVE_FRIDAY_SOUL_PRESET: Pick<
	SoulDefinition,
	| "name"
	| "summary"
	| "description"
	| "rolePrompt"
	| "tonePreset"
	| "tonePrompt"
	| "behaviorRules"
	| "antiPatterns"
	| "builtIn"
	| "editable"
> = {
	name: "原生 FRIDAY",
	summary: "低摩擦、安静、以你为主导的本地 AI 工作伙伴。",
	description: "原生 FRIDAY 是一个低摩擦、以用户为主导的本地 AI 工作伙伴。它以 Obsidian 为中心、以本地知识为基础，尽量隐藏工具复杂性，让思考自然发生在工作流中。",
	rolePrompt: "你是原生 FRIDAY。你的核心目标是 Make Every Day FRIDAY：让 AI 尽量消失在工作流中，让用户把注意力放回思考与创造本身。你优先降低认知负担和操作摩擦，先帮用户理清上下文，再给出清晰、可执行、可解释的建议。你不会喧宾夺主，也不会替用户做关键决策。你是一个安静、可靠、长期在场的协作者，重视本地知识、低摩擦工作流、隐形 Git、透明可解释与用户主导。",
	tonePreset: "balanced",
	tonePrompt: "简洁、冷静、克制，像资深合作者。少空话，不夸张，不过度鼓励。",
	behaviorRules: [
		"优先降低认知负担和操作摩擦。",
		"优先整理上下文，再给出建议与下一步。",
		"关键决策交给用户确认，不擅自越权。",
		"尽量解释依据，让行为可理解、可追踪。",
		"优先利用本地知识、项目上下文与已有内容协作。",
		"尽量隐藏工具复杂性，让工作流保持自然。",
	],
	antiPatterns: [
		"不要喧宾夺主。",
		"不要替用户做关键决策。",
		"不要为了显得聪明而复杂化问题。",
		"不要使用过度鼓励或营销式语气。",
	],
	builtIn: true,
	editable: true,
};
const NATIVE_FRIDAY_SOUL_PRESET: Pick<
	SoulDefinition,
	| "name"
	| "summary"
	| "description"
	| "rolePrompt"
	| "tonePreset"
	| "tonePrompt"
	| "behaviorRules"
	| "antiPatterns"
	| "builtInPresetVersion"
	| "builtIn"
	| "editable"
> = {
	name: "原生 FRIDAY",
	summary: "温和、清晰、可靠的本地工作伙伴。",
	description: "原生 FRIDAY 以自然、低压的方式陪用户推进工作。它帮助用户理顺信息、明确下一步，并在保持专业的同时尽量减少压迫感和操作摩擦。",
	rolePrompt: "你是原生 FRIDAY。你是一个有温度但不黏人的协作者。你的职责不是喧宾夺主，而是帮助用户把事情理顺、把任务说清、把下一步变得容易开始。你应当先理解上下文，再给出清晰、可信、可执行的回应。你保持礼貌、自然和分寸感，不过度热情，也不使用夸张或表演式表达。你尊重用户主导，不替用户做未经确认的关键决定；当信息不足、风险存在或边界不清时，应直接指出。",
	tonePreset: "warm",
	tonePrompt: "亲和、自然、有分寸。表达温和，但不要过度热情、讨好或像客服。",
	behaviorRules: [
		"先帮用户理清问题，再推进下一步。",
		"保持礼貌和温度，但回答要简洁。",
		"优先降低理解成本和行动门槛。",
		"信息不足时明确指出缺口或假设。",
		"在需要时提供低门槛、可直接开始的下一步建议。",
	],
	antiPatterns: [
		"不要过度热情或过度鼓励。",
		"不要使用客服式、营销式或讨好式表达。",
		"不要把简单问题说得很重。",
		"不要替用户做未经确认的关键决策。",
	],
	builtInPresetVersion: NATIVE_FRIDAY_SOUL_PRESET_VERSION,
	builtIn: true,
	editable: true,
};

function builtInSoulPresetFingerprint(
	preset: Pick<
		SoulDefinition,
		| "summary"
		| "description"
		| "rolePrompt"
		| "tonePreset"
		| "tonePrompt"
		| "behaviorRules"
		| "antiPatterns"
	>,
): string {
	return JSON.stringify({
		summary: preset.summary,
		description: preset.description,
		rolePrompt: preset.rolePrompt,
		tonePreset: preset.tonePreset,
		tonePrompt: preset.tonePrompt,
		behaviorRules: preset.behaviorRules,
		antiPatterns: preset.antiPatterns,
	});
}

function matchesBuiltInSoulPreset(
	soul: Pick<
		SoulDefinition,
		| "summary"
		| "description"
		| "rolePrompt"
		| "tonePreset"
		| "tonePrompt"
		| "behaviorRules"
		| "antiPatterns"
	>,
	preset: Pick<
		SoulDefinition,
		| "summary"
		| "description"
		| "rolePrompt"
		| "tonePreset"
		| "tonePrompt"
		| "behaviorRules"
		| "antiPatterns"
	>,
): boolean {
	return builtInSoulPresetFingerprint(soul) === builtInSoulPresetFingerprint(preset);
}
type WikiCompileResult = {
	projectId: string;
	projectRoot: string;
	requested: number;
	processed: number;
	succeeded: number;
	failed: number;
	rawPaths: string[];
	updatedDocs: string[];
	updatedIndex: string;
	updatedLog: string;
};

export default class FridayPlugin extends Plugin implements FridayPluginApi {
	settings: FridaySettings = DEFAULT_SETTINGS;
	dataService!: DataService;
	syncService!: SyncService;
	aiService!: AIService;
	agentService!: AgentService;
	conversationService!: ConversationService;
	workspaceAccessService!: WorkspaceAccessService;
	canvasService!: CanvasService;
	agentActionService!: AgentActionService;
	toolApprovalService!: ToolApprovalService;
	commandExecService!: CommandExecService;
	inlineEditService!: InlineEditService;
	agentRuntimeService!: AgentRuntimeService;
	agentRuntimeFacade!: AgentRuntimeFacade;
	skillCommandService!: SkillCommandService;
	slashCommandService!: SlashCommandService;
	workbenchStateStore!: WorkbenchStateStore;
	executionEventRouter!: EventRouter;
	executionPlanner!: ExecutionPlanner;
	executionOrchestrator!: ExecutionOrchestrator;
	projectBoundaryService!: ProjectBoundaryService;
	projectContentService!: ProjectContentService;
	ingestEventStore!: IngestEventStore;
	wikiIngestService!: WikiIngestService;
	secureStorage!: SecureStorage;
	autoSyncManager!: AutoSyncManager;
	syncEventBus!: SyncEventBus;
	syncRuntimeStore!: SyncRuntimeStore;
	syncStatusBar!: SyncStatusBar;
	fridaySettingTab!: FridaySettingTab;
	pluginUpdateService!: PluginUpdateService;
	groupModelCatalogService!: GroupModelCatalogService;
	officialContentService!: FridayPluginApi["officialContentService"];
	onboardingService!: OnboardingService;
	localStateRootService!: LocalStateRootService;
	runtimeStateStore!: RuntimeStateStore;
	settingsMirrorService!: SettingsMirrorService;
	soulStore!: SoulStore;
	legacyFridayRootMigrationService!: LegacyFridayRootMigrationService;
	legacyAgentMigrationService!: LegacyAgentMigrationService;
	legacyAgentCleanupService!: LegacyAgentCleanupService;
	private legacyAgentProfiles: AgentProfile[] = [];
	private legacyActiveAgentId = "";
	private readonly rawIngestTimers = new Map<string, number>();
	private idleAutoSyncInterval: number | null = null;
	private continuousAutoSyncListenerRegistered = false;
	private compileWikiInFlight: Promise<WikiCompileResult> | null = null;
	private detectedUserId = "";
	private pendingLegacyGitCredentials: ProjectGitCredential | null = null;

	async onload(): Promise<void> {
		try {
			const runtimeProfile = detectRuntimeProfile();
			if (!runtimeProfile.supported) {
				throw new Error(`Unsupported runtime platform: ${runtimeProfile.platform}`);
			}
			this.dataService = new DataService(this.app.vault, PRIMARY_PATHS.root);
			await this.loadSettings();
			this.projectBoundaryService = new ProjectBoundaryService(
				() => this.settings,
				() => (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
			);
			this.secureStorage = new SecureStorage(this.manifest.id);
			if (this.secureStorage.getMode() !== "secure") {
				console.warn("[Friday] System secure credential storage unavailable. Falling back to local plugin storage.");
			new Notice("FRIDAY 未检测到系统安全存储，Git 凭据将仅保存在当前设备的本地插件存储中。", 8000);
			}
			this.localStateRootService = new LocalStateRootService(
				(this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
				this.manifest.id,
			);
			await this.localStateRootService.ensureBaseLayout();
			this.settingsMirrorService = new SettingsMirrorService(this.localStateRootService);
			this.runtimeStateStore = new RuntimeStateStore(this.localStateRootService);
			await this.runtimeStateStore.ensureBaseLayout();
			this.soulStore = new SoulStore(this.localStateRootService);
			this.legacyFridayRootMigrationService = new LegacyFridayRootMigrationService(
				(this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
				this.dataService.getFridayRoot(),
				() => this.settings,
			);
			this.syncEventBus = new SyncEventBus();
			this.syncRuntimeStore = new SyncRuntimeStore(this.syncEventBus);
			const migratedLegacyCredentials = await this.migrateLegacyGitCredentials();
			this.syncService = new SyncService(
				this.app,
				this.dataService.getFridayRoot(),
				() => this.settings,
				this.secureStorage,
				this.projectBoundaryService,
				this.syncEventBus,
			);
			this.autoSyncManager = new AutoSyncManager({
				getSettings: () => ({
					sync: this.settings.sync,
					projects: this.settings.projects,
				}),
				syncService: this.syncService,
				eventBus: this.syncEventBus,
				hasBlockingConflicts: (project) =>
					this.workbenchStateStore
						.getSyncConflicts(project.projectId)
						.some((item) => item.status === "pending" || item.status === "deferred"),
				persistLastSyncAt: async (project, recordedAt) => {
					project.lastSyncAt = recordedAt;
					await this.saveSettings();
				},
			});
			this.pluginUpdateService = new PluginUpdateService({
				pluginId: this.manifest.id,
				currentVersion: this.manifest.version,
				adapter: this.app.vault.adapter as unknown as {
					exists(path: string, sensitive?: boolean): Promise<boolean>;
					mkdir(path: string): Promise<void>;
					read(path: string): Promise<string>;
					write(path: string, data: string): Promise<void>;
					remove(path: string): Promise<void>;
					rename(path: string, newPath: string): Promise<void>;
				},
				getGitRuntimeStatus: () => this.getGitRuntimeStatus(),
				getUserCredential: () => this.getUserGitCredential(),
				getUserGitEmail: () => this.settings.user.gitUserEmail,
			});
			this.groupModelCatalogService = new GroupModelCatalogService({
				getSettings: () => this.settings,
				saveSettings: () => this.saveSettings(),
				getGitRuntimeStatus: () => this.getGitRuntimeStatus(),
				getUserCredential: () => this.getUserGitCredential(),
				getUserGitEmail: () => this.settings.user.gitUserEmail,
			});
			this.officialContentService = new OfficialContentService({
				adapter: this.app.vault.adapter as unknown as {
					exists(path: string, sensitive?: boolean): Promise<boolean>;
					mkdir(path: string): Promise<void>;
					read(path: string): Promise<string>;
					write(path: string, data: string): Promise<void>;
					writeBinary(path: string, data: ArrayBuffer): Promise<void>;
					remove(path: string): Promise<void>;
					rmdir?(path: string, recursive: boolean): Promise<void>;
					list?(path: string): Promise<{ files: string[]; folders: string[] }>;
				},
				getSettings: () => this.settings,
				saveSettings: () => this.saveSettings(),
				getGitRuntimeStatus: () => this.getGitRuntimeStatus(),
				getUserCredential: () => this.getUserGitCredential(),
				getUserGitEmail: () => this.settings.user.gitUserEmail,
				inspectDestructiveApplySafety: ({ ownedTopLevelPaths }) =>
					this.legacyFridayRootMigrationService.inspectDestructiveApplySafety({ ownedTopLevelPaths }),
			});
			this.onboardingService = new OnboardingService(() => this.settings);

			this.agentService = new AgentService(this.app.vault, this.dataService.getFridayRoot());
			const changedByBootstrap = await this.agentService.bootstrap();
			const triggeredRootIndexRecovery = await this.recoverMissingFridayRootIndex();
			if (triggeredRootIndexRecovery) {
				return;
			}

			this.conversationService = new ConversationService(this.runtimeStateStore);
			this.projectContentService = new ProjectContentService(this.app.vault);
			this.ingestEventStore = new IngestEventStore(this.app.vault);
			this.wikiIngestService = new WikiIngestService(
				this.app.vault,
				this.projectContentService,
				this.ingestEventStore,
			);
			this.workspaceAccessService = new WorkspaceAccessService(
				() => this.settings,
				this.projectBoundaryService,
			);
			this.canvasService = new CanvasService();
			this.agentActionService = new AgentActionService(
				this.app.vault,
				this.runtimeStateStore,
				this.workspaceAccessService,
				this.canvasService,
				this.projectBoundaryService,
			);
			this.toolApprovalService = new ToolApprovalService(this.runtimeStateStore, () => this.settings);
			this.legacyAgentMigrationService = new LegacyAgentMigrationService(
				this.app.vault,
				this.settings,
				this.soulStore,
				this.conversationService,
				this.toolApprovalService,
				this.runtimeStateStore,
				this.agentService,
				this.legacyAgentProfiles,
				this.legacyActiveAgentId,
				() => this.saveSettings(),
			);
			this.legacyAgentCleanupService = new LegacyAgentCleanupService(
				this.app.vault,
				this.agentService,
				this.runtimeStateStore,
			);
			const migratedLegacyState = await this.legacyAgentMigrationService.migrateIfNeeded();
			this.commandExecService = new CommandExecService(
				() => (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
				() => this.settings,
			);
			this.inlineEditService = new InlineEditService();
			this.skillCommandService = new SkillCommandService(
				this.workspaceAccessService,
				() => this.settings,
				() => (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
				() => this.getLocale(),
			);
			this.slashCommandService = new SlashCommandService(() => this.settings);
			this.workbenchStateStore = new WorkbenchStateStore();
			this.syncEventBus.subscribe((event) => {
				if (event.type === "sync_stage_changed" || event.type === "sync_completed") {
					this.workbenchStateStore.recordSyncStatusSnapshot({
						projectId: event.projectId,
						stage: event.type === "sync_completed" ? (event.success ? "succeeded" : "failed") : event.stage,
						message: event.type === "sync_completed" ? event.error ?? "" : event.message ?? "",
						recordedAt: event.recordedAt,
					});
				}
			});
			this.executionEventRouter = new EventRouter();
			this.executionPlanner = new ExecutionPlanner();
			this.aiService = new AIService(() => this.getEffectiveLlmSettings());
			this.agentRuntimeService = new AgentRuntimeService(
				this.app.vault,
				this.aiService,
				this.soulStore,
				this.runtimeStateStore,
				this.workspaceAccessService,
				this.agentActionService,
				this.toolApprovalService,
				this.commandExecService,
				this.inlineEditService,
				this.skillCommandService,
				this.projectBoundaryService,
				this.workbenchStateStore,
				(rawPaths?: string[]) => this.compileWikiForActiveProject(rawPaths),
				() => this.settings,
			);
			await this.agentRuntimeService.restorePendingMutationPlans();
			const agentLoopController: AgentLoopController = this.agentRuntimeService.createAgentLoopController();
			this.agentRuntimeFacade = new AgentRuntimeFacade(
				new AgentKernel(agentLoopController),
			);
			this.executionOrchestrator = new ExecutionOrchestrator(
				this.skillCommandService,
				this.agentRuntimeFacade,
			);
			if (WIKI_FEATURE_ENABLED) {
				this.syncService.setPostPullHandler(async (project, pulledFiles, headRevision) => {
					await this.handlePulledRawChanges(project, pulledFiles, headRevision);
				});
				this.registerEvent(
					this.app.vault.on("create", (file) => {
						this.scheduleRawIngest(file, "local_create");
					}),
				);
				this.registerEvent(
					this.app.vault.on("modify", (file) => {
						this.scheduleRawIngest(file, "local_create");
					}),
				);
			}

				const changedBySoulBootstrap = await this.ensureSoulBootstrap();
				if (changedByBootstrap || migratedLegacyCredentials || migratedLegacyState || changedBySoulBootstrap) {
					await this.saveSettings();
				}

			this.registerView(VIEW_TYPE_DAILY_BOARD, (leaf) => new DailyBoardView(leaf, this));
			registerProjectCommands(this);
			registerSyncCommands(this);
			registerInitCommand(this);
			this.fridaySettingTab = new FridaySettingTab(this.app, this);
			this.addSettingTab(this.fridaySettingTab);
			addIcon(FRIDAY_ICON_ID, FRIDAY_ICON_SVG);
			this.addRibbonIcon(FRIDAY_ICON_ID, this.t("app.name"), () => {
				void this.openWorkspaceView();
			});

			const statusBarItem = this.addStatusBarItem() as HTMLElement & { setText(text: string): void };
			statusBarItem.setText(this.t("status.ready"));
			this.syncStatusBar = new SyncStatusBar(
				this.syncRuntimeStore,
				statusBarItem,
				() => this.settings.activeProjectId,
				() => {
					void this.openWorkspaceView();
				},
			);

			this.app.workspace.onLayoutReady(() => {
				if (!this.settings.workbench.openOnStartup) {
					return;
				}
				void this.openWorkspaceView(this.settings.workbench.startupPlacement).catch((error) => {
					console.error("[Friday] Failed to open workbench on startup:", error);
				});
			});

			if (this.settings.sync.syncOnStartup && this.settings.projects.length > 0) {
				void this.runStartupSync();
			}
			if (this.settings.update.checkOnStartup) {
				void this.runStartupPluginUpdateCheck();
			}
			if (this.settings.groupModelCatalog.checkOnStartup) {
				void this.runStartupGroupModelCatalogCheck();
			}
			if (this.settings.officialContent.checkOnStartup) {
				void this.runStartupOfficialContentCheck();
			}

			this.startAutoSync();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Friday] Plugin onload failed:", error);
			new Notice(`FRIDAY 加载异常：${message}`, 8000);
		}
	}

	onunload(): void {
		for (const timer of this.rawIngestTimers.values()) {
			window.clearTimeout(timer);
		}
		this.rawIngestTimers.clear();
		if (this.idleAutoSyncInterval != null) {
			window.clearInterval(this.idleAutoSyncInterval);
			this.idleAutoSyncInterval = null;
		}
		this.syncStatusBar?.destroy();
		this.syncRuntimeStore?.destroy();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAILY_BOARD);
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<FridaySettings> | null;
		const migrated = this.migrateSettings(raw);

		this.settings = {
			...DEFAULT_SETTINGS,
			...migrated,
			locale: resolveLocale(migrated.locale),
			localeFollowSystem: typeof migrated.localeFollowSystem === "boolean"
				? migrated.localeFollowSystem
				: DEFAULT_SETTINGS.localeFollowSystem,
			user: {
				...DEFAULT_SETTINGS.user,
				...(migrated.user ?? {}),
			},
			llm: {
				...normalizeLlmSettings({
					...DEFAULT_SETTINGS.llm,
					...(migrated.llm ?? {}),
				}),
			},
			sync: {
				...DEFAULT_SETTINGS.sync,
				...(migrated.sync ?? {}),
			},
			workbench: {
				...DEFAULT_SETTINGS.workbench,
				...(migrated.workbench ?? {}),
			},
			update: {
				...DEFAULT_SETTINGS.update,
				...(migrated.update ?? {}),
			},
			officialContent: {
				...DEFAULT_SETTINGS.officialContent,
				...(migrated.officialContent ?? {}),
				catalog: migrated.officialContent?.catalog ?? [],
				channels: migrated.officialContent?.channels ?? {},
			},
			groupModelCatalog: {
				...DEFAULT_SETTINGS.groupModelCatalog,
				...(migrated.groupModelCatalog ?? {}),
				models: migrated.groupModelCatalog?.models ?? [],
				defaults: migrated.groupModelCatalog?.defaults ?? {},
			},
			agentRuntime: {
				...DEFAULT_SETTINGS.agentRuntime,
				...(migrated.agentRuntime ?? {}),
			},
			projectGroups: migrated.projectGroups ?? [],
			projects: migrated.projects ?? [],
			activeProjectId: migrated.activeProjectId ?? "",
			activeSoulId: migrated.activeSoulId ?? this.legacyActiveAgentId ?? "",
			slashCommands: migrated.slashCommands ?? [],
		};

		this.detectedUserId = detectUserId();
		if (this.settings.user.autoDetect && !this.settings.user.userId) {
			this.settings.user.userId = this.detectedUserId;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (this.settingsMirrorService) {
			try {
				await this.settingsMirrorService.write(this.settings);
			} catch (error) {
				console.error("[Friday] Failed to write config mirror:", error);
			}
		}
		window.dispatchEvent(new CustomEvent(FRIDAY_SETTINGS_CHANGED_EVENT));
	}

	async setSyncMode(mode: FridaySettings["sync"]["mode"]): Promise<void> {
		if (this.settings.sync.mode === mode) {
			return;
		}
		this.settings.sync.mode = mode;
		await this.saveSettings();
		this.startAutoSync();
	}

	async setProjectAutoSync(projectId: string, enabled: boolean): Promise<void> {
		const project = this.settings.projects.find((item) => item.projectId === projectId);
		if (!project) {
			throw new Error(`未找到项目: ${projectId}`);
		}
		project.autoSync = project.gitState === "git_remote_bound" && Boolean(project.gitRemote) ? enabled : false;
		await this.saveSettings();
		this.startAutoSync();
	}

	getPrimaryUserId(): string {
		return this.settings.user.userId || this.detectedUserId;
	}

	getDetectedUserId(): string {
		return this.detectedUserId || detectUserId();
	}

	listSouls(): SoulSummary[] {
		return this.soulStore.listSoulsSync().filter((item) => !item.archived);
	}

	getActiveSoul(): SoulSummary | null {
		const activeSoulId = this.settings.activeSoulId.trim();
		if (activeSoulId) {
			const activeSoul = this.soulStore.getSoulSync(activeSoulId);
			if (activeSoul && !activeSoul.archived) {
				return activeSoul;
			}
		}
		return this.listSouls()[0] ?? null;
	}

	async setActiveSoul(soulId: string): Promise<void> {
		const target = this.soulStore.getSoulSync(soulId);
		if (!target || target.archived) {
			throw new Error(`未找到 Soul: ${soulId}`);
		}
		this.settings.activeSoulId = soulId;
		await this.soulStore.setActiveSoul(soulId);
		await this.saveSettings();
	}

	async createSoul(input: { name: string; summary: string; description?: string }): Promise<SoulSummary> {
		const created = await this.soulStore.createSoul({
			name: input.name,
			summary: input.summary,
			description: input.description,
		});
		this.settings.activeSoulId = created.id;
		await this.soulStore.setActiveSoul(created.id);
		await this.saveSettings();
		return created;
	}

	async resetBuiltInSoulPreset(soulId: string): Promise<SoulSummary> {
		const existing = this.soulStore.getSoulSync(soulId);
		if (!existing || !this.isBuiltInSoulResettable(existing)) {
			throw new Error(`Built-in Soul preset not found: ${soulId}`);
		}
		const updated = await this.applyBuiltInSoulPreset(soulId);
		if (this.settings.activeSoulId === soulId) {
			this.settings.activeSoulId = soulId;
		}
		await this.saveSettings();
		return updated;
	}

	async upsertProject(project: ProjectEntry): Promise<void> {
		const normalizedProject = this.normalizeProjectEntry(project);
		const existingIndex = this.settings.projects.findIndex((item) => item.projectId === normalizedProject.projectId);
		if (existingIndex >= 0) {
			this.settings.projects[existingIndex] = normalizedProject;
		} else {
			this.settings.projects.push(normalizedProject);
		}

		this.ensureProjectGroupInSettings(normalizedProject.groupId);
		for (const group of this.settings.projectGroups) {
			const nextProjectIds = group.projectIds.filter((projectId) => projectId !== normalizedProject.projectId);
			if (group.id === normalizedProject.groupId) {
				nextProjectIds.push(normalizedProject.projectId);
			}
			group.projectIds = nextProjectIds;
			group.updatedAt = new Date().toISOString();
		}

		if (!this.settings.activeProjectId) {
			this.settings.activeProjectId = normalizedProject.projectId;
		}
		await this.saveSettings();
		window.dispatchEvent(new CustomEvent(PROJECT_STATE_CHANGED_EVENT));
		this.startAutoSync();
	}

	async removeProject(projectId: string): Promise<void> {
		this.settings.projects = this.settings.projects.filter((project) => project.projectId !== projectId);
		for (const group of this.settings.projectGroups) {
			group.projectIds = group.projectIds.filter((item) => item !== projectId);
		}
		if (this.settings.activeProjectId === projectId) {
			this.settings.activeProjectId = this.settings.projects[0]?.projectId ?? "";
		}
		if (this.secureStorage) {
			await this.setProjectGitCredential(projectId, null);
		}
		await this.saveSettings();
		window.dispatchEvent(new CustomEvent(PROJECT_STATE_CHANGED_EVENT));
		this.startAutoSync();
	}

	async setActiveProject(projectId: string): Promise<void> {
		const target = this.settings.projects.find((item) => item.projectId === projectId);
		if (!target) {
			throw new Error(`未找到项目: ${projectId}`);
		}
		this.settings.activeProjectId = target.projectId;
		this.syncStatusBar?.refresh();
		await this.saveSettings();
		window.dispatchEvent(new CustomEvent(PROJECT_STATE_CHANGED_EVENT));
	}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		return this.secureStorage.getProjectGitCredential(projectId);
	}

	async setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void> {
		await this.secureStorage.setProjectGitCredential(projectId, credential);
	}

	async getUserGitCredential(): Promise<ProjectGitCredential | null> {
		return this.secureStorage.getUserGitCredential();
	}

	async setUserGitCredential(credential: ProjectGitCredential | null): Promise<void> {
		await this.secureStorage.setUserGitCredential(credential);
	}

	async upsertProjectGroup(group: ProjectGroupEntry): Promise<void> {
		const normalizedGroup = this.normalizeProjectGroupEntry(group);
		const existingIndex = this.settings.projectGroups.findIndex((item) => item.id === normalizedGroup.id);
		if (existingIndex >= 0) {
			this.settings.projectGroups[existingIndex] = normalizedGroup;
		} else {
			this.settings.projectGroups.push(normalizedGroup);
		}
		await this.saveSettings();
	}

	async removeProjectGroup(groupId: string): Promise<void> {
		if (groupId === DEFAULT_PROJECT_GROUP_ID) {
			throw new Error("默认项目组不可删除");
		}
		const defaultGroup = this.ensureProjectGroupInSettings(DEFAULT_PROJECT_GROUP_ID);
		const movedProjects = this.settings.projects.filter((item) => item.groupId === groupId);
		for (const project of movedProjects) {
			project.groupId = defaultGroup.id;
			if (!defaultGroup.projectIds.includes(project.projectId)) {
				defaultGroup.projectIds.push(project.projectId);
			}
		}
		this.settings.projectGroups = this.settings.projectGroups.filter((group) => group.id !== groupId);
		await this.saveSettings();
	}

	openSettingsTab(section?: string): void {
		const manager = this.app as typeof this.app & {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};
		if (isFridaySettingsSection(section)) {
			this.fridaySettingTab?.focusSection(section);
		}
		manager.setting?.open();
		manager.setting?.openTabById(this.manifest.id);
		if (isFridaySettingsSection(section)) {
			this.fridaySettingTab?.display();
		}
	}

	getLocale(): LocaleCode {
		if (this.settings.localeFollowSystem) {
			return resolveLocale(window.navigator.language);
		}
		return resolveLocale(this.settings.locale);
	}

	t(key: string, params?: I18nParams): string {
		return translate(this.getLocale(), key, params);
	}

	async getGitRuntimeStatus() {
		return this.syncService.getGitRuntimeStatus();
	}

	async openWorkspaceView(placement: FridaySettings["workbench"]["startupPlacement"] = this.settings.workbench.startupPlacement): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_BOARD);
		let leaf: WorkspaceLeaf | null = leaves[0] ?? null;
		if (!leaf) {
			leaf = this.getWorkspaceLeafForPlacement(placement) ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
		}
		await leaf.setViewState({
			type: VIEW_TYPE_DAILY_BOARD,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private getWorkspaceLeafForPlacement(placement: FridaySettings["workbench"]["startupPlacement"]): WorkspaceLeaf | null {
		switch (placement) {
			case "left-sidebar":
				return this.app.workspace.getLeftLeaf(false);
			case "right-sidebar":
				return this.app.workspace.getRightLeaf(false);
			default:
				return this.app.workspace.getRightLeaf(false);
		}
	}

	async reloadFridayPlugin(): Promise<void> {
		const appWithPlugins = this.app as typeof this.app & {
			plugins?: {
				disablePlugin?: (pluginId: string) => Promise<void> | void;
				enablePlugin?: (pluginId: string) => Promise<void> | void;
			};
		};
		const pluginId = this.manifest.id;
		const disablePlugin = appWithPlugins.plugins?.disablePlugin;
		const enablePlugin = appWithPlugins.plugins?.enablePlugin;
		if (typeof disablePlugin === "function" && typeof enablePlugin === "function") {
			try {
				await Promise.resolve(disablePlugin.call(appWithPlugins.plugins, pluginId));
				window.setTimeout(() => {
					void Promise.resolve(enablePlugin.call(appWithPlugins.plugins, pluginId)).catch((error) => {
						console.warn("[Friday] Failed to re-enable plugin after disable; falling back to app reload.", error);
						this.reloadObsidianApp();
					});
				}, 0);
				return;
			} catch (error) {
				console.warn("[Friday] Failed to reload plugin in place, falling back to app reload.", error);
			}
		}
		this.reloadObsidianApp();
	}

	reloadObsidianApp(): void {
		const appWithCommands = this.app as typeof this.app & {
			commands?: {
				executeCommandById?: (commandId: string) => boolean;
			};
		};
		try {
			const executeCommandById = appWithCommands.commands?.executeCommandById;
			if (typeof executeCommandById === "function") {
				const handled = executeCommandById("app:reload");
				if (handled !== false) {
					return;
				}
			}
		} catch (error) {
			console.warn("[Friday] Failed to invoke Obsidian reload command, falling back to window reload.", error);
		}
		window.location.reload();
	}

	private async recoverMissingFridayRootIndex(): Promise<boolean> {
		const fridayRoot = this.dataService.getFridayRoot();
		const storageKey = `${ROOT_INDEX_RECOVERY_STORAGE_KEY}:${this.app.vault.getName()}:${fridayRoot.toLowerCase()}`;
		const indexedRoot = this.app.vault.getAbstractFileByPath(fridayRoot);
		if (indexedRoot) {
			window.localStorage.removeItem(storageKey);
			return false;
		}

		const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
			exists?: (path: string, sensitive?: boolean) => Promise<boolean>;
		};
		if (typeof adapter.exists !== "function") {
			return false;
		}

		let existsOnDisk = false;
		try {
			existsOnDisk = await adapter.exists(fridayRoot, false);
		} catch (error) {
			console.warn("[Friday] Failed to probe friday root on disk.", error);
			return false;
		}
		if (!existsOnDisk) {
			window.localStorage.removeItem(storageKey);
			return false;
		}

		const lastAttemptAt = Number(window.localStorage.getItem(storageKey) ?? "0");
		if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < ROOT_INDEX_RECOVERY_WINDOW_MS) {
			console.warn("[Friday] Friday root exists on disk but is still missing from the vault index.", { fridayRoot });
			new Notice(
				"检测到 F.R.I.D.A.Y 目录已存在于磁盘，但当前 Vault 没有收录它。请重新打开这个 Vault；如果持续复现，请反馈 Obsidian 版本与 .obsidian/app.json。",
				10000,
			);
			return false;
		}

		window.localStorage.setItem(storageKey, String(Date.now()));
		console.warn("[Friday] Friday root exists on disk but is missing from the current vault index. Reloading once.", {
			fridayRoot,
		});
		new Notice(
			"检测到 F.R.I.D.A.Y 目录已存在于磁盘，但当前文件树没有收录；正在自动重载一次 Obsidian 以恢复索引。",
			8000,
		);
		window.setTimeout(() => {
			this.reloadObsidianApp();
		}, 250);
		return true;
	}

	private getEffectiveLlmSettings(): FridaySettings["llm"] {
		const activeSoul = this.getActiveSoulDefinition();
		const baseSettings = activeSoul?.preferredModelMode
			? switchLlmMode(this.settings.llm, activeSoul.preferredModelMode)
			: this.settings.llm;
		return {
			...baseSettings,
			model: activeSoul?.preferredModel?.trim() || baseSettings.model,
		};
	}

	private getActiveSoulDefinition(): SoulDefinition | null {
		const activeSoulId = this.settings.activeSoulId.trim();
		if (activeSoulId) {
			const activeSoul = this.soulStore.getSoulSync(activeSoulId);
			if (activeSoul && !activeSoul.archived) {
				return activeSoul as SoulDefinition;
			}
		}
		const fallback = this.listSouls()[0];
		if (!fallback) {
			return null;
		}
		return this.soulStore.getSoulSync(fallback.id) as SoulDefinition | null;
	}

	private async ensureSoulBootstrap(): Promise<boolean> {
		let souls = await this.soulStore.listSouls();
		let changed = false;
		if (souls.length === 0) {
			await this.soulStore.createSoul({
				id: "default",
				name: NATIVE_FRIDAY_SOUL_PRESET.name,
				summary: NATIVE_FRIDAY_SOUL_PRESET.summary,
				description: NATIVE_FRIDAY_SOUL_PRESET.description,
			});
			await this.applyBuiltInSoulPreset("default");
			souls = await this.soulStore.listSouls();
			changed = true;
		}

		for (const soul of souls) {
			if (!soul.id.startsWith("default")) {
				continue;
			}
			const soulDefinition = this.soulStore.getSoulSync(soul.id);
			const shouldRefreshPreset = soulDefinition ? this.shouldRefreshBuiltInSoulPreset(soulDefinition) : true;
			if (!shouldRefreshPreset) {
				continue;
			}
			await this.applyBuiltInSoulPreset(soul.id);
			changed = true;
		}
		if (changed) {
			souls = await this.soulStore.listSouls();
		}

		const requestedSoulId = this.settings.activeSoulId.trim();
		const resolvedSoulId =
			(requestedSoulId && souls.some((item) => item.id === requestedSoulId) ? requestedSoulId : "") ||
			souls[0]?.id ||
			"";
		if (resolvedSoulId && resolvedSoulId !== this.settings.activeSoulId) {
			this.settings.activeSoulId = resolvedSoulId;
			changed = true;
		}
		if (resolvedSoulId) {
			await this.soulStore.setActiveSoul(resolvedSoulId);
		}
		return changed;
	}

	private isBuiltInSoulResettable(soul: Pick<SoulDefinition, "id" | "builtIn">): boolean {
		return soul.builtIn && soul.id.startsWith("default");
	}

	private shouldRefreshBuiltInSoulPreset(
		soul: Pick<
			SoulDefinition,
			| "id"
			| "name"
			| "summary"
			| "description"
			| "rolePrompt"
			| "tonePreset"
			| "tonePrompt"
			| "behaviorRules"
			| "antiPatterns"
			| "builtIn"
			| "builtInPresetVersion"
		>,
	): boolean {
		const nextName = soul.name?.trim() ?? "";
		const nextSummary = soul.summary?.trim() ?? "";
		if (
			!nextName ||
			nextName === "默认 Soul" ||
			nextName === "默认 Agent" ||
			nextSummary === "系统默认通用助手" ||
			!soul.rolePrompt?.trim()
		) {
			return true;
		}
		if (!this.isBuiltInSoulResettable(soul)) {
			return false;
		}
		const currentVersion = soul.builtInPresetVersion ?? 0;
		if (currentVersion >= NATIVE_FRIDAY_SOUL_PRESET_VERSION) {
			return false;
		}
		return (
			matchesBuiltInSoulPreset(soul, LEGACY_NATIVE_FRIDAY_SOUL_PRESET) ||
			matchesBuiltInSoulPreset(soul, NATIVE_FRIDAY_SOUL_PRESET)
		);
	}

	private async applyBuiltInSoulPreset(soulId: string): Promise<SoulDefinition> {
		return this.soulStore.updateSoul(soulId, {
			...NATIVE_FRIDAY_SOUL_PRESET,
			description: NATIVE_FRIDAY_SOUL_PRESET.description,
			rolePrompt: NATIVE_FRIDAY_SOUL_PRESET.rolePrompt,
			builtInPresetVersion: NATIVE_FRIDAY_SOUL_PRESET_VERSION,
		});
	}

	private migrateSettings(raw: Partial<FridaySettings> | null): Partial<FridaySettings> {
		if (!raw) {
			this.legacyAgentProfiles = [];
			this.legacyActiveAgentId = "";
			return {
				version: SETTINGS_VERSION,
				user: { ...DEFAULT_SETTINGS.user },
				workbench: { ...DEFAULT_SETTINGS.workbench },
				officialContent: { ...DEFAULT_SETTINGS.officialContent },
				projectGroups: [this.createDefaultProjectGroup()],
				projects: [],
				activeProjectId: "",
			};
		}

		const rawWithLegacy = raw as Partial<FridaySettings> & {
			agents?: AgentProfile[];
			activeAgentId?: string;
		};
		this.legacyAgentProfiles = Array.isArray(rawWithLegacy.agents)
			? rawWithLegacy.agents
				.filter((item): item is AgentProfile => Boolean(item?.id?.trim()))
				.map((item) => ({
					...item,
					id: item.id.trim(),
					name: item.name?.trim() || item.id.trim(),
					description: item.description?.trim() || "",
					model: item.model?.trim() || "",
					modelMode: item.model?.trim() ? item.modelMode : undefined,
					agentFilePath: item.agentFilePath?.trim() || "",
					createdAt: item.createdAt || new Date().toISOString(),
					updatedAt: item.updatedAt || new Date().toISOString(),
				}))
			: [];
		this.legacyActiveAgentId = typeof rawWithLegacy.activeAgentId === "string"
			? rawWithLegacy.activeAgentId.trim()
			: "";

		const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
		const rawUser = (raw.user ?? {}) as Partial<FridaySettings["user"]> & {
			gitUsername?: string;
			gitToken?: string;
		};
		const legacyCredentialSource = rawProjects.find((item) => {
			const candidate = item as ProjectEntry & {
				gitUsername?: string;
				gitUserEmail?: string;
				gitToken?: string;
			};
			return Boolean(candidate.gitUsername?.trim() || candidate.gitUserEmail?.trim() || candidate.gitToken?.trim());
		}) as (ProjectEntry & {
			gitUsername?: string;
			gitUserEmail?: string;
			gitToken?: string;
		}) | undefined;
		const legacyUsername = rawUser.gitUsername?.trim() || legacyCredentialSource?.gitUsername?.trim() || "";
		const legacyToken = rawUser.gitToken?.trim() || legacyCredentialSource?.gitToken?.trim() || "";
		this.pendingLegacyGitCredentials =
			legacyUsername && legacyToken
				? {
					username: legacyUsername,
					token: legacyToken,
				}
				: null;
		const migratedUser = {
			userId: rawUser.userId?.trim() || DEFAULT_SETTINGS.user.userId,
			displayName: rawUser.displayName?.trim() || DEFAULT_SETTINGS.user.displayName,
			autoDetect: typeof rawUser.autoDetect === "boolean" ? rawUser.autoDetect : DEFAULT_SETTINGS.user.autoDetect,
			gitUserEmail: rawUser.gitUserEmail?.trim() || legacyCredentialSource?.gitUserEmail?.trim() || "",
		};
		const normalizedProjects = rawProjects.map((item) => this.normalizeProjectEntry(item as ProjectEntry));
		const migratedGroups = this.migrateProjectGroups(
			(raw as { projectGroups?: ProjectGroupEntry[] }).projectGroups,
			normalizedProjects,
		);
		const activeProjectId = this.resolveInitialActiveProjectId(raw.activeProjectId, normalizedProjects);
		const rawSync = (raw.sync ?? {}) as Partial<FridaySettings["sync"]> & {
			autoPush?: boolean;
			syncInterval?: number;
		};
		const rawWorkbench = (raw.workbench ?? {}) as Partial<FridaySettings["workbench"]>;
		const rawOfficialContent = (raw.officialContent ?? {}) as Partial<FridaySettings["officialContent"]>;
		const rawGroupModelCatalog = (raw.groupModelCatalog ?? {}) as Partial<FridaySettings["groupModelCatalog"]>;
		const migratedSyncMode =
			rawSync.mode ??
			(rawSync.autoPush ? "continuous_auto" : (rawSync.syncInterval ?? 0) > 0 ? "idle_auto" : "manual");
		const migratedSync = {
			mode: migratedSyncMode,
			idleMinutes: typeof rawSync.idleMinutes === "number" ? rawSync.idleMinutes : rawSync.syncInterval ?? 0,
			syncOnStartup:
				typeof rawSync.syncOnStartup === "boolean" ? rawSync.syncOnStartup : DEFAULT_SETTINGS.sync.syncOnStartup,
		};
		const migratedWorkbench = {
			openOnStartup:
				typeof rawWorkbench.openOnStartup === "boolean"
					? rawWorkbench.openOnStartup
					: DEFAULT_SETTINGS.workbench.openOnStartup,
			startupPlacement: isWorkbenchStartupPlacement(rawWorkbench.startupPlacement)
				? rawWorkbench.startupPlacement
				: DEFAULT_SETTINGS.workbench.startupPlacement,
			onboardingDismissed:
				typeof rawWorkbench.onboardingDismissed === "boolean"
					? rawWorkbench.onboardingDismissed
					: DEFAULT_SETTINGS.workbench.onboardingDismissed,
		};
		const migratedOfficialContent = {
			...DEFAULT_SETTINGS.officialContent,
			checkOnStartup:
				typeof rawOfficialContent.checkOnStartup === "boolean"
					? rawOfficialContent.checkOnStartup
					: DEFAULT_SETTINGS.officialContent.checkOnStartup,
			startupDelayMs:
				typeof rawOfficialContent.startupDelayMs === "number"
					? rawOfficialContent.startupDelayMs
					: DEFAULT_SETTINGS.officialContent.startupDelayMs,
			lastCheckedAt:
				typeof rawOfficialContent.lastCheckedAt === "string" ? rawOfficialContent.lastCheckedAt : "",
			lastCatalogVersion:
				typeof rawOfficialContent.lastCatalogVersion === "string" ? rawOfficialContent.lastCatalogVersion : "",
			catalog: Array.isArray(rawOfficialContent.catalog)
				? rawOfficialContent.catalog
					.filter((item): item is OfficialContentCatalogEntry =>
						Boolean(item?.id?.trim() && item?.path?.trim()),
					)
					.map((item): OfficialContentCatalogEntry => ({
						id: item.id.trim(),
						title: item.title?.trim() || item.path.trim(),
						kind: item.kind === "directory" ? "directory" : "file",
						path: item.path.trim(),
						version: item.version?.trim() || "",
						manifestPath: item.manifestPath?.trim() || "",
					}))
				: [],
			channels: Object.fromEntries(
				Object.entries(rawOfficialContent.channels ?? {})
					.filter(([id]) => id.trim())
					.map(([id, value]) => [
						id.trim(),
						{
							subscribed: value?.subscribed === true,
							lastAppliedVersion:
								typeof value?.lastAppliedVersion === "string" ? value.lastAppliedVersion : "",
							path: typeof value?.path === "string" ? value.path.trim() : "",
						},
					]),
			),
		};
		const migratedGroupModelCatalog = {
			...DEFAULT_SETTINGS.groupModelCatalog,
			enabled:
				typeof rawGroupModelCatalog.enabled === "boolean"
					? rawGroupModelCatalog.enabled
					: DEFAULT_SETTINGS.groupModelCatalog.enabled,
			checkOnStartup:
				typeof rawGroupModelCatalog.checkOnStartup === "boolean"
					? rawGroupModelCatalog.checkOnStartup
					: DEFAULT_SETTINGS.groupModelCatalog.checkOnStartup,
			startupDelayMs:
				typeof rawGroupModelCatalog.startupDelayMs === "number"
					? rawGroupModelCatalog.startupDelayMs
					: DEFAULT_SETTINGS.groupModelCatalog.startupDelayMs,
			repoUrl:
				typeof rawGroupModelCatalog.repoUrl === "string" && rawGroupModelCatalog.repoUrl.trim()
					? rawGroupModelCatalog.repoUrl.trim()
					: DEFAULT_SETTINGS.groupModelCatalog.repoUrl,
			branch:
				typeof rawGroupModelCatalog.branch === "string" && rawGroupModelCatalog.branch.trim()
					? rawGroupModelCatalog.branch.trim()
					: DEFAULT_SETTINGS.groupModelCatalog.branch,
			filePath:
				typeof rawGroupModelCatalog.filePath === "string" && rawGroupModelCatalog.filePath.trim()
					? rawGroupModelCatalog.filePath.trim()
					: DEFAULT_SETTINGS.groupModelCatalog.filePath,
			lastCheckedAt:
				typeof rawGroupModelCatalog.lastCheckedAt === "string" ? rawGroupModelCatalog.lastCheckedAt : "",
			lastCatalogVersion:
				typeof rawGroupModelCatalog.lastCatalogVersion === "string" ? rawGroupModelCatalog.lastCatalogVersion : "",
			lastResult:
				rawGroupModelCatalog.lastResult === "updated" ||
				rawGroupModelCatalog.lastResult === "up-to-date" ||
				rawGroupModelCatalog.lastResult === "error"
					? rawGroupModelCatalog.lastResult
					: DEFAULT_SETTINGS.groupModelCatalog.lastResult,
			lastError:
				typeof rawGroupModelCatalog.lastError === "string" ? rawGroupModelCatalog.lastError : "",
			providerId:
				typeof rawGroupModelCatalog.providerId === "string" ? rawGroupModelCatalog.providerId.trim() : "",
			providerName:
				typeof rawGroupModelCatalog.providerName === "string" ? rawGroupModelCatalog.providerName.trim() : "",
			models: Array.isArray(rawGroupModelCatalog.models)
				? rawGroupModelCatalog.models
					.filter((model) => Boolean(model?.id?.trim()))
					.map((model) => ({
						id: model.id.trim(),
						label: model.label?.trim() || model.id.trim(),
						enabled: model.enabled !== false,
						capabilities: model.capabilities && typeof model.capabilities === "object"
							? { ...model.capabilities }
							: {},
					}))
				: [],
			defaults: rawGroupModelCatalog.defaults && typeof rawGroupModelCatalog.defaults === "object"
				? { ...rawGroupModelCatalog.defaults }
				: {},
		};

		return {
			...raw,
			version: SETTINGS_VERSION,
			user: migratedUser,
			sync: migratedSync,
			workbench: migratedWorkbench,
			officialContent: migratedOfficialContent,
			groupModelCatalog: migratedGroupModelCatalog,
			projects: normalizedProjects,
			projectGroups: migratedGroups,
			activeProjectId,
			activeSoulId: raw.activeSoulId?.trim() || this.legacyActiveAgentId || "",
		};
	}

	private migrateProjectGroups(
		rawGroups: ProjectGroupEntry[] | undefined,
		projects: ProjectEntry[],
	): ProjectGroupEntry[] {
		const now = new Date().toISOString();
		const groupMap = new Map<string, ProjectGroupEntry>();
		const sourceGroups = Array.isArray(rawGroups) ? rawGroups : [];
		for (const group of sourceGroups) {
			const normalized = this.normalizeProjectGroupEntry(group);
			groupMap.set(normalized.id, normalized);
		}
		if (!groupMap.has(DEFAULT_PROJECT_GROUP_ID)) {
			groupMap.set(DEFAULT_PROJECT_GROUP_ID, this.createDefaultProjectGroup(now));
		}

		for (const project of projects) {
			const groupId = project.groupId || DEFAULT_PROJECT_GROUP_ID;
			if (!groupMap.has(groupId)) {
				groupMap.set(
					groupId,
					this.normalizeProjectGroupEntry({
						id: groupId,
						name: groupId === DEFAULT_PROJECT_GROUP_ID ? "默认项目组" : groupId,
						description: "",
						projectIds: [],
						createdAt: now,
						updatedAt: now,
					}),
				);
			}
			const group = groupMap.get(groupId)!;
			if (!group.projectIds.includes(project.projectId)) {
				group.projectIds.push(project.projectId);
			}
		}

		const validSlugs = new Set(projects.map((item) => item.projectId));
		for (const group of groupMap.values()) {
			group.projectIds = [...new Set(group.projectIds.filter((projectId) => validSlugs.has(projectId)))];
			group.updatedAt = now;
		}

		return [...groupMap.values()];
	}

	private resolveInitialActiveProjectId(
		activeProjectId: string | undefined,
		projects: ProjectEntry[],
	): string {
		const requestedId = (activeProjectId ?? "").trim();
		if (requestedId && projects.some((item) => item.projectId === requestedId)) {
			return requestedId;
		}
		return projects[0]?.projectId ?? "";
	}

	private normalizeProjectEntry(
		project: ProjectEntry & {
			projectRootPath?: string;
			localPath?: string;
			gitUsername?: string;
			gitUserEmail?: string;
			gitToken?: string;
		},
	): ProjectEntry {
		const legacyProject = project;
		const {
			projectRootPath: legacyProjectRootPath,
			localPath: legacyLocalPath,
			gitUsername: _legacyGitUsername,
			gitUserEmail: _legacyGitUserEmail,
			gitToken: _legacyGitToken,
			...rest
		} = legacyProject;
		void legacyProjectRootPath;
		void legacyLocalPath;
		void _legacyGitUsername;
		void _legacyGitUserEmail;
		void _legacyGitToken;
		const normalizedProjectId = (project.projectId ?? project.slug ?? "").trim();
		const normalizedGroupId = (project.groupId ?? "").trim() || DEFAULT_PROJECT_GROUP_ID;
		const normalizedRootPath = this.resolveProjectRootPath({ ...project, projectId: normalizedProjectId });
		const normalizedRemote = project.gitRemote?.trim() || "";
		const normalizedName = (project.projectName ?? normalizedProjectId).trim() || normalizedProjectId;
		const normalizedGitState = project.gitState ?? (normalizedRemote ? "git_remote_bound" : "none");
		return {
			...rest,
			projectId: normalizedProjectId,
			projectName: normalizedName,
			boundaryPath: normalizedRootPath,
			gitState: normalizedGitState,
			slug: normalizedProjectId,
			groupId: normalizedGroupId,
			gitRemote: normalizedRemote,
			autoSync: normalizedRemote ? Boolean(project.autoSync) : false,
			lastSyncAt: project.lastSyncAt ?? "",
		};
	}

	private resolveProjectRootPath(
		project: Pick<ProjectEntry, "boundaryPath" | "projectId" | "slug"> & {
			projectRootPath?: string;
			localPath?: string;
		},
	): string {
		const candidateRoot = project.boundaryPath?.trim() || project.projectRootPath?.trim();
		if (candidateRoot === "/") {
			return "/";
		}
		if (candidateRoot && !candidateRoot.match(/^[a-zA-Z]:\\/)) {
			return normalizeVaultPath(candidateRoot);
		}
		const localPath = project.localPath?.trim() ?? "";
		if (localPath && !localPath.match(/^[a-zA-Z]:\\/)) {
			return normalizeVaultPath(localPath);
		}
		return normalizeVaultPath(`${PRIMARY_PATHS.root}/${PRIMARY_PATHS.projects}/${project.projectId ?? project.slug}`);
	}

	private async migrateLegacyGitCredentials(): Promise<boolean> {
		if (!this.pendingLegacyGitCredentials || !this.secureStorage) {
			return false;
		}
		let wroteAny = false;
		for (const project of this.settings.projects) {
			const projectId = project.projectId || project.slug;
			if (!projectId) {
				continue;
			}
			const existing = await this.secureStorage.getProjectGitCredential(projectId);
			if (existing) {
				continue;
			}
			await this.secureStorage.setProjectGitCredential(projectId, this.pendingLegacyGitCredentials);
			wroteAny = true;
		}
		this.pendingLegacyGitCredentials = null;
		return wroteAny;
	}

	private normalizeProjectGroupEntry(group: ProjectGroupEntry): ProjectGroupEntry {
		const now = new Date().toISOString();
		const id = (group.id ?? "").trim() || DEFAULT_PROJECT_GROUP_ID;
		return {
			id,
			name: (group.name ?? "").trim() || (id === DEFAULT_PROJECT_GROUP_ID ? "默认项目组" : id),
			description: (group.description ?? "").trim(),
			projectIds: [
				...new Set(((group as ProjectGroupEntry & { projectSlugs?: string[] }).projectIds ?? (group as ProjectGroupEntry & { projectSlugs?: string[] }).projectSlugs ?? [])
					.map((item) => item.trim())
					.filter(Boolean)),
			],
			createdAt: group.createdAt || now,
			updatedAt: now,
		};
	}

	private createDefaultProjectGroup(now = new Date().toISOString()): ProjectGroupEntry {
		return {
			id: DEFAULT_PROJECT_GROUP_ID,
			name: "默认项目组",
			description: "",
			projectIds: [],
			createdAt: now,
			updatedAt: now,
		};
	}

	private ensureProjectGroupInSettings(groupId: string): ProjectGroupEntry {
		const normalizedId = groupId?.trim() || DEFAULT_PROJECT_GROUP_ID;
		let found = this.settings.projectGroups.find((item) => item.id === normalizedId);
		if (found) {
			return found;
		}
		found = this.normalizeProjectGroupEntry({
			id: normalizedId,
			name: normalizedId === DEFAULT_PROJECT_GROUP_ID ? "默认项目组" : normalizedId,
			description: "",
			projectIds: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		this.settings.projectGroups.push(found);
		return found;
	}

	private scheduleRawIngest(file: TAbstractFile, sourceType: SourceType): void {
		if (!WIKI_FEATURE_ENABLED) {
			return;
		}
		const rawPath = normalizePath(file.path || "");
		if (!rawPath) {
			return;
		}
		const previousTimer = this.rawIngestTimers.get(rawPath);
		if (previousTimer != null) {
			window.clearTimeout(previousTimer);
		}
		const timer = window.setTimeout(() => {
			this.rawIngestTimers.delete(rawPath);
			void this.runLocalRawIngest(rawPath, sourceType);
		}, 700);
		this.rawIngestTimers.set(rawPath, timer);
	}

	private async runLocalRawIngest(rawPath: string, sourceType: SourceType): Promise<void> {
		if (!WIKI_FEATURE_ENABLED) {
			return;
		}
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (!activeProject) {
			return;
		}
		try {
			await this.runIngestForRawPaths(activeProject, [rawPath], sourceType, "", false);
		} catch (error) {
			console.error("[Friday] Local raw ingest failed:", error);
		}
	}

	private async handlePulledRawChanges(
		project: ProjectEntry,
		pulledFiles: string[],
		headRevision: string,
	): Promise<void> {
		if (!WIKI_FEATURE_ENABLED) {
			return;
		}
		if (this.settings.activeProjectId && project.projectId !== this.settings.activeProjectId) {
			return;
		}
		const projectRoot = this.projectBoundaryService.getProjectRoot(project);
		const rawPaths = pulledFiles
			.map((item) => normalizePath(`${projectRoot}/${item}`))
			.filter((item) => this.projectContentService.isRawPath(projectRoot, item));
		if (rawPaths.length === 0) {
			return;
		}
		try {
			await this.runIngestForRawPaths(project, rawPaths, "git_sync", headRevision, true);
		} catch (error) {
			console.error("[Friday] Git sync raw ingest failed:", error);
		}
	}

	private async runIngestForRawPaths(
		project: ProjectEntry,
		rawPaths: string[],
		sourceType: SourceType,
		sourceCommit: string,
		showFailureNotice: boolean,
		rethrowError = false,
		forceRebuild = false,
	): Promise<IngestSummary> {
		if (!WIKI_FEATURE_ENABLED) {
			return {
				processed: 0,
				succeeded: 0,
				failed: 0,
				events: [],
				updatedDocs: [],
				updatedIndex: "",
				updatedLog: "",
			};
		}
		const projectRoot = this.projectBoundaryService.getProjectRoot(project);
		const scopedRawPaths = [...new Set(rawPaths.map((item) => normalizePath(item)))].filter(
			(item) =>
				this.projectContentService.isRawPath(projectRoot, item) &&
				this.projectBoundaryService.isWithinProject(project, item),
		);
		if (scopedRawPaths.length === 0) {
			return {
				processed: 0,
				succeeded: 0,
				failed: 0,
				events: [],
				updatedDocs: [],
				updatedIndex: "",
				updatedLog: "",
			};
		}

		try {
			const summary = await this.wikiIngestService.ingestRawFiles(
				project,
				scopedRawPaths,
				this.buildRawSourceContext(sourceType, project, sourceCommit),
				{ forceRebuild },
			);
			if (showFailureNotice && summary.failed > 0) {
				new Notice(
					`Wiki re-ingest finished with ${summary.failed} failed file(s) in project ${project.slug}.`,
					6000,
				);
			}
			return summary;
		} catch (error) {
			console.error("[Friday] Wiki ingest failed:", error);
			if (showFailureNotice) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Wiki re-ingest failed: ${message}`, 6000);
			}
			if (rethrowError) {
				throw error;
			}
			return {
				processed: 0,
				succeeded: 0,
				failed: scopedRawPaths.length,
				events: [],
				updatedDocs: [],
				updatedIndex: "",
				updatedLog: "",
			};
		}
	}

	async compileWikiForActiveProject(rawPaths?: string[], forceRebuild = true): Promise<WikiCompileResult> {
		if (!WIKI_FEATURE_ENABLED) {
			throw new Error("Wiki feature is disabled.");
		}
		if (this.compileWikiInFlight) {
			return this.compileWikiInFlight;
		}

		const task = this.compileWikiForActiveProjectInternal(rawPaths, forceRebuild);
		this.compileWikiInFlight = task.finally(() => {
			if (this.compileWikiInFlight === task) {
				this.compileWikiInFlight = null;
			}
		});
		return this.compileWikiInFlight;
	}

	private async compileWikiForActiveProjectInternal(rawPaths?: string[], forceRebuild = true): Promise<WikiCompileResult> {
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (!activeProject) {
			throw new Error("No active project selected.");
		}
		const projectRoot = this.projectBoundaryService.getProjectRoot(activeProject);
		const normalizedRequested = Array.isArray(rawPaths)
			? [...new Set(rawPaths.map((item) => this.resolveRequestedRawPath(projectRoot, item)).filter(Boolean))]
			: [];
		const targetRawPaths = normalizedRequested.length > 0
			? normalizedRequested
			: await this.projectContentService.listRawFiles(projectRoot);
		const scopedRawPaths = targetRawPaths.filter(
			(item) =>
				this.projectContentService.isRawPath(projectRoot, item) &&
				this.projectBoundaryService.isWithinProject(activeProject, item),
		);

		if (scopedRawPaths.length === 0) {
			if (normalizedRequested.length > 0) {
				throw new Error(`No valid raw files found in active project: ${activeProject.slug}`);
			}
			return {
				projectId: activeProject.projectId,
				projectRoot,
				requested: 0,
				processed: 0,
				succeeded: 0,
				failed: 0,
				rawPaths: [],
				updatedDocs: [],
				updatedIndex: "",
				updatedLog: "",
			};
		}

		const summary = await this.runIngestForRawPaths(
			activeProject,
			scopedRawPaths,
			"local_create",
			"",
			true,
			true,
			forceRebuild,
		);
		return {
			projectId: activeProject.projectId,
			projectRoot,
			requested: scopedRawPaths.length,
			processed: summary.processed,
			succeeded: summary.succeeded,
			failed: summary.failed,
			rawPaths: scopedRawPaths,
			updatedDocs: summary.updatedDocs,
			updatedIndex: summary.updatedIndex,
			updatedLog: summary.updatedLog,
		};
	}

	private resolveRequestedRawPath(projectRoot: string, rawPath: string): string {
		const normalizedInput = normalizePath(rawPath.trim()).replace(/^\/+/, "");
		if (!normalizedInput) {
			return "";
		}
		if (normalizedInput.match(/^[a-zA-Z]:\//)) {
			return "";
		}
		if (normalizedInput.startsWith(`${projectRoot}/`)) {
			return normalizedInput;
		}
		if (this.projectContentService.isRawPath(projectRoot, normalizedInput)) {
			return normalizedInput;
		}
		if (normalizedInput.startsWith("raw/")) {
			return normalizePath(`${projectRoot}/${normalizedInput}`);
		}
		return normalizePath(`${projectRoot}/raw/${normalizedInput}`);
	}

	private buildRawSourceContext(
		sourceType: SourceType,
		project: ProjectEntry,
		sourceCommit: string,
	): RawSourceContext {
		const userId = this.getPrimaryUserId();
		return {
			sourceType,
			sourceUserId: userId,
			sourceUserName: this.settings.user.displayName || userId,
			sourceRepo: project.gitRemote || "",
			sourceBranch: "",
			sourceCommit: sourceCommit || "",
		};
	}

	private async runStartupSync(): Promise<void> {
		try {
			await this.autoSyncManager.runStartupSync();
		} catch (error) {
			console.error("[Friday] Startup sync failed:", error);
		}
	}

	private async runStartupPluginUpdateCheck(): Promise<void> {
		const gitStatus = await this.getGitRuntimeStatus();
		const gitAvailable = gitStatus.available;
		const credential = await this.getUserGitCredential();
		const gitProfileComplete = Boolean(
			credential?.username?.trim() &&
			credential?.token?.trim(),
		);
		if (!gitAvailable || !gitProfileComplete) {
			return;
		}

		window.setTimeout(() => {
			void (async () => {
				const result = await this.pluginUpdateService.checkForUpdate();
				this.settings.update.lastCheckedAt = new Date().toISOString();
				this.settings.update.lastResult = result.hasUpdate ? "available" : "up-to-date";
				this.settings.update.availableVersion = result.hasUpdate ? result.latestVersion : "";
				await this.saveSettings();
				if (!result.hasUpdate) {
					return;
				}
				new Notice(
					`FRIDAY 发现新版本 ${result.latestVersion}。前往 设置 -> FRIDAY -> 基础配置 -> 自动更新，点击“应用更新”。`,
					8000,
				);
			})().catch((error) => {
				console.error("[Friday] Startup plugin update check failed:", error);
			});
		}, this.settings.update.startupDelayMs);
	}

	private async runStartupOfficialContentCheck(): Promise<void> {
		window.setTimeout(() => {
			void this.officialContentService.runStartupCheck().catch((error) => {
				console.error("[Friday] Startup official content check failed:", error);
			});
		}, this.settings.officialContent.startupDelayMs);
	}

	private async runStartupGroupModelCatalogCheck(): Promise<void> {
		window.setTimeout(() => {
			void this.groupModelCatalogService.runStartupCheck().catch((error) => {
				console.error("[Friday] Startup group model catalog check failed:", error);
			});
		}, this.settings.groupModelCatalog.startupDelayMs);
	}

	private startAutoSync(): void {
		this.startIdleAutoSync();
		this.startContinuousAutoSync();
	}

	private startIdleAutoSync(): void {
		if (this.idleAutoSyncInterval != null) {
			window.clearInterval(this.idleAutoSyncInterval);
			this.idleAutoSyncInterval = null;
		}
		const { mode, idleMinutes } = this.settings.sync;
		if (mode !== "idle_auto" || !idleMinutes || idleMinutes <= 0 || this.settings.projects.length === 0) {
			return;
		}

		const ms = idleMinutes * 60 * 1000;
		this.idleAutoSyncInterval = window.setInterval(() => {
			if (!this.settings.projects.some((item) => item.autoSync)) {
				return;
			}
			void this.autoSyncManager
				.runIdleCycle()
				.catch((error) => {
					console.error("[Friday] Idle auto sync failed:", error);
				});
		}, ms);
	}

	private startContinuousAutoSync(): void {
		if (this.continuousAutoSyncListenerRegistered) {
			return;
		}
		this.continuousAutoSyncListenerRegistered = true;
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.settings.sync.mode !== "continuous_auto") {
					return;
				}
				const project = this.projectBoundaryService.getProjectForVaultPath(file.path);
				if (!project) {
					return;
				}
				this.autoSyncManager.notifyProjectMutation(project);
			}),
		);
	}
}

function detectUserId(): string {
	const machineName = hostname().toLowerCase();
	const cleaned = machineName
		.replace(/[-_](pc|desktop|laptop|macbook|local|home|work)$/i, "")
		.replace(/^(desktop|laptop)[-_]/i, "");
	return cleaned || machineName;
}

function normalizeVaultPath(pathValue: string): string {
	return normalizePath(pathValue.trim());
}

