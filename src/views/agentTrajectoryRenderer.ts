import type { AgentTrajectoryAction, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";
import { FRIDAY_WORDMARK_FONT_FAMILY } from "../constants/wordmarkFont";
import {
	buildAgentProcessPanelViewModel,
	type AgentComposerTaskBarTaskView,
	type AgentComposerTaskBarView,
	type AgentProcessActionView,
	type AgentProcessArtifactView,
	type AgentProcessFileType,
	type AgentProcessTimelineActionView,
	type AgentProcessTimelineItemStatus,
	type AgentProcessTimelineItemView,
	type AgentProcessTimelineToolCallView,
	type AgentProcessTimelineView,
} from "./agentProcessPanelViewModel";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;
type AgentProcessChevronIcon = "chevron-right" | "chevron-up";
type AgentProcessStatusIcon = "check" | "loader" | "circle" | "minus" | "pause" | "x";
type AgentProcessToolIcon = "arrow-right";
type AgentProcessFileIcon = "file-text" | "layout" | "file-code" | "file";
type RenderAgentProcessIcon = (containerEl: HTMLElement, icon: AgentProcessChevronIcon | AgentProcessStatusIcon | AgentProcessToolIcon | AgentProcessFileIcon) => void;

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
	assistantSoulStyleCode?: string;
	assistantSoulStyleLabel?: string;
	assistantSoulStyleFullLabel?: string;
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
	const isRunning = taskBar.collapsed.statusLabel === "正在执行";
	const barEl = containerEl.createDiv({
		cls: `friday-composer-task-bar composer-taskbar-kit-v5 is-${expanded ? "expanded" : "collapsed"}${isRunning ? " is-running" : ""}`,
		attr: {
			"data-expanded": expanded ? "true" : "false",
		},
	});
	const buttonEl = barEl.createEl("button", {
		cls: "friday-composer-task-bar-summary composer-taskbar-summary-v5",
		attr: {
			type: "button",
			"aria-expanded": expanded ? "true" : "false",
		},
	});
	buttonEl.onclick = () => onToggle();
	buttonEl.createSpan({ cls: "friday-composer-task-bar-status composer-taskbar-status-v5", text: taskBar.collapsed.statusLabel });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-step composer-taskbar-step-v5", text: taskBar.collapsed.stepLabel });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-title composer-taskbar-title-v5", text: taskBar.collapsed.taskTitle });
	buttonEl.createSpan({ cls: "friday-composer-task-bar-elapsed composer-taskbar-elapsed-v5", text: taskBar.collapsed.elapsed });
	renderChevronIcon(buttonEl, expanded ? "chevron-up" : "chevron-right", renderIcon);
	if (taskBar.actionSlot) {
		barEl.createDiv({ cls: "friday-composer-task-bar-action-slot" });
	}
	if (!expanded) {
		return;
	}
	const listEl = barEl.createDiv({ cls: "friday-composer-task-bar-list composer-taskbar-list-v5" });
	const totalTasks = taskBar.expandedTasks.length;
	for (const task of taskBar.expandedTasks) {
		const statusClass = composerTaskStatusClass(task.status);
		const itemEl = listEl.createDiv({
			cls: `friday-composer-task-bar-item composer-taskbar-task-v5 is-${task.status} is-${statusClass}`,
			attr: {
				"data-task-id": task.id,
				"data-status": task.status,
			},
		});
		const markerEl = itemEl.createSpan({
			cls: `friday-composer-task-bar-item-marker composer-taskbar-marker-v5 is-${task.status} is-${statusClass}`,
			attr: {
				"aria-hidden": "true",
			},
		});
		renderComposerTaskStatusIcon(markerEl, task.status, renderIcon);
		itemEl.createSpan({ cls: "friday-composer-task-bar-item-progress", text: `${task.index}/${totalTasks}` });
		itemEl.createEl("strong", { cls: "friday-composer-task-bar-item-title", text: task.title });
		itemEl.createSpan({
			cls: `friday-composer-task-bar-item-status is-${task.status} is-${statusClass}`,
			text: formatComposerTaskStatus(task.status),
		});
	}
}

