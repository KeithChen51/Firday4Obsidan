import type { AgentTrajectoryAction, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";
import {
	buildAgentProcessPanelViewModel,
	type AgentComposerTaskBarTaskView,
	type AgentComposerTaskBarView,
	type AgentProcessActionView,
	type AgentProcessArtifactView,
	type AgentProcessDiffSummaryView,
	type AgentProcessTimelineActionView,
	type AgentProcessTimelineItemView,
	type AgentProcessTimelineView,
} from "./agentProcessPanelViewModel";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;
type AgentProcessChevronIcon = "chevron-right" | "chevron-up";
type AgentProcessStatusIcon = "check" | "loader" | "circle" | "minus" | "pause" | "x";
type RenderAgentProcessIcon = (containerEl: HTMLElement, icon: AgentProcessChevronIcon | AgentProcessStatusIcon) => void;

export interface RenderAgentTrajectoryCardOptions {
	containerEl: HTMLElement;
	snapshot: AgentTrajectorySnapshot | null;
	variant: "live" | "completed";
	expanded: boolean;
	onToggle: () => void;
	onAction?: (action: AgentTrajectoryAction) => void;
	translate: (key: string, fallback: string, params?: TranslateParams) => string;
	renderAssistantAvatar: (containerEl: HTMLElement) => void;
	renderIcon?: RenderAgentProcessIcon;
}

export interface RenderAgentAnswerFlowOptions {
	containerEl: HTMLElement;
	snapshot?: AgentTrajectorySnapshot | null;
	isStreaming?: boolean;
	expanded?: boolean;
	onToggle?: () => void;
	onAction?: (action: AgentTrajectoryAction) => void;
	renderContent: (containerEl: HTMLElement) => void;
	renderAssistantAvatar: (containerEl: HTMLElement) => void;
	renderIcon?: RenderAgentProcessIcon;
	onOpenArtifact?: (path: string) => void;
}

export interface RenderComposerTaskBarOptions {
	containerEl: HTMLElement;
	taskBar: AgentComposerTaskBarView | null;
	expanded: boolean;
	onToggle: () => void;
	renderIcon?: RenderAgentProcessIcon;
}

export function renderComposerTaskBar(options: RenderComposerTaskBarOptions): void {
	const { containerEl, taskBar, expanded, onToggle, renderIcon } = options;
	if (!taskBar) {
		return;
	}
	const barEl = containerEl.createDiv({
		cls: `friday-composer-task-bar is-${expanded ? "expanded" : "collapsed"}`,
		attr: {
			"data-expanded": expanded ? "true" : "false",
		},
	});
	const buttonEl = barEl.createEl("button", {
		cls: "friday-composer-task-bar-summary",
		attr: {
			type: "button",
			"aria-expanded": expanded ? "true" : "false",
		},
	});
	buttonEl.onclick = () => onToggle();
	buttonEl.createSpan({ cls: "friday-composer-task-bar-status", text: taskBar.collapsed.statusLabel });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-step", text: taskBar.collapsed.stepLabel });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-title", text: taskBar.collapsed.taskTitle });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-elapsed", text: taskBar.collapsed.elapsed });
	renderChevronIcon(buttonEl, expanded ? "chevron-up" : "chevron-right", renderIcon);
	if (taskBar.actionSlot) {
		barEl.createDiv({ cls: "friday-composer-task-bar-action-slot" });
	}
	if (!expanded) {
		return;
	}
	const listEl = barEl.createDiv({ cls: "friday-composer-task-bar-list" });
	const totalTasks = taskBar.expandedTasks.length;
	for (const task of taskBar.expandedTasks) {
		const itemEl = listEl.createDiv({
			cls: `friday-composer-task-bar-item is-${task.status}`,
			attr: {
				"data-task-id": task.id,
				"data-status": task.status,
			},
		});
		const markerEl = itemEl.createSpan({
			cls: `friday-composer-task-bar-item-marker is-${task.status}`,
			attr: {
				"aria-hidden": "true",
			},
		});
		renderComposerTaskStatusIcon(markerEl, task.status, renderIcon);
		itemEl.createSpan({ cls: "friday-composer-task-bar-item-progress", text: `${task.index}/${totalTasks}` });
		itemEl.createSpan({ cls: "friday-composer-task-bar-item-title", text: task.title });
		itemEl.createSpan({
			cls: `friday-composer-task-bar-item-status is-${task.status}`,
			text: formatComposerTaskStatus(task.status),
		});
	}
}

