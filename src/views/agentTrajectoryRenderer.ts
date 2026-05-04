import type { AgentTrajectoryAction, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";
import {
	buildAgentProcessPanelViewModel,
	type AgentProcessActionView,
	type AgentProcessEvidenceView,
	type AgentProcessMutationView,
	type AgentProcessPanelViewModel,
	type AgentProcessStageView,
	type AgentProcessStepGroupView,
	type AgentProcessTimelineItemView,
} from "./agentProcessPanelViewModel";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

export interface RenderAgentTrajectoryCardOptions {
	containerEl: HTMLElement;
	snapshot: AgentTrajectorySnapshot | null;
	variant: "live" | "completed";
	expanded: boolean;
	onToggle: () => void;
	onAction?: (action: AgentTrajectoryAction) => void;
	translate: (key: string, fallback: string, params?: TranslateParams) => string;
	renderAssistantAvatar: (containerEl: HTMLElement) => void;
}

export function renderAgentTrajectoryCard(options: RenderAgentTrajectoryCardOptions): void {
	const { containerEl, snapshot, variant, expanded, onToggle, onAction, translate, renderAssistantAvatar } = options;
	if (!snapshot) {
		return;
	}

	const view = buildAgentProcessPanelViewModel(snapshot);
	const contentEl = renderProcessShell(containerEl, variant, translate, renderAssistantAvatar);
	if (view.mode === "simple_thinking") {
		renderThinkingState(contentEl, view);
		return;
	}

	const panelEl = contentEl.createDiv({
		cls: `friday-agent-process is-${view.status.key} is-${view.status.tone} is-${variant}`,
		attr: {
			"data-status": view.status.key,
			"data-mode": view.mode,
			role: "group",
		},
	});
	renderHeader(panelEl, view, expanded, onToggle, onAction);
	if (!expanded) {
		renderCollapsedBody(panelEl, view);
		return;
	}
	renderExpandedBody(panelEl, view, onAction);
}

function renderProcessShell(
	containerEl: HTMLElement,
	variant: "live" | "completed",
	translate: RenderAgentTrajectoryCardOptions["translate"],
	renderAssistantAvatar: RenderAgentTrajectoryCardOptions["renderAssistantAvatar"],
): HTMLElement {
	const rowEl = containerEl.createDiv({
		cls: `friday-ai-message-row is-assistant friday-agent-process-row is-${variant}`,
	});
	const bubbleEl = rowEl.createDiv({
		cls: `friday-ai-message is-assistant friday-agent-process-shell is-${variant}`,
	});
	const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
	renderAssistantAvatar(metaEl);
	metaEl.createSpan({
		cls: "friday-ai-message-role",
		text: translate("ai.assistant", "FRIDAY"),
	});
	return bubbleEl.createDiv({ cls: "friday-ai-message-content friday-agent-process-content" });
}

function renderThinkingState(containerEl: HTMLElement, view: AgentProcessPanelViewModel): void {
	const thinkingEl = containerEl.createDiv({
		cls: `friday-agent-process-thinking is-${view.status.tone}`,
		attr: {
			"data-status": view.status.key,
		},
	});
	thinkingEl.createDiv({ cls: "friday-agent-process-status", text: view.header.label });
	const copyEl = thinkingEl.createDiv({ cls: "friday-agent-process-thinking-copy" });
	copyEl.createDiv({ cls: "friday-agent-process-headline", text: view.header.headline });
	if (view.header.summary) {
		copyEl.createDiv({ cls: "friday-agent-process-summary", text: view.header.summary });
	}
}

function renderHeader(
	panelEl: HTMLElement,
	view: AgentProcessPanelViewModel,
	expanded: boolean,
	onToggle: () => void,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const headerEl = panelEl.createDiv({ cls: "friday-agent-process-header" });
	headerEl.createDiv({
		cls: `friday-agent-process-status is-${view.status.tone}`,
		text: view.status.label,
	});

	const mainEl = headerEl.createDiv({ cls: "friday-agent-process-header-main" });
	mainEl.createDiv({ cls: "friday-agent-process-headline", text: view.header.headline });
	if (view.header.summary) {
		mainEl.createDiv({ cls: "friday-agent-process-summary", text: view.header.summary });
	}

	if (!expanded) {
		const primaryAction = view.actions.find((action) => action.enabled) ?? view.actions[0];
		if (primaryAction) {
			renderActionButton(headerEl, primaryAction, onAction);
		}
	}

	const toggleButton = headerEl.createEl("button", {
		cls: "friday-agent-process-toggle",
		text: expanded ? "Collapse" : "Details",
		attr: {
			"aria-expanded": expanded ? "true" : "false",
			title: expanded ? "Collapse process details" : "Show process details",
		},
	});
	toggleButton.type = "button";
	toggleButton.onclick = onToggle;
}

function renderCollapsedBody(panelEl: HTMLElement, view: AgentProcessPanelViewModel): void {
	if (view.current) {
		renderCurrent(panelEl, view.current);
	}
	if (view.evidence.length > 0) {
		renderEvidence(panelEl, view.evidence.slice(0, 3), "friday-agent-process-evidence is-collapsed");
	}
}

function renderExpandedBody(
	panelEl: HTMLElement,
	view: AgentProcessPanelViewModel,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const bodyEl = panelEl.createDiv({ cls: "friday-agent-process-body" });
	renderStages(bodyEl, view.stages);
	if (view.current) {
		renderCurrent(bodyEl, view.current);
	}
	if (view.stepGroups.length > 0) {
		const stepsEl = bodyEl.createDiv({ cls: "friday-agent-process-steps" });
		for (const group of view.stepGroups) {
			renderStepGroup(stepsEl, group);
		}
	}
	if (view.timeline.length > 0) {
		renderTimeline(bodyEl, view);
	}
	if (view.evidence.length > 0) {
		renderEvidence(bodyEl, view.evidence, "friday-agent-process-evidence");
	}
	if (view.mutations.length > 0) {
		renderMutations(bodyEl, view.mutations);
	}
	if (view.recovery) {
		const recoveryEl = bodyEl.createDiv({ cls: "friday-agent-process-recovery" });
		recoveryEl.createDiv({ cls: "friday-agent-process-section-label", text: view.recovery.title });
		recoveryEl.createDiv({ cls: "friday-agent-process-section-summary", text: view.recovery.summary });
	}
	if (view.actions.length > 0) {
		const actionsEl = bodyEl.createDiv({ cls: "friday-agent-process-actions" });
		for (const action of view.actions) {
			renderActionButton(actionsEl, action, onAction);
		}
	}
}

function renderStages(containerEl: HTMLElement, stages: AgentProcessStageView[]): void {
	const stagesEl = containerEl.createDiv({ cls: "friday-agent-process-stages" });
	for (const stage of stages) {
		stagesEl.createDiv({
			cls: `friday-agent-process-stage is-${stage.status}${stage.current ? " is-current" : ""}`,
			text: stage.label,
			attr: {
				"data-stage": stage.key,
			},
		});
	}
}

function renderCurrent(containerEl: HTMLElement, current: AgentProcessTimelineItemView): void {
	const currentEl = containerEl.createDiv({
		cls: `friday-agent-process-current is-${current.tone} is-${current.kind}`,
	});
	currentEl.createDiv({ cls: "friday-agent-process-section-label", text: "Current" });
	currentEl.createDiv({ cls: "friday-agent-process-current-title", text: current.title });
	if (current.detail) {
		currentEl.createDiv({ cls: "friday-agent-process-current-detail", text: current.detail });
	}
	if (current.meta) {
		currentEl.createDiv({ cls: "friday-agent-process-meta", text: current.meta });
	}
}

function renderStepGroup(containerEl: HTMLElement, group: AgentProcessStepGroupView): void {
	const groupEl = containerEl.createDiv({
		cls: `friday-agent-process-step is-${group.status}`,
		attr: {
			"data-stage": group.key,
		},
	});
	const headerEl = groupEl.createDiv({ cls: "friday-agent-process-step-header" });
	headerEl.createDiv({ cls: "friday-agent-process-step-title", text: group.title });
	const toggleEl = headerEl.createEl("button", {
		cls: "friday-agent-process-step-toggle",
		text: group.collapsedByDefault ? "Expand" : "Collapse",
		attr: {
			"aria-expanded": group.collapsedByDefault ? "false" : "true",
		},
	});
	toggleEl.type = "button";
	if (group.summary) {
		groupEl.createDiv({ cls: "friday-agent-process-section-summary", text: group.summary });
	}
	const itemsEl = groupEl.createDiv({ cls: "friday-agent-process-step-items" });
	for (const item of group.items.slice(-4)) {
		renderTimelineRow(itemsEl, item);
	}
}

function renderTimeline(containerEl: HTMLElement, view: AgentProcessPanelViewModel): void {
	const timelineEl = containerEl.createDiv({ cls: "friday-agent-process-timeline" });
	timelineEl.createDiv({ cls: "friday-agent-process-section-label", text: "Timeline" });
	for (const item of view.timeline) {
		renderTimelineRow(timelineEl, item);
	}
	if (view.overflowCount > 0) {
		timelineEl.createDiv({
			cls: "friday-agent-process-overflow",
			text: `${view.overflowCount} earlier event${view.overflowCount === 1 ? "" : "s"} hidden`,
		});
	}
}

function renderTimelineRow(containerEl: HTMLElement, item: AgentProcessTimelineItemView): void {
	const rowEl = containerEl.createDiv({
		cls: `friday-agent-process-timeline-row is-${item.status} is-${item.kind}`,
	});
	rowEl.createDiv({ cls: "friday-agent-process-timeline-dot" });
	const bodyEl = rowEl.createDiv({ cls: "friday-agent-process-timeline-body" });
	bodyEl.createDiv({ cls: "friday-agent-process-timeline-title", text: item.title });
	if (item.detail) {
		bodyEl.createDiv({ cls: "friday-agent-process-timeline-detail", text: item.detail });
	}
	if (item.meta) {
		bodyEl.createDiv({ cls: "friday-agent-process-meta", text: item.meta });
	}
}

function renderEvidence(
	containerEl: HTMLElement,
	evidence: AgentProcessEvidenceView[],
	className: string,
): void {
	const evidenceEl = containerEl.createDiv({ cls: className });
	evidenceEl.createDiv({ cls: "friday-agent-process-section-label", text: "Evidence" });
	for (const item of evidence) {
		evidenceEl.createSpan({
			cls: `friday-agent-process-evidence-chip is-${item.source}`,
			text: item.label,
			attr: {
				title: item.detail,
			},
		});
	}
}

function renderMutations(containerEl: HTMLElement, mutations: AgentProcessMutationView[]): void {
	const mutationsEl = containerEl.createDiv({ cls: "friday-agent-process-mutations" });
	mutationsEl.createDiv({ cls: "friday-agent-process-section-label", text: "Changes" });
	for (const mutation of mutations) {
		const mutationEl = mutationsEl.createDiv({
			cls: `friday-agent-process-mutation is-${mutation.tone}`,
		});
		mutationEl.createDiv({
			cls: "friday-agent-process-mutation-title",
			text: mutation.targetPath ? `${mutation.operation} ${mutation.targetPath}` : mutation.operation,
		});
		mutationEl.createDiv({
			cls: "friday-agent-process-mutation-summary",
			text: mutation.reason || mutation.summary || mutation.event,
		});
	}
}

function renderActionButton(
	containerEl: HTMLElement,
	action: AgentProcessActionView,
	onAction?: (action: AgentTrajectoryAction) => void,
): void {
	const buttonEl = containerEl.createEl("button", {
		cls: `friday-agent-process-action is-${action.id} is-${action.tone}`,
		text: action.label,
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