function composerTaskStatusClass(status: AgentComposerTaskBarTaskView["status"]): string {
	return status.replace(/_/g, "-");
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
	throw new Error(`Unhandled composer task status: ${String(status)}`);
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
	const stateClass = view.timeline.status === "thinking" ? "is-thinking" : "is-working";
	const flowEl = renderAssistantFlowShell(containerEl, variant, renderAssistantAvatar, stateClass);
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
	renderAssistantAvatar: (containerEl: HTMLElement) => void,
	stateClass?: string,
): HTMLElement {
	const rowEl = containerEl.createDiv({
		cls: `friday-ai-message-row is-assistant friday-ai-answer-row assistant-turn-v2 is-${variant}${stateClass ? ` ${stateClass}` : ""}`,
	});
	const sourceMarkEl = rowEl.createSpan({ cls: "assistant-source-mark-v3" });
	renderAssistantAvatar(sourceMarkEl);
	const flowEl = rowEl.createDiv({
		cls: `friday-ai-answer-flow assistant-turn-body-v2 is-${variant}`,
	});
	return flowEl;
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
		assistantSoulStyleCode?: string;
		assistantSoulStyleLabel?: string;
		assistantSoulStyleFullLabel?: string;
		renderIcon?: RenderAgentProcessIcon;
	},
): void {
	const {
		variant,
		expanded,
		onToggle,
		onAction,
		renderIcon,
		assistantSoulStyleCode,
		assistantSoulStyleLabel,
		assistantSoulStyleFullLabel,
	} = options;
	if (variant === "live") {
		renderAssistantResultMeta(containerEl, {
			statusText: timeline.status === "thinking" ? "正在思考" : "正在工作",
			elapsed: extractElapsedLabel(timeline.title),
			assistantSoulStyleCode,
			assistantSoulStyleLabel,
			assistantSoulStyleFullLabel,
		});
		if (timeline.items.length === 0) {
			return;
		}
		const stackEl = containerEl.createDiv({
			cls: `assistant-output-stack-v3 is-${timeline.status} is-${variant} is-expanded`,
			attr: {
				"data-status": timeline.status,
				"data-expanded": "true",
			},
		});
		renderNativeKitProcessSteps(stackEl, timeline.items, timeline.actions, onAction, renderIcon);
		return;
	}

	const canToggle = timeline.canExpand;
	const detailId = `assistant-process-detail-${timeline.status}-${timeline.items.length}`;
	renderAssistantResultMeta(containerEl, {
		statusText: timeline.title.includes("已思考") ? "已思考" : "已完成工作",
		elapsed: extractElapsedLabel(timeline.title),
		assistantSoulStyleCode,
		assistantSoulStyleLabel,
		assistantSoulStyleFullLabel,
		canToggle,
		expanded,
		controlsId: canToggle ? detailId : undefined,
		onToggle,
		renderIcon,
	});
	if (!canToggle) {
		return;
	}
	const detailEl = containerEl.createDiv({
		cls: `assistant-process-detail-v6 is-${timeline.status} is-${variant} is-${expanded ? "expanded is-open" : "collapsed"}`,
		attr: {
			id: detailId,
			"aria-hidden": expanded ? "false" : "true",
			"data-status": timeline.status,
			"data-expanded": expanded ? "true" : "false",
		},
	});
	const innerEl = detailEl.createDiv({ cls: "assistant-process-detail-inner-v6" });
	renderNativeKitProcessSteps(innerEl, timeline.items, timeline.actions, onAction, renderIcon);
}

function displayTimelineText(value: string): string {
	return value;
}

