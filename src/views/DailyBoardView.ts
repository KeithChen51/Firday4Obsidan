import {
	ItemView,
	MarkdownRenderer,
	Notice,
	WorkspaceLeaf,
} from "obsidian";
import { ProjectMembersModal } from "../modals/ProjectMembersModal";
import { RegisterProjectModal } from "../modals/RegisterProjectModal";
import { SyncStatusModal } from "../modals/SyncStatusModal";
import { ConversationSession } from "../services/ConversationService";
import {
	RuntimeProgressEvent,
	RuntimeTurnResult,
	RuntimeWikiCompileSummary,
} from "../services/AgentRuntimeService";
import { ChatMessage } from "../services/AIService";
import type { FridayPluginApi } from "../types/plugin";
import { ProjectEntry, SyncResult } from "../types/project";

export const VIEW_TYPE_DAILY_BOARD = "friday-daily-board";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

export class DailyBoardView extends ItemView {
	private refreshTimer: number | null = null;

	private aiConversation: ChatMessage[] = [];
	private aiSessions: ConversationSession[] = [];
	private aiSessionId = "";
	private aiDraft = "";
	private aiBusy = false;
	private aiLastError = "";
	private aiStreamingPreview = "";
	private aiMessageListScrollTop = 0;
	private aiMessageListStickToBottom = true;
	private aiForceScrollToBottomOnce = false;
	private aiRuntimeLastRenderAt = 0;
	private aiRuntimeProgressLines: string[] = [];
	private aiSendAbortController: AbortController | null = null;

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
		const contentEl = shell.createDiv({ cls: "friday-page-content" });

