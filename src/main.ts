import { hostname } from "os";
import { Notice, Plugin, TAbstractFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { registerInitCommand } from "./commands/initCommand";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerSyncCommands } from "./commands/syncCommands";
import { FRIDAY_ICON_ID } from "./constants/icon";
import { PRIMARY_PATHS } from "./constants/paths";
import { resolveLocale, translate } from "./i18n";
import { I18nParams, LocaleCode } from "./i18n/types";
import { FridaySettingTab } from "./settings/FridaySettingTab";
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
import { ProjectContentService, RawSourceContext } from "./services/ProjectContentService";
import { IngestEventStore } from "./services/IngestEventStore";
import { IngestSummary, WikiIngestService } from "./services/WikiIngestService";
import { WorkbenchStateStore } from "./features/workbench/WorkbenchStateStore";
import { AutoSyncManager } from "./features/sync/AutoSyncManager";
import { SyncEventBus } from "./features/sync/SyncEventBus";
import { SyncRuntimeStore } from "./features/sync/SyncRuntimeStore";
import { SyncStatusBar } from "./features/sync/SyncStatusBar";
import { EventRouter } from "./core/execution/EventRouter";
import { ExecutionPlanner } from "./core/execution/ExecutionPlanner";
import { ExecutionOrchestrator } from "./core/execution/ExecutionOrchestrator";
import { normalizeLlmSettings, switchLlmMode } from "./core/llm/LlmSettingsResolver";
import { SecureStorage } from "./platform/obsidian/SecureStorage";
import { detectRuntimeProfile } from "./platform/runtime/RuntimeProfile";
import { AgentProfile } from "./types/agent";
import { FridayPluginApi } from "./types/plugin";
import { ProjectEntry, ProjectGitCredential, ProjectGroupEntry, SourceType } from "./types/project";
import { DEFAULT_SETTINGS, FridaySettings, SETTINGS_VERSION } from "./types/settings";
import { DailyBoardView, VIEW_TYPE_DAILY_BOARD } from "./views/DailyBoardView";