function renderAssistantResultMeta(
	containerEl: HTMLElement,
	options: {
		statusText: string;
		elapsed?: string;
		canToggle?: boolean;
		expanded?: boolean;
		controlsId?: string;
		onToggle?: () => void;
		renderIcon?: RenderAgentProcessIcon;
		assistantSoulStyleCode?: string;
		assistantSoulStyleLabel?: string;
		assistantSoulStyleFullLabel?: string;
	},
): HTMLElement {
	const {
		statusText,
		elapsed,
		canToggle = false,
		expanded = false,
		controlsId,
		onToggle,
		renderIcon,
		assistantSoulStyleCode,
		assistantSoulStyleLabel,
		assistantSoulStyleFullLabel,
	} = options;
	const metaEl = containerEl.createEl(canToggle ? "button" : "div", {
		cls: `assistant-meta-v2 assistant-result-meta-v6${canToggle ? " assistant-process-toggle-v6" : ""}`,
		attr: {
			...(canToggle ? {
				type: "button",
				"aria-expanded": expanded ? "true" : "false",
				...(controlsId ? { "aria-controls": controlsId } : {}),
			} : {}),
		},
	});
	if (canToggle) {
		metaEl.onclick = () => onToggle?.();
	}
	const wordmarkEl = metaEl.createSpan({ cls: "friday-wordmark", text: "FRIDAY" });
	wordmarkEl.style.fontFamily = FRIDAY_WORDMARK_FONT_FAMILY;
	if (assistantSoulStyleCode) {
		metaEl.createSpan({ cls: "assistant-meta-separator-v1", text: "·" });
		metaEl.createSpan({
			cls: "assistant-soul-label-v1",
			text: assistantSoulStyleLabel || assistantSoulStyleCode,
			attr: {
				title: assistantSoulStyleFullLabel || assistantSoulStyleCode,
			},
		});
	}
	metaEl.createSpan({ text: statusText });
	if (elapsed) {
		metaEl.createSpan({ text: elapsed });
	}
	if (canToggle) {
		const chevronEl = metaEl.createSpan({
			cls: "assistant-process-chevron-v6",
			text: renderIcon ? "" : "›",
			attr: {
				"aria-hidden": "true",
				"data-icon": "chevron-right",
			},
		});
		renderIcon?.(chevronEl, "chevron-right");
	}
	return metaEl;
}

function extractElapsedLabel(title: string): string {
	const normalized = title.replace(/\s*·\s*/g, " ").trim();
	const match = normalized.match(/(\d+m\s+\d{2}s|\d+m|\d+s)$/);
	return match?.[1] ?? "";
}

function renderNativeKitProcessSteps(
	containerEl: HTMLElement,
	items: AgentProcessTimelineItemView[],
	actions: AgentProcessTimelineActionView[],
	onAction: ((action: AgentTrajectoryAction) => void) | undefined,
	renderIcon?: RenderAgentProcessIcon,
): void {
	for (const item of items) {
		if (item.kind === "receipt" || item.kind === "done") {
			continue;
		}
		renderNativeKitProcessStep(containerEl, item, actions, onAction, renderIcon);
	}
}

