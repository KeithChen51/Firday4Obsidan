import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	TFile,
	TFolder,
	ToggleComponent,
	setIcon,
	WorkspaceLeaf,
} from "obsidian";
import { ApprovalQueue, type PendingApproval } from "../features/workbench/ApprovalQueue";
import type { EditPlanRecord } from "../features/workbench/WorkbenchStateStore";
import { FRIDAY_SETTINGS_CHANGED_EVENT, PROJECT_STATE_CHANGED_EVENT } from "../constants/events";
import { FRIDAY_ICON_ID } from "../constants/icon";
import { FRIDAY_WORDMARK_FONT_FAMILY } from "../constants/wordmarkFont";
import { GitIgnoreService } from "../features/sync/GitIgnoreService";
import type { ToolManifest } from "../platform/tools/ToolManifestCatalog";
import { buildSlashSuggestions } from "../core/commands/SlashSuggestionService";
import {
	buildAgentModelCatalogFromSettings,
	parseAgentModelChoice,
	serializeAgentModelChoice,
} from "../core/llm/AgentModelCatalog";
import { patchLlmModeConfig, switchLlmMode } from "../core/llm/LlmSettingsResolver";
import { parseOpencodeConfig, selectOpencodeProvider } from "../core/llm/OpencodeConfigResolver";
import { extractRuntimeAssistantText, parseRuntimeEnvelopeText } from "../core/orchestrator/RuntimeEnvelopeParser";
import { CapabilityRegistry } from "../core/capability/CapabilityRegistry";
import {
	createActiveFileContext,
	createConversationIngressPayload,
	getStructuredPromptDocument,
	isPromptDocumentEmpty,
} from "../core/chat/ConversationIngressService";
import { ConversationSession } from "../services/ConversationService";
import type { AgentTask, AgentTaskStatus as CoreAgentTaskStatus } from "../core/tasks/AgentTask";
import type { AgentTrajectoryAction, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";
import { LiveTrajectoryStore } from "../core/trajectory/LiveTrajectoryStore";
import { projectReplaySummary } from "../core/trajectory/AgentTrajectoryProjector";
import {
	RuntimeProgressEvent,
	RuntimeTurnResult,
	RuntimeWikiCompileSummary,
} from "../services/AgentRuntimeService";
import {
	ChatMessage,
	type ChatMessageUiMeta,
	type ChatMessageUiSegment,
	type ChatMessageUiToken,
} from "../services/AIService";
import type { SkillDescriptor } from "../services/SkillCommandService";
import { deriveFileMutationModeFromToolPermissionMode, type ToolPermissionMode } from "../types/agent";
import type { FridayPluginApi } from "../types/plugin";
import type { SoulDefinition } from "../types/soul";
import { ProjectEntry, ProjectMember, SyncResult, SyncStatus } from "../types/project";
import type { SyncConflictRecord } from "../types/sync";
import { InvocationResolver } from "../core/execution/InvocationResolver";
import { SkillRegistry } from "../core/execution/SkillRegistry";
import { resolveBuiltinSkillReviewNote, type ResolvedBuiltinSkillReviewNote } from "../skills/packs/builtin/reviewNotes";
import type { MentionFileTypeIconKind, MentionSuggestion } from "./components/MentionDropdown";
import {
	computeSkillReviewNotePopoverLayout,
	computeSkillReviewNotePopoverPosition,
} from "./skillReviewNotePopoverPlacement";
import {
	MentionResolver,
	parseLegacyMentionMarkup,
	type MentionResolutionResult,
	type MentionToken,
	type MentionTokenType,
} from "../core/context/mention/MentionResolver";
import { resolveActiveFileContextPolicy } from "../core/context/ActiveFileContext";
import type { PromptMentionContext } from "../core/context/PromptContextEngine";
import {
	createEmptyMentionComposerSnapshot,
	type MentionComposerSnapshot,
} from "../core/editor/mention/MentionComposerDocument";
import { MentionComposer, type MentionComposerQuery } from "./components/MentionComposer";
import { isPathWithinMentionScope, resolveMentionScopePrefixes } from "./components/mentionScope";
import {
	createAgentTaskPanelActionHandlers,
	recordTaskFromRuntimeProgress,
} from "./agentTaskPanelActions";
import {
	buildAgentProcessPanelViewModel,
	type AgentComposerTaskBarView,
} from "./agentProcessPanelViewModel";
import { renderAgentAnswerFlow, renderAgentTrajectoryCard, renderComposerTaskBar } from "./agentTrajectoryRenderer";
import {
	buildUserFacingTaskView,
	formatUserFacingTaskAction,
	formatUserFacingTaskStatus,
	productizeRuntimeText,
} from "./agentUserFacingPresenter";
import { buildMutationDiffPreview } from "./mutationDiffPreview";
import { buildUserMessageSegments } from "./chatMessageSegments";
import { getMentionFileTypeIcon, isMentionableFile } from "./mentionSuggestions";

export const VIEW_TYPE_DAILY_BOARD = "friday-daily-board";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

interface SyncDecisionElements {
	titleEl: HTMLElement;
	descriptionEl: HTMLElement;
	metaEl: HTMLElement;
	chipEl: HTMLElement;
	syncButton: HTMLButtonElement;
	localValueEl: HTMLElement;
	remoteValueEl: HTMLElement;
	dirtyValueEl: HTMLElement;
	conflictValueEl: HTMLElement;
	currentBranchEl: HTMLElement;
	branchListEl: HTMLElement;
}

interface SyncDetailSection {
	detailsEl: HTMLElement;
	stateEl: HTMLElement;
	bodyEl: HTMLElement;
}

type AgentTaskStatus = CoreAgentTaskStatus;

interface AgentTaskViewState {
	id: string;
	conversationId?: string;
	turnId?: string;
	status: AgentTaskStatus;
	title: string;
	summary: string;
	failureReason?: string;
	waitingForApproval?: AgentTask["waitingForApproval"];
	waitingForUser?: AgentTask["waitingForUser"];
	availableActions: AgentTask["availableActions"];
	pendingMutationCount: number;
	changedFileCount: number;
}

interface SessionListGroup {
	key: string;
	label: string;
	sessions: ConversationSession[];
}

interface ComposerChoiceMenuOption {
	value: string;
	label: string;
	description?: string;
}

interface ComposerChoiceMenuGroup {
	label: string;
	options: ComposerChoiceMenuOption[];
}

interface AiTurnTarget {
	sessionId: string;
	projectId?: string;
	conversation: ChatMessage[];
}

interface AiTurnFailureStatus {
	target: AiTurnTarget;
	message: string;
}

export class DailyBoardView extends ItemView {
	private refreshTimer: number | null = null;
	private activePage: "chat" | "sync" | "tools" = "chat";
	private readonly approvalQueue = new ApprovalQueue();
	private pendingProjectRemoval: ProjectEntry | null = null;
	private memberEditorProject: ProjectEntry | null = null;
	private memberEditorMembers: ProjectMember[] = [];
	private memberEditorNewUserId = "";
	private memberEditorNewRole: ProjectMember["role"] = "editor";
	private expandedConflictKey = "";
	private pendingIgnoreConfirmationKey = "";
	private readonly handleProjectStateChanged = () => {
		void this.safeRenderBoard();
	};

	private aiConversation: ChatMessage[] = [];
	private aiSessions: ConversationSession[] = [];
	private aiSessionId = "";
	private aiSessionNavCollapsed = true;
	private aiSessionSearchQuery = "";
	private aiDraft = "";
	private aiComposerSnapshot: MentionComposerSnapshot = createEmptyMentionComposerSnapshot();
	private aiQueuedPrompts: MentionComposerSnapshot[] = [];
	private aiBusy = false;
	private aiLastError = "";
	private aiActiveTurnTarget: AiTurnTarget | null = null;
	private aiBackgroundTurnTarget: AiTurnTarget | null = null;
	private aiBackgroundTurnFailure: AiTurnFailureStatus | null = null;
	private aiLocalIntakePreview = "";
	private aiRuntimeSawIntake = false;
	private aiRuntimeModelRequestStarted = false;
	private aiStreamingPreview = "";
	private aiRuntimeTrajectoryStore = new LiveTrajectoryStore();
	private aiRuntimeTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
	private aiStreamingTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
	private aiProcessSnapshotsByKey = new Map<string, AgentTrajectorySnapshot>();
	private aiProcessSnapshotProjectIds = new WeakMap<AgentTrajectorySnapshot, string>();
	private aiProcessExpandedKeys = new Set<string>();
	private aiProcessCollapsedKeys = new Set<string>();
	private aiProcessTypewriterSeenKeys = new Set<string>();
	private aiProcessTypewriterTimers = new Map<string, number>();
	private aiSkipNextProcessTypewriter = false;
	private aiComposerTaskBarExpanded = false;
	private aiComposerTaskBarHostEl: HTMLElement | null = null;
	private aiComposerBodyEl: HTMLElement | null = null;
	private aiAgentTasks: AgentTaskViewState[] = [];
	private aiRuntimeElapsedTimer: number | null = null;
	private aiMessageListScrollTop = 0;
	private aiMessageListStickToBottom = true;
	private aiForceScrollToBottomOnce = false;
	private aiRuntimeLastRenderAt = 0;
	private aiRuntimeProgressTaskIds = new Set<string>();
	private aiSendAbortController: AbortController | null = null;
	private aiSessionManageMode = false;
	private aiSessionSelection = new Set<string>();
	private aiSessionRenameId = "";
	private aiSessionRenameDraft = "";
	private composer: MentionComposer | null = null;
	private aiComposerDecisionKey = "";
	private aiMessageListEl: HTMLElement | null = null;
	private aiQueueHintEl: HTMLElement | null = null;
	private aiErrorEl: HTMLElement | null = null;
	private aiBackgroundAgentStatusHostEl: HTMLElement | null = null;
	private aiSendButtonEl: HTMLButtonElement | null = null;
	private aiModelSelectEl: HTMLButtonElement | null = null;
	private aiPermissionSelectEl: HTMLButtonElement | null = null;
	private aiToolbarChoiceMenuEl: HTMLElement | null = null;
	private aiToolbarChoiceMenuCleanup: (() => void) | null = null;
	private readonly mentionResolver = new MentionResolver();
	private readonly gitIgnoreService: GitIgnoreService;
	private skillReviewNotePopoverCleanups: Array<() => void> = [];

	constructor(leaf: WorkspaceLeaf, private readonly plugin: FridayPluginApi) {
		super(leaf);
		this.gitIgnoreService = new GitIgnoreService((project) =>
			this.plugin.projectBoundaryService.getProjectAbsolutePath(project),
		);
	}

	getViewType(): string {
		return VIEW_TYPE_DAILY_BOARD;
	}

	getIcon(): string {
		return FRIDAY_ICON_ID;
	}

	getDisplayText(): string {
		return this.plugin.t("view.board.title");
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("friday-daily-board");
		this.plugin.toolApprovalService.setPromptHandler(async (request) => {
			const decisionPromise = this.approvalQueue.enqueue(request);
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
			const decision = await decisionPromise;
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
			return decision;
		});
		this.registerEvent(
			this.app.vault.on("modify", () => {
				if (this.plugin.settings.projects.length === 0) {
					this.scheduleRefresh();
				}
			}),
		);
		window.addEventListener(PROJECT_STATE_CHANGED_EVENT, this.handleProjectStateChanged);
		window.addEventListener(FRIDAY_SETTINGS_CHANGED_EVENT, this.handleSettingsChanged);
		await this.ensureActiveProjectInitialized();
		await this.ensureAiSessionLoaded();
		await this.safeRenderBoard();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.clearRuntimeElapsedTimer();
		this.clearProcessTypewriterTimers();
		this.cleanupSkillReviewNotePopovers();
		this.composer?.destroy();
		this.composer = null;
		this.resetAiChatShellRefs();
		this.aiBackgroundAgentStatusHostEl = null;
		this.approvalQueue.clearWithDecision("deny");
		this.plugin.toolApprovalService.clearPromptHandler();
		this.aiSendAbortController?.abort();
		this.aiSendAbortController = null;
		this.aiRuntimeProgressTaskIds.clear();
		window.removeEventListener(PROJECT_STATE_CHANGED_EVENT, this.handleProjectStateChanged);
		window.removeEventListener(FRIDAY_SETTINGS_CHANGED_EVENT, this.handleSettingsChanged);
		this.contentEl.empty();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			void this.safeRenderBoard();
		}, 300);
	}

	private handleSettingsChanged = (): void => {
		void this.safeRenderBoard();
	};

	private async safeRenderBoard(): Promise<void> {
		try {
			this.renderBoard();
		} catch (error) {
			console.error("[Friday] Failed to render board:", error);
			this.contentEl.empty();
			this.contentEl.createEl("p", {
				text: this.t("board.error.renderFailed", "Board render failed. Please retry."),
			});
			new Notice(this.t("board.notice.renderFailed", "Board render failed. Check console logs."), 5000);
		}
	}

	private renderBoard(): void {
		this.captureAiMessageListScrollState();
		const shouldRestoreComposerFocus = this.composer?.hasFocus() ?? false;
		this.cleanupSkillReviewNotePopovers();
		this.composer?.destroy();
		this.composer = null;
		this.resetAiChatShellRefs();
		this.aiBackgroundAgentStatusHostEl = null;
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "friday-shell" });
		const shellHeaderEl = shell.createDiv({ cls: "friday-shell-header" });
		const topNavEl = shell.createDiv({ cls: "friday-top-nav" });
		const contentEl = shell.createDiv({ cls: "friday-page-content" });

		this.renderShellHeader(shellHeaderEl);
		this.renderTopNav(topNavEl);
		const onboardingSnapshot = this.plugin.onboardingService.getSnapshot();
		if (onboardingSnapshot.shouldShowPanel) {
			this.renderOnboardingPanel(contentEl);
		} else if (this.plugin.settings.projects.length === 0) {
			this.activePage = "sync";
			this.renderSyncPage(contentEl);
		} else if (this.activePage === "sync") {
			this.renderSyncPage(contentEl);
		} else if (this.activePage === "tools") {
			this.renderToolsPage(contentEl);
		} else {
			this.renderAiPage(contentEl);
		}
		this.aiBackgroundAgentStatusHostEl = shell.createDiv({ cls: "friday-background-agent-status-host" });
		this.renderBackgroundAgentStatus(this.aiBackgroundAgentStatusHostEl);
		if (this.plugin.settings.projects.length > 0 && !this.aiSessionNavCollapsed) {
			this.renderAiSessionDrawer(shell);
		}
		if (shouldRestoreComposerFocus) {
			(this.composer as MentionComposer | null)?.focus();
		}
	}

	private renderOnboardingPanel(contentEl: HTMLElement): void {
		const snapshot = this.plugin.onboardingService.getSnapshot();
		const panel = contentEl.createDiv({ cls: "friday-onboarding-panel" });
		const header = panel.createDiv({ cls: "friday-onboarding-header" });
		header.createEl("h3", {
			text: this.t("onboarding.title", "开启和FRIDAY的首次对话"),
		});

		const list = panel.createDiv({ cls: "friday-onboarding-list" });
		this.renderOnboardingStep(
			list,
			snapshot.projectRegistered,
			this.t("onboarding.step.project.title", "选择一个文件夹"),
			this.t("onboarding.step.project.desc", "FRIDAY 需要一个项目边界，才能安全地读取、写入和同步文件。"),
			this.t("onboarding.action.registerProject", "选择工作范围"),
			async () => {
				this.plugin.openSettingsTab("project");
			},
		);
		this.renderOnboardingStep(
			list,
			snapshot.modelConfigured,
			this.t("onboarding.step.model.title", "模型配置"),
			this.t(
				"onboarding.step.model.desc",
				"配置模型后，FRIDAY 才能开始对话。Git、官方内容和插件更新可以稍后再配。",
			),
			this.t("onboarding.action.configureModel", "去配置模型"),
			async () => {
				this.plugin.openSettingsTab("llm");
			},
		);
		const actions = panel.createDiv({ cls: "friday-onboarding-actions" });
		this.addPageButton(actions, this.t("onboarding.action.skip", "跳过唤醒引导"), async () => {
			this.plugin.settings.workbench.onboardingDismissed = true;
			await this.plugin.saveSettings();
			new Notice(this.t("onboarding.notice.skipped", "已跳过唤醒引导。可在设置中继续配置。"), 3000);
			await this.safeRenderBoard();
		});
	}

	private renderOnboardingStep(
		containerEl: HTMLElement,
		done: boolean,
		title: string,
		description: string,
		actionLabel: string,
		action: () => Promise<void>,
	): void {
		const row = containerEl.createDiv({ cls: `friday-onboarding-step${done ? " is-complete" : ""}` });
		const marker = row.createSpan({ cls: "friday-onboarding-step-marker" });
		setIcon(marker, done ? "check" : "circle");
		const body = row.createDiv({ cls: "friday-onboarding-step-body" });
		body.createEl("h4", { text: title });
		body.createEl("p", { text: description });
		this.addPageButton(row.createDiv({ cls: "friday-onboarding-step-action" }), actionLabel, action);
	}

	private resetAiChatShellRefs(): void {
		this.closeAiToolbarChoiceMenu();
		this.aiMessageListEl = null;
		this.aiQueueHintEl = null;
		this.aiErrorEl = null;
		this.aiComposerTaskBarHostEl = null;
		this.aiComposerBodyEl = null;
		this.aiComposerDecisionKey = "";
		this.aiSendButtonEl = null;
		this.aiModelSelectEl = null;
		this.aiPermissionSelectEl = null;
	}

	private cleanupSkillReviewNotePopovers(): void {
		const cleanups = this.skillReviewNotePopoverCleanups.splice(0);
		for (const cleanup of cleanups) {
			cleanup();
		}
	}

	private renderShellHeader(containerEl: HTMLElement): void {
		const projects = this.plugin.settings.projects;
		const activeProject = this.getActiveProjectEntry();

		const left = containerEl.createDiv({ cls: "friday-shell-bar-left" });
		this.createIconButton(left, "friday-shell-icon-button", "menu", this.t("ai.sessions.expand", "展开对话列表"), () => {
			this.toggleAiSessionNavCollapsed();
		});

		const projectSection = left.createDiv({ cls: "friday-shell-project" });
		const projectMarkEl = projectSection.createSpan({
			cls: "friday-shell-project-mark",
			attr: { "aria-hidden": "true" },
		});
		setIcon(projectMarkEl, FRIDAY_ICON_ID);
		const projectBrandEl = projectSection.createSpan({
			cls: "friday-shell-project-brand friday-wordmark",
			text: this.t("nav.friday", "FRIDAY"),
		});
		projectBrandEl.style.fontFamily = FRIDAY_WORDMARK_FONT_FAMILY;

		const right = containerEl.createDiv({ cls: "friday-shell-bar-right" });
		const projectInline = right.createDiv({ cls: "friday-shell-project-inline" });
		projectInline.createSpan({
			cls: "friday-shell-project-inline-label",
			text: this.t("shell.project.current", "当前项目："),
		});
		if (projects.length === 0) {
			projectInline.createSpan({
				cls: "friday-shell-project-empty",
				text: this.t("shell.project.empty", "暂未创建项目"),
			});
		} else {
			const selectWrap = projectInline.createDiv({ cls: "friday-shell-project-select-wrap" });
			const selectEl = selectWrap.createEl("select", { cls: "friday-shell-project-select" });
			selectEl.setAttribute("aria-label", this.t("shell.project.label", "当前项目"));
			for (const project of projects) {
				const option = selectEl.createEl("option", { text: this.getProjectLabel(project) });
				option.value = this.getProjectKey(project);
				option.selected = this.getProjectKey(activeProject) === this.getProjectKey(project);
			}
			selectEl.onchange = () => {
				void this.switchActiveProject(selectEl.value);
			};
		}
		this.createIconButton(
			right,
			"friday-shell-icon-button",
			"settings",
			this.t("ai.button.openSettings", "打开设置"),
			() => {
				this.plugin.openSettingsTab();
			},
		);
	}

	private renderTopNav(containerEl: HTMLElement): void {
		this.addNavButton(containerEl, "chat", this.t("nav.chat", "Chat"), "message-square");
		this.addNavButton(containerEl, "sync", this.t("nav.projects", "Sync"), "refresh-cw");
		this.addNavButton(containerEl, "tools", this.t("nav.checks", "Tools"), "sliders-horizontal");
	}

	private renderBackgroundAgentStatus(containerEl: HTMLElement): void {
		const statusTarget = this.getBackgroundAgentStatusTarget();
		const completedSnapshot = this.getCompletedBackgroundAgentStatusSnapshot(statusTarget);
		const failedStatus = this.getBackgroundAgentFailureStatus(statusTarget);
		const isRunning = this.aiBusy || Boolean(this.aiRuntimeTrajectorySnapshot);
		const isFailed = Boolean((failedStatus || (!statusTarget && this.aiLastError)) && !isRunning);
		if (
			(this.activePage === "chat" && !statusTarget) ||
			(!isRunning && !completedSnapshot && !isFailed)
		) {
			return;
		}
		const statusEl = containerEl.createEl("button", { cls: "friday-background-agent-status" });
		statusEl.type = "button";
		statusEl.addClass(isFailed ? "is-failed" : isRunning ? "is-running" : "is-completed");
		statusEl.createSpan({
			cls: "friday-background-agent-status-label",
			text: isFailed
				? this.t("ai.background.failed", "FRIDAY 运行异常")
				: isRunning
					? this.t("ai.background.running", "FRIDAY 正在运行")
					: this.t("ai.background.completed", "FRIDAY 任务完成"),
		});
		statusEl.onclick = async () => {
			await this.openBackgroundAgentStatusTarget(statusTarget);
		};
	}

	private getBackgroundAgentStatusTarget(): AiTurnTarget | null {
		if (this.aiActiveTurnTarget && !this.isCurrentAiTurnTarget(this.aiActiveTurnTarget)) {
			return this.aiActiveTurnTarget;
		}
		if (this.aiBackgroundTurnTarget && !this.isCurrentAiTurnTarget(this.aiBackgroundTurnTarget)) {
			return this.aiBackgroundTurnTarget;
		}
		if (this.aiBackgroundTurnFailure && !this.isCurrentAiTurnTarget(this.aiBackgroundTurnFailure.target)) {
			return this.aiBackgroundTurnFailure.target;
		}
		return null;
	}

	private getCompletedBackgroundAgentStatusSnapshot(target?: AiTurnTarget | null): AgentTrajectorySnapshot | null {
		const sessionId = target?.sessionId ?? this.aiSessionId;
		const projectId = target?.projectId ?? this.plugin.settings.activeProjectId;
		const entry = Array.from(this.aiProcessSnapshotsByKey.entries()).reverse().find(([key, snapshot]) =>
			this.isSnapshotEntryOwnedBySession(key, snapshot, sessionId, projectId) &&
			snapshot.status === "completed"
		);
		return entry?.[1] ?? null;
	}

	private getBackgroundAgentFailureStatus(target?: AiTurnTarget | null): AiTurnFailureStatus | null {
		if (!this.aiBackgroundTurnFailure) {
			return null;
		}
		if (!target) {
			return this.aiBackgroundTurnFailure;
		}
		return this.isSameAiTurnTarget(this.aiBackgroundTurnFailure.target, target)
			? this.aiBackgroundTurnFailure
			: null;
	}

	private async openBackgroundAgentStatusTarget(target: AiTurnTarget | null): Promise<void> {
		this.activePage = "chat";
		this.aiForceScrollToBottomOnce = true;
		if (target?.projectId && target.projectId !== this.plugin.settings.activeProjectId) {
			await this.plugin.setActiveProject(target.projectId);
		}
		if (target?.sessionId) {
			await this.switchAiSession(target.sessionId, target.conversation);
		} else {
			this.renderBoard();
		}
	}

	private addNavButton(
		containerEl: HTMLElement,
		page: "chat" | "sync" | "tools",
		label: string,
		icon: string,
	): void {
		const button = containerEl.createEl("button", {
			cls: `friday-nav-button${this.activePage === page ? " is-active" : ""}`,
		});
		button.type = "button";
		button.setAttribute("aria-label", label);
		const iconEl = button.createSpan({ cls: "friday-nav-button-icon" });
		setIcon(iconEl, icon);
		button.createSpan({ cls: "friday-nav-button-label", text: label });
		button.onclick = () => {
			this.activePage = page;
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		};
	}

	private createIconButton(
		containerEl: HTMLElement,
		className: string,
		icon: string,
		label: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = containerEl.createEl("button", { cls: className });
		button.type = "button";
		button.addClass("kit-control-button-v1");
		button.setAttribute("aria-label", label);
		setIcon(button, icon);
		button.onclick = onClick;
		return button;
	}

	private renderToolsPage(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.t("checks.title", "Tools & Skills") });
		containerEl.createEl("p", {
			cls: "friday-tools-page-intro",
			text: this.t("policy.desc", "这里展示当前插件可生效的工具与 Skill。胶囊开关会直接影响整个插件的运行时可用性。"),
		});
		const body = containerEl.createDiv({ cls: "friday-tools-page-body" });
		void this.populateControlCenter(body);
	}

	private renderApprovalCard(containerEl: HTMLElement, item: PendingApproval): void {
		const card = containerEl.createDiv({ cls: "friday-approval-card" });
		card.createDiv({
			cls: "friday-approval-header",
			text: this.t("approval.title", "需要你确认"),
		});
		card.createDiv({
			cls: "friday-approval-detail",
			text: this.describeApprovalRequest(item),
		});
		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addApprovalDecisionButton(actions, this.t("approval.allowExecute", "允许执行"), item.id, "allow_once", "is-allow");
		this.addApprovalDecisionButton(actions, this.t("approval.reject", "拒绝"), item.id, "deny", "is-deny");
	}

	private describeApprovalRequest(item: PendingApproval): string {
		const tool = item.request.tool.trim().toLowerCase();
		const targetPath = item.request.targetPath?.trim() ?? "";
		const requestDescription = productizeRuntimeText(item.request.description) || item.request.description?.trim() || "";
		let description: string;
		if (tool === "exec") {
			description = this.t("approval.description.exec", "FRIDAY 需要运行一个本地命令来检查结果。");
		} else if (item.request.scope === "external") {
			description = this.t("approval.description.external", "FRIDAY 需要访问当前 Obsidian 范围之外的位置。");
		} else if (tool === "compile_wiki") {
			description = this.t("approval.description.compile", "FRIDAY 需要执行一次会更新资料的整理操作。");
		} else {
			description = requestDescription || this.t("approval.description.generic", "FRIDAY 需要先确认这个操作，确认后才会继续。");
		}
		if (targetPath) {
			return this.t("approval.description.withTarget", "{description}\n目标：{target}", {
				description,
				target: targetPath,
			});
		}
		return description;
	}

	private addApprovalDecisionButton(
		containerEl: HTMLElement,
		label: string,
		approvalId: string,
		decision: "allow_once" | "allow_session" | "allow_always" | "deny",
		extraClass: string,
	): void {
		const button = containerEl.createEl("button", {
			cls: `friday-approval-btn ${extraClass}`,
			text: label,
		});
		button.onclick = () => {
			this.approvalQueue.resolve(approvalId, decision);
			this.renderBoard();
		};
	}

	private renderProjectRemovalCard(containerEl: HTMLElement, project: ProjectEntry): void {
		const card = containerEl.createDiv({ cls: "friday-approval-card" });
		card.createDiv({
			cls: "friday-approval-header",
			text: this.t("projects.remove.pendingTitle", "Project removal pending"),
		});
		card.createDiv({
			cls: "friday-approval-detail",
			text: this.t("projects.remove.pendingDesc", "Remove project {project} from the workspace?", {
				project: this.getProjectLabel(project),
			}),
		});
		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(actions, this.t("projects.remove.confirm", "Remove now"), async () => {
			await this.plugin.removeProject(project.projectId);
			this.pendingProjectRemoval = null;
			this.activePage = "sync";
			await this.safeRenderBoard();
		});
		this.addPageButton(actions, this.t("projects.remove.cancel", "Cancel"), async () => {
			this.pendingProjectRemoval = null;
			this.renderBoard();
		});
	}

	private renderMemberEditorCard(containerEl: HTMLElement): void {
		const card = containerEl.createDiv({ cls: "friday-ai-chat-panel" });
		const memberEditorProjectLabel =
			this.memberEditorProject?.projectName || this.memberEditorProject?.projectId || this.t("common.notSet", "Not set");
		card.createEl("h4", {
			text: this.t("members.title", "Project members: {slug}", { slug: memberEditorProjectLabel }),
		});

		if (this.memberEditorMembers.length === 0) {
			card.createEl("p", {
				text: this.t("members.empty", "No members yet."),
			});
		} else {
			for (const member of this.memberEditorMembers) {
				const row = card.createDiv({ cls: "friday-sync-conflict-row" });
				row.createDiv({ text: `${member.userId} · ${member.role}` });
				const actions = row.createDiv({ cls: "friday-approval-actions" });
				for (const role of ["admin", "editor", "viewer"] as const) {
					this.addPageButton(actions, role, async () => {
						member.role = role;
						this.renderBoard();
					});
				}
				this.addPageButton(actions, this.t("members.remove", "Remove"), async () => {
					this.memberEditorMembers = this.memberEditorMembers.filter((item) => item.userId !== member.userId);
					this.renderBoard();
				});
			}
		}

		const addRow = card.createDiv({ cls: "friday-approval-actions" });
		const input = addRow.createEl("input", {
			attr: {
				type: "text",
				placeholder: this.t("members.userId", "Member ID"),
				value: this.memberEditorNewUserId,
			},
		});
		input.oninput = () => {
			this.memberEditorNewUserId = input.value.trim();
		};
		const roleSelect = addRow.createEl("select");
		for (const role of ["admin", "editor", "viewer"] as const) {
			const option = roleSelect.createEl("option", { text: role });
			option.value = role;
			option.selected = this.memberEditorNewRole === role;
		}
		roleSelect.onchange = () => {
			this.memberEditorNewRole = roleSelect.value as ProjectMember["role"];
		};
		this.addPageButton(addRow, this.t("members.add", "Add member"), async () => {
			if (!this.memberEditorNewUserId) {
				return;
			}
			if (this.memberEditorMembers.some((item) => item.userId === this.memberEditorNewUserId)) {
				return;
			}
			this.memberEditorMembers = [
				...this.memberEditorMembers,
				{ userId: this.memberEditorNewUserId, role: this.memberEditorNewRole },
			];
			this.memberEditorNewUserId = "";
			input.value = "";
			this.renderBoard();
		});

		const footer = card.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(footer, this.t("members.save", "Save members"), async () => {
			if (!this.memberEditorProject) {
				return;
			}
			await this.plugin.dataService.setProjectMembers(this.memberEditorProject, this.memberEditorMembers);
			this.memberEditorProject = null;
			this.memberEditorMembers = [];
			this.renderBoard();
		});
		this.addPageButton(footer, this.t("members.cancel", "Cancel"), async () => {
			this.memberEditorProject = null;
			this.memberEditorMembers = [];
			this.renderBoard();
		});
	}

	private renderSyncReport(
		containerEl: HTMLElement,
		item: { projectId: string; result: SyncResult; recordedAt: string },
	): void {
		const row = containerEl.createDiv({ cls: "friday-sync-project" });
		row.createDiv({
			text: `${item.projectId} · ${item.recordedAt}`,
		});
		row.createDiv({
			text: item.result.success
				? this.t("checks.sync.ok", "Status: success")
				: this.t("checks.sync.fail", "Status: failed"),
		});
		if (item.result.error) {
			row.createDiv({
				cls: "friday-ai-error",
				text: item.result.error,
			});
		}
		if (item.result.conflicts.length > 0) {
			row.createDiv({
				cls: "friday-approval-detail",
				text: this.t("projects.conflicts.detectedSummary", "Detected {count} conflict files.", {
					count: item.result.conflicts.length,
				}),
			});
		}
	}

	private async resolveConflictAction(
		projectId: string,
		filePath: string,
		strategy: "ours" | "theirs",
	): Promise<void> {
		const project = this.plugin.settings.projects.find((item) => item.projectId === projectId);
		if (!project) {
			throw new Error(this.t("checks.sync.projectMissing", "Project not found."));
		}
		await this.plugin.syncService.resolveConflict(project, filePath, strategy);
		await this.refreshSyncReport(project);
	}

	private async refreshSyncReport(project: ProjectEntry): Promise<void> {
		const existingRecords = this.plugin.workbenchStateStore.getSyncConflicts(project.projectId);
		const conflictRecords = await this.plugin.syncService.getConflictRecords(project, existingRecords);
		const recordedAt = new Date().toISOString();
		this.plugin.workbenchStateStore.recordSyncReport({
			projectId: project.projectId,
			recordedAt,
			result: {
				success: conflictRecords.length === 0,
				projectId: project.projectId,
				pulledFiles: [],
				pushedFiles: [],
				conflicts: conflictRecords.map((item) => item.filePath),
				conflictRecords,
			},
		});
		this.plugin.workbenchStateStore.replaceProjectSyncConflicts(project.projectId, conflictRecords);
		const firstConflictRecord = conflictRecords[0];
		if (firstConflictRecord && !this.expandedConflictKey) {
			this.expandedConflictKey = this.getSyncConflictKey(project.projectId, firstConflictRecord.filePath);
		}
		if (conflictRecords.length === 0 && this.expandedConflictKey.startsWith(`${project.projectId}::`)) {
			this.expandedConflictKey = "";
		}
		this.renderBoard();
	}

	private async generateConflictProposal(projectId: string, filePath: string): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul) {
			throw new Error(this.t("checks.sync.projectMissing", "Project not found."));
		}
		const activeFileContext = resolveActiveFileContextPolicy({
			activeFilePath: filePath,
			commandRequiresActiveFile: true,
			commandReason: "命令指定",
		});
		const resolution = this.plugin.executionEventRouter.routeToRuntime({
			type: "sync.conflict_proposal_requested",
			source: "project_action",
			projectId,
			prompt: filePath,
			payload: { filePath },
		});
		if (resolution.type !== "runtime" || !resolution.requestedSkillName) {
			throw new Error("Project conflict proposal could not be resolved to a runtime skill invocation.");
		}
		const decision = await this.plugin.executionPlanner.plan(resolution, { activeFileContext });
		const result = await this.plugin.executionOrchestrator.execute(decision, {
			agentId: activeSoul.id,
			conversation: [],
			activeFileContext,
		});
		const traceSummary = result.traces[0]?.summary ?? "manual";
		const match = traceSummary.match(/\((ours|theirs|manual)\)/i);
		const strategy = (match?.[1]?.toLowerCase() ?? "manual") as "ours" | "theirs" | "manual";
		const current = this.getSyncConflictRecord(projectId, filePath);
		if (current) {
			this.plugin.workbenchStateStore.replaceSyncConflict({
				...current,
				markdown: result.assistantText,
				recommendedStrategy: strategy,
			});
		}
		this.expandedConflictKey = this.getSyncConflictKey(projectId, filePath);
		this.activePage = "sync";
		this.renderBoard();
	}

	private deferConflictAction(projectId: string, filePath: string): void {
		const current = this.getSyncConflictRecord(projectId, filePath);
		if (!current) {
			return;
		}
		this.plugin.workbenchStateStore.replaceSyncConflict({
			...current,
			status: "deferred",
		});
		this.expandedConflictKey = this.getSyncConflictKey(projectId, filePath);
		this.renderBoard();
	}

	private getProjectKey(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		return project.projectId;
	}

	private getProjectLabel(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		return project.projectName || project.projectId || project.slug;
	}

	private getActiveProjectEntry(): ProjectEntry | null {
		const projects = this.plugin.settings.projects;
		if (projects.length === 0) {
			return null;
		}
		const activeProjectId = this.plugin.settings.activeProjectId;
		return projects.find((project) => this.getProjectKey(project) === activeProjectId) ?? projects[0] ?? null;
	}

	private async ensureActiveProjectInitialized(): Promise<void> {
		const activeProject = this.getActiveProjectEntry();
		if (!activeProject || this.plugin.settings.activeProjectId === this.getProjectKey(activeProject)) {
			return;
		}
		await this.plugin.setActiveProject(this.getProjectKey(activeProject));
	}

	private async switchActiveProject(projectId: string): Promise<void> {
		if (!projectId || projectId === this.plugin.settings.activeProjectId) {
			return;
		}
		await this.plugin.setActiveProject(projectId);
		await this.safeRenderBoard();
	}

	private renderSyncPage(containerEl: HTMLElement): void {
		const projects = this.plugin.settings.projects;
		const activeProject = this.getActiveProjectEntry();
		if (projects.length === 0) {
			const emptyEl = containerEl.createDiv({ cls: "friday-empty-state" });
			emptyEl.createEl("h4", { text: this.t("projects.empty.title", "Sync is not available yet") });
			emptyEl.createEl("p", {
				text: this.t("projects.empty.desc", "Configure a project in settings first, then review sync status here."),
			});
			this.addPageButton(emptyEl, this.t("projects.empty.action", "Open Project Settings"), async () => {
				this.plugin.openSettingsTab("project");
			});
			return;
		}

		if (!activeProject) {
			return;
		}
		const workbench = containerEl.createDiv({ cls: "project-sync-workbench-v1 friday-project-sync-workbench" });
		this.renderSyncProjectCard(workbench, activeProject);
	}

	private renderSyncProjectCard(containerEl: HTMLElement, project: ProjectEntry): void {
		const decisionPanel = containerEl.createDiv({ cls: "friday-sync-decision-panel project-command-surface-v2 friday-sync-command-bar-v1" });
		const decisionCopy = decisionPanel.createDiv({ cls: "friday-sync-decision-copy project-command-copy-v2" });
		decisionCopy.createSpan({
			cls: "project-overline-v2",
			text: this.t("projects.sync.decision.label", "同步决策"),
		});
		const titleEl = decisionCopy.createEl("strong", { text: this.getProjectSyncTitle(project) });
		const descriptionEl = decisionCopy.createSpan({ cls: "friday-sync-decision-note", text: "" });
		const metaEl = decisionCopy.createDiv({ cls: "friday-sync-decision-meta project-decision-meta-v2" });
		const decisionActions = decisionPanel.createDiv({ cls: "friday-sync-decision-actions project-command-actions-v2" });
		this.addPageIconButton(decisionActions, this.t("projects.button.checkStatus", "检查状态"), "refresh-cw", async () => {
			await this.safeRenderBoard();
		});
		const branchMenu = this.renderProjectBranchMenu(decisionActions, project, null);

		const preview = containerEl.createDiv({ cls: "friday-sync-preview-v1 friday-sync-ledger-v1 project-sync-ledger-v2" });
		const localValueEl = this.createSyncPreviewItem(
			preview,
			this.t("projects.sync.matrix.ahead", "待推送"),
			this.t("projects.sync.pendingCheck", "待检查"),
		);
		const remoteValueEl = this.createSyncPreviewItem(
			preview,
			this.t("projects.sync.matrix.behind", "待拉取"),
			this.t("projects.sync.pendingCheck", "待检查"),
		);
		const dirtyValueEl = this.createSyncPreviewItem(
			preview,
			this.t("projects.sync.preview.confirmFiles", "待确认文件"),
			this.t("projects.sync.pendingCheck", "待检查"),
		);
		const conflictValueEl = this.createSyncPreviewItem(
			preview,
			this.t("projects.sync.matrix.conflicts", "冲突"),
			this.t("projects.sync.pendingCheck", "待检查"),
		);

		const detailLane = containerEl.createDiv({ cls: "project-detail-lane-v2 friday-sync-detail-lane" });
		const localLane = detailLane.createDiv({ cls: "project-main-lane-v2 project-local-workspace-v2" });
		this.renderWorkingTreeChanges(localLane, []);
		const functionCard = detailLane.createEl("aside", {
			cls: "project-function-card-v2 friday-sync-function-card",
			attr: { "aria-label": this.t("projects.sync.function.info", "同步功能信息") },
		});
		const statusDetail = this.createSyncFunctionSection(
			functionCard,
			this.t("projects.sync.function.status", "同步状态"),
		);
		const treeDetail = this.createSyncFunctionSection(
			functionCard,
			this.t("projects.sync.function.tree", "Git更新树"),
			"project-git-rail-v2",
		);
		const collabDetail = this.createSyncFunctionSection(
			functionCard,
			this.t("projects.sync.function.collab", "协作状态"),
			"project-collab-stream-v2",
		);
		const ignoreDetail = this.createSyncFunctionSection(
			functionCard,
			this.t("projects.sync.function.ignore", "忽略规则"),
			"project-ignore-rules-v2",
		);
		this.renderSyncReadinessChecks(statusDetail.bodyEl, project, null);
		const syncButton = this.addPageButton(statusDetail.bodyEl, this.t("projects.button.sync", "同步当前项目"), async () => {
			await this.syncSingleProject(project);
		});
		syncButton.addClass("friday-sync-primary-action");
		this.renderSyncAutomationControls(statusDetail.bodyEl, project);
		this.renderProjectGitUpdateTree(treeDetail.bodyEl, project, null);
		this.renderProjectCollaborationLog(collabDetail.bodyEl, project);
		this.renderProjectStatusPanel(collabDetail.bodyEl, project);
		this.renderIgnoreRulesSummary(ignoreDetail.bodyEl);

		const decision: SyncDecisionElements = {
			titleEl,
			descriptionEl,
			metaEl,
			chipEl: statusDetail.stateEl,
			syncButton,
			localValueEl,
			remoteValueEl,
			dirtyValueEl,
			conflictValueEl,
			currentBranchEl: branchMenu.currentBranchEl,
			branchListEl: branchMenu.listEl,
		};

		const nextStepEl = decisionPanel.createDiv({ cls: "friday-sync-next-step" });

		if (project.gitState === "none") {
			this.updateSyncDecisionPanel(decision, project, null, {
				description: this.t("projects.sync.none", "当前没有关联远端仓库，需配置后启用同步功能。"),
				variant: "warning",
				chipText: this.t("projects.sync.notReady", "未就绪"),
				syncEnabled: false,
			});
			this.addPageButton(nextStepEl, this.t("projects.button.configure", "立即配置"), async () => {
				this.plugin.openSettingsTab("project");
			});
		} else if (project.gitState === "git_local") {
			this.updateSyncDecisionPanel(decision, project, null, {
				description: this.t("projects.sync.gitLocal", "当前项目尚未绑定远端仓库，远端同步功能不可用。"),
				variant: "warning",
				chipText: this.t("projects.sync.localOnly", "仅本地"),
				syncEnabled: false,
			});
			this.addPageButton(nextStepEl, this.t("projects.button.configure", "立即配置"), async () => {
				this.plugin.openSettingsTab("project");
			});
			void this.populateProjectSyncStatus(project, decision, statusDetail.bodyEl, treeDetail.bodyEl, localLane, collabDetail.bodyEl);
			void this.populateIgnoreCandidates(ignoreDetail.bodyEl, project, ignoreDetail.stateEl);
		} else if (project.gitState === "git_remote_bound") {
			this.updateSyncDecisionPanel(decision, project, null, {
				description: this.t("projects.sync.gitRemoteBound", "当前项目已绑定远端仓库，可执行完整同步。"),
				variant: "active",
				chipText: this.t("projects.sync.ready", "就绪"),
				syncEnabled: true,
			});
			void this.populateProjectSyncStatus(project, decision, statusDetail.bodyEl, treeDetail.bodyEl, localLane, collabDetail.bodyEl);
			void this.populateIgnoreCandidates(ignoreDetail.bodyEl, project, ignoreDetail.stateEl);
		}
	}

	private renderProjectBranchMenu(
		containerEl: HTMLElement,
		project: ProjectEntry,
		status: SyncStatus | null,
	): { currentBranchEl: HTMLElement; listEl: HTMLElement } {
		const branchMenu = containerEl.createEl("details", { cls: "project-branch-menu-v2 friday-sync-branch-menu" });
		const summary = branchMenu.createEl("summary", {
			cls: "project-branch-summary-v2",
			attr: { "aria-label": this.t("projects.sync.branch.select", "选择分支") },
		});
		summary.createSpan({ cls: "project-dot-v2", attr: { "aria-hidden": "true" } });
		const currentBranchEl = summary.createSpan({ cls: "project-current-branch-v2", text: status?.branch || this.t("projects.sync.branch.unknown", "待检查") });
		const listEl = branchMenu.createDiv({
			cls: "project-branch-menu-list-v2",
			attr: {
				role: "listbox",
				"aria-label": this.t("projects.sync.branch.options", "可选分支"),
			},
		});
		this.renderProjectBranchChoices(listEl, project, status);
		return { currentBranchEl, listEl };
	}

	private renderProjectBranchChoices(containerEl: HTMLElement, project: ProjectEntry, status: SyncStatus | null): void {
		containerEl.empty();
		const branch = status?.branch || this.t("projects.sync.branch.unknown", "待检查");
		this.renderProjectBranchChoice(
			containerEl,
			branch,
			this.t("projects.sync.branch.currentDesc", "当前分支 · 跟踪 origin/{branch} · 待推送 {ahead}", {
				branch: status?.branch || "main",
				ahead: status?.ahead ?? 0,
			}),
			this.t("projects.sync.branch.current", "当前"),
			"active",
			true,
		);
		this.renderProjectBranchChoice(
			containerEl,
			status?.branch ? `origin/${status.branch}` : "origin/main",
			this.t("projects.sync.branch.remoteDesc", "远端跟踪分支 · 待拉取 {behind}", {
				behind: status?.behind ?? 0,
			}),
			status && status.behind > 0 ? this.t("projects.sync.branch.needsUpdate", "需更新") : this.t("projects.sync.branch.tracking", "跟踪"),
			status && status.behind > 0 ? "warning" : "muted",
			false,
		);
		this.renderProjectBranchChoice(
			containerEl,
			this.t("projects.sync.branch.switchPlaceholder", "选择其他分支"),
			this.t("projects.sync.branch.switchPending", "分支切换入口已预留，切换前会提示同步风险。"),
			this.t("projects.sync.branch.pending", "待启用"),
			"muted",
			false,
			true,
		);
	}

	private renderProjectBranchChoice(
		containerEl: HTMLElement,
		name: string,
		description: string,
		chipText: string,
		variant: "active" | "warning" | "muted",
		current: boolean,
		muted = false,
	): void {
		const choice = containerEl.createEl("button", {
			cls: `project-branch-choice-v2${current ? " is-current" : ""}`,
			attr: {
				type: "button",
				role: "option",
				"aria-selected": current ? "true" : "false",
			},
		});
		choice.createSpan({ cls: `project-dot-v2${muted ? " is-muted" : variant === "warning" ? " is-warning" : ""}`, attr: { "aria-hidden": "true" } });
		const copy = choice.createSpan({ cls: "project-branch-choice-copy-v2" });
		copy.createEl("strong", { text: name });
		copy.createSpan({ text: description });
		this.createSoftChip(choice, chipText, variant);
		choice.onclick = () => {
			new Notice(this.t("projects.sync.branch.switchPending", "分支切换入口已预留，切换前会提示同步风险。"), 3000);
		};
	}

	private createSyncFunctionSection(containerEl: HTMLElement, title: string, extraClass = ""): SyncDetailSection {
		const detailsEl = containerEl.createEl("details", {
			cls: `project-function-section-v2${extraClass ? ` ${extraClass}` : ""}`,
			attr: { "aria-label": title },
		});
		const summary = detailsEl.createEl("summary", { cls: "project-function-summary-v2" });
		summary.createEl("strong", { text: title });
		const stateEl = detailsEl.createSpan({ cls: "project-function-state-v2 friday-sync-detail-state" });
		stateEl.hidden = true;
		const bodyEl = detailsEl.createDiv({ cls: "friday-sync-detail-body project-function-detail-v2" });
		return { detailsEl, stateEl, bodyEl };
	}

	private renderSyncAutomationControls(containerEl: HTMLElement, project: ProjectEntry): void {
		if (project.gitState !== "git_remote_bound") {
			return;
		}
		const panel = containerEl.createDiv({ cls: "friday-project-status-group friday-sync-automation-panel" });
		panel.createEl("h5", { text: this.t("projects.sync.autoTitle", "自动同步") });
		panel.createEl("p", {
			text: this.t("projects.sync.autoMode", "当前模式：{mode}", {
				mode: this.getSyncModeLabel(this.plugin.settings.sync.mode),
			}),
		});

		const modeRow = panel.createDiv({ cls: "friday-project-sync-control-row" });
		modeRow.createSpan({
			cls: "friday-project-sync-control-label",
			text: this.t("projects.sync.autoModeLabel", "同步模式"),
		});
		const modeSelect = modeRow.createEl("select", { cls: "friday-shell-project-select" });
		for (const option of this.getSyncModeOptions()) {
			const element = modeSelect.createEl("option", { text: option.label });
			element.value = option.value;
			element.selected = option.value === this.plugin.settings.sync.mode;
		}
		modeSelect.onchange = () => {
			void this.updateSyncMode(modeSelect.value as "manual" | "idle_auto" | "continuous_auto");
		};

		const projectRow = panel.createDiv({ cls: "friday-project-sync-control-row" });
		projectRow.createSpan({
			cls: "friday-project-sync-control-label",
			text: this.t("projects.sync.autoProject", "当前项目参与自动同步"),
		});
		const toggleHost = projectRow.createDiv({ cls: "friday-control-toggle-host" });
		const toggle = new ToggleComponent(toggleHost);
		toggle.toggleEl.addClass("friday-control-native-toggle");
		toggle.setValue(project.autoSync).onChange((value) => {
			void this.updateProjectAutoSync(project, value);
		});
	}

	private getProjectSyncTitle(project: ProjectEntry): string {
		if (project.gitState === "git_remote_bound") {
			return this.t("projects.sync.title.ready", "{project} 已准备同步", {
				project: this.getProjectLabel(project),
			});
		}
		if (project.gitState === "git_local") {
			return this.t("projects.sync.title.local", "{project} 是本地 Git 仓库", {
				project: this.getProjectLabel(project),
			});
		}
		return this.t("projects.sync.title.needsRemote", "{project} 需要配置远端", {
			project: this.getProjectLabel(project),
		});
	}

	private getProjectGitStateLabel(project: ProjectEntry): string {
		if (project.gitState === "git_remote_bound") {
			return this.t("projects.sync.state.remoteConnected", "远端已连接");
		}
		if (project.gitState === "git_local") {
			return this.t("projects.sync.state.localRepo", "本地仓库");
		}
		return this.t("projects.sync.state.noRemote", "未配置");
	}

	private createSoftChip(
		containerEl: HTMLElement,
		text: string,
		variant: "active" | "warning" | "muted" = "muted",
	): HTMLElement {
		const chip = containerEl.createSpan({ cls: "kit-soft-chip-v1", text });
		if (variant === "active") {
			chip.addClass("is-active");
		} else if (variant === "warning") {
			chip.addClass("is-warning");
		}
		return chip;
	}

	private createSyncPreviewItem(containerEl: HTMLElement, label: string, value: string): HTMLElement {
		const item = containerEl.createDiv({ cls: "friday-sync-preview-item" });
		item.createSpan({ cls: "friday-sync-preview-label", text: label });
		return item.createEl("strong", { text: value });
	}

	private createSyncDetailSection(containerEl: HTMLElement, title: string, description = ""): SyncDetailSection {
		const detailsEl = containerEl.createEl("details", { cls: "friday-sync-detail-section" });
		const summary = detailsEl.createEl("summary", { cls: "friday-sync-detail-summary" });
		const text = summary.createDiv({ cls: "friday-sync-detail-copy" });
		text.createEl("strong", { text: title });
		if (description) {
			text.createSpan({ text: description });
		}
		const stateEl = summary.createSpan({
			cls: "friday-sync-detail-state",
			text: this.t("projects.sync.pendingCheck", "待检查"),
		});
		const bodyEl = detailsEl.createDiv({ cls: "friday-sync-detail-body" });
		return { detailsEl, stateEl, bodyEl };
	}

	private updateSyncDecisionPanel(
		elements: SyncDecisionElements,
		project: ProjectEntry,
		status: SyncStatus | null,
		override: {
			description?: string;
			variant?: "active" | "warning" | "muted";
			chipText?: string;
			syncEnabled?: boolean;
		} = {},
	): void {
		const projectLabel = this.getProjectLabel(project);
		let title = this.getProjectSyncTitle(project);
		let description =
			override.description ||
			this.t("projects.sync.decision.readyDesc", "同步前会提交本地变化，再拉取和推送远端更新。");
		let variant: "active" | "warning" | "muted" = override.variant ?? "muted";
		let chipText = override.chipText ?? this.t("projects.sync.pendingCheck", "待检查");
		let syncEnabled = override.syncEnabled ?? project.gitState === "git_remote_bound";

		if (project.gitState === "git_remote_bound" && status) {
			if (!status.connected) {
				title = this.t("projects.sync.decision.remoteBlockedTitle", "{project} 暂时不能同步", { project: projectLabel });
				description = this.t("projects.sync.decision.remoteBlockedDesc", "先检查网络、仓库地址或访问权限，然后重新检查状态。");
				variant = "warning";
				chipText = this.t("projects.sync.remoteBlocked", "受阻");
				syncEnabled = false;
			} else if (status.conflicts > 0) {
				title = this.t("projects.sync.decision.conflictTitle", "{project} 有冲突需要处理", { project: projectLabel });
				description = this.t("projects.sync.decision.conflictDesc", "先处理冲突文件，再执行同步。");
				variant = "warning";
				chipText = this.t("projects.sync.blockedShort", "受阻");
				syncEnabled = false;
			} else {
				title = this.t("projects.sync.decision.readyTitle", "{project} 可以同步", { project: projectLabel });
				description = this.t("projects.sync.decision.readyDesc", "同步前会提交本地变化，再拉取和推送远端更新。");
				variant = "active";
				chipText = this.t("projects.sync.ready", "就绪");
				syncEnabled = true;
			}
		}

		elements.titleEl.setText(title);
		elements.descriptionEl.setText(description);
		elements.descriptionEl.toggleClass("is-empty", description.length === 0);
		elements.metaEl.empty();
		this.renderDecisionMetaRow(
			elements.metaEl,
			this.t("projects.sync.projectScope", "项目范围"),
			this.getProjectBoundaryLabel(project),
		);
		this.renderDecisionMetaRow(
			elements.metaEl,
			this.t("projects.sync.remoteAddress", "远端地址"),
			project.gitRemote || this.t("common.notSet", "Not set"),
		);
		elements.chipEl.setText(chipText);
		elements.chipEl.removeClass("is-active");
		elements.chipEl.removeClass("is-warning");
		if (variant === "active") {
			elements.chipEl.addClass("is-active");
		} else if (variant === "warning") {
			elements.chipEl.addClass("is-warning");
		}
		elements.syncButton.disabled = !syncEnabled;

		elements.localValueEl.setText(this.getSyncAheadPreview(status));
		elements.remoteValueEl.setText(this.getSyncBehindPreview(project, status));
		elements.dirtyValueEl.setText(this.getSyncLocalPreview(status));
		elements.conflictValueEl.setText(this.getSyncConflictPreview(status));
		elements.currentBranchEl.setText(status?.branch || this.t("projects.sync.branch.unknown", "待检查"));
		this.renderProjectBranchChoices(elements.branchListEl, project, status);
	}

	private renderDecisionMetaRow(containerEl: HTMLElement, label: string, value: string): void {
		const row = containerEl.createSpan({ cls: "project-decision-row-v2" });
		row.createEl("strong", { text: `${label}:` });
		row.createSpan({ text: value });
	}

	private getProjectBoundaryLabel(project: ProjectEntry): string {
		return project.boundaryPath || this.getProjectLabel(project);
	}

	private getSyncAheadPreview(status: SyncStatus | null): string {
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		return status.ahead > 0
			? this.t("projects.sync.count.commits", "{count} 个提交", { count: status.ahead })
			: "0";
	}

	private getSyncBehindPreview(project: ProjectEntry, status: SyncStatus | null): string {
		if (project.gitState !== "git_remote_bound") {
			return this.t("projects.sync.notReady", "未就绪");
		}
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		if (!status.connected) {
			return this.t("projects.sync.preview.remoteBlocked", "待重新检查");
		}
		return status.behind > 0
			? this.t("projects.sync.count.commits", "{count} 个提交", { count: status.behind })
			: "0";
	}

	private getSyncLocalPreview(status: SyncStatus | null): string {
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		return status.dirty > 0
			? this.t("projects.sync.preview.localFiles", "{count} 个文件，将在同步前提交", { count: status.dirty })
			: this.t("projects.sync.preview.localClean", "无本地改动");
	}

	private getSyncRemotePreview(project: ProjectEntry, status: SyncStatus | null): string {
		if (project.gitState !== "git_remote_bound") {
			return this.t("projects.sync.notReady", "未就绪");
		}
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		if (!status.connected) {
			return this.t("projects.sync.preview.remoteBlocked", "待重新检查");
		}
		return status.behind > 0
			? this.t("projects.sync.preview.remoteBehind", "{count} 个提交待拉取", { count: status.behind })
			: this.t("projects.sync.preview.remoteClean", "无待拉取");
	}

	private getSyncConflictPreview(status: SyncStatus | null): string {
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		return status.conflicts > 0
			? this.t("projects.sync.preview.conflictFiles", "{count} 个文件需处理", { count: status.conflicts })
			: this.t("projects.sync.preview.conflictClean", "无冲突");
	}

	private renderProjectSyncEvent(
		containerEl: HTMLElement,
		title: string,
		chipText: string,
		variant: "active" | "warning" | "muted" = "muted",
		detail = "",
	): void {
		const row = containerEl.createDiv({ cls: "kit-event-row-v1 friday-project-sync-event" });
		const main = row.createDiv({ cls: "kit-event-row-main-v1" });
		main.createEl("strong", { text: title });
		if (detail) {
			main.createSpan({ text: detail });
		}
		this.createSoftChip(row, chipText, variant);
	}

	private renderSyncReadinessChecks(
		containerEl: HTMLElement,
		project: ProjectEntry,
		status: SyncStatus | null,
	): void {
		containerEl.empty();
		this.renderSyncCheckRow(
			containerEl,
			this.t("projects.sync.checks.gitRepo", "Git 仓库已初始化"),
			project.gitState === "none" ? this.t("projects.sync.notReady", "未就绪") : this.t("projects.sync.ready", "就绪"),
			project.gitState === "none" ? "warning" : "active",
		);
		this.renderSyncCheckRow(
			containerEl,
			this.t("projects.sync.checks.remote", "远端仓库可访问"),
			this.getRemoteAccessLabel(project, status),
			project.gitState === "git_remote_bound" && status?.connected !== false ? "active" : "warning",
		);
		this.renderSyncCheckRow(
			containerEl,
			this.t("projects.sync.checks.localChanges", "本地改动"),
			status ? this.formatSyncFileCount(status.dirty) : this.t("projects.sync.pendingCheck", "待检查"),
			status && status.dirty > 0 ? "warning" : "muted",
		);
		this.renderSyncCheckRow(
			containerEl,
			this.t("projects.sync.checks.conflicts", "冲突文件"),
			status ? this.formatSyncFileCount(status.conflicts) : this.t("projects.sync.pendingCheck", "待检查"),
			status && status.conflicts > 0 ? "warning" : "muted",
		);
	}

	private renderSyncCheckRow(
		containerEl: HTMLElement,
		label: string,
		value: string,
		variant: "active" | "warning" | "muted",
	): void {
		const row = containerEl.createDiv({ cls: "project-sync-check-row-v1 project-function-row-v2" });
		const copy = row.createDiv();
		copy.createEl("strong", { text: label });
		copy.createSpan({ text: value });
		this.createSoftChip(row, value, variant);
	}

	private getRemoteAccessLabel(project: ProjectEntry, status: SyncStatus | null): string {
		if (project.gitState !== "git_remote_bound") {
			return this.t("projects.sync.notReady", "未就绪");
		}
		if (!status) {
			return this.t("projects.sync.pendingCheck", "待检查");
		}
		return status.connected
			? this.t("projects.sync.ready", "就绪")
			: this.t("projects.sync.remoteBlocked", "受阻");
	}

	private formatSyncFileCount(count: number): string {
		return count > 0
			? this.t("projects.sync.count.files", "{count} 个文件", { count })
			: this.t("projects.sync.noneShort", "无");
	}

	private renderProjectBranchPicker(
		containerEl: HTMLElement,
		project: ProjectEntry,
		status: SyncStatus | null,
	): void {
		containerEl.empty();
		const picker = containerEl.createDiv({ cls: "project-branch-picker-v1" });
		const title = picker.createDiv({ cls: "project-title-stack-v1" });
		title.createEl("strong", { text: this.t("projects.sync.branch.title", "分支选择") });
		title.createSpan({
			text: this.t("projects.sync.branch.desc", "先显示当前分支、跟踪关系和切换风险。"),
		});
		const branch = status?.branch || this.t("projects.sync.branch.unknown", "待检查");
		const trackingBranch = status?.branch ? `origin/${status.branch}` : "origin/main";
		const active = picker.createDiv({ cls: "project-branch-active-v1" });
		const activeText = active.createDiv();
		activeText.createEl("strong", { text: branch });
		activeText.createSpan({
			text: this.t("projects.sync.branch.currentDesc", "当前分支 · 跟踪 origin/{branch} · 待推送 {ahead}", {
				branch: status?.branch || "main",
				ahead: status?.ahead ?? 0,
			}),
		});
		this.createSoftChip(active, this.t("projects.sync.branch.current", "当前"), "active");

		this.renderProjectBranchRow(
			picker,
			trackingBranch,
			this.t("projects.sync.branch.remoteDesc", "远端跟踪分支 · 待拉取 {behind}", {
				behind: status?.behind ?? 0,
			}),
			status && status.behind > 0 ? this.t("projects.sync.branch.needsUpdate", "需更新") : this.t("projects.sync.branch.tracking", "跟踪"),
			status && status.behind > 0 ? "warning" : "muted",
		);
		this.renderProjectBranchRow(
			picker,
			this.t("projects.sync.branch.switchPlaceholder", "选择其他分支"),
			this.t("projects.sync.branch.switchPending", "分支切换入口已预留，切换前会提示同步风险。"),
			this.t("projects.sync.branch.pending", "待启用"),
			"muted",
			true,
		);
	}

	private renderProjectBranchRow(
		containerEl: HTMLElement,
		name: string,
		description: string,
		chipText: string,
		variant: "active" | "warning" | "muted",
		muted = false,
	): void {
		const row = containerEl.createDiv({ cls: "project-branch-row-v1" });
		row.createSpan({ cls: `project-branch-dot-v1${muted ? " is-muted" : variant === "warning" ? " is-warning" : ""}`, attr: { "aria-hidden": "true" } });
		const text = row.createDiv();
		text.createEl("strong", { text: name });
		text.createSpan({ text: description });
		this.createSoftChip(row, chipText, variant);
	}

	private renderProjectCollaborationLog(containerEl: HTMLElement, project: ProjectEntry): void {
		containerEl.empty();
		const panel = containerEl.createDiv({ cls: "project-collab-log-v1 project-collab-stream-v2" });
		const syncReport = this.plugin.workbenchStateStore.getSyncReports().find((item) => item.projectId === project.projectId) ?? null;
		if (!syncReport) {
			this.renderProjectCollabRow(
				panel,
				"F",
				this.t("projects.sync.collab.emptyTitle", "暂无新的协作记录"),
				this.t("projects.sync.collab.emptyDesc", "完成一次同步后，这里会显示最近的本地和远端变化。"),
				this.t("projects.sync.noneShort", "无"),
				"muted",
			);
			return;
		}
		const changedFiles = syncReport.result.pulledFiles.length + syncReport.result.pushedFiles.length;
		this.renderProjectCollabRow(
			panel,
			"F",
			syncReport.result.success
				? this.t("projects.sync.collab.lastSuccess", "上次同步已完成")
				: this.t("projects.sync.collab.lastFailed", "上次同步未完成"),
			this.t("projects.sync.collab.lastDesc", "{time} · {count} 个文件变化", {
				time: syncReport.recordedAt,
				count: changedFiles,
			}),
			syncReport.result.success ? this.t("projects.sync.done", "完成") : this.t("projects.sync.blockedShort", "受阻"),
			syncReport.result.success ? "active" : "warning",
		);
	}

	private renderProjectCollabRow(
		containerEl: HTMLElement,
		avatar: string,
		title: string,
		detail: string,
		chipText: string,
		variant: "active" | "warning" | "muted",
	): void {
		const row = containerEl.createDiv({ cls: "project-collab-row-v1 project-collab-item-v2" });
		const avatarStack = row.createDiv({ cls: "project-avatar-stack-v1", attr: { "aria-label": this.t("projects.sync.collab.avatar", "协作者") } });
		avatarStack.createSpan({ cls: "project-avatar-v1 is-active", text: avatar });
		const text = row.createDiv();
		text.createEl("strong", { text: title });
		text.createSpan({ text: detail });
		this.createSoftChip(row, chipText, variant);
	}

	private renderProjectGitUpdateTree(
		containerEl: HTMLElement,
		project: ProjectEntry,
		status: SyncStatus | null,
	): void {
		containerEl.empty();
		const tree = containerEl.createDiv({ cls: "project-git-tree-v1 project-git-rail-v2" });
		const branch = status?.branch || this.t("common.notSet", "Not set");
		this.renderProjectGitNode(
			tree,
			this.t("projects.sync.tree.local", "本地 {branch}", { branch }),
			this.t("projects.sync.tree.localDesc", "当前工作分支 · 待推送 {ahead}", {
				ahead: status?.ahead ?? 0,
			}),
			status && status.ahead > 0 ? "Ahead" : this.t("projects.sync.tree.aligned", "对齐"),
			status && status.ahead > 0 ? "warning" : "active",
		);
		this.renderProjectGitNode(
			tree,
			`origin/${branch}`,
			this.t("projects.sync.tree.remoteDesc", "远端跟踪分支 · 待拉取 {behind}", {
				behind: status?.behind ?? 0,
			}),
			status && status.behind > 0 ? this.t("projects.sync.tree.pullable", "可拉取") : this.t("projects.sync.tree.aligned", "对齐"),
			status && status.behind > 0 ? "warning" : "active",
			true,
		);
	}

	private renderProjectGitNode(
		containerEl: HTMLElement,
		title: string,
		detail: string,
		chipText: string,
		variant: "active" | "warning" | "muted",
		remote = false,
	): void {
		const row = containerEl.createDiv({ cls: `project-git-node-v1 project-rail-node-v2${remote ? " is-remote" : ""}` });
		row.createSpan({ cls: `project-git-dot-v1${remote ? " is-muted" : variant === "warning" ? " is-warning" : ""}`, attr: { "aria-hidden": "true" } });
		const text = row.createDiv();
		text.createEl("strong", { text: title });
		text.createSpan({ text: detail });
		this.createSoftChip(row, chipText, variant);
	}

	private async populateProjectSyncStatus(
		project: ProjectEntry,
		decision: SyncDecisionElements,
		statusPanel: HTMLElement,
		gitTreePanel: HTMLElement,
		localChangesPanel: HTMLElement,
		collabPanel: HTMLElement,
	): Promise<void> {
		try {
			const status = await this.plugin.syncService.getStatus(project);
			this.updateSyncDecisionPanel(decision, project, status);
			this.renderSyncReadinessChecks(statusPanel, project, status);
			this.renderSyncAutomationControls(statusPanel, project);
			this.renderProjectGitUpdateTree(gitTreePanel, project, status);
			this.renderProjectCollaborationLog(collabPanel, project);
			this.renderProjectStatusPanel(collabPanel, project);
			this.updateSyncDetailState(
				gitTreePanel,
				status.ahead > 0 || status.behind > 0
					? this.t("projects.sync.branch.needsUpdate", "需更新")
					: this.t("projects.sync.tree.aligned", "对齐"),
				status.ahead > 0 || status.behind > 0 ? "warning" : "active",
			);
			localChangesPanel.empty();
			const runtimeState = this.plugin.syncRuntimeStore.getProjectState(this.getProjectKey(project));
			if (runtimeState) {
				let runtimeKey = "projects.sync.runtime";
				let chipText: string = runtimeState.stage;
				let variant: "active" | "warning" | "muted" = "muted";
				if (runtimeState.stage === "offline") {
					runtimeKey = "projects.sync.offline";
				} else if (runtimeState.stage === "blocked" || runtimeState.stage === "failed") {
					runtimeKey = "projects.sync.blocked";
				}
				if (runtimeState.stage === "checking" || runtimeState.stage === "pulling" || runtimeState.stage === "pushing") {
					variant = "active";
					chipText = this.t("projects.sync.running", "运行中");
				} else if (runtimeState.stage === "offline" || runtimeState.stage === "blocked" || runtimeState.stage === "failed") {
					variant = "warning";
					chipText = this.t("projects.sync.blockedShort", "受阻");
				}
				this.renderProjectSyncEvent(
					statusPanel,
					this.t(runtimeKey, "运行态：{stage}", {
						stage: runtimeState.stage,
						message: runtimeState.message || this.t("common.notSet", "Not set"),
					}),
					chipText,
					variant,
					runtimeState.recordedAt,
				);
			}
			this.renderWorkingTreeChanges(localChangesPanel, status.workingTreeChanges);
			this.updateSyncDetailState(
				statusPanel,
				this.formatSyncFileCount(status.workingTreeChanges.length),
				status.conflicts > 0 ? "warning" : status.workingTreeChanges.length > 0 ? "muted" : "active",
			);
		} catch (error) {
			this.updateSyncDecisionPanel(decision, project, null, {
				description: this.t("projects.sync.statusFailed", "同步状态读取失败：{error}", {
					error: String(error),
				}),
				variant: "warning",
				chipText: this.t("projects.sync.blockedShort", "受阻"),
				syncEnabled: false,
			});
			localChangesPanel.empty();
			this.renderWorkingTreeChanges(localChangesPanel, []);
			this.updateSyncDetailState(statusPanel, this.t("projects.sync.remoteBlocked", "受阻"), "warning");
			this.updateSyncDetailState(gitTreePanel, this.t("projects.sync.remoteBlocked", "受阻"), "warning");
			this.renderProjectSyncEvent(
				statusPanel,
				this.t("projects.sync.statusFailed", "同步状态读取失败：{error}", {
					error: String(error),
				}),
				this.t("projects.sync.blockedShort", "受阻"),
				"warning",
			);
		}
	}

	private updateSyncDetailState(
		bodyEl: HTMLElement,
		state: string,
		variant: "active" | "warning" | "muted" = "muted",
	): void {
		const sectionEl = bodyEl.closest(".friday-sync-detail-section, .project-function-section-v2");
		if (!(sectionEl instanceof HTMLElement)) {
			return;
		}
		const stateEl = sectionEl.querySelector(".friday-sync-detail-state, .project-function-state-v2");
		if (!(stateEl instanceof HTMLElement)) {
			return;
		}
		stateEl.setText(state);
		stateEl.removeClass("is-active");
		stateEl.removeClass("is-warning");
		if (variant === "active") {
			stateEl.addClass("is-active");
		} else if (variant === "warning") {
			stateEl.addClass("is-warning");
		}
	}

	private renderWorkingTreeChanges(
		containerEl: HTMLElement,
		workingTreeChanges: Array<{ path: string; kind: string }>,
	): void {
		containerEl.empty();
		const panel = containerEl.createEl("section", {
			cls: "project-local-changes-v2",
			attr: { "aria-label": this.t("projects.sync.changesTitle", "工作区变化") },
		});
		const head = panel.createDiv({ cls: "project-section-head-v2" });
		head.createEl("strong", {
			text: this.t("projects.sync.localChangesTitle", "本地改动"),
		});
		head.createSpan({
			text: workingTreeChanges.length > 0
				? this.t("projects.sync.localChangesCount", "{count} 个待确认", { count: workingTreeChanges.length })
				: this.t("projects.sync.noChangesShort", "无改动"),
		});
		if (workingTreeChanges.length === 0) {
			const empty = panel.createDiv({ cls: "project-local-empty-v2" });
			empty.createEl("strong", {
				text: this.t("projects.sync.noChangesShort", "无改动"),
			});
			empty.createSpan({
				text: this.t("projects.sync.noChanges", "当前工作区无待同步变化。"),
			});
			return;
		}
		const visibleChanges = workingTreeChanges.slice(0, 5);
		for (const change of visibleChanges) {
			const row = panel.createDiv({ cls: "project-file-row-v2" });
			row.createSpan({
				cls: `project-file-status-v2${change.kind === "untracked" ? " is-new" : change.kind === "conflicted" ? " is-warning" : ""}`,
				text: this.getWorkingTreeChangeLabel(change.kind),
			});
			const copy = row.createDiv({ cls: "project-file-copy-v2" });
			copy.createEl("strong", { text: change.path });
			copy.createSpan({
				text: this.t("projects.sync.filePending", "待同步判断"),
			});
			this.addPageButton(row, this.t("projects.sync.viewFile", "查看"), async () => {
				await this.openAgentArtifactInWorkspace(change.path);
			});
		}
		if (workingTreeChanges.length > visibleChanges.length) {
			panel.createDiv({
				cls: "friday-sync-list-more",
				text: this.t("projects.sync.moreChanges", "另外 {count} 个文件在同步详情中处理", {
					count: workingTreeChanges.length - visibleChanges.length,
				}),
			});
		}
	}

	private getWorkingTreeChangeLabel(kind: string): string {
		switch (kind) {
			case "untracked":
				return this.t("projects.sync.changeKind.untracked", "未跟踪");
			case "modified":
				return this.t("projects.sync.changeKind.modified", "已修改");
			case "deleted":
				return this.t("projects.sync.changeKind.deleted", "已删除");
			case "conflicted":
				return this.t("projects.sync.changeKind.conflicted", "冲突");
			case "renamed":
				return this.t("projects.sync.changeKind.renamed", "已重命名");
			default:
				return kind;
		}
	}

	private getSyncModeOptions(): Array<{ value: "manual" | "idle_auto" | "continuous_auto"; label: string }> {
		return [
			{ value: "manual", label: this.getSyncModeLabel("manual") },
			{ value: "idle_auto", label: this.getSyncModeLabel("idle_auto") },
			{ value: "continuous_auto", label: this.getSyncModeLabel("continuous_auto") },
		];
	}

	private getSyncModeLabel(mode: "manual" | "idle_auto" | "continuous_auto"): string {
		switch (mode) {
			case "manual":
				return this.t("projects.sync.mode.manual", "手动同步");
			case "idle_auto":
				return this.t("projects.sync.mode.idle", "空闲自动同步");
			case "continuous_auto":
				return this.t("projects.sync.mode.continuous", "连续自动同步");
			default:
				return mode;
		}
	}

	private async updateSyncMode(mode: "manual" | "idle_auto" | "continuous_auto"): Promise<void> {
		await this.plugin.setSyncMode(mode);
		this.renderBoard();
	}

	private async updateProjectAutoSync(project: ProjectEntry, enabled: boolean): Promise<void> {
		await this.plugin.setProjectAutoSync(project.projectId, enabled);
		this.renderBoard();
	}

	private renderIgnoreRulesSummary(containerEl: HTMLElement): void {
		containerEl.empty();
		containerEl.createEl("p", {
			text: this.t("projects.ignore.summary", "这些路径不会进入本地改动列表。"),
		});
		const list = containerEl.createDiv({ cls: "project-ignore-list-v2" });
		for (const rule of [".friday/", "workspace/cache/", "*.tmp"]) {
			list.createSpan({ cls: "project-ignore-token-v2", text: rule });
		}
	}

	private async populateIgnoreCandidates(containerEl: HTMLElement, project: ProjectEntry, stateEl?: HTMLElement): Promise<void> {
		try {
			const candidates = await this.gitIgnoreService.listCandidates(project);
			this.renderIgnoreRulesSummary(containerEl);
			if (stateEl) {
				stateEl.setText(candidates.length > 0 ? this.formatSyncFileCount(candidates.length) : this.t("projects.sync.noneShort", "无"));
			}
			if (candidates.length === 0) {
				return;
			}
			const panel = containerEl.createDiv({ cls: "friday-project-status-group friday-sync-ignore-candidates" });
			panel.createEl("h5", { text: this.t("projects.ignore.title", "Ignore candidates") });
			for (const candidate of candidates.slice(0, 6)) {
				const row = panel.createDiv({ cls: "friday-sync-conflict-row" });
				row.createDiv({
					text: this.t("projects.ignore.item", "{path} ({kind})", {
						path: candidate.path,
						kind: candidate.kind,
					}),
				});
				const actions = row.createDiv({ cls: "friday-approval-actions" });
				if (this.getIgnoreConfirmationKey(project.projectId, candidate.path) === this.pendingIgnoreConfirmationKey) {
					this.addPageButton(actions, this.t("projects.ignore.confirmAction", "确认写入"), async () => {
						await this.applyIgnoreRule(project, candidate.path);
					});
					this.addPageButton(actions, this.t("projects.ignore.cancelAction", "取消"), async () => {
						this.pendingIgnoreConfirmationKey = "";
						this.renderBoard();
					});
				} else {
					this.addPageButton(actions, this.t("projects.ignore.apply", "Ignore"), async () => {
						this.pendingIgnoreConfirmationKey = this.getIgnoreConfirmationKey(project.projectId, candidate.path);
						this.renderBoard();
					});
				}
			}
		} catch (error) {
			containerEl.empty();
			containerEl.createEl("p", {
				text: this.t("projects.ignore.failed", "Ignore candidates unavailable: {error}", {
					error: String(error),
				}),
			});
			if (stateEl) {
				stateEl.setText(this.t("projects.sync.remoteBlocked", "受阻"));
				stateEl.addClass("is-warning");
			}
		}
	}

	private async applyIgnoreRule(project: ProjectEntry, rulePath: string): Promise<void> {
		await this.gitIgnoreService.applyRule(project, rulePath);
		this.pendingIgnoreConfirmationKey = "";
		new Notice(this.t("projects.ignore.applied", "Ignore rule added: {path}", { path: rulePath }), 3000);
		await this.safeRenderBoard();
	}

	private getIgnoreConfirmationKey(projectId: string, rulePath: string): string {
		return `${projectId}::${rulePath}`;
	}

	private renderProjectStatusPanel(containerEl: HTMLElement, project: ProjectEntry): void {
		const syncReport = this.plugin.workbenchStateStore.getSyncReports().find((item) => item.projectId === project.projectId) ?? null;
		const syncConflicts = this.plugin.workbenchStateStore.getSyncConflicts(project.projectId);
		if (!syncReport && syncConflicts.length === 0) {
			return;
		}

		const panel = containerEl.createDiv({ cls: "friday-project-status-panel" });
		if (syncReport) {
			const syncWrap = panel.createDiv({ cls: "friday-project-status-group" });
			syncWrap.createEl("h5", { text: this.t("checks.sync.title", "Recent sync reports") });
			this.renderSyncReport(syncWrap, syncReport);
		}

		if (syncConflicts.length > 0) {
			const conflictWrap = panel.createDiv({ cls: "friday-project-status-group" });
			conflictWrap.createEl("h5", { text: this.t("projects.conflicts.title", "Sync conflicts") });
			for (const conflict of syncConflicts) {
				this.renderSyncConflictCard(conflictWrap, conflict);
			}
		}
	}

	private renderSyncConflictCard(containerEl: HTMLElement, conflict: SyncConflictRecord): void {
		const card = containerEl.createDiv({ cls: "friday-approval-card" });
		const header = card.createDiv({ cls: "friday-sync-conflict-row" });
		header.createDiv({
			text: `${conflict.filePath}`,
		});
		header.createDiv({
			cls: "friday-approval-detail",
			text: this.t("projects.conflicts.status", "Status: {status} · Recommended: {strategy}", {
				status: conflict.status,
				strategy: conflict.recommendedStrategy,
			}),
		});
		card.createDiv({
			cls: "friday-approval-detail",
			text: this.t("projects.conflicts.type", "Type: {type}", { type: conflict.conflictType }),
		});
		const toggleActions = header.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(
			toggleActions,
			this.t(
				"projects.conflicts.toggle",
				this.isConflictExpanded(conflict.projectId, conflict.filePath) ? "Hide details" : "Show details",
			),
			async () => {
				this.toggleExpandedConflict(conflict.projectId, conflict.filePath);
			},
		);

		if (!this.isConflictExpanded(conflict.projectId, conflict.filePath)) {
			return;
		}

		if (conflict.snapshotPath) {
			card.createDiv({
				cls: "friday-approval-detail",
				text: this.t("checks.sync.snapshot", "Snapshot") + `: ${conflict.snapshotPath}`,
			});
		}
		this.renderConflictDiffComparison(card, conflict);
		card.createDiv({
			cls: "friday-approval-detail",
			text: this.t("projects.conflicts.merged", "Working tree"),
		});
		card.createEl("pre", { cls: "friday-exec-output", text: conflict.mergedSnippet || "(empty)" });
		card.createEl("pre", {
			cls: "friday-exec-output",
			text: conflict.markdown,
		});

		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(actions, this.t("projects.conflicts.generateProposal", "Generate proposal"), async () => {
			await this.generateConflictProposal(conflict.projectId, conflict.filePath);
		});
		this.addPageButton(actions, this.t("projects.conflicts.useOurs", "Accept local"), async () => {
			await this.resolveConflictAction(conflict.projectId, conflict.filePath, "ours");
		});
		this.addPageButton(actions, this.t("projects.conflicts.useTheirs", "Accept remote"), async () => {
			await this.resolveConflictAction(conflict.projectId, conflict.filePath, "theirs");
		});
		this.addPageButton(actions, this.t("projects.conflicts.defer", "Not now"), async () => {
			this.deferConflictAction(conflict.projectId, conflict.filePath);
		});
	}

	private renderConflictDiffComparison(containerEl: HTMLElement, conflict: SyncConflictRecord): void {
		const wrap = containerEl.createDiv({ cls: "friday-sync-diff" });
		this.renderConflictDiffColumn(
			wrap,
			this.t("projects.conflicts.local", "Local version"),
			conflict.localSnippet || "(empty)",
			conflict.remoteSnippet || "(empty)",
		);
		this.renderConflictDiffColumn(
			wrap,
			this.t("projects.conflicts.remote", "Remote version"),
			conflict.remoteSnippet || "(empty)",
			conflict.localSnippet || "(empty)",
		);
	}

	private renderConflictDiffColumn(
		containerEl: HTMLElement,
		title: string,
		primaryText: string,
		secondaryText: string,
	): void {
		const column = containerEl.createDiv({ cls: "friday-sync-diff-column" });
		column.createDiv({
			cls: "friday-approval-detail",
			text: title,
		});
		const primaryLines = primaryText.split(/\r?\n/);
		const secondaryLines = secondaryText.split(/\r?\n/);
		const body = column.createDiv({ cls: "friday-sync-diff-body" });
		const total = Math.max(primaryLines.length, secondaryLines.length, 1);
		for (let index = 0; index < total; index += 1) {
			const line = body.createDiv({ cls: "friday-sync-diff-line" });
			const primary = primaryLines[index] ?? "";
			const secondary = secondaryLines[index] ?? "";
			if (primary !== secondary) {
				line.addClass("is-changed");
			}
			line.setText(primary || " ");
		}
	}

	private getSyncConflictKey(projectId: string, filePath: string): string {
		return `${projectId}::${filePath}`;
	}

	private getSyncConflictRecord(projectId: string, filePath: string): SyncConflictRecord | null {
		return this.plugin.workbenchStateStore
			.getSyncConflicts(projectId)
			.find((item) => item.filePath === filePath) ?? null;
	}

	private isConflictExpanded(projectId: string, filePath: string): boolean {
		return this.expandedConflictKey === this.getSyncConflictKey(projectId, filePath);
	}

	private toggleExpandedConflict(projectId: string, filePath: string): void {
		const key = this.getSyncConflictKey(projectId, filePath);
		this.expandedConflictKey = this.expandedConflictKey === key ? "" : key;
		this.renderBoard();
	}

	private renderAiPage(containerEl: HTMLElement): void {
		const llmConfigured = this.plugin.aiService.isConfigured();
		const activeSoul = this.plugin.getActiveSoul();
		const activeSoulDefinition = activeSoul ? this.plugin.soulStore.getSoulSync(activeSoul.id) : null;
		const currentSession = this.aiSessions.find((session) => session.sessionId === this.aiSessionId) ?? null;
		const panelEl = containerEl.createDiv({ cls: "friday-ai-workbench" });
		const metaEl = panelEl.createDiv({ cls: "friday-ai-focus-meta" });
		const metaCopy = metaEl.createDiv({ cls: "friday-ai-focus-copy" });
		metaCopy.createEl("h3", {
			text: currentSession ? this.buildSessionTitle(currentSession) : this.t("ai.session.new", "+ 新会话"),
		});

		const metaActions = metaEl.createDiv({ cls: "friday-ai-focus-actions" });
		const statusEl = metaActions.createDiv({
			cls: `friday-ai-conn-status ${llmConfigured ? "is-online" : "is-offline"}`,
		});
		statusEl.createSpan({ cls: "friday-ai-conn-dot" });
		statusEl.createSpan({
			text: llmConfigured ? this.plugin.t("ai.status.online") : this.plugin.t("ai.status.offline"),
		});
		const agentSelectWrap = metaActions.createDiv({ cls: "friday-ai-agent-select-wrap" });
		const agentSelectEl = agentSelectWrap.createEl("select", { cls: "friday-ai-agent-select" });
		agentSelectEl.setAttribute("aria-label", this.t("ai.agent.switch", "切换角色"));
		const souls = this.plugin.listSouls();
		const selectedSoulId = activeSoul?.id || this.plugin.settings.activeSoulId || "";
		for (const soul of souls) {
			const option = agentSelectEl.createEl("option", { text: soul.name });
			option.value = soul.id;
			option.selected = soul.id === selectedSoulId;
		}
		agentSelectEl.disabled = this.aiBusy;
		agentSelectEl.onchange = () => {
			void this.switchSoul(agentSelectEl.value);
		};
		this.createIconButton(
			metaActions,
			"friday-shell-icon-button friday-ai-meta-button",
			"plus",
			this.t("ai.session.new", "+ 新会话"),
			() => {
				this.startNewAiSession();
			},
		);

		const chatShellEl = panelEl.createDiv({ cls: "friday-ai-chat-panel friday-ai-chat-shell" });
		const messageListEl = chatShellEl.createDiv({ cls: "friday-ai-message-list" });
		this.aiMessageListEl = messageListEl;
		this.renderAiMessageList(messageListEl);

		const errorEl = chatShellEl.createDiv();
		this.aiErrorEl = errorEl;
		this.syncAiErrorRegion();

		const queueHintEl = chatShellEl.createDiv();
		this.aiQueueHintEl = queueHintEl;
		this.syncAiQueueHint();

		this.renderAiOverrideBar(chatShellEl);

		const composerWrap = chatShellEl.createDiv({ cls: "friday-ai-composer-wrap" });
		const taskBarHostEl = composerWrap.createDiv({ cls: "friday-ai-composer-task-bar-host" });
		this.aiComposerTaskBarHostEl = taskBarHostEl;
		const composerEl = composerWrap.createDiv({ cls: "friday-ai-composer" });
		this.aiComposerBodyEl = composerEl;
		this.syncComposerTaskBar();
		this.syncComposerDecisionPanel();

		const toolbarEl = composerWrap.createDiv({ cls: "friday-ai-composer-toolbar" });
		const modelOptions = this.buildModelOptions(activeSoulDefinition);
		const groupedModelOptions = this.buildGroupedModelOptions(activeSoulDefinition);
		const selectedModelValue = this.resolveSelectedModelOptionValue(activeSoulDefinition, modelOptions);
		const selectedModelLabel = this.resolveComposerChoiceLabel(groupedModelOptions, selectedModelValue);
		const modelSelectHost = toolbarEl.createSpan({ cls: "friday-ai-toolbar-select-host is-model" });
		const modelSelect = modelSelectHost.createEl("button", {
			cls: "friday-ai-toolbar-select-button kit-control-button-v1",
		});
		modelSelect.type = "button";
		modelSelect.disabled = !activeSoulDefinition;
		modelSelect.setAttribute("aria-label", this.t("ai.model.override", "选择当前 Agent 模型"));
		modelSelect.setAttribute("aria-haspopup", "listbox");
		modelSelect.setAttribute("aria-expanded", "false");
		const modelSelectIcon = modelSelect.createSpan({
			cls: "friday-ai-toolbar-select-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(modelSelectIcon, "settings-2");
		modelSelect.createSpan({
			cls: "friday-ai-toolbar-select-label",
			text: selectedModelLabel || this.t("ai.model.override", "选择当前 Agent 模型"),
		});
		const modelSelectChevron = modelSelect.createSpan({
			cls: "friday-ai-toolbar-select-chevron",
			attr: { "aria-hidden": "true" },
		});
		setIcon(modelSelectChevron, "chevron-down");
		this.aiModelSelectEl = modelSelect;
		modelSelect.onmousedown = (event) => {
			event.preventDefault();
		};
		modelSelect.onclick = () => {
			if (!activeSoulDefinition) {
				return;
			}
			this.openAiToolbarChoiceMenu({
				hostEl: modelSelectHost,
				buttonEl: modelSelect,
				groups: groupedModelOptions,
				selectedValue: selectedModelValue,
				onSelect: async (value) => {
					const parsed = parseAgentModelChoice(value);
					if (!parsed) {
						return;
					}
					await this.plugin.soulStore.updateSoul(activeSoulDefinition.id, {
						preferredModel: parsed.model,
						preferredModelMode: parsed.mode,
					});
					if (parsed.mode === "group") {
						const patched = patchLlmModeConfig(this.plugin.settings.llm, "group", {
							model: parsed.model,
						});
						this.plugin.settings.llm = switchLlmMode(patched, "group");
					}
					await this.plugin.saveSettings();
					this.renderBoard();
				},
			});
		};

		const permissionModeOptions = this.buildPermissionModeOptions();
		const selectedPermissionValue = this.plugin.settings.agentRuntime.toolPermissionMode;
		const permissionSelectHost = toolbarEl.createSpan({ cls: "friday-ai-toolbar-select-host is-permission" });
		const permissionSelect = permissionSelectHost.createEl("button", {
			cls: "friday-ai-toolbar-select-button kit-control-button-v1",
		});
		permissionSelect.type = "button";
		permissionSelect.setAttribute("aria-label", this.t("ai.permission.override", "选择当前工具权限模式"));
		permissionSelect.setAttribute("aria-haspopup", "listbox");
		permissionSelect.setAttribute("aria-expanded", "false");
		const permissionSelectIcon = permissionSelect.createSpan({
			cls: "friday-ai-toolbar-select-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(permissionSelectIcon, "shield");
		permissionSelect.createSpan({
			cls: "friday-ai-toolbar-select-label",
			text: this.resolvePermissionModeLabel(selectedPermissionValue),
		});
		const permissionSelectChevron = permissionSelect.createSpan({
			cls: "friday-ai-toolbar-select-chevron",
			attr: { "aria-hidden": "true" },
		});
		setIcon(permissionSelectChevron, "chevron-down");
		this.aiPermissionSelectEl = permissionSelect;
		permissionSelect.onmousedown = (event) => {
			event.preventDefault();
		};
		permissionSelect.onclick = () => {
			this.openAiToolbarChoiceMenu({
				hostEl: permissionSelectHost,
				buttonEl: permissionSelect,
				groups: [{ label: "", options: permissionModeOptions }],
				selectedValue: selectedPermissionValue,
				onSelect: async (value) => {
					const mode = value as ToolPermissionMode;
					this.plugin.settings.agentRuntime.toolPermissionMode = mode;
					this.plugin.settings.agentRuntime.fileMutationMode = deriveFileMutationModeFromToolPermissionMode(mode);
					await this.plugin.saveSettings();
					this.renderBoard();
				},
			});
		};

		const skillButton = toolbarEl.createEl("button", {
			cls: "friday-ai-toolbar-button kit-control-button-v1",
			text: this.t("ai.skill.button", "+Skill"),
		});
		skillButton.type = "button";
		skillButton.disabled = false;
		skillButton.onmousedown = (event) => {
			event.preventDefault();
		};
		skillButton.onclick = () => {
			this.composer?.insertText("/");
			this.composer?.focus();
		};

		const attachButton = toolbarEl.createEl("button", {
			cls: "friday-ai-toolbar-button kit-control-button-v1",
			text: "@",
		});
		attachButton.type = "button";
		attachButton.setAttribute("aria-label", this.t("ai.attach.contextButton", "@ Add context"));
		attachButton.title = this.t("ai.attach.contextButton", "@ Add context");
		attachButton.disabled = false;
		attachButton.onmousedown = (event) => {
			event.preventDefault();
		};
		attachButton.onclick = () => {
			this.composer?.openAtPicker();
		};

		const sendButton = toolbarEl.createEl("button", {
			cls: "friday-ai-send-button kit-control-button-v1",
		});
		sendButton.type = "button";
		this.aiSendButtonEl = sendButton;
		sendButton.onclick = () => {
			this.handleSendButtonClick();
		};

		this.syncAiComposerControls();
		this.restoreAiMessageListScrollState(messageListEl);
	}

	private getComposerTaskBarView(): AgentComposerTaskBarView | null {
		const snapshot = this.selectComposerTaskBarSnapshot();
		if (!snapshot) {
			return null;
		}
		return buildAgentProcessPanelViewModel(snapshot).composerTaskBar;
	}

	private syncComposerTaskBar(): void {
		if (!this.aiComposerTaskBarHostEl?.isConnected) {
			return;
		}
		this.aiComposerTaskBarHostEl.empty();
		renderComposerTaskBar({
			containerEl: this.aiComposerTaskBarHostEl,
			taskBar: this.getComposerTaskBarView(),
			expanded: this.aiComposerTaskBarExpanded,
			onToggle: () => {
				this.aiComposerTaskBarExpanded = !this.aiComposerTaskBarExpanded;
				this.syncComposerTaskBar();
			},
			renderIcon: (iconEl, icon) => setIcon(iconEl, icon),
		});
	}

	private selectComposerTaskBarSnapshot(): AgentTrajectorySnapshot | null {
		const liveSnapshot = this.aiRuntimeTrajectorySnapshot;
		if (liveSnapshot) {
			const completedSnapshot = this.getCompletedComposerTaskBarSnapshot();
			if (completedSnapshot && this.isSameTrajectorySnapshotIdentity(completedSnapshot, liveSnapshot)) {
				return completedSnapshot;
			}
			return liveSnapshot;
		}
		if (this.aiStreamingTrajectorySnapshot) {
			return this.aiStreamingTrajectorySnapshot;
		}
		if (this.aiBusy || this.aiLocalIntakePreview || this.aiStreamingPreview) {
			return null;
		}
		return this.getCompletedComposerTaskBarSnapshot();
	}

	private getCompletedComposerTaskBarSnapshot(): AgentTrajectorySnapshot | null {
		const latestAssistantSnapshot = this.getLatestAssistantCompletedTrajectorySnapshot();
		if (latestAssistantSnapshot !== undefined) {
			return this.isCompletedComposerTaskBarSnapshot(latestAssistantSnapshot) ? latestAssistantSnapshot : null;
		}
		return Array.from(this.aiProcessSnapshotsByKey.values()).reverse().find((snapshot) =>
			this.isCompletedComposerTaskBarSnapshot(snapshot)
		) ?? null;
	}

	private getLatestAssistantCompletedTrajectorySnapshot(): AgentTrajectorySnapshot | null | undefined {
		for (let index = this.aiConversation.length - 1; index >= 0; index -= 1) {
			const message = this.aiConversation[index];
			if (message?.role !== "assistant") {
				continue;
			}
			const snapshot = this.getCompletedTrajectorySnapshotForMessage(message);
			return snapshot?.status === "completed" ? snapshot : null;
		}
		return undefined;
	}

	private isCompletedComposerTaskBarSnapshot(snapshot: AgentTrajectorySnapshot | null): snapshot is AgentTrajectorySnapshot {
		return this.isSnapshotOwnedByCurrentSession(snapshot) &&
			Boolean(snapshot.plan) &&
			(snapshot.plan?.visibility === "task_bar" || snapshot.plan?.visibility === "visible") &&
			snapshot.status === "completed" &&
			snapshot.plan?.status === "completed";
	}

	private isCurrentSessionEditPlan(plan: EditPlanRecord): boolean {
		const currentSessionId = this.aiSessionId.trim();
		const originConversationId = plan.originConversationId?.trim();
		return Boolean(currentSessionId && originConversationId && originConversationId === currentSessionId);
	}

	private getPendingEditPlans(): EditPlanRecord[] {
		return this.plugin.workbenchStateStore
			.getEditPlans()
			.filter((plan) => this.isCurrentSessionEditPlan(plan))
			.map((plan) => ({
				...plan,
				items: plan.items.filter((item) => item.status === "pending" || item.status === "conflicted"),
			}))
			.filter((plan) => plan.items.length > 0);
	}

	private hasPendingComposerDecision(): boolean {
		return this.approvalQueue.list().length > 0 || this.getPendingEditPlans().length > 0;
	}

	private getComposerDecisionKey(pendingApprovals: PendingApproval[], pendingEditPlans: EditPlanRecord[]): string {
		const approvalKey = pendingApprovals.map((item) => item.id).join("|");
		const editPlanKey = pendingEditPlans.map((plan) => {
			const itemKey = plan.items.map((item) => `${item.path}:${item.status}:${item.changeType}`).join(",");
			return `${plan.id}:${itemKey}`;
		}).join("|");
		return `${approvalKey}::${editPlanKey}`;
	}

	private renderComposerInput(parent: HTMLElement): void {
		this.composer?.destroy();
		this.composer = new MentionComposer({
			parent,
			placeholder: this.t(
				"ai.input.placeholder.rich",
				"输入消息，支持 @ 文件引用与 / 命令。Enter 发送，Shift+Enter 换行",
			),
			initialSnapshot: this.getComposerSnapshot(),
			disabled: false,
			onChange: (snapshot) => {
				this.aiComposerSnapshot = snapshot;
				this.aiDraft = snapshot.text;
				this.syncAiSendButtonState();
			},
			onSubmit: () => {
				void this.submitAiPrompt();
			},
			getSuggestions: async (query) => this.buildComposerSuggestions(query),
		});
	}

	private renderComposerDecisionPanel(
		containerEl: HTMLElement,
		pendingApprovals: PendingApproval[],
		pendingEditPlans: EditPlanRecord[],
	): void {
		const panel = containerEl.createDiv({ cls: "friday-composer-decision-panel" });
		panel.createDiv({
			cls: "friday-composer-decision-title",
			text: this.t("approval.composerTitle", "需要你确认后继续"),
		});
		if (pendingEditPlans.length > 0) {
			const pendingMutationCount = pendingEditPlans.reduce((total, plan) =>
				total + plan.items.filter((item) => item.status === "pending").length, 0);
			panel.createDiv({
				cls: "friday-approval-detail",
				text: pendingMutationCount > 0
					? this.t("mutation.review.pendingComposer", "已准备好 {count} 个待应用的文件修改，确认后才会写入 Obsidian。", {
						count: pendingMutationCount,
					})
					: this.t("mutation.review.conflictedComposer", "文件在计划生成后发生变化，需要重新确认后再继续。"),
			});
			for (const plan of pendingEditPlans) {
				this.renderEditPlanReviewItem(panel, plan);
			}
		}
		if (pendingApprovals.length > 0) {
			panel.createDiv({
				cls: "friday-approval-detail",
				text: this.t("approval.composerDesc", "FRIDAY 暂停在一个需要你决定的动作上。"),
			});
			for (const item of pendingApprovals) {
				this.renderApprovalCard(panel, item);
			}
		}
	}

	private renderEditPlanReviewPanel(containerEl: HTMLElement): void {
		const plans = this.getPendingEditPlans();
		if (plans.length === 0) {
			return;
		}

		const panel = containerEl.createDiv({ cls: "friday-mutation-review-panel" });
		const header = panel.createDiv({ cls: "friday-control-center-header" });
		header.createEl("h5", { text: this.t("mutation.review.title", "确认文件修改") });
		header.createSpan({
			cls: "friday-control-center-hint",
			text: this.t("mutation.review.count", "{count} 个待应用", { count: plans.length }),
		});

		for (const plan of plans) {
			this.renderEditPlanReviewItem(panel, plan);
		}
	}

	private getActionablePendingEditPlan(planId: string): EditPlanRecord | null {
		const normalizedPlanId = planId.trim();
		if (!normalizedPlanId) {
			return null;
		}
		const plan = this.getPendingEditPlans().find((item) => item.id === normalizedPlanId);
		if (!plan || !this.isCurrentSessionEditPlan(plan)) {
			return null;
		}
		return plan.items.some((item) => item.status === "pending") ? plan : null;
	}

	private getReviewableEditPlan(planId: string): EditPlanRecord | null {
		const normalizedPlanId = planId.trim();
		if (!normalizedPlanId) {
			return null;
		}
		const plan = this.getPendingEditPlans().find((item) => item.id === normalizedPlanId);
		if (!plan || !this.isCurrentSessionEditPlan(plan)) {
			return null;
		}
		return plan.items.some((item) => item.status === "pending" || item.status === "conflicted") ? plan : null;
	}

	private renderEditPlanReviewItem(containerEl: HTMLElement, plan: EditPlanRecord): void {
		const firstItem = plan.items[0];
		const itemEl = containerEl.createDiv({ cls: "friday-approval-card friday-mutation-review-item" });
		itemEl.createDiv({
			cls: "friday-approval-header",
			text: this.formatEditPlanReviewTitle(plan),
		});
		itemEl.createDiv({
			cls: "friday-approval-detail",
			text: firstItem?.path ?? plan.id,
		});
		itemEl.createDiv({
			cls: "friday-approval-detail",
			text: this.formatEditPlanReviewStatus(plan),
		});
		if (firstItem) {
			this.renderEditPlanDiffPreview(itemEl, firstItem.before, firstItem.after);
			const fullReviewToggle = itemEl.createEl("button", {
				cls: "friday-approval-btn friday-mutation-review-full-toggle",
				text: this.t("mutation.review.viewFullChanges", "查看完整改动"),
			});
			fullReviewToggle.type = "button";
			const fullReviewEl = itemEl.createDiv({
				cls: "friday-mutation-review-full",
				attr: { "aria-hidden": "true" },
			});
			fullReviewEl.hidden = true;
			this.renderEditPlanFullDiff(fullReviewEl, firstItem.before, firstItem.after);
			fullReviewToggle.onclick = () => {
				const shouldShow = fullReviewEl.hidden;
				fullReviewEl.hidden = !shouldShow;
				fullReviewEl.setAttribute("aria-hidden", shouldShow ? "false" : "true");
				fullReviewToggle.setText(shouldShow
					? this.t("mutation.review.hideFullChanges", "收起完整改动")
					: this.t("mutation.review.viewFullChanges", "查看完整改动"));
			};
		}
		const actions = itemEl.createDiv({ cls: "friday-approval-actions" });
		const canApply = plan.items.some((item) => item.status === "pending");
		const canDismiss = plan.items.some((item) => item.status === "pending" || item.status === "conflicted");
		this.addMutationReviewButton(actions, this.t("mutation.review.applyChanges", "应用修改"), !canApply, async () => {
			const currentPlan = this.getActionablePendingEditPlan(plan.id);
			if (!currentPlan) {
				new Notice(this.t("mutation.review.noLongerPending", "这次文件修改已经不在待确认状态。"), 3000);
				this.syncComposerDecisionPanel();
				return;
			}
			const status = await this.plugin.agentRuntimeService.acceptEditPlan(currentPlan.id);
			new Notice(
				status === "conflicted"
					? this.t("mutation.review.conflictedNotice", "文件已变化，需要重新确认后再继续。")
					: this.t("mutation.review.applied", "已应用修改。"),
				3000,
			);
			await this.refreshCompletedTrajectorySnapshotsForCurrentSession();
			this.renderBoard();
		});
		this.addMutationReviewButton(actions, this.t("mutation.review.doNotApply", "不应用"), !canDismiss, async () => {
			const currentPlan = this.getReviewableEditPlan(plan.id);
			if (!currentPlan) {
				new Notice(this.t("mutation.review.noLongerPending", "这次文件修改已经不在待确认状态。"), 3000);
				this.syncComposerDecisionPanel();
				return;
			}
			await this.plugin.agentRuntimeService.rejectEditPlan(currentPlan.id);
			new Notice(this.t("mutation.review.rejected", "已取消，未写入任何文件。"), 3000);
			await this.refreshCompletedTrajectorySnapshotsForCurrentSession();
			this.renderBoard();
		});
	}

	private formatEditPlanReviewTitle(plan: EditPlanRecord): string {
		const pendingCount = plan.items.filter((item) => item.status === "pending").length;
		if (pendingCount > 0) {
			return this.t("mutation.review.itemTitle", "准备应用 {count} 个文件修改", { count: pendingCount });
		}
		if (plan.items.some((item) => item.status === "conflicted")) {
			return this.t("mutation.review.itemConflictedTitle", "文件修改需要重新确认");
		}
		return this.t("mutation.review.itemEmptyTitle", "文件修改");
	}

	private renderEditPlanDiffPreview(containerEl: HTMLElement, before: string, after: string): void {
		const preview = buildMutationDiffPreview({ before, after });
		if (preview.lines.length === 0) {
			return;
		}
		const diffEl = containerEl.createDiv({ cls: "friday-mutation-review-diff" });
		for (const line of preview.lines) {
			diffEl.createDiv({
				cls: `friday-mutation-review-diff-line is-${line.kind}`,
				text: `${line.kind === "remove" ? "-" : "+"} ${line.text}`,
			});
		}
		if (preview.truncated) {
			diffEl.createDiv({
				cls: "friday-mutation-review-diff-line is-omitted",
				text: this.t("mutation.review.diffOmitted", "{count} more changed lines omitted", {
					count: preview.omittedLineCount,
				}),
			});
		}
	}

	private renderEditPlanFullDiff(containerEl: HTMLElement, before: string, after: string): void {
		const preview = buildMutationDiffPreview({
			before,
			after,
			maxLines: Number.MAX_SAFE_INTEGER,
			maxLineChars: 1000,
		});
		if (preview.lines.length === 0) {
			containerEl.createDiv({
				cls: "friday-approval-detail friday-mutation-review-full-empty",
				text: this.t("mutation.review.empty", "没有文件修改。"),
			});
			return;
		}
		const diffEl = containerEl.createDiv({ cls: "friday-mutation-review-diff friday-mutation-review-full-diff" });
		for (const line of preview.lines) {
			diffEl.createDiv({
				cls: `friday-mutation-review-diff-line is-${line.kind}`,
				text: `${line.kind === "remove" ? "-" : "+"} ${line.text}`,
			});
		}
	}

	private addMutationReviewButton(
		containerEl: HTMLElement,
		label: string,
		disabled: boolean,
		action: () => Promise<void>,
	): void {
		const button = containerEl.createEl("button", {
			cls: "friday-approval-btn",
			text: label,
		});
		button.type = "button";
		button.disabled = disabled;
		button.onclick = async () => {
			try {
				await action();
			} catch (error) {
				new Notice(
					this.t("mutation.review.failed", "Review action failed: {error}", {
						error: String(error),
					}),
					6000,
				);
			}
		};
	}

	private formatEditPlanReviewStatus(plan: EditPlanRecord): string {
		const firstItem = plan.items[0];
		if (!firstItem) {
			return this.t("mutation.review.empty", "No file change.");
		}
		if (plan.items.some((item) => item.status === "conflicted")) {
			return this.t("mutation.review.conflicted", "文件在计划生成后发生变化，需要重新确认。");
		}
		return this.t("mutation.review.summary", "{count} 个修改待确认，确认后才会写入 Obsidian。", {
			count: plan.items.filter((item) => item.status === "pending").length || plan.items.length,
		});
	}

	private async populateControlCenter(containerEl: HTMLElement): Promise<void> {
		if (!containerEl.isConnected) {
			return;
		}
		containerEl.empty();
		this.renderToolControlSection(containerEl);
		await this.renderSkillControlSection(containerEl);
	}

	private renderToolControlSection(containerEl: HTMLElement): void {
		const section = containerEl.createDiv({ cls: "friday-control-center-section" });
		const header = section.createDiv({ cls: "friday-control-center-header" });
		header.createEl("h5", { text: this.t("policy.tools.builtin", "Builtin tools") });
		header.createSpan({
			cls: "friday-control-center-hint",
			text: this.t("policy.tools.hint", "关闭后运行时不可调用"),
		});
		const list = section.createDiv({ cls: "friday-control-center-list is-grid" });
		const disabledTools = new Set(
			(this.plugin.settings.agentRuntime.disabledTools ?? [])
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.length > 0),
		);
		for (const tool of CapabilityRegistry.getInstance().listUserVisibleTools().filter((item) => this.isUserVisibleRuntimeTool(item.name))) {
			const item = list.createDiv({ cls: "friday-control-center-item is-tool" });
			const meta = item.createDiv({ cls: "friday-control-center-item-meta" });
			const titleRow = meta.createDiv({ cls: "friday-control-center-item-title-row" });
			const iconEl = titleRow.createSpan({
				cls: "friday-control-center-item-icon kit-tool-icon-v1",
				attr: { "aria-hidden": "true" },
			});
			setIcon(iconEl, "arrow-right");
			titleRow.createDiv({ cls: "friday-control-center-item-title", text: tool.name });
			meta.createDiv({
				cls: "friday-control-center-item-desc",
				text: this.resolveToolDescription(tool),
			});
			meta.createDiv({
				cls: "friday-control-center-item-relation",
				text: this.resolveToolSkillRelationship(tool),
			});
			this.createAvailabilityToggle(item, tool.name, !disabledTools.has(tool.name), async () => {
				await this.toggleToolAvailability(tool.name, disabledTools.has(tool.name));
			});
		}
	}

	private isUserVisibleRuntimeTool(toolName: string): boolean {
		return toolName !== "exec";
	}

	private createAvailabilityToggle(
		containerEl: HTMLElement,
		name: string,
		enabled: boolean,
		onChange: (enabled: boolean) => void | Promise<void>,
	): void {
		const host = containerEl.createDiv({ cls: "friday-control-toggle-host" });
		const toggle = new ToggleComponent(host);
		const label = this.t("policy.toggle.label", "切换 {name}", { name });
		toggle.toggleEl.addClass("friday-control-native-toggle");
		toggle.toggleEl.setAttribute("aria-label", label);
		toggle.setTooltip(label);
		toggle.setValue(enabled).onChange((value) => {
			void onChange(value);
		});
	}

	private resolveToolDescription(tool: ToolManifest): string {
		const fallbackMap: Record<string, string> = {
			ls: "List files and folders inside the allowed workspace.",
			read: "Read file contents for analysis without changing them.",
			grep: "Search file contents by pattern across the allowed workspace.",
			search_text: "Run broader text search for retrieval and evidence gathering.",
			glob: "Match files by path pattern before reading or editing.",
			compile_wiki: "Compile raw project material into wiki knowledge outputs.",
			write: "Create or fully overwrite files inside the permitted scope.",
			edit: "Apply targeted patches to existing files.",
			delete: "Remove files that are explicitly approved for deletion.",
		};
		return this.t(`policy.tools.desc.${tool.name}`, fallbackMap[tool.name] ?? tool.capability);
	}

	private resolveToolSkillRelationship(tool: ToolManifest): string {
		if (tool.relatedSkillCommand) {
			return this.t("policy.tools.relation.sameNameSkillNative", "Related skill {command}: the tool is the low-level executor, while the skill is the higher-level workflow that decides when and how to use it.", {
				command: this.formatSkillDisplayName(tool.relatedSkillCommand),
			});
		}
		return this.t("policy.tools.relation.generic", "This is a low-level runtime capability that can be reused by multiple skills or agent steps.");
	}

	private formatSkillDisplayName(command: string): string {
		return command.trim().replace(/^\/+/, "") || "skill";
	}

	private async renderSkillControlSection(containerEl: HTMLElement): Promise<void> {
		const section = containerEl.createDiv({ cls: "friday-control-center-section" });
		const header = section.createDiv({ cls: "friday-control-center-header" });
		header.createEl("h5", { text: this.t("policy.skills.title", "Skills") });
		header.createSpan({
			cls: "friday-control-center-hint",
			text: this.t("policy.skills.hint", "内置与外接 Skill 都在这里管理"),
		});
		const disabledSkills = new Set(
			(this.plugin.settings.agentRuntime.disabledSkills ?? [])
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.length > 0),
		);
		const skills = await this.plugin.skillCommandService.listSkills(200, { includeDisabled: true });
		if (!section.isConnected) {
			return;
		}
		if (skills.length === 0 && disabledSkills.size === 0) {
			section.createDiv({
				cls: "friday-ai-session-empty",
				text: this.t("ai.skill.empty", "当前没有可用 Skill。"),
			});
			return;
		}
		const merged = new Map<string, SkillDescriptor>();
		for (const skill of skills) {
			merged.set(skill.command, skill);
		}
		for (const disabled of disabledSkills) {
			if (!merged.has(disabled)) {
				merged.set(disabled, {
					name: disabled,
					description: this.t("policy.skills.disabledPlaceholder", "已关闭的 Skill，重新启用后可再次调用。"),
					filePath: disabled,
					command: disabled,
					aliases: [],
					tags: [],
					globs: [],
					trigger: "manual",
				});
			}
		}
		const orderedSkills = [...merged.values()].sort((left, right) => left.command.localeCompare(right.command, "zh-CN"));
		const { builtinSkills, personalSkills } = SkillRegistry.getInstance().groupDescriptors(orderedSkills);
		this.renderSkillControlGroup(
			section,
			this.t("policy.skills.builtin", "Builtin skills"),
			builtinSkills,
			disabledSkills,
			this.t("ai.skill.empty", "当前没有可用 Skill。"),
		);
		this.renderSkillControlGroup(
			section,
			this.t("policy.skills.personal", "Personal skills"),
			personalSkills,
			disabledSkills,
			this.t("policy.skills.emptyPersonal", "No personal skills yet."),
		);
	}

	private renderSkillControlGroup(
		containerEl: HTMLElement,
		title: string,
		skills: SkillDescriptor[],
		disabledSkills: Set<string>,
		emptyText: string,
	): void {
		const group = containerEl.createDiv({ cls: "friday-control-center-group" });
		group.createEl("h6", { cls: "friday-control-center-group-title", text: title });
		if (skills.length === 0) {
			group.createDiv({
				cls: "friday-ai-session-empty",
				text: emptyText,
			});
			return;
		}
		const list = group.createDiv({ cls: "friday-control-center-list is-grid" });
		for (const skill of skills) {
			this.renderSkillControlItem(list, skill, disabledSkills);
		}
	}

	private renderSkillControlItem(
		containerEl: HTMLElement,
		skill: SkillDescriptor,
		disabledSkills: Set<string>,
	): void {
		const normalized = skill.command.trim().toLowerCase();
		const item = containerEl.createDiv({ cls: "friday-control-center-item is-skill" });
		const meta = item.createDiv({ cls: "friday-control-center-item-meta" });
		const titleRow = meta.createDiv({ cls: "friday-control-center-item-title-row" });
		const iconEl = titleRow.createSpan({
			cls: "friday-control-center-item-icon kit-skill-icon-v1",
			attr: { "aria-hidden": "true" },
		});
		setIcon(iconEl, "layout-grid");
		titleRow.createDiv({ cls: "friday-control-center-item-title", text: this.formatSkillDisplayName(skill.command) });
		const reviewNote = resolveBuiltinSkillReviewNote(skill.command, this.plugin.getLocale());
		if (reviewNote) {
			this.renderSkillReviewNote(titleRow, reviewNote);
		}
		meta.createDiv({
			cls: "friday-control-center-item-desc",
			text: skill.description || this.t("policy.skills.noDesc", "暂无说明"),
		});
		this.createAvailabilityToggle(item, skill.command, !disabledSkills.has(normalized), async () => {
			await this.toggleSkillAvailability(skill.command, disabledSkills.has(normalized));
		});
	}

	private renderSkillReviewNote(containerEl: HTMLElement, note: ResolvedBuiltinSkillReviewNote): void {
		const host = containerEl.createDiv({ cls: "friday-control-center-item-note-host" });
		const noteButton = host.createEl("button", {
			cls: "friday-control-center-item-note-button",
		});
		noteButton.type = "button";
		noteButton.setAttribute(
			"aria-label",
			this.t("policy.skills.reviewNote.button", "查看此 Skill 的改动说明"),
		);
		noteButton.setAttribute("aria-haspopup", "dialog");
		noteButton.setAttribute("aria-expanded", "false");
		setIcon(noteButton, "info");

		const ownerDocument = containerEl.ownerDocument;
		const ownerWindow = ownerDocument.defaultView ?? window;
		const popover = ownerDocument.createElement("div");
		popover.className = "friday-control-center-item-note-popover";
		popover.dataset.placement = "bottom";
		ownerDocument.body.appendChild(popover);
		popover.createDiv({
			cls: "friday-control-center-item-note-version",
			text: this.t("policy.skills.reviewNote.version", "更新于 {version}", { version: note.version }),
		});
		popover.createEl("h6", {
			cls: "friday-control-center-item-note-title",
			text: note.title,
		});
		this.renderSkillReviewNoteSection(
			popover,
			this.t("policy.skills.reviewNote.original", "原版是什么"),
			[note.original],
		);
		this.renderSkillReviewNoteSection(
			popover,
			this.t("policy.skills.reviewNote.issues", "为什么不好"),
			note.issues,
		);
		this.renderSkillReviewNoteSection(
			popover,
			this.t("policy.skills.reviewNote.changes", "改成了什么"),
			note.changes,
		);

			let open = false;
			let pinned = false;
			let closeTimer: number | null = null;
			let rafId: number | null = null;
			let frozenGeometry:
				| {
						anchor: { left: number; top: number; width: number; height: number };
						viewport: { width: number; height: number };
				  }
				| null = null;

			const clearCloseTimer = () => {
				if (closeTimer != null) {
					ownerWindow.clearTimeout(closeTimer);
					closeTimer = null;
			}
		};
			const cancelScheduledPositioning = () => {
				if (rafId != null) {
					ownerWindow.cancelAnimationFrame(rafId);
					rafId = null;
				}
			};
			const freezePopoverGeometry = () => {
				const frozenAnchor = noteButton.getBoundingClientRect();
				const frozenViewport = {
					width: ownerWindow.innerWidth,
					height: ownerWindow.innerHeight,
				};
				frozenGeometry = {
					anchor: {
						left: frozenAnchor.left,
						top: frozenAnchor.top,
						width: frozenAnchor.width,
						height: frozenAnchor.height,
					},
					viewport: frozenViewport,
				};
			};
			const updatePopoverLayout = () => {
				if (!open) {
					return;
				}
				if (!frozenGeometry) {
					freezePopoverGeometry();
				}
				if (!frozenGeometry) {
					return;
				}
				const { anchor, viewport } = frozenGeometry;
				const layout = computeSkillReviewNotePopoverLayout(anchor, viewport);
				popover.style.width = `${layout.width}px`;
				popover.style.maxHeight = `${layout.maxHeight}px`;
				popover.style.minWidth = `${Math.min(layout.width, 280)}px`;
				popover.dataset.placement = layout.placement;
				popover.classList.add("is-measuring");
				const popoverRect = popover.getBoundingClientRect();
				const position = computeSkillReviewNotePopoverPosition(
					anchor,
					{
						width: popoverRect.width,
						height: popoverRect.height,
					},
					viewport,
					layout.placement,
				);
				popover.style.left = `${position.left}px`;
				popover.style.top = `${position.top}px`;
				popover.classList.remove("is-measuring");
			};
			const schedulePopoverLayout = () => {
				if (!open) {
					return;
				}
				cancelScheduledPositioning();
				rafId = ownerWindow.requestAnimationFrame(() => {
					rafId = null;
					updatePopoverLayout();
				});
			};
			const setOpen = (nextOpen: boolean) => {
				clearCloseTimer();
				if (open === nextOpen) {
					if (nextOpen) {
						schedulePopoverLayout();
					}
					return;
				}
				open = nextOpen;
				popover.classList.toggle("is-open", open);
				noteButton.setAttribute("aria-expanded", open ? "true" : "false");
				if (open) {
					freezePopoverGeometry();
					updatePopoverLayout();
					schedulePopoverLayout();
					return;
				}
				frozenGeometry = null;
				cancelScheduledPositioning();
				popover.classList.remove("is-measuring");
			};
		const closeIfNotPinned = () => {
			if (!pinned) {
				setOpen(false);
			}
		};
		const scheduleCloseIfNotPinned = () => {
			if (pinned) {
				return;
			}
			clearCloseTimer();
			closeTimer = ownerWindow.setTimeout(() => {
				closeTimer = null;
				closeIfNotPinned();
			}, 80);
		};
			const handleDocumentPointerDown = (event: Event) => {
				if (!open && !pinned) {
					return;
				}
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (host.contains(target) || popover.contains(target)) {
				return;
			}
				pinned = false;
				setOpen(false);
			};
			const handleWindowResize = () => {
				if (!open) {
					return;
				}
				if (frozenGeometry) {
					frozenGeometry = {
						...frozenGeometry,
						viewport: {
							width: ownerWindow.innerWidth,
							height: ownerWindow.innerHeight,
						},
					};
				}
				updatePopoverLayout();
			};

			noteButton.addEventListener("mouseenter", () => setOpen(true));
		noteButton.addEventListener("mouseleave", () => scheduleCloseIfNotPinned());
		noteButton.addEventListener("focus", () => setOpen(true));
		noteButton.addEventListener("blur", (event: FocusEvent) => {
			const next = event.relatedTarget;
			if (next instanceof Node && popover.contains(next)) {
				return;
			}
			scheduleCloseIfNotPinned();
		});
		popover.addEventListener("mouseenter", () => clearCloseTimer());
		popover.addEventListener("mouseleave", () => scheduleCloseIfNotPinned());
		noteButton.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				pinned = !pinned;
				setOpen(pinned);
			};
			ownerWindow.addEventListener("resize", handleWindowResize);
			ownerDocument.addEventListener("pointerdown", handleDocumentPointerDown, true);
			this.skillReviewNotePopoverCleanups.push(() => {
				clearCloseTimer();
				cancelScheduledPositioning();
				ownerWindow.removeEventListener("resize", handleWindowResize);
				ownerDocument.removeEventListener("pointerdown", handleDocumentPointerDown, true);
				popover.remove();
			});
		}

	private renderSkillReviewNoteSection(containerEl: HTMLElement, title: string, items: string[]): void {
		const section = containerEl.createDiv({ cls: "friday-control-center-item-note-section" });
		section.createDiv({ cls: "friday-control-center-item-note-section-title", text: title });
		const list = section.createEl("ul", { cls: "friday-control-center-item-note-list" });
		for (const item of items) {
			list.createEl("li", { text: item });
		}
	}

	private async toggleToolAvailability(toolName: string, currentlyDisabled: boolean): Promise<void> {
		const settings = this.plugin.settings.agentRuntime;
		const disabled = new Set((settings.disabledTools ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean));
		if (currentlyDisabled) {
			disabled.delete(toolName);
		} else {
			disabled.add(toolName);
		}
		settings.disabledTools = [...disabled];
		if (toolName === "exec") {
			settings.enableExecTool = currentlyDisabled;
		}
		this.plugin.agentRuntimeService.clearSessionToolPolicyOverride(`tool:${toolName}`);
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	private async toggleSkillAvailability(skillCommand: string, currentlyDisabled: boolean): Promise<void> {
		const disabled = new Set(
			(this.plugin.settings.agentRuntime.disabledSkills ?? [])
				.map((item) => item.trim().toLowerCase())
				.filter(Boolean),
		);
		const normalized = skillCommand.trim().toLowerCase();
		if (currentlyDisabled) {
			disabled.delete(normalized);
		} else {
			disabled.add(normalized);
		}
		this.plugin.settings.agentRuntime.disabledSkills = [...disabled];
		await this.plugin.saveSettings();
		this.renderBoard();
	}

	private toggleAiSessionNavCollapsed(): void {
		this.aiSessionNavCollapsed = !this.aiSessionNavCollapsed;
		this.renderBoard();
	}

	private renderAiSessionDrawer(containerEl: HTMLElement): void {
		const backdrop = containerEl.createDiv({ cls: "friday-ai-drawer-backdrop" });
		backdrop.onclick = () => {
			this.aiSessionNavCollapsed = true;
			this.renderBoard();
		};

		const drawerEl = containerEl.createDiv({ cls: "friday-ai-session-drawer" });
		const headerEl = drawerEl.createDiv({ cls: "friday-ai-session-drawer-header" });
		const headingEl = headerEl.createDiv({ cls: "friday-ai-session-drawer-heading" });
		headingEl.createEl("h4", {
			text: this.t("ai.sessions.title", "对话记录"),
		});
		const actionsEl = headerEl.createDiv({ cls: "friday-ai-session-drawer-actions" });
		const newButton = this.createIconButton(
			actionsEl,
			"friday-shell-icon-button friday-ai-session-header-button",
			"plus",
			this.t("ai.sessions.new", "新建"),
			() => {
				this.startNewAiSession();
			},
		);
		newButton.disabled = this.aiBusy;
		const manageButton = this.createIconButton(
			actionsEl,
			`friday-shell-icon-button friday-ai-session-header-button friday-ai-session-manage${this.aiSessionManageMode ? " is-active" : ""}`,
			this.aiSessionManageMode ? "check" : "list",
			this.aiSessionManageMode
				? this.t("ai.sessions.manage.done", "完成")
				: this.t("ai.sessions.manage.enter", "管理"),
			() => {
				this.toggleSessionManageMode();
			},
		);
		manageButton.disabled = this.aiBusy || this.aiSessions.length === 0;
		this.createIconButton(
			actionsEl,
			"friday-shell-icon-button friday-ai-session-header-button",
			"x",
			this.t("ai.sessions.collapse", "收起对话列表"),
			() => {
				this.aiSessionNavCollapsed = true;
				this.renderBoard();
			},
		);

		const searchWrap = drawerEl.createDiv({ cls: "friday-ai-session-search-wrap" });
		const searchIcon = searchWrap.createSpan({ cls: "friday-ai-session-search-icon" });
		setIcon(searchIcon, "search");
		const searchInput = searchWrap.createEl("input", {
			cls: "friday-ai-session-search",
			attr: {
				type: "text",
				placeholder: this.t("ai.sessions.search.placeholder", "搜索对话…"),
			},
		});
		searchInput.value = this.aiSessionSearchQuery;
		searchInput.oninput = () => {
			this.aiSessionSearchQuery = searchInput.value;
			this.renderBoard();
		};
		searchInput.onkeydown = (event) => {
			if (event.key === "Escape" && this.aiSessionSearchQuery) {
				event.preventDefault();
				this.aiSessionSearchQuery = "";
				this.renderBoard();
			}
		};

		const filteredSessions = this.getFilteredAiSessions();
		const visibleSessionIds = filteredSessions.map((session) => session.sessionId);
		const selectedVisibleCount = visibleSessionIds.filter((sessionId) => this.aiSessionSelection.has(sessionId)).length;
		const allVisibleSelected = visibleSessionIds.length > 0 && selectedVisibleCount === visibleSessionIds.length;
		const listEl = drawerEl.createDiv({ cls: "friday-ai-session-list" });
		if (this.aiSessions.length === 0) {
			const emptyEl = listEl.createDiv({ cls: "friday-ai-session-empty" });
			emptyEl.setText(this.t("ai.sessions.empty", "暂无对话记录"));
			return;
		}
		if (filteredSessions.length === 0) {
			const emptyEl = listEl.createDiv({ cls: "friday-ai-session-empty" });
			emptyEl.setText(this.t("ai.sessions.emptyFiltered", "没有匹配的对话"));
			return;
		}

		if (this.aiSessionManageMode) {
			const bulkBar = drawerEl.createDiv({ cls: "friday-ai-session-bulkbar" });
			const counter = bulkBar.createDiv({
				cls: "friday-ai-session-bulktext",
				text: this.t("ai.sessions.manage.selected", "已选 {count} 项", {
					count: selectedVisibleCount,
				}),
			});
			counter.setAttribute("aria-live", "polite");
			const bulkActions = bulkBar.createDiv({ cls: "friday-ai-session-bulkactions" });
			const selectAll = bulkActions.createEl("button", {
				cls: "friday-ai-session-bulkbutton",
				text: allVisibleSelected
					? this.t("ai.sessions.manage.clear", "清空选择")
					: this.t("ai.sessions.manage.selectAll", "全选"),
			});
			selectAll.type = "button";
			selectAll.onclick = () => {
				this.toggleAllSessionSelections(visibleSessionIds);
			};
			const deleteSelected = bulkActions.createEl("button", {
				cls: "friday-ai-session-bulkbutton is-danger",
				text: this.t("ai.sessions.manage.deleteSelected", "删除所选"),
			});
			deleteSelected.type = "button";
			deleteSelected.disabled = selectedVisibleCount === 0 || this.aiBusy;
			deleteSelected.onclick = () => {
				void this.deleteSelectedSessions();
			};
		}

		const groups = this.buildSessionGroups(filteredSessions);
		for (const group of groups) {
			const groupEl = listEl.createDiv({ cls: "friday-ai-session-group" });
			groupEl.createDiv({ cls: "friday-ai-session-group-label", text: group.label });
			const groupList = groupEl.createDiv({ cls: "friday-ai-session-group-list" });
			for (const session of group.sessions) {
				const sessionTitle = this.buildSessionTitle(session);
				const itemEl = groupList.createDiv({ cls: "friday-ai-session-item" });
				itemEl.setAttribute("role", "button");
				itemEl.setAttribute("aria-label", this.t("ai.sessions.open", "打开对话：{title}", {
					title: sessionTitle,
				}));
				itemEl.tabIndex = 0;
				if (session.sessionId === this.aiSessionId) {
					itemEl.addClass("is-active");
				}
				if (this.aiSessionSelection.has(session.sessionId)) {
					itemEl.addClass("is-selected");
				}
				itemEl.onclick = () => {
					if (this.aiSessionRenameId === session.sessionId) {
						return;
					}
					if (this.aiSessionManageMode) {
						this.toggleSessionSelection(session.sessionId);
						return;
					}
					void this.switchAiSession(session.sessionId);
				};
				itemEl.onkeydown = (event) => {
					if (this.aiSessionRenameId === session.sessionId) {
						return;
					}
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						itemEl.click();
						return;
					}
					if (event.key === "F2" && !this.aiSessionManageMode) {
						event.preventDefault();
						this.beginSessionRename(session);
					}
				};
				itemEl.ondblclick = () => {
					if (!this.aiSessionManageMode) {
						this.beginSessionRename(session);
					}
				};
				itemEl.oncontextmenu = (event) => {
					if (this.aiSessionManageMode) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					this.openSessionActionsMenu(session, event);
				};
				const rowEl = itemEl.createDiv({ cls: "friday-ai-session-item-row" });
				if (this.aiSessionManageMode) {
					const checkbox = rowEl.createEl("input", { attr: { type: "checkbox" }, cls: "friday-ai-session-checkbox" });
					checkbox.checked = this.aiSessionSelection.has(session.sessionId);
					checkbox.onclick = (event) => {
						event.stopPropagation();
					};
					checkbox.onchange = () => {
						this.toggleSessionSelection(session.sessionId);
					};
				}
				const bodyButton = rowEl.createDiv({ cls: "friday-ai-session-item-body" });
				bodyButton.createDiv({
					cls: "friday-ai-session-item-title",
					text: sessionTitle,
				});
				bodyButton.createDiv({
					cls: "friday-ai-session-item-meta",
					text: this.formatSessionUpdatedAt(session.updatedAt),
				});
				if (!this.aiSessionManageMode) {
					const utility = rowEl.createDiv({ cls: "friday-ai-session-item-actions" });
					const menuButton = utility.createEl("button", {
						cls: "friday-shell-icon-button friday-ai-session-item-menu",
					});
					menuButton.type = "button";
					menuButton.setAttribute("aria-label", this.t("ai.sessions.more", "更多操作"));
					setIcon(menuButton, "more-horizontal");
					menuButton.onclick = (event) => {
						event.stopPropagation();
						this.openSessionActionsMenu(session, event);
					};
				}

				if (this.aiSessionRenameId === session.sessionId) {
					const renameRow = itemEl.createDiv({ cls: "friday-ai-session-rename" });
					const renameInput = renameRow.createEl("input", {
						cls: "friday-ai-session-rename-input",
						attr: { type: "text" },
					});
					renameInput.value = this.aiSessionRenameDraft;
					renameInput.oninput = () => {
						this.aiSessionRenameDraft = renameInput.value;
					};
					renameInput.onkeydown = (event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void this.commitSessionRename(session.sessionId);
						}
						if (event.key === "Escape") {
							event.preventDefault();
							this.cancelSessionRename();
							this.renderBoard();
						}
					};
					window.setTimeout(() => {
						renameInput.focus();
						renameInput.select();
					}, 0);
					const renameActions = renameRow.createDiv({ cls: "friday-ai-session-rename-actions" });
					const saveRename = renameActions.createEl("button", {
						cls: "friday-ai-session-bulkbutton",
						text: this.t("ai.sessions.rename.save", "保存"),
					});
					saveRename.type = "button";
					saveRename.onclick = () => {
						void this.commitSessionRename(session.sessionId);
					};
					const cancelRename = renameActions.createEl("button", {
						cls: "friday-ai-session-bulkbutton",
						text: this.t("ai.sessions.rename.cancel", "取消"),
					});
					cancelRename.type = "button";
					cancelRename.onclick = () => {
						this.cancelSessionRename();
						this.renderBoard();
					};
				}
			}
		}
	}

	private startNewAiSession(): void {
		this.aiConversation = [];
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.aiQueuedPrompts = [];
		this.aiLastError = "";
		this.aiLocalIntakePreview = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiRuntimeTrajectoryStore.reset();
		this.aiRuntimeTrajectorySnapshot = null;
		this.aiRuntimeSawIntake = false;
		this.aiRuntimeModelRequestStarted = false;
		this.clearRuntimeElapsedTimer();
		this.resetProcessTypewriterState();
		this.aiAgentTasks = [];
		this.aiProcessSnapshotsByKey.clear();
		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiSessionSearchQuery = "";
		this.aiSessionNavCollapsed = true;
		this.aiSessionManageMode = false;
		this.aiSessionSelection.clear();
		this.aiSessionRenameId = "";
		this.aiSessionRenameDraft = "";
		this.plugin.toolApprovalService.clearSessionRules();
		this.plugin.agentRuntimeService.clearAllSessionToolPolicyOverrides();
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private async switchAiSession(sessionId: string, fallbackConversation?: ChatMessage[]): Promise<void> {
		if (!sessionId || (sessionId === this.aiSessionId && !fallbackConversation)) {
			return;
		}
		let target = this.aiSessions.find((session) => session.sessionId === sessionId) ?? null;
		if (!target && !fallbackConversation) {
			await this.ensureAiSessionLoaded();
			target = this.aiSessions.find((session) => session.sessionId === sessionId) ?? null;
		}
		if (!target) {
			if (!fallbackConversation) {
				new Notice(this.t("ai.sessions.notFound", "未找到对话记录"), 4000);
				return;
			}
			target = {
				sessionId,
				soulId: this.plugin.settings.activeSoulId,
				projectId: this.plugin.settings.activeProjectId || undefined,
				updatedAt: new Date().toISOString(),
				filePath: "",
				messages: fallbackConversation,
			};
		}
		this.aiSessionId = target.sessionId;
		this.aiConversation = [...target.messages];
		await this.hydrateAgentTasksForCurrentSession();
		await this.hydrateCompletedTrajectorySnapshotsForCurrentSession();
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.aiQueuedPrompts = [];
		this.aiLastError = "";
		this.aiLocalIntakePreview = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiRuntimeTrajectoryStore.reset();
		this.aiRuntimeTrajectorySnapshot = null;
		this.aiRuntimeSawIntake = false;
		this.aiRuntimeModelRequestStarted = false;
		this.clearRuntimeElapsedTimer();
		this.resetProcessTypewriterState();
		this.aiSessionNavCollapsed = true;
		this.aiSessionManageMode = false;
		this.aiSessionSelection.clear();
		this.aiSessionRenameId = "";
		this.aiSessionRenameDraft = "";
		this.plugin.agentRuntimeService.clearAllSessionToolPolicyOverrides();
		this.plugin.toolApprovalService.clearSessionRules();
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private toggleSessionManageMode(): void {
		this.aiSessionManageMode = !this.aiSessionManageMode;
		if (!this.aiSessionManageMode) {
			this.aiSessionSelection.clear();
		}
		this.cancelSessionRename();
		this.renderBoard();
	}

	private toggleSessionSelection(sessionId: string): void {
		if (this.aiSessionSelection.has(sessionId)) {
			this.aiSessionSelection.delete(sessionId);
		} else {
			this.aiSessionSelection.add(sessionId);
		}
		this.renderBoard();
	}

	private toggleAllSessionSelections(sessionIds: string[]): void {
		if (sessionIds.length === 0) {
			return;
		}
		const allSelected = sessionIds.every((sessionId) => this.aiSessionSelection.has(sessionId));
		if (allSelected) {
			for (const sessionId of sessionIds) {
				this.aiSessionSelection.delete(sessionId);
			}
		} else {
			for (const sessionId of sessionIds) {
				this.aiSessionSelection.add(sessionId);
			}
		}
		this.renderBoard();
	}

	private beginSessionRename(session: ConversationSession): void {
		this.aiSessionRenameId = session.sessionId;
		this.aiSessionRenameDraft = session.title?.trim() || this.buildSessionTitle(session);
		this.renderBoard();
	}

	private cancelSessionRename(): void {
		this.aiSessionRenameId = "";
		this.aiSessionRenameDraft = "";
	}

	private async commitSessionRename(sessionId: string): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul) {
			return;
		}
		const nextTitle = this.aiSessionRenameDraft.trim();
		if (!nextTitle) {
			new Notice(this.t("ai.sessions.rename.empty", "对话标题不能为空。"), 3000);
			return;
		}
		const updated = await this.plugin.conversationService.renameSession(
			activeSoul.id,
			sessionId,
			nextTitle,
			this.plugin.settings.activeProjectId || undefined,
		);
		this.aiSessions = this.aiSessions.map((session) => session.sessionId === sessionId ? updated : session);
		if (this.aiSessionId === sessionId) {
			this.aiConversation = [...updated.messages];
		}
		this.cancelSessionRename();
		this.renderBoard();
	}

	private async deleteSingleSession(sessionId: string): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul || this.aiBusy) {
			return;
		}
		await this.plugin.conversationService.deleteSession(
			activeSoul.id,
			sessionId,
			this.plugin.settings.activeProjectId || undefined,
		);
		this.aiSessions = this.aiSessions.filter((session) => session.sessionId !== sessionId);
		this.aiSessionSelection.delete(sessionId);
		if (this.aiSessionRenameId === sessionId) {
			this.cancelSessionRename();
		}
		if (this.aiSessionId === sessionId) {
			this.aiSessionId = "";
			await this.ensureAiSessionLoaded();
		}
		this.renderBoard();
	}

	private async deleteSelectedSessions(): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul || this.aiSessionSelection.size === 0 || this.aiBusy) {
			return;
		}
		const ids = [...this.aiSessionSelection];
		for (const sessionId of ids) {
			await this.plugin.conversationService.deleteSession(
				activeSoul.id,
				sessionId,
				this.plugin.settings.activeProjectId || undefined,
			);
		}
		const activeDeleted = ids.includes(this.aiSessionId);
		this.aiSessions = this.aiSessions.filter((session) => !this.aiSessionSelection.has(session.sessionId));
		this.aiSessionSelection.clear();
		this.aiSessionManageMode = false;
		this.cancelSessionRename();
		if (activeDeleted) {
			this.aiSessionId = "";
			await this.ensureAiSessionLoaded();
		}
		this.renderBoard();
	}

	private getFilteredAiSessions(): ConversationSession[] {
		const normalizedQuery = this.aiSessionSearchQuery.trim().toLowerCase();
		if (!normalizedQuery) {
			return this.aiSessions;
		}
		return this.aiSessions.filter((session) => this.matchesSessionSearch(session, normalizedQuery));
	}

	private matchesSessionSearch(session: ConversationSession, normalizedQuery: string): boolean {
		if (this.buildSessionTitle(session).toLowerCase().includes(normalizedQuery)) {
			return true;
		}
		return session.messages.some((message) =>
			parseLegacyMentionMarkup(message.content).text.toLowerCase().includes(normalizedQuery),
		);
	}

	private buildSessionGroups(sessions: ConversationSession[]): SessionListGroup[] {
		const groups = new Map<string, SessionListGroup>();
		for (const session of sessions) {
			const meta = this.resolveSessionGroupMeta(session.updatedAt);
			const group = groups.get(meta.key) ?? {
				key: meta.key,
				label: meta.label,
				sessions: [],
			};
			group.sessions.push(session);
			groups.set(meta.key, group);
		}
		return [...groups.values()];
	}

	private resolveSessionGroupMeta(updatedAt: string): { key: string; label: string } {
		const parsed = new Date(updatedAt);
		if (Number.isNaN(parsed.getTime())) {
			return {
				key: "unknown",
				label: this.t("common.unknownTime", "未知时间"),
			};
		}
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const dayStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
		const diffDays = Math.round((todayStart.getTime() - dayStart.getTime()) / (24 * 60 * 60 * 1000));
		if (diffDays === 0) {
			return {
				key: "today",
				label: this.t("common.time.today", "今天"),
			};
		}
		if (diffDays === 1) {
			return {
				key: "yesterday",
				label: this.t("common.time.yesterday", "昨天"),
			};
		}
		const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
		return {
			key,
			label: parsed.toLocaleDateString(),
		};
	}

	private openSessionActionsMenu(session: ConversationSession, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(this.t("ai.sessions.rename.action", "重命名"))
				.setIcon("pencil")
				.onClick(() => {
					this.beginSessionRename(session);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(this.t("ai.sessions.delete.action", "删除"))
				.setIcon("trash-2")
				.onClick(() => {
					void this.deleteSingleSession(session.sessionId);
				});
		});
		menu.showAtMouseEvent(event);
	}

	private buildSessionTitle(session: ConversationSession): string {
		if (session.title?.trim()) {
			return this.truncateText(session.title.trim(), 72);
		}
		const firstUserMessage = session.messages.find(
			(message) => message.role === "user" && message.content.trim().length > 0,
		);
		const raw = parseLegacyMentionMarkup(firstUserMessage?.content ?? "").text
			|| this.t("ai.sessions.untitled", "未命名对话");
		return this.truncateText(raw, 72);
	}

	private formatSessionUpdatedAt(updatedAt: string): string {
		const parsed = new Date(updatedAt);
		if (Number.isNaN(parsed.getTime())) {
			return updatedAt || this.t("common.unknownTime", "未知时间");
		}
		const diffMs = Date.now() - parsed.getTime();
		if (diffMs < 60 * 1000) {
			return this.t("common.time.justNow", "刚刚");
		}
		if (diffMs < 60 * 60 * 1000) {
			return this.t("common.time.minutesAgo", "{count} 分钟前", {
				count: Math.max(1, Math.floor(diffMs / (60 * 1000))),
			});
		}
		if (diffMs < 24 * 60 * 60 * 1000) {
			return this.t("common.time.hoursAgo", "{count} 小时前", {
				count: Math.max(1, Math.floor(diffMs / (60 * 60 * 1000))),
			});
		}
		if (diffMs < 48 * 60 * 60 * 1000) {
			return this.t("common.time.yesterday", "昨天");
		}
		return parsed.toLocaleDateString();
	}

	private renderAiMessage(
		containerEl: HTMLElement,
		message: ChatMessage,
		isStreaming = false,
		resultSnapshot: AgentTrajectorySnapshot | null = null,
	): void {
		const isUser = message.role === "user";
		if (!isUser) {
			const soulStyleSnapshot = this.resolveMessageSoulStyleSnapshot(message, isStreaming);
			renderAgentAnswerFlow({
				containerEl,
				snapshot: resultSnapshot,
				isStreaming,
				expanded: this.isProcessExpanded(resultSnapshot),
				onToggle: () => this.toggleProcessExpanded(resultSnapshot),
				onAction: (action) => {
					if (resultSnapshot) {
						this.handleTrajectoryAction(resultSnapshot, action);
					}
				},
				renderContent: (contentEl) => this.renderAiMessageContent(contentEl, message),
				renderAssistantAvatar: (metaEl) => this.renderAssistantAvatar(metaEl),
				assistantSoulStyleCode: soulStyleSnapshot?.soulStyleCode,
				assistantSoulStyleLabel: soulStyleSnapshot?.soulStyleLabel,
				assistantSoulStyleFullLabel: soulStyleSnapshot?.soulStyleFullLabel,
				renderIcon: (iconEl, icon) => setIcon(iconEl, icon),
				onOpenArtifact: (pathValue) => {
					void this.openAgentArtifactInWorkspace(pathValue);
				},
			});
			return;
		}
		const rowEl = containerEl.createDiv({
			cls: "friday-ai-message-row is-user assistant-turn-v2",
		});
		const bubbleEl = rowEl.createDiv({
			cls: "friday-ai-message is-user assistant-user-bubble-v3",
		});
		const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta assistant-meta-v2" });
		metaEl.createSpan({
			cls: "friday-ai-message-role",
			text: this.resolveUserDisplayName(),
		});
		const contentEl = bubbleEl.createDiv({
			cls: `friday-ai-message-content${isStreaming ? " is-streaming" : ""}`,
		});
		this.renderAiMessageContent(contentEl, message);
		if (resultSnapshot) {
			this.renderTrajectoryCard(
				containerEl,
				resultSnapshot,
				resultSnapshot.status === "running" ? "live" : "completed",
			);
		}
	}

	private renderAssistantAvatar(containerEl: HTMLElement): void {
		const avatarEl = containerEl.createSpan({
			cls: "friday-ai-message-avatar",
			attr: { "aria-hidden": "true" },
		});
		setIcon(avatarEl, FRIDAY_ICON_ID);
	}

	private resolveAssistantSoulStyleSnapshot(soulDefinition: SoulDefinition | null | undefined): Pick<
		ChatMessageUiMeta,
		"soulStyleCode" | "soulStyleLabel" | "soulStyleFullLabel"
	> | undefined {
		const fullLabel = soulDefinition?.profile?.stylePolicy?.label?.trim() || "";
		const code = fullLabel.match(/^([A-Z]{4})\b/)?.[1] ?? "";
		if (!code) {
			return undefined;
		}
		return {
			soulStyleCode: code,
			soulStyleLabel: code,
			soulStyleFullLabel: fullLabel,
		};
	}

	private resolveMessageSoulStyleSnapshot(
		message: ChatMessage,
		isStreaming: boolean,
	): Pick<ChatMessageUiMeta, "soulStyleCode" | "soulStyleLabel" | "soulStyleFullLabel"> | undefined {
		const code = message.uiMeta?.soulStyleCode?.trim() || "";
		const label = message.uiMeta?.soulStyleLabel?.trim() || code;
		const fullLabel = message.uiMeta?.soulStyleFullLabel?.trim() || label;
		if (code) {
			return {
				soulStyleCode: code,
				soulStyleLabel: label,
				soulStyleFullLabel: fullLabel,
			};
		}
		if (!isStreaming) {
			return undefined;
		}
		const activeSoul = this.plugin.getActiveSoul();
		const activeSoulDefinition = activeSoul ? this.plugin.soulStore.getSoulSync(activeSoul.id) : null;
		return this.resolveAssistantSoulStyleSnapshot(activeSoulDefinition);
	}

	private normalizeDisplayedAssistantMessageContent(content: string): string {
		if (/Agent turn cancelled|Task cancelled|Run cancelled|Action cancelled|AbortError|aborted|cancelled|canceled|ERR_CONNECTION_CLOSED|ECONNCLOSED|ERR_HTTP2_PROTOCOL_ERROR|HTTP2_PROTOCOL|Request failed|status\s+\d+|request_exhausted|transport|原始错误/i.test(content)) {
			const productizedContent = productizeRuntimeText(content);
			if (productizedContent) {
				return productizedContent;
			}
		}
		return content
			.replace(
				/Pending file changes:\s*(\d+)\s*change\(s\)\s*prepared but not applied\.\s*Review and apply or reject them in FRIDAY\./gi,
				(_match, count: string) => `已准备好 ${count} 个待应用的文件修改，确认后才会写入 Obsidian。`,
			)
			.replace(/^Applied file creation:\s*(.+)$/gim, "已应用文件创建：$1")
			.replace(/^Applied file (?:update|change):\s*(.+)$/gim, "已应用文件修改：$1")
			.replace(/^Applied file deletion:\s*(.+)$/gim, "已应用文件删除：$1");
	}

	private renderAiMessageContent(containerEl: HTMLElement, message: ChatMessage): void {
		if (message.role === "user" && message.uiMeta?.segments?.length) {
			this.renderStructuredUserMessageBody(containerEl, message.uiMeta.segments);
			return;
		}
		const content = message.role === "assistant"
			? this.normalizeDisplayedAssistantMessageContent(message.content)
			: message.content;
		void MarkdownRenderer.renderMarkdown(content, containerEl, "", this);
	}

	private isCurrentConversationId(conversationId?: string | null): boolean {
		const currentConversationId = this.aiSessionId.trim();
		const candidateConversationId = conversationId?.trim();
		return Boolean(currentConversationId && candidateConversationId && candidateConversationId === currentConversationId);
	}

	private isCurrentAiTurnTarget(target: Pick<AiTurnTarget, "sessionId" | "projectId">): boolean {
		const currentSessionId = this.aiSessionId.trim();
		const targetSessionId = target.sessionId.trim();
		const currentProjectId = this.plugin.settings.activeProjectId?.trim() || "";
		const targetProjectId = target.projectId?.trim() || "";
		return Boolean(currentSessionId && targetSessionId && currentSessionId === targetSessionId && currentProjectId === targetProjectId);
	}

	private isSameAiTurnTarget(left: Pick<AiTurnTarget, "sessionId" | "projectId">, right: Pick<AiTurnTarget, "sessionId" | "projectId">): boolean {
		const leftSessionId = left.sessionId.trim();
		const rightSessionId = right.sessionId.trim();
		const leftProjectId = left.projectId?.trim() || "";
		const rightProjectId = right.projectId?.trim() || "";
		return Boolean(leftSessionId && rightSessionId && leftSessionId === rightSessionId && leftProjectId === rightProjectId);
	}

	private isTaskOwnedByCurrentSession(task: { conversationId?: string | null }): boolean {
		return this.isCurrentConversationId(task.conversationId);
	}

	private hasCurrentSessionTask(taskId: string): boolean {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId) {
			return false;
		}
		return this.aiAgentTasks.some((task) => task.id === normalizedTaskId && this.isTaskOwnedByCurrentSession(task)) ||
			this.aiConversation.some((message) => message.role === "assistant" && message.uiMeta?.taskId === normalizedTaskId);
	}

	private isSnapshotOwnedByCurrentSession(snapshot: AgentTrajectorySnapshot | null): snapshot is AgentTrajectorySnapshot {
		return this.isSnapshotOwnedBySession(snapshot, this.aiSessionId, this.plugin.settings.activeProjectId);
	}

	private isSnapshotOwnedBySession(
		snapshot: AgentTrajectorySnapshot | null,
		sessionId: string,
		projectId = this.plugin.settings.activeProjectId,
	): snapshot is AgentTrajectorySnapshot {
		if (!snapshot) {
			return false;
		}
		const targetSessionId = sessionId.trim();
		if (!targetSessionId) {
			return false;
		}
		if (!this.isSnapshotProjectOwned(snapshot, projectId)) {
			return false;
		}
		const conversationId = snapshot.identity.conversationId?.trim();
		if (conversationId) {
			return conversationId === targetSessionId;
		}
		const taskId = snapshot.identity.taskId?.trim();
		if (!taskId) {
			return false;
		}
		if (targetSessionId === this.aiSessionId.trim()) {
			return this.hasCurrentSessionTask(taskId);
		}
		return this.hasSessionMessageTask(targetSessionId, taskId);
	}

	private isSnapshotEntryOwnedBySession(
		key: string,
		snapshot: AgentTrajectorySnapshot | null,
		sessionId: string,
		projectId = this.plugin.settings.activeProjectId,
	): snapshot is AgentTrajectorySnapshot {
		if (!this.isSnapshotOwnedBySession(snapshot, sessionId, projectId)) {
			return false;
		}
		return key === this.getTrajectorySnapshotKeyForSession(snapshot, sessionId, projectId);
	}

	private isSnapshotProjectOwned(snapshot: AgentTrajectorySnapshot, projectId?: string): boolean {
		const expectedProjectId = projectId?.trim() || "";
		const snapshotProjectId = this.aiProcessSnapshotProjectIds.get(snapshot)?.trim() || "";
		return !snapshotProjectId || !expectedProjectId || snapshotProjectId === expectedProjectId;
	}

	private hasSessionMessageTask(sessionId: string, taskId: string): boolean {
		const normalizedSessionId = sessionId.trim();
		const normalizedTaskId = taskId.trim();
		if (!normalizedSessionId || !normalizedTaskId) {
			return false;
		}
		return this.aiSessions.some((session) =>
			session.sessionId === normalizedSessionId &&
			session.messages.some((message) => message.uiMeta?.taskId?.trim() === normalizedTaskId)
		);
	}

	private getCompletedTrajectorySnapshotForMessage(
		message: ChatMessage,
	): AgentTrajectorySnapshot | null {
		if (message.role !== "assistant" && message.role !== "user") {
			return null;
		}
		const key = this.getMessageTrajectorySnapshotKey(message);
		if (!key) {
			return null;
		}
		const snapshot = this.aiProcessSnapshotsByKey.get(key) ?? null;
		if (!this.isSnapshotOwnedByCurrentSession(snapshot)) {
			return null;
		}
		if (message.role === "user") {
			return this.aiRuntimeTrajectorySnapshot === snapshot ? snapshot : null;
		}
		if (message.role === "assistant") {
			return this.aiRuntimeTrajectorySnapshot === snapshot ? null : snapshot;
		}
		return null;
	}

	private bindRuntimeSnapshotToLatestUserMessage(snapshot: AgentTrajectorySnapshot | null): void {
		if (!this.isSnapshotOwnedByCurrentSession(snapshot)) {
			return;
		}
		for (let index = this.aiConversation.length - 1; index >= 0; index -= 1) {
			const message = this.aiConversation[index];
			if (message?.role !== "user") {
				continue;
			}
			const uiMeta = message.uiMeta ?? {};
			message.uiMeta = {
				...uiMeta,
				conversationId: snapshot.identity.conversationId || uiMeta.conversationId?.trim() || this.aiSessionId,
				turnId: snapshot.identity.turnId || uiMeta.turnId?.trim(),
				taskId: snapshot.identity.taskId || uiMeta.taskId?.trim(),
			};
			const key = this.getMessageTrajectorySnapshotKey(message);
			if (key) {
				this.aiProcessSnapshotsByKey.set(key, snapshot);
			}
			return;
		}
	}

	private isLiveRuntimeSnapshotAttachedToMessage(): boolean {
		const liveKey = this.getTrajectorySnapshotKey(this.aiRuntimeTrajectorySnapshot);
		return Boolean(liveKey && this.aiProcessSnapshotsByKey.get(liveKey) === this.aiRuntimeTrajectorySnapshot);
	}

	private isSameTrajectorySnapshotIdentity(
		left: AgentTrajectorySnapshot | null,
		right: AgentTrajectorySnapshot | null,
	): boolean {
		const leftKey = this.getTrajectorySnapshotKey(left);
		return Boolean(leftKey && leftKey === this.getTrajectorySnapshotKey(right));
	}

	private getMessageTrajectorySnapshotKey(message: ChatMessage): string {
		const uiMeta = message.uiMeta;
		const taskId = uiMeta?.taskId?.trim() || "";
		const task = taskId ? this.aiAgentTasks.find((item) => item.id === taskId) : undefined;
		const turnId = uiMeta?.turnId?.trim() || task?.turnId?.trim() || "";
		const conversationId = uiMeta?.conversationId?.trim() || task?.conversationId?.trim() || this.aiSessionId.trim();
		return this.buildTrajectorySnapshotKey(conversationId, turnId, taskId, this.plugin.settings.activeProjectId);
	}

	private getTrajectorySnapshotKey(snapshot: AgentTrajectorySnapshot | null): string {
		return this.getTrajectorySnapshotKeyForSession(
			snapshot,
			this.aiSessionId,
			this.getSnapshotProjectId(snapshot) || this.plugin.settings.activeProjectId,
		);
	}

	private getTrajectorySnapshotKeyForSession(
		snapshot: AgentTrajectorySnapshot | null,
		sessionId: string,
		projectId = this.plugin.settings.activeProjectId,
	): string {
		if (!snapshot) {
			return "";
		}
		return this.buildTrajectorySnapshotKey(
			snapshot.identity.conversationId || sessionId,
			snapshot.identity.turnId,
			snapshot.identity.taskId,
			projectId,
		);
	}

	private buildTrajectorySnapshotKey(
		conversationId: string | undefined,
		turnId: string | undefined,
		taskId: string | undefined,
		projectId = this.plugin.settings.activeProjectId,
	): string {
		const normalizedProjectId = projectId?.trim() || "";
		const normalizedConversationId = conversationId?.trim() || "";
		const normalizedTurnId = turnId?.trim() || "";
		const normalizedTaskId = taskId?.trim() || "";
		const stableWorkId = normalizedTurnId || normalizedTaskId;
		if (!normalizedConversationId || !stableWorkId) {
			return "";
		}
		return `${normalizedProjectId}::${normalizedConversationId}::${stableWorkId}`;
	}

	private getSnapshotProjectId(snapshot: AgentTrajectorySnapshot | null): string {
		return snapshot ? this.aiProcessSnapshotProjectIds.get(snapshot)?.trim() || "" : "";
	}

	private rememberCompletedTrajectorySnapshot(snapshot: AgentTrajectorySnapshot | null): void {
		this.rememberCompletedTrajectorySnapshotForSession(snapshot, this.aiSessionId);
	}

	private rememberCompletedTrajectorySnapshotForSession(
		snapshot: AgentTrajectorySnapshot | null,
		sessionId: string,
		projectId = this.plugin.settings.activeProjectId,
	): void {
		if (!this.isSnapshotOwnedBySession(snapshot, sessionId, projectId)) {
			return;
		}
		const key = this.getTrajectorySnapshotKeyForSession(snapshot, sessionId, projectId);
		if (key) {
			this.aiProcessSnapshotProjectIds.set(snapshot, projectId?.trim() || "");
			this.aiProcessSnapshotsByKey.set(key, snapshot);
			this.aiProcessExpandedKeys.delete(key);
			this.aiProcessCollapsedKeys.add(key);
		}
	}

	private isProcessExpanded(snapshot: AgentTrajectorySnapshot | null): boolean {
		const key = this.getTrajectorySnapshotKey(snapshot);
		if (!key || !snapshot) {
			return false;
		}
		if (this.aiProcessExpandedKeys.has(key)) {
			return true;
		}
		if (this.aiProcessCollapsedKeys.has(key)) {
			return false;
		}
		const view = buildAgentProcessPanelViewModel(snapshot);
		return Boolean(view.timeline?.defaultExpanded);
	}

	private rememberProcessExpandedState(snapshot: AgentTrajectorySnapshot | null, expanded: boolean): void {
		const key = this.getTrajectorySnapshotKey(snapshot);
		if (!key) {
			return;
		}
		if (expanded) {
			this.aiProcessCollapsedKeys.delete(key);
			this.aiProcessExpandedKeys.add(key);
			return;
		}
		this.aiProcessExpandedKeys.delete(key);
		this.aiProcessCollapsedKeys.add(key);
	}

	private toggleProcessExpanded(snapshot: AgentTrajectorySnapshot | null): void {
		const key = this.getTrajectorySnapshotKey(snapshot);
		if (!key) {
			return;
		}
		const wasExpanded = this.isProcessExpanded(snapshot);
		if (wasExpanded) {
			this.aiProcessExpandedKeys.delete(key);
			this.aiProcessCollapsedKeys.add(key);
		} else {
			this.aiProcessCollapsedKeys.delete(key);
			this.aiProcessExpandedKeys.add(key);
			if (snapshot?.status === "running") {
				this.aiSkipNextProcessTypewriter = true;
			}
		}
		this.renderBoard();
	}

	private findLastAssistantMessageIndex(): number {
		for (let index = this.aiConversation.length - 1; index >= 0; index -= 1) {
			if (this.aiConversation[index]?.role === "assistant") {
				return index;
			}
		}
		return -1;
	}

	private renderStructuredUserMessageBody(containerEl: HTMLElement, segments: ChatMessageUiSegment[]): void {
		const inlineEl = containerEl.createDiv({ cls: "friday-ai-inline-body" });
		for (const segment of segments) {
			if (segment.type === "text") {
				inlineEl.appendText(segment.text);
				continue;
			}
			this.renderInlineMessageToken(inlineEl, segment.token);
		}
	}

	private renderInlineMessageToken(containerEl: HTMLElement, token: ChatMessageUiToken): void {
		containerEl.createSpan({
			cls: `friday-ai-message-badge friday-ai-inline-token is-${token.kind}`,
			text: token.label,
			attr: {
				...(token.tokenType ? { "data-token-type": token.tokenType } : {}),
				...(token.target ? { "data-token-target": token.target } : {}),
			},
		});
	}

	private renderAiMessageList(containerEl: HTMLElement): void {
		containerEl.empty();
		const pendingApprovals = this.approvalQueue.list();
		const visibleAgentTasks = this.getVisibleAgentTasksForCurrentSession();
		if (
			this.aiConversation.length === 0 &&
			!this.aiLocalIntakePreview &&
			!this.aiStreamingPreview &&
			!this.aiRuntimeTrajectorySnapshot &&
			pendingApprovals.length === 0 &&
			visibleAgentTasks.length === 0
		) {
			const emptyEl = containerEl.createDiv({ cls: "friday-ai-empty" });
			emptyEl.createEl("h4", { text: this.plugin.t("ai.empty.title") });
			emptyEl.createEl("p", { text: this.plugin.t("ai.empty.desc") });
		}
		for (const message of this.aiConversation) {
			const completedSnapshotForMessage = this.getCompletedTrajectorySnapshotForMessage(message);
			this.renderAiMessage(containerEl, message, false, completedSnapshotForMessage);
		}
		const shouldRenderLiveRuntimePreview = Boolean(
			this.aiRuntimeTrajectorySnapshot &&
			(this.aiRuntimeModelRequestStarted || !this.aiLocalIntakePreview) &&
			!this.isLiveRuntimeSnapshotAttachedToMessage(),
		);
		if (shouldRenderLiveRuntimePreview) {
			this.renderRuntimeExecutionPreview(containerEl);
		} else if (this.aiStreamingPreview) {
			this.renderAiMessage(
				containerEl,
				{
					role: "assistant",
					content: this.aiStreamingPreview,
				},
				true,
				this.aiStreamingTrajectorySnapshot,
			);
		} else if (this.aiLocalIntakePreview) {
			this.renderAiMessage(
				containerEl,
				{
					role: "assistant",
					content: this.aiLocalIntakePreview,
				},
				true,
			);
		}
		for (const item of pendingApprovals) {
			this.renderApprovalMessage(containerEl, item);
		}
		for (const task of visibleAgentTasks) {
			this.renderAgentTaskPanel(containerEl, task);
		}
	}

	private shouldRenderAgentTaskPanel(task: AgentTaskViewState): boolean {
		if (!this.isTaskOwnedByCurrentSession(task) || this.hasPendingComposerDecision()) {
			return false;
		}
		if (task.status === "waiting_for_user") {
			return Boolean(productizeRuntimeText(task.waitingForUser?.prompt || task.waitingForUser?.summary || task.summary));
		}
		return false;
	}

	private getVisibleAgentTasksForCurrentSession(): AgentTaskViewState[] {
		return this.aiAgentTasks.filter((task) => this.shouldRenderAgentTaskPanel(task));
	}

	private async openAgentArtifactInWorkspace(pathValue: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(pathValue);
		if (!(file instanceof TFile)) {
			new Notice(this.t("ai.artifact.missing", "File not found: {path}", { path: pathValue }), 4000);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	private syncAiLiveChatShell(): void {
		if (this.activePage !== "chat" || !this.aiMessageListEl?.isConnected) {
			return;
		}
		const disclosureState = this.captureCurrentLiveProcessDisclosureState();
		const currentProcessEl = this.findCurrentLiveProcessElement();
		if (this.isProcessElementExpanded(currentProcessEl)) {
			this.rememberProcessExpandedState(this.aiRuntimeTrajectorySnapshot, true);
		}
		this.captureAiMessageListScrollState(this.aiMessageListEl);
		this.renderAiMessageList(this.aiMessageListEl);
		this.applyCurrentLiveProcessDisclosureState(disclosureState);
		this.syncLiveProcessTypewriter();
		this.restoreAiMessageListScrollState(this.aiMessageListEl);
		this.syncAiErrorRegion();
		this.syncAiQueueHint();
		this.syncComposerDecisionPanel();
		this.syncAiComposerControls();
		this.syncComposerTaskBar();
	}

	private syncAiRuntimeShell(): void {
		if (this.activePage !== "chat") {
			this.syncBackgroundAgentStatus();
			return;
		}
		this.syncAiLiveChatShell();
	}

	private syncBackgroundAgentStatus(): void {
		if (!this.aiBackgroundAgentStatusHostEl?.isConnected) {
			return;
		}
		this.aiBackgroundAgentStatusHostEl.empty();
		this.renderBackgroundAgentStatus(this.aiBackgroundAgentStatusHostEl);
	}

	private syncAiErrorRegion(): void {
		if (!this.aiErrorEl?.isConnected) {
			return;
		}
		this.aiErrorEl.empty();
		if (!this.aiLastError) {
			return;
		}
		this.aiErrorEl.createDiv({
			cls: "friday-ai-error",
			text: this.aiLastError,
		});
	}

	private syncAiQueueHint(): void {
		if (!this.aiQueueHintEl?.isConnected) {
			return;
		}
		this.aiQueueHintEl.empty();
		if (!this.aiBusy && this.aiQueuedPrompts.length === 0) {
			return;
		}
		const hint = this.aiQueueHintEl.createDiv({ cls: "friday-ai-queue-hint kit-event-row-v1" });
		hint.createSpan({
			cls: "friday-ai-queue-hint-copy",
			text: this.aiQueuedPrompts.length > 0
				? this.t("ai.queue.helper.pending", "当前任务仍在执行，已排队 {count} 条，完成后会自动继续。", {
					count: this.aiQueuedPrompts.length,
				})
				: this.t("ai.queue.helper.busy", "当前任务仍在执行。你可以继续输入下一条指令，按 Enter 会自动加入队列。"),
		});
		if (this.aiQueuedPrompts.length > 0) {
			hint.createSpan({
				cls: "friday-ai-queue-pill kit-soft-chip-v1",
				text: this.t("ai.queue.badge", "待发送 {count}", { count: this.aiQueuedPrompts.length }),
			});
		}
	}

	private syncComposerDecisionPanel(): void {
		if (this.activePage !== "chat" || !this.aiComposerBodyEl?.isConnected) {
			return;
		}
		const pendingApprovals = this.approvalQueue.list();
		const pendingEditPlans = this.getPendingEditPlans();
		if (pendingApprovals.length > 0 || pendingEditPlans.length > 0) {
			const nextDecisionKey = this.getComposerDecisionKey(pendingApprovals, pendingEditPlans);
			if (
				this.aiComposerDecisionKey === nextDecisionKey &&
				this.aiComposerBodyEl.querySelector(".friday-composer-decision-panel")
			) {
				this.syncAiSendButtonState();
				return;
			}
			this.aiComposerDecisionKey = nextDecisionKey;
			this.composer?.destroy();
			this.composer = null;
			this.aiComposerBodyEl.empty();
			this.renderComposerDecisionPanel(this.aiComposerBodyEl, pendingApprovals, pendingEditPlans);
			this.syncAiSendButtonState();
			return;
		}

		this.aiComposerDecisionKey = "";
		if (!this.composer) {
			this.aiComposerBodyEl.empty();
			this.renderComposerInput(this.aiComposerBodyEl);
		}
		this.syncAiSendButtonState();
	}

	private closeAiToolbarChoiceMenu(): void {
		this.aiToolbarChoiceMenuCleanup?.();
		this.aiToolbarChoiceMenuCleanup = null;
		this.aiToolbarChoiceMenuEl?.remove();
		this.aiToolbarChoiceMenuEl = null;
	}

	private openAiToolbarChoiceMenu(config: {
		hostEl: HTMLElement;
		buttonEl: HTMLButtonElement;
		groups: ComposerChoiceMenuGroup[];
		selectedValue: string;
		onSelect: (value: string) => Promise<void> | void;
	}): void {
		if (this.aiToolbarChoiceMenuEl?.isConnected && this.aiToolbarChoiceMenuEl.parentElement === config.hostEl) {
			this.closeAiToolbarChoiceMenu();
			return;
		}

		this.closeAiToolbarChoiceMenu();
		config.hostEl.addClass("is-open");
		config.buttonEl.setAttribute("aria-expanded", "true");

		const menuEl = config.hostEl.createDiv({
			cls: "friday-ai-toolbar-choice-menu friday-mention-dropdown",
			attr: { role: "listbox" },
		});
		const listEl = menuEl.createDiv({ cls: "friday-mention-dropdown-list friday-ai-toolbar-choice-list" });
		this.aiToolbarChoiceMenuEl = menuEl;

		for (const group of config.groups) {
			const label = group.label.trim();
			if (label) {
				listEl.createDiv({
					cls: "friday-ai-toolbar-choice-group",
					text: label,
					attr: { role: "presentation" },
				});
			}
			for (const option of group.options) {
				const selected = option.value === config.selectedValue;
				const item = listEl.createEl("button", {
					cls: `friday-mention-item friday-ai-toolbar-choice-item${selected ? " is-active" : ""}${option.description ? "" : " is-text-only"}`,
					attr: {
						role: "option",
						"aria-selected": String(selected),
					},
				});
				item.type = "button";
				item.createSpan({ cls: "friday-mention-item-button", text: option.label });
				if (option.description) {
					item.createSpan({ cls: "friday-mention-item-description", text: option.description });
				}
				item.onmousedown = (event) => {
					event.preventDefault();
					event.stopPropagation();
				};
				item.onclick = (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.closeAiToolbarChoiceMenu();
					void config.onSelect(option.value);
				};
			}
		}

		const ownerDocument = config.hostEl.ownerDocument;
		const ownerWindow = ownerDocument.defaultView ?? window;
		const closeOnOutsidePointer = (event: MouseEvent) => {
			const target = event.target;
			if (target instanceof Node && config.hostEl.contains(target)) {
				return;
			}
			this.closeAiToolbarChoiceMenu();
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeAiToolbarChoiceMenu();
				config.buttonEl.focus();
			}
		};
		const outsidePointerTimer = ownerWindow.setTimeout(() => {
			ownerDocument.addEventListener("mousedown", closeOnOutsidePointer, true);
		}, 0);
		ownerDocument.addEventListener("keydown", closeOnEscape, true);
		this.aiToolbarChoiceMenuCleanup = () => {
			ownerWindow.clearTimeout(outsidePointerTimer);
			ownerDocument.removeEventListener("mousedown", closeOnOutsidePointer, true);
			ownerDocument.removeEventListener("keydown", closeOnEscape, true);
			config.hostEl.removeClass("is-open");
			config.buttonEl.setAttribute("aria-expanded", "false");
		};
	}

	private syncAiComposerControls(): void {
		const activeSoul = this.plugin.getActiveSoul();
		const activeSoulDefinition = activeSoul ? this.plugin.soulStore.getSoulSync(activeSoul.id) : null;
		this.syncAiSendButtonState();
		if (this.aiModelSelectEl?.isConnected) {
			this.aiModelSelectEl.disabled = this.aiBusy || !activeSoulDefinition;
		}
		if (this.aiPermissionSelectEl?.isConnected) {
			this.aiPermissionSelectEl.disabled = this.aiBusy;
		}
	}

	private syncAiSendButtonState(): void {
		if (!this.aiSendButtonEl?.isConnected) {
			return;
		}
		this.aiSendButtonEl.empty();
		setIcon(this.aiSendButtonEl, this.resolveSendButtonIcon());
		this.aiSendButtonEl.setAttribute("aria-label", this.getSendButtonLabel());
		this.aiSendButtonEl.title = this.getSendButtonLabel();
		this.aiSendButtonEl.toggleClass("is-stop", this.aiBusy && this.isComposerDraftEmpty());
		this.aiSendButtonEl.disabled = this.hasPendingComposerDecision() || (!this.aiBusy && this.isComposerDraftEmpty());
	}

	private handleSendButtonClick(): void {
		if (this.aiBusy && this.isComposerDraftEmpty()) {
			this.stopCurrentAiRun();
			return;
		}
		if (this.isComposerDraftEmpty()) {
			return;
		}
		void this.submitAiPrompt();
	}

	private stopCurrentAiRun(): void {
		this.aiSendAbortController?.abort();
	}

	private async handleAgentTaskRetry(taskId: string): Promise<void> {
		await this.createAgentTaskPanelActionHandlers(taskId).retry();
	}

	private async handleAgentTaskResume(taskId: string): Promise<void> {
		await this.createAgentTaskPanelActionHandlers(taskId).resume();
	}

	private async handleAgentTaskCancel(taskId: string): Promise<void> {
		await this.createAgentTaskPanelActionHandlers(taskId).cancel();
	}

	private async handleAgentTaskContinue(taskId: string): Promise<void> {
		await this.createAgentTaskPanelActionHandlers(taskId).continue();
	}

	private createAgentTaskPanelActionHandlers(taskId: string) {
		return createAgentTaskPanelActionHandlers(taskId, this.plugin.agentRuntimeService, {
			abortCurrentRun: () => this.aiSendAbortController?.abort(),
			getContinuePrompt: () => this.aiDraft.trim() || "Continue.",
			beforeRuntimeRun: () => this.prepareTaskActionRuntimeRun(taskId),
			onProgress: (event) => this.handleRuntimeProgress(event),
			recordAgentTask: (task) => this.recordAgentTask(task),
			afterMutationReview: () => this.refreshCompletedTrajectorySnapshotsForCurrentSession(),
			render: () => this.renderBoard(),
			signal: this.aiSendAbortController?.signal,
		});
	}

	private prepareTaskActionRuntimeRun(taskId: string): void {
		this.aiLastError = "";
		this.aiLocalIntakePreview = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiRuntimeTrajectoryStore.reset();
		this.aiRuntimeTrajectorySnapshot = null;
		this.aiRuntimeSawIntake = false;
		this.aiRuntimeModelRequestStarted = false;
		this.clearRuntimeElapsedTimer();
		this.resetProcessTypewriterState();
		this.aiRuntimeProgressTaskIds.clear();
		this.forgetTrajectorySnapshotsForTask(taskId);
		this.removeAssistantMessagesForTask(taskId);
		this.aiForceScrollToBottomOnce = true;
		this.syncAiRuntimeShell();
	}

	private forgetTrajectorySnapshotsForTask(taskId: string): void {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId) {
			return;
		}
		for (const [key, snapshot] of this.aiProcessSnapshotsByKey.entries()) {
			if (snapshot.identity.taskId?.trim() !== normalizedTaskId && !key.endsWith(`::${normalizedTaskId}`)) {
				continue;
			}
			this.aiProcessSnapshotsByKey.delete(key);
			this.aiProcessSnapshotProjectIds.delete(snapshot);
			this.aiProcessExpandedKeys.delete(key);
			this.aiProcessCollapsedKeys.delete(key);
		}
	}

	private removeAssistantMessagesForTask(taskId: string): void {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId) {
			return;
		}
		for (let index = this.aiConversation.length - 1; index >= 0; index -= 1) {
			const message = this.aiConversation[index];
			if (message?.role === "assistant" && message.uiMeta?.taskId?.trim() === normalizedTaskId) {
				this.aiConversation.splice(index, 1);
			}
		}
	}

	private async hydrateAgentTasksForCurrentSession(): Promise<void> {
		if (!this.aiSessionId.trim()) {
			this.aiAgentTasks = [];
			return;
		}
		const taskIds = new Set(
			this.aiConversation
				.map((message) => message.uiMeta?.taskId)
				.filter((taskId): taskId is string => Boolean(taskId)),
		);
		const byId = new Map<string, AgentTask>();
		const conversationTasks = await this.plugin.agentRuntimeService.listAgentTasksByConversationId(this.aiSessionId);
		for (const task of conversationTasks) {
			if (!this.isTaskOwnedByCurrentSession(task)) {
				continue;
			}
			if (taskIds.has(task.id) || this.isVisibleAgentTaskStatus(task.status)) {
				byId.set(task.id, task);
			}
		}
		for (const taskId of taskIds) {
			if (byId.has(taskId)) {
				continue;
			}
			const task = await this.plugin.agentRuntimeService.getAgentTask(taskId);
			if (task && this.isTaskOwnedByCurrentSession(task)) {
				byId.set(task.id, task);
			}
		}
		this.aiAgentTasks = [...byId.values()]
			.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
			.slice(-8)
			.map((task) => this.toAgentTaskViewState(task));
	}

	private async hydrateCompletedTrajectorySnapshotsForCurrentSession(): Promise<void> {
		this.aiProcessSnapshotsByKey.clear();
		const currentConversationId = this.aiSessionId.trim();
		if (!currentConversationId) {
			return;
		}
		const refs = new Map<string, { conversationId: string; turnId: string; taskId?: string }>();
		for (const message of this.aiConversation) {
			if (message.role !== "assistant") {
				continue;
			}
			const taskId = message.uiMeta?.taskId?.trim() || "";
			const task = taskId ? this.aiAgentTasks.find((item) => item.id === taskId) : undefined;
			const turnId = message.uiMeta?.turnId?.trim() || task?.turnId?.trim() || "";
			if (!turnId) {
				continue;
			}
			const conversationId = message.uiMeta?.conversationId?.trim() || task?.conversationId?.trim() || currentConversationId;
			if (!this.isCurrentConversationId(conversationId)) {
				continue;
			}
			const key = this.buildTrajectorySnapshotKey(conversationId, turnId, taskId);
			if (key) {
				refs.set(key, { conversationId, turnId, ...(taskId ? { taskId } : {}) });
			}
		}
		for (const ref of refs.values()) {
			try {
				const summary = await this.plugin.agentRuntimeService.readTurnReplaySummary(ref);
				if (summary.totalEvents === 0) {
					continue;
				}
				this.rememberCompletedTrajectorySnapshot(projectReplaySummary(summary));
			} catch (error) {
				console.warn("[Friday] Failed to hydrate trajectory replay summary:", error);
			}
		}
	}

	private async refreshCompletedTrajectorySnapshotsForCurrentSession(): Promise<void> {
		await this.hydrateCompletedTrajectorySnapshotsForCurrentSession();
	}

	private isVisibleAgentTaskStatus(status: AgentTaskStatus): boolean {
		return status === "waiting_for_approval" || status === "waiting_for_user";
	}

	private recordAgentTask(task?: AgentTask): void {
		if (!task || !this.isTaskOwnedByCurrentSession(task)) {
			return;
		}
		const viewState = this.toAgentTaskViewState(task);
		const existingIndex = this.aiAgentTasks.findIndex((item) => item.id === task.id);
		if (existingIndex >= 0) {
			this.aiAgentTasks.splice(existingIndex, 1, viewState);
		} else {
			this.aiAgentTasks.push(viewState);
		}
		this.aiAgentTasks = this.aiAgentTasks.slice(-8);
	}

	private toAgentTaskViewState(task: AgentTask): AgentTaskViewState {
		return {
			id: task.id,
			conversationId: task.conversationId,
			...(task.turnId ? { turnId: task.turnId } : {}),
			status: task.status,
			title: task.title,
			summary: task.summary,
			...(task.failureReason ? { failureReason: task.failureReason } : {}),
			...(task.waitingForApproval ? { waitingForApproval: task.waitingForApproval } : {}),
			...(task.waitingForUser ? { waitingForUser: task.waitingForUser } : {}),
			availableActions: [...task.availableActions],
			pendingMutationCount: task.pendingMutationCount,
			changedFileCount: task.changedFileCount,
		};
	}

	private formatAgentTaskStatus(status: AgentTaskStatus): string {
		return formatUserFacingTaskStatus(status);
	}

	private formatAgentTaskAction(action: AgentTask["availableActions"][number]): string {
		return formatUserFacingTaskAction(action).label;
	}

	private renderAgentTaskPanel(containerEl: HTMLElement, task: AgentTaskViewState): void {
		const taskActions = this.createAgentTaskPanelActionHandlers(task.id);
		const taskView = buildUserFacingTaskView(task);
		const rowEl = containerEl.createDiv({ cls: "friday-ai-message-row is-assistant" });
		const panelEl = rowEl.createDiv({
			cls: `friday-ai-message is-assistant friday-agent-task-panel is-${task.status}`,
		});
		const headerEl = panelEl.createDiv({ cls: "friday-agent-task-header" });
		headerEl.createDiv({
			cls: "friday-agent-task-title",
			text: taskView.title,
		});
		headerEl.createDiv({
			cls: "friday-agent-task-status",
			text: taskView.statusLabel,
		});
		panelEl.createDiv({
			cls: "friday-agent-task-summary",
			text: taskView.summary,
		});
		if (task.waitingForApproval) {
			panelEl.createDiv({
				cls: "friday-agent-task-waiting",
				text: taskView.waitingText || "等待你确认后继续。",
			});
		}
		if (task.waitingForUser) {
			panelEl.createDiv({
				cls: "friday-agent-task-waiting",
				text: taskView.waitingText || "等待你的补充。",
			});
		}
		if (task.pendingMutationCount > 0) {
			panelEl.createDiv({
				cls: "friday-agent-task-mutations",
				text: taskView.mutationText,
			});
		}
		const actionsEl = panelEl.createDiv({ cls: "friday-agent-task-actions" });
		for (const action of task.availableActions) {
			const button = actionsEl.createEl("button", {
				cls: `friday-agent-task-action is-${action}`,
				text: this.formatAgentTaskAction(action),
			});
			button.type = "button";
			if (action === "resume") {
				button.onclick = () => void taskActions.resume();
			} else if (action === "retry") {
				button.onclick = () => void taskActions.retry();
			} else if (action === "cancel") {
				button.onclick = () => void taskActions.cancel();
			} else if (action === "continue") {
				button.onclick = () => void taskActions.continue();
			} else if (action === "apply") {
				button.onclick = () => {
					const planId = task.waitingForApproval?.mutationPlanIds?.[0];
					void taskActions.apply(planId);
				};
			} else if (action === "reject") {
				button.onclick = () => {
					const planId = task.waitingForApproval?.mutationPlanIds?.[0];
					void taskActions.reject(planId);
				};
			}
		}
	}

	private renderApprovalMessage(containerEl: HTMLElement, item: PendingApproval): void {
		const rowEl = containerEl.createDiv({ cls: "friday-ai-approval-record kit-event-row-v1" });
		rowEl.createSpan({
			cls: "friday-ai-approval-record-summary",
			text: this.t("approval.chatSummary", "FRIDAY 正在等待你在输入区确认是否继续。"),
		});
		rowEl.createSpan({
			cls: "friday-ai-approval-record-detail",
			text: this.describeApprovalRequest(item),
		});
	}

	private renderRuntimeExecutionPreview(containerEl: HTMLElement): void {
		if (!this.aiRuntimeTrajectorySnapshot) {
			return;
		}
		this.renderTrajectoryCard(containerEl, this.aiRuntimeTrajectorySnapshot, "live");
	}

	private renderTrajectoryCard(
		containerEl: HTMLElement,
		snapshot: AgentTrajectorySnapshot,
		variant: "live" | "completed",
		forcedExpanded?: boolean,
	): void {
		renderAgentTrajectoryCard({
			containerEl,
			snapshot,
			variant,
			expanded: forcedExpanded ?? this.isProcessExpanded(snapshot),
			onToggle: () => this.toggleProcessExpanded(snapshot),
			onAction: (action) => this.handleTrajectoryAction(snapshot, action),
			translate: (key, fallback, params) => this.t(key, fallback, params),
			renderAssistantAvatar: (metaEl) => this.renderAssistantAvatar(metaEl),
			renderIcon: (iconEl, icon) => setIcon(iconEl, icon),
		});
	}

	private handleTrajectoryAction(
		snapshot: AgentTrajectorySnapshot,
		action: AgentTrajectoryAction,
	): void {
		if (!action.enabled || !this.isSnapshotOwnedByCurrentSession(snapshot)) {
			return;
		}
		if (action.id === "view_replay") {
			const key = this.getTrajectorySnapshotKey(snapshot);
			if (key) {
				this.aiProcessExpandedKeys.add(key);
			}
			this.renderBoard();
			return;
		}
		if (action.id === "view_changes") {
			this.renderBoard();
			return;
		}
		const taskId = snapshot.identity.taskId;
		if (!taskId || !this.hasCurrentSessionTask(taskId)) {
			return;
		}
		const taskActions = this.createAgentTaskPanelActionHandlers(taskId);
		if (action.id === "resume") {
			void taskActions.resume();
		} else if (action.id === "retry") {
			void taskActions.retry();
		} else if (action.id === "cancel") {
			void taskActions.cancel();
		} else if (action.id === "continue") {
			void taskActions.continue();
		} else if (action.id === "apply") {
			void taskActions.apply(action.targetId);
		} else if (action.id === "reject") {
			void taskActions.reject(action.targetId);
		}
	}

	private async buildCompletedTrajectorySnapshot(
		result: RuntimeTurnResult,
		targetConversationId = this.aiSessionId,
	): Promise<AgentTrajectorySnapshot | null> {
		const resultIdentity = result as RuntimeTurnResult & {
			conversationId?: string;
			taskId?: string;
			traceId?: string;
			agentId?: string;
		};
		const normalizedTargetConversationId = targetConversationId.trim();
		if (!normalizedTargetConversationId) {
			return null;
		}
		const resultConversationId = resultIdentity.conversationId?.trim();
		if (resultConversationId && resultConversationId !== normalizedTargetConversationId) {
			return null;
		}
		const turnId = resultIdentity.turnId?.trim();
		if (!turnId) {
			const completedSnapshot = this.aiRuntimeTrajectoryStore.getCompletedSnapshot();
			return this.isSnapshotOwnedBySession(completedSnapshot, normalizedTargetConversationId) ? completedSnapshot : null;
		}
		const conversationId = resultConversationId || normalizedTargetConversationId;
		try {
			const summary = await this.plugin.agentRuntimeService.readTurnReplaySummary({
				conversationId,
				turnId,
				taskId: resultIdentity.taskId ?? result.task?.id,
			});
			if (summary.totalEvents > 0) {
				const replaySnapshot = projectReplaySummary(summary);
				return this.isSnapshotOwnedBySession(replaySnapshot, normalizedTargetConversationId) ? replaySnapshot : null;
			}
		} catch (error) {
			console.warn("[Friday] Failed to rebuild trajectory replay summary:", error);
		}
		const completedSnapshot = this.aiRuntimeTrajectoryStore.getCompletedSnapshot();
		return this.isSnapshotOwnedBySession(completedSnapshot, normalizedTargetConversationId) ? completedSnapshot : null;
	}

	private buildAssistantMessageUiMeta(
		result: RuntimeTurnResult,
		task?: AgentTask,
		targetConversationId = this.aiSessionId,
		activeSoulDefinition?: SoulDefinition | null,
	): ChatMessageUiMeta | undefined {
		const resultIdentity = result as RuntimeTurnResult & {
			conversationId?: string;
			taskId?: string;
		};
		const conversationId = resultIdentity.conversationId?.trim() || task?.conversationId?.trim() || targetConversationId.trim();
		const turnId = resultIdentity.turnId?.trim() || task?.turnId?.trim() || "";
		const taskId = resultIdentity.taskId?.trim() || task?.id?.trim() || result.task?.id?.trim() || "";
		const soulStyleSnapshot = this.resolveAssistantSoulStyleSnapshot(activeSoulDefinition);
		if (!conversationId && !turnId && !taskId && !soulStyleSnapshot) {
			return undefined;
		}
		return {
			...(conversationId ? { conversationId } : {}),
			...(turnId ? { turnId } : {}),
			...(taskId ? { taskId } : {}),
			...(soulStyleSnapshot ?? {}),
		};
	}

	private async submitAiPrompt(snapshotOverride?: MentionComposerSnapshot): Promise<void> {
		const draftSnapshot = snapshotOverride ? this.cloneComposerSnapshot(snapshotOverride) : this.getComposerSnapshot();
		const draftDocument = getStructuredPromptDocument(draftSnapshot);
		const rawPrompt = draftDocument.text.trim();
		if (isPromptDocumentEmpty(draftDocument)) {
			return;
		}
		if (this.aiBusy) {
			if (!snapshotOverride) {
				this.enqueueAiPrompt(draftSnapshot);
			}
			return;
		}

		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul) {
			new Notice(this.plugin.t("ai.error.noAgent"), 4000);
			return;
		}
		const activeSoulDefinition = this.plugin.soulStore.getSoulSync(activeSoul.id);
		if (!this.plugin.aiService.isConfigured()) {
			const message = this.plugin.t("ai.error.notConfigured");
			this.aiLastError = message;
			new Notice(message, 5000);
			this.plugin.openSettingsTab();
			this.renderBoard();
			return;
		}
		if (!this.aiSessionId.trim()) {
			this.aiSessionId = this.plugin.conversationService.createSessionId();
		}
		const turnActiveProject = this.getActiveProjectEntry();

		this.aiLocalIntakePreview = this.buildLocalIntakePreview(rawPrompt);
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiForceScrollToBottomOnce = true;
		this.syncAiLiveChatShell();

		const activeFilePath = this.app.workspace.getActiveFile()?.path ?? "";
		const activeFileContext = createActiveFileContext(draftDocument, rawPrompt, activeFilePath);
		const mentionResolution = await this.mentionResolver.resolve({
			document: draftDocument,
			currentFilePath: activeFileContext.mode === "explicit_mention" ? activeFileContext.path : "",
			activeProjectRoot: turnActiveProject?.boundaryPath ?? "",
			readFile: async (pathValue) => {
				const file = this.app.vault.getAbstractFileByPath(pathValue);
				if (!(file instanceof TFile)) {
					return null;
				}
				return this.app.vault.cachedRead(file);
			},
			listFolderEntries: async (pathValue) => {
				const folder = this.app.vault.getAbstractFileByPath(pathValue);
				if (!(folder instanceof TFolder)) {
					return [];
				}
				return folder.children
					.filter((child): child is TFile => child instanceof TFile)
					.map((child) => child.path);
			},
		});
		const effectiveModel = this.resolveEffectiveModel(activeSoulDefinition);
		const resolution = this.buildInvocationResolver().resolveChatPrompt(rawPrompt);
		if (resolution.type === "invalid") {
			this.aiLocalIntakePreview = "";
			this.aiLastError = resolution.error;
			this.syncAiLiveChatShell();
			return;
		}
		const ingress = createConversationIngressPayload({
			sessionId: this.aiSessionId,
			history: this.aiConversation,
			snapshot: draftSnapshot,
			activeProject: turnActiveProject,
			currentFilePath: activeFilePath,
			mentionResolution,
			selectedModel: effectiveModel,
			selectedPermissionMode: this.plugin.settings.agentRuntime.toolPermissionMode,
			userFacingPromptFallback: this.t("ai.prompt.useMentions", "请基于已引用内容继续处理。"),
		});
		if (!ingress.ok) {
			this.aiLocalIntakePreview = "";
			this.aiLastError = ingress.message ?? "";
			this.syncAiLiveChatShell();
			return;
		}

		const turnTarget: AiTurnTarget = ingress.turnTarget;
		const promptMentionContext = ingress.runtimePayload.mentionContext;
		const history = [...turnTarget.conversation];
		turnTarget.conversation.push({
			role: "user",
			content: ingress.userFacingPrompt,
			uiMeta: this.buildUserMessageUiMeta({
				snapshot: draftSnapshot,
				mentionResolution,
				resolution,
			}),
		});
		if (this.isCurrentAiTurnTarget(turnTarget) && this.aiConversation !== turnTarget.conversation) {
			this.aiConversation = turnTarget.conversation;
		}
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.composer?.replaceSnapshot(this.aiComposerSnapshot);
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiRuntimeTrajectoryStore.reset();
		this.aiRuntimeTrajectorySnapshot = null;
		this.aiRuntimeSawIntake = false;
		this.aiRuntimeModelRequestStarted = false;
		this.clearRuntimeElapsedTimer();
		this.resetProcessTypewriterState();
		this.aiRuntimeProgressTaskIds.clear();
		this.aiBusy = true;
		this.aiActiveTurnTarget = turnTarget;
		this.aiBackgroundTurnTarget = null;
		this.aiBackgroundTurnFailure = null;
		this.aiSendAbortController?.abort();
		const runAbortController = new AbortController();
		this.aiSendAbortController = runAbortController;
		this.syncAiSendButtonState();
		this.aiForceScrollToBottomOnce = true;
		if (this.isCurrentAiTurnTarget(turnTarget)) {
			this.syncAiLiveChatShell();
		} else {
			this.syncBackgroundAgentStatus();
		}

		try {
			let modelOverride = ingress.runtimePayload.modelOverride;
			let allowedTools: string[] | undefined;
			let allowedModels: string[] | undefined;
			let assistantText = "";
			let runtimeTask: AgentTask | undefined;
			let runtimeResult: RuntimeTurnResult | null = null;
			let shouldStreamFinalText = false;
			if (resolution.type === "catalog") {
				const skills = await this.plugin.skillCommandService.listSkills();
				assistantText = this.buildSkillCatalogReply(skills);
				shouldStreamFinalText = true;
			} else {
				const decision = await this.plugin.executionPlanner.plan(resolution, { activeFileContext });
				allowedTools = decision.allowedTools?.length ? decision.allowedTools : undefined;
				allowedModels = decision.allowedModels?.length ? decision.allowedModels : undefined;
				if (!assistantText) {
					runtimeResult = await this.plugin.executionOrchestrator.execute(decision, {
						agentId: activeSoul.id,
						conversationId: turnTarget.sessionId,
						conversation: history,
						modelOverride,
						activeFileContext,
						mentionContext: promptMentionContext,
						allowedTools,
						onProgress: (event) => {
							if (this.isCurrentAiTurnTarget(turnTarget)) {
								this.handleRuntimeProgress(event);
							} else {
								this.syncBackgroundAgentStatus();
							}
						},
						signal: runAbortController.signal,
					});
					this.recordAgentTask(runtimeResult.task);
					runtimeTask = runtimeResult.task;
					assistantText = this.buildRuntimeReply(runtimeResult);
					shouldStreamFinalText = true;
				}
			}

			if (modelOverride && allowedModels && allowedModels.length > 0 && !allowedModels.includes(modelOverride.trim())) {
				throw new Error(this.t("ai.error.modelBlocked", "Current model is not allowed for this slash command."));
			}

			const normalizedAssistantText = assistantText.trim() || this.t("ai.runtime.emptyResponse", "(No valid model response)");
			const completedSnapshot = runtimeResult
				? await this.buildCompletedTrajectorySnapshot(runtimeResult, turnTarget.sessionId)
				: null;
			this.rememberCompletedTrajectorySnapshotForSession(completedSnapshot, turnTarget.sessionId, turnTarget.projectId);
			if (shouldStreamFinalText && this.isCurrentAiTurnTarget(turnTarget)) {
				this.aiStreamingTrajectorySnapshot = completedSnapshot;
				await this.streamAssistantText(normalizedAssistantText);
			}
			const assistantUiMeta = runtimeResult
				? this.buildAssistantMessageUiMeta(runtimeResult, runtimeTask, turnTarget.sessionId, activeSoulDefinition)
				: undefined;

			this.aiLocalIntakePreview = "";
			this.detachCurrentConversationFromBackgroundTurn(turnTarget);
			turnTarget.conversation.push({
				role: "assistant",
				content: normalizedAssistantText,
				...(assistantUiMeta ? { uiMeta: assistantUiMeta } : {}),
			});
			this.aiBackgroundTurnTarget = turnTarget;
			if (this.isCurrentAiTurnTarget(turnTarget) && this.aiConversation !== turnTarget.conversation) {
				this.aiConversation = turnTarget.conversation;
			}
			await this.persistConversation({
				sessionId: turnTarget.sessionId,
				projectId: turnTarget.projectId,
				messages: turnTarget.conversation,
			});
		} catch (error) {
			const isCurrentTarget = this.isCurrentAiTurnTarget(turnTarget);
			let failureMessage = "";
			if (error instanceof DOMException && error.name === "AbortError") {
				failureMessage = this.t("ai.action.cancelled", "Action cancelled.");
			} else {
				const message = error instanceof Error ? error.message : String(error ?? "");
				failureMessage = this.toUserFacingAiFailureMessage(message);
				new Notice(
					this.t("ai.notice.chatFailed", "FRIDAY chat failed: {error}", { error: failureMessage }),
					7000,
				);
			}
			if (isCurrentTarget) {
				this.aiLastError = failureMessage;
			} else {
				this.aiBackgroundTurnFailure = { target: turnTarget, message: failureMessage };
			}
			this.aiBackgroundTurnTarget = turnTarget;
		} finally {
			this.aiBusy = false;
			this.aiActiveTurnTarget = null;
			this.aiLocalIntakePreview = "";
			this.aiStreamingPreview = "";
			this.aiStreamingTrajectorySnapshot = null;
			this.aiRuntimeTrajectorySnapshot = null;
			this.aiRuntimeModelRequestStarted = false;
			this.clearRuntimeElapsedTimer();
			this.aiSendAbortController = null;
			this.aiRuntimeLastRenderAt = 0;
			this.aiForceScrollToBottomOnce = true;
			if (this.isCurrentAiTurnTarget(turnTarget)) {
				this.syncAiRuntimeShell();
			} else {
				this.syncBackgroundAgentStatus();
			}
			await this.flushQueuedAiPrompt();
		}
	}

	private toUserFacingAiFailureMessage(message: string): string {
		const raw = message.trim();
		if (!this.aiRuntimeSawIntake && this.isBeforeIntakeConnectionFailure(raw)) {
			return this.t("ai.intake.preview.modelExhaustedBeforeIntake", "暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。");
		}
		return productizeRuntimeText(raw) || raw || this.t("common.unknownError", "Unknown error");
	}

	private isBeforeIntakeConnectionFailure(message: string): boolean {
		return /Request failed|status\s+\d+|模型服务|网关|request_exhausted|transport|ERR_CONNECTION_CLOSED|ERR_HTTP2_PROTOCOL_ERROR|HTTP2_PROTOCOL/i.test(message);
	}

	private detachCurrentConversationFromBackgroundTurn(target: AiTurnTarget): void {
		if (this.isCurrentAiTurnTarget(target) || this.aiConversation !== target.conversation) {
			return;
		}
		this.aiConversation = [...this.aiConversation];
	}

	private async compileWikiByButton(): Promise<void> {
		if (this.aiBusy) {
			return;
		}
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul) {
			new Notice(this.plugin.t("ai.error.noAgent"), 4000);
			return;
		}
		const activeSoulDefinition = this.plugin.soulStore.getSoulSync(activeSoul.id);
		if (!this.plugin.aiService.isConfigured()) {
			const message = this.plugin.t("ai.error.notConfigured");
			this.aiLastError = message;
			new Notice(message, 5000);
			this.plugin.openSettingsTab();
			this.renderBoard();
			return;
		}
		this.aiBusy = true;
		this.aiLastError = "";
		this.aiLocalIntakePreview = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiRuntimeTrajectoryStore.reset();
		this.aiRuntimeTrajectorySnapshot = null;
		this.aiRuntimeSawIntake = false;
		this.aiRuntimeModelRequestStarted = false;
		this.clearRuntimeElapsedTimer();
		this.resetProcessTypewriterState();
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			const resolution = this.plugin.executionEventRouter.routeToRuntime({
				type: "knowledge.compile_requested",
				source: "project_action",
				projectId: this.getActiveProjectEntry()?.projectId,
				prompt: "Compile the active project wiki now.",
			});
			if (resolution.type !== "runtime") {
				throw new Error("Compile button could not be resolved to a runtime invocation.");
			}
			const decision = await this.plugin.executionPlanner.plan(resolution);
			const runtimeResult = await this.plugin.executionOrchestrator.execute(decision, {
				agentId: activeSoul.id,
				conversationId: this.aiSessionId,
				conversation: [],
				onProgress: (event) => {
					this.handleRuntimeProgress(event);
				},
			});
			const reply = this.buildRuntimeReply(runtimeResult);
			await this.streamAssistantText(reply);
			const completedSnapshot = await this.buildCompletedTrajectorySnapshot(runtimeResult);
			this.rememberCompletedTrajectorySnapshot(completedSnapshot);
			const assistantUiMeta = this.buildAssistantMessageUiMeta(runtimeResult, runtimeResult.task, this.aiSessionId, activeSoulDefinition);
			this.aiConversation.push({
				role: "assistant",
				content: reply,
				...(assistantUiMeta ? { uiMeta: assistantUiMeta } : {}),
			});
			try {
				await this.persistConversation();
			} catch (error) {
				console.error("[Friday] Failed to persist conversation after wiki compile:", error);
				new Notice(
					this.t("ai.notice.sessionSaveFailed", "对话记录保存失败：{error}", {
						error: error instanceof Error ? error.message : String(error ?? ""),
					}),
					5000,
				);
			}
			new Notice(this.t("ai.notice.compileWikiDone", "Wiki 编译已完成"), 3000);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.aiLastError = message.trim() || this.t("common.unknownError", "Unknown error");
			new Notice(
				this.t("ai.notice.compileWikiFailed", "Wiki 编译失败：{error}", { error: this.aiLastError }),
				7000,
			);
		} finally {
			this.aiBusy = false;
			this.aiLocalIntakePreview = "";
			this.aiStreamingPreview = "";
			this.aiStreamingTrajectorySnapshot = null;
			this.aiRuntimeTrajectorySnapshot = null;
			this.aiRuntimeModelRequestStarted = false;
			this.aiRuntimeLastRenderAt = 0;
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
			await this.flushQueuedAiPrompt();
		}
	}

	private async compileWikiWithStatus(): Promise<RuntimeWikiCompileSummary> {
		this.handleRuntimeProgress({
			phase: "tool_call",
			depth: 0,
			step: 1,
			tool: "compile_wiki",
			targetPath: "raw",
			message: this.t("ai.runtime.progress.compileStart", "FRIDAY 正在编译 Wiki…（{step}）", { step: "1" }),
		});
		const summary = await this.plugin.compileWikiForActiveProject();
		this.handleRuntimeProgress({
			phase: "tool_result",
			depth: 0,
			step: 1,
			tool: "compile_wiki",
			targetPath: summary.projectRoot,
			status: "ok",
			summary: this.t("ai.compile.summary.header", "Wiki 编译完成"),
			message: this.t("ai.runtime.progress.compileDone", "FRIDAY 已完成 Wiki 编译（{step}）", { step: "1" }),
		});
		return summary;
	}

	private formatWikiCompileResult(summary: RuntimeWikiCompileSummary, includeHint: boolean): string {
		const parts: string[] = [
			this.t("ai.compile.summary.header", "Wiki 编译完成"),
			"",
			this.t("ai.compile.summary.project", "项目：{project}", { project: summary.projectId }),
			this.t("ai.compile.summary.requested", "请求文件：{value}", { value: summary.requested }),
			this.t("ai.compile.summary.processed", "实际处理：{value}", { value: summary.processed }),
			this.t("ai.compile.summary.succeeded", "成功：{value}", { value: summary.succeeded }),
			this.t("ai.compile.summary.failed", "失败：{value}", { value: summary.failed }),
		];
		const updatedDocs = summary.updatedDocs?.length ?? 0;
		parts.push(this.t("ai.compile.summary.docs", "更新知识页：{value}", { value: updatedDocs }));
		parts.push(
			this.t("ai.compile.summary.index", "索引文件：{value}", {
				value: summary.updatedIndex || this.t("ai.compile.summary.none", "未更新"),
			}),
		);
		parts.push(
			this.t("ai.compile.summary.log", "日志文件：{value}", {
				value: summary.updatedLog || this.t("ai.compile.summary.none", "未更新"),
			}),
		);

		if (updatedDocs > 0) {
			parts.push("");
			parts.push(this.t("ai.compile.summary.docsTitle", "本次更新知识页："));
			for (const pathValue of summary.updatedDocs.slice(0, 8)) {
				parts.push(`- ${pathValue}`);
			}
			if (summary.updatedDocs.length > 8) {
				parts.push(this.t("ai.compile.summary.more", "- 其余 {count} 个已省略", { count: summary.updatedDocs.length - 8 }));
			}
		}

		if (includeHint) {
			parts.push("");
			parts.push(this.t("ai.compile.summary.hint", "如需重建全部索引，可直接输入“编译 wiki”。"));
		}
		return parts.join("\n");
	}

	private buildInvocationResolver(): InvocationResolver {
		return new InvocationResolver({
			parseSkillSlashCommand: (rawPrompt) => this.plugin.skillCommandService.parseSlashCommand(rawPrompt),
			expandSlashCommand: (rawPrompt) => this.plugin.slashCommandService.expand(rawPrompt),
		});
	}

	private buildLocalIntakePreview(rawPrompt: string): string {
		void rawPrompt;
		return "";
	}

	private async streamAssistantText(text: string): Promise<void> {
		if (!text) {
			return;
		}
		this.aiLocalIntakePreview = "";
		this.aiRuntimeTrajectorySnapshot = null;
		const chunkSize = Math.max(8, Math.min(48, Math.ceil(text.length / 80)));
		const delay = 18;
		this.aiStreamingPreview = "";
		for (let index = 0; index < text.length; index += chunkSize) {
			this.aiStreamingPreview = text.slice(0, Math.min(text.length, index + chunkSize));
			const now = Date.now();
			if (now - this.aiRuntimeLastRenderAt >= 50) {
				this.aiRuntimeLastRenderAt = now;
				this.aiForceScrollToBottomOnce = true;
				if (!this.syncAiStreamingPreviewContent()) {
					this.syncAiLiveChatShell();
				}
			}
			// Yield to UI thread to present progressive text updates.
			await this.sleep(delay);
		}
		this.aiForceScrollToBottomOnce = true;
		if (!this.syncAiStreamingPreviewContent()) {
			this.syncAiLiveChatShell();
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	private syncAiStreamingPreviewContent(): boolean {
		if (this.activePage !== "chat" || !this.aiMessageListEl?.isConnected) {
			return false;
		}
		const contentEl = this.aiMessageListEl.querySelector(".friday-ai-answer-content.is-streaming");
		if (!(contentEl instanceof HTMLElement)) {
			return false;
		}
		this.captureAiMessageListScrollState(this.aiMessageListEl);
		contentEl.empty();
		this.renderAiMessageContent(contentEl, {
			role: "assistant",
			content: this.aiStreamingPreview,
		});
		this.restoreAiMessageListScrollState(this.aiMessageListEl);
		return true;
	}

	private syncElementFromTemplate(targetEl: Element, templateEl: Element): void {
		for (const name of targetEl.getAttributeNames()) {
			if (!templateEl.hasAttribute(name)) {
				targetEl.removeAttribute(name);
			}
		}
		for (const name of templateEl.getAttributeNames()) {
			const value = templateEl.getAttribute(name);
			if (value !== null) {
				targetEl.setAttribute(name, value);
			}
		}
		this.syncChildNodesFromTemplate(targetEl, templateEl);
	}

	private syncChildNodesFromTemplate(targetEl: Element, templateEl: Element): void {
		const templateNodes = Array.from(templateEl.childNodes);
		for (const [index, templateNode] of templateNodes.entries()) {
			const targetNode = targetEl.childNodes.item(index);
			if (!targetNode) {
				targetEl.appendChild(templateNode);
				continue;
			}
			if (!this.canSyncNodeFromTemplate(targetNode, templateNode)) {
				targetNode.replaceWith(templateNode);
				continue;
			}
			if (targetNode.nodeType === Node.TEXT_NODE && templateNode.nodeType === Node.TEXT_NODE) {
				if (targetNode.nodeValue !== templateNode.nodeValue) {
					targetNode.nodeValue = templateNode.nodeValue;
				}
				continue;
			}
			if (targetNode instanceof Element && templateNode instanceof Element) {
				if (this.shouldReplaceElementFromTemplate(targetNode, templateNode)) {
					targetNode.replaceWith(templateNode);
					continue;
				}
				this.syncElementFromTemplate(targetNode, templateNode);
			}
		}
		while (targetEl.childNodes.length > templateNodes.length) {
			targetEl.lastChild?.remove();
		}
	}

	private canSyncNodeFromTemplate(targetNode: Node, templateNode: Node): boolean {
		if (targetNode.nodeType !== templateNode.nodeType) {
			return false;
		}
		if (targetNode instanceof Element && templateNode instanceof Element) {
			return targetNode.tagName === templateNode.tagName &&
				targetNode.namespaceURI === templateNode.namespaceURI;
		}
		return targetNode.nodeType === Node.TEXT_NODE || targetNode.nodeType === Node.COMMENT_NODE;
	}

	private shouldReplaceElementFromTemplate(targetEl: Element, templateEl: Element): boolean {
		const interactiveTags = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]);
		return interactiveTags.has(targetEl.tagName) || interactiveTags.has(templateEl.tagName);
	}

	private isProcessElementExpanded(processEl: Element | null): boolean {
		if (!this.isDomElement(processEl)) {
			return false;
		}
		return processEl.getAttribute("data-expanded") === "true" ||
			processEl.classList.contains("is-expanded") ||
			Boolean(processEl.querySelector('[data-expanded="true"], .is-expanded'));
	}

	private isDomElement(value: unknown): value is Element {
		const candidate = value as Partial<Element> | null;
		return candidate !== null &&
			candidate !== undefined &&
			typeof candidate.getAttribute === "function" &&
			typeof candidate.setAttribute === "function" &&
			typeof candidate.hasAttribute === "function" &&
			typeof candidate.removeAttribute === "function";
	}

	private findCurrentLiveProcessElement(): HTMLElement | null {
		if (!this.aiMessageListEl?.isConnected || typeof this.aiMessageListEl.querySelector !== "function") {
			return null;
		}
		const processEl = this.aiMessageListEl.querySelector(".friday-ai-message-row.is-assistant.is-live") ??
			this.aiMessageListEl.querySelector(".assistant-turn-body-v2.is-live");
		return this.isDomElement(processEl) ? processEl as HTMLElement : null;
	}

	private captureCurrentLiveProcessDisclosureState(): Map<string, boolean> {
		return this.captureProcessDisclosureState(this.findCurrentLiveProcessElement());
	}

	private applyCurrentLiveProcessDisclosureState(disclosureState: Map<string, boolean>): void {
		this.applyProcessDisclosureState(this.findCurrentLiveProcessElement(), disclosureState);
	}

	private captureProcessDisclosureState(rootEl: ParentNode | null): Map<string, boolean> {
		const result = new Map<string, boolean>();
		if (!rootEl || typeof rootEl.querySelectorAll !== "function") {
			return result;
		}
		const details = Array.from(rootEl.querySelectorAll("details[data-process-disclosure-key]"));
		for (const detailEl of details) {
			if (!this.isDomElement(detailEl)) {
				continue;
			}
			const key = detailEl.getAttribute("data-process-disclosure-key")?.trim() || "";
			if (!key) {
				continue;
			}
			result.set(key, detailEl.hasAttribute("open"));
		}
		const steps = Array.from(rootEl.querySelectorAll(".assistant-process-step-v6[data-item-id]"));
		for (const stepEl of steps) {
			if (!this.isDomElement(stepEl)) {
				continue;
			}
			const key = stepEl.getAttribute("data-item-id")?.trim() || "";
			if (!key) {
				continue;
			}
			const buttonEl = stepEl.querySelector(".assistant-step-toggle-v6");
			const detailEl = stepEl.querySelector(".assistant-step-detail-v6");
			const expanded = (this.isDomElement(buttonEl) && buttonEl.getAttribute("aria-expanded") === "true") ||
				stepEl.classList.contains("is-open") ||
				(this.isDomElement(detailEl) && detailEl.getAttribute("aria-hidden") === "false");
			result.set(`native-step:${key}`, expanded);
		}
		return result;
	}

	private applyProcessDisclosureState(rootEl: ParentNode | null, disclosureState: Map<string, boolean>): void {
		if (!rootEl || disclosureState.size === 0 || typeof rootEl.querySelectorAll !== "function") {
			return;
		}
		const details = Array.from(rootEl.querySelectorAll("details[data-process-disclosure-key]"));
		for (const detailEl of details) {
			if (!this.isDomElement(detailEl)) {
				continue;
			}
			const key = detailEl.getAttribute("data-process-disclosure-key")?.trim() || "";
			if (!key || !disclosureState.has(key)) {
				continue;
			}
			const expanded = disclosureState.get(key) === true;
			if (expanded) {
				detailEl.setAttribute("open", "true");
			} else {
				detailEl.removeAttribute("open");
			}
			if (typeof HTMLDetailsElement !== "undefined" && detailEl instanceof HTMLDetailsElement) {
				detailEl.open = expanded;
			}
		}
		const steps = Array.from(rootEl.querySelectorAll(".assistant-process-step-v6[data-item-id]"));
		for (const stepEl of steps) {
			if (!this.isDomElement(stepEl)) {
				continue;
			}
			const key = stepEl.getAttribute("data-item-id")?.trim() || "";
			if (!key || !disclosureState.has(`native-step:${key}`)) {
				continue;
			}
			const expanded = disclosureState.get(`native-step:${key}`) === true;
			if (expanded) {
				stepEl.classList.add("is-open");
			} else {
				stepEl.classList.remove("is-open");
			}
			const buttonEl = stepEl.querySelector(".assistant-step-toggle-v6");
			if (this.isDomElement(buttonEl)) {
				buttonEl.setAttribute("aria-expanded", String(expanded));
			}
			const detailEl = stepEl.querySelector(".assistant-step-detail-v6");
			if (this.isDomElement(detailEl)) {
				detailEl.setAttribute("aria-hidden", expanded ? "false" : "true");
			}
		}
	}

	private syncLiveProcessTypewriter(rootEl: ParentNode | null = this.aiMessageListEl): void {
		const processEl = this.findLiveProcessTypewriterRoot(rootEl);
		if (!processEl) {
			return;
		}
		const seenKeys = this.ensureProcessTypewriterSeenKeys();
		const textEls = Array.from(processEl.querySelectorAll<HTMLElement>("[data-process-typewriter-key]"));
		if (textEls.length === 0) {
			return;
		}
		const prefersReducedMotion = typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (this.aiSkipNextProcessTypewriter || prefersReducedMotion) {
			this.markLiveProcessTypewriterTextSeen(textEls);
			this.aiSkipNextProcessTypewriter = false;
			return;
		}
		for (const textEl of textEls) {
			const key = textEl.getAttribute("data-process-typewriter-key")?.trim() || "";
			const text = textEl.getAttribute("data-process-typewriter-text") ?? textEl.textContent ?? "";
			if (!key || !text) {
				continue;
			}
			if (seenKeys.has(key)) {
				this.clearProcessTypewriterTimer(key);
				textEl.removeClass("is-typewriting");
				if (textEl.textContent !== text) {
					textEl.setText(text);
				}
				continue;
			}
			seenKeys.add(key);
			this.startProcessTypewriter(textEl, key, text);
		}
	}

	private markLiveProcessTypewriterTextSeen(textEls: HTMLElement[]): void {
		const seenKeys = this.ensureProcessTypewriterSeenKeys();
		for (const textEl of textEls) {
			const key = textEl.getAttribute("data-process-typewriter-key")?.trim() || "";
			const text = textEl.getAttribute("data-process-typewriter-text") ?? textEl.textContent ?? "";
			if (!key) {
				continue;
			}
			this.clearProcessTypewriterTimer(key);
			textEl.removeClass("is-typewriting");
			seenKeys.add(key);
			if (textEl.textContent !== text) {
				textEl.setText(text);
			}
		}
	}

	private findLiveProcessTypewriterRoot(rootEl: ParentNode | null): HTMLElement | null {
		if (!rootEl) {
			return null;
		}
		const candidate = rootEl as ParentNode & {
			matches?: (selector: string) => boolean;
		};
		if (typeof candidate.matches === "function" && candidate.matches(".friday-ai-message-row.is-assistant.is-live, .assistant-turn-body-v2.is-live")) {
			return rootEl as HTMLElement;
		}
		if (typeof rootEl.querySelector !== "function") {
			return null;
		}
		const processEl = rootEl.querySelector(".friday-ai-message-row.is-assistant.is-live") ??
			rootEl.querySelector(".assistant-turn-body-v2.is-live");
		return processEl ? processEl as HTMLElement : null;
	}

	private startProcessTypewriter(textEl: HTMLElement, key: string, text: string): void {
		const timers = this.ensureProcessTypewriterTimers();
		this.clearProcessTypewriterTimer(key);
		const chunkSize = Math.max(2, Math.min(12, Math.ceil(text.length / 28)));
		let index = 0;
		textEl.addClass("is-typewriting");
		textEl.setText("");
		const tick = () => {
			if (!textEl.isConnected) {
				this.clearProcessTypewriterTimer(key);
				return;
			}
			index = Math.min(text.length, index + chunkSize);
			textEl.setText(text.slice(0, index));
			if (index >= text.length) {
				textEl.removeClass("is-typewriting");
				timers.delete(key);
				return;
			}
			const timer = window.setTimeout(tick, 18);
			timers.set(key, timer);
		};
		tick();
	}

	private clearProcessTypewriterTimer(key: string): void {
		const timers = this.ensureProcessTypewriterTimers();
		const timer = timers.get(key);
		if (timer != null) {
			window.clearTimeout(timer);
			timers.delete(key);
		}
	}

	private clearProcessTypewriterTimers(): void {
		const timers = this.ensureProcessTypewriterTimers();
		for (const timer of timers.values()) {
			window.clearTimeout(timer);
		}
		timers.clear();
	}

	private resetProcessTypewriterState(): void {
		this.clearProcessTypewriterTimers();
		this.ensureProcessTypewriterSeenKeys().clear();
		this.aiSkipNextProcessTypewriter = false;
	}

	private ensureProcessTypewriterSeenKeys(): Set<string> {
		if (!this.aiProcessTypewriterSeenKeys) {
			this.aiProcessTypewriterSeenKeys = new Set<string>();
		}
		return this.aiProcessTypewriterSeenKeys;
	}

	private ensureProcessTypewriterTimers(): Map<string, number> {
		if (!this.aiProcessTypewriterTimers) {
			this.aiProcessTypewriterTimers = new Map<string, number>();
		}
		return this.aiProcessTypewriterTimers;
	}

	private syncLiveRuntimeProgressProcess(): boolean {
		if (this.activePage !== "chat") {
			this.syncBackgroundAgentStatus();
			return true;
		}
		if (!this.aiMessageListEl?.isConnected || !this.aiRuntimeTrajectorySnapshot) {
			return false;
		}
		const processEl = this.findCurrentLiveProcessElement();
		if (!(processEl instanceof HTMLElement)) {
			return false;
		}
		const preserveExpanded = this.isProcessElementExpanded(processEl);
		if (preserveExpanded) {
			this.rememberProcessExpandedState(this.aiRuntimeTrajectorySnapshot, true);
		}
		const disclosureState = this.captureProcessDisclosureState(processEl);
		const scratchEl = document.createElement("div");
		this.renderTrajectoryCard(scratchEl, this.aiRuntimeTrajectorySnapshot, "live", preserveExpanded ? true : undefined);
		const nextProcessEl = scratchEl.querySelector(".friday-ai-message-row.is-assistant.is-live") ??
			scratchEl.querySelector(".assistant-turn-body-v2.is-live");
		if (!(nextProcessEl instanceof HTMLElement)) {
			return false;
		}
		this.applyProcessDisclosureState(nextProcessEl, disclosureState);
		this.syncElementFromTemplate(processEl, nextProcessEl);
		this.syncLiveProcessTypewriter(processEl);
		this.syncAiErrorRegion();
		this.syncAiQueueHint();
		this.syncComposerDecisionPanel();
		this.syncAiComposerControls();
		this.syncComposerTaskBar();
		return true;
	}

	private syncLiveRuntimeElapsedProcess(): void {
		if (this.activePage !== "chat") {
			this.syncBackgroundAgentStatus();
			return;
		}
		if (!this.aiMessageListEl?.isConnected || !this.aiRuntimeTrajectorySnapshot) {
			return;
		}
		if (!this.syncLiveRuntimeProgressProcess()) {
			this.syncAiLiveChatShell();
		}
	}

	private shouldRefreshRuntimeElapsed(snapshot: AgentTrajectorySnapshot | null): boolean {
		if (!snapshot) {
			return false;
		}
		return snapshot.status === "running";
	}

	private scheduleRuntimeElapsedTimer(): void {
		if (this.aiRuntimeElapsedTimer != null || !this.shouldRefreshRuntimeElapsed(this.aiRuntimeTrajectorySnapshot)) {
			return;
		}
		this.aiRuntimeElapsedTimer = window.setTimeout(() => {
			this.aiRuntimeElapsedTimer = null;
			if (!this.shouldRefreshRuntimeElapsed(this.aiRuntimeTrajectorySnapshot)) {
				return;
			}
			const refreshedSnapshot = this.aiRuntimeTrajectoryStore.refreshElapsed();
			this.aiRuntimeTrajectorySnapshot = refreshedSnapshot ?? this.aiRuntimeTrajectorySnapshot;
			this.bindRuntimeSnapshotToLatestUserMessage(this.aiRuntimeTrajectorySnapshot);
			this.syncComposerTaskBar();
			this.syncLiveRuntimeElapsedProcess();
			if (this.shouldRefreshRuntimeElapsed(this.aiRuntimeTrajectorySnapshot)) {
				this.scheduleRuntimeElapsedTimer();
			}
		}, 1000);
	}

	private clearRuntimeElapsedTimer(): void {
		if (this.aiRuntimeElapsedTimer == null) {
			return;
		}
		window.clearTimeout(this.aiRuntimeElapsedTimer);
		this.aiRuntimeElapsedTimer = null;
	}

	private handleRuntimeProgress(event: RuntimeProgressEvent): void {
		void recordTaskFromRuntimeProgress(event, this.plugin.agentRuntimeService, this.aiRuntimeProgressTaskIds, {
			recordAgentTask: (task) => this.recordAgentTask(task),
			render: () => this.syncAiRuntimeShell(),
		});
		this.aiStreamingTrajectorySnapshot = null;
		this.updateLocalIntakePreviewForRuntimeProgress(event);
		const nextSnapshot = this.aiRuntimeTrajectoryStore.appendProgress(event);
		const nextView = buildAgentProcessPanelViewModel(nextSnapshot);
		if (this.aiRuntimeModelRequestStarted && nextView.shouldRenderProcessPanel) {
			this.aiLocalIntakePreview = "";
		}
		this.aiRuntimeTrajectorySnapshot = nextSnapshot;
		this.bindRuntimeSnapshotToLatestUserMessage(this.aiRuntimeTrajectorySnapshot);
		const terminalProgress = event.phase === "error" || event.phase === "done";
		if (terminalProgress) {
			this.rememberCompletedTrajectorySnapshot(this.aiRuntimeTrajectorySnapshot);
			const completedSnapshot = this.aiRuntimeTrajectoryStore.completeFromProgress();
			this.rememberCompletedTrajectorySnapshot(completedSnapshot);
			this.aiRuntimeTrajectorySnapshot = null;
			this.clearRuntimeElapsedTimer();
		} else if (this.shouldRefreshRuntimeElapsed(nextSnapshot)) {
			this.scheduleRuntimeElapsedTimer();
		} else {
			this.clearRuntimeElapsedTimer();
		}
		const forceRender = (
			(event.phase === "narration" && event.narration?.kind === "stage_report") ||
			event.phase === "tool_call" ||
			event.phase === "tool_result" ||
			terminalProgress
		);
		const now = Date.now();
		if (forceRender || now - this.aiRuntimeLastRenderAt >= 120) {
			this.aiRuntimeLastRenderAt = now;
			this.aiForceScrollToBottomOnce = true;
			if (!terminalProgress && nextView.shouldRenderProcessPanel && this.syncLiveRuntimeProgressProcess()) {
				return;
			}
			this.syncAiRuntimeShell();
		}
	}

	private updateLocalIntakePreviewForRuntimeProgress(event: RuntimeProgressEvent): void {
		if (event.phase === "intake") {
			this.aiRuntimeSawIntake = true;
			this.aiRuntimeModelRequestStarted = true;
			return;
		}
		if (event.phase === "tool_call" || event.phase === "tool_result" || event.phase === "done" || event.phase === "fallback") {
			this.aiRuntimeModelRequestStarted = true;
			return;
		}
		if (event.phase !== "model_retry") {
			return;
		}
		if (event.transport?.type === "request_started") {
			this.aiRuntimeModelRequestStarted = true;
			this.aiLocalIntakePreview = this.t("ai.intake.preview.modelStarted", "FRIDAY 正在理解你的请求……");
			return;
		}
		if (event.transport?.type === "request_exhausted" && !this.aiRuntimeSawIntake) {
			const message = this.t("ai.intake.preview.modelExhaustedBeforeIntake", "暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。");
			this.aiLocalIntakePreview = message;
			this.aiLastError = message;
			return;
		}
		if (event.transport?.type === "retry_scheduled" || event.transport?.type === "retry_started") {
			this.aiLocalIntakePreview = this.t("ai.intake.preview.retry", "模型连接不稳定，FRIDAY 正在重试。");
		}
	}

	private buildRuntimeReply(result: RuntimeTurnResult): string {
		const normalizedAssistantText = this.normalizeRuntimeAssistantText(result.assistantText);
		if (normalizedAssistantText.trim() && !this.isIntermediateRuntimeReply(normalizedAssistantText)) {
			return normalizedAssistantText.trim();
		}
		if (result.parseError) {
			return this.t("ai.runtime.fallbackWithIssue", "FRIDAY 暂时没能整理出可直接展示的回复。你可以稍后重试，或查看上方过程。");
		}
		return this.t("ai.runtime.fallback", "FRIDAY 已处理完这次请求。过程已经整理在上方。");
	}

	private buildSkillCatalogReply(skills: SkillDescriptor[]): string {
		if (skills.length === 0) {
			return this.t("ai.skillCatalog.empty", "No skills available.");
		}
		const lines: string[] = [
			this.t("ai.skillCatalog.title", "Available skills"),
			"",
		];
		for (const skill of skills) {
			lines.push(`- ${this.formatSkillDisplayName(skill.command)}: ${skill.description}`);
		}
		lines.push("");
		lines.push(this.t("ai.skillCatalog.usage", "Choose a skill, then describe the task."));
		return lines.join("\n");
	}

	private getComposerSnapshot(): MentionComposerSnapshot {
		if (this.aiComposerSnapshot.doc || this.aiComposerSnapshot.text || this.aiComposerSnapshot.tokens.length > 0) {
			return this.aiComposerSnapshot;
		}
		const legacy = parseLegacyMentionMarkup(this.aiDraft);
		return {
			doc: null,
			text: legacy.text,
			tokens: legacy.tokens,
		};
	}

	private cloneComposerSnapshot(snapshot: MentionComposerSnapshot): MentionComposerSnapshot {
		return {
			doc: snapshot.doc
				? JSON.parse(JSON.stringify(snapshot.doc)) as Record<string, unknown>
				: null,
			text: snapshot.text,
			tokens: snapshot.tokens.map((token) => ({ ...token })),
			selectionAnchor: snapshot.selectionAnchor,
			selectionHead: snapshot.selectionHead,
		};
	}

	private isComposerDraftEmpty(): boolean {
		return isPromptDocumentEmpty(getStructuredPromptDocument(this.getComposerSnapshot()));
	}

	private enqueueAiPrompt(snapshot: MentionComposerSnapshot, position: "front" | "back" = "back"): void {
		const queuedSnapshot = this.cloneComposerSnapshot(snapshot);
		if (isPromptDocumentEmpty(getStructuredPromptDocument(queuedSnapshot))) {
			return;
		}
		if (position === "front") {
			this.aiQueuedPrompts.unshift(queuedSnapshot);
		} else {
			this.aiQueuedPrompts.push(queuedSnapshot);
		}
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.composer?.replaceSnapshot(this.aiComposerSnapshot);
		this.aiForceScrollToBottomOnce = true;
		this.syncAiLiveChatShell();
	}

	private async flushQueuedAiPrompt(): Promise<void> {
		if (this.aiBusy) {
			return;
		}
		const nextPrompt = this.aiQueuedPrompts.shift();
		if (!nextPrompt) {
			return;
		}
		await this.submitAiPrompt(nextPrompt);
	}

	private getSendButtonLabel(): string {
		if (this.hasPendingComposerDecision()) {
			return this.t("ai.waitingDecision", "等待确认");
		}
		if (!this.aiBusy) {
			return this.plugin.t("ai.send");
		}
		return this.isComposerDraftEmpty()
			? this.t("ai.stopCurrentTask", "停止当前任务")
			: this.aiSendAbortController
				? this.t("ai.queue.submit", "加入队列")
				: this.t("ai.queue.submit", "加入队列");
	}

	private resolveSendButtonIcon(): string {
		return this.aiBusy && this.isComposerDraftEmpty() ? "square" : "send";
	}

	private renderMentionSystemContext(
		mentionContext: PromptMentionContext | undefined,
	): string {
		if (!mentionContext || mentionContext.entries.length === 0) {
			return "";
		}
		const lines: string[] = [this.t("ai.mention.contextLead", "以下是用户 @ 提及内容，请优先参考：")];
		for (const entry of mentionContext.entries) {
			lines.push(`[${entry.channel}] ${entry.title}`);
			lines.push(entry.body);
			lines.push("");
		}
		return lines.join("\n").trim();
	}

	private async buildComposerSuggestions(query: MentionComposerQuery): Promise<MentionSuggestion[]> {
		if (query.trigger === "/") {
			const skills = await this.plugin.skillCommandService.listSkills(20);
			const slashCommands = this.plugin.settings.slashCommands
				.filter((item) => item.enabled)
				.map((item) => ({ name: item.name, template: item.template }));
			return buildSlashSuggestions(`/${query.query}`, {
				skills: skills.map((item) => ({ command: item.command, description: item.description })),
				slashCommands,
			}).map((item) => {
				if (item.kind === "skill" && item.command) {
					return {
						label: this.formatSkillDisplayName(item.command),
						description: item.description,
						kind: "skill" as const,
						trigger: "/" as const,
						token: this.createMentionToken("skill", item.command),
					};
				}
				return {
					label: item.label,
					description: item.description,
					kind: "slash" as const,
					trigger: "/" as const,
					replacementText: item.value,
				};
			});
		}
		return this.buildMentionSuggestionItems(query);
	}

	private buildMentionSuggestionItems(query: MentionComposerQuery): MentionSuggestion[] {
		const normalizedQuery = query.query.trim().toLowerCase();
		if (query.mode === "category" && !normalizedQuery) {
			return [
				this.buildActiveNoteSuggestion(),
				{
					label: this.t("ai.mention.option.notes", "笔记"),
					description: this.t("ai.mention.category.notes", "Reference notes in the current project"),
					kind: "mention_category",
					trigger: "@",
					category: "note",
				},
				{
					label: this.t("ai.mention.option.folders", "文件夹"),
					description: this.t("ai.mention.category.folders", "Reference folder structure in the current project"),
					kind: "mention_category",
					trigger: "@",
					category: "folder",
				},
			];
		}
		if (query.mode === "search" && query.category === "folders") {
			return this.getMentionableFolders(normalizedQuery).map((folder) => ({
				label: folder.name,
				description: folder.path,
				kind: "mention_token" as const,
				trigger: "@" as const,
				category: "folder" as const,
				token: this.createMentionToken("folder", folder.path),
			}));
		}
		if (query.mode === "search" && query.category === "notes") {
			return this.getMentionableFiles(normalizedQuery).map((file) => this.buildFileMentionSuggestion(file));
		}

		const items: MentionSuggestion[] = [];
		const activeFile = this.app.workspace.getActiveFile();
		if (
			activeFile instanceof TFile
			&& (!normalizedQuery
				|| "active note".includes(normalizedQuery)
				|| activeFile.basename.toLowerCase().includes(normalizedQuery))
		) {
			items.push(this.buildActiveNoteSuggestion());
		}
		items.push(...this.getMentionableFiles(normalizedQuery).map((file) => this.buildFileMentionSuggestion(file)));
		items.push(...this.getMentionableFolders(normalizedQuery).map((folder) => ({
			label: folder.name,
			description: folder.path,
			kind: "mention_token" as const,
			trigger: "@" as const,
			category: "folder" as const,
			token: this.createMentionToken("folder", folder.path),
		})));
		return items.slice(0, 16);
	}

	private buildActiveNoteSuggestion(): MentionSuggestion {
		const activeFile = this.app.workspace.getActiveFile();
		return {
			label: this.t("ai.mention.option.activeNote", "当前笔记"),
			description: this.t("ai.mention.category.activeNote", "Use the active note at send time"),
			kind: "mention_token",
			trigger: "@",
			category: "active_note",
			fileTypeIcon: activeFile instanceof TFile ? getMentionFileTypeIcon(activeFile) : "note",
			fileTypeLabel: activeFile instanceof TFile
				? this.getMentionFileTypeLabel(getMentionFileTypeIcon(activeFile))
				: this.getMentionFileTypeLabel("note"),
			token: this.createMentionToken("active_note"),
		};
	}

	private buildFileMentionSuggestion(file: TFile): MentionSuggestion {
		const icon = getMentionFileTypeIcon(file);
		return {
			label: file.basename || file.name,
			description: file.path,
			kind: "mention_token",
			trigger: "@",
			category: "note",
			fileTypeIcon: icon,
			fileTypeLabel: this.getMentionFileTypeLabel(icon),
			token: this.createMentionToken("note", file.path),
		};
	}

	private getMentionFileTypeLabel(kind: MentionFileTypeIconKind): string {
		switch (kind) {
			case "markdown":
				return this.t("ai.mention.fileType.markdown", "Markdown");
			case "canvas":
				return this.t("ai.mention.fileType.canvas", "Canvas");
			case "code":
				return this.t("ai.mention.fileType.code", "Code / HTML");
			default:
				return this.t("ai.mention.fileType.note", "Note");
		}
	}

	private createMentionToken(type: MentionTokenType, pathValue = ""): MentionToken {
		const normalizedPath = pathValue.trim();
		const key = normalizedPath || "active";
		return {
			id: `mention:${type}:${key}`,
			type,
			...(normalizedPath ? { path: normalizedPath } : {}),
		};
	}

	private getMentionableFiles(query: string): TFile[] {
		const activeProject = this.getActiveProjectEntry();
		const currentPath = this.app.workspace.getActiveFile()?.path ?? "";
		const normalizedQuery = query.trim().toLowerCase();
		const files = this.app.vault.getFiles().filter((file) => isMentionableFile(file));
		const scopePrefixes = resolveMentionScopePrefixes(
			activeProject ?? undefined,
			files.map((file) => file.path),
		);
		return files
			.filter((file) => {
				return isPathWithinMentionScope(file.path, scopePrefixes);
			})
			.filter((file) => {
				if (!normalizedQuery) {
					return true;
				}
				return file.path.toLowerCase().includes(normalizedQuery) || file.basename.toLowerCase().includes(normalizedQuery);
			})
			.sort((left, right) => {
				if (left.path === currentPath) return -1;
				if (right.path === currentPath) return 1;
				const leftExact = normalizedQuery && left.basename.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
				const rightExact = normalizedQuery && right.basename.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
				if (leftExact !== rightExact) {
					return leftExact - rightExact;
				}
				return left.path.localeCompare(right.path);
			})
			.slice(0, 12);
	}

	private getMentionableFolders(query: string): TFolder[] {
		const activeProject = this.getActiveProjectEntry();
		const normalizedQuery = query.trim().toLowerCase();
		const allEntries = this.app.vault.getAllLoadedFiles();
		const scopePrefixes = resolveMentionScopePrefixes(
			activeProject ?? undefined,
			allEntries.map((entry) => entry.path),
		);
		return allEntries
			.filter((entry): entry is TFolder => entry instanceof TFolder)
			.filter((folder) => {
				return isPathWithinMentionScope(folder.path, scopePrefixes);
			})
			.filter((folder) => {
				if (!normalizedQuery) {
					return true;
				}
				return folder.path.toLowerCase().includes(normalizedQuery) || folder.name.toLowerCase().includes(normalizedQuery);
			})
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, 12);
	}

	private resolveEffectiveModel(activeSoul: { preferredModel?: string } | null): string {
		return activeSoul?.preferredModel?.trim() || this.plugin.settings.llm.model?.trim() || "";
	}

	private buildUserMessageUiMeta(input: {
		snapshot: MentionComposerSnapshot;
		mentionResolution: MentionResolutionResult;
		resolution: { type: string; requestedSkillName?: string };
	}): ChatMessageUiMeta | undefined {
		const segments = buildUserMessageSegments({
			snapshot: input.snapshot,
			mentionResolution: input.mentionResolution,
			resolution: input.resolution,
			formatSkillDisplayName: (command) => this.formatSkillDisplayName(command),
			formatMentionBadgeLabel: (entry) => this.formatMentionBadgeLabel(entry),
		});
		if (segments.length === 0) {
			return undefined;
		}
		return {
			segments,
		};
	}

	private formatMentionBadgeLabel(entry: MentionResolutionResult["entries"][number]): string {
		const title = entry.title.trim() || entry.target.trim() || this.t("ai.message.badge.contextFallback", "未命名上下文");
		if (entry.tokenType === "folder") {
			return `@ ${title}/`;
		}
		return `@ ${title}`;
	}

	private getOpencodeConfigPaths(): string[] {
		return [
			path.join(homedir(), ".config", "opencode", "opencode.json"),
			path.join(homedir(), ".config", "opencode", "config.json"),
			path.join(homedir(), ".config", "opencode", "config.local.json"),
		];
	}

	private readOpencodeSnapshot() {
		for (const configPath of this.getOpencodeConfigPaths()) {
			try {
				if (!existsSync(configPath)) {
					continue;
				}
				const raw = readFileSync(configPath, "utf8");
				const snapshot = parseOpencodeConfig(raw, configPath);
				if (snapshot.providers.length > 0) {
					return snapshot;
				}
			} catch (error) {
				console.warn("[Friday] Failed to read opencode config for chat model selector:", configPath, error);
			}
		}
		return null;
	}

	private getAvailableAgentModelOptions() {
		const snapshot = this.readOpencodeSnapshot();
		const groupProvider = selectOpencodeProvider(snapshot, this.plugin.settings.llm.groupConfig.opencodeProviderId);
		const catalogModels = this.plugin.settings.groupModelCatalog.enabled
			? this.plugin.settings.groupModelCatalog.models
				.filter((model) => model.enabled && model.id.trim())
				.map((model) => ({
					id: model.id.trim(),
					label: model.label.trim() || model.id.trim(),
				}))
			: [];
		const fallbackGroupModels = this.plugin.settings.llm.groupConfig.model?.trim()
			? [{ id: this.plugin.settings.llm.groupConfig.model.trim(), label: this.plugin.settings.llm.groupConfig.model.trim() }]
			: [];
		return buildAgentModelCatalogFromSettings(
			this.plugin.settings.llm,
			groupProvider?.models ?? (catalogModels.length > 0 ? catalogModels : fallbackGroupModels),
		);
	}

	private buildModelOptions(
		activeSoul: { preferredModel?: string; preferredModelMode?: "openai" | "group" } | null,
	): Array<{ value: string; label: string }> {
		const options = new Map<string, { value: string; label: string }>();
		for (const option of this.getAvailableAgentModelOptions()) {
			options.set(option.value, {
				value: option.value,
				label: option.label,
			});
		}
		const addOption = (mode: "openai" | "group", model: string) => {
			const trimmed = model.trim();
			if (!trimmed) {
				return;
			}
			const value = serializeAgentModelChoice(mode, trimmed);
			if (options.has(value)) {
				return;
			}
			const prefix = mode === "group" ? "集团" : "OpenAI";
			options.set(value, {
				value,
				label: `${prefix} · ${trimmed}`,
			});
		};

		addOption("openai", this.plugin.settings.llm.openaiConfig.model);
		addOption("group", this.plugin.settings.llm.groupConfig.model);
		addOption(this.plugin.settings.llm.mode, this.plugin.settings.llm.model);
		if (activeSoul?.preferredModel?.trim()) {
			addOption(activeSoul.preferredModelMode ?? this.plugin.settings.llm.mode, activeSoul.preferredModel);
		}
		for (const soul of this.plugin.listSouls()) {
			const soulDefinition = this.plugin.soulStore.getSoulSync(soul.id);
			if (soulDefinition?.preferredModel?.trim()) {
				addOption(soulDefinition.preferredModelMode ?? this.plugin.settings.llm.mode, soulDefinition.preferredModel);
			}
		}
		const selectedValue = this.resolveSelectedModelOptionValue(activeSoul, [...options.values()]);
		return [...options.values()].sort((left, right) => {
			if (left.value === selectedValue) return -1;
			if (right.value === selectedValue) return 1;
			return left.label.localeCompare(right.label, "zh-CN");
		});
	}

	private buildGroupedModelOptions(
		activeSoul: { preferredModel?: string; preferredModelMode?: "openai" | "group" } | null,
	): ComposerChoiceMenuGroup[] {
		const flatOptions = this.buildModelOptions(activeSoul);
		const groups = new Map<"openai" | "group", ComposerChoiceMenuGroup>();
		const ensureGroup = (mode: "openai" | "group") => {
			const existing = groups.get(mode);
			if (existing) {
				return existing;
			}
			const created = {
				label: mode === "openai" ? "OpenAI协议" : "集团集采",
				options: [] as Array<{ value: string; label: string }>,
			};
			groups.set(mode, created);
			return created;
		};
		for (const option of flatOptions) {
			const parsed = parseAgentModelChoice(option.value);
			if (!parsed) {
				continue;
			}
			ensureGroup(parsed.mode).options.push({
				value: option.value,
				label: this.extractModelOptionShortLabel(option.label, parsed.model),
			});
		}
		return Array.from(groups.entries())
			.sort(([left], [right]) => {
				if (left === right) return 0;
				return left === "openai" ? -1 : 1;
			})
			.map(([, group]) => group);
	}

	private resolveComposerChoiceLabel(groups: ComposerChoiceMenuGroup[], selectedValue: string): string {
		for (const group of groups) {
			const option = group.options.find((item) => item.value === selectedValue);
			if (option) {
				return option.label;
			}
		}
		return "";
	}

	private extractModelOptionShortLabel(label: string, fallbackModel: string): string {
		const trimmed = label.trim();
		if (!trimmed) {
			return fallbackModel;
		}
		if (!trimmed.includes("·")) {
			return trimmed;
		}
		const lastSegment = trimmed.split("·").pop()?.trim() ?? "";
		return lastSegment || fallbackModel;
	}

	private resolveSelectedModelOptionValue(
		activeSoul: { preferredModel?: string; preferredModelMode?: "openai" | "group" } | null,
		options: Array<{ value: string; label: string }>,
	): string {
		const findValue = (mode: "openai" | "group", model: string): string => {
			const trimmed = model.trim();
			if (!trimmed) {
				return "";
			}
			const exactValue = serializeAgentModelChoice(mode, trimmed);
			if (options.some((item) => item.value === exactValue)) {
				return exactValue;
			}
			return options.find((item) => item.value.endsWith(`::${trimmed}`))?.value ?? "";
		};
		if (activeSoul?.preferredModel?.trim()) {
			const activeValue = findValue(
				activeSoul.preferredModelMode ?? this.plugin.settings.llm.mode,
				activeSoul.preferredModel,
			);
			if (activeValue) {
				return activeValue;
			}
		}
		return findValue(this.plugin.settings.llm.mode, this.plugin.settings.llm.model) || options[0]?.value || "";
	}

	private buildPermissionModeOptions(): Array<{ value: ToolPermissionMode; label: string }> {
		return [
			{ value: "auto", label: this.t("settings.agent.permissionMode.auto", "全自动") },
			{ value: "standard", label: this.t("settings.agent.permissionMode.standard", "标准") },
			{ value: "strict", label: this.t("settings.agent.permissionMode.strict", "严格") },
		];
	}

	private resolvePermissionModeLabel(mode: ToolPermissionMode): string {
		switch (mode) {
			case "auto":
				return this.t("settings.agent.permissionMode.auto", "全自动");
			case "strict":
				return this.t("settings.agent.permissionMode.strict", "严格");
			default:
				return this.t("settings.agent.permissionMode.standard", "标准");
		}
	}

	private renderAiQueueHint(containerEl: HTMLElement): void {
		if (!this.aiBusy && this.aiQueuedPrompts.length === 0) {
			return;
		}
		const hint = containerEl.createDiv({ cls: "friday-ai-queue-hint kit-event-row-v1" });
		hint.createSpan({
			cls: "friday-ai-queue-hint-copy",
			text: this.aiQueuedPrompts.length > 0
				? this.t("ai.queue.helper.pending", "当前任务仍在执行，已排队 {count} 条，完成后会自动继续。", {
					count: this.aiQueuedPrompts.length,
				})
				: this.t("ai.queue.helper.busy", "当前任务仍在执行。你可以继续输入下一条指令，按 Enter 会自动加入队列。"),
		});
		if (this.aiQueuedPrompts.length > 0) {
			hint.createSpan({
				cls: "friday-ai-queue-pill kit-soft-chip-v1",
				text: this.t("ai.queue.badge", "待发送 {count}", { count: this.aiQueuedPrompts.length }),
			});
		}
	}

	private renderAiOverrideBar(containerEl: HTMLElement): void {
		const parts: string[] = [];
		const sessionPolicyOverrides = Object.keys(this.plugin.agentRuntimeService.listSessionToolPolicyOverrides()).length;
		if (sessionPolicyOverrides > 0) {
			parts.push(this.t("ai.override.policy", "策略覆写={count}", { count: sessionPolicyOverrides }));
		}
		if (parts.length === 0) {
			return;
		}
		const bar = containerEl.createDiv({ cls: "friday-ai-override-bar kit-event-row-v1" });
		bar.createSpan({
			text: this.t("ai.override.summary", "临时覆写: {value}", {
				value: parts.join(" · "),
			}),
		});
		const clearButton = bar.createEl("button", {
			cls: "friday-ai-override-clear kit-control-button-v1",
			text: this.t("ai.override.clear", "清除"),
		});
		clearButton.type = "button";
		clearButton.onclick = () => {
			this.plugin.agentRuntimeService.clearAllSessionToolPolicyOverrides();
			this.plugin.toolApprovalService.clearSessionRules();
			this.renderBoard();
		};
	}

	private resolveUserDisplayName(): string {
		return this.plugin.settings.user.displayName.trim() || this.t("ai.role.userFallback", "用户");
	}

	private normalizeRuntimeAssistantText(raw: string): string {
		const trimmed = raw.trim();
		if (!trimmed) {
			return "";
		}
		const assistant = extractRuntimeAssistantText(trimmed);
		if (assistant) {
			return productizeRuntimeText(assistant) || assistant;
		}
		const parsed = parseRuntimeEnvelopeText(trimmed);
		if (parsed?.type === "tool_call") {
			return this.t("ai.runtime.toolCallFallback", "FRIDAY 正在继续调用工具。");
		}
		return productizeRuntimeText(raw) || raw;
	}

	private isIntermediateRuntimeReply(text: string): boolean {
		const normalized = text.trim().toLowerCase();
		if (!normalized) {
			return true;
		}
		return (
			normalized.startsWith("calling tool:") ||
			normalized.includes("正在继续调用工具") ||
			normalized.includes("is continuing with tool calls")
		);
	}

	private async switchSoul(soulId: string): Promise<void> {
		if (!soulId || this.aiBusy || soulId === this.plugin.settings.activeSoulId) {
			return;
		}

		try {
			await this.plugin.setActiveSoul(soulId);
			this.aiSessionId = "";
			this.aiQueuedPrompts = [];
			await this.ensureAiSessionLoaded();
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			new Notice(
				this.t("ai.notice.switchAgentFailed", "Switch Agent failed: {error}", { error: message }),
				6000,
			);
		}
	}

	private async openMemberEditor(project: ProjectEntry): Promise<void> {
		this.memberEditorProject = project;
		this.memberEditorMembers = await this.plugin.dataService.getProjectMembers(project);
		this.memberEditorNewUserId = "";
		this.memberEditorNewRole = "editor";
		this.activePage = "sync";
		this.renderBoard();
	}

	private async ensureAiSessionLoaded(): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul) {
			this.aiConversation = [];
			this.aiSessions = [];
			this.aiSessionId = "";
			this.aiQueuedPrompts = [];
			this.aiAgentTasks = [];
			this.aiLocalIntakePreview = "";
			this.aiStreamingPreview = "";
			this.aiStreamingTrajectorySnapshot = null;
			this.aiProcessSnapshotsByKey.clear();
			return;
		}

		const sessions = await this.plugin.conversationService.listSessions(
			activeSoul.id,
			80,
			this.plugin.settings.activeProjectId || undefined,
		);
		this.aiSessions = sessions;
		if (this.aiSessionId) {
			const matched = sessions.find((session) => session.sessionId === this.aiSessionId);
			if (matched) {
				this.aiConversation = [...matched.messages];
				await this.hydrateAgentTasksForCurrentSession();
				await this.hydrateCompletedTrajectorySnapshotsForCurrentSession();
				return;
			}
		}

		const latest = sessions[0];
		if (latest) {
			this.aiSessionId = latest.sessionId;
			this.aiConversation = [...latest.messages];
			await this.hydrateAgentTasksForCurrentSession();
			await this.hydrateCompletedTrajectorySnapshotsForCurrentSession();
			return;
		}

		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiConversation = [];
		this.aiAgentTasks = [];
		this.aiLocalIntakePreview = "";
		this.aiStreamingPreview = "";
		this.aiStreamingTrajectorySnapshot = null;
		this.aiProcessSnapshotsByKey.clear();
	}

	private async persistConversation(input: {
		sessionId?: string;
		projectId?: string;
		messages?: ChatMessage[];
	} = {}): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		const messages = input.messages ?? this.aiConversation;
		if (!activeSoul || messages.length === 0) {
			return;
		}
		let sessionId = input.sessionId?.trim() || this.aiSessionId.trim();
		if (!sessionId) {
			sessionId = this.plugin.conversationService.createSessionId();
			if (!input.sessionId) {
				this.aiSessionId = sessionId;
			}
		}
		const projectId = input.projectId !== undefined
			? input.projectId || undefined
			: this.plugin.settings.activeProjectId || undefined;
		const saved = await this.plugin.conversationService.saveSession({
			soulId: activeSoul.id,
			projectId,
			sessionId,
			messages,
		});
		this.aiSessions = [saved, ...this.aiSessions.filter((session) => session.sessionId !== saved.sessionId)]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 80);
	}

	private async syncSingleProject(project: ProjectEntry): Promise<void> {
		const result = await this.plugin.syncService.sync(project);
		const recordedAt = new Date().toISOString();
		if (result.success) {
			project.lastSyncAt = recordedAt;
			await this.plugin.saveSettings();
			new Notice(this.plugin.t("notice.syncSuccess", { slug: this.getProjectLabel(project) }), 3000);
		} else {
			new Notice(this.plugin.t("notice.syncFailed", { error: result.error ?? this.getProjectLabel(project) }), 6000);
		}

		this.plugin.workbenchStateStore.recordSyncReport({
			projectId: project.projectId,
			result,
			recordedAt,
		});
		this.plugin.workbenchStateStore.replaceProjectSyncConflicts(project.projectId, result.conflictRecords ?? []);
		const firstConflictRecord = result.conflictRecords?.[0];
		if (firstConflictRecord) {
			this.expandedConflictKey = this.getSyncConflictKey(project.projectId, firstConflictRecord.filePath);
		} else if (this.expandedConflictKey.startsWith(`${project.projectId}::`)) {
			this.expandedConflictKey = "";
		}
		this.activePage = "sync";
		this.renderBoard();
	}

	private async syncAllProjects(): Promise<void> {
		const projects = this.plugin.settings.projects;
		if (projects.length === 0) {
			new Notice(this.plugin.t("notice.noProjectsConfigured"), 3000);
			return;
		}

		const results = await this.plugin.syncService.syncAll(projects);
		for (const project of projects) {
			const result = results.get(project.projectId);
			if (result?.success) {
				project.lastSyncAt = new Date().toISOString();
			}
			if (result) {
				this.plugin.workbenchStateStore.replaceProjectSyncConflicts(project.projectId, result.conflictRecords ?? []);
			}
		}
		await this.plugin.saveSettings();
		const recordedAt = new Date().toISOString();
		this.plugin.workbenchStateStore.setSyncReports(projects
			.map((project) => ({
				projectId: project.projectId,
				result: results.get(project.projectId) ?? {
					success: false,
					projectId: project.projectId,
					pulledFiles: [],
					pushedFiles: [],
					conflicts: [],
					error: this.t("checks.sync.missing", "No sync result"),
				},
				recordedAt,
			}))
			.slice(0, 12));
		this.activePage = "sync";
		this.renderBoard();
	}

	private addPageButton(containerEl: HTMLElement, label: string, action: () => Promise<void>): HTMLButtonElement {
		const button = containerEl.createEl("button", { text: label });
		button.onclick = async (event) => {
			event.preventDefault();
			event.stopPropagation();
			try {
				await action();
			} catch (error) {
				console.error("[Friday] Action failed:", label, error);
				new Notice(
					this.t("common.actionFailed", "{label} failed: {error}", {
						label,
						error: String(error),
					}),
					6000,
				);
			}
		};
		return button;
	}

	private addPageIconButton(
		containerEl: HTMLElement,
		label: string,
		icon: string,
		action: () => Promise<void>,
	): HTMLButtonElement {
		const button = containerEl.createEl("button", { cls: "kit-control-button-v1 friday-project-sync-icon-button" });
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.title = label;
		setIcon(button, icon);
		button.onclick = async (event) => {
			event.preventDefault();
			event.stopPropagation();
			try {
				await action();
			} catch (error) {
				console.error("[Friday] Action failed:", label, error);
				new Notice(
					this.t("common.actionFailed", "{label} failed: {error}", {
						label,
						error: String(error),
					}),
					6000,
				);
			}
		};
		return button;
	}

	private captureAiMessageListScrollState(listEl: HTMLElement | null = this.contentEl.querySelector(".friday-ai-message-list")): void {
		if (!(listEl instanceof HTMLElement)) {
			return;
		}
		this.aiMessageListScrollTop = listEl.scrollTop;
		const bottomDistance = listEl.scrollHeight - (listEl.scrollTop + listEl.clientHeight);
		this.aiMessageListStickToBottom = bottomDistance <= 24;
	}

	private restoreAiMessageListScrollState(listEl: HTMLElement): void {
		if (this.aiForceScrollToBottomOnce || this.aiMessageListStickToBottom) {
			const scrollToBottom = () => {
				listEl.scrollTop = listEl.scrollHeight;
			};
			scrollToBottom();
			window.requestAnimationFrame(scrollToBottom);
		} else {
			const maxScrollTop = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
			listEl.scrollTop = Math.min(this.aiMessageListScrollTop, maxScrollTop);
		}
		this.aiForceScrollToBottomOnce = false;

		listEl.onscroll = () => {
			this.aiMessageListScrollTop = listEl.scrollTop;
			const bottomDistance = listEl.scrollHeight - (listEl.scrollTop + listEl.clientHeight);
			this.aiMessageListStickToBottom = bottomDistance <= 24;
		};
	}

	private truncateText(value: string, maxLength: number): string {
		if (value.length <= maxLength) {
			return value;
		}
		if (maxLength <= 1) {
			return value.slice(0, Math.max(0, maxLength));
		}
		return `${value.slice(0, maxLength - 1)}…`;
	}

	private t(key: string, fallback: string, params?: TranslateParams): string {
		const translated = this.plugin.t(key, params);
		if (translated !== key) {
			return translated;
		}
		if (!params) {
			return fallback;
		}
		return fallback.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_all, name: string) => {
			const value = params[name];
			return value == null ? "" : String(value);
		});
	}

}