function renderComposerTaskStatusIcon(
	containerEl: HTMLElement,
	status: AgentComposerTaskBarTaskView["status"],
	renderIcon?: RenderAgentProcessIcon,
): void {
	const icon = getComposerTaskStatusIcon(status);
	if (renderIcon) {
		renderIcon(containerEl, icon);
		return;
	}
	containerEl.createSpan({ cls: "friday-composer-task-bar-item-marker-fallback", text: getComposerTaskStatusFallback(status) });
}

function getComposerTaskStatusIcon(status: AgentComposerTaskBarTaskView["status"]): AgentProcessStatusIcon {
	switch (status) {
		case "completed":
			return "check";
		case "in_progress":
			return "loader";
		case "pending":
			return "circle";
		case "skipped":
			return "minus";
		case "blocked":
			return "pause";
		case "failed":
			return "x";
	}
	return assertUnhandledComposerTaskStatus(status);
}

function getComposerTaskStatusFallback(status: AgentComposerTaskBarTaskView["status"]): string {
	switch (status) {
		case "completed":
			return "OK";
		case "in_progress":
			return "RUN";
		case "pending":
			return "TODO";
		case "skipped":
			return "SKIP";
		case "blocked":
			return "BLOCK";
		case "failed":
			return "ERR";
	}
	return assertUnhandledComposerTaskStatus(status);
}

function formatComposerTaskStatus(status: AgentComposerTaskBarTaskView["status"]): string {
	switch (status) {
		case "completed":
			return "已完成";
		case "in_progress":
			return "执行中";
		case "pending":
			return "未开始";
		case "skipped":
			return "已跳过";
		case "blocked":
			return "受阻";
		case "failed":
			return "未完成/失败";
	}
	return assertUnhandledComposerTaskStatus(status);
}

function assertUnhandledComposerTaskStatus(status: never): never {
	throw new Error(`Unhandled composer task status: ${status}`);
}

export function renderAgentTrajectoryCard(options: RenderAgentTrajectoryCardOptions): void {
	const { containerEl, snapshot, variant, expanded, onToggle, onAction, renderAssistantAvatar, renderIcon } = options;
	if (!snapshot) {
		return;
	}

	const view = buildAgentProcessPanelViewModel(snapshot);
	if (!view.shouldRenderProcessPanel || !view.timeline) {
		return;
	}
	const flowEl = renderAssistantFlowShell(containerEl, variant);
	renderTimelineProcess(flowEl, view.timeline, {
		variant,
		expanded,
		onToggle,
		onAction,
		renderAssistantAvatar,
		renderIcon,
	});
}

function renderAssistantFlowShell(
	containerEl: HTMLElement,
	variant: "live" | "completed",
): HTMLElement {
	const rowEl = containerEl.createDiv({
		cls: `friday-ai-message-row is-assistant friday-ai-answer-row is-${variant}`,
	});
	return rowEl.createDiv({ cls: `friday-ai-answer-flow friday-agent-process-flow is-${variant}` });
}