const DEFAULT_PROJECT_GROUP_ID = "default-group";
type WikiCompileResult = {
	projectSlug: string;
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
			await this.dataService.ensureDirectoryStructure();
			await this.loadSettings();
			this.projectBoundaryService = new ProjectBoundaryService(
				() => this.settings,
				() => (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
			);
			this.secureStorage = new SecureStorage(this.manifest.id);
			if (this.secureStorage.getMode() !== "secure") {
				console.warn("[Friday] System secure credential storage unavailable. Falling back to local plugin storage.");
				new Notice("Friday 未检测到系统安全存储，Git 凭据将仅保存在当前设备的本地插件存储中。", 8000);
			}
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

			this.agentService = new AgentService(this.app.vault, this.dataService.getFridayRoot());
			const changedByBootstrap = await this.agentService.bootstrap(this.settings);

				this.conversationService = new ConversationService(this.app.vault, this.agentService);
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
				this.agentService,
				this.workspaceAccessService,
				this.canvasService,
				this.projectBoundaryService,
			);
			this.toolApprovalService = new ToolApprovalService(
				this.app.vault,
				this.agentService,
				() => this.settings,
			);
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
				if (!("projectSlug" in event)) {
					return;
				}
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
					this.agentService,
				this.workspaceAccessService,
				this.agentActionService,
				this.toolApprovalService,
				this.commandExecService,
				this.inlineEditService,
				this.skillCommandService,
					this.projectBoundaryService,
					this.workbenchStateStore,
					(rawPaths?: string[]) => this.compileWikiForActiveProject(rawPaths),
					this.executionEventRouter,
					() => this.settings,
				);
				this.executionOrchestrator = new ExecutionOrchestrator(
					this.skillCommandService,
					this.agentRuntimeService,
				);
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

				if (changedByBootstrap || migratedLegacyCredentials) {
					await this.saveSettings();
				}

			this.registerView(VIEW_TYPE_DAILY_BOARD, (leaf) => new DailyBoardView(leaf, this));
			registerProjectCommands(this);
			registerSyncCommands(this);
			registerInitCommand(this);
			this.addSettingTab(new FridaySettingTab(this.app, this));
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

			if (this.settings.sync.syncOnStartup && this.settings.projects.length > 0) {
				void this.runStartupSync();
			}

			this.startAutoSync();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Friday] Plugin onload failed:", error);
			new Notice(`F.R.I.D.A.Y 加载异常：${message}`, 8000);
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
			agentRuntime: {
				...DEFAULT_SETTINGS.agentRuntime,
				...(migrated.agentRuntime ?? {}),
			},
			projectGroups: migrated.projectGroups ?? [],
			projects: migrated.projects ?? [],
			activeProjectId: migrated.activeProjectId ?? "",
			agents: migrated.agents ?? [],
			activeAgentId: migrated.activeAgentId ?? "",
			slashCommands: migrated.slashCommands ?? [],
		};

		this.detectedUserId = detectUserId();
		if (this.settings.user.autoDetect && !this.settings.user.userId) {
			this.settings.user.userId = this.detectedUserId;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (!this.dataService) {
			return;
		}
		try {
			await this.dataService.writeConfigMirror(this.settings);
		} catch (error) {
			console.error("[Friday] Failed to write config mirror:", error);
		}
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
		const project = this.settings.projects.find((item) => item.projectId === projectId || item.slug === projectId);
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

	getActiveAgent(): AgentProfile | null {
		return this.settings.agents.find((item) => item.id === this.settings.activeAgentId) ?? null;
	}

	async setActiveAgent(agentId: string): Promise<void> {
		const target = this.settings.agents.find((item) => item.id === agentId);
		if (!target) {
			throw new Error(`未找到 Agent: ${agentId}`);
		}
		this.settings.activeAgentId = target.id;
		await this.saveSettings();
	}

	async createAgent(input: { name: string; description: string; model?: string; modelMode?: "openai" | "group" }): Promise<AgentProfile> {
		const created = await this.agentService.createAgent(input);
		this.settings.agents.push(created);
		this.settings.activeAgentId = created.id;
		await this.saveSettings();
		return created;
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
		this.startAutoSync();
	}

	async setActiveProject(projectId: string): Promise<void> {
		const target = this.settings.projects.find((item) => item.projectId === projectId || item.slug === projectId);
		if (!target) {
			throw new Error(`未找到项目: ${projectId}`);
		}
		this.settings.activeProjectId = target.projectId;
		this.syncStatusBar?.refresh();
		await this.saveSettings();
	}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		return this.secureStorage.getProjectGitCredential(projectId);
	}

	async setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void> {
		await this.secureStorage.setProjectGitCredential(projectId, credential);
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

	openSettingsTab(): void {
		const manager = this.app as typeof this.app & {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};
		manager.setting?.open();
		manager.setting?.openTabById(this.manifest.id);
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

	async openWorkspaceView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAILY_BOARD);
		let leaf: WorkspaceLeaf | null = leaves[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
		}
		await leaf.setViewState({
			type: VIEW_TYPE_DAILY_BOARD,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private getEffectiveLlmSettings(): FridaySettings["llm"] {
		const activeAgent = this.getActiveAgent();
		const baseSettings = activeAgent?.modelMode
			? switchLlmMode(this.settings.llm, activeAgent.modelMode)
			: this.settings.llm;
		return {
			...baseSettings,
			model: activeAgent?.model?.trim() || baseSettings.model,
		};
	}

	private migrateSettings(raw: Partial<FridaySettings> | null): Partial<FridaySettings> {
		if (!raw) {
			return {
				version: SETTINGS_VERSION,
				user: { ...DEFAULT_SETTINGS.user },
				projectGroups: [this.createDefaultProjectGroup()],
				projects: [],
				activeProjectId: "",
			};
		}

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
		const migratedSyncMode =
			rawSync.mode ??
			(rawSync.autoPush ? "continuous_auto" : (rawSync.syncInterval ?? 0) > 0 ? "idle_auto" : "manual");
		const migratedSync = {
			mode: migratedSyncMode,
			idleMinutes: typeof rawSync.idleMinutes === "number" ? rawSync.idleMinutes : rawSync.syncInterval ?? 0,
			syncOnStartup:
				typeof rawSync.syncOnStartup === "boolean" ? rawSync.syncOnStartup : DEFAULT_SETTINGS.sync.syncOnStartup,
		};

		return {
			...raw,
			version: SETTINGS_VERSION,
			user: migratedUser,
			sync: migratedSync,
			projects: normalizedProjects,
			projectGroups: migratedGroups,
			activeProjectId,
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
		if (requestedId && projects.some((item) => item.projectId === requestedId || item.slug === requestedId)) {
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
				projectSlug: activeProject.slug,
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
			projectSlug: activeProject.slug,
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
				const projectSlug = this.dataService.getProjectSlugFromPath(file.path);
				if (!projectSlug) {
					return;
				}
				const project = this.settings.projects.find((item) => (item.projectId || item.slug) === projectSlug || item.slug === projectSlug);
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

