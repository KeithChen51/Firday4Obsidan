import { hostname } from "os";
import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { registerDailyCommands } from "./commands/dailyCommands";
import { registerInitCommand } from "./commands/initCommand";
import { registerKnowledgeCommands } from "./commands/knowledgeCommands";
import { registerProjectCommands } from "./commands/projectCommands";
import { registerSyncCommands } from "./commands/syncCommands";
import { registerTaskCommands } from "./commands/taskCommands";
import { FRIDAY_ICON_ID } from "./constants/icon";
import { PRIMARY_PATHS } from "./constants/paths";
import { resolveLocale, translate } from "./i18n";
import { AgentService } from "./services/AgentService";
import { AgentActionService } from "./services/AgentActionService";
import { AgentRuntimeService } from "./services/AgentRuntimeService";
import { AIService } from "./services/AIService";
import { CanvasService } from "./services/CanvasService";
import { ConversationService } from "./services/ConversationService";
import { DataService } from "./services/DataService";
import { KnowledgeCuratorService } from "./services/KnowledgeCuratorService";
import { KnowledgeValidationService } from "./services/KnowledgeValidationService";
import { SyncService } from "./services/SyncService";
import { ToolApprovalService } from "./services/ToolApprovalService";
import { CommandExecService } from "./services/CommandExecService";
import { InlineEditService } from "./services/InlineEditService";
import { VaultContextService } from "./services/VaultContextService";
import { WorkspaceAccessService } from "./services/WorkspaceAccessService";
import { SkillCommandService } from "./services/SkillCommandService";
import { SlashCommandService } from "./services/SlashCommandService";
import { FridaySettingTab } from "./settings/FridaySettingTab";
import { AgentProfile } from "./types/agent";
import { KnowledgeSummary } from "./types/knowledge";
import { FridayPluginApi } from "./types/plugin";
import { ProjectEntry } from "./types/project";
import { DEFAULT_SETTINGS, FridaySettings, SETTINGS_VERSION } from "./types/settings";
import { formatDate } from "./utils/dateUtils";
import { DailyBoardView, VIEW_TYPE_DAILY_BOARD } from "./views/DailyBoardView";
import { I18nParams, LocaleCode } from "./i18n/types";

export default class FridayPlugin extends Plugin implements FridayPluginApi {
	settings: FridaySettings = DEFAULT_SETTINGS;
	dataService!: DataService;
	syncService!: SyncService;
	aiService!: AIService;
	agentService!: AgentService;
	conversationService!: ConversationService;
	knowledgeCuratorService!: KnowledgeCuratorService;
	knowledgeValidationService!: KnowledgeValidationService;
	workspaceAccessService!: WorkspaceAccessService;
	canvasService!: CanvasService;
	agentActionService!: AgentActionService;
	toolApprovalService!: ToolApprovalService;
	commandExecService!: CommandExecService;
	inlineEditService!: InlineEditService;
	agentRuntimeService!: AgentRuntimeService;
	vaultContextService!: VaultContextService;
	skillCommandService!: SkillCommandService;
	slashCommandService!: SlashCommandService;
	private boardIconId = FRIDAY_ICON_ID;
	private detectedUserId = "";

