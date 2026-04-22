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
import { PROJECT_STATE_CHANGED_EVENT } from "../constants/events";
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
import { ConversationSession } from "../services/ConversationService";
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
import type { ToolPermissionMode } from "../types/agent";
import type { FridayPluginApi } from "../types/plugin";
import { ProjectEntry, ProjectMember, SyncResult } from "../types/project";
import type { SyncConflictRecord } from "../types/sync";
import { InvocationResolver } from "../core/execution/InvocationResolver";
import { SkillRegistry } from "../core/execution/SkillRegistry";
import { resolveBuiltinSkillReviewNote, type ResolvedBuiltinSkillReviewNote } from "../skills/packs/builtin/reviewNotes";
import type { MentionSuggestion } from "./components/MentionDropdown";
import {
	computeSkillReviewNotePopoverLayout,
	computeSkillReviewNotePopoverPosition,
} from "./skillReviewNotePopoverPlacement";
import {
	MentionResolver,
	parseLegacyMentionMarkup,
	type MentionDocumentSnapshot,
	type MentionResolutionResult,
	type MentionToken,
	type MentionTokenType,
} from "../core/context/mention/MentionResolver";
import {
	createEmptyMentionComposerSnapshot,
	formatMentionTokenLabel,
	listMentionComposerParts,
	restoreMentionComposerDoc,
	type MentionComposerSnapshot,
} from "../core/editor/mention/MentionComposerDocument";
import { MentionComposer, type MentionComposerQuery } from "./components/MentionComposer";
import { isPathWithinMentionScope, resolveMentionScopePrefixes } from "./components/mentionScope";

export const VIEW_TYPE_DAILY_BOARD = "friday-daily-board";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

type RuntimeExecutionStatus = "pending" | "running" | "ok" | "failed";
type RuntimeExecutionStageKey = "context" | "analysis" | "tools" | "finalize";
type RuntimeExecutionEntryKind = "context" | "model" | "tool" | "system";

interface RuntimeExecutionStage {
	key: RuntimeExecutionStageKey;
	label: string;
	status: RuntimeExecutionStatus;
}

interface RuntimeExecutionEntry {
	key: string;
	label: string;
	detail: string;
	status: RuntimeExecutionStatus;
	kind: RuntimeExecutionEntryKind;
	step?: number;
}

interface RuntimeExecutionState {
	heading: string;
	summary: string;
	stages: RuntimeExecutionStage[];
	entries: RuntimeExecutionEntry[];
	activeContextEntryKey: string | null;
}