function renderTimelineProcess(
	containerEl: HTMLElement,
	timeline: AgentProcessTimelineView,
	options: {
		variant: "live" | "completed";
		expanded: boolean;
		onToggle: () => void;
		onAction?: (action: AgentTrajectoryAction) => void;
		renderAssistantAvatar: (containerEl: HTMLElement) => void;
		renderIcon?: RenderAgentProcessIcon;
	},
): void {
	const { variant, expanded, onToggle, onAction, renderAssistantAvatar, renderIcon } = options;
	const canToggle = timeline.canExpand;
	const shellEl = containerEl.createDiv({
		cls: `friday-agent-process friday-agent-process-shell is-${timeline.status} is-${variant} is-${expanded ? "expanded" : "collapsed"}`,
		attr: {
			"data-status": timeline.status,
			"data-expanded": expanded ? "true" : "false",
		},
	});
	const disclosureEl = shellEl.createDiv({
		cls: `friday-agent-process-disclosure friday-agent-process-header is-${timeline.status}${canToggle ? " is-clickable" : ""}`,
		attr: {
			...(canToggle ? {
				role: "button",
				tabindex: "0",
				"aria-expanded": expanded ? "true" : "false",
			} : {}),
		},
	});
	if (canToggle) {
		disclosureEl.onclick = () => onToggle();
		disclosureEl.onkeydown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			event.preventDefault();
			onToggle();
		};
	}
	const iconEl = disclosureEl.createDiv({ cls: "friday-agent-process-disclosure-icon friday-agent-process-avatar" });
	renderAssistantAvatar(iconEl);
	const titleEl = disclosureEl.createDiv({ cls: "friday-agent-process-disclosure-title" });
	titleEl.createDiv({ cls: "friday-agent-process-headline", text: displayTimelineText(timeline.title) });
	if (timeline.collapsedSummary) {
		titleEl.createDiv({ cls: "friday-agent-process-disclosure-summary", text: timeline.collapsedSummary });
	}
	if (!expanded) {
		renderTimelineActions(disclosureEl, timeline.actions, onAction, "friday-agent-process-disclosure-actions");
	}
	if (canToggle) {
		const toggleButton = disclosureEl.createEl("button", {
			cls: "friday-agent-process-toggle",
			attr: {
				"aria-expanded": expanded ? "true" : "false",
				"aria-label": expanded ? "收起过程详情" : "展开过程详情",
				title: expanded ? "收起过程详情" : "展开过程详情",
			},
		});
		toggleButton.type = "button";
		toggleButton.onclick = (event) => {
			event?.stopPropagation();
			onToggle();
		};
		renderChevronIcon(toggleButton, expanded ? "chevron-up" : "chevron-right", renderIcon);
	}
	if (expanded && canToggle) {
		renderTimelinePanel(shellEl, timeline, variant, onAction);
	}
}

function renderTimelinePanel(
	containerEl: HTMLElement,
	timeline: AgentProcessTimelineView,
	variant: "live" | "completed",
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const panelEl = containerEl.createDiv({
		cls: `friday-agent-process-timeline-panel friday-agent-process-panel friday-agent-process-strip is-${timeline.status} is-${variant}`,
		attr: {
			"data-status": timeline.status,
			role: "group",
		},
	});
	renderTimelineStatusBar(panelEl, timeline);
	const timelineEl = panelEl.createDiv({ cls: "friday-agent-process-timeline" });
	if (timeline.groups.length > 0) {
		renderTimelineGroups(timelineEl, timeline, onAction);
	} else {
		for (const item of timeline.items) {
			renderTimelineItem(timelineEl, item, timeline.actions, onAction);
		}
	}
}

function renderTimelineStatusBar(
	containerEl: HTMLElement,
	timeline: AgentProcessTimelineView,
): void {
	if (!timeline.statusBar) {
		return;
	}
	const statusBarEl = containerEl.createDiv({
		cls: `friday-agent-process-statusbar is-${timeline.statusBar.status}`,
		attr: {
			"data-status": timeline.statusBar.status,
		},
	});
	statusBarEl.createSpan({ cls: "friday-agent-process-statusbar-phase", text: displayTimelineText(timeline.statusBar.phase) });
	statusBarEl.createSpan({ cls: "friday-agent-process-statusbar-action", text: displayTimelineText(timeline.statusBar.action) });
	statusBarEl.createSpan({ cls: "friday-agent-process-statusbar-elapsed", text: timeline.statusBar.elapsed });
}

function displayTimelineText(value: string): string {
	return value;
}

function renderTimelineGroups(
	containerEl: HTMLElement,
	timeline: AgentProcessTimelineView,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const groupsEl = containerEl.createDiv({ cls: "friday-agent-process-phase-groups" });
	for (const group of timeline.groups) {
		const groupEl = groupsEl.createEl("details", {
			cls: `friday-agent-process-phase-group is-${group.status}`,
			attr: {
				"data-phase-id": group.id,
				"data-status": group.status,
				...(group.defaultExpanded ? { open: "true" } : {}),
			},
		});
		const summaryEl = groupEl.createEl("summary", { cls: "friday-agent-process-phase-summary" });
		summaryEl.createSpan({ cls: "friday-agent-process-phase-title", text: group.title });
		if (group.summary) {
			summaryEl.createSpan({ cls: "friday-agent-process-phase-subtitle", text: group.summary });
		}
		const bodyEl = groupEl.createDiv({ cls: "friday-agent-process-phase-body" });
		for (const item of group.items) {
			renderTimelineItem(bodyEl, item, timeline.actions, onAction);
		}
	}
}