function renderNativeKitProcessStep(
	containerEl: HTMLElement,
	item: AgentProcessTimelineItemView,
	actions: AgentProcessTimelineActionView[],
	onAction: ((action: AgentTrajectoryAction) => void) | undefined,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const stepId = sanitizeDomId(item.id);
	const detailId = `${stepId}-detail`;
	const stepEl = containerEl.createDiv({
		cls: `assistant-process-step-v6 is-${item.kind} is-${item.status}`,
		attr: {
			"data-item-id": item.id,
			"data-kind": item.kind,
			"data-status": item.status,
		},
	});
	const isRunning = item.status === "running" || item.status === "waiting";
	const buttonEl = stepEl.createEl("button", {
		cls: `kit-event-row-v1 assistant-process-event-v6 assistant-step-toggle-v6${isRunning ? " kit-running-surface-v1" : ""}`,
		attr: {
			type: "button",
			"aria-expanded": "false",
			"aria-controls": detailId,
		},
	});
	renderStepArrowIcon(buttonEl, renderIcon);
	const mainEl = buttonEl.createDiv({ cls: "kit-event-row-main-v1" });
	mainEl.createEl("strong", { text: displayTimelineText(item.title) });
	const detailText = item.summary || item.toolCall?.detail || item.meta || "";
	if (detailText) {
		mainEl.createSpan({ text: displayTimelineText(detailText) });
	}
	const statusLabel = processStepStatusLabel(item.status);
	if (statusLabel) {
		buttonEl.createSpan({ cls: "kit-soft-chip-v1", text: statusLabel });
	}
	const detailEl = stepEl.createDiv({
		cls: "assistant-step-detail-v6",
		attr: {
			id: detailId,
			"aria-hidden": "true",
		},
	});
	const detailInnerEl = detailEl.createDiv({ cls: "assistant-step-detail-inner-v6" });
	for (const call of timelineToolCallsForRenderedItem(item)) {
		renderNativeKitToolCallRow(detailInnerEl, call, item.status, renderIcon);
	}
	buttonEl.onclick = (event?: MouseEvent) => {
		event?.preventDefault?.();
		event?.stopPropagation?.();
		const activeButtonEl = resolveEventElement(event?.currentTarget, buttonEl);
		const activeStepEl = resolveStepElement(activeButtonEl, stepEl);
		const activeDetailEl = resolveStepDetailElement(activeStepEl, detailEl);
		const isOpen = getElementAttribute(activeButtonEl, "aria-expanded") === "true";
		activeButtonEl.setAttribute("aria-expanded", String(!isOpen));
		activeDetailEl.setAttribute("aria-hidden", String(isOpen));
		setElementClass(activeStepEl, "is-open", !isOpen);
	};
	renderNativeKitStepNarration(stepEl, item);
	if (item.actionRefs && item.actionRefs.length > 0) {
		const itemActions = actions.filter((action) => item.actionRefs?.includes(action.id));
		renderTimelineActions(stepEl, itemActions, onAction, "friday-agent-process-timeline-actions");
	}
}

function renderStepArrowIcon(containerEl: HTMLElement, renderIcon?: RenderAgentProcessIcon): void {
	const iconEl = containerEl.createSpan({
		cls: "kit-tool-icon-v1 assistant-step-arrow-v6",
		attr: {
			"aria-hidden": "true",
			"data-icon": "arrow-right",
		},
	});
	renderIcon?.(iconEl, "arrow-right");
}

function timelineToolCallsForRenderedItem(item: AgentProcessTimelineItemView): AgentProcessTimelineToolCallView[] {
	const calls: AgentProcessTimelineToolCallView[] = [];
	if (item.toolCall) {
		calls.push(item.toolCall);
	}
	for (const call of item.toolCalls ?? []) {
		if (!calls.some((existing) => existing.name === call.name && existing.detail === call.detail)) {
			calls.push(call);
		}
	}
	return calls;
}

function renderNativeKitToolCallRow(
	containerEl: HTMLElement,
	call: AgentProcessTimelineToolCallView,
	status: AgentProcessTimelineItemStatus,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const isRunning = status === "running" || status === "waiting";
	const rowEl = containerEl.createDiv({ cls: `kit-event-row-v1 assistant-tool-call-v5${isRunning ? " kit-running-surface-v1" : ""}` });
	renderToolCallIcon(rowEl, renderIcon);
	const mainEl = rowEl.createDiv({ cls: "kit-event-row-main-v1" });
	mainEl.createEl("strong", {
		cls: "assistant-tool-name-v5",
		text: displayTimelineText(call.name),
	});
	mainEl.createSpan({
		cls: "assistant-tool-detail-v5",
		text: displayTimelineText(call.detail),
	});
	rowEl.createSpan({ text: toolCallStatusLabel(status) });
}

