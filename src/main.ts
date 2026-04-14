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
import { ExecutionPlanner } from "./core/execution/ExecutionPlanner";
import { ExecutionOrchestrator } from "./core/execution/ExecutionOrchestrator";
import { detectRuntimeProfile } from "./platform/runtime/RuntimeProfile";
import { AgentProfile } from "./types/agent";
import { FridayPluginApi } from "./types/plugin";
import { ProjectEntry, ProjectGroupEntry, SourceType } from "./types/project";
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
	executionPlanner!: ExecutionPlanner;
	executionOrchestrator!: ExecutionOrchestrator;
	projectBoundaryService!: ProjectBoundaryService;
	projectContentService!: ProjectContentService;
	ingestEventStore!: IngestEventStore;
	wikiIngestService!: WikiIngestService;
	private readonly rawIngestTimers = new Map<string, number>();
	private compileWikiInFlight: Promise<WikiCompileResult> | null = null;
	private detectedUserId = "";

	async onload(): Promise<void> {
		try {
			const runtimeProfile = detectRuntimeProfile();
			if (!runtimeProfile.supported) {
				throw new Error(`Unsupported runtime platform: ${runtimeProfile.platform}`);
			}
			this.dataService = new DataService(this.app.vault, PRIMARY_PATHS.root);
			this.syncService = new SyncService(this.app, this.dataService.getFridayRoot());
			await this.dataService.ensureDirectoryStructure();
			await this.loadSettings();

			this.agentService = new AgentService(this.app.vault, this.dataService.getFridayRoot());
			const changedByBootstrap = await this.agentService.bootstrap(this.settings);

				this.conversationService = new ConversationService(this.app.vault, this.agentService);
				this.projectBoundaryService = new ProjectBoundaryService(() => this.settings);
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

				if (changedByBootstrap) {
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

			this.addStatusBarItem().setText(this.t("status.ready"));

			if (this.settings.sync.syncOnStartup && this.settings.projects.length > 0) {
				void this.runStartupSync();
			}

			this.startSyncInterval();
			if (this.settings.sync.autoPush) {
				this.startAutoPush();
			}
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
				...DEFAULT_SETTINGS.llm,
				...(migrated.llm ?? {}),
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

	async createAgent(input: { name: string; description: string; model?: string }): Promise<AgentProfile> {
		const created = await this.agentService.createAgent(input);
		this.settings.agents.push(created);
		this.settings.activeAgentId = created.id;
		await this.saveSettings();
		return created;
	}

	async upsertProject(project: ProjectEntry): Promise<void> {
		const normalizedProject = this.normalizeProjectEntry(project);
		const existingIndex = this.settings.projects.findIndex((item) => item.slug === normalizedProject.slug);
		if (existingIndex >= 0) {
			this.settings.projects[existingIndex] = normalizedProject;
		} else {
			this.settings.projects.push(normalizedProject);
		}

		this.ensureProjectGroupInSettings(normalizedProject.groupId);
		for (const group of this.settings.projectGroups) {
			const nextSlugs = group.projectSlugs.filter((slug) => slug !== normalizedProject.slug);
			if (group.id === normalizedProject.groupId) {
				nextSlugs.push(normalizedProject.slug);
			}
			group.projectSlugs = nextSlugs;
			group.updatedAt = new Date().toISOString();
		}

		if (!this.settings.activeProjectId) {
			this.settings.activeProjectId = normalizedProject.slug;
		}
		await this.saveSettings();
	}

	async removeProject(slug: string): Promise<void> {
		this.settings.projects = this.settings.projects.filter((project) => project.slug !== slug);
		for (const group of this.settings.projectGroups) {
			group.projectSlugs = group.projectSlugs.filter((projectSlug) => projectSlug !== slug);
		}
		if (this.settings.activeProjectId === slug) {
			this.settings.activeProjectId = this.settings.projects[0]?.slug ?? "";
		}
		await this.saveSettings();
	}

	async setActiveProject(projectSlug: string): Promise<void> {
		const target = this.settings.projects.find((item) => item.slug === projectSlug);
		if (!target) {
			throw new Error(`未找到项目: ${projectSlug}`);
		}
		this.settings.activeProjectId = target.slug;
		await this.saveSettings();
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
			if (!defaultGroup.projectSlugs.includes(project.slug)) {
				defaultGroup.projectSlugs.push(project.slug);
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
		return {
			...this.settings.llm,
			model: activeAgent?.model?.trim() || this.settings.llm.model,
		};
	}

	private migrateSettings(raw: Partial<FridaySettings> | null): Partial<FridaySettings> {
		if (!raw) {
			return {
				version: SETTINGS_VERSION,
				projectGroups: [this.createDefaultProjectGroup()],
				projects: [],
				activeProjectId: "",
			};
		}

		const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
		const normalizedProjects = rawProjects.map((item) => this.normalizeProjectEntry(item as ProjectEntry));
		const migratedGroups = this.migrateProjectGroups(
			(raw as { projectGroups?: ProjectGroupEntry[] }).projectGroups,
			normalizedProjects,
		);
		const activeProjectId = this.resolveInitialActiveProjectId(raw.activeProjectId, normalizedProjects);

		return {
			...raw,
			version: SETTINGS_VERSION,
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
						projectSlugs: [],
						createdAt: now,
						updatedAt: now,
					}),
				);
			}
			const group = groupMap.get(groupId)!;
			if (!group.projectSlugs.includes(project.slug)) {
				group.projectSlugs.push(project.slug);
			}
		}

		const validSlugs = new Set(projects.map((item) => item.slug));
		for (const group of groupMap.values()) {
			group.projectSlugs = [...new Set(group.projectSlugs.filter((slug) => validSlugs.has(slug)))];
			group.updatedAt = now;
		}

		return [...groupMap.values()];
	}

	private resolveInitialActiveProjectId(
		activeProjectId: string | undefined,
		projects: ProjectEntry[],
	): string {
		const requestedId = (activeProjectId ?? "").trim();
		if (requestedId && projects.some((item) => item.slug === requestedId)) {
			return requestedId;
		}
		return projects[0]?.slug ?? "";
	}

	private normalizeProjectEntry(project: ProjectEntry): ProjectEntry {
		const normalizedSlug = (project.slug ?? "").trim();
		const normalizedGroupId = (project.groupId ?? "").trim() || DEFAULT_PROJECT_GROUP_ID;
		const normalizedRootPath = this.resolveProjectRootPath(project);
		return {
			...project,
			slug: normalizedSlug,
			groupId: normalizedGroupId,
			projectRootPath: normalizedRootPath,
			localPath: project.localPath?.trim() || "",
		};
	}

	private resolveProjectRootPath(project: ProjectEntry): string {
		const candidateRoot = project.projectRootPath?.trim();
		if (candidateRoot && !candidateRoot.match(/^[a-zA-Z]:\\/)) {
			return normalizeVaultPath(candidateRoot);
		}
		const localPath = project.localPath?.trim() ?? "";
		if (localPath && !localPath.match(/^[a-zA-Z]:\\/)) {
			return normalizeVaultPath(localPath);
		}
		return normalizeVaultPath(`${PRIMARY_PATHS.root}/${PRIMARY_PATHS.projects}/${project.slug}`);
	}

	private normalizeProjectGroupEntry(group: ProjectGroupEntry): ProjectGroupEntry {
		const now = new Date().toISOString();
		const id = (group.id ?? "").trim() || DEFAULT_PROJECT_GROUP_ID;
		return {
			id,
			name: (group.name ?? "").trim() || (id === DEFAULT_PROJECT_GROUP_ID ? "默认项目组" : id),
			description: (group.description ?? "").trim(),
			projectSlugs: [...new Set((group.projectSlugs ?? []).map((item) => item.trim()).filter(Boolean))],
			createdAt: group.createdAt || now,
			updatedAt: now,
		};
	}

	private createDefaultProjectGroup(now = new Date().toISOString()): ProjectGroupEntry {
		return {
			id: DEFAULT_PROJECT_GROUP_ID,
			name: "默认项目组",
			description: "",
			projectSlugs: [],
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
			projectSlugs: [],
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
		if (this.settings.activeProjectId && project.slug !== this.settings.activeProjectId) {
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
			const results = await this.syncService.syncAll(this.settings.projects);
			for (const project of this.settings.projects) {
				const result = results.get(project.slug);
				if (result?.success) {
					project.lastSyncAt = new Date().toISOString();
				}
			}
			await this.saveSettings();
		} catch (error) {
			console.error("[Friday] Startup sync failed:", error);
		}
	}

	private startSyncInterval(): void {
		const minutes = this.settings.sync.syncInterval;
		if (!minutes || minutes <= 0 || this.settings.projects.length === 0) {
			return;
		}

		const ms = minutes * 60 * 1000;
		this.registerInterval(
			window.setInterval(() => {
				const autoSyncProjects = this.settings.projects.filter((item) => item.autoSync);
				if (autoSyncProjects.length === 0) {
					return;
				}
				void this.syncService
					.syncAll(this.settings.projects)
					.then(async (results) => {
						for (const project of this.settings.projects) {
							const result = results.get(project.slug);
							if (result?.success) {
								project.lastSyncAt = new Date().toISOString();
							}
						}
						await this.saveSettings();
					})
					.catch((error) => {
						console.error("[Friday] Periodic sync failed:", error);
					});
			}, ms),
		);
	}

	private startAutoPush(): void {
		let pushTimer: number | null = null;
		const debounceMs = 10_000;

		this.registerEvent(
			this.app.vault.on("modify", () => {
				if (pushTimer !== null) {
					window.clearTimeout(pushTimer);
				}
				pushTimer = window.setTimeout(() => {
					pushTimer = null;
					const autoSyncProjects = this.settings.projects.filter((item) => item.autoSync && item.gitRemote);
					for (const project of autoSyncProjects) {
						void this.syncService
							.push(project)
							.then(async (result) => {
								if (result.success) {
									project.lastSyncAt = new Date().toISOString();
									await this.saveSettings();
								}
							})
							.catch((error) => {
								console.error(`[Friday] Auto-push failed for ${project.slug}:`, error);
							});
					}
				}, debounceMs);
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

