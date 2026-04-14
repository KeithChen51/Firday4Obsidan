import {
	ItemView,
	MarkdownRenderer,
	Notice,
	TFile,
	ToggleComponent,
	setIcon,
	WorkspaceLeaf,
} from "obsidian";
import { ApprovalQueue, type PendingApproval } from "../features/workbench/ApprovalQueue";
import {
	buildDefaultProjectRootPath,
	type ProjectEditorDraft,
	submitProjectDraft,
} from "../features/workbench/ProjectEditorService";
import { TOOL_MANIFESTS, type ToolManifest } from "../platform/tools/ToolManifestCatalog";
import { buildSlashSuggestions } from "../core/commands/SlashSuggestionService";
import { extractRuntimeAssistantText, parseRuntimeEnvelopeText } from "../core/orchestrator/RuntimeEnvelopeParser";
import { ConversationSession } from "../services/ConversationService";
import {
	RuntimeProgressEvent,
	RuntimeTurnResult,
	RuntimeWikiCompileSummary,
} from "../services/AgentRuntimeService";
import { ChatMessage } from "../services/AIService";
import type { SkillDescriptor } from "../services/SkillCommandService";
import type { ToolPermissionMode } from "../types/agent";
import type { FridayPluginApi } from "../types/plugin";
import { ProjectEntry, ProjectMember, SyncResult } from "../types/project";
import { InvocationResolver } from "../core/execution/InvocationResolver";
import { MentionDropdown, type MentionSuggestion } from "./components/MentionDropdown";

export const VIEW_TYPE_DAILY_BOARD = "friday-daily-board";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

type RuntimeExecutionStatus = "pending" | "running" | "ok" | "failed";
type RuntimeExecutionStageKey = "context" | "analysis" | "tools" | "finalize";
type RuntimeExecutionEntryKind = "context" | "model" | "tool" | "subagent" | "system";

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

export class DailyBoardView extends ItemView {
	private refreshTimer: number | null = null;
	private activePage: "chat" | "projects" | "checks" = "chat";
	private readonly approvalQueue = new ApprovalQueue();
	private pendingProjectRemoval: ProjectEntry | null = null;
	private memberEditorProjectSlug = "";
	private memberEditorMembers: ProjectMember[] = [];
	private memberEditorNewUserId = "";
	private memberEditorNewRole: ProjectMember["role"] = "editor";
	private projectEditorDraft: ProjectEditorDraft | null = null;
	private projectEditorInitialSlug = "";
	private projectEditorError = "";

	private aiConversation: ChatMessage[] = [];
	private aiSessions: ConversationSession[] = [];
	private aiSessionId = "";
	private aiSessionNavCollapsed = true;
	private aiDraft = "";
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
	private aiSessionModelOverride = "";
	private aiSessionPermissionOverride: ToolPermissionMode | "" = "";
	private aiSessionManageMode = false;
	private aiSessionSelection = new Set<string>();
	private aiSessionRenameId = "";
	private aiSessionRenameDraft = "";