interface SessionListGroup {
	key: string;
	label: string;
	sessions: ConversationSession[];
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
	private aiStreamingPreview = "";
	private aiRuntimeExecutionState: RuntimeExecutionState | null = null;
	private aiLastCompletedRuntimeExecutionState: RuntimeExecutionState | null = null;
	private aiRuntimePreviewExpanded = false;
	private aiMessageListScrollTop = 0;
	private aiMessageListStickToBottom = true;
	private aiForceScrollToBottomOnce = false;
	private aiRuntimeLastRenderAt = 0;
	private aiSendAbortController: AbortController | null = null;
	private aiSessionManageMode = false;
	private aiSessionSelection = new Set<string>();
	private aiSessionRenameId = "";
	private aiSessionRenameDraft = "";
	private composer: MentionComposer | null = null;
	private aiMessageListEl: HTMLElement | null = null;
	private aiQueueHintEl: HTMLElement | null = null;
	private aiErrorEl: HTMLElement | null = null;
	private aiSendButtonEl: HTMLButtonElement | null = null;
	private aiModelSelectEl: HTMLSelectElement | null = null;
	private aiPermissionSelectEl: HTMLSelectElement | null = null;
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
		await this.ensureActiveProjectInitialized();
		await this.ensureAiSessionLoaded();
		await this.safeRenderBoard();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.cleanupSkillReviewNotePopovers();
		this.composer?.destroy();
		this.composer = null;
		this.resetAiChatShellRefs();
		this.approvalQueue.clearWithDecision("deny");
		this.plugin.toolApprovalService.clearPromptHandler();
		this.aiSendAbortController?.abort();
		this.aiSendAbortController = null;
		window.removeEventListener(PROJECT_STATE_CHANGED_EVENT, this.handleProjectStateChanged);
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
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "friday-shell" });
		const shellHeaderEl = shell.createDiv({ cls: "friday-shell-header" });
		const topNavEl = shell.createDiv({ cls: "friday-top-nav" });
		const contentEl = shell.createDiv({ cls: "friday-page-content" });

		this.renderShellHeader(shellHeaderEl);
		this.renderTopNav(topNavEl);
		if (this.plugin.settings.projects.length === 0) {
			this.activePage = "sync";
			this.renderSyncPage(contentEl);
		} else if (this.activePage === "sync") {
			this.renderSyncPage(contentEl);
		} else if (this.activePage === "tools") {
			this.renderToolsPage(contentEl);
		} else {
			this.renderAiPage(contentEl);
		}
		if (this.plugin.settings.projects.length > 0 && !this.aiSessionNavCollapsed) {
			this.renderAiSessionDrawer(shell);
		}
		if (shouldRestoreComposerFocus) {
			(this.composer as MentionComposer | null)?.focus();
		}
	}

	private resetAiChatShellRefs(): void {
		this.aiMessageListEl = null;
		this.aiQueueHintEl = null;
		this.aiErrorEl = null;
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
		const projectBrandEl = projectSection.createSpan({
			cls: "friday-shell-project-brand friday-wordmark",
			text: this.t("nav.friday", "F.R.I.D.A.Y"),
		});
		projectBrandEl.style.fontFamily = 'FridayAirbeat, "Segoe UI", sans-serif';
		projectSection.createSpan({
			cls: "friday-shell-project-subtitle",
			text: this.t("shell.subtitle", "对话工作台"),
		});

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
			selectEl.disabled = this.aiBusy;
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
		button.disabled = this.aiBusy && page !== this.activePage;
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
			text: this.t("approval.title", "Tool approval required"),
		});
		card.createDiv({
			cls: "friday-approval-detail",
			text: `${item.request.tool} · ${item.request.targetPath || this.t("approval.noTarget", "(no target)")}`,
		});
		card.createDiv({
			cls: "friday-approval-detail",
			text: item.request.description,
		});
		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addApprovalDecisionButton(actions, this.t("approval.allowOnce", "Allow once"), item.id, "allow_once", "is-allow");
		this.addApprovalDecisionButton(actions, this.t("approval.allowSession", "Allow session"), item.id, "allow_session", "is-session");
		this.addApprovalDecisionButton(actions, this.t("approval.allowAlways", "Allow always"), item.id, "allow_always", "is-always");
		this.addApprovalDecisionButton(actions, this.t("approval.deny", "Deny"), item.id, "deny", "is-deny");
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
		const resolution = this.plugin.executionEventRouter.routeToRuntime({
			type: "sync.conflict_proposal_requested",
			source: "project_action",
			projectId,
			prompt: filePath,
			currentFilePath: filePath,
			payload: { filePath },
		});
		if (resolution.type !== "runtime" || !resolution.requestedSkillName) {
			throw new Error("Project conflict proposal could not be resolved to a runtime skill invocation.");
		}
		const decision = await this.plugin.executionPlanner.plan(resolution, { currentFilePath: filePath });
		const result = await this.plugin.executionOrchestrator.execute(decision, {
			agentId: activeSoul.id,
			conversation: [],
			currentFilePath: filePath,
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
		if (!projectId || projectId === this.plugin.settings.activeProjectId || this.aiBusy) {
			return;
		}
		await this.plugin.setActiveProject(projectId);
		await this.safeRenderBoard();
	}

	private renderSyncPage(containerEl: HTMLElement): void {
		const projects = this.plugin.settings.projects;
		const activeProject = this.getActiveProjectEntry();
		const header = containerEl.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.plugin.t("projects.header") });
		const actionBar = header.createDiv({ cls: "friday-page-actions" });
		this.addPageButton(actionBar, this.t("projects.button.settings", "Project Settings"), async () => {
			this.plugin.openSettingsTab("project");
		});
		if (projects.length > 0) {
			this.addPageButton(actionBar, this.t("projects.button.syncAll", "Sync All"), async () => {
				await this.syncAllProjects();
			});
			this.addPageButton(actionBar, this.plugin.t("button.refresh"), async () => {
				await this.safeRenderBoard();
			});
		}

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
		this.renderSyncProjectCard(containerEl, activeProject);
	}

	private renderSyncProjectCard(containerEl: HTMLElement, project: ProjectEntry): void {
		const card = containerEl.createDiv({ cls: "friday-project-card" });
		if (this.getProjectKey(project) === this.plugin.settings.activeProjectId) {
			card.addClass("is-active");
		}

		card.onclick = () => {
			void this.switchActiveProject(this.getProjectKey(project));
		};

		const titleEl = card.createDiv({ cls: "friday-project-title" });
		titleEl.createEl("h4", { text: this.getProjectLabel(project) });

		const badgesEl = card.createDiv({ cls: "friday-project-badges" });
		badgesEl.createEl("span", {
			cls: "friday-badge",
			text: project.autoSync
				? this.t("projects.badge.autoSync", "Auto Sync")
				: this.t("projects.badge.manualSync", "Manual Sync"),
		});
		badgesEl.createEl("span", {
			cls: "friday-badge",
			text: project.gitRemote
				? this.t("projects.badge.repoLinked", "Repo linked")
				: this.t("projects.badge.repoUnlinked", "Repo unlinked"),
		});

		const metaEl = card.createDiv({ cls: "friday-project-meta" });
		metaEl.createEl("p", {
			text: this.t("projects.meta.localPath", "Local Path: {value}", {
				value: project.boundaryPath || this.t("common.notSet", "Not set"),
			}),
		});
		metaEl.createEl("p", {
			text: this.t("projects.meta.remoteRepo", "Remote Repo: {value}", {
				value: project.gitRemote || this.t("common.notSet", "Not set"),
			}),
		});
		metaEl.createEl("p", {
			text: this.t("projects.meta.lastSync", "Last Sync: {value}", {
				value: project.lastSyncAt || this.t("common.never", "Never"),
			}),
		});

		const actionsEl = card.createDiv({ cls: "friday-project-actions" });
		const stateEl = card.createDiv({ cls: "friday-project-status-group" });
		if (project.gitState === "none") {
			stateEl.createDiv({
				cls: "friday-approval-detail",
				text: this.t(
					"projects.sync.none",
					"当前没有关联远端仓库，需配置后启用同步功能。",
				),
			});
			this.addPageButton(actionsEl, this.t("projects.button.configure", "立即配置"), async () => {
				this.plugin.openSettingsTab("project");
			});
		} else if (project.gitState === "git_local") {
			stateEl.createDiv({
				cls: "friday-approval-detail",
				text: this.t(
					"projects.sync.gitLocal",
					"当前项目尚未绑定远端仓库，远端同步功能不可用。",
				),
			});
			const syncButton = actionsEl.createEl("button", { text: this.t("projects.button.sync", "Sync") });
			syncButton.disabled = true;
			this.addPageButton(actionsEl, this.t("projects.button.configure", "立即配置"), async () => {
				this.plugin.openSettingsTab("project");
			});
			void this.populateProjectSyncStatus(stateEl, project);
			void this.populateIgnoreCandidates(card, project);
		} else if (project.gitState === "git_remote_bound") {
			stateEl.createDiv({
				cls: "friday-approval-detail",
				text: this.t(
					"projects.sync.gitRemoteBound",
					"当前项目已绑定远端仓库，可执行完整同步。",
				),
			});
			this.addPageButton(actionsEl, this.t("projects.button.sync", "Sync"), async () => {
				await this.syncSingleProject(project);
			});
			this.addPageButton(actionsEl, this.t("projects.button.configure", "立即配置"), async () => {
				this.plugin.openSettingsTab("project");
			});
			void this.populateProjectSyncStatus(stateEl, project);
			void this.populateIgnoreCandidates(card, project);
		}

		this.renderSyncAutomationControls(card, project);
		this.renderProjectStatusPanel(card, project);
	}

	private renderSyncAutomationControls(containerEl: HTMLElement, project: ProjectEntry): void {
		if (project.gitState !== "git_remote_bound") {
			return;
		}
		const panel = containerEl.createDiv({ cls: "friday-project-status-group" });
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

	private async populateProjectSyncStatus(containerEl: HTMLElement, project: ProjectEntry): Promise<void> {
		try {
			const status = await this.plugin.syncService.getStatus(project);
			const runtimeState = this.plugin.syncRuntimeStore.getProjectState(this.getProjectKey(project));
			if (runtimeState) {
				let runtimeKey = "projects.sync.runtime";
				if (runtimeState.stage === "offline") {
					runtimeKey = "projects.sync.offline";
				} else if (runtimeState.stage === "blocked" || runtimeState.stage === "failed") {
					runtimeKey = "projects.sync.blocked";
				}
				containerEl.createEl("p", {
					text: this.t(runtimeKey, "运行态：{stage}", {
						stage: runtimeState.stage,
						message: runtimeState.message || this.t("common.notSet", "Not set"),
					}),
				});
			}
			containerEl.createEl("p", {
				text: this.t(
					"projects.sync.statusLine",
					"分支：{branch} | Ahead {ahead} | Behind {behind} | Dirty {dirty} | Conflicts {conflicts}",
					{
						branch: status.branch || this.t("common.notSet", "Not set"),
						ahead: status.ahead,
						behind: status.behind,
						dirty: status.dirty,
						conflicts: status.conflicts,
					},
				),
			});
			this.renderWorkingTreeChanges(containerEl, status.workingTreeChanges);
		} catch (error) {
			containerEl.createEl("p", {
				text: this.t("projects.sync.statusFailed", "同步状态读取失败：{error}", {
					error: String(error),
				}),
			});
		}
	}

	private renderWorkingTreeChanges(
		containerEl: HTMLElement,
		workingTreeChanges: Array<{ path: string; kind: string }>,
	): void {
		const panel = containerEl.createDiv({ cls: "friday-project-status-group" });
		panel.createEl("h5", {
			text: this.t("projects.sync.changesTitle", "工作区变化"),
		});
		if (workingTreeChanges.length === 0) {
			panel.createEl("p", {
				text: this.t("projects.sync.noChanges", "当前工作区无待同步变化。"),
			});
			return;
		}
		for (const change of workingTreeChanges) {
			panel.createDiv({
				cls: "friday-approval-detail",
				text: this.t("projects.sync.changeItem", "{kind}: {path}", {
					kind: this.getWorkingTreeChangeLabel(change.kind),
					path: change.path,
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

	private async populateIgnoreCandidates(containerEl: HTMLElement, project: ProjectEntry): Promise<void> {
		try {
			const candidates = await this.gitIgnoreService.listCandidates(project);
			if (candidates.length === 0) {
				return;
			}
			const panel = containerEl.createDiv({ cls: "friday-project-status-group" });
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
			containerEl.createEl("p", {
				text: this.t("projects.ignore.failed", "Ignore candidates unavailable: {error}", {
					error: String(error),
				}),
			});
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
		const effectiveModel = this.resolveEffectiveModel(activeSoulDefinition);
		const modelCapability = this.plugin.aiService.getModelCapability(effectiveModel || undefined);
		const currentSession = this.aiSessions.find((session) => session.sessionId === this.aiSessionId) ?? null;
		const panelEl = containerEl.createDiv({ cls: "friday-ai-workbench" });
		const metaEl = panelEl.createDiv({ cls: "friday-ai-focus-meta" });
		const metaCopy = metaEl.createDiv({ cls: "friday-ai-focus-copy" });
		metaCopy.createSpan({
			cls: "friday-ai-focus-eyebrow",
			text: this.t("ai.focus.label", "Chat focus"),
		});
		metaCopy.createEl("h3", {
			text: currentSession ? this.buildSessionTitle(currentSession) : this.t("ai.session.new", "+ 新会话"),
		});
		metaCopy.createEl("p", {
			cls: "friday-ai-focus-caption",
			text: this.t("ai.focus.caption", "{agent} · {vision}", {
				agent: activeSoul?.name ?? this.t("common.notSet", "Not set"),
				vision: this.resolveVisionLabel(modelCapability),
			}),
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
		const composerEl = composerWrap.createDiv({ cls: "friday-ai-composer" });
		this.composer = new MentionComposer({
			parent: composerEl,
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

		const toolbarEl = composerWrap.createDiv({ cls: "friday-ai-composer-toolbar" });
		const modelOptions = this.buildModelOptions(activeSoulDefinition);
		const groupedModelOptions = this.buildGroupedModelOptions(activeSoulDefinition);
		const selectedModelValue = this.resolveSelectedModelOptionValue(activeSoulDefinition, modelOptions);
		const modelSelect = toolbarEl.createEl("select", { cls: "friday-ai-toolbar-select" });
		modelSelect.setAttribute("aria-label", this.t("ai.model.override", "选择当前 Agent 模型"));
		for (const group of groupedModelOptions) {
			const groupEl = modelSelect.createEl("optgroup", { attr: { label: group.label } });
			for (const optionValue of group.options) {
				const option = groupEl.createEl("option");
				option.textContent = optionValue.label;
				option.value = optionValue.value;
				option.selected = optionValue.value === selectedModelValue;
			}
		}
		this.aiModelSelectEl = modelSelect;
		modelSelect.onchange = async () => {
			if (!activeSoulDefinition) {
				return;
			}
			const parsed = parseAgentModelChoice(modelSelect.value);
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
		};

		const permissionSelect = toolbarEl.createEl("select", { cls: "friday-ai-toolbar-select" });
		permissionSelect.setAttribute("aria-label", this.t("ai.permission.override", "选择当前工具权限模式"));
		for (const mode of this.buildPermissionModeOptions()) {
			const option = permissionSelect.createEl("option", { text: mode.label });
			option.value = mode.value;
			option.selected = mode.value === this.plugin.settings.agentRuntime.toolPermissionMode;
		}
		this.aiPermissionSelectEl = permissionSelect;
		permissionSelect.onchange = async () => {
			const value = permissionSelect.value;
			this.plugin.settings.agentRuntime.toolPermissionMode = value as ToolPermissionMode;
			await this.plugin.saveSettings();
			this.renderBoard();
		};

		const skillButton = toolbarEl.createEl("button", {
			cls: "friday-ai-toolbar-button",
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
			cls: "friday-ai-toolbar-button",
			text: this.t("ai.attach.contextButton", "@ Add context"),
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
			cls: "friday-ai-send-button",
			text: this.getSendButtonLabel(),
		});
		sendButton.type = "button";
		this.aiSendButtonEl = sendButton;
		sendButton.onclick = (event) => {
			this.handleSendButtonClick(event);
		};

		this.syncAiComposerControls();
		this.restoreAiMessageListScrollState(messageListEl);
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
		for (const tool of CapabilityRegistry.getInstance().listUserVisibleTools()) {
			const item = list.createDiv({ cls: "friday-control-center-item" });
			const meta = item.createDiv({ cls: "friday-control-center-item-meta" });
			meta.createDiv({ cls: "friday-control-center-item-title", text: tool.name });
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
			exec: "Run shell commands in the current runtime environment.",
		};
		return this.t(`policy.tools.desc.${tool.name}`, fallbackMap[tool.name] ?? tool.capability);
	}

	private resolveToolSkillRelationship(tool: ToolManifest): string {
		if (tool.relatedSkillCommand) {
			return this.t("policy.tools.relation.sameNameSkill", "Related skill /{command}: the tool is the low-level executor, while the skill is the higher-level workflow that decides when and how to use it.", {
				command: tool.relatedSkillCommand,
			});
		}
		return this.t("policy.tools.relation.generic", "This is a low-level runtime capability that can be reused by multiple skills or agent steps.");
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
		const item = containerEl.createDiv({ cls: "friday-control-center-item" });
		const meta = item.createDiv({ cls: "friday-control-center-item-meta" });
		const titleRow = meta.createDiv({ cls: "friday-control-center-item-title-row" });
		titleRow.createDiv({ cls: "friday-control-center-item-title", text: `/${skill.command}` });
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

	private renderInlineApprovalPanel(containerEl: HTMLElement): void {
		const pendingApprovals = this.approvalQueue.list();
		if (pendingApprovals.length === 0) {
			return;
		}
		const panel = containerEl.createDiv({ cls: "friday-ai-chat-panel friday-inline-approval-panel" });
		panel.createEl("h4", {
			text: this.t("approval.inlineTitle", "待审批工具调用"),
		});
		panel.createEl("p", {
			cls: "friday-approval-detail",
			text: this.t("approval.inlineDesc", "运行中的对话正在等待你的审批，无需切换到其他页面。"),
		});
		for (const item of pendingApprovals) {
			this.renderApprovalCard(panel, item);
		}
	}

	private startNewAiSession(): void {
		this.aiConversation = [];
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.aiQueuedPrompts = [];
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiLastCompletedRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
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

	private async switchAiSession(sessionId: string): Promise<void> {
		if (!sessionId || sessionId === this.aiSessionId || this.aiBusy) {
			return;
		}
		let target = this.aiSessions.find((session) => session.sessionId === sessionId) ?? null;
		if (!target) {
			await this.ensureAiSessionLoaded();
			target = this.aiSessions.find((session) => session.sessionId === sessionId) ?? null;
		}
		if (!target) {
			new Notice(this.t("ai.sessions.notFound", "未找到对话记录"), 4000);
			return;
		}
		this.aiSessionId = target.sessionId;
		this.aiConversation = [...target.messages];
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.aiQueuedPrompts = [];
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiLastCompletedRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
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
			this.aiLastCompletedRuntimeExecutionState = null;
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
			this.aiLastCompletedRuntimeExecutionState = null;
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

	private renderAiMessage(containerEl: HTMLElement, message: ChatMessage, isStreaming = false): void {
		const isUser = message.role === "user";
		const rowEl = containerEl.createDiv({
			cls: `friday-ai-message-row ${isUser ? "is-user" : "is-assistant"}`,
		});
		const bubbleEl = rowEl.createDiv({
			cls: `friday-ai-message ${isUser ? "is-user" : "is-assistant"}`,
		});
		const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
		const roleEl = metaEl.createSpan({
			cls: isUser ? "friday-ai-message-role" : "friday-ai-message-role friday-wordmark",
			text: isUser ? this.resolveUserDisplayName() : this.plugin.t("ai.role.assistant"),
		});
		if (!isUser) {
			roleEl.style.fontFamily = 'FridayAirbeat, "Segoe UI", sans-serif';
		}
		const contentEl = bubbleEl.createDiv({
			cls: `friday-ai-message-content${isStreaming ? " is-streaming" : ""}`,
		});
		this.renderAiMessageContent(contentEl, message);
	}

	private renderAiMessageContent(containerEl: HTMLElement, message: ChatMessage): void {
		if (message.role === "user" && message.uiMeta?.segments?.length) {
			this.renderStructuredUserMessageBody(containerEl, message.uiMeta.segments);
			return;
		}
		void MarkdownRenderer.renderMarkdown(message.content, containerEl, "", this);
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
		if (this.aiConversation.length === 0 && !this.aiStreamingPreview && !this.aiRuntimeExecutionState && pendingApprovals.length === 0) {
			const emptyEl = containerEl.createDiv({ cls: "friday-ai-empty" });
			emptyEl.createEl("h4", { text: this.plugin.t("ai.empty.title") });
			emptyEl.createEl("p", { text: this.plugin.t("ai.empty.desc") });
		}
		for (const message of this.aiConversation) {
			this.renderAiMessage(containerEl, message);
		}
		if (this.aiRuntimeExecutionState) {
			this.renderRuntimeExecutionPreview(containerEl);
		} else if (this.aiStreamingPreview) {
			this.renderAiMessage(
				containerEl,
				{
					role: "assistant",
					content: this.aiStreamingPreview,
				},
				true,
			);
		}
		for (const item of pendingApprovals) {
			this.renderApprovalMessage(containerEl, item);
		}
		if (!this.aiBusy && this.aiLastCompletedRuntimeExecutionState) {
			this.renderCompletedRuntimeDisclosure(containerEl);
		}
	}

	private syncAiLiveChatShell(): void {
		if (this.activePage !== "chat" || !this.aiMessageListEl?.isConnected) {
			return;
		}
		this.captureAiMessageListScrollState(this.aiMessageListEl);
		this.renderAiMessageList(this.aiMessageListEl);
		this.restoreAiMessageListScrollState(this.aiMessageListEl);
		this.syncAiErrorRegion();
		this.syncAiQueueHint();
		this.syncAiComposerControls();
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
		const hint = this.aiQueueHintEl.createDiv({ cls: "friday-ai-queue-hint" });
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
				cls: "friday-ai-queue-pill",
				text: this.t("ai.queue.badge", "待发送 {count}", { count: this.aiQueuedPrompts.length }),
			});
		}
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
			this.aiPermissionSelectEl.value = this.plugin.settings.agentRuntime.toolPermissionMode;
		}
	}

	private syncAiSendButtonState(): void {
		if (!this.aiSendButtonEl?.isConnected) {
			return;
		}
		this.aiSendButtonEl.textContent = this.getSendButtonLabel();
		this.aiSendButtonEl.disabled = this.isComposerDraftEmpty();
	}

	private handleSendButtonClick(event: MouseEvent): void {
		if (this.isComposerDraftEmpty()) {
			return;
		}
		if (!this.aiBusy || !this.aiSendAbortController) {
			void this.submitAiPrompt();
			return;
		}
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(this.t("ai.queue.submit", "加入队列"))
				.setIcon("list-plus")
				.onClick(() => {
					void this.submitAiPrompt();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t("ai.queue.interrupt", "中断当前回复并立即发送"))
				.setIcon("zap")
				.onClick(() => {
					this.interruptAndSubmitAiPrompt();
				}),
		);
		menu.showAtMouseEvent(event);
	}

	private interruptAndSubmitAiPrompt(): void {
		if (!this.aiBusy || !this.aiSendAbortController) {
			void this.submitAiPrompt();
			return;
		}
		const draftSnapshot = this.getComposerSnapshot();
		if (this.isPromptDocumentEmpty(this.getStructuredPromptDocument(draftSnapshot))) {
			return;
		}
		this.enqueueAiPrompt(draftSnapshot, "front");
		this.aiSendAbortController.abort();
	}

	private renderApprovalMessage(containerEl: HTMLElement, item: PendingApproval): void {
		const rowEl = containerEl.createDiv({
			cls: "friday-ai-message-row is-assistant",
		});
		const bubbleEl = rowEl.createDiv({
			cls: "friday-ai-message is-assistant friday-ai-approval-message",
		});
		const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
		const roleEl = metaEl.createSpan({
			cls: "friday-ai-message-role friday-wordmark",
			text: this.plugin.t("ai.role.assistant"),
		});
		roleEl.style.fontFamily = 'FridayAirbeat, "Segoe UI", sans-serif';
		const contentEl = bubbleEl.createDiv({
			cls: "friday-ai-message-content friday-ai-approval-content",
		});
		contentEl.createEl("h4", {
			cls: "friday-ai-approval-title",
			text: this.t("approval.chatTitle", "需要你的审批才能继续"),
		});
		contentEl.createDiv({
			cls: "friday-ai-approval-summary",
			text: this.t("approval.chatSummary", "F.R.I.D.A.Y 想要执行 {tool}：{target}", {
				tool: item.request.tool,
				target: item.request.targetPath || this.t("approval.noTarget", "(no target)"),
			}),
		});
		contentEl.createDiv({
			cls: "friday-ai-approval-detail-text",
			text: item.request.description,
		});
		const actions = contentEl.createDiv({ cls: "friday-approval-actions friday-ai-approval-actions" });
		this.addApprovalDecisionButton(actions, this.t("approval.allowOnce", "Allow once"), item.id, "allow_once", "is-allow");
		this.addApprovalDecisionButton(actions, this.t("approval.allowSession", "Allow session"), item.id, "allow_session", "is-session");
		this.addApprovalDecisionButton(actions, this.t("approval.allowAlways", "Allow always"), item.id, "allow_always", "is-always");
		this.addApprovalDecisionButton(actions, this.t("approval.deny", "Deny"), item.id, "deny", "is-deny");
	}

	private renderRuntimeExecutionPreview(containerEl: HTMLElement): void {
		const state = this.aiRuntimeExecutionState;
		if (!state) {
			return;
		}
		this.renderRuntimeExecutionCard(containerEl, state, "live");
	}

	private renderCompletedRuntimeDisclosure(containerEl: HTMLElement): void {
		if (!this.aiLastCompletedRuntimeExecutionState) {
			return;
		}
		this.renderRuntimeExecutionCard(containerEl, this.aiLastCompletedRuntimeExecutionState, "completed");
	}

	private renderRuntimeExecutionCard(
		containerEl: HTMLElement,
		state: RuntimeExecutionState,
		variant: "live" | "completed",
	): void {
		const rowEl = containerEl.createDiv({
			cls: "friday-ai-message-row is-assistant",
		});
		const bubbleEl = rowEl.createDiv({
			cls: `friday-ai-message is-assistant friday-ai-runtime-preview is-${variant}`,
		});
		const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
		const roleEl = metaEl.createSpan({
			cls: "friday-ai-message-role friday-wordmark",
			text: this.plugin.t("ai.role.assistant"),
		});
		roleEl.style.fontFamily = 'FridayAirbeat, "Segoe UI", sans-serif';
		const contentEl = bubbleEl.createDiv({
			cls: `friday-ai-message-content friday-ai-runtime-card-content${this.aiRuntimePreviewExpanded ? "" : " is-streaming"}`,
		});
		const cardEl = contentEl.createDiv({ cls: "friday-runtime-card" });
		const headerEl = cardEl.createDiv({ cls: "friday-runtime-card-header" });
		headerEl.createDiv({
			cls: "friday-runtime-card-brand",
			text: variant === "completed"
				? this.t("ai.runtime.summary.completed", "本轮工具调用记录")
				: this.t("ai.runtime.summary.title", "工具执行摘要"),
		});
		const toggleButton = headerEl.createEl("button", {
			cls: `friday-runtime-card-toggle${variant === "completed" ? " is-completed" : ""}`,
			text: this.aiRuntimePreviewExpanded
				? this.t("ai.runtime.summary.collapse", "收起")
				: variant === "completed"
					? this.t("ai.runtime.summary.viewFlow", "查看完整流程")
					: this.t("ai.runtime.summary.expand", "展开"),
		});
		toggleButton.type = "button";
		toggleButton.onclick = () => {
			this.aiRuntimePreviewExpanded = !this.aiRuntimePreviewExpanded;
			this.renderBoard();
		};
		cardEl.createEl("h4", {
			cls: "friday-runtime-card-title",
			text: state.heading,
		});
		if (state.summary) {
			cardEl.createEl("p", {
				cls: "friday-runtime-card-summary",
				text: state.summary,
			});
		}
		if (!this.aiRuntimePreviewExpanded) {
			const collapsedMeta = cardEl.createDiv({ cls: "friday-runtime-card-collapsed" });
			for (const entry of state.entries.slice(-3)) {
				collapsedMeta.createSpan({
					cls: `friday-runtime-pill is-${entry.status}`,
					text: entry.label,
				});
			}
			return;
		}
		const stageRailEl = cardEl.createDiv({ cls: "friday-runtime-stage-rail" });
		for (const stage of state.stages) {
			stageRailEl.createDiv({
				cls: `friday-runtime-stage is-${stage.status}`,
				text: stage.label,
			});
		}
		if (state.entries.length > 0) {
			const timelineEl = cardEl.createDiv({ cls: "friday-runtime-timeline" });
			for (const entry of state.entries.slice(-10)) {
				const rowEl = timelineEl.createDiv({
					cls: `friday-runtime-entry is-${entry.status} is-${entry.kind}`,
				});
				rowEl.createDiv({ cls: "friday-runtime-entry-dot" });
				const bodyEl = rowEl.createDiv({ cls: "friday-runtime-entry-body" });
				const headerEl = bodyEl.createDiv({ cls: "friday-runtime-entry-header" });
				headerEl.createSpan({
					cls: "friday-runtime-entry-label",
					text: entry.label,
				});
				if (typeof entry.step === "number" && entry.step > 0) {
					headerEl.createSpan({
						cls: "friday-runtime-entry-step",
						text: this.t("ai.runtime.execution.stepBadge", "步骤 {step}", { step: entry.step }),
					});
				}
				bodyEl.createDiv({
					cls: "friday-runtime-entry-detail",
					text: entry.detail,
				});
			}
		}
	}

	private cloneRuntimeExecutionState(state: RuntimeExecutionState | null): RuntimeExecutionState | null {
		if (!state) {
			return null;
		}
		return {
			heading: state.heading,
			summary: state.summary,
			activeContextEntryKey: state.activeContextEntryKey,
			stages: state.stages.map((stage) => ({ ...stage })),
			entries: state.entries.map((entry) => ({ ...entry })),
		};
	}

	private async submitAiPrompt(snapshotOverride?: MentionComposerSnapshot): Promise<void> {
		const draftSnapshot = snapshotOverride ? this.cloneComposerSnapshot(snapshotOverride) : this.getComposerSnapshot();
		const draftDocument = this.getStructuredPromptDocument(draftSnapshot);
		const rawPrompt = draftDocument.text.trim();
		if (this.isPromptDocumentEmpty(draftDocument)) {
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
		if (!this.plugin.aiService.isConfigured()) {
			const message = this.plugin.t("ai.error.notConfigured");
			this.aiLastError = message;
			new Notice(message, 5000);
			this.plugin.openSettingsTab();
			this.renderBoard();
			return;
		}

		const currentFilePath = this.app.workspace.getActiveFile()?.path ?? "";
		const mentionResolution = await this.mentionResolver.resolve({
			document: draftDocument,
			currentFilePath,
			activeProjectRoot: this.getActiveProjectEntry()?.boundaryPath ?? "",
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
		if (mentionResolution.errors.length > 0) {
			this.aiLastError = mentionResolution.errors.map((item) => item.message).join(" ");
			this.syncAiLiveChatShell();
			return;
		}
		const promptMentionContext = this.buildPromptMentionContext(mentionResolution);
		const userFacingPrompt = rawPrompt || this.t("ai.prompt.useMentions", "请基于已引用内容继续处理。");
		const activeSoulDefinition = this.plugin.soulStore.getSoulSync(activeSoul.id);
		const effectiveModel = this.resolveEffectiveModel(activeSoulDefinition);
		const resolution = this.buildInvocationResolver().resolveChatPrompt(rawPrompt);
		if (resolution.type === "invalid") {
			this.aiLastError = resolution.error;
			this.syncAiLiveChatShell();
			return;
		}

		const history = [...this.aiConversation];
		this.aiConversation.push({
			role: "user",
			content: userFacingPrompt,
			uiMeta: this.buildUserMessageUiMeta({
				snapshot: draftSnapshot,
				mentionResolution,
				resolution,
			}),
		});
		this.aiDraft = "";
		this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();
		this.composer?.replaceSnapshot(this.aiComposerSnapshot);
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
		this.aiBusy = true;
		this.aiForceScrollToBottomOnce = true;
		this.syncAiLiveChatShell();

		try {
			let modelOverride = effectiveModel || undefined;
			let runtimePrompt = rawPrompt;
			let extraSystemContext = "";
			let allowedTools: string[] | undefined;
			let allowedModels: string[] | undefined;
			let assistantText = "";
			let shouldStreamFinalText = false;
			if (resolution.type === "catalog") {
				const skills = await this.plugin.skillCommandService.listSkills();
				assistantText = this.buildSkillCatalogReply(skills);
				shouldStreamFinalText = true;
			} else {
				const decision = await this.plugin.executionPlanner.plan(resolution, { currentFilePath });
				runtimePrompt = decision.runtimePrompt;
				allowedTools = decision.allowedTools?.length ? decision.allowedTools : undefined;
				allowedModels = decision.allowedModels?.length ? decision.allowedModels : undefined;
				if (!assistantText && this.plugin.settings.agentRuntime.toolRuntimeEnabled) {
					const runtimeResult = await this.plugin.executionOrchestrator.execute(decision, {
						agentId: activeSoul.id,
						conversation: history,
						modelOverride,
						currentFilePath,
						mentionContext: promptMentionContext,
						allowedTools,
						onProgress: (event) => {
							this.handleRuntimeProgress(event);
						},
					});
					assistantText = this.buildRuntimeReply(runtimeResult);
					shouldStreamFinalText = true;
				} else if (!assistantText) {
					extraSystemContext = await this.plugin.executionOrchestrator.buildSystemContext(
						decision,
						"",
					);
					const mentionSystemContext = this.renderMentionSystemContext(promptMentionContext);
					extraSystemContext = mentionSystemContext
						? `${extraSystemContext}\n\n${mentionSystemContext}`.trim()
						: extraSystemContext;
				}
			}

			if (modelOverride && allowedModels && allowedModels.length > 0 && !allowedModels.includes(modelOverride.trim())) {
				throw new Error(this.t("ai.error.modelBlocked", "Current model is not allowed for this slash command."));
			}

			runtimePrompt = runtimePrompt.trim() || this.t("ai.prompt.useMentions", "请基于已引用内容继续处理。");

			if (!assistantText) {
				const modelMessages: ChatMessage[] = [
					...history,
					...(extraSystemContext
						? [{ role: "system" as const, content: extraSystemContext }]
						: []),
					{
						role: "user",
						content: runtimePrompt,
					},
				];
				if (this.plugin.settings.llm.enableStreaming) {
					this.aiSendAbortController?.abort();
					this.aiSendAbortController = new AbortController();
					assistantText = await this.plugin.aiService.chatStream(modelMessages, {
						modelOverride,
						signal: this.aiSendAbortController.signal,
						onDelta: (delta) => {
							this.aiStreamingPreview += delta;
							const now = Date.now();
							if (now - this.aiRuntimeLastRenderAt >= 120) {
								this.aiRuntimeLastRenderAt = now;
								this.aiForceScrollToBottomOnce = true;
								this.syncAiLiveChatShell();
							}
						},
					});
				} else {
					assistantText = await this.plugin.aiService.chat(modelMessages, { modelOverride });
				}
			}

			const normalizedAssistantText = assistantText.trim() || this.t("ai.runtime.emptyResponse", "(No valid model response)");
			if (shouldStreamFinalText && this.plugin.settings.llm.enableStreaming) {
				await this.streamAssistantText(normalizedAssistantText);
			}
			this.aiLastCompletedRuntimeExecutionState = this.cloneRuntimeExecutionState(this.aiRuntimeExecutionState);

			this.aiConversation.push({
				role: "assistant",
				content: normalizedAssistantText,
			});
			await this.persistConversation();
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				this.aiLastError = this.t("ai.action.cancelled", "Action cancelled.");
			} else {
				const message = error instanceof Error ? error.message : String(error ?? "");
				this.aiLastError = message.trim() || this.t("common.unknownError", "Unknown error");
				new Notice(
					this.t("ai.notice.chatFailed", "F.R.I.D.A.Y chat failed: {error}", { error: this.aiLastError }),
					7000,
				);
			}
		} finally {
			this.aiBusy = false;
			this.aiStreamingPreview = "";
			this.aiRuntimeExecutionState = null;
			this.aiSendAbortController = null;
			this.aiRuntimeLastRenderAt = 0;
			this.aiForceScrollToBottomOnce = true;
			this.syncAiLiveChatShell();
			await this.flushQueuedAiPrompt();
		}
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
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			const resolution = this.plugin.executionEventRouter.routeToRuntime({
				type: "knowledge.compile_requested",
				source: "project_action",
				projectId: this.getActiveProjectEntry()?.projectId,
				prompt: "Compile the active project wiki now.",
				currentFilePath: this.app.workspace.getActiveFile()?.path,
			});
			if (resolution.type !== "runtime") {
				throw new Error("Compile button could not be resolved to a runtime invocation.");
			}
			const decision = await this.plugin.executionPlanner.plan(resolution, {
				currentFilePath: this.app.workspace.getActiveFile()?.path,
			});
			const runtimeResult = await this.plugin.executionOrchestrator.execute(decision, {
				agentId: activeSoul.id,
				conversation: [],
				currentFilePath: this.app.workspace.getActiveFile()?.path,
				onProgress: (event) => {
					this.handleRuntimeProgress(event);
				},
			});
			const reply = this.buildRuntimeReply(runtimeResult);
			if (this.plugin.settings.llm.enableStreaming) {
				await this.streamAssistantText(reply);
			}
			this.aiLastCompletedRuntimeExecutionState = this.cloneRuntimeExecutionState(this.aiRuntimeExecutionState);
			this.aiConversation.push({ role: "assistant", content: reply });
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
			this.aiStreamingPreview = "";
			this.aiRuntimeExecutionState = null;
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
			message: this.t("ai.runtime.progress.compileStart", "F.R.I.D.A.Y 正在编译 Wiki…（{step}）", { step: "1" }),
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
			message: this.t("ai.runtime.progress.compileDone", "F.R.I.D.A.Y 已完成 Wiki 编译（{step}）", { step: "1" }),
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

	private async streamAssistantText(text: string): Promise<void> {
		if (!text) {
			return;
		}
		this.aiRuntimeExecutionState = null;
		const chunkSize = Math.max(8, Math.min(48, Math.ceil(text.length / 80)));
		const delay = 18;
		this.aiStreamingPreview = "";
		for (let index = 0; index < text.length; index += chunkSize) {
			this.aiStreamingPreview = text.slice(0, Math.min(text.length, index + chunkSize));
			const now = Date.now();
			if (now - this.aiRuntimeLastRenderAt >= 50) {
				this.aiRuntimeLastRenderAt = now;
				this.aiForceScrollToBottomOnce = true;
				this.syncAiLiveChatShell();
			}
			// Yield to UI thread to present progressive text updates.
			await this.sleep(delay);
		}
		this.aiForceScrollToBottomOnce = true;
		this.syncAiLiveChatShell();
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	private handleRuntimeProgress(event: RuntimeProgressEvent): void {
		if (!this.aiRuntimeExecutionState) {
			this.aiRuntimePreviewExpanded = false;
		}
		this.aiRuntimeExecutionState = this.buildRuntimeExecutionState(event, this.aiRuntimeExecutionState);
		const forceRender = event.phase === "tool_call" || event.phase === "tool_result" || event.phase === "error" || event.phase === "done";
		const now = Date.now();
		if (forceRender || now - this.aiRuntimeLastRenderAt >= 120) {
			this.aiRuntimeLastRenderAt = now;
			this.aiForceScrollToBottomOnce = true;
			this.syncAiLiveChatShell();
		}
	}

	private buildRuntimeReply(result: RuntimeTurnResult): string {
		const normalizedAssistantText = this.normalizeRuntimeAssistantText(result.assistantText);
		if (normalizedAssistantText.trim() && !this.isIntermediateRuntimeReply(normalizedAssistantText)) {
			const parts = [normalizedAssistantText.trim()];
			if (result.parseError) {
				parts.push(
					"",
					this.t("ai.runtime.parseHint", "Runtime parse hint: {error}", {
						error: result.parseError,
					}),
				);
			}
			return parts.join("\n");
		}

		const parts: string[] = [];
		if (result.runtimeProfile) {
			parts.push(
				this.t("ai.runtime.profile", "Runtime profile: {profile}", {
					profile: result.runtimeProfile.id,
				}),
			);
		}
		if (result.turnId) {
			parts.push(this.t("ai.runtime.turnId", "Turn: {id}", { id: result.turnId }));
		}
		if (result.stepTraces?.length) {
			parts.push(
				this.t("ai.runtime.steps", "Step traces: {count}", {
					count: result.stepTraces.length,
				}),
			);
		}
		if (result.contextSummary) {
			parts.push(
				this.t("ai.runtime.contextBudget", "Context budget: used={used}, soft={soft}, hard={hard}", {
					used: result.contextSummary.used,
					soft: result.contextSummary.softLimit,
					hard: result.contextSummary.hardLimit,
				}),
			);
			parts.push(
				this.t("ai.runtime.contextFlags", "Context sources: wiki={wiki}, memory={memory}, autoSkill={autoSkill}, trimmed={trimmed}", {
					wiki: result.contextSummary.hasWikiContext,
					memory: result.contextSummary.hasMemoryContext,
					autoSkill: result.contextSummary.hasAutoSkillContext,
					trimmed: result.contextSummary.trimmedChannels.join(",") || "none",
				}),
			);
		}
		if (normalizedAssistantText.trim() && !this.isIntermediateRuntimeReply(normalizedAssistantText)) {
			if (parts.length > 0) {
				parts.push("");
			}
			parts.push(normalizedAssistantText.trim());
		}
		if (result.parseError) {
			parts.push(
				this.t("ai.runtime.parseHint", "Runtime parse hint: {error}", {
					error: result.parseError,
				}),
			);
		}
		if (result.traces.length > 0) {
			parts.push(this.t("ai.runtime.traceTitle", "工具执行记录："));
			for (const trace of result.traces) {
				const status = trace.ok
					? this.t("ai.runtime.traceStatus.ok", "成功")
					: this.t("ai.runtime.traceStatus.fail", "失败");
				const summary = trace.summary || trace.error || this.t("common.unknownError", "Unknown error");
				const detail = trace.targetPath ? `（${trace.targetPath}）` : "";
				parts.push(`- ${trace.tool}${detail}：${status} · ${summary}`);
			}
		}
		return parts.join("\n");
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
			lines.push(`- /${skill.command}: ${skill.description}`);
		}
		lines.push("");
		lines.push(this.t("ai.skillCatalog.usage", "Usage: /skill <skill-name> <task>"));
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

	private getStructuredPromptDocument(snapshot: MentionComposerSnapshot = this.getComposerSnapshot()): MentionDocumentSnapshot {
		if (snapshot.tokens.length > 0 || snapshot.doc) {
			return {
				text: snapshot.text,
				tokens: snapshot.tokens,
			};
		}
		return parseLegacyMentionMarkup(snapshot.text || this.aiDraft);
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

	private isPromptDocumentEmpty(document: MentionDocumentSnapshot): boolean {
		return document.text.trim().length === 0 && document.tokens.length === 0;
	}

	private isComposerDraftEmpty(): boolean {
		return this.isPromptDocumentEmpty(this.getStructuredPromptDocument());
	}

	private enqueueAiPrompt(snapshot: MentionComposerSnapshot, position: "front" | "back" = "back"): void {
		const queuedSnapshot = this.cloneComposerSnapshot(snapshot);
		if (this.isPromptDocumentEmpty(this.getStructuredPromptDocument(queuedSnapshot))) {
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
		if (!this.aiBusy) {
			return this.plugin.t("ai.send");
		}
		return this.isComposerDraftEmpty()
			? this.t("ai.working", "工作中")
			: this.aiSendAbortController
				? this.t("ai.queue.options", "发送选项")
				: this.t("ai.queue.submit", "加入队列");
	}

	private buildPromptMentionContext(mentionResolution: MentionResolutionResult) {
		if (mentionResolution.entries.length === 0) {
			return undefined;
		}
		return {
			...mentionResolution.summary,
			entries: mentionResolution.entries,
		};
	}

	private renderMentionSystemContext(
		mentionContext: ReturnType<DailyBoardView["buildPromptMentionContext"]>,
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
						label: item.label,
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
			return this.getMentionableFiles(normalizedQuery).map((file) => ({
				label: file.basename,
				description: file.path,
				kind: "mention_token" as const,
				trigger: "@" as const,
				category: "note" as const,
				token: this.createMentionToken("note", file.path),
			}));
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
		items.push(...this.getMentionableFiles(normalizedQuery).map((file) => ({
			label: file.basename,
			description: file.path,
			kind: "mention_token" as const,
			trigger: "@" as const,
			category: "note" as const,
			token: this.createMentionToken("note", file.path),
		})));
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
		return {
			label: this.t("ai.mention.option.activeNote", "当前笔记"),
			description: this.t("ai.mention.category.activeNote", "Use the active note at send time"),
			kind: "mention_token",
			trigger: "@",
			category: "active_note",
			token: this.createMentionToken("active_note"),
		};
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
		const files = this.app.vault.getMarkdownFiles();
		const scopePrefixes = resolveMentionScopePrefixes(
			activeProject ?? undefined,
			files.map((file) => file.path),
		);
		return this.app.vault.getMarkdownFiles()
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
		const segments = this.buildUserMessageSegments(input.snapshot, input.mentionResolution, input.resolution);
		if (segments.length === 0) {
			return undefined;
		}
		return {
			segments,
		};
	}

	private buildUserMessageSegments(
		snapshot: MentionComposerSnapshot,
		mentionResolution: MentionResolutionResult,
		resolution: { type: string; requestedSkillName?: string },
	): ChatMessageUiSegment[] {
		const contextByTokenId = new Map(
			mentionResolution.entries.map((entry) => [entry.tokenId, entry] as const),
		);
		const parts = listMentionComposerParts(restoreMentionComposerDoc(snapshot));
		const segments: ChatMessageUiSegment[] = [];
		for (const part of parts) {
			if (part.type === "text") {
				if (part.text) {
					segments.push({ type: "text", text: part.text });
				}
				continue;
			}
			const mention = part.mention;
			if (mention.type === "skill") {
				const skillName = mention.path?.trim() || resolution.requestedSkillName?.trim() || "skill";
				segments.push({
					type: "token",
					token: {
						kind: "skill",
						label: `Skill /${skillName}`,
						tokenType: "skill",
						target: skillName,
					},
				});
				continue;
			}
			const entry = contextByTokenId.get(mention.id);
			segments.push({
				type: "token",
				token: {
					kind: "context",
					label: entry ? this.formatMentionBadgeLabel(entry) : formatMentionTokenLabel(mention),
					tokenType: mention.type,
					target: mention.path?.trim() || entry?.target,
				},
			});
		}
		return this.normalizeUserMessageSegments(segments);
	}

	private normalizeUserMessageSegments(segments: ChatMessageUiSegment[]): ChatMessageUiSegment[] {
		const next: ChatMessageUiSegment[] = [];
		for (const segment of segments) {
			if (segment.type === "text") {
				if (!segment.text) {
					continue;
				}
				const previous = next[next.length - 1];
				if (previous?.type === "text") {
					previous.text += segment.text;
				} else {
					next.push({ ...segment });
				}
				continue;
			}
			next.push(segment);
		}
		return next;
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
		const fallbackGroupModels = this.plugin.settings.llm.groupConfig.model?.trim()
			? [{ id: this.plugin.settings.llm.groupConfig.model.trim(), label: this.plugin.settings.llm.groupConfig.model.trim() }]
			: [];
		return buildAgentModelCatalogFromSettings(this.plugin.settings.llm, groupProvider?.models ?? fallbackGroupModels);
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
	): Array<{ label: string; options: Array<{ value: string; label: string }> }> {
		const flatOptions = this.buildModelOptions(activeSoul);
		const groups = new Map<"openai" | "group", { label: string; options: Array<{ value: string; label: string }> }>();
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
			{ value: "auto", label: this.t("settings.agent.permissionMode.auto", "🚀 全自动") },
			{ value: "standard", label: this.t("settings.agent.permissionMode.standard", "🛡️ 标准") },
			{ value: "strict", label: this.t("settings.agent.permissionMode.strict", "🔒 严格") },
		];
	}

	private resolvePermissionModeLabel(mode: ToolPermissionMode): string {
		switch (mode) {
			case "auto":
				return this.t("settings.agent.permissionMode.auto", "🚀 全自动");
			case "strict":
				return this.t("settings.agent.permissionMode.strict", "🔒 严格");
			default:
				return this.t("settings.agent.permissionMode.standard", "🛡️ 标准");
		}
	}

	private renderAiQueueHint(containerEl: HTMLElement): void {
		if (!this.aiBusy && this.aiQueuedPrompts.length === 0) {
			return;
		}
		const hint = containerEl.createDiv({ cls: "friday-ai-queue-hint" });
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
				cls: "friday-ai-queue-pill",
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
		const bar = containerEl.createDiv({ cls: "friday-ai-override-bar" });
		bar.createSpan({
			text: this.t("ai.override.summary", "临时覆写: {value}", {
				value: parts.join(" · "),
			}),
		});
		const clearButton = bar.createEl("button", {
			cls: "friday-ai-override-clear",
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
			return assistant;
		}
		const parsed = parseRuntimeEnvelopeText(trimmed);
		if (parsed?.type === "tool_call") {
			return this.t("ai.runtime.toolCallFallback", "F.R.I.D.A.Y 正在继续调用工具。");
		}
		return raw;
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

	private buildRuntimeExecutionState(
		event: RuntimeProgressEvent,
		previous: RuntimeExecutionState | null,
	): RuntimeExecutionState {
		const next: RuntimeExecutionState = previous
			? {
				heading: previous.heading,
				summary: previous.summary,
				stages: previous.stages.map((stage) => ({ ...stage })),
				entries: previous.entries.map((entry) => ({ ...entry })),
				activeContextEntryKey: previous.activeContextEntryKey,
			}
			: {
				heading: this.t("ai.runtime.execution.preparing", "正在准备上下文"),
				summary: this.t("ai.runtime.execution.preparingSummary", "先整理当前会话、项目与知识范围。"),
				stages: [
					{ key: "context", label: this.t("ai.runtime.execution.stage.context", "上下文"), status: "running" },
					{ key: "analysis", label: this.t("ai.runtime.execution.stage.analysis", "分析"), status: "pending" },
					{ key: "tools", label: this.t("ai.runtime.execution.stage.tools", "执行"), status: "pending" },
					{ key: "finalize", label: this.t("ai.runtime.execution.stage.finalize", "回复"), status: "pending" },
				],
				entries: [],
				activeContextEntryKey: null,
			};

		switch (event.phase) {
			case "start":
				next.heading = this.t("ai.runtime.execution.preparing", "正在准备上下文");
				next.summary = this.t("ai.runtime.execution.preparingSummary", "先整理当前会话、项目与知识范围。");
				this.setRuntimeStageStatus(next, "context", "running");
				this.setRuntimeStageStatus(next, "analysis", "pending");
				this.setRuntimeStageStatus(next, "tools", "pending");
				this.setRuntimeStageStatus(next, "finalize", "pending");
				break;
			case "context": {
				this.setRuntimeStageStatus(next, "context", "running");
				const entryKey = `context:${event.contextKey ?? "general"}`;
				if (next.activeContextEntryKey && next.activeContextEntryKey !== entryKey) {
					this.updateRuntimeEntry(next, next.activeContextEntryKey, { status: "ok" });
				}
				next.activeContextEntryKey = entryKey;
				this.upsertRuntimeEntry(next, {
					key: entryKey,
					kind: "context",
					label: this.buildContextEntryLabel(event.contextKey),
					detail: event.message,
					status: "running",
				});
				next.heading = this.buildContextHeading(event.contextKey);
				next.summary = event.message;
				break;
			}
			case "model_request":
				this.completeActiveContextEntry(next);
				this.setRuntimeStageStatus(next, "context", next.entries.some((entry) => entry.kind === "context") ? "ok" : "pending");
				this.setRuntimeStageStatus(next, "analysis", "running");
				next.heading = this.t("ai.runtime.execution.planning", "正在分析下一步");
				next.summary = this.hasSuccessfulToolEntry(next)
					? this.t("ai.runtime.execution.planningWithEvidence", "已拿到部分证据，正在决定下一步。")
					: this.t("ai.runtime.execution.planningSummary", "正在判断要检索哪些资料。");
				this.upsertRuntimeEntry(next, {
					key: `model:${event.step ?? 0}`,
					kind: "model",
					label: this.t("ai.runtime.execution.modelLabel", "分析第 {step} 步", {
						step: event.step ?? 0,
					}),
					detail: event.message,
					status: "running",
					step: event.step,
				});
				break;
			case "model_response":
				this.updateRuntimeEntry(next, `model:${event.step ?? 0}`, {
					status: "ok",
					detail: event.message,
				});
				next.heading = this.t("ai.runtime.execution.modelReady", "已完成本轮判断");
				next.summary = this.t("ai.runtime.execution.modelReadySummary", "下一步动作已经确定。");
				break;
			case "tool_approval":
				this.setRuntimeStageStatus(next, "tools", "running");
				next.heading = this.t("ai.runtime.execution.permission", "正在确认操作边界");
				next.summary = event.message || this.t("ai.runtime.execution.permissionSummary", "正在核对本次工具调用是否可执行。");
				this.upsertRuntimeEntry(next, {
					key: `approval:${event.step ?? 0}:${event.tool ?? "tool"}`,
					kind: "system",
					label: this.t("ai.runtime.execution.approvalLabel", "权限确认"),
					detail: next.summary,
					status: "running",
					step: event.step,
				});
				break;
			case "tool_call": {
				this.setRuntimeStageStatus(next, "analysis", "ok");
				this.setRuntimeStageStatus(next, "tools", "running");
				next.heading = this.isKnowledgeTool(event.tool)
					? this.t("ai.runtime.execution.retrieve", "正在检索资料")
					: this.t("ai.runtime.execution.runTool", "正在执行工具");
				next.summary = this.isKnowledgeTool(event.tool)
					? this.t("ai.runtime.execution.retrieveSummary", "正在定位相关文件和证据。")
					: event.message;
				this.upsertRuntimeEntry(next, {
					key: this.buildRuntimeEntryKey(event),
					kind: "tool",
					label: this.buildRuntimeEntryLabel(event),
					detail: event.message || this.buildRuntimeEntryLabel(event),
					status: "running",
					step: event.step,
				});
				break;
			}
			case "tool_result": {
				const status: RuntimeExecutionStatus = event.status === "ok" ? "ok" : "failed";
				this.upsertRuntimeEntry(next, {
					key: this.buildRuntimeEntryKey(event),
					kind: "tool",
					label: this.buildRuntimeEntryLabel(event),
					detail: event.summary || event.message || this.buildRuntimeEntryLabel(event),
					status,
					step: event.step,
				});
				next.heading = status === "ok"
					? this.t("ai.runtime.execution.evidenceReady", "已获取新证据")
					: this.t("ai.runtime.execution.adjusting", "正在调整检索路径");
				next.summary = status === "ok"
					? this.t("ai.runtime.execution.evidenceSummary", "已定位到相关资料，继续整理证据。")
					: event.summary || event.message || this.t("ai.runtime.execution.adjustingSummary", "刚刚跳过一次无效尝试，正在换路径继续检索。");
				break;
			}
			case "fallback":
				this.upsertRuntimeEntry(next, {
					key: `system:fallback:${next.entries.length}`,
					kind: "system",
					label: this.t("ai.runtime.execution.fallbackLabel", "兼容模式"),
					detail: event.message || this.t("ai.runtime.execution.fallbackSummary", "原生工具调用不可用，切换到兼容执行链路。"),
					status: "failed",
				});
				next.heading = this.t("ai.runtime.execution.fallback", "正在切换兼容模式");
				next.summary = event.message || this.t("ai.runtime.execution.fallbackSummary", "原生工具调用不可用，切换到兼容执行链路。");
				break;
			case "done":
				this.completeActiveContextEntry(next);
				if (this.stageHasEntries(next, "context")) this.setRuntimeStageStatus(next, "context", "ok");
				if (this.stageHasEntries(next, "analysis")) this.setRuntimeStageStatus(next, "analysis", "ok");
				if (this.stageHasEntries(next, "tools")) this.setRuntimeStageStatus(next, "tools", "ok");
				this.setRuntimeStageStatus(next, "finalize", "ok");
				next.heading = this.t("ai.runtime.execution.finalize", "正在整理最终回复");
				next.summary = this.t("ai.runtime.execution.finalizeSummary", "证据已齐，正在生成最终答复。");
				this.upsertRuntimeEntry(next, {
					key: "system:done",
					kind: "system",
					label: this.t("ai.runtime.execution.finalizeLabel", "生成回复"),
					detail: next.summary,
					status: "ok",
				});
				break;
			case "error":
				this.completeActiveContextEntry(next, "failed");
				this.setRuntimeStageStatus(next, "finalize", "failed");
				next.heading = this.t("ai.runtime.execution.failed", "执行失败");
				next.summary = event.message || this.t("ai.runtime.execution.failedSummary", "运行时发生异常，请查看详情。");
				this.upsertRuntimeEntry(next, {
					key: `system:error:${next.entries.length}`,
					kind: "system",
					label: this.t("ai.runtime.execution.errorLabel", "运行异常"),
					detail: next.summary,
					status: "failed",
				});
				break;
			default:
				break;
		}

		next.entries = next.entries.slice(-12);
		return next;
	}

	private setRuntimeStageStatus(
		state: RuntimeExecutionState,
		stageKey: RuntimeExecutionStageKey,
		status: RuntimeExecutionStatus,
	): void {
		const stage = state.stages.find((item) => item.key === stageKey);
		if (stage) {
			stage.status = status;
		}
	}

	private upsertRuntimeEntry(state: RuntimeExecutionState, entry: RuntimeExecutionEntry): void {
		const existing = state.entries.find((item) => item.key === entry.key);
		if (existing) {
			existing.label = entry.label;
			existing.detail = entry.detail;
			existing.status = entry.status;
			existing.kind = entry.kind;
			existing.step = entry.step;
			return;
		}
		state.entries.push(entry);
	}

	private updateRuntimeEntry(
		state: RuntimeExecutionState,
		entryKey: string,
		patch: Partial<Pick<RuntimeExecutionEntry, "label" | "detail" | "status" | "step">>,
	): void {
		const existing = state.entries.find((item) => item.key === entryKey);
		if (!existing) {
			return;
		}
		if (patch.label !== undefined) existing.label = patch.label;
		if (patch.detail !== undefined) existing.detail = patch.detail;
		if (patch.status !== undefined) existing.status = patch.status;
		if (patch.step !== undefined) existing.step = patch.step;
	}

	private completeActiveContextEntry(
		state: RuntimeExecutionState,
		status: RuntimeExecutionStatus = "ok",
	): void {
		if (!state.activeContextEntryKey) {
			return;
		}
		this.updateRuntimeEntry(state, state.activeContextEntryKey, { status });
		state.activeContextEntryKey = null;
	}

	private stageHasEntries(state: RuntimeExecutionState, stageKey: RuntimeExecutionStageKey): boolean {
		switch (stageKey) {
			case "context":
				return state.entries.some((entry) => entry.kind === "context");
			case "analysis":
				return state.entries.some((entry) => entry.kind === "model");
			case "tools":
				return state.entries.some((entry) => entry.kind === "tool");
			case "finalize":
				return state.entries.some((entry) => entry.key === "system:done");
			default:
				return false;
		}
	}

	private hasSuccessfulToolEntry(state: RuntimeExecutionState): boolean {
		return state.entries.some((entry) => entry.kind === "tool" && entry.status === "ok");
	}

	private buildRuntimeEntryKey(event: RuntimeProgressEvent): string {
		return `${event.step ?? 0}:${event.tool ?? "runtime"}:${event.targetPath ?? ""}`;
	}

	private buildRuntimeEntryLabel(event: RuntimeProgressEvent): string {
		const tool = event.tool ?? "tool";
		const targetPath = (event.targetPath ?? "").trim();
		const leaf = targetPath ? targetPath.split("/").filter(Boolean).pop() ?? targetPath : "";
		switch (tool) {
			case "search_text":
			case "grep":
				return this.t("ai.runtime.execution.searchLabel", "搜索 {path}", {
					path: leaf || targetPath || this.t("ai.runtime.execution.projectScope", "当前项目"),
				});
			case "glob":
				return this.t("ai.runtime.execution.globLabel", "匹配 {path}", {
					path: leaf || targetPath || this.t("ai.runtime.execution.projectScope", "当前项目"),
				});
			case "read":
				return this.t("ai.runtime.execution.readLabel", "读取 {path}", {
					path: leaf || targetPath || this.t("ai.runtime.execution.targetFile", "目标文件"),
				});
			case "ls":
				return this.t("ai.runtime.execution.listLabel", "查看 {path}", {
					path: leaf || targetPath || this.t("ai.runtime.execution.projectScope", "当前项目"),
				});
			case "exec":
				return this.t("ai.runtime.execution.commandLabel", "执行命令");
			default:
				return this.t("ai.runtime.execution.toolLabel", "执行 {tool}", { tool });
		}
	}

	private buildContextHeading(contextKey: RuntimeProgressEvent["contextKey"]): string {
		switch (contextKey) {
			case "instructions":
				return this.t("ai.runtime.execution.context.instructions", "正在加载规则与画像");
			case "skills":
				return this.t("ai.runtime.execution.context.skills", "正在匹配技能与约束");
			case "wiki":
				return this.t("ai.runtime.execution.context.wiki", "正在检索项目知识");
			case "memory":
				return this.t("ai.runtime.execution.context.memory", "正在加载记忆");
			case "compact":
				return this.t("ai.runtime.execution.context.compact", "正在压缩上下文");
			default:
				return this.t("ai.runtime.execution.preparing", "正在准备上下文");
		}
	}

	private buildContextEntryLabel(contextKey: RuntimeProgressEvent["contextKey"]): string {
		switch (contextKey) {
			case "instructions":
				return this.t("ai.runtime.execution.entry.instructions", "项目规则");
			case "skills":
				return this.t("ai.runtime.execution.entry.skills", "技能匹配");
			case "wiki":
				return this.t("ai.runtime.execution.entry.wiki", "Wiki 检索");
			case "memory":
				return this.t("ai.runtime.execution.entry.memory", "记忆加载");
			case "compact":
				return this.t("ai.runtime.execution.entry.compact", "上下文压缩");
			default:
				return this.t("ai.runtime.execution.entry.context", "上下文");
		}
	}

	private isKnowledgeTool(tool: string | undefined): boolean {
		return ["ls", "read", "grep", "search_text", "glob"].includes(tool ?? "");
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
				return;
			}
		}

		const latest = sessions[0];
		if (latest) {
			this.aiSessionId = latest.sessionId;
			this.aiConversation = [...latest.messages];
			return;
		}

		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiConversation = [];
	}

	private async persistConversation(): Promise<void> {
		const activeSoul = this.plugin.getActiveSoul();
		if (!activeSoul || this.aiConversation.length === 0) {
			return;
		}
		if (!this.aiSessionId) {
			this.aiSessionId = this.plugin.conversationService.createSessionId();
		}
		const saved = await this.plugin.conversationService.saveSession({
			soulId: activeSoul.id,
			projectId: this.plugin.settings.activeProjectId || undefined,
			sessionId: this.aiSessionId,
			messages: this.aiConversation,
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

	private addPageButton(containerEl: HTMLElement, label: string, action: () => Promise<void>): void {
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
	}

	private resolveVisionLabel(modelName: { model: string; vision: "supported" | "unsupported" | "unknown" }): string {
		if (modelName.vision === "supported") {
			return this.plugin.t("vision.supported", { model: modelName.model });
		}
		if (modelName.vision === "unsupported") {
			return this.plugin.t("vision.unsupported", { model: modelName.model });
		}
		return this.plugin.t("vision.unknown", { model: modelName.model });
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


