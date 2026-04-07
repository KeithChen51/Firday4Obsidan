import {
	ItemView,
	MarkdownRenderer,
	Menu,
	normalizePath,
	Notice,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { runInitCommand } from "../commands/initCommand";
import { PERSONAL_SLUG } from "../constants/paths";
import { CreateTaskModal } from "../modals/CreateTaskModal";
import { ProjectMembersModal } from "../modals/ProjectMembersModal";
import { RegisterProjectModal } from "../modals/RegisterProjectModal";
import { SyncStatusModal } from "../modals/SyncStatusModal";
import { RuntimeProgressEvent, RuntimeToolTrace } from "../services/AgentRuntimeService";
import type { ApprovalDecision } from "../services/ToolApprovalService";
import type { ToolApprovalRequest } from "../services/ToolApprovalService";
import type { SkillDescriptor } from "../services/SkillCommandService";
import type { ChatMessage, ChatMessagePart, ModelCapabilityInfo } from "../services/AIService";
import type { ConversationSession } from "../services/ConversationService";
import type { VaultScanReport } from "../services/VaultContextService";
import type { AgentAction, AgentActionTargetType } from "../types/action";
import { KnowledgeSummary } from "../types/knowledge";
import { FridayPluginApi } from "../types/plugin";
import { ProjectEntry } from "../types/project";
import { TaskCreateInput, TaskData, TaskPriority } from "../types/task";
import { formatDate, isDueWithinDays, isOverdue } from "../utils/dateUtils";
import { MentionDropdown, MentionSuggestion } from "./components/MentionDropdown";

export const VIEW_TYPE_DAILY_BOARD = "friday-daily-board";

type BoardColumn = TaskPriority | "completed";
type BoardPage = "daily" | "projects" | "ai";

interface PageItem {
	id: BoardPage;
}

interface ParsedActionEnvelope {
	assistantText: string;
	actions: AgentAction[];
	parseError?: string;
}

interface MentionTokenRange {
	start: number;
	end: number;
	query: string;
}

interface PendingImageAttachment {
	id: string;
	name: string;
	mime: string;
	dataUrl: string;
	size: number;
}

const PAGE_ITEMS: PageItem[] = [
	{ id: "daily" },
	{ id: "projects" },
	{ id: "ai" },
];

export class DailyBoardView extends ItemView {
	private readonly plugin: FridayPluginApi;
	private refreshTimer: number | null = null;
	private currentDate = "";
	private selectedProjectSlug = "";
	private activePage: BoardPage = "daily";
	private activeTasks: TaskData[] = [];
	private completedTasks: TaskData[] = [];

	private aiConversation: ChatMessage[] = [];
	private aiSessionId = "";
	private aiDraft = "";
	private aiBusy = false;
	private aiLastError = "";
	private aiSessions: ConversationSession[] = [];
	private aiImageAttachments: PendingImageAttachment[] = [];
	private knowledgeSummary: KnowledgeSummary | null = null;
	private vaultContextUpdatedAt = "";
	private vaultScanReport: VaultScanReport | null = null;
	private aiMessageListScrollTop = 0;
	private aiMessageListStickToBottom = true;
	private aiForceScrollToBottomOnce = false;
	private aiStreamingPreview = "";
	private aiRuntimeLastRenderAt = 0;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPluginApi) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DAILY_BOARD;
	}

	getDisplayText(): string {
		return this.plugin.t("view.board.title");
	}

	getIcon(): string {
		return this.plugin.getBoardIconId();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("friday-daily-board");
		this.registerVaultWatchers();
		this.registerApprovalHandler();
		await this.ensureAiSessionLoaded();
		await this.safeRefreshBoard();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.plugin.toolApprovalService.clearPromptHandler();
		this.plugin.toolApprovalService.clearSessionRules();
	}

	private registerVaultWatchers(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.shouldRefreshOnFile(file.path)) return;
				this.scheduleRefresh();
			}),
		);
	}

	private registerApprovalHandler(): void {
		this.plugin.toolApprovalService.setPromptHandler(async (request: ToolApprovalRequest) => {
			return new Promise<ApprovalDecision>((resolve) => {
				const messageListEl = this.contentEl.querySelector(".friday-ai-message-list") as HTMLElement | null;
				if (!messageListEl) {
					resolve("allow_once");
					return;
				}
				this.renderApprovalCard(messageListEl, request, resolve);
			});
		});
	}

	private renderApprovalCard(
		messageListEl: HTMLElement,
		request: ToolApprovalRequest,
		resolve: (decision: ApprovalDecision) => void,
	): void {
		const card = messageListEl.createDiv({ cls: "friday-approval-card" });
		card.createDiv({
			cls: "friday-approval-header",
			text: this.t("ai.approval.header", "🔧 F.R.I.D.A.Y 请求执行工具"),
		});
		card.createDiv({ cls: "friday-approval-detail", text: `\u5de5\u5177\uff1a${request.tool}` });
		if (request.targetPath) {
			card.createDiv({ cls: "friday-approval-detail", text: `\u76ee\u6807\uff1a${request.targetPath}` });
		}
		card.createDiv({ cls: "friday-approval-detail", text: `\u8bf4\u660e\uff1a${request.description}` });

		const actions = card.createDiv({ cls: "friday-approval-actions" });

		const makeBtn = (text: string, cls: string, decision: ApprovalDecision): void => {
			const btn = actions.createEl("button", { text, cls: `friday-approval-btn ${cls}` });
			btn.onclick = () => {
				card.addClass("is-resolved");
				const label = card.createDiv({ cls: "friday-approval-detail", text: `\u2192 ${text}` });
				label.style.marginTop = "6px";
				label.style.fontWeight = "600";
				resolve(decision);
			};
		};

		makeBtn("\u2705 \u5141\u8bb8", "is-allow", "allow_once");
		makeBtn("\ud83d\udccc \u672c\u6b21\u4f1a\u8bdd\u5141\u8bb8", "is-session", "allow_session");
		makeBtn("\ud83d\udd12 \u59cb\u7ec8\u5141\u8bb8", "is-always", "allow_always");
		makeBtn("\u274c \u62d2\u7edd", "is-deny", "deny");

		// Scroll to bottom to show the card
		messageListEl.scrollTop = messageListEl.scrollHeight;
	}

	private shouldRefreshOnFile(path: string): boolean {
		const normalizedPath = normalizePath(path);
		const activeDate = this.currentDate || formatDate();
		const dailyNotePath = normalizePath(this.plugin.dataService.resolveDailyNotePath(activeDate));
		if (normalizedPath === dailyNotePath) {
			return true;
		}
		return this.plugin.dataService.isManagedTaskPath(normalizedPath);
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer != null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			void this.safeRefreshBoard();
		}, 400);
	}

	private async refreshBoard(): Promise<void> {
		this.currentDate = formatDate();
		this.activeTasks = await this.plugin.dataService.getDailyTasks(
			this.plugin.getPrimaryUserId(),
			this.currentDate,
			this.plugin.getDetectedUserId(),
		);
		this.completedTasks = await this.plugin.dataService.getCompletedTasksByDate(
			this.currentDate,
			this.plugin.getPrimaryUserId(),
			this.plugin.getDetectedUserId(),
		);
		this.renderBoard();
	}

	private async safeRefreshBoard(): Promise<void> {
		try {
			this.knowledgeSummary = await this.plugin.knowledgeCuratorService.getLatestSummary();
			await this.refreshBoard();
		} catch (error) {
			console.error("[Friday] Failed to render board:", error);
			this.contentEl.empty();
			this.contentEl.createEl("p", {
				text: this.t("board.error.renderFailed", "工作台渲染失败，请重试。"),
			});
			new Notice(this.t("board.notice.renderFailed", "工作台渲染失败，请查看控制台日志。"), 5000);
		}
	}

	private renderBoard(): void {
		this.captureAiMessageListScrollState();
		this.contentEl.empty();
		const shell = this.contentEl.createDiv({ cls: "friday-shell" });
		const nav = shell.createDiv({ cls: "friday-top-nav" });
		const page = shell.createDiv({ cls: "friday-page-content" });
		this.renderPageNav(nav);
		this.renderCurrentPage(page);
	}

	private renderPageNav(parent: HTMLElement): void {
		for (const item of PAGE_ITEMS) {
			const button = parent.createEl("button", {
				cls: "friday-nav-button",
				text: this.resolvePageLabel(item.id),
			});
			if (item.id === this.activePage) {
				button.addClass("is-active");
			}
			button.onclick = () => {
				if (item.id === this.activePage) return;
				this.activePage = item.id;
				this.renderBoard();
			};
		}
	}

	private renderCurrentPage(parent: HTMLElement): void {
		if (this.activePage === "daily") {
			this.renderDailyPage(parent);
			return;
		}
		if (this.activePage === "projects") {
			this.renderProjectRepoPage(parent);
			return;
		}
		this.renderAiPage(parent);
	}

	private resolvePageLabel(page: BoardPage): string {
		if (page === "daily") {
			return this.plugin.t("nav.todo");
		}
		if (page === "projects") {
			return this.plugin.t("nav.projects");
		}
		return this.plugin.t("nav.friday");
	}

	private renderDailyPage(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.plugin.t("daily.header", { date: this.currentDate }) });
		const actions = header.createDiv({ cls: "friday-page-actions" });

		this.addPageButton(actions, this.plugin.t("button.refresh"), async () => {
			await this.safeRefreshBoard();
		});
		this.addPageButton(actions, this.plugin.t("button.updateDaily"), async () => {
			await this.generateDailyNote();
			await this.safeRefreshBoard();
		});
		this.addPageButton(actions, this.plugin.t("button.newTask"), async () => {
			await this.openCreateTaskModal();
		});

		const columns = parent.createDiv({ cls: "friday-kanban-columns" });
		this.renderColumn(
			columns,
			"urgent",
			this.plugin.t("column.urgent"),
			this.activeTasks.filter((task) => task.priority === "urgent"),
		);
		this.renderColumn(
			columns,
			"high",
			this.plugin.t("column.high"),
			this.activeTasks.filter((task) => task.priority === "high"),
		);
		this.renderColumn(
			columns,
			"medium",
			this.plugin.t("column.medium"),
			this.activeTasks.filter((task) => task.priority === "medium"),
		);
		this.renderColumn(
			columns,
			"low",
			this.plugin.t("column.low"),
			this.activeTasks.filter((task) => task.priority === "low"),
		);
		this.renderColumn(columns, "completed", this.plugin.t("column.completed"), this.completedTasks);
	}

	private renderProjectRepoPage(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.plugin.t("projects.header") });
		const actions = header.createDiv({ cls: "friday-page-actions" });

		this.addPageButton(actions, this.t("projects.button.new", "新增项目"), async () => {
			await this.openProjectEditor();
		});
		this.addPageButton(actions, this.t("projects.button.syncAll", "同步全部"), async () => {
			await this.syncAllProjects();
		});
		this.addPageButton(actions, this.plugin.t("button.refresh"), async () => {
			await this.safeRefreshBoard();
		});

		const projects = this.plugin.settings.projects;
		if (!this.selectedProjectSlug && projects.length > 0) {
			this.selectedProjectSlug = projects[0]!.slug;
		}

		if (projects.length === 0) {
			const empty = parent.createDiv({ cls: "friday-empty-state" });
			empty.createEl("h4", { text: this.t("projects.empty.title", "还没有项目") });
			empty.createEl("p", { text: this.t("projects.empty.desc", "先创建项目，再在这里管理仓库和成员。") });
			this.addPageButton(empty, this.t("projects.empty.action", "立即创建项目"), async () => {
				await this.openProjectEditor();
			});
			return;
		}

		const grid = parent.createDiv({ cls: "friday-project-grid" });
		for (const project of projects) {
			this.renderProjectCard(grid, project);
		}
	}

	private renderProjectCard(parent: HTMLElement, project: ProjectEntry): void {
		const card = parent.createDiv({ cls: "friday-project-card" });
		if (project.slug === this.selectedProjectSlug) {
			card.addClass("is-active");
		}
		card.onclick = () => {
			this.selectedProjectSlug = project.slug;
			this.renderBoard();
		};

		const titleRow = card.createDiv({ cls: "friday-project-title" });
		titleRow.createEl("h4", { text: project.slug });

		const badgeRow = card.createDiv({ cls: "friday-project-badges" });
		badgeRow.createEl("span", {
			text: project.autoSync
				? this.t("projects.badge.autoSync", "自动同步")
				: this.t("projects.badge.manualSync", "手动同步"),
			cls: "friday-badge",
		});
		badgeRow.createEl("span", {
			text: project.gitRemote
				? this.t("projects.badge.repoLinked", "已关联仓库")
				: this.t("projects.badge.repoUnlinked", "未关联仓库"),
			cls: "friday-badge",
		});

		const meta = card.createDiv({ cls: "friday-project-meta" });
		meta.createEl("p", {
			text: this.t("projects.meta.localPath", "本地路径：{value}", {
				value: project.localPath || this.t("common.notSet", "未设置"),
			}),
		});
		meta.createEl("p", {
			text: this.t("projects.meta.remoteRepo", "远程仓库：{value}", {
				value: project.gitRemote || this.t("common.notSet", "未设置"),
			}),
		});
		meta.createEl("p", {
			text: this.t("projects.meta.lastSync", "最近同步：{value}", {
				value: project.lastSyncAt || this.t("common.never", "从未同步"),
			}),
		});

		const actions = card.createDiv({ cls: "friday-project-actions" });
		this.addPageButton(actions, this.t("projects.button.manage", "管理"), async () => {
			await this.openProjectEditor(project);
		});
		this.addPageButton(actions, this.t("projects.button.members", "成员"), async () => {
			new ProjectMembersModal(this.app, {
				projectSlug: project.slug,
				dataService: this.plugin.dataService,
				t: this.plugin.t.bind(this.plugin),
				onSaved: async () => {
					await this.safeRefreshBoard();
				},
			}).open();
		});
		this.addPageButton(actions, this.t("projects.button.sync", "同步"), async () => {
			await this.syncSingleProject(project);
		});
		this.addPageButton(actions, this.t("projects.button.remove", "移除"), async () => {
			const accepted = window.confirm(
				this.t("projects.confirm.remove", "确认移除项目「{slug}」？", { slug: project.slug }),
			);
			if (!accepted) return;
			await this.plugin.removeProject(project.slug);
			if (this.selectedProjectSlug === project.slug) {
				this.selectedProjectSlug = this.plugin.settings.projects[0]?.slug ?? "";
			}
			await this.safeRefreshBoard();
		});
	}

	private renderAiPage(parent: HTMLElement): void {
		const llmConfigured = this.plugin.aiService.isConfigured();
		const activeAgent = this.plugin.getActiveAgent();
		const activeModel = activeAgent?.model?.trim() || this.plugin.settings.llm.model?.trim() || "";
		const modelCapability = this.plugin.aiService.getModelCapability(activeModel || undefined);

		const header = parent.createDiv({ cls: "friday-page-header friday-ai-page-header" });
		const heading = header.createDiv({ cls: "friday-ai-heading" });
		heading.createEl("h3", { text: this.plugin.t("ai.title") });
		heading.createEl("p", {
			cls: "friday-ai-subtitle",
			text: this.plugin.t("ai.subtitle"),
		});

		const actions = header.createDiv({ cls: "friday-page-actions friday-ai-actions" });
		const status = actions.createDiv({
			cls: `friday-ai-conn-status ${llmConfigured ? "is-online" : "is-offline"}`,
		});
		status.createSpan({ cls: "friday-ai-conn-dot" });
		status.createSpan({ text: llmConfigured ? this.plugin.t("ai.status.online") : this.plugin.t("ai.status.offline") });

		const selectorWrap = actions.createDiv({ cls: "friday-ai-agent-select-wrap" });
		const selector = selectorWrap.createEl("select", { cls: "friday-ai-agent-select" });
		for (const agent of this.plugin.settings.agents) {
			const option = selector.createEl("option", { text: agent.name });
			option.value = agent.id;
			if (agent.id === this.plugin.settings.activeAgentId) {
				option.selected = true;
			}
		}
		selector.onchange = () => {
			void this.switchAgent(selector.value);
		};

		this.addPageButton(actions, this.plugin.t("ai.button.curate"), async () => {
			const summary = await this.plugin.runKnowledgeCuration();
			this.knowledgeSummary = summary;
			new Notice(
				this.plugin.t("notice.knowledgeCurationDone", {
					global: summary.globalUserCount,
					project: summary.projectCount,
					review: summary.needsReviewCount,
				}),
				6000,
			);
			this.renderBoard();
		});
		this.addPageButton(actions, this.plugin.t("ai.button.revalidate"), async () => {
			const summary = await this.plugin.runKnowledgeRevalidation();
			this.knowledgeSummary = summary;
			new Notice(this.plugin.t("notice.knowledgeRevalidateDone", { review: summary.needsReviewCount }), 5000);
			this.renderBoard();
		});
		this.addPageButton(actions, this.plugin.t("ai.button.clear"), async () => {
			this.aiConversation = [];
			this.aiDraft = "";
			this.aiLastError = "";
			this.aiStreamingPreview = "";
			this.aiImageAttachments = [];
			this.aiSessionId = this.plugin.conversationService.createSessionId();
			this.plugin.toolApprovalService.clearSessionRules();
			await this.persistConversation();
			this.renderBoard();
		});
		this.addPageButton(actions, this.plugin.t("ai.button.refreshContext"), async () => {
			const scoped = await this.plugin.vaultContextService.scanConfiguredScope(1200);
			this.vaultScanReport = scoped.report;
			this.vaultContextUpdatedAt = scoped.report.scannedAt;
			new Notice(this.plugin.t("ai.notice.contextRefreshed"), 2500);
			this.renderBoard();
		});
		this.addPageButton(actions, this.plugin.t("ai.button.openSettings"), async () => {
			this.plugin.openSettingsTab();
		});

		const panel = parent.createDiv({ cls: "friday-ai-chat-panel friday-ai-chat-shell" });
		const info = panel.createDiv({ cls: "friday-ai-agent-info" });
		const currentAgentText = this.plugin.t("ai.info.currentAgent", {
			name: activeAgent?.name ?? "N/A",
		});
		const modelSuffix = activeAgent?.model
			? this.plugin.t("ai.info.modelSuffix", { model: activeAgent.model })
			: "";
		info.createEl("div", {
			text: `${currentAgentText}${modelSuffix}`,
		});
		info.createEl("div", {
			text: this.plugin.t("ai.info.vision", {
				vision: this.formatVisionCapability(modelCapability),
				reason: modelCapability.reason,
			}),
		});
		if (this.knowledgeSummary) {
			info.createEl("div", {
				text: this.t(
					"ai.info.knowledgeStatus",
					"知识状态：最近提炼 {lastRunAt} | 待回查 {needsReview} | 预算命中率 {hitRate}%",
					{
						lastRunAt: this.knowledgeSummary.lastRunAt,
						needsReview: this.knowledgeSummary.needsReviewCount,
						hitRate: Math.round(this.knowledgeSummary.budgetHitRate * 100),
					},
				),
			});
		}
		info.createEl("div", {
			text: this.plugin.t("ai.info.snapshot", {
				time: this.vaultContextUpdatedAt || this.plugin.t("ai.info.snapshotDefault"),
			}),
		});
		if (this.vaultScanReport) {
			info.createEl("div", {
				text: this.plugin.t("ai.info.scan", {
					paths: this.vaultScanReport.scopePaths.join(", "),
					count: this.vaultScanReport.totalAccessibleFiles,
				}),
			});
		}

		this.renderAiSessionTabs(panel);

		const messages = panel.createDiv({ cls: "friday-ai-message-list" });
		if (this.aiConversation.length === 0 && !this.aiBusy) {
			const empty = messages.createDiv({ cls: "friday-ai-empty" });
			empty.createEl("h4", { text: this.plugin.t("ai.empty.title") });
			empty.createEl("p", { text: this.plugin.t("ai.empty.desc") });
		}

		for (const message of this.aiConversation) {
			const roleClass = message.role === "user" ? "is-user" : "is-assistant";
			const item = messages.createDiv({ cls: `friday-ai-message ${roleClass}` });
			item.createDiv({
				cls: "friday-ai-message-role",
				text: message.role === "user" ? this.plugin.t("ai.role.user") : this.plugin.t("ai.role.assistant"),
			});
			const content = item.createDiv({ cls: "friday-ai-message-content" });
			this.renderMessageMarkdown(content, message.content);
		}

		if (this.aiBusy) {
			const pending = messages.createDiv({ cls: "friday-ai-message is-assistant" });
			pending.createDiv({ cls: "friday-ai-message-role", text: this.plugin.t("ai.role.assistant") });
			const pendingContent = pending.createDiv({ cls: "friday-ai-message-content" });
			if (this.aiStreamingPreview.trim()) {
				this.renderMessageMarkdown(pendingContent, this.aiStreamingPreview);
				pendingContent.addClass("is-streaming");
			} else {
				pendingContent.setText(this.plugin.t("ai.pending"));
			}
		}

		if (this.aiLastError) {
			messages.createDiv({
				cls: "friday-ai-error",
				text: this.t("ai.error.withPrefix", "错误：{error}", { error: this.aiLastError }),
			});
		}

		const composerWrap = panel.createDiv({ cls: "friday-ai-composer-wrap" });
		if (this.aiImageAttachments.length > 0) {
			const list = composerWrap.createDiv({ cls: "friday-ai-attachment-list" });
			for (const image of this.aiImageAttachments) {
				const chip = list.createDiv({ cls: "friday-ai-attachment-chip" });
				chip.createSpan({
					cls: "friday-ai-attachment-name",
					text: `${image.name || "image"} (${Math.max(1, Math.round(image.size / 1024))}KB)`,
				});
				const remove = chip.createEl("button", { cls: "friday-ai-attachment-remove", text: "×" });
				remove.type = "button";
				remove.disabled = this.aiBusy;
				remove.onclick = () => {
					this.aiImageAttachments = this.aiImageAttachments.filter((item) => item.id !== image.id);
					this.renderBoard();
				};
			}
		}

		const composer = composerWrap.createDiv({ cls: "friday-ai-composer" });
		const mentionDropdown = new MentionDropdown(composer);
		let mentionRange: MentionTokenRange | null = null;
		const imagePicker = composer.createEl("input", {
			attr: { type: "file", accept: "image/*", multiple: "true" },
		});
		imagePicker.addClass("friday-ai-image-picker");
		imagePicker.disabled = this.aiBusy;

		const imageBtn = composer.createEl("button", {
			cls: "friday-ai-image-button",
			text:
				this.aiImageAttachments.length > 0
					? this.plugin.t("ai.image.button.count", { count: this.aiImageAttachments.length })
					: this.plugin.t("ai.image.button"),
		});
		imageBtn.disabled = this.aiBusy;
		imageBtn.onclick = () => {
			imagePicker.click();
		};
		imagePicker.onchange = () => {
			const files = Array.from(imagePicker.files ?? []);
			void this.addImageAttachments(files);
			imagePicker.value = "";
		};

		const input = composer.createEl("textarea", {
			cls: "friday-ai-input",
			attr: { placeholder: this.plugin.t("ai.input.placeholder") },
		});

		const refreshMentionDropdown = () => {
			mentionRange = this.resolveMentionTokenRange(input.value, input.selectionStart ?? input.value.length);
			if (!mentionRange) {
				mentionDropdown.hide();
				return;
			}
			const suggestions = this.getMentionSuggestions(mentionRange.query);
			mentionDropdown.show(suggestions);
		};

		mentionDropdown.onSelect((item) => {
			if (!mentionRange) {
				return;
			}
			const applied = this.applyMentionSuggestion(input.value, mentionRange, item.value);
			input.value = applied.nextValue;
			this.aiDraft = applied.nextValue;
			input.focus();
			input.setSelectionRange(applied.cursor, applied.cursor);
			mentionRange = null;
			mentionDropdown.hide();
		});

		input.rows = 3;
		input.value = this.aiDraft;
		input.disabled = this.aiBusy;
		input.oninput = () => {
			this.aiDraft = input.value;
			refreshMentionDropdown();
		};
		input.onclick = () => {
			refreshMentionDropdown();
		};
		input.onkeyup = (event) => {
			if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) {
				return;
			}
			refreshMentionDropdown();
		};
		input.onblur = () => {
			window.setTimeout(() => mentionDropdown.hide(), 120);
		};
		input.onpaste = (event) => {
			const files: File[] = [];
			for (const item of Array.from(event.clipboardData?.items ?? [])) {
				if (item.kind !== "file") continue;
				const file = item.getAsFile();
				if (!file || !file.type.startsWith("image/")) continue;
				files.push(file);
			}
			if (files.length > 0) {
				event.preventDefault();
				void this.addImageAttachments(files);
			}
		};
		input.ondragover = (event) => {
			if (this.aiBusy) return;
			event.preventDefault();
		};
		input.ondrop = (event) => {
			if (this.aiBusy) return;
			const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
				file.type.startsWith("image/"),
			);
			if (files.length > 0) {
				event.preventDefault();
				void this.addImageAttachments(files);
			}
		};
		input.onkeydown = (event) => {
			if (mentionDropdown.handleKeydown(event)) {
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.submitAiPrompt(input.value);
			}
		};

		const send = composer.createEl("button", {
			text: this.aiBusy ? this.plugin.t("ai.sending") : this.plugin.t("ai.send"),
		});
		send.disabled = this.aiBusy;
		send.onclick = () => {
			mentionDropdown.hide();
			void this.submitAiPrompt(input.value);
		};

		this.restoreAiMessageListScrollState(messages);
	}

	private renderMessageMarkdown(container: HTMLElement, markdown: string): void {
		container.empty();
		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		void MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, this);
	}

	private renderAiSessionTabs(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: "friday-ai-session-tabs" });
		const list = row.createDiv({ cls: "friday-ai-session-tab-list" });

		const sessions = [...this.aiSessions]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 8);

		for (const session of sessions) {
			const tab = list.createEl("button", {
				cls: "friday-ai-session-tab",
				text: this.getAiSessionLabel(session),
			});
			if (session.sessionId === this.aiSessionId) {
				tab.addClass("is-active");
			}
			tab.onclick = () => {
				void this.switchToAiSession(session.sessionId);
			};
		}

		const newButton = row.createEl("button", {
			cls: "friday-ai-session-new",
			text: this.t("ai.session.new", "+ 新会话"),
		});
		newButton.disabled = this.aiBusy;
		newButton.onclick = () => {
			void this.startNewAiSession();
		};
	}

	private getAiSessionLabel(session: ConversationSession): string {
		const firstUser = session.messages.find((item) => item.role === "user")?.content.trim() ?? "";
		if (firstUser) {
			const compact = firstUser.replace(/\s+/g, " ");
			return compact.length > 16 ? `${compact.slice(0, 16)}…` : compact;
		}
		const date = new Date(session.updatedAt);
		if (Number.isNaN(date.getTime())) {
			return session.sessionId.slice(0, 16);
		}
		return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	}

	private async switchToAiSession(sessionId: string): Promise<void> {
		if (!sessionId || sessionId === this.aiSessionId || this.aiBusy) {
			return;
		}
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			return;
		}

		const matched = this.aiSessions.find((item) => item.sessionId === sessionId);
		if (!matched) {
			await this.refreshAiSessions(activeAgent.id);
		}
		const target = this.aiSessions.find((item) => item.sessionId === sessionId);
		if (!target) {
			new Notice(this.t("ai.session.missing", "会话不存在或已被删除。"), 3500);
			return;
		}

		this.aiSessionId = target.sessionId;
		this.aiConversation = [...target.messages];
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiImageAttachments = [];
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private async startNewAiSession(): Promise<void> {
		if (this.aiBusy) {
			return;
		}
		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiConversation = [];
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiImageAttachments = [];
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private async addImageAttachments(files: File[]): Promise<void> {
		if (this.aiBusy || files.length === 0) {
			return;
		}
		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		if (imageFiles.length === 0) {
			return;
		}

		const accepted: PendingImageAttachment[] = [];
		for (const file of imageFiles.slice(0, 6)) {
			if (file.size > 8 * 1024 * 1024) {
				new Notice(this.t("ai.image.tooLarge", "图片过大（>8MB）：{name}", { name: file.name }), 3500);
				continue;
			}
			try {
				const dataUrl = await this.fileToDataUrl(file);
				accepted.push({
					id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
					name: file.name,
					mime: file.type || "image/png",
					dataUrl,
					size: file.size,
				});
			} catch {
				new Notice(this.t("ai.image.readFailed", "读取图片失败：{name}", { name: file.name }), 3500);
			}
		}
		if (accepted.length === 0) {
			return;
		}
		this.aiImageAttachments = [...this.aiImageAttachments, ...accepted].slice(0, 6);
		this.renderBoard();
	}

	private fileToDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (typeof reader.result === "string") {
					resolve(reader.result);
					return;
				}
				reject(new Error(this.t("ai.image.invalidDataUrl", "读取结果不是 data URL")));
			};
			reader.onerror = () => reject(reader.error ?? new Error(this.t("ai.image.readFileFailed", "读取文件失败")));
			reader.readAsDataURL(file);
		});
	}

	private buildImageMessageParts(prompt: string, images: PendingImageAttachment[]): ChatMessagePart[] {
		const parts: ChatMessagePart[] = [
			{
				type: "text",
				text: prompt,
			},
		];
		for (const image of images) {
			parts.push({
				type: "image_url",
				image_url: {
					url: image.dataUrl,
				},
			});
		}
		return parts;
	}

	private async switchAgent(agentId: string): Promise<void> {
		try {
			await this.plugin.setActiveAgent(agentId);
			await this.ensureAiSessionLoaded();
			await this.safeRefreshBoard();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			new Notice(this.t("ai.notice.switchAgentFailed", "切换 Agent 失败：{error}", { error: message }), 6000);
		}
	}

	private async ensureAiSessionLoaded(): Promise<void> {
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			this.aiConversation = [];
			this.aiSessionId = "";
			this.aiSessions = [];
			this.aiStreamingPreview = "";
			this.aiImageAttachments = [];
			return;
		}

		await this.refreshAiSessions(activeAgent.id);
		const active = this.aiSessionId
			? this.aiSessions.find((item) => item.sessionId === this.aiSessionId)
			: null;
		if (active) {
			this.aiConversation = [...active.messages];
			return;
		}

		const latest = this.aiSessions[0];
		if (latest) {
			this.aiSessionId = latest.sessionId;
			this.aiConversation = [...latest.messages];
			return;
		}

		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.aiConversation = [];
		this.aiStreamingPreview = "";
		this.aiImageAttachments = [];
	}

	private async persistConversation(): Promise<void> {
		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) return;
		if (!this.aiSessionId) {
			this.aiSessionId = this.plugin.conversationService.createSessionId();
		}
		if (this.aiConversation.length === 0) {
			await this.refreshAiSessions(activeAgent.id);
			return;
		}
		await this.plugin.conversationService.saveSession(activeAgent.id, this.aiSessionId, this.aiConversation);
		await this.refreshAiSessions(activeAgent.id);
	}

	private async refreshAiSessions(agentId: string): Promise<void> {
		this.aiSessions = await this.plugin.conversationService.listSessions(agentId, 40);
	}

	private async submitAiPrompt(rawPrompt: string): Promise<void> {
		const prompt = rawPrompt.trim();
		if (!prompt || this.aiBusy) return;
		if (/^\/init(?:\s+.*)?$/i.test(prompt)) {
			await this.handleInitSlash(prompt);
			return;
		}

		let effectivePrompt = prompt;
		let extraSystemContext = "";
		let skillBanner = "";
		let slashBanner = "";
		let imageBanner = "";
		let slashAllowedTools: string[] = [];
		let slashAllowedModels: string[] = [];
		const imageAttachments = [...this.aiImageAttachments];

		const slashExpansion = this.plugin.slashCommandService.expand(prompt);
		if (slashExpansion.type === "invalid") {
			this.aiLastError = slashExpansion.error;
			new Notice(slashExpansion.error, 5000);
			this.renderBoard();
			return;
		}
		if (slashExpansion.type === "expanded") {
			effectivePrompt = slashExpansion.prompt;
			slashAllowedTools = slashExpansion.allowedTools;
			slashAllowedModels = slashExpansion.allowedModels;
			slashBanner = this.t("ai.banner.slashApplied", "已应用命令：/{name}", {
				name: slashExpansion.command.name,
			});
		}

		const slash =
			slashExpansion.type === "expanded"
				? ({ type: "none" } as const)
				: this.plugin.skillCommandService.parseSlashCommand(prompt);
		if (slash.type === "invalid") {
			this.aiLastError = slash.error;
			new Notice(slash.error, 5000);
			this.renderBoard();
			return;
		}
		if (slash.type === "list") {
			await this.respondSkillCatalog(prompt);
			return;
		}
		if (slash.type === "use") {
			try {
				const resolved = await this.plugin.skillCommandService.buildSkillSystemContext(slash.skillName);
				effectivePrompt = slash.taskPrompt;
				extraSystemContext = resolved.systemContext;
				skillBanner = this.t("ai.banner.skillApplied", "已启用 Skill：{name} (/{command})", {
					name: resolved.skill.name,
					command: resolved.skill.command,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				this.aiLastError = message || this.t("ai.error.skillLoadFailed", "技能加载失败");
				new Notice(this.aiLastError, 6000);
				this.renderBoard();
				return;
			}
		}

		if (!this.plugin.aiService.isConfigured()) {
			this.aiLastError = this.plugin.t("ai.error.notConfigured");
			new Notice(this.aiLastError, 5000);
			this.plugin.openSettingsTab();
			this.renderBoard();
			return;
		}

		const activeAgent = this.plugin.getActiveAgent();
		if (!activeAgent) {
			this.aiLastError = this.plugin.t("ai.error.noAgent");
			new Notice(this.aiLastError, 4000);
			return;
		}
		const effectiveModelForTurn =
			activeAgent.model?.trim() || this.plugin.settings.llm.model?.trim() || "";
		if (slashAllowedModels.length > 0) {
			if (!effectiveModelForTurn || !slashAllowedModels.includes(effectiveModelForTurn)) {
				this.aiLastError = this.t(
					"ai.error.modelRestricted",
					"命令模型限制：当前模型 {model} 不在允许列表中",
					{ model: effectiveModelForTurn || this.t("common.notSet", "(未设置)") },
				);
				new Notice(this.aiLastError, 6000);
				return;
			}
		}
		const mentionResolution = await this.resolveMentionsInPrompt(effectivePrompt);
		effectivePrompt = mentionResolution.prompt;
		if (mentionResolution.systemContext) {
			extraSystemContext = [extraSystemContext, mentionResolution.systemContext].filter((item) => item.trim()).join("\n\n");
		}

		if (imageAttachments.length > 0) {
			const capability = this.plugin.aiService.getModelCapability(effectiveModelForTurn || undefined);
			if (capability.vision === "unsupported") {
				this.aiLastError = this.t(
					"ai.error.visionUnsupported",
					"当前模型可能不支持图片输入：{model}。{reason}",
					{
						model: effectiveModelForTurn || this.t("common.modelNotSet", "(未设置模型)"),
						reason: capability.reason,
					},
				);
				new Notice(this.aiLastError, 7000);
				this.renderBoard();
				return;
			}
			if (capability.vision === "unknown") {
				new Notice(
					this.t("ai.notice.visionUnknownContinue", "当前模型视觉能力无法确认（{model}），将继续尝试发送图片。", {
						model: effectiveModelForTurn || this.t("common.modelNotSet2", "未设置模型"),
					}),
					5000,
				);
			}
			imageBanner = this.t("ai.banner.imagesAttached", "已附加图片 {count} 张（{vision}）", {
				count: imageAttachments.length,
				vision: this.formatVisionCapability(capability),
			});
		}
		const userHistoryContent =
			imageAttachments.length > 0
				? `${prompt}\n\n[${this.t("ai.banner.imagesAttachedShort", "已附加图片 {count} 张", {
						count: imageAttachments.length,
					})}]`
				: prompt;
		this.aiConversation.push({ role: "user", content: userHistoryContent });
		this.aiDraft = "";
		this.aiBusy = true;
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeLastRenderAt = 0;
		this.aiImageAttachments = [];
		await this.persistConversation();
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
		const conversationHistory = this.aiConversation.slice(0, -1);
		const currentUserMessage: ChatMessage =
			imageAttachments.length > 0
				? {
						role: "user",
						content: effectivePrompt,
						parts: this.buildImageMessageParts(effectivePrompt, imageAttachments),
					}
				: { role: "user", content: effectivePrompt };
		const conversationForModel: ChatMessage[] = [...conversationHistory, currentUserMessage];

		try {
			const runtimeEnabled =
				this.plugin.settings.agentRuntime.toolRuntimeEnabled && imageAttachments.length === 0;
			if (imageAttachments.length > 0 && this.plugin.settings.agentRuntime.toolRuntimeEnabled) {
				new Notice(this.t("ai.notice.imageDirectMode", "检测到图片输入：本轮自动切换为多模态直连模式（暂不走工具运行时）。"), 4500);
			}
			if (runtimeEnabled) {
				this.vaultContextUpdatedAt = "";
				this.vaultScanReport = null;
				const runtimeResult = await this.plugin.agentRuntimeService.runTurn({
					agentId: activeAgent.id,
					conversation: conversationHistory,
					userPrompt: effectivePrompt,
					modelOverride: activeAgent.model?.trim() || undefined,
					currentFilePath: this.app.workspace.getActiveFile()?.path ?? "",
					extraSystemContext,
					allowedTools: slashAllowedTools,
					onProgress: (event) => {
						const line = this.formatRuntimeProgressLine(event);
						if (!line) {
							return;
						}
						const existing = this.aiStreamingPreview
							.split("\n")
							.map((item) => item.trimEnd())
							.filter((item) => item.length > 0);
						existing.push(line);
						const compact = existing.slice(-24);
						this.aiStreamingPreview = compact.join("\n");
						this.aiForceScrollToBottomOnce = true;
						const now = Date.now();
						if (this.aiRuntimeLastRenderAt <= 0) {
							this.aiRuntimeLastRenderAt = now;
							this.renderBoard();
							return;
						}
						if (now - this.aiRuntimeLastRenderAt >= 140 || event.phase === "done" || event.phase === "error") {
							this.aiRuntimeLastRenderAt = now;
							this.renderBoard();
						}
					},
				});

				const parts: string[] = [];
				if (slashBanner) {
					parts.push(slashBanner);
				}
				if (mentionResolution.banner) {
					parts.push(mentionResolution.banner);
				}
				if (skillBanner) {
					parts.push(skillBanner);
				}
				if (imageBanner) {
					parts.push(imageBanner);
				}
				if (runtimeResult.assistantText.trim()) {
					parts.push(runtimeResult.assistantText.trim());
				}
				const traceText = this.formatRuntimeTrace(runtimeResult.traces);
				if (traceText) {
					parts.push(traceText);
				}
				if (runtimeResult.parseError) {
					parts.push(
						this.t("ai.runtime.parseHint", "运行时解析提示：{error}", {
							error: runtimeResult.parseError,
						}),
					);
				}

				this.aiConversation.push({
					role: "assistant",
					content: parts.join("\n\n").trim() || this.t("ai.runtime.emptyResponse", "（模型未返回有效内容）"),
				});
			} else {
				const modelMessages = await this.buildModelMessages(
					effectivePrompt,
					conversationForModel,
					extraSystemContext,
				);
				const streamingEnabled = this.plugin.settings.llm.enableStreaming ?? true;
				let reply = "";
				if (streamingEnabled) {
					let lastRenderAt = 0;
					reply = await this.plugin.aiService.chatStream(modelMessages, {
						modelOverride: activeAgent.model?.trim() || undefined,
						onDelta: (delta) => {
							if (!delta) return;
							this.aiStreamingPreview += delta;
							const now = Date.now();
							if (now - lastRenderAt >= 120) {
								lastRenderAt = now;
								this.aiForceScrollToBottomOnce = true;
								this.renderBoard();
							}
						},
					});
				} else {
					reply = await this.plugin.aiService.chat(modelMessages, {
						modelOverride: activeAgent.model?.trim() || undefined,
					});
				}

				const parsed = this.parseActionEnvelope(reply);
				const executionNote = await this.handleAgentActions(parsed.actions, activeAgent.id);
				const parts: string[] = [];
				if (slashBanner) {
					parts.push(slashBanner);
				}
				if (mentionResolution.banner) {
					parts.push(mentionResolution.banner);
				}
				if (skillBanner) {
					parts.push(skillBanner);
				}
				if (imageBanner) {
					parts.push(imageBanner);
				}
				if (parsed.assistantText.trim()) {
					parts.push(parsed.assistantText.trim());
				}
				if (executionNote.trim()) {
					parts.push(executionNote.trim());
				}
				if (parsed.parseError) {
					parts.push(
						this.t("ai.runtime.actionParseFailed", "动作解析失败：{error}", {
							error: parsed.parseError,
						}),
					);
				}

				this.aiConversation.push({
					role: "assistant",
					content: parts.join("\n\n").trim() || this.t("ai.runtime.emptyResponse", "（模型未返回有效内容）"),
				});
			}
			await this.persistConversation();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.aiLastError = message.trim() || this.t("common.unknownError", "未知错误");
			new Notice(
				this.t("ai.notice.chatFailed", "F.R.I.D.A.Y 对话失败：{error}", { error: this.aiLastError }),
				7000,
			);
		} finally {
			this.aiBusy = false;
			this.aiStreamingPreview = "";
			this.aiRuntimeLastRenderAt = 0;
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		}
	}

	private async handleInitSlash(displayPrompt: string): Promise<void> {
		this.aiConversation.push({ role: "user", content: displayPrompt });
		this.aiDraft = "";
		this.aiBusy = true;
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiImageAttachments = [];
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			const result = await runInitCommand(this.plugin, {
				confirmOverwrite: true,
				openFile: true,
			});

			let summary = "";
			if (result.status === "created") {
				summary = this.plugin.t("notice.initCreated", { path: result.path });
			} else if (result.status === "updated") {
				summary = this.plugin.t("notice.initUpdated", { path: result.path });
			} else if (result.status === "unchanged") {
				summary = this.plugin.t("notice.initUnchanged", { path: result.path });
			} else {
				summary = this.plugin.t("notice.initCancelled");
			}

			this.aiConversation.push({
				role: "assistant",
				content: summary,
			});
			await this.persistConversation();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.aiLastError = message.trim() || this.t("ai.error.initFailed", "初始化失败");
			new Notice(
				this.t("ai.notice.initFailed", "F.R.I.D.A.Y 初始化失败：{error}", { error: this.aiLastError }),
				7000,
			);
		} finally {
			this.aiBusy = false;
			this.aiStreamingPreview = "";
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		}
	}

	private resolveMentionTokenRange(text: string, cursor: number): MentionTokenRange | null {
		const safeCursor = Math.max(0, Math.min(cursor, text.length));
		const beforeCursor = text.slice(0, safeCursor);
		const atIndex = beforeCursor.lastIndexOf("@");
		if (atIndex < 0) {
			return null;
		}

		const prevChar = atIndex > 0 ? beforeCursor[atIndex - 1] ?? "" : "";
		if (prevChar && !/[\s([{]/.test(prevChar)) {
			return null;
		}

		const token = beforeCursor.slice(atIndex + 1);
		if (token.includes("\n")) {
			return null;
		}
		if (/[\s,，。；;！？!?]/.test(token)) {
			return null;
		}

		return {
			start: atIndex,
			end: safeCursor,
			query: token.trim().toLowerCase(),
		};
	}

	private getMentionSuggestions(query: string): MentionSuggestion[] {
		const normalizedQuery = query.trim().toLowerCase();
		const files = this.app.vault
			.getFiles()
			.filter((file) => this.plugin.workspaceAccessService.canReadVaultPath(file.path));

		const ranked = files
			.map((file) => {
				const pathText = normalizePath(file.path);
				const pathLower = pathText.toLowerCase();
				const nameLower = file.basename.toLowerCase();

				let score = 0;
				if (!normalizedQuery) {
					score = 1;
				} else {
					if (nameLower === normalizedQuery) score += 100;
					if (nameLower.startsWith(normalizedQuery)) score += 80;
					if (nameLower.includes(normalizedQuery)) score += 55;
					if (pathLower.startsWith(normalizedQuery)) score += 45;
					if (pathLower.includes(normalizedQuery)) score += 32;
				}

				if (file.extension === "md" || file.extension === "canvas") {
					score += 8;
				}

				return {
					score,
					path: pathText,
					label: file.basename,
					description: `${pathText} · ${file.extension}`,
				};
			})
			.filter((item) => item.score > 0)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}
				return left.path.localeCompare(right.path);
			})
			.slice(0, 12);

		return ranked.map((item) => ({
			value: item.path,
			label: item.label,
			description: item.description,
		}));
	}

	private applyMentionSuggestion(
		rawText: string,
		range: MentionTokenRange,
		mentionPath: string,
	): { nextValue: string; cursor: number } {
		const safePath = normalizePath(mentionPath.trim());
		const mentionToken = /\s/.test(safePath) ? `@"${safePath}"` : `@${safePath}`;
		const suffix = rawText.slice(range.end);
		const spacer = suffix.startsWith(" ") || suffix.startsWith("\n") || suffix.length === 0 ? "" : " ";
		const nextValue = `${rawText.slice(0, range.start)}${mentionToken}${spacer}${suffix}`;
		const cursor = range.start + mentionToken.length + spacer.length;
		return { nextValue, cursor };
	}

	private async resolveMentionsInPrompt(
		prompt: string,
	): Promise<{ prompt: string; systemContext: string; banner: string }> {
		const mentionRegex = /@(?:"([^"]+)"|'([^']+)'|([^\s,，。；;！？!?]+))/g;
		const matches = [...prompt.matchAll(mentionRegex)];
		if (matches.length === 0) {
			return { prompt, systemContext: "", banner: "" };
		}

		let resolvedPrompt = prompt;
		const seen = new Set<string>();
		const contextLines: string[] = [];
		const resolvedPaths: string[] = [];

		for (const match of matches) {
			const fullToken = match[0] ?? "";
			const rawRef = (match[1] ?? match[2] ?? match[3] ?? "").trim();
			if (!fullToken || !rawRef) {
				continue;
			}
			const file = this.resolveMentionFile(rawRef);
			if (!file) {
				continue;
			}
			if (!this.plugin.workspaceAccessService.canReadVaultPath(file.path)) {
				continue;
			}

			resolvedPrompt = resolvedPrompt.replace(fullToken, file.path);
			if (seen.has(file.path)) {
				continue;
			}
			seen.add(file.path);
			resolvedPaths.push(file.path);

			try {
				const raw = await this.app.vault.cachedRead(file);
				const snippet =
					raw.length > 1800
						? `${raw.slice(0, 1800)}\n${this.t("ai.mention.truncated", "...（已截断）")}`
						: raw;
				contextLines.push(`### ${file.path}\n${snippet}`);
			} catch {
				// Ignore unreadable mention files.
			}
		}

		if (contextLines.length === 0) {
			return { prompt: resolvedPrompt, systemContext: "", banner: "" };
		}

		const systemContext = [
			"[MentionedFiles]",
			this.t("ai.mention.contextLead", "以下是用户 @ 提及文件的内容摘要，请优先参考："),
			...contextLines,
			"[/MentionedFiles]",
		].join("\n\n");
		const banner = this.t("ai.mention.banner", "已解析文件引用：{paths}", {
			paths: resolvedPaths.join("、"),
		});
		return { prompt: resolvedPrompt, systemContext, banner };
	}

	private resolveMentionFile(rawRef: string): TFile | null {
		const normalized = normalizePath(rawRef.replace(/^\/+/, ""));
		const direct = this.app.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}

		const tryExtensions = ["md", "canvas"];
		for (const ext of tryExtensions) {
			const withExt = normalized.toLowerCase().endsWith(`.${ext}`) ? normalized : `${normalized}.${ext}`;
			const file = this.app.vault.getAbstractFileByPath(withExt);
			if (file instanceof TFile) {
				return file;
			}
		}

		const allFiles = this.app.vault.getFiles();
		const lowered = normalized.toLowerCase();
		const baseName = lowered.split("/").pop() ?? lowered;
		const byPath = allFiles.find((file) => normalizePath(file.path).toLowerCase().endsWith(lowered));
		if (byPath) {
			return byPath;
		}
		const byName = allFiles.find((file) => file.basename.toLowerCase() === baseName.replace(/\.(md|canvas)$/i, ""));
		return byName ?? null;
	}

	private async respondSkillCatalog(displayPrompt: string): Promise<void> {
		const skills = await this.plugin.skillCommandService.listSkills(40);
		const content = this.formatSkillCatalog(skills);
		this.aiConversation.push({ role: "user", content: displayPrompt });
		this.aiConversation.push({ role: "assistant", content });
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiImageAttachments = [];
		await this.persistConversation();
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private captureAiMessageListScrollState(): void {
		const existing = this.contentEl.querySelector(".friday-ai-message-list");
		if (!(existing instanceof HTMLElement)) {
			return;
		}
		this.aiMessageListScrollTop = existing.scrollTop;
		const distanceToBottom = existing.scrollHeight - (existing.scrollTop + existing.clientHeight);
		this.aiMessageListStickToBottom = distanceToBottom <= 24;
	}

	private restoreAiMessageListScrollState(messageList: HTMLElement): void {
		const shouldScrollToBottom = this.aiForceScrollToBottomOnce || this.aiMessageListStickToBottom;
		if (shouldScrollToBottom) {
			const pinBottom = () => {
				messageList.scrollTop = messageList.scrollHeight;
			};
			pinBottom();
			window.requestAnimationFrame(pinBottom);
		} else {
			const maxScrollTop = Math.max(0, messageList.scrollHeight - messageList.clientHeight);
			messageList.scrollTop = Math.min(this.aiMessageListScrollTop, maxScrollTop);
		}

		this.aiForceScrollToBottomOnce = false;
		messageList.onscroll = () => {
			this.aiMessageListScrollTop = messageList.scrollTop;
			const distanceToBottom = messageList.scrollHeight - (messageList.scrollTop + messageList.clientHeight);
			this.aiMessageListStickToBottom = distanceToBottom <= 24;
		};
	}

	private formatSkillCatalog(skills: SkillDescriptor[]): string {
		if (skills.length === 0) {
			return [
				this.t("ai.skillCatalog.emptyLine1", "未找到可用 skill。"),
				this.t("ai.skillCatalog.emptyLine2", "请先在设置中配置 `Skill 外路径`，并确保路径下存在 `SKILL.md`。"),
				this.t("ai.skillCatalog.emptyLine3", "示例：/skill writing-agent 帮我优化当前文档结构。"),
			].join("\n");
		}

		const lines = [this.t("ai.skillCatalog.title", "可用 skill（前 40 项）：")];
		for (const skill of skills) {
			const desc = skill.description ? ` - ${skill.description}` : "";
			lines.push(`- /${skill.command}${desc}`);
		}
		lines.push("");
		lines.push(this.t("ai.skillCatalog.usageTitle", "调用方式："));
		lines.push(this.t("ai.skillCatalog.usageLine1", "- /skill <技能名> <任务>"));
		lines.push(this.t("ai.skillCatalog.usageLine2", "- /<技能名> <任务>"));
		return lines.join("\n");
	}

	private formatVisionCapability(capability: ModelCapabilityInfo): string {
		const modelText = capability.model || "N/A";
		if (capability.vision === "supported") {
			return this.plugin.t("vision.supported", { model: modelText });
		}
		if (capability.vision === "unsupported") {
			return this.plugin.t("vision.unsupported", { model: modelText });
		}
		return this.plugin.t("vision.unknown", { model: modelText });
	}

	private formatRuntimeProgressLine(event: RuntimeProgressEvent): string {
		const depthPrefix = event.depth > 0 ? `[D${event.depth}] ` : "";
		const stepPrefix = typeof event.step === "number" ? `[${event.step}] ` : "";
		const toolPrefix = event.tool ? `${event.tool}: ` : "";
		const iconMap: Record<RuntimeProgressEvent["phase"], string> = {
			start: "🚀",
			model_request: "🧠",
			model_response: "🧾",
			tool_call: "🛠️",
			tool_result: "📌",
			subagent_start: "🧩",
			subagent_result: "✅",
			fallback: "↩️",
			done: "🏁",
			error: "❌",
		};
		const icon = iconMap[event.phase] ?? "•";
		const text = event.message?.trim() || event.phase;
		return `${icon} ${depthPrefix}${stepPrefix}${toolPrefix}${text}`.trim();
	}

	private formatRuntimeTrace(traces: RuntimeToolTrace[]): string {
		if (traces.length === 0) {
			return "";
		}
		const lines = [this.t("ai.runtime.traceTitle", "工具执行记录：")];
		for (const trace of traces) {
			const status = trace.ok ? "✅" : "❌";
			const pathText = trace.targetPath ? ` @ ${trace.targetPath}` : "";
			const approval = trace.viaRule
				? this.t("ai.runtime.traceApproval.hitRule", "（命中规则）")
				: trace.persistedRule
					? this.t("ai.runtime.traceApproval.persisted", "（已持久化）")
					: "";
			const errorText = trace.error
				? this.t("ai.runtime.traceError", " | 错误: {error}", { error: trace.error })
				: "";
			lines.push(
				`${status} [${trace.step}] ${trace.tool}${pathText} - ${trace.summary} ${approval}${errorText}`.trim(),
			);
		}
		return lines.join("\n");
	}

	private async buildModelMessages(
		currentPrompt: string,
		conversation: ChatMessage[] = this.aiConversation,
		extraSystemContext = "",
	): Promise<ChatMessage[]> {
		const bundle = await this.plugin.vaultContextService.buildContextForPrompt(currentPrompt);
		this.vaultScanReport = bundle.report;
		this.vaultContextUpdatedAt = bundle.report.scannedAt;
		const contextSystemMessage: ChatMessage = {
			role: "system",
			content: bundle.contextText,
		};
		const actionProtocolMessage: ChatMessage = {
			role: "system",
			content: [
				this.t("ai.runtime.protocol.lead", "当你需要执行文件写入时，请在回复末尾追加一个代码块："),
				"```friday-actions",
				this.t(
					"ai.runtime.protocol.example",
					'{"assistant":"给用户的话","actions":[{"type":"create|update|delete","targetType":"markdown|canvas","path":"相对 Vault 路径","content":"文件内容"}]}',
				),
				"```",
				this.t("ai.runtime.protocol.rules", "规则："),
				this.t("ai.runtime.protocol.rule1", "1) delete 不需要 content。"),
				this.t("ai.runtime.protocol.rule2", "2) 只能输出相对 Vault 路径。"),
				this.t("ai.runtime.protocol.rule3", "3) 如果没有写入动作，不要输出 friday-actions 代码块。"),
			].join("\n"),
		};
		const extraContextMessage: ChatMessage | null = extraSystemContext.trim()
			? {
					role: "system",
					content: extraSystemContext.trim(),
				}
			: null;
		return [
			contextSystemMessage,
			actionProtocolMessage,
			...(extraContextMessage ? [extraContextMessage] : []),
			...conversation,
		];
	}

	private parseActionEnvelope(reply: string): ParsedActionEnvelope {
		const trimmed = reply.trim();
		const blockMatch = trimmed.match(/```friday-actions\s*([\s\S]*?)```/i);
		if (!blockMatch) {
			return { assistantText: trimmed, actions: [] };
		}

		const payload = blockMatch[1]?.trim() ?? "";
		const textWithoutBlock = trimmed.replace(blockMatch[0], "").trim();
		try {
			const parsed = JSON.parse(payload) as { assistant?: unknown; actions?: unknown };
			const assistantFromJson = typeof parsed.assistant === "string" ? parsed.assistant.trim() : "";
			const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
			const actions = this.normalizeAgentActions(rawActions);
			return {
				assistantText: textWithoutBlock || assistantFromJson,
				actions,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			return {
				assistantText: textWithoutBlock || trimmed,
				actions: [],
				parseError: message || this.t("ai.runtime.jsonParseFailed", "JSON 解析失败"),
			};
		}
	}

	private normalizeAgentActions(rawActions: unknown[]): AgentAction[] {
		const normalized: AgentAction[] = [];
		for (const candidate of rawActions) {
			if (!candidate || typeof candidate !== "object") {
				continue;
			}
			const data = candidate as Record<string, unknown>;
			const typeRaw = String(data.type ?? "").trim().toLowerCase();
			if (typeRaw !== "create" && typeRaw !== "update" && typeRaw !== "delete") {
				continue;
			}
			const pathRaw = String(data.path ?? "").trim();
			if (!pathRaw) {
				continue;
			}

			const targetType = this.resolveTargetType(pathRaw, data.targetType);
			const action: AgentAction = {
				type: typeRaw,
				targetType,
				path: normalizePath(pathRaw),
			};

			if (typeRaw !== "delete") {
				if (typeof data.content !== "string") {
					continue;
				}
				action.content = data.content;
			}
			normalized.push(action);
		}
		return normalized;
	}

	private resolveTargetType(pathValue: string, rawTargetType: unknown): AgentActionTargetType {
		if (rawTargetType === "canvas" || rawTargetType === "markdown") {
			return rawTargetType;
		}
		return normalizePath(pathValue).toLowerCase().endsWith(".canvas") ? "canvas" : "markdown";
	}

	private async handleAgentActions(actions: AgentAction[], agentId: string): Promise<string> {
		if (actions.length === 0) {
			return "";
		}

		const previews = actions.map((action) => this.plugin.agentActionService.preview(action));
		if (this.plugin.settings.agentRuntime.requireWriteConfirmation) {
			const list = previews.map((item, index) => `${index + 1}. ${item.summary}`).join("\n");
			const accepted = window.confirm(
				this.t("ai.action.confirmExecute", "F.R.I.D.A.Y 准备执行以下 {count} 个文件操作：\n\n{list}\n\n是否继续？", {
					count: actions.length,
					list,
				}),
			);
			if (!accepted) {
				return this.t("ai.action.cancelled", "已取消文件操作执行。");
			}
		}

		const lines: string[] = [];
		for (let index = 0; index < actions.length; index += 1) {
			const action = actions[index]!;
			const preview = previews[index]!;
			try {
				await this.plugin.agentActionService.execute(action, agentId);
				lines.push(`✅ ${preview.summary}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				lines.push(
					`❌ ${preview.summary}：${message || this.t("common.unknownError", "未知错误")}`,
				);
				break;
			}
		}

		await this.safeRefreshBoard();
		return [this.t("ai.action.resultTitle", "执行结果："), ...lines].join("\n");
	}

	private t(
		key: string,
		fallback: string,
		params?: Record<string, string | number | boolean | null | undefined>,
	): string {
		const translated = this.plugin.t(key, params);
		if (translated !== key) {
			return translated;
		}
		if (!params) {
			return fallback;
		}
		return fallback.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_full, name: string) => {
			const value = params[name];
			return value == null ? "" : String(value);
		});
	}

	private addPageButton(parent: HTMLElement, label: string, action: () => Promise<void>): void {
		const button = parent.createEl("button", { text: label });
		button.onclick = async () => {
			try {
				await action();
			} catch (error) {
				console.error("[Friday] Action failed:", label, error);
				new Notice(
					this.t("common.actionFailed", "{label} 失败：{error}", {
						label,
						error: String(error),
					}),
					6000,
				);
			}
		};
	}

	private renderColumn(parent: HTMLElement, column: BoardColumn, title: string, tasks: TaskData[]): void {
		const columnEl = parent.createDiv({ cls: `friday-kanban-column friday-column-${column}` });
		const header = columnEl.createDiv({ cls: `friday-kanban-column-header ${column}` });
		header.setText(`${title} (${tasks.length})`);

		columnEl.ondragover = (event) => {
			event.preventDefault();
		};
		columnEl.ondrop = (event) => {
			event.preventDefault();
			const taskId = event.dataTransfer?.getData("text/task-id");
			if (!taskId) return;
			void this.handleTaskDrop(taskId, column);
		};

		const body = columnEl.createDiv({ cls: "friday-kanban-column-body" });
		for (const task of tasks) {
			this.renderTaskCard(body, task);
		}
	}

	private renderTaskCard(parent: HTMLElement, task: TaskData): void {
		const card = parent.createDiv({ cls: "friday-task-card" });
		if (isOverdue(task.dueDate)) {
			card.addClass("overdue");
		}
		card.draggable = true;
		card.ondragstart = (event) => {
			event.dataTransfer?.setData("text/task-id", task.taskId);
		};
		card.oncontextmenu = (event) => {
			event.preventDefault();
			this.openContextMenu(event, task);
		};

		const titleButton = card.createEl("button", {
			text: task.title,
			cls: "task-title",
		});
		titleButton.onclick = () => {
			void this.openTaskFile(task);
		};

		const meta = card.createDiv({ cls: "task-meta" });
		meta.createSpan({ text: this.buildDueLabel(task.dueDate) });
		meta.createSpan({ text: ` | ${task.projectId}` });
		meta.createSpan({ text: ` | ${this.getStatusLabel(task.status)}` });
	}

	private buildDueLabel(dueDate: string): string {
		if (!dueDate) return this.t("task.due.none", "无截止日期");
		if (isOverdue(dueDate)) return this.t("task.due.overdue", "已逾期：{date}", { date: dueDate });
		if (isDueWithinDays(dueDate, 2)) return this.t("task.due.soon", "即将到期：{date}", { date: dueDate });
		return this.t("task.due.on", "截止：{date}", { date: dueDate });
	}

	private getStatusLabel(status: TaskData["status"]): string {
		const labels: Record<TaskData["status"], string> = {
			todo: this.t("task.status.todo", "待办"),
			in_progress: this.t("task.status.inProgress", "进行中"),
			completed: this.t("task.status.completed", "已完成"),
			blocked: this.t("task.status.blocked", "阻塞"),
		};
		return labels[status];
	}

	private openContextMenu(event: MouseEvent, task: TaskData): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle(this.t("task.menu.openFile", "打开任务文件")).onClick(() => {
				void this.openTaskFile(task);
			}),
		);
		menu.addItem((item) =>
			item.setTitle(this.t("task.menu.markBlocked", "标记阻塞")).onClick(async () => {
				await this.plugin.dataService.updateTaskFrontmatter(task.taskId, { status: "blocked" });
				await this.generateDailyNote();
				await this.safeRefreshBoard();
			}),
		);
		menu.addItem((item) =>
			item.setTitle(this.t("task.menu.delete", "删除任务")).onClick(async () => {
				const accepted = window.confirm(
					this.t("task.confirm.delete", "确认删除任务「{title}」？", { title: task.title }),
				);
				if (!accepted) return;
				await this.plugin.dataService.deleteTask(task.taskId);
				await this.generateDailyNote();
				await this.safeRefreshBoard();
			}),
		);
		menu.showAtMouseEvent(event);
	}

	private async handleTaskDrop(taskId: string, column: BoardColumn): Promise<void> {
		const task = await this.plugin.dataService.getTask(taskId);
		if (!task) {
			new Notice(this.t("task.notice.notFound", "未找到任务：{taskId}", { taskId }), 4000);
			return;
		}

		if (column === "completed") {
			await this.plugin.dataService.updateTaskFrontmatter(taskId, {
				status: "completed",
				completedAt: new Date().toISOString(),
			});
		} else {
			await this.plugin.dataService.updateTaskFrontmatter(taskId, {
				priority: column,
				status: task.status === "completed" ? "todo" : task.status,
				completedAt: task.status === "completed" ? "" : task.completedAt,
			});
		}

		await this.generateDailyNote();
		await this.safeRefreshBoard();
	}

	private async openTaskFile(task: TaskData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) {
			new Notice(this.t("task.notice.openFailed", "无法打开任务文件：{path}", { path: task.filePath }), 5000);
			return;
		}
		await this.app.workspace.getLeaf(true).openFile(file);
	}

	private async openCreateTaskModal(): Promise<void> {
		const defaultProject = this.resolveDefaultProject();
		const projects = this.getProjectOptions();
		const projectMembers = await this.getProjectMembersMap(projects.map((item) => item.value));

		new CreateTaskModal(this.app, {
			projects,
			projectMembers,
			defaultProject,
			defaultAssignee: this.plugin.getPrimaryUserId(),
			t: this.plugin.t.bind(this.plugin),
			onSubmit: async (payload: TaskCreateInput) => {
				await this.plugin.dataService.createTask(payload.projectId, payload);
				new Notice(this.plugin.t("notice.taskCreated", { title: payload.title }), 3000);
				if (this.plugin.settings.dailyNote.autoGenerate) {
					await this.generateDailyNote();
				}
				await this.safeRefreshBoard();
			},
		}).open();
	}

	private resolveDefaultProject(): string {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return PERSONAL_SLUG;
		return this.plugin.dataService.getProjectSlugFromPath(activeFile.path) ?? PERSONAL_SLUG;
	}

	private getProjectOptions(): Array<{ value: string; label: string }> {
		const options: Array<{ value: string; label: string }> = [
			{ value: PERSONAL_SLUG, label: this.plugin.t("common.personal") },
		];
		const seen = new Set<string>([PERSONAL_SLUG]);
		for (const project of this.plugin.settings.projects) {
			if (!project.slug || seen.has(project.slug)) continue;
			seen.add(project.slug);
			options.push({ value: project.slug, label: project.slug });
		}
		return options;
	}

	private async getProjectMembersMap(
		projectSlugs: string[],
	): Promise<Record<string, Array<{ userId: string; role: string }>>> {
		const result: Record<string, Array<{ userId: string; role: string }>> = {};
		const currentUser = this.plugin.getPrimaryUserId().trim();
		for (const slug of projectSlugs) {
			if (slug === PERSONAL_SLUG) {
				result[slug] = currentUser ? [{ userId: currentUser, role: "admin" }] : [];
				continue;
			}
			try {
				const members = await this.plugin.dataService.getProjectMembers(slug);
				result[slug] = members.map((item) => ({ userId: item.userId, role: item.role }));
			} catch {
				result[slug] = [];
			}
		}
		return result;
	}

	private async generateDailyNote(): Promise<void> {
		await this.plugin.dataService.generateDailyNote(
			this.plugin.getPrimaryUserId(),
			this.currentDate || formatDate(),
			this.plugin.settings.dailyNote.templatePath,
			this.plugin.getDetectedUserId(),
		);
	}

	private async openProjectEditor(initial?: ProjectEntry): Promise<void> {
		const existingSlugs = new Set(this.plugin.settings.projects.map((project) => project.slug));
		new RegisterProjectModal(this.app, {
			initial,
			existingSlugs,
			fridayRoot: this.plugin.dataService.getFridayRoot(),
			currentUserId: this.plugin.getPrimaryUserId(),
			syncService: this.plugin.syncService,
			t: this.plugin.t.bind(this.plugin),
			onSubmit: async (entry) => {
				await this.plugin.upsertProject(entry);
				this.selectedProjectSlug = entry.slug;
				new Notice(
					initial
						? this.t("projects.notice.updated", "项目已更新：{slug}", { slug: entry.slug })
						: this.t("projects.notice.created", "项目已创建：{slug}", { slug: entry.slug }),
					3000,
				);
				await this.safeRefreshBoard();
			},
		}).open();
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

		const map = new Map<string, typeof result>();
		map.set(project.slug, result);
		new SyncStatusModal(this.app, {
			projects: [project],
			syncService: this.plugin.syncService,
			results: map,
			t: this.plugin.t.bind(this.plugin),
		}).open();
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

		new SyncStatusModal(this.app, {
			projects,
			syncService: this.plugin.syncService,
			results,
			t: this.plugin.t.bind(this.plugin),
		}).open();
	}
}