	constructor(leaf: WorkspaceLeaf, private readonly plugin: FridayPluginApi) {
		super(leaf);
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
		await this.ensureActiveProjectInitialized();
		await this.ensureAiSessionLoaded();
		await this.safeRenderBoard();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.approvalQueue.clearWithDecision("deny");
		this.plugin.toolApprovalService.clearPromptHandler();
		this.aiSendAbortController?.abort();
		this.aiSendAbortController = null;
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
		this.contentEl.empty();

		const shell = this.contentEl.createDiv({ cls: "friday-shell" });
		const shellHeaderEl = shell.createDiv({ cls: "friday-shell-header" });
		const topNavEl = shell.createDiv({ cls: "friday-top-nav" });
		const contentEl = shell.createDiv({ cls: "friday-page-content" });

		this.renderShellHeader(shellHeaderEl);
		this.renderTopNav(topNavEl);
		if (this.plugin.settings.projects.length === 0) {
			this.activePage = "projects";
			this.renderProjectsPage(contentEl);
		} else if (this.activePage === "projects") {
			this.renderProjectsPage(contentEl);
		} else if (this.activePage === "checks") {
			this.renderChecksPage(contentEl);
		} else {
			this.renderAiPage(contentEl);
		}
		if (this.plugin.settings.projects.length > 0 && !this.aiSessionNavCollapsed) {
			this.renderAiSessionDrawer(shell);
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
		projectSection.createSpan({
			cls: "friday-shell-project-brand",
			text: this.t("nav.friday", "F.R.I.D.A.Y"),
		});
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
				const option = selectEl.createEl("option", { text: project.slug });
				option.value = project.slug;
				option.selected = activeProject?.slug === project.slug;
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
		this.addNavButton(containerEl, "projects", this.t("nav.projects", "Projects"), "folder");
		this.addNavButton(containerEl, "checks", this.t("nav.checks", "Checks"), "shield");
	}

	private addNavButton(
		containerEl: HTMLElement,
		page: "chat" | "projects" | "checks",
		label: string,
		icon: string,
	): void {
		const button = containerEl.createEl("button", {
			cls: `friday-nav-button${this.activePage === page ? " is-active" : ""}`,
		});
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.title = label;
		const iconEl = button.createSpan({ cls: "friday-nav-button-icon" });
		setIcon(iconEl, icon);
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
		button.title = label;
		setIcon(button, icon);
		button.onclick = onClick;
		return button;
	}

	private renderChecksPage(containerEl: HTMLElement): void {
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
			text: this.t("projects.remove.pendingDesc", "Remove project {slug} from the workspace?", { slug: project.slug }),
		});
		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(actions, this.t("projects.remove.confirm", "Remove now"), async () => {
			await this.plugin.removeProject(project.slug);
			this.pendingProjectRemoval = null;
			this.activePage = "projects";
			await this.safeRenderBoard();
		});
		this.addPageButton(actions, this.t("projects.remove.cancel", "Cancel"), async () => {
			this.pendingProjectRemoval = null;
			this.renderBoard();
		});
	}

	private renderMemberEditorCard(containerEl: HTMLElement): void {
		const card = containerEl.createDiv({ cls: "friday-ai-chat-panel" });
		card.createEl("h4", {
			text: this.t("members.title", "Project members: {slug}", { slug: this.memberEditorProjectSlug }),
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
			await this.plugin.dataService.setProjectMembers(this.memberEditorProjectSlug, this.memberEditorMembers);
			this.memberEditorProjectSlug = "";
			this.memberEditorMembers = [];
			this.renderBoard();
		});
		this.addPageButton(footer, this.t("members.cancel", "Cancel"), async () => {
			this.memberEditorProjectSlug = "";
			this.memberEditorMembers = [];
			this.renderBoard();
		});
	}

	private renderSyncReport(
		containerEl: HTMLElement,
		item: { projectSlug: string; result: SyncResult; recordedAt: string },
	): void {
		const row = containerEl.createDiv({ cls: "friday-sync-project" });
		row.createDiv({
			text: `${item.projectSlug} · ${item.recordedAt}`,
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
		for (const conflict of item.result.conflicts) {
			const conflictRow = row.createDiv({ cls: "friday-sync-conflict-row" });
			conflictRow.createDiv({
				text: `${this.t("checks.sync.conflict", "Conflict")}: ${conflict}`,
			});
			const snapshotPath = item.result.conflictSnapshots?.[conflict];
			if (snapshotPath) {
				conflictRow.createDiv({
					cls: "friday-approval-detail",
					text: `${this.t("checks.sync.snapshot", "Snapshot")}: ${snapshotPath}`,
				});
			}
			const actions = conflictRow.createDiv({ cls: "friday-approval-actions" });
			this.addPageButton(actions, this.t("checks.sync.proposal", "Generate proposal"), async () => {
				await this.generateConflictProposal(item.projectSlug, conflict);
			});
			this.addPageButton(actions, this.t("checks.sync.useOurs", "Use ours"), async () => {
				await this.resolveConflictAction(item.projectSlug, conflict, "ours");
			});
			this.addPageButton(actions, this.t("checks.sync.useTheirs", "Use theirs"), async () => {
				await this.resolveConflictAction(item.projectSlug, conflict, "theirs");
			});
		}
		if (item.result.conflicts.length > 0) {
			const finalizeActions = row.createDiv({ cls: "friday-approval-actions" });
			this.addPageButton(finalizeActions, this.t("checks.sync.finalize", "Finalize conflict resolution"), async () => {
				await this.finalizeConflictAction(item.projectSlug);
			});
		}
	}

	private async resolveConflictAction(
		projectSlug: string,
		filePath: string,
		strategy: "ours" | "theirs",
	): Promise<void> {
		const project = this.plugin.settings.projects.find((item) => item.slug === projectSlug);
		if (!project) {
			throw new Error(this.t("checks.sync.projectMissing", "Project not found."));
		}
		await this.plugin.syncService.resolveConflict(project, filePath, strategy);
		await this.refreshSyncReport(project);
	}

	private async finalizeConflictAction(projectSlug: string): Promise<void> {
		const project = this.plugin.settings.projects.find((item) => item.slug === projectSlug);
		if (!project) {
			throw new Error(this.t("checks.sync.projectMissing", "Project not found."));
		}
		await this.plugin.syncService.finalizeConflictResolution(project);
		await this.refreshSyncReport(project);
	}

	private async refreshSyncReport(project: ProjectEntry): Promise<void> {
		const conflicts = await this.plugin.syncService.getConflicts(project);
		const recordedAt = new Date().toISOString();
		this.plugin.workbenchStateStore.recordSyncReport({
			projectSlug: project.slug,
			recordedAt,
			result: {
				success: conflicts.length === 0,
				projectSlug: project.slug,
				pulledFiles: [],
				pushedFiles: [],
				conflicts,
			},
		});
		this.renderBoard();
	}

	private async generateConflictProposal(projectSlug: string, filePath: string): Promise<void> {
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			throw new Error(this.t("checks.sync.projectMissing", "Project not found."));
		}
		const resolution = this.buildInvocationResolver().resolveProjectConflictProposal(projectSlug, filePath);
		if (resolution.type !== "runtime" || !resolution.requestedSkillName) {
			throw new Error("Project conflict proposal could not be resolved to a runtime skill invocation.");
		}
		const skillContext = await this.plugin.skillCommandService.buildSkillSystemContext("resolve-conflict");
		const result = await this.plugin.agentRuntimeService.runTurn({
			agentId: activeAgent.id,
			conversation: [],
			userPrompt: resolution.runtimePrompt,
			currentFilePath: filePath,
			extraSystemContext: skillContext.systemContext,
		});
		const traceSummary = result.traces[0]?.summary ?? "manual";
		const match = traceSummary.match(/\((ours|theirs|manual)\)/i);
		const strategy = (match?.[1]?.toLowerCase() ?? "manual") as "ours" | "theirs" | "manual";
		this.plugin.workbenchStateStore.recordConflictProposal({
			projectSlug,
			filePath,
			markdown: result.assistantText,
			recommendedStrategy: strategy,
			recordedAt: new Date().toISOString(),
			status: "pending",
		});
		this.activePage = "projects";
		this.renderBoard();
	}

	private async applyConflictProposal(
		projectSlug: string,
		filePath: string,
		strategy: "ours" | "theirs" | "manual",
	): Promise<void> {
		if (strategy === "manual") {
			throw new Error(this.t("checks.proposal.manual", "Manual strategy cannot be auto-applied."));
		}
		await this.resolveConflictAction(projectSlug, filePath, strategy);
		const current = this.plugin.workbenchStateStore.getConflictProposals().find(
			(item) => item.projectSlug === projectSlug && item.filePath === filePath,
		);
		if (current) {
			this.plugin.workbenchStateStore.replaceConflictProposal({
				...current,
				status: "applied",
				appliedStrategy: strategy,
			});
		}
		this.activePage = "projects";
		this.renderBoard();
	}

	private rejectConflictProposal(projectSlug: string, filePath: string): void {
		const current = this.plugin.workbenchStateStore.getConflictProposals().find(
			(item) => item.projectSlug === projectSlug && item.filePath === filePath,
		);
		if (!current) {
			return;
		}
		this.plugin.workbenchStateStore.replaceConflictProposal({
			...current,
			status: "rejected",
		});
		this.renderBoard();
	}

	private getActiveProjectEntry(): ProjectEntry | null {
		const projects = this.plugin.settings.projects;
		if (projects.length === 0) {
			return null;
		}
		const activeProjectId = this.plugin.settings.activeProjectId;
		return projects.find((project) => project.slug === activeProjectId) ?? projects[0] ?? null;
	}

	private async ensureActiveProjectInitialized(): Promise<void> {
		const activeProject = this.getActiveProjectEntry();
		if (!activeProject || this.plugin.settings.activeProjectId === activeProject.slug) {
			return;
		}
		await this.plugin.setActiveProject(activeProject.slug);
	}

	private async switchActiveProject(projectSlug: string): Promise<void> {
		if (!projectSlug || projectSlug === this.plugin.settings.activeProjectId || this.aiBusy) {
			return;
		}
		await this.plugin.setActiveProject(projectSlug);
		await this.safeRenderBoard();
	}

	private renderProjectsPage(containerEl: HTMLElement): void {
		this.consumeProjectEditorRequest();
		const projects = this.plugin.settings.projects;
		const header = containerEl.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.plugin.t("projects.header") });
		const actionBar = header.createDiv({ cls: "friday-page-actions" });
		this.addPageButton(actionBar, this.t("projects.button.new", "New Project"), async () => {
			this.openProjectEditor();
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
			emptyEl.createEl("h4", { text: this.t("projects.empty.title", "No projects yet") });
			emptyEl.createEl("p", {
				text: this.t("projects.empty.desc", "Create a project first, then manage repository and members here."),
			});
			this.addPageButton(emptyEl, this.t("projects.empty.action", "Create Project Now"), async () => {
				this.openProjectEditor();
			});
			return;
		}

		if (this.projectEditorDraft) {
			this.renderProjectEditorCard(containerEl);
		}

		if (this.pendingProjectRemoval) {
			this.renderProjectRemovalCard(containerEl, this.pendingProjectRemoval);
		}

		if (this.memberEditorProjectSlug) {
			this.renderMemberEditorCard(containerEl);
		}

		const grid = containerEl.createDiv({ cls: "friday-project-grid" });
		for (const project of projects) {
			this.renderProjectCard(grid, project);
		}
	}

	private renderProjectCard(containerEl: HTMLElement, project: ProjectEntry): void {
		const card = containerEl.createDiv({ cls: "friday-project-card" });
		if (project.slug === this.plugin.settings.activeProjectId) {
			card.addClass("is-active");
		}

		card.onclick = () => {
			void this.switchActiveProject(project.slug);
		};

		const titleEl = card.createDiv({ cls: "friday-project-title" });
		titleEl.createEl("h4", { text: project.slug });

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
				value: project.projectRootPath || project.localPath || this.t("common.notSet", "Not set"),
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
		this.addPageButton(actionsEl, this.t("projects.button.manage", "Manage"), async () => {
			this.openProjectEditor(project);
		});
		this.addPageButton(actionsEl, this.t("projects.button.members", "Members"), async () => {
			await this.openMemberEditor(project.slug);
		});
		this.addPageButton(actionsEl, this.t("projects.button.sync", "Sync"), async () => {
			await this.syncSingleProject(project);
		});
		this.addPageButton(actionsEl, this.t("projects.button.remove", "Remove"), async () => {
			this.pendingProjectRemoval = project;
			this.activePage = "projects";
			this.renderBoard();
		});

		this.renderProjectStatusPanel(card, project);
	}

	private renderProjectStatusPanel(containerEl: HTMLElement, project: ProjectEntry): void {
		const syncReport = this.plugin.workbenchStateStore.getSyncReports().find((item) => item.projectSlug === project.slug) ?? null;
		const conflictProposals = this.plugin.workbenchStateStore.getConflictProposals().filter((item) => item.projectSlug === project.slug);
		if (!syncReport && conflictProposals.length === 0) {
			return;
		}

		const panel = containerEl.createDiv({ cls: "friday-project-status-panel" });
		if (syncReport) {
			const syncWrap = panel.createDiv({ cls: "friday-project-status-group" });
			syncWrap.createEl("h5", { text: this.t("checks.sync.title", "Recent sync reports") });
			this.renderSyncReport(syncWrap, syncReport);
		}

		if (conflictProposals.length > 0) {
			const proposalWrap = panel.createDiv({ cls: "friday-project-status-group" });
			proposalWrap.createEl("h5", { text: this.t("checks.proposal.title", "Conflict proposals") });
			for (const proposal of conflictProposals) {
				const card = proposalWrap.createDiv({ cls: "friday-approval-card" });
				card.createDiv({
					cls: "friday-approval-header",
					text: `${proposal.projectSlug} · ${proposal.filePath}`,
				});
				card.createDiv({
					cls: "friday-approval-detail",
					text: this.t("checks.proposal.strategy", "Recommended: {strategy}", {
						strategy: proposal.recommendedStrategy,
					}),
				});
				card.createDiv({
					cls: "friday-approval-detail",
					text: this.t("checks.proposal.status", "Status: {status}", {
						status: proposal.status,
					}),
				});
				card.createEl("pre", {
					cls: "friday-exec-output",
					text: proposal.markdown,
				});
				if (proposal.status === "pending") {
					const actions = card.createDiv({ cls: "friday-approval-actions" });
					this.addPageButton(actions, this.t("checks.proposal.applyRecommended", "Apply recommended"), async () => {
						await this.applyConflictProposal(proposal.projectSlug, proposal.filePath, proposal.recommendedStrategy);
					});
					this.addPageButton(actions, this.t("checks.proposal.useOurs", "Use ours"), async () => {
						await this.applyConflictProposal(proposal.projectSlug, proposal.filePath, "ours");
					});
					this.addPageButton(actions, this.t("checks.proposal.useTheirs", "Use theirs"), async () => {
						await this.applyConflictProposal(proposal.projectSlug, proposal.filePath, "theirs");
					});
					this.addPageButton(actions, this.t("checks.proposal.reject", "Reject"), async () => {
						this.rejectConflictProposal(proposal.projectSlug, proposal.filePath);
					});
				}
			}
		}
	}

	private renderAiPage(containerEl: HTMLElement): void {
		const llmConfigured = this.plugin.aiService.isConfigured();
		const activeAgent = this.plugin.getActiveAgent();
		const effectiveModel = this.resolveEffectiveModel(activeAgent);
		const modelCapability = this.plugin.aiService.getModelCapability(effectiveModel || undefined);
		const mentionPaths = this.extractMentionedFilePaths(this.aiDraft);
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
				agent: activeAgent?.name ?? this.t("common.notSet", "Not set"),
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
		agentSelectEl.setAttribute("aria-label", this.t("ai.agent.switch", "切换 Agent"));
		for (const agent of this.plugin.settings.agents) {
			const option = agentSelectEl.createEl("option", { text: agent.name });
			option.value = agent.id;
			option.selected = agent.id === this.plugin.settings.activeAgentId;
		}
		agentSelectEl.disabled = this.aiBusy;
		agentSelectEl.onchange = () => {
			void this.switchAgent(agentSelectEl.value);
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
		const pendingApprovals = this.approvalQueue.list();

		if (this.aiConversation.length === 0 && !this.aiStreamingPreview && !this.aiRuntimeExecutionState && pendingApprovals.length === 0) {
			const emptyEl = messageListEl.createDiv({ cls: "friday-ai-empty" });
			emptyEl.createEl("h4", { text: this.plugin.t("ai.empty.title") });
			emptyEl.createEl("p", { text: this.plugin.t("ai.empty.desc") });
		}

		for (const message of this.aiConversation) {
			this.renderAiMessage(messageListEl, message);
		}
		if (this.aiRuntimeExecutionState) {
			this.renderRuntimeExecutionPreview(messageListEl);
		} else if (this.aiStreamingPreview) {
			this.renderAiMessage(
				messageListEl,
				{
					role: "assistant",
					content: this.aiStreamingPreview,
				},
				true,
			);
		}
		for (const item of pendingApprovals) {
			this.renderApprovalMessage(messageListEl, item);
		}
		if (!this.aiBusy && this.aiLastCompletedRuntimeExecutionState) {
			this.renderCompletedRuntimeDisclosure(messageListEl);
		}

		if (this.aiLastError) {
			chatShellEl.createDiv({
				cls: "friday-ai-error",
				text: this.aiLastError,
			});
		}

		this.renderAiOverrideBar(chatShellEl);

		const composerWrap = chatShellEl.createDiv({ cls: "friday-ai-composer-wrap" });
		if (mentionPaths.length > 0) {
			const mentionBar = composerWrap.createDiv({ cls: "friday-ai-mention-pill-bar" });
			for (const pathValue of mentionPaths) {
				const pill = mentionBar.createDiv({ cls: "friday-ai-mention-pill" });
				pill.createSpan({ text: pathValue.split("/").pop() ?? pathValue });
				const remove = pill.createEl("button", { cls: "friday-ai-mention-pill-remove" });
				remove.type = "button";
				remove.setAttribute("aria-label", this.t("ai.mention.remove", "移除引用"));
				remove.setText("×");
				remove.onclick = () => {
					this.aiDraft = this.removeMentionedFilePath(this.aiDraft, pathValue);
					this.renderBoard();
				};
			}
		}

		const composerEl = composerWrap.createDiv({ cls: "friday-ai-composer" });
		const composerDropdown = new MentionDropdown(composerWrap);
		const inputEl = composerEl.createEl("textarea", {
			cls: "friday-ai-input",
		});
		inputEl.placeholder = this.t(
			"ai.input.placeholder.rich",
			"输入消息，支持 @ 文件引用与 / 命令。Enter 发送，Shift+Enter 换行",
		);
		inputEl.value = this.aiDraft;
		inputEl.disabled = this.aiBusy;
		this.syncComposerHeight(inputEl);
		composerDropdown.onSelect((item) => {
			this.applyComposerSuggestion(inputEl, composerDropdown, item);
		});
		inputEl.oninput = () => {
			this.aiDraft = inputEl.value;
			this.syncComposerHeight(inputEl);
			void this.updateComposerSuggestions(inputEl, composerDropdown);
		};
		inputEl.onfocus = () => {
			void this.updateComposerSuggestions(inputEl, composerDropdown);
		};
		inputEl.onmouseup = () => {
			void this.updateComposerSuggestions(inputEl, composerDropdown);
		};
		inputEl.onkeydown = (event) => {
			if (composerDropdown.handleKeydown(event)) {
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.submitAiPrompt();
			}
		};
		inputEl.onblur = () => {
			window.setTimeout(() => {
				composerDropdown.hide();
			}, 120);
		};

		const toolbarEl = composerWrap.createDiv({ cls: "friday-ai-composer-toolbar" });
		const modelSelect = toolbarEl.createEl("select", { cls: "friday-ai-toolbar-select" });
		modelSelect.setAttribute("aria-label", this.t("ai.model.override", "选择临时模型"));
		for (const optionValue of this.buildModelOptions(activeAgent)) {
			const option = modelSelect.createEl("option", {
				text: optionValue.value
					? optionValue.label
					: this.t("ai.model.follow", "模型 · 跟随默认"),
			});
			option.value = optionValue.value;
			option.selected = optionValue.value === this.aiSessionModelOverride;
		}
		modelSelect.disabled = this.aiBusy;
		modelSelect.onchange = () => {
			this.aiSessionModelOverride = modelSelect.value;
			this.renderBoard();
		};

		const permissionSelect = toolbarEl.createEl("select", { cls: "friday-ai-toolbar-select" });
		permissionSelect.setAttribute("aria-label", this.t("ai.permission.override", "选择临时权限模式"));
		for (const mode of this.buildPermissionModeOptions()) {
			const option = permissionSelect.createEl("option", { text: mode.label });
			option.value = mode.value;
			option.selected = mode.value === this.aiSessionPermissionOverride;
		}
		permissionSelect.disabled = this.aiBusy;
		permissionSelect.onchange = () => {
			this.aiSessionPermissionOverride = permissionSelect.value as ToolPermissionMode | "";
			this.renderBoard();
		};

		const skillButton = toolbarEl.createEl("button", {
			cls: "friday-ai-toolbar-button",
			text: this.t("ai.skill.button", "+Skill"),
		});
		skillButton.type = "button";
		skillButton.disabled = this.aiBusy;
		skillButton.onmousedown = (event) => {
			event.preventDefault();
		};
		skillButton.onclick = () => {
			void this.openSkillPicker(inputEl, composerDropdown);
		};

		const attachButton = toolbarEl.createEl("button", {
			cls: "friday-ai-toolbar-button friday-ai-toolbar-icon",
		});
		attachButton.type = "button";
		attachButton.setAttribute("aria-label", this.t("ai.attach.currentFile", "引用当前文件"));
		attachButton.title = this.t("ai.attach.currentFile", "引用当前文件");
		setIcon(attachButton, "paperclip");
		attachButton.disabled = this.aiBusy;
		attachButton.onmousedown = (event) => {
			event.preventDefault();
		};
		attachButton.onclick = () => {
			this.attachCurrentFileToDraft();
		};

		const sendButton = toolbarEl.createEl("button", {
			cls: "friday-ai-send-button",
			text: this.aiBusy ? this.plugin.t("ai.sending") : this.plugin.t("ai.send"),
		});
		sendButton.type = "button";
		sendButton.disabled = this.aiBusy;
		sendButton.onclick = () => {
			void this.submitAiPrompt();
		};

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
		for (const tool of TOOL_MANIFESTS) {
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
			subagent: "Delegate a bounded subtask to another agent execution.",
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
		const builtinSkills = orderedSkills.filter((skill) => skill.filePath.startsWith("builtin://"));
		const personalSkills = orderedSkills.filter((skill) => !skill.filePath.startsWith("builtin://"));
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
		meta.createDiv({ cls: "friday-control-center-item-title", text: `/${skill.command}` });
		meta.createDiv({
			cls: "friday-control-center-item-desc",
			text: skill.description || this.t("policy.skills.noDesc", "暂无说明"),
		});
		this.createAvailabilityToggle(item, skill.command, !disabledSkills.has(normalized), async () => {
			await this.toggleSkillAvailability(skill.command, disabledSkills.has(normalized));
		});
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
		headerEl.createEl("h4", {
			text: this.t("ai.sessions.title", "对话记录"),
		});
		const actionsEl = headerEl.createDiv({ cls: "friday-ai-session-drawer-actions" });
		const newButton = actionsEl.createEl("button", {
			cls: "friday-ai-session-new",
			text: this.t("ai.sessions.new", "新建"),
		});
		newButton.type = "button";
		newButton.disabled = this.aiBusy;
		newButton.onclick = () => {
			this.startNewAiSession();
		};
		const manageButton = actionsEl.createEl("button", {
			cls: "friday-ai-session-new friday-ai-session-manage",
			text: this.aiSessionManageMode
				? this.t("ai.sessions.manage.done", "完成")
				: this.t("ai.sessions.manage.enter", "管理"),
		});
		manageButton.type = "button";
		manageButton.disabled = this.aiBusy || this.aiSessions.length === 0;
		manageButton.onclick = () => {
			this.toggleSessionManageMode();
		};
		this.createIconButton(
			actionsEl,
			"friday-shell-icon-button friday-ai-meta-button",
			"x",
			this.t("ai.sessions.collapse", "收起对话列表"),
			() => {
				this.aiSessionNavCollapsed = true;
				this.renderBoard();
			},
		);

		const listEl = drawerEl.createDiv({ cls: "friday-ai-session-list" });
		if (this.aiSessions.length === 0) {
			const emptyEl = listEl.createDiv({ cls: "friday-ai-session-empty" });
			emptyEl.setText(this.t("ai.sessions.empty", "暂无对话记录"));
			return;
		}

		if (this.aiSessionManageMode) {
			const bulkBar = drawerEl.createDiv({ cls: "friday-ai-session-bulkbar" });
			const counter = bulkBar.createDiv({
				cls: "friday-ai-session-bulktext",
				text: this.t("ai.sessions.manage.selected", "已选 {count} 项", {
					count: this.aiSessionSelection.size,
				}),
			});
			counter.setAttribute("aria-live", "polite");
			const bulkActions = bulkBar.createDiv({ cls: "friday-ai-session-bulkactions" });
			const selectAll = bulkActions.createEl("button", {
				cls: "friday-ai-session-bulkbutton",
				text: this.aiSessionSelection.size === this.aiSessions.length
					? this.t("ai.sessions.manage.clear", "清空选择")
					: this.t("ai.sessions.manage.selectAll", "全选"),
			});
			selectAll.type = "button";
			selectAll.onclick = () => {
				this.toggleAllSessionSelections();
			};
			const deleteSelected = bulkActions.createEl("button", {
				cls: "friday-ai-session-bulkbutton is-danger",
				text: this.t("ai.sessions.manage.deleteSelected", "删除所选"),
			});
			deleteSelected.type = "button";
			deleteSelected.disabled = this.aiSessionSelection.size === 0 || this.aiBusy;
			deleteSelected.onclick = () => {
				void this.deleteSelectedSessions();
			};
		}

		for (const session of this.aiSessions) {
			const itemEl = listEl.createDiv({ cls: "friday-ai-session-item" });
			if (session.sessionId === this.aiSessionId) {
				itemEl.addClass("is-active");
			}
			if (this.aiSessionSelection.has(session.sessionId)) {
				itemEl.addClass("is-selected");
			}
			const rowHeader = itemEl.createDiv({ cls: "friday-ai-session-item-header" });
			if (this.aiSessionManageMode) {
				const checkbox = rowHeader.createEl("input", { attr: { type: "checkbox" }, cls: "friday-ai-session-checkbox" });
				checkbox.checked = this.aiSessionSelection.has(session.sessionId);
				checkbox.onclick = (event) => {
					event.stopPropagation();
				};
				checkbox.onchange = () => {
					this.toggleSessionSelection(session.sessionId);
				};
			}
			const bodyButton = rowHeader.createEl("button", { cls: "friday-ai-session-item-body" });
			bodyButton.type = "button";
			bodyButton.createDiv({
				cls: "friday-ai-session-item-title",
				text: this.buildSessionTitle(session),
			});
			bodyButton.createDiv({
				cls: "friday-ai-session-item-meta",
				text: this.formatSessionUpdatedAt(session.updatedAt),
			});
			bodyButton.onclick = () => {
				if (this.aiSessionManageMode) {
					this.toggleSessionSelection(session.sessionId);
					return;
				}
				void this.switchAiSession(session.sessionId);
			};

			const utility = rowHeader.createDiv({ cls: "friday-ai-session-item-actions" });
			if (!this.aiSessionManageMode) {
				const renameButton = utility.createEl("button", {
					cls: "friday-ai-session-mini-action",
					text: this.t("ai.sessions.rename.action", "重命名"),
				});
				renameButton.type = "button";
				renameButton.onclick = (event) => {
					event.stopPropagation();
					this.beginSessionRename(session);
				};
			}
			const deleteButton = utility.createEl("button", {
				cls: "friday-ai-session-mini-action is-danger",
				text: this.aiSessionManageMode
					? this.t("ai.sessions.delete.one", "删")
					: this.t("ai.sessions.delete.action", "删除"),
			});
			deleteButton.type = "button";
			deleteButton.onclick = (event) => {
				event.stopPropagation();
				void this.deleteSingleSession(session.sessionId);
			};

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
				};
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
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiLastCompletedRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiSessionModelOverride = "";
		this.aiSessionPermissionOverride = "";
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
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiLastCompletedRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
		this.aiSessionModelOverride = "";
		this.aiSessionPermissionOverride = "";
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

	private toggleAllSessionSelections(): void {
		if (this.aiSessionSelection.size === this.aiSessions.length) {
			this.aiSessionSelection.clear();
		} else {
			this.aiSessionSelection = new Set(this.aiSessions.map((session) => session.sessionId));
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
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			return;
		}
		const nextTitle = this.aiSessionRenameDraft.trim();
		if (!nextTitle) {
			new Notice(this.t("ai.sessions.rename.empty", "对话标题不能为空。"), 3000);
			return;
		}
		const updated = await this.plugin.conversationService.renameSession(activeAgent.id, sessionId, nextTitle);
		this.aiSessions = this.aiSessions.map((session) => session.sessionId === sessionId ? updated : session);
		if (this.aiSessionId === sessionId) {
			this.aiConversation = [...updated.messages];
		}
		this.cancelSessionRename();
		this.renderBoard();
	}

	private async deleteSingleSession(sessionId: string): Promise<void> {
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent || this.aiBusy) {
			return;
		}
		await this.plugin.conversationService.deleteSession(activeAgent.id, sessionId);
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
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent || this.aiSessionSelection.size === 0 || this.aiBusy) {
			return;
		}
		const ids = [...this.aiSessionSelection];
		for (const sessionId of ids) {
			await this.plugin.conversationService.deleteSession(activeAgent.id, sessionId);
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

	private buildSessionTitle(session: ConversationSession): string {
		if (session.title?.trim()) {
			return this.truncateText(session.title.trim(), 72);
		}
		const firstUserMessage = session.messages.find(
			(message) => message.role === "user" && message.content.trim().length > 0,
		);
		const raw = this.stripMentionedFilePaths(firstUserMessage?.content ?? "").replace(/\s+/g, " ").trim()
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
		metaEl.createSpan({
			cls: "friday-ai-message-avatar",
			text: isUser ? this.resolveUserBadgeLabel() : "F",
		});
		metaEl.createSpan({
			cls: "friday-ai-message-role",
			text: isUser ? this.plugin.t("ai.role.user") : this.plugin.t("ai.role.assistant"),
		});
		const contentEl = bubbleEl.createDiv({
			cls: `friday-ai-message-content${isStreaming ? " is-streaming" : ""}`,
		});
		void MarkdownRenderer.renderMarkdown(message.content, contentEl, "", this);
	}

	private renderApprovalMessage(containerEl: HTMLElement, item: PendingApproval): void {
		const rowEl = containerEl.createDiv({
			cls: "friday-ai-message-row is-assistant",
		});
		const bubbleEl = rowEl.createDiv({
			cls: "friday-ai-message is-assistant friday-ai-approval-message",
		});
		const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
		metaEl.createSpan({
			cls: "friday-ai-message-avatar",
			text: "F",
		});
		metaEl.createSpan({
			cls: "friday-ai-message-role",
			text: this.plugin.t("ai.role.assistant"),
		});
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
		metaEl.createSpan({
			cls: "friday-ai-message-avatar",
			text: "F",
		});
		metaEl.createSpan({
			cls: "friday-ai-message-role",
			text: this.plugin.t("ai.role.assistant"),
		});
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

	private async submitAiPrompt(): Promise<void> {
		const rawPrompt = this.aiDraft.trim();
		if (!rawPrompt || this.aiBusy) {
			return;
		}

		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
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

		const history = [...this.aiConversation];
		this.aiConversation.push({ role: "user", content: rawPrompt });
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeExecutionState = null;
		this.aiRuntimePreviewExpanded = false;
		this.aiBusy = true;
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			let modelOverride = this.aiSessionModelOverride.trim() || activeAgent.model?.trim() || undefined;
			const currentFilePath = this.app.workspace.getActiveFile()?.path;
			let runtimePrompt = this.stripMentionedFilePaths(rawPrompt);
			let extraSystemContext = "";
			let allowedTools: string[] | undefined;
			let allowedModels: string[] | undefined;
			let assistantText = "";
			let shouldStreamFinalText = false;
			const mentionContext = await this.buildMentionContext(rawPrompt);
			const resolution = this.buildInvocationResolver().resolveChatPrompt(rawPrompt);
			if (resolution.type === "invalid") {
				throw new Error(resolution.error);
			}
			if (resolution.type === "catalog") {
				const skills = await this.plugin.skillCommandService.listSkills();
				assistantText = this.buildSkillCatalogReply(skills);
				shouldStreamFinalText = true;
			} else {
				runtimePrompt = resolution.runtimePrompt;
				allowedTools = resolution.allowedTools?.length ? resolution.allowedTools : undefined;
				allowedModels = resolution.allowedModels?.length ? resolution.allowedModels : undefined;
				if (resolution.requestedSkillName) {
					const skillContext = await this.plugin.skillCommandService.buildSkillSystemContext(resolution.requestedSkillName);
					runtimePrompt = resolution.runtimePrompt;
					extraSystemContext = skillContext.systemContext;
				}
			}

			if (modelOverride && allowedModels && allowedModels.length > 0 && !allowedModels.includes(modelOverride.trim())) {
				throw new Error(this.t("ai.error.modelBlocked", "Current model is not allowed for this slash command."));
			}

			if (mentionContext) {
				extraSystemContext = extraSystemContext
					? `${extraSystemContext}\n\n${mentionContext}`
					: mentionContext;
			}
			runtimePrompt = this.stripMentionedFilePaths(runtimePrompt);
			runtimePrompt = runtimePrompt.trim() || this.t("ai.prompt.useMentions", "请基于已引用内容继续处理。");

			const previousPermissionMode = this.plugin.settings.agentRuntime.toolPermissionMode;
			if (this.aiSessionPermissionOverride) {
				this.plugin.settings.agentRuntime.toolPermissionMode = this.aiSessionPermissionOverride;
			}
			try {
				if (!assistantText && this.plugin.settings.agentRuntime.toolRuntimeEnabled) {
					const runtimeResult = await this.plugin.agentRuntimeService.runTurn({
						agentId: activeAgent.id,
						conversation: history,
						userPrompt: runtimePrompt,
						modelOverride,
						currentFilePath,
						extraSystemContext,
						allowedTools,
						onProgress: (event) => {
							this.handleRuntimeProgress(event);
						},
					});
					assistantText = this.buildRuntimeReply(runtimeResult);
					shouldStreamFinalText = true;
				} else if (!assistantText) {
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
									this.renderBoard();
								}
							},
						});
					} else {
						assistantText = await this.plugin.aiService.chat(modelMessages, { modelOverride });
					}
				}
			} finally {
				this.plugin.settings.agentRuntime.toolPermissionMode = previousPermissionMode;
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
			this.renderBoard();
		}
	}

	private async compileWikiByButton(): Promise<void> {
		if (this.aiBusy) {
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
			const summary = await this.compileWikiWithStatus();
			const reply = this.formatWikiCompileResult(summary, false);
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
			this.t("ai.compile.summary.project", "项目：{project}", { project: summary.projectSlug }),
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

	private isCompileWikiIntent(prompt: string): boolean {
		return this.plugin.skillCommandService.isCompileWikiSkillIntent(prompt);
	}

	private buildInvocationResolver(): InvocationResolver {
		return new InvocationResolver({
			parseSkillSlashCommand: (rawPrompt) => this.plugin.skillCommandService.parseSlashCommand(rawPrompt),
			expandSlashCommand: (rawPrompt) => this.plugin.slashCommandService.expand(rawPrompt),
			isCompileIntent: (rawPrompt) => this.isCompileWikiIntent(rawPrompt),
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
				this.renderBoard();
			}
			// Yield to UI thread to present progressive text updates.
			await this.sleep(delay);
		}
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
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
			this.renderBoard();
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

	private async updateComposerSuggestions(
		inputEl: HTMLTextAreaElement,
		dropdown: MentionDropdown,
	): Promise<void> {
		const value = inputEl.value;
		const cursor = inputEl.selectionStart ?? value.length;
		const token = this.getComposerToken(value, cursor);
		if (!token) {
			dropdown.hide();
			return;
		}
		if (token.startsWith("/")) {
			const skills = await this.plugin.skillCommandService.listSkills(20);
			const slashCommands = this.plugin.settings.slashCommands
				.filter((item) => item.enabled)
				.map((item) => ({ name: item.name, template: item.template }));
			const suggestions = buildSlashSuggestions(token, {
				skills: skills.map((item) => ({ command: item.command, description: item.description })),
				slashCommands,
			});
			dropdown.show(
				suggestions.map((item) => ({
					value: this.replaceComposerToken(value, cursor, token, item.value),
					label: item.label,
					description: item.description,
				})),
			);
			return;
		}
		if (token.startsWith("@")) {
			dropdown.show(this.buildMentionSuggestions(value, cursor, token));
			return;
		}
		dropdown.hide();
	}

	private applyComposerSuggestion(
		inputEl: HTMLTextAreaElement,
		dropdown: MentionDropdown,
		item: MentionSuggestion,
	): void {
		inputEl.value = item.value;
		this.aiDraft = item.value;
		this.syncComposerHeight(inputEl);
		dropdown.hide();
		inputEl.focus();
		inputEl.selectionStart = inputEl.value.length;
		inputEl.selectionEnd = inputEl.value.length;
	}

	private async openSkillPicker(
		inputEl: HTMLTextAreaElement,
		dropdown: MentionDropdown,
	): Promise<void> {
		const skills = await this.plugin.skillCommandService.listSkills(30);
		if (skills.length === 0) {
			new Notice(this.t("ai.skill.empty", "当前没有可用 Skill。"), 3000);
			return;
		}
		const value = inputEl.value;
		const insertBase = value.trim().length > 0 ? `${value.trimEnd()} ` : "";
		dropdown.show(
			skills.map((skill) => ({
				value: `${insertBase}/${skill.command} `,
				label: `/${skill.command}`,
				description: skill.description,
			})),
		);
		inputEl.focus();
	}

	private buildMentionSuggestions(
		value: string,
		cursor: number,
		token: string,
	): MentionSuggestion[] {
		const query = token.replace(/^@\[/, "").replace(/^@/, "").replace(/\]$/, "").toLowerCase();
		return this.getMentionableFiles(query).map((file) => ({
			value: this.replaceComposerToken(value, cursor, token, `@[${file.path}] `),
			label: file.basename,
			description: file.path,
		}));
	}

	private getMentionableFiles(query: string): TFile[] {
		const activeProject = this.getActiveProjectEntry();
		const projectRoot = activeProject?.projectRootPath?.replace(/[\\/]+$/, "") ?? "";
		const currentPath = this.app.workspace.getActiveFile()?.path ?? "";
		const normalizedQuery = query.trim().toLowerCase();
		return this.app.vault.getMarkdownFiles()
			.filter((file) => {
				if (!projectRoot) {
					return true;
				}
				return file.path === projectRoot || file.path.startsWith(`${projectRoot}/`);
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

	private getComposerToken(value: string, cursor: number): string {
		const prefix = value.slice(0, cursor);
		const line = prefix.split("\n").pop() ?? "";
		const token = line.split(/\s/).pop() ?? "";
		if (!token) {
			return "";
		}
		return token.startsWith("/") || token.startsWith("@") ? token : "";
	}

	private replaceComposerToken(
		value: string,
		cursor: number,
		token: string,
		replacement: string,
	): string {
		const start = Math.max(0, cursor - token.length);
		return `${value.slice(0, start)}${replacement}${value.slice(cursor)}`;
	}

	private resolveEffectiveModel(activeAgent: { model: string } | null): string {
		return this.aiSessionModelOverride.trim() || activeAgent?.model?.trim() || this.plugin.settings.llm.model?.trim() || "";
	}

	private buildModelOptions(
		activeAgent: { model: string } | null,
	): Array<{ value: string; label: string }> {
		const values = new Set<string>();
		const effectiveModel = this.resolveEffectiveModel(activeAgent);
		if (effectiveModel) values.add(effectiveModel);
		if (this.plugin.settings.llm.model?.trim()) values.add(this.plugin.settings.llm.model.trim());
		if (activeAgent?.model?.trim()) values.add(activeAgent.model.trim());
		for (const agent of this.plugin.settings.agents) {
			if (agent.model?.trim()) {
				values.add(agent.model.trim());
			}
		}
		for (const slashCommand of this.plugin.settings.slashCommands) {
			for (const model of slashCommand.allowedModels ?? []) {
				if (model?.trim()) {
					values.add(model.trim());
				}
			}
		}
		return [
			{ value: "", label: this.t("ai.model.follow", "模型 · 跟随默认") },
			...[...values].map((value) => ({ value, label: value })),
		];
	}

	private buildPermissionModeOptions(): Array<{ value: "" | ToolPermissionMode; label: string }> {
		return [
			{ value: "", label: this.t("ai.permission.follow", "权限 · 跟随默认") },
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

	private renderAiOverrideBar(containerEl: HTMLElement): void {
		const parts: string[] = [];
		if (this.aiSessionModelOverride) {
			parts.push(this.t("ai.override.model", "模型={value}", { value: this.aiSessionModelOverride }));
		}
		if (this.aiSessionPermissionOverride) {
			parts.push(this.t("ai.override.permission", "权限={value}", {
				value: this.resolvePermissionModeLabel(this.aiSessionPermissionOverride),
			}));
		}
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
			this.aiSessionModelOverride = "";
			this.aiSessionPermissionOverride = "";
			this.plugin.agentRuntimeService.clearAllSessionToolPolicyOverrides();
			this.plugin.toolApprovalService.clearSessionRules();
			this.renderBoard();
		};
	}

	private extractMentionedFilePaths(text: string): string[] {
		const paths = new Set<string>();
		const pattern = /@\[(.+?)\]/g;
		let match = pattern.exec(text);
		while (match) {
			const raw = match[1]?.trim();
			if (raw) {
				paths.add(raw);
			}
			match = pattern.exec(text);
		}
		return [...paths];
	}

	private stripMentionedFilePaths(text: string): string {
		return text.replace(/@\[[^\]]+\]/g, " ").replace(/\s{2,}/g, " ").trim();
	}

	private removeMentionedFilePath(text: string, pathValue: string): string {
		const escaped = pathValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return text.replace(new RegExp(`\\s*@\\[${escaped}\\]`, "g"), " ").replace(/\s{2,}/g, " ").trim();
	}

	private async buildMentionContext(text: string): Promise<string> {
		const mentionedPaths = this.extractMentionedFilePaths(text);
		if (mentionedPaths.length === 0) {
			return "";
		}
		const blocks: string[] = [this.t("ai.mention.contextLead", "以下是用户 @ 提及文件的内容摘要，请优先参考：")];
		for (const pathValue of mentionedPaths.slice(0, 4)) {
			const file = this.app.vault.getAbstractFileByPath(pathValue);
			if (!(file instanceof TFile)) {
				continue;
			}
			const content = await this.app.vault.cachedRead(file);
			const clipped = content.length > 1800
				? `${content.slice(0, 1800)}\n${this.t("ai.mention.truncated", "...（已截断）")}`
				: content;
			blocks.push(`\n## ${pathValue}\n${clipped}`);
		}
		return blocks.length > 1 ? blocks.join("\n") : "";
	}

	private attachCurrentFileToDraft(): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!(activeFile instanceof TFile)) {
			new Notice(this.t("ai.attach.noFile", "当前没有可引用的文件。"), 3000);
			return;
		}
		const token = `@[${activeFile.path}]`;
		if (this.aiDraft.includes(token)) {
			return;
		}
		this.aiDraft = this.aiDraft.trim().length > 0
			? `${this.aiDraft.trim()} ${token} `
			: `${token} `;
		this.renderBoard();
	}

	private syncComposerHeight(inputEl: HTMLTextAreaElement): void {
		inputEl.style.height = "auto";
		const maxHeight = 24 * 5 + 20;
		inputEl.style.height = `${Math.min(inputEl.scrollHeight, maxHeight)}px`;
	}

	private resolveUserBadgeLabel(): string {
		const source = this.plugin.settings.user.displayName
			|| this.plugin.getPrimaryUserId()
			|| this.plugin.t("ai.role.user");
		return (source.trim().charAt(0) || "U").toUpperCase();
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
			case "subagent_start":
				this.setRuntimeStageStatus(next, "tools", "running");
				this.upsertRuntimeEntry(next, {
					key: `subagent:${event.step ?? 0}`,
					kind: "subagent",
					label: this.t("ai.runtime.execution.subagentLabel", "子代理 {step}", {
						step: event.step ?? 0,
					}),
					detail: event.message,
					status: "running",
					step: event.step,
				});
				next.heading = this.t("ai.runtime.execution.subagentStart", "正在委托子代理");
				next.summary = event.message;
				break;
			case "subagent_result":
				this.upsertRuntimeEntry(next, {
					key: `subagent:${event.step ?? 0}`,
					kind: "subagent",
					label: this.t("ai.runtime.execution.subagentLabel", "子代理 {step}", {
						step: event.step ?? 0,
					}),
					detail: event.message,
					status: "ok",
					step: event.step,
				});
				next.heading = this.t("ai.runtime.execution.subagentDone", "子代理已返回");
				next.summary = event.message;
				break;
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
				return state.entries.some((entry) => entry.kind === "tool" || entry.kind === "subagent");
			case "finalize":
				return state.entries.some((entry) => entry.key === "system:done");
			default:
				return false;
		}
	}

	private hasSuccessfulToolEntry(state: RuntimeExecutionState): boolean {
		return state.entries.some((entry) => (entry.kind === "tool" || entry.kind === "subagent") && entry.status === "ok");
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

	private async switchAgent(agentId: string): Promise<void> {
		if (!agentId || this.aiBusy || agentId === this.plugin.settings.activeAgentId) {
			return;
		}

		try {
			await this.plugin.setActiveAgent(agentId);
			this.aiSessionId = "";
			await this.ensureAiSessionLoaded();
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			new Notice(
				this.t("ai.notice.switchAgentFailed", "Switch agent failed: {error}", { error: message }),
				6000,
			);
		}
	}

	private async openMemberEditor(projectSlug: string): Promise<void> {
		this.memberEditorProjectSlug = projectSlug;
		this.memberEditorMembers = await this.plugin.dataService.getProjectMembers(projectSlug);
		this.memberEditorNewUserId = "";
		this.memberEditorNewRole = "editor";
		this.activePage = "projects";
		this.renderBoard();
	}

	private consumeProjectEditorRequest(): void {
		const request = this.plugin.workbenchStateStore.consumeProjectEditorRequest();
		if (!request) {
			return;
		}
		if (request.mode === "edit" && request.projectSlug) {
			const project = this.plugin.settings.projects.find((item) => item.slug === request.projectSlug) ?? null;
			this.projectEditorDraft = this.createProjectEditorDraft(project ?? undefined);
			this.projectEditorInitialSlug = project?.slug ?? "";
			this.projectEditorError = "";
			this.activePage = "projects";
			return;
		}
		this.projectEditorDraft = this.createProjectEditorDraft();
		this.projectEditorInitialSlug = "";
		this.projectEditorError = "";
		this.activePage = "projects";
	}

	private createProjectEditorDraft(initial?: ProjectEntry): ProjectEditorDraft {
		if (initial) {
			return {
				groupId: initial.groupId || "default-group",
				slug: initial.slug,
				projectRootPath: initial.projectRootPath || buildDefaultProjectRootPath(this.plugin.dataService.getFridayRoot(), initial.slug),
				localPath: initial.localPath ?? "",
				gitRemote: initial.gitRemote,
				gitUsername: initial.gitUsername,
				gitUserEmail: initial.gitUserEmail ?? "",
				gitToken: initial.gitToken,
				autoSync: initial.autoSync,
			};
		}
		return {
			groupId: this.plugin.settings.projectGroups[0]?.id ?? "default-group",
			slug: "",
			projectRootPath: buildDefaultProjectRootPath(this.plugin.dataService.getFridayRoot(), ""),
			localPath: "",
			gitRemote: "",
			gitUsername: "",
			gitUserEmail: "",
			gitToken: "",
			autoSync: true,
		};
	}

	private renderProjectEditorCard(containerEl: HTMLElement): void {
		if (!this.projectEditorDraft) {
			return;
		}
		const draft = this.projectEditorDraft;
		const card = containerEl.createDiv({ cls: "friday-ai-chat-panel" });
		card.createEl("h4", {
			text: this.projectEditorInitialSlug
				? this.t("projects.editor.edit", "Edit project")
				: this.t("projects.editor.create", "Register project"),
		});
		if (this.projectEditorError) {
			card.createDiv({ cls: "friday-ai-error", text: this.projectEditorError });
		}

		const fields = card.createDiv({ cls: "friday-project-editor-grid" });
		this.renderProjectEditorInput(fields, this.t("projects.editor.group", "Group"), draft.groupId, (value) => {
			draft.groupId = value;
		}, this.plugin.settings.projectGroups.map((group) => group.id));
		this.renderProjectEditorText(fields, this.t("projects.editor.slug", "Slug"), draft.slug, (value) => {
			const previousDefault = buildDefaultProjectRootPath(this.plugin.dataService.getFridayRoot(), draft.slug);
			draft.slug = value.trim().toLowerCase();
			const nextDefault = buildDefaultProjectRootPath(this.plugin.dataService.getFridayRoot(), draft.slug);
			if (!draft.projectRootPath || draft.projectRootPath === previousDefault) {
				draft.projectRootPath = nextDefault;
			}
			this.renderBoard();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.root", "Project root"), draft.projectRootPath, (value) => {
			draft.projectRootPath = value.trim();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.local", "Local path"), draft.localPath, (value) => {
			draft.localPath = value.trim();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.remote", "Git remote"), draft.gitRemote, (value) => {
			draft.gitRemote = value.trim();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.user", "Git username"), draft.gitUsername, (value) => {
			draft.gitUsername = value.trim();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.email", "Git email"), draft.gitUserEmail, (value) => {
			draft.gitUserEmail = value.trim();
		});
		this.renderProjectEditorText(fields, this.t("projects.editor.token", "Git token"), draft.gitToken, (value) => {
			draft.gitToken = value.trim();
		}, "password");
		const toggleRow = fields.createDiv({ cls: "friday-project-editor-field" });
		toggleRow.createEl("label", { text: this.t("projects.editor.autoSync", "Auto sync") });
		const toggle = toggleRow.createEl("input", { attr: { type: "checkbox" } });
		toggle.checked = draft.autoSync;
		toggle.onchange = () => {
			draft.autoSync = toggle.checked;
		};

		const actions = card.createDiv({ cls: "friday-approval-actions" });
		this.addPageButton(actions, this.t("projects.editor.save", "Save project"), async () => {
			await this.submitProjectEditor();
		});
		this.addPageButton(actions, this.t("projects.editor.cancel", "Cancel"), async () => {
			this.projectEditorDraft = null;
			this.projectEditorInitialSlug = "";
			this.projectEditorError = "";
			this.renderBoard();
		});
	}

	private renderProjectEditorText(
		containerEl: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		type = "text",
	): void {
		const row = containerEl.createDiv({ cls: "friday-project-editor-field" });
		row.createEl("label", { text: label });
		const input = row.createEl("input", { attr: { type, value } });
		input.oninput = () => {
			onChange(input.value);
		};
	}

	private renderProjectEditorInput(
		containerEl: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		options: string[],
	): void {
		const row = containerEl.createDiv({ cls: "friday-project-editor-field" });
		row.createEl("label", { text: label });
		const select = row.createEl("select");
		for (const optionValue of [...new Set(options.length > 0 ? options : ["default-group"])]) {
			const option = select.createEl("option", { text: optionValue });
			option.value = optionValue;
			option.selected = optionValue === value;
		}
		select.onchange = () => {
			onChange(select.value);
		};
	}

	private async ensureAiSessionLoaded(): Promise<void> {
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			this.aiConversation = [];
			this.aiSessions = [];
			this.aiSessionId = "";
			return;
		}

		const sessions = await this.plugin.conversationService.listSessions(activeAgent.id, 80);
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
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent || this.aiConversation.length === 0) {
			return;
		}
		if (!this.aiSessionId) {
			this.aiSessionId = this.plugin.conversationService.createSessionId();
		}
		const saved = await this.plugin.conversationService.saveSession(activeAgent.id, this.aiSessionId, this.aiConversation);
		this.aiSessions = [saved, ...this.aiSessions.filter((session) => session.sessionId !== saved.sessionId)]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 80);
	}

	private openProjectEditor(initial?: ProjectEntry): void {
		this.projectEditorDraft = this.createProjectEditorDraft(initial);
		this.projectEditorInitialSlug = initial?.slug ?? "";
		this.projectEditorError = "";
		this.activePage = "projects";
		this.renderBoard();
	}

	private async submitProjectEditor(): Promise<void> {
		if (!this.projectEditorDraft) {
			return;
		}
		try {
			const isEditing = Boolean(this.projectEditorInitialSlug);
			const entry = await submitProjectDraft({
				app: this.app,
				syncService: this.plugin.syncService,
				draft: this.projectEditorDraft,
				initial: this.projectEditorInitialSlug
					? this.plugin.settings.projects.find((project) => project.slug === this.projectEditorInitialSlug)
					: undefined,
				existingSlugs: new Set(this.plugin.settings.projects.map((project) => project.slug)),
				fridayRoot: this.plugin.dataService.getFridayRoot(),
				currentUserId: this.plugin.getPrimaryUserId(),
			});
			await this.plugin.upsertProject(entry);
			await this.plugin.setActiveProject(entry.slug);
			await this.ensureAiSessionLoaded();
			this.projectEditorDraft = null;
			this.projectEditorInitialSlug = "";
			this.projectEditorError = "";
			new Notice(
				this.t(
					isEditing
						? "projects.notice.updated"
						: "projects.notice.created",
					isEditing
						? "Project updated: {slug}"
						: "Project created: {slug}",
					{ slug: entry.slug },
				),
				3000,
			);
			await this.safeRenderBoard();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.projectEditorError = message;
			this.renderBoard();
		}
	}

	private async syncSingleProject(project: ProjectEntry): Promise<void> {
		const result = await this.plugin.syncService.sync(project);
		if (result.success) {
			project.lastSyncAt = new Date().toISOString();
			await this.plugin.saveSettings();
			new Notice(this.plugin.t("notice.syncSuccess", { slug: project.slug }), 3000);
		} else {
			new Notice(this.plugin.t("notice.syncFailed", { error: result.error ?? project.slug }), 6000);
		}

		this.plugin.workbenchStateStore.recordSyncReport({
			projectSlug: project.slug,
			result,
			recordedAt: new Date().toISOString(),
		});
		this.activePage = "projects";
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
			const result = results.get(project.slug);
			if (result?.success) {
				project.lastSyncAt = new Date().toISOString();
			}
		}
		await this.plugin.saveSettings();
		const recordedAt = new Date().toISOString();
		this.plugin.workbenchStateStore.setSyncReports(projects
			.map((project) => ({
				projectSlug: project.slug,
				result: results.get(project.slug) ?? {
					success: false,
					projectSlug: project.slug,
					pulledFiles: [],
					pushedFiles: [],
					conflicts: [],
					error: this.t("checks.sync.missing", "No sync result"),
				},
				recordedAt,
			}))
			.slice(0, 12));
		this.activePage = "projects";
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

	private captureAiMessageListScrollState(): void {
		const listEl = this.contentEl.querySelector(".friday-ai-message-list");
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