function renderNativeKitStepNarration(containerEl: HTMLElement, item: AgentProcessTimelineItemView): void {
	const text = item.notes?.map((note) => note.text.trim()).filter(Boolean).join(" ") ||
		item.summary ||
		item.meta ||
		item.toolCall?.detail ||
		"";
	if (!text) {
		return;
	}
	containerEl.createDiv({
		cls: "assistant-step-narration-v6",
		text,
		attr: {
			"data-process-typewriter-key": `step-note:${item.id}`,
			"data-process-typewriter-text": text,
		},
	});
}

function resolveEventElement(value: unknown, fallback: HTMLElement): HTMLElement {
	return isMutableElement(value) ? value : fallback;
}

function resolveStepElement(buttonEl: HTMLElement, fallback: HTMLElement): HTMLElement {
	const candidate = buttonEl as HTMLElement & { closest?: (selector: string) => Element | null };
	const stepEl = typeof candidate.closest === "function"
		? candidate.closest(".assistant-process-step-v6")
		: null;
	return isMutableElement(stepEl) ? stepEl : fallback;
}

function resolveStepDetailElement(stepEl: HTMLElement, fallback: HTMLElement): HTMLElement {
	const candidate = stepEl as HTMLElement & { querySelector?: (selector: string) => Element | null };
	const detailEl = typeof candidate.querySelector === "function"
		? candidate.querySelector(".assistant-step-detail-v6")
		: null;
	return isMutableElement(detailEl) ? detailEl : fallback;
}

function isMutableElement(value: unknown): value is HTMLElement {
	const candidate = value as Partial<HTMLElement> | null;
	return Boolean(candidate) &&
		typeof candidate?.getAttribute === "function" &&
		typeof candidate?.setAttribute === "function";
}

function processStepStatusLabel(status: AgentProcessTimelineItemStatus): string {
	switch (status) {
		case "running":
			return "进行中";
		case "waiting":
			return "待确认";
		case "pending":
			return "未开始";
		case "warning":
			return "需确认";
		case "error":
			return "失败";
		case "done":
			return "";
	}
	return assertUnhandledTimelineItemStatus(status);
}

function toolCallStatusLabel(status: AgentProcessTimelineItemStatus): string {
	switch (status) {
		case "running":
			return "运行中";
		case "waiting":
			return "待确认";
		case "pending":
			return "未开始";
		case "warning":
			return "需确认";
		case "error":
			return "失败";
		case "done":
			return "完成";
	}
	return assertUnhandledTimelineItemStatus(status);
}

function assertUnhandledTimelineItemStatus(status: never): never {
	throw new Error(`Unhandled timeline item status: ${String(status)}`);
}