function renderChevronIcon(
	containerEl: HTMLElement,
	icon: AgentProcessChevronIcon,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const iconEl = containerEl.createSpan({
		cls: "friday-agent-process-chevron",
		attr: {
			"aria-hidden": "true",
			"data-icon": icon,
		},
	});
	renderIcon?.(iconEl, icon);
}

function renderTimelineItem(
	containerEl: HTMLElement,
	item: AgentProcessTimelineItemView,
	actions: AgentProcessTimelineActionView[],
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const itemEl = containerEl.createDiv({
		cls: `friday-agent-process-timeline-item is-${item.kind} is-${item.status}`,
		attr: {
			"data-item-id": item.id,
			"data-kind": item.kind,
			"data-status": item.status,
		},
	});
	const railEl = itemEl.createDiv({ cls: "friday-agent-process-timeline-rail", attr: { "aria-hidden": "true" } });
	railEl.createDiv({ cls: "friday-agent-process-timeline-marker" });
	const contentEl = itemEl.createDiv({ cls: "friday-agent-process-timeline-content" });
	const titleRowEl = contentEl.createDiv({ cls: "friday-agent-process-timeline-title-row" });
	titleRowEl.createDiv({ cls: "friday-agent-process-timeline-title", text: displayTimelineText(item.title) });
	if (item.meta) {
		titleRowEl.createDiv({ cls: "friday-agent-process-timeline-meta", text: item.meta });
	}
	contentEl.createDiv({ cls: "friday-agent-process-timeline-summary", text: item.summary });
	renderTimelineItemNotes(contentEl, item);
	renderTimelineItemDetail(contentEl, item);
	if (item.actionRefs && item.actionRefs.length > 0) {
		const itemActions = actions.filter((action) => item.actionRefs?.includes(action.id));
		renderTimelineActions(contentEl, itemActions, onAction, "friday-agent-process-timeline-actions");
	}
}

function renderTimelineItemNotes(containerEl: HTMLElement, item: AgentProcessTimelineItemView): void {
	if (!item.notes || item.notes.length === 0) {
		return;
	}
	const notesEl = containerEl.createDiv({ cls: "friday-agent-process-timeline-notes" });
	for (const note of item.notes) {
		notesEl.createDiv({
			cls: `friday-agent-process-timeline-note is-${note.tone}`,
			text: note.text,
		});
	}
}

function renderTimelineItemDetail(containerEl: HTMLElement, item: AgentProcessTimelineItemView): void {
	if (!item.detail || item.detail.lines.length === 0) {
		return;
	}
	const detailEl = containerEl.createEl("details", {
		cls: "friday-agent-process-timeline-detail",
		attr: {
			...(item.detail.initiallyExpanded ? { open: "true" } : {}),
		},
	});
	detailEl.createEl("summary", {
		cls: "friday-agent-process-timeline-detail-title",
		text: item.detail.title || "技术细节",
	});
	for (const line of item.detail.lines) {
		detailEl.createDiv({ cls: "friday-agent-process-timeline-detail-line", text: line });
	}
}

function renderTimelineActions(
	containerEl: HTMLElement,
	actions: AgentProcessTimelineActionView[],
	onAction: ((action: AgentTrajectoryAction) => void) | undefined,
	className: string,
): void {
	if (actions.length === 0) {
		return;
	}
	const actionsEl = containerEl.createDiv({ cls: `${className} friday-agent-process-actions` });
	for (const action of actions) {
		renderActionButton(actionsEl, action, onAction);
	}
}

function renderActionButton(
	containerEl: HTMLElement,
	action: AgentProcessActionView | AgentProcessTimelineActionView,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const buttonEl = containerEl.createEl("button", {
		cls: `friday-agent-process-action is-${action.id} is-${action.tone}`,
		text: action.id === "view_replay" ? "查看过程" : action.label,
		attr: {
			"data-action-id": action.id,
			...(action.targetId ? { "data-target-id": action.targetId } : {}),
			...(action.reason ? { title: action.reason } : {}),
			...(action.enabled ? {} : { "aria-disabled": "true" }),
		},
	});
	buttonEl.type = "button";
	buttonEl.disabled = !action.enabled;
	buttonEl.onclick = () => {
		if (action.enabled) {
			onAction?.(action);
		}
	};
}

