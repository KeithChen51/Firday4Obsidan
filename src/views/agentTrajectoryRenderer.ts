import type { AgentTrajectoryAction, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";
import {
	buildAgentProcessPanelViewModel,
	type AgentProcessActionView,
	type AgentProcessArtifactView,
	type AgentProcessDiffSummaryView,
	type AgentProcessPanelViewModel,
	type AgentProcessStepActionView,
	type AgentProcessStepView,
} from "./agentProcessPanelViewModel";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;
type AgentProcessChevronIcon = "chevron-right" | "chevron-up";
type RenderAgentProcessIcon = (containerEl: HTMLElement, icon: AgentProcessChevronIcon) => void;

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

export function renderAgentTrajectoryCard(options: RenderAgentTrajectoryCardOptions): void {
	const { containerEl, snapshot, variant, expanded, onToggle, onAction, renderAssistantAvatar, renderIcon } = options;
	if (!snapshot) {
		return;
	}

	const view = buildAgentProcessPanelViewModel(snapshot);
	if (!view.shouldRenderProcessPanel) {
		return;
	}
	const flowEl = renderAssistantFlowShell(containerEl, variant);
	renderAgentProcessHeader(flowEl, {
		view,
		variant,
		expanded,
		onToggle,
		renderAssistantAvatar,
		renderIcon,
	});
	if (shouldRenderExpandedProcessPanel(view, expanded)) {
		renderExpandedProcessPanel(flowEl, view, variant, onAction);
	}
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

function renderAgentProcessHeader(
	containerEl: HTMLElement,
	options: {
		view: AgentProcessPanelViewModel;
		variant: "live" | "completed";
		expanded: boolean;
		onToggle: () => void;
		renderAssistantAvatar: (containerEl: HTMLElement) => void;
		renderIcon?: RenderAgentProcessIcon;
	},
): void {
	const { view, variant, expanded, onToggle, renderAssistantAvatar, renderIcon } = options;
	const canToggle = view.canExpand;
	const headerEl = containerEl.createDiv({
		cls: `friday-agent-process friday-agent-process-header friday-agent-process-disclosure is-${view.status.key} is-${view.status.tone} is-${view.mode} is-${variant}${canToggle ? " is-clickable" : ""}`,
		attr: {
			"data-status": view.status.key,
			"data-mode": view.mode,
			"data-surface": view.surface,
			...(canToggle ? {
				role: "button",
				tabindex: "0",
				"aria-expanded": expanded ? "true" : "false",
			} : {}),
		},
	});
	if (canToggle) {
		headerEl.onclick = () => onToggle();
		headerEl.onkeydown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			event.preventDefault();
			onToggle();
		};
	}
	const avatarEl = headerEl.createDiv({ cls: "friday-agent-process-avatar" });
	renderAssistantAvatar(avatarEl);
	const mainEl = headerEl.createDiv({ cls: "friday-agent-process-header-main" });
	mainEl.createDiv({ cls: "friday-agent-process-headline", text: view.header.headline || "FRIDAY" });

	if (!canToggle) {
		return;
	}

	const toggleButton = headerEl.createEl("button", {
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

function shouldRenderExpandedProcessPanel(view: AgentProcessPanelViewModel, expanded: boolean): boolean {
	return expanded && view.canExpand;
}

function renderExpandedProcessPanel(
	containerEl: HTMLElement,
	view: AgentProcessPanelViewModel,
	variant: "live" | "completed",
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const panelEl = containerEl.createDiv({
		cls: `friday-agent-process-panel friday-agent-process-strip is-${view.status.key} is-${view.status.tone} is-${variant}`,
		attr: {
			"data-status": view.status.key,
			"data-mode": view.mode,
			"data-surface": view.surface,
			role: "group",
		},
	});
	if (view.mode === "simple_thinking") {
		renderSimpleThinkingPanel(panelEl, view);
		return;
	}
	renderExpandedBody(panelEl, view, onAction);
}

function renderSimpleThinkingPanel(
	containerEl: HTMLElement,
	view: AgentProcessPanelViewModel,
): void {
	const simpleEl = containerEl.createDiv({ cls: "friday-agent-process-simple" });
	simpleEl.createDiv({
		cls: "friday-agent-process-section-summary",
		text: view.header.summary || "已完成直接回答。",
	});
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

function renderExpandedBody(
	panelEl: HTMLElement,
	view: AgentProcessPanelViewModel,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const bodyEl = panelEl.createDiv({ cls: "friday-agent-process-body" });
	renderVisibleStepTimeline(bodyEl, view.visibleSteps, onAction);
	if (view.recovery) {
		const recoveryEl = bodyEl.createDiv({ cls: "friday-agent-process-recovery" });
		recoveryEl.createDiv({ cls: "friday-agent-process-section-label", text: view.recovery.title });
		recoveryEl.createDiv({ cls: "friday-agent-process-section-summary", text: view.recovery.summary });
	}
}

function renderVisibleStepTimeline(
	containerEl: HTMLElement,
	steps: AgentProcessStepView[],
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const timelineEl = containerEl.createDiv({ cls: "friday-agent-process-timeline" });
	for (const step of steps) {
		renderProcessStep(timelineEl, step, onAction);
	}
}

function renderProcessStep(
	containerEl: HTMLElement,
	step: AgentProcessStepView,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const stepEl = containerEl.createDiv({
		cls: `friday-agent-process-step is-${step.status}`,
		attr: {
			"data-step-id": step.id,
			"data-step-status": step.status,
		},
	});
	stepEl.createDiv({ cls: "friday-agent-process-step-marker", attr: { "aria-hidden": "true" } });
	const bodyEl = stepEl.createDiv({ cls: "friday-agent-process-step-body" });
	const titleRow = bodyEl.createDiv({ cls: "friday-agent-process-step-title-row" });
	titleRow.createDiv({ cls: "friday-agent-process-step-title", text: step.title });
	if (step.summary) {
		bodyEl.createDiv({ cls: "friday-agent-process-section-summary", text: step.summary });
	}
	const eventActions = step.actions.filter((action) => action.kind === "event");
	if (eventActions.length > 0) {
		const actionsEl = bodyEl.createDiv({ cls: "friday-agent-process-step-actions" });
		for (const action of eventActions) {
			renderStepEvent(actionsEl, action);
		}
	}
	if (step.fileRefs.length > 0) {
		const filesEl = bodyEl.createDiv({ cls: "friday-agent-process-step-files" });
		for (const file of step.fileRefs) {
			filesEl.createSpan({
				cls: "friday-agent-process-file-ref",
				text: file.path,
				attr: { title: file.operation },
			});
		}
	}
	const controls = step.actions.filter((action) => action.kind === "control" && action.action);
	if (controls.length > 0) {
		const controlsEl = bodyEl.createDiv({ cls: "friday-agent-process-step-controls friday-agent-process-actions" });
		for (const control of controls) {
			if (control.action) {
				renderActionButton(controlsEl, control.action, onAction);
			}
		}
	}
}

function renderStepEvent(containerEl: HTMLElement, item: AgentProcessStepActionView): void {
	const itemEl = containerEl.createDiv({
		cls: `friday-agent-process-step-action is-${item.status || "event"}`,
	});
	itemEl.createDiv({ cls: "friday-agent-process-step-action-bullet", text: "-" });
	const copyEl = itemEl.createDiv({ cls: "friday-agent-process-step-action-copy" });
	copyEl.createDiv({ cls: "friday-agent-process-step-action-label", text: item.label });
	if (item.detail && item.detail !== item.label) {
		copyEl.createDiv({ cls: "friday-agent-process-meta", text: item.detail });
	}
}

function renderActionButton(
	containerEl: HTMLElement,
	action: AgentProcessActionView,
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
	if (view?.shouldRenderProcessPanel) {
		renderAgentProcessHeader(flowEl, {
			view,
			variant: "completed",
			expanded,
			onToggle,
			renderAssistantAvatar,
			renderIcon,
		});
		if (shouldRenderExpandedProcessPanel(view, expanded)) {
			renderExpandedProcessPanel(flowEl, view, "completed", onAction);
		}
	} else {
		renderAssistantIdentityHeader(flowEl, renderAssistantAvatar);
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