function sanitizeDomId(value: string): string {
	return `assistant-step-${value.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function setElementClass(element: HTMLElement, className: string, enabled: boolean): void {
	const fakeElement = element as HTMLElement & { classes?: Set<string> };
	if (fakeElement.classes) {
		if (enabled) {
			fakeElement.classes.add(className);
		} else {
			fakeElement.classes.delete(className);
		}
		return;
	}
	element.classList.toggle(className, enabled);
}

function getElementAttribute(element: HTMLElement, name: string): string | null {
	const fakeElement = element as HTMLElement & { attributes?: Record<string, string> };
	if (fakeElement.attributes && typeof fakeElement.attributes[name] === "string") {
		return fakeElement.attributes[name];
	}
	return element.getAttribute(name);
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
	renderIcon?: RenderAgentProcessIcon,
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
	const contentEl = itemEl.createDiv({ cls: "friday-agent-process-timeline-content friday-agent-process-step-card-v2" });
	const eventRowEl = contentEl.createDiv({
		cls: `friday-agent-process-timeline-event-row kit-event-row-v1${item.toolCall ? " assistant-tool-call-v5" : ""} is-${item.kind}`,
	});
	renderTimelineEventRowMain(eventRowEl, item, renderIcon);
	if (item.meta) {
		eventRowEl.createSpan({ cls: "friday-agent-process-timeline-meta kit-soft-chip-v1", text: item.meta });
	}
	createTypewriterText(
		contentEl,
		"friday-agent-process-timeline-summary",
		item.summary,
		`${item.id}:summary`,
	);
	renderTimelineItemNotes(contentEl, item);
	renderTimelineItemCommandDetails(contentEl, item, renderIcon);
	if (item.actionRefs && item.actionRefs.length > 0) {
		const itemActions = actions.filter((action) => item.actionRefs?.includes(action.id));
		renderTimelineActions(contentEl, itemActions, onAction, "friday-agent-process-timeline-actions");
	}
}

function renderTimelineEventRowMain(
	eventRowEl: HTMLElement,
	item: AgentProcessTimelineItemView,
	renderIcon?: RenderAgentProcessIcon,
): HTMLElement {
	if (item.toolCall) {
		renderToolCallIcon(eventRowEl, renderIcon);
		const titleRowEl = eventRowEl.createDiv({ cls: "friday-agent-process-timeline-title-row kit-event-row-main-v1" });
		titleRowEl.createEl("strong", {
			cls: "friday-agent-process-timeline-tool-name assistant-tool-name-v5",
			text: displayTimelineText(item.toolCall.name),
		});
		if (item.title && item.title !== item.toolCall.detail) {
			titleRowEl.createSpan({
				cls: "friday-agent-process-timeline-tool-title",
				text: displayTimelineText(item.title),
			});
		}
		titleRowEl.createSpan({
			cls: "friday-agent-process-timeline-tool-detail assistant-tool-detail-v5",
			text: displayTimelineText(item.toolCall.detail),
		});
		return titleRowEl;
	}
	const titleRowEl = eventRowEl.createDiv({ cls: "friday-agent-process-timeline-title-row kit-event-row-main-v1" });
	titleRowEl.createDiv({ cls: "friday-agent-process-timeline-title", text: displayTimelineText(item.title) });
	return titleRowEl;
}

function renderToolCallIcon(
	containerEl: HTMLElement,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const iconEl = containerEl.createSpan({
		cls: "kit-tool-icon-v1",
		attr: {
			"aria-hidden": "true",
			"data-icon": "arrow-right",
		},
	});
	renderIcon?.(iconEl, "arrow-right");
}

function createTypewriterText(
	containerEl: HTMLElement,
	className: string,
	text: string,
	key: string,
): HTMLElement {
	const displayText = displayTimelineText(text);
	return containerEl.createDiv({
		cls: className,
		text: displayText,
		attr: {
			"data-process-typewriter-key": key,
			"data-process-typewriter-text": displayText,
		},
	});
}

function renderTimelineItemNotes(containerEl: HTMLElement, item: AgentProcessTimelineItemView): void {
	if (!item.notes || item.notes.length === 0) {
		return;
	}
	const notesEl = containerEl.createDiv({ cls: "friday-agent-process-timeline-notes" });
	for (const [index, note] of item.notes.entries()) {
		const noteEl = createTypewriterText(
			notesEl,
			`friday-agent-process-timeline-note is-${note.tone}`,
			note.text,
			`${item.id}:note:${index}`,
		);
		noteEl.setAttribute("data-tone", note.tone);
	}
}

function renderTimelineItemCommandDetails(
	containerEl: HTMLElement,
	item: AgentProcessTimelineItemView,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const calls = (item.toolCalls ?? []).filter((call) => !isSameTimelineToolCall(call, item.toolCall));
	if (calls.length === 0) {
		return;
	}
	const detailsEl = containerEl.createEl("details", {
		cls: "friday-agent-process-command-details is-secondary",
		attr: {
			"data-command-count": String(calls.length),
		},
	});
	const summaryEl = detailsEl.createEl("summary", {
		cls: "friday-agent-process-command-summary kit-event-row-v1 is-secondary",
	});
	renderToolCallIcon(summaryEl, renderIcon);
	const summaryMainEl = summaryEl.createDiv({ cls: "kit-event-row-main-v1" });
	summaryMainEl.createEl("strong", { text: "工具调用" });
	summaryMainEl.createSpan({ text: "查看本步骤运行的命令" });
	summaryEl.createSpan({ cls: "kit-soft-chip-v1", text: `已运行 ${calls.length} 条命令` });
	const listEl = detailsEl.createDiv({ cls: "friday-agent-process-command-list" });
	for (const call of calls) {
		const rowEl = listEl.createDiv({ cls: "friday-agent-process-command-row kit-event-row-v1 assistant-tool-call-v5 is-secondary" });
		renderToolCallIcon(rowEl, renderIcon);
		const mainEl = rowEl.createDiv({ cls: "kit-event-row-main-v1" });
		mainEl.createEl("strong", {
			cls: "assistant-tool-name-v5 friday-agent-process-timeline-tool-name",
			text: displayTimelineText(call.name),
		});
		mainEl.createSpan({
			cls: "assistant-tool-detail-v5 friday-agent-process-timeline-tool-detail",
			text: displayTimelineText(call.detail),
		});
	}
}

function isSameTimelineToolCall(
	call: AgentProcessTimelineToolCallView,
	primary: AgentProcessTimelineToolCallView | undefined,
): boolean {
	return Boolean(primary && primary.name === call.name && primary.detail === call.detail);
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
		assistantSoulStyleCode,
		assistantSoulStyleLabel,
		assistantSoulStyleFullLabel,
		renderIcon,
		onOpenArtifact,
	} = options;
	const view = snapshot ? buildAgentProcessPanelViewModel(snapshot) : null;
	const hasComplexProcess = Boolean(view?.timeline?.canExpand);
	const flowEl = renderAssistantFlowShell(containerEl, "completed", renderAssistantAvatar, hasComplexProcess ? "is-complex-result" : "is-simple-result");
	if (view?.timeline) {
		renderTimelineProcess(flowEl, view.timeline, {
			variant: "completed",
			expanded,
			onToggle,
			onAction,
			renderAssistantAvatar,
			assistantSoulStyleCode,
			assistantSoulStyleLabel,
			assistantSoulStyleFullLabel,
			renderIcon,
		});
	} else {
		renderAssistantResultMeta(flowEl, {
			statusText: isStreaming ? "正在工作" : "已思考",
			assistantSoulStyleCode,
			assistantSoulStyleLabel,
			assistantSoulStyleFullLabel,
		});
	}
	const outputStackEl = flowEl.createDiv({ cls: "assistant-output-stack-v3" });
	renderAssistantProseBlock(outputStackEl, isStreaming, renderContent);

	if (!view) {
		return;
	}
	renderResultArtifacts(outputStackEl, view.resultArtifacts, onOpenArtifact, renderIcon);
}

function renderAssistantProseBlock(
	containerEl: HTMLElement,
	isStreaming: boolean,
	renderContent: (containerEl: HTMLElement) => void,
): void {
	const blockEl = containerEl.createEl("section", {
		cls: `friday-ai-answer-content assistant-output-block is-prose${isStreaming ? " is-streaming" : ""}`,
	});
	const bodyEl = blockEl.createDiv({ cls: "friday-ai-answer-content-body" });
	renderContent(bodyEl);
}

function renderAssistantToolCallRows(
	containerEl: HTMLElement,
	timeline: AgentProcessTimelineView,
	renderIcon?: RenderAgentProcessIcon,
): void {
	for (const item of timeline.items) {
		if (!item.toolCall) {
			continue;
		}
		renderAssistantToolCallRow(containerEl, item, renderIcon);
	}
}

function renderAssistantToolCallRow(
	containerEl: HTMLElement,
	item: AgentProcessTimelineItemView,
	renderIcon?: RenderAgentProcessIcon,
): void {
	if (!item.toolCall) {
		return;
	}
	const rowEl = containerEl.createDiv({ cls: `kit-event-row-v1 assistant-tool-call-v5 is-${item.kind}` });
	renderToolCallIcon(rowEl, renderIcon);
	const mainEl = rowEl.createDiv({ cls: "kit-event-row-main-v1" });
	mainEl.createEl("strong", {
		cls: "assistant-tool-name-v5 friday-agent-process-timeline-tool-name",
		text: displayTimelineText(item.toolCall.name),
	});
	mainEl.createSpan({
		cls: "assistant-tool-detail-v5 friday-agent-process-timeline-tool-detail",
		text: displayTimelineText(item.toolCall.detail),
	});
	if (item.meta) {
		rowEl.createSpan({ cls: "kit-soft-chip-v1", text: item.meta });
	}
}

function renderResultArtifacts(
	containerEl: HTMLElement,
	artifacts: AgentProcessArtifactView[],
	onOpenArtifact?: (path: string) => void,
	renderIcon?: RenderAgentProcessIcon,
): void {
	if (artifacts.length === 0) {
		return;
	}
	const artifactsEl = containerEl.createEl("section", { cls: "friday-agent-artifacts assistant-output-block is-artifact" });
	const titleEl = artifactsEl.createDiv({ cls: "friday-agent-artifacts-title assistant-block-title" });
	titleEl.createSpan({ text: "本次产出" });
	const artifactListEl = artifactsEl.createDiv({ cls: "assistant-artifact-list-v4" });
	for (const artifact of artifacts) {
		renderArtifactCard(artifactListEl, artifact, onOpenArtifact, renderIcon);
	}
}

function renderArtifactCard(
	containerEl: HTMLElement,
	artifact: AgentProcessArtifactView,
	onOpenArtifact?: (path: string) => void,
	renderIcon?: RenderAgentProcessIcon,
): void {
	const cardEl = containerEl.createDiv({
		cls: `friday-agent-artifact-card assistant-artifact-row-v4 is-${artifact.extension || "file"} is-${artifact.status}`,
		attr: {
			"data-path": artifact.path,
			role: "button",
			tabindex: "0",
			"aria-label": `打开 ${artifact.name}`,
			title: artifact.path,
		},
	});
	renderFileTypeIcon(cardEl, artifact.fileType, "friday-agent-artifact-icon", renderIcon);
	cardEl.createEl("strong", { cls: "friday-agent-artifact-name", text: artifact.name });
	cardEl.onclick = () => onOpenArtifact?.(artifact.path);
	cardEl.onkeydown = (event: KeyboardEvent) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		event.preventDefault();
		onOpenArtifact?.(artifact.path);
	};
}

function renderFileTypeIcon(
	containerEl: HTMLElement,
	fileType: AgentProcessFileType,
	className: string,
	renderIcon?: RenderAgentProcessIcon,
): HTMLElement {
	const iconEl = containerEl.createSpan({
		cls: `${className} kit-file-type-icon-v1 ${fileTypeIconClass(fileType)}`,
		attr: {
			"aria-hidden": "true",
		},
	});
	const innerEl = iconEl.createSpan({ cls: "friday-icon" });
	renderIcon?.(innerEl, fileTypeIconName(fileType));
	return iconEl;
}

function fileTypeIconClass(fileType: AgentProcessFileType): string {
	switch (fileType) {
		case "markdown":
			return "is-markdown";
		case "canvas":
			return "is-canvas";
		case "code":
			return "is-code";
		case "note":
			return "is-note";
	}
	return assertUnhandledFileType(fileType);
}

function fileTypeIconName(fileType: AgentProcessFileType): AgentProcessFileIcon {
	switch (fileType) {
		case "markdown":
			return "file-text";
		case "canvas":
			return "layout";
		case "code":
			return "file-code";
		case "note":
			return "file";
	}
	return assertUnhandledFileType(fileType);
}

function assertUnhandledFileType(fileType: never): never {
	throw new Error(`Unhandled file type: ${String(fileType)}`);
}

function isTimelineRunningSurfaceStatus(status: AgentProcessTimelineView["status"]): boolean {
	return status === "running" ||
		status === "waiting" ||
		status === "retrying" ||
		status === "recovering";
}