	async onload(): Promise<void> {
		this.dataService = new DataService(this.app.vault, this.app.fileManager, PRIMARY_PATHS.root);
		this.syncService = new SyncService(this.app, this.dataService.getFridayRoot());
		await this.dataService.ensureDirectoryStructure();
		await this.loadSettings();

		this.agentService = new AgentService(this.app.vault, this.dataService.getFridayRoot());
		const changedByBootstrap = await this.agentService.bootstrap(this.settings);

		this.conversationService = new ConversationService(this.app.vault, this.agentService);
		this.knowledgeCuratorService = new KnowledgeCuratorService(
			this.app.vault,
			this.agentService,
			this.conversationService,
		);
		this.knowledgeValidationService = new KnowledgeValidationService(
			this.app.vault,
			this.agentService,
			this.knowledgeCuratorService,
		);
		this.workspaceAccessService = new WorkspaceAccessService(() => this.settings);
		this.canvasService = new CanvasService();
		this.agentActionService = new AgentActionService(
			this.app.vault,
			this.agentService,
			this.workspaceAccessService,
			this.canvasService,
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
		this.vaultContextService = new VaultContextService(
			this.app.vault,
			this.workspaceAccessService,
			() => this.settings,
		);
		this.skillCommandService = new SkillCommandService(
			this.workspaceAccessService,
			() => this.settings,
			() => (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".",
		);
		this.slashCommandService = new SlashCommandService(() => this.settings);
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
			() => this.settings,
		);

		if (changedByBootstrap) {
			await this.saveSettings();
		}

		this.registerView(VIEW_TYPE_DAILY_BOARD, (leaf) => new DailyBoardView(leaf, this));
		registerTaskCommands(this);
		registerDailyCommands(this);
		registerProjectCommands(this);
		registerSyncCommands(this);
		registerKnowledgeCommands(this);
		registerInitCommand(this);
		this.addSettingTab(new FridaySettingTab(this.app, this));

		this.addRibbonIcon(this.boardIconId, this.t("view.board.title"), () => {
			void this.activateDailyBoardView();
		});

		if (this.settings.dailyNote.autoGenerate) {
			await this.tryAutoGenerateDailyNote();
		}

		this.addStatusBarItem().setText(this.t("status.ready"));

		if (this.settings.sync.syncOnStartup && this.settings.projects.length > 0) {
			void this.runStartupSync();
		}

		this.startSyncInterval();
		if (this.settings.sync.autoPush) {
			this.startAutoPush();
		}
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DAILY_BOARD);
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<FridaySettings> | null;
		const migrated = this.migrateSettings(raw);

		this.settings = {
			...DEFAULT_SETTINGS,
			...migrated,
			locale: resolveLocale(migrated.locale),
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
			dailyNote: {
				...DEFAULT_SETTINGS.dailyNote,
				...(migrated.dailyNote ?? {}),
			},
			agentRuntime: {
				...DEFAULT_SETTINGS.agentRuntime,
				...(migrated.agentRuntime ?? {}),
			},
			knowledgeCurator: {
				...DEFAULT_SETTINGS.knowledgeCurator,
				...(migrated.knowledgeCurator ?? {}),
			},
			projects: migrated.projects ?? [],
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

	getBoardIconId(): string {
		return this.boardIconId;
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

	async runKnowledgeCuration(activeAgentId?: string): Promise<KnowledgeSummary> {
		const targetAgentId = activeAgentId || this.settings.activeAgentId || this.settings.agents[0]?.id;
		if (!targetAgentId) {
			throw new Error("没有可用 Agent。");
		}
		const summary = await this.knowledgeCuratorService.runCuration(
			this.settings,
			this.settings.agents,
			targetAgentId,
		);
		return summary;
	}

	async runKnowledgeRevalidation(activeAgentId?: string): Promise<KnowledgeSummary> {
		const targetAgentId = activeAgentId || this.settings.activeAgentId || this.settings.agents[0]?.id;
		if (!targetAgentId) {
			throw new Error("没有可用 Agent。");
		}
		return this.knowledgeValidationService.runRevalidation(this.settings, targetAgentId);
	}

	async upsertProject(project: ProjectEntry): Promise<void> {
		const existingIndex = this.settings.projects.findIndex((item) => item.slug === project.slug);
		if (existingIndex >= 0) {
			this.settings.projects[existingIndex] = project;
		} else {
			this.settings.projects.push(project);
		}
		await this.saveSettings();
	}

	async removeProject(slug: string): Promise<void> {
		this.settings.projects = this.settings.projects.filter((project) => project.slug !== slug);
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
		return resolveLocale(this.settings.locale);
	}

	t(key: string, params?: I18nParams): string {
		return translate(this.getLocale(), key, params);
	}

	async activateDailyBoardView(): Promise<void> {
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
			return { version: SETTINGS_VERSION };
		}
		return {
			...raw,
			version: raw.version ?? SETTINGS_VERSION,
		};
	}

	private async tryAutoGenerateDailyNote(): Promise<void> {
		const today = formatDate();
		const dailyNotePath = this.dataService.resolveDailyNotePath(today);
		const inMemory = this.app.vault.getAbstractFileByPath(dailyNotePath);
		const onDisk = await this.app.vault.adapter.exists(dailyNotePath);
		if (inMemory || onDisk) {
			return;
		}

		try {
			await this.dataService.generateDailyNote(
				this.getPrimaryUserId(),
				today,
				this.settings.dailyNote.templatePath,
				this.getDetectedUserId(),
			);
		} catch (error) {
			console.error("[Friday] Failed to auto-generate daily note:", error);
			new Notice("自动生成每日任务失败", 4000);
		}
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
			this.app.vault.on("modify", (file) => {
				if (!this.dataService.isManagedTaskPath(file.path)) {
					return;
				}
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