export function renderAgentAnswerFlow(options: RenderAgentAnswerFlowOptions): void {
	const {
		containerEl,
		snapshot,
		isStreaming = false,
		expanded = false,
		onToggle = () => {},
		onAction,
		renderContent,
		renderAssistantAvatar,
		renderIcon,
		onOpenArtifact,
	} = options;
	const view = snapshot ? buildAgentProcessPanelViewModel(snapshot) : null;
	const rowEl = containerEl.createDiv({ cls: "friday-ai-message-row is-assistant friday-ai-answer-row" });
	const flowEl = rowEl.createDiv({ cls: "friday-ai-answer-flow" });
	const shouldRenderProcessPanel = Boolean(view?.shouldRenderProcessPanel && view.timeline);
	if (!shouldRenderProcessPanel) {
		renderAssistantIdentityHeader(flowEl, renderAssistantAvatar);
	}
	if (shouldRenderProcessPanel && view?.timeline) {
		renderTimelineProcess(flowEl, view.timeline, {
			variant: "completed",
			expanded,
			onToggle,
			onAction,
			renderAssistantAvatar,
			renderIcon,
		});
	}
	const contentEl = flowEl.createDiv({
		cls: `friday-ai-answer-content${isStreaming ? " is-streaming" : ""}`,
	});
	renderContent(contentEl);

	if (!view) {
		return;
	}
	renderResultArtifacts(flowEl, view.resultArtifacts, view.diffSummary, onOpenArtifact);
}

function renderAssistantIdentityHeader(
	containerEl: HTMLElement,
	renderAssistantAvatar: (containerEl: HTMLElement) => void,
): void {
	const headerEl = containerEl.createDiv({
		cls: "friday-agent-process friday-agent-process-header friday-ai-answer-meta",
	});
	const avatarEl = headerEl.createDiv({ cls: "friday-agent-process-avatar" });
	renderAssistantAvatar(avatarEl);
	const mainEl = headerEl.createDiv({ cls: "friday-agent-process-header-main" });
	const roleEl = mainEl.createSpan({ cls: "friday-ai-message-role friday-wordmark", text: "FRIDAY" });
	roleEl.addClass("friday-agent-process-headline");
}

function renderResultArtifacts(
	containerEl: HTMLElement,
	artifacts: AgentProcessArtifactView[],
	diffSummary: AgentProcessDiffSummaryView | null,
	onOpenArtifact?: (path: string) => void,
): void {
	if (artifacts.length === 0) {
		return;
	}
	const artifactsEl = containerEl.createDiv({ cls: "friday-agent-artifacts" });
	artifactsEl.createDiv({ cls: "friday-agent-artifacts-title", text: "本次改动" });
	for (const artifact of artifacts) {
		renderArtifactCard(artifactsEl, artifact, onOpenArtifact);
	}
	if (diffSummary) {
		const summaryEl = artifactsEl.createDiv({ cls: "friday-agent-artifact-diff-summary" });
		summaryEl.createDiv({ cls: "friday-agent-artifact-diff-title", text: diffSummary.summary });
		for (const file of diffSummary.files) {
			const fileEl = summaryEl.createDiv({ cls: "friday-agent-artifact-diff-file" });
			fileEl.createSpan({ cls: "friday-agent-artifact-diff-path", text: file.path });
			if (file.summary) {
				fileEl.createSpan({ cls: "friday-agent-artifact-diff-meta", text: file.summary });
			}
		}
	}
}

function renderArtifactCard(
	containerEl: HTMLElement,
	artifact: AgentProcessArtifactView,
	onOpenArtifact?: (path: string) => void,
): void {
	const cardEl = containerEl.createDiv({
		cls: `friday-agent-artifact-card is-${artifact.extension || "file"} is-${artifact.status}`,
		attr: {
			"data-path": artifact.path,
		},
	});
	cardEl.createDiv({ cls: "friday-agent-artifact-icon", text: artifact.extension === "canvas" ? "Canvas" : "MD" });
	const bodyEl = cardEl.createDiv({ cls: "friday-agent-artifact-body" });
	bodyEl.createDiv({ cls: "friday-agent-artifact-name", text: artifact.name });
	bodyEl.createDiv({ cls: "friday-agent-artifact-meta", text: artifact.metadata });
	const buttonEl = cardEl.createEl("button", {
		cls: "friday-agent-artifact-open",
		text: "打开",
		attr: {
			"aria-label": `打开 ${artifact.name}`,
		},
	});
	buttonEl.type = "button";
	buttonEl.onclick = () => onOpenArtifact?.(artifact.path);
}