		this.renderShellHeader(shellHeaderEl);
		if (this.plugin.settings.projects.length === 0) {
			this.renderProjectsPage(contentEl);
			return;
		}
		this.renderAiPage(contentEl);
	}

	private renderShellHeader(containerEl: HTMLElement): void {
		const projects = this.plugin.settings.projects;
		const activeProject = this.getActiveProjectEntry();

		const projectSection = containerEl.createDiv({ cls: "friday-shell-project" });
		projectSection.createSpan({
			cls: "friday-shell-project-label",
			text: this.t("shell.project.label", "当前项目"),
		});

		if (projects.length === 0) {
			projectSection.createSpan({
				cls: "friday-shell-project-empty",
				text: this.t("shell.project.empty", "暂未创建项目"),
			});
		} else {
			const selectEl = projectSection.createEl("select", { cls: "friday-shell-project-select" });
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

		const actionSection = containerEl.createDiv({ cls: "friday-shell-actions" });
		this.addPageButton(actionSection, this.t("projects.button.new", "New Project"), async () => {
			await this.openProjectEditor();
		});
		if (activeProject) {
			this.addPageButton(actionSection, this.t("projects.button.manage", "Manage"), async () => {
				await this.openProjectEditor(activeProject);
			});
		}
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
		const projects = this.plugin.settings.projects;
		const header = containerEl.createDiv({ cls: "friday-page-header" });
		header.createEl("h3", { text: this.plugin.t("projects.header") });
		const actionBar = header.createDiv({ cls: "friday-page-actions" });
		this.addPageButton(actionBar, this.t("projects.button.new", "New Project"), async () => {
			await this.openProjectEditor();
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
				await this.openProjectEditor();
			});
			return;
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
			await this.openProjectEditor(project);
		});
		this.addPageButton(actionsEl, this.t("projects.button.members", "Members"), async () => {
			new ProjectMembersModal(this.app, {
				projectSlug: project.slug,
				dataService: this.plugin.dataService,
				t: this.plugin.t.bind(this.plugin),
				onSaved: async () => {
					await this.safeRenderBoard();
				},
			}).open();
		});
		this.addPageButton(actionsEl, this.t("projects.button.sync", "Sync"), async () => {
			await this.syncSingleProject(project);
		});
		this.addPageButton(actionsEl, this.t("projects.button.remove", "Remove"), async () => {
			if (!window.confirm(this.t("projects.confirm.remove", "Remove project \"{slug}\"?", { slug: project.slug }))) {
				return;
			}
			await this.plugin.removeProject(project.slug);
			await this.safeRenderBoard();
		});
	}

	private renderAiPage(containerEl: HTMLElement): void {
		const llmConfigured = this.plugin.aiService.isConfigured();
		const activeAgent = this.plugin.getActiveAgent();
		const modelName = activeAgent?.model?.trim() || this.plugin.settings.llm.model?.trim() || "";
		const modelCapability = this.plugin.aiService.getModelCapability(modelName || undefined);

		const layoutEl = containerEl.createDiv({ cls: "friday-ai-layout" });
		const sessionNavEl = layoutEl.createDiv({ cls: "friday-ai-session-nav" });
		this.renderAiSessionNav(sessionNavEl);

		const mainEl = layoutEl.createDiv({ cls: "friday-ai-main" });
		const header = mainEl.createDiv({ cls: "friday-page-header friday-ai-page-header" });
		const heading = header.createDiv({ cls: "friday-ai-heading" });
		heading.createEl("h3", { text: this.plugin.t("ai.title") });
		heading.createEl("p", {
			cls: "friday-ai-subtitle",
			text: this.plugin.t("ai.subtitle"),
		});

		const actionsEl = header.createDiv({ cls: "friday-page-actions friday-ai-actions" });
		const statusEl = actionsEl.createDiv({
			cls: `friday-ai-conn-status ${llmConfigured ? "is-online" : "is-offline"}`,
		});
		statusEl.createSpan({ cls: "friday-ai-conn-dot" });
		statusEl.createSpan({
			text: llmConfigured ? this.plugin.t("ai.status.online") : this.plugin.t("ai.status.offline"),
		});

		const agentSelectWrap = actionsEl.createDiv({ cls: "friday-ai-agent-select-wrap" });
		const agentSelectEl = agentSelectWrap.createEl("select", { cls: "friday-ai-agent-select" });
		for (const agent of this.plugin.settings.agents) {
			const option = agentSelectEl.createEl("option", { text: agent.name });
			option.value = agent.id;
			option.selected = agent.id === this.plugin.settings.activeAgentId;
		}
		agentSelectEl.disabled = this.aiBusy;
		agentSelectEl.onchange = () => {
			void this.switchAgent(agentSelectEl.value);
		};

		this.addPageButton(actionsEl, this.plugin.t("ai.button.clear"), async () => {
			this.startNewAiSession();
		});
		this.addPageButton(actionsEl, this.t("ai.button.compileWiki", "编译Wiki"), async () => {
			await this.compileWikiByButton();
		});
		this.addPageButton(actionsEl, this.plugin.t("ai.button.openSettings"), async () => {
			this.plugin.openSettingsTab();
		});

		const infoEl = mainEl.createDiv({ cls: "friday-ai-agent-info" });
		infoEl.createDiv({
			text: this.plugin.t("ai.info.currentAgent", { name: activeAgent?.name ?? "N/A" }),
		});
		infoEl.createDiv({
			text: this.plugin.t("ai.info.vision", {
				vision: this.resolveVisionLabel(modelCapability),
				reason: modelCapability.reason,
			}),
		});
		infoEl.createDiv({
			text: this.plugin.t("ai.info.modelSuffix", {
				model: modelName || this.t("common.modelNotSet2", "Model not set"),
			}),
		});

		const panelEl = mainEl.createDiv({ cls: "friday-ai-chat-panel friday-ai-chat-shell" });
		const messageListEl = panelEl.createDiv({ cls: "friday-ai-message-list" });

		if (this.aiConversation.length === 0 && !this.aiStreamingPreview) {
			const emptyEl = messageListEl.createDiv({ cls: "friday-ai-empty" });
			emptyEl.createEl("h4", { text: this.plugin.t("ai.empty.title") });
			emptyEl.createEl("p", { text: this.plugin.t("ai.empty.desc") });
		}

		for (const message of this.aiConversation) {
			this.renderAiMessage(messageListEl, message);
		}
		if (this.aiStreamingPreview) {
			this.renderAiMessage(
				messageListEl,
				{
					role: "assistant",
					content: this.aiStreamingPreview,
				},
				true,
			);
		}

		if (this.aiLastError) {
			panelEl.createDiv({
				cls: "friday-ai-error",
				text: this.aiLastError,
			});
		}

		const composerWrap = panelEl.createDiv({ cls: "friday-ai-composer-wrap" });
		const composerEl = composerWrap.createDiv({ cls: "friday-ai-composer" });
		const inputEl = composerEl.createEl("textarea", {
			cls: "friday-ai-input",
		});
		inputEl.placeholder = this.plugin.t("ai.input.placeholder");
		inputEl.value = this.aiDraft;
		inputEl.disabled = this.aiBusy;
		inputEl.oninput = () => {
			this.aiDraft = inputEl.value;
		};
		inputEl.onkeydown = (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.submitAiPrompt();
			}
		};

		const sendButton = composerEl.createEl("button", {
			text: this.aiBusy ? this.plugin.t("ai.sending") : this.plugin.t("ai.send"),
		});
		sendButton.disabled = this.aiBusy;
		sendButton.onclick = () => {
			void this.submitAiPrompt();
		};

		this.restoreAiMessageListScrollState(messageListEl);
	}

	private renderAiSessionNav(containerEl: HTMLElement): void {
		const headerEl = containerEl.createDiv({ cls: "friday-ai-session-nav-header" });
		headerEl.createEl("h4", {
			text: this.t("ai.sessions.title", "对话记录"),
		});
		const newButton = headerEl.createEl("button", {
			cls: "friday-ai-session-new",
			text: this.t("ai.sessions.new", "新建"),
		});
		newButton.disabled = this.aiBusy;
		newButton.onclick = () => {
			this.startNewAiSession();
		};

		const listEl = containerEl.createDiv({ cls: "friday-ai-session-list" });
		if (this.aiSessions.length === 0) {
			const emptyEl = listEl.createDiv({ cls: "friday-ai-session-empty" });
			emptyEl.setText(this.t("ai.sessions.empty", "暂无对话记录"));
			return;
		}

		for (const session of this.aiSessions) {
			const itemEl = listEl.createEl("button", { cls: "friday-ai-session-item" });
			if (session.sessionId === this.aiSessionId) {
				itemEl.addClass("is-active");
			}
			itemEl.createDiv({
				cls: "friday-ai-session-item-title",
				text: this.buildSessionTitle(session),
			});
			itemEl.createDiv({
				cls: "friday-ai-session-item-meta",
				text: this.formatSessionUpdatedAt(session.updatedAt),
			});
			itemEl.onclick = () => {
				void this.switchAiSession(session.sessionId);
			};
		}
	}

	private startNewAiSession(): void {
		this.aiConversation = [];
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiSessionId = this.plugin.conversationService.createSessionId();
		this.plugin.toolApprovalService.clearSessionRules();
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
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();
	}

	private buildSessionTitle(session: ConversationSession): string {
		const firstUserMessage = session.messages.find(
			(message) => message.role === "user" && message.content.trim().length > 0,
		);
		const raw = firstUserMessage?.content?.replace(/\s+/g, " ").trim()
			|| this.t("ai.sessions.untitled", "未命名对话");
		return this.truncateText(raw, 72);
	}

	private formatSessionUpdatedAt(updatedAt: string): string {
		const parsed = new Date(updatedAt);
		if (Number.isNaN(parsed.getTime())) {
			return updatedAt || this.t("common.unknownTime", "未知时间");
		}
		return parsed.toLocaleString();
	}

	private renderAiMessage(containerEl: HTMLElement, message: ChatMessage, isStreaming = false): void {
		const isUser = message.role === "user";
		const rowEl = containerEl.createDiv({
			cls: `friday-ai-message ${isUser ? "is-user" : "is-assistant"}`,
		});
		rowEl.createDiv({
			cls: "friday-ai-message-role",
			text: isUser ? this.plugin.t("ai.role.user") : this.plugin.t("ai.role.assistant"),
		});
		const contentEl = rowEl.createDiv({
			cls: `friday-ai-message-content${isStreaming ? " is-streaming" : ""}`,
		});
		void MarkdownRenderer.renderMarkdown(message.content, contentEl, "", this);
	}

	private async submitAiPrompt(): Promise<void> {
		const prompt = this.aiDraft.trim();
		if (!prompt || this.aiBusy) {
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
		this.aiConversation.push({ role: "user", content: prompt });
		this.aiDraft = "";
		this.aiLastError = "";
		this.aiStreamingPreview = "";
		this.aiRuntimeProgressLines = [];
		this.aiBusy = true;
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			const modelOverride = activeAgent.model?.trim() || undefined;
			const currentFilePath = this.app.workspace.getActiveFile()?.path;
			let assistantText = "";
			let shouldStreamFinalText = false;

			if (this.isCompileWikiIntent(prompt)) {
				const compileSummary = await this.compileWikiWithStatus();
				assistantText = this.formatWikiCompileResult(compileSummary, true);
				shouldStreamFinalText = true;
			} else if (this.plugin.settings.agentRuntime.toolRuntimeEnabled) {
				const runtimeResult = await this.plugin.agentRuntimeService.runTurn({
					agentId: activeAgent.id,
					conversation: history,
					userPrompt: prompt,
					modelOverride,
					currentFilePath,
					onProgress: (event) => {
						this.handleRuntimeProgress(event);
					},
				});
				assistantText = this.buildRuntimeReply(runtimeResult);
				shouldStreamFinalText = true;
			} else {
				const modelMessages: ChatMessage[] = [
					...history,
					{
						role: "user",
						content: prompt,
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

			const normalizedAssistantText = assistantText.trim() || this.t("ai.runtime.emptyResponse", "(No valid model response)");
			if (shouldStreamFinalText && this.plugin.settings.llm.enableStreaming) {
				await this.streamAssistantText(normalizedAssistantText);
			}

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
			this.aiRuntimeProgressLines = [];
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
		this.aiRuntimeProgressLines = [];
		this.aiForceScrollToBottomOnce = true;
		this.renderBoard();

		try {
			const summary = await this.compileWikiWithStatus();
			const reply = this.formatWikiCompileResult(summary, false);
			if (this.plugin.settings.llm.enableStreaming) {
				await this.streamAssistantText(reply);
			}
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
			this.aiRuntimeProgressLines = [];
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
			message: this.t("ai.runtime.progress.compileStart", "F.R.I.D.A.Y 正在编译 Wiki…（{step}）", { step: "1" }),
		});
		const summary = await this.plugin.compileWikiForActiveProject();
		this.handleRuntimeProgress({
			phase: "tool_result",
			depth: 0,
			step: 1,
			tool: "compile_wiki",
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

	private async streamAssistantText(text: string): Promise<void> {
		if (!text) {
			return;
		}
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
		const line = this.formatRuntimeProgressLine(event);
		if (!line) {
			return;
		}
		const lastLine = this.aiRuntimeProgressLines[this.aiRuntimeProgressLines.length - 1];
		if (lastLine !== line) {
			this.aiRuntimeProgressLines.push(line);
			if (this.aiRuntimeProgressLines.length > 20) {
				this.aiRuntimeProgressLines = this.aiRuntimeProgressLines.slice(-20);
			}
		}
		this.aiStreamingPreview = [
			this.t("ai.runtime.progress.header", "F.R.I.D.A.Y 正在执行中…"),
			"",
			...this.aiRuntimeProgressLines.map((item) => `- ${item}`),
		].join("\n");

		const forceRender = event.phase === "tool_call" || event.phase === "tool_result" || event.phase === "error";
		const now = Date.now();
		if (forceRender || now - this.aiRuntimeLastRenderAt >= 120) {
			this.aiRuntimeLastRenderAt = now;
			this.aiForceScrollToBottomOnce = true;
			this.renderBoard();
		}
	}

	private formatRuntimeProgressLine(event: RuntimeProgressEvent): string {
		const step = event.step ? `第${event.step}步 · ` : "";
		switch (event.phase) {
			case "start":
				return this.t("ai.runtime.progress.start", "F.R.I.D.A.Y 正在准备上下文…");
			case "model_request":
				return this.t("ai.runtime.progress.modelRequest", "F.R.I.D.A.Y 正在思考…（{step}）", {
					step: step,
				});
			case "model_response":
				return this.t("ai.runtime.progress.modelResponse", "F.R.I.D.A.Y 完成一轮思考（{step}）", {
					step: step,
				});
			case "tool_approval":
				return this.t("ai.runtime.progress.toolApproval", "F.R.I.D.A.Y {message}", {
					message: event.message || "正在申请工具权限",
				});
			case "tool_call":
				if (event.tool === "compile_wiki") {
					return this.t("ai.runtime.progress.compileStart", "F.R.I.D.A.Y 正在编译 Wiki…（{step}）", { step: step });
				}
				return this.t("ai.runtime.progress.toolCall", "F.R.I.D.A.Y 调用了工具：{tool}（{step}）", {
					step: step,
					tool: event.tool || "unknown",
				});
			case "tool_result":
				if (event.tool === "compile_wiki") {
					return this.t("ai.runtime.progress.compileDone", "F.R.I.D.A.Y 已完成 Wiki 编译（{step}）", { step: step });
				}
				return this.t("ai.runtime.progress.toolResult", "F.R.I.D.A.Y 工具执行完成：{tool}（{step}）", {
					step: step,
					tool: event.tool || "unknown",
				});
			case "subagent_start":
				return this.t("ai.runtime.progress.subagentStart", "F.R.I.D.A.Y 正在调度子代理…（{step}）", { step: step });
			case "subagent_result":
				return this.t("ai.runtime.progress.subagentDone", "F.R.I.D.A.Y 子代理执行完成（{step}）", { step: step });
			case "fallback":
				return this.t("ai.runtime.progress.fallback", "F.R.I.D.A.Y 已切换到兼容模式继续执行");
			case "done":
				return this.t("ai.runtime.progress.done", "F.R.I.D.A.Y 正在整理最终回复…");
			case "error":
				return this.t("ai.runtime.progress.error", "F.R.I.D.A.Y 运行失败：{message}", {
					message: event.message,
				});
			default:
				return event.message || "";
		}
	}

	private buildRuntimeReply(result: RuntimeTurnResult): string {
		const parts: string[] = [];
		const normalizedAssistantText = this.normalizeRuntimeAssistantText(result.assistantText);
		if (normalizedAssistantText.trim()) {
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

	private normalizeRuntimeAssistantText(raw: string): string {
		const trimmed = raw.trim();
		if (!trimmed) {
			return "";
		}
		const fencedMatch = trimmed.match(/```(?:json|friday-runtime)?\s*([\s\S]*?)```/i);
		if (fencedMatch?.[1]) {
			return this.normalizeRuntimeAssistantText(fencedMatch[1]);
		}
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start < 0 || end <= start) {
			return raw;
		}
		const objectText = trimmed.slice(start, end + 1);
		try {
			const parsed = JSON.parse(objectText) as { type?: string; assistant?: unknown };
			if (typeof parsed.assistant === "string" && parsed.assistant.trim()) {
				return parsed.assistant.trim();
			}
			if (parsed.type === "tool_call") {
				return this.t("ai.runtime.toolCallFallback", "F.R.I.D.A.Y 正在继续调用工具。");
			}
		} catch {
			// Keep original text when payload is not a valid JSON envelope.
		}
		return raw;
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

	private async openProjectEditor(initial?: ProjectEntry): Promise<void> {
		const existingSlugs = new Set(this.plugin.settings.projects.map((project) => project.slug));
		new RegisterProjectModal(this.app, {
			initial,
			existingSlugs,
			projectGroups: this.plugin.settings.projectGroups,
			fridayRoot: this.plugin.dataService.getFridayRoot(),
			currentUserId: this.plugin.getPrimaryUserId(),
			syncService: this.plugin.syncService,
			t: this.plugin.t.bind(this.plugin),
			onSubmit: async (entry) => {
				await this.plugin.upsertProject(entry);
				await this.plugin.setActiveProject(entry.slug);
				await this.ensureAiSessionLoaded();
				new Notice(
					initial
						? this.t("projects.notice.updated", "Project updated: {slug}", { slug: entry.slug })
						: this.t("projects.notice.created", "Project created: {slug}", { slug: entry.slug }),
					3000,
				);
				await this.safeRenderBoard();
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

		const one = new Map<string, SyncResult>();
		one.set(project.slug, result);
		new SyncStatusModal(this.app, {
			projects: [project],
			syncService: this.plugin.syncService,
			results: one,
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


