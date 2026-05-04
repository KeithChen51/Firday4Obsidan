import type { AgentTrajectoryItem, AgentTrajectorySnapshot } from "../core/trajectory/AgentTrajectory";

type TranslateParams = Record<string, string | number | boolean | null | undefined>;

export interface RenderAgentTrajectoryCardOptions {
	containerEl: HTMLElement;
	snapshot: AgentTrajectorySnapshot | null;
	variant: "live" | "completed";
	expanded: boolean;
	onToggle: () => void;
	translate: (key: string, fallback: string, params?: TranslateParams) => string;
	renderAssistantAvatar: (containerEl: HTMLElement) => void;
}

export function renderAgentTrajectoryCard(options: RenderAgentTrajectoryCardOptions): void {
	const { containerEl, snapshot, variant, expanded, onToggle, translate, renderAssistantAvatar } = options;
	if (!snapshot) {
		return;
	}

	const rowEl = containerEl.createDiv({
		cls: `friday-ai-message-row is-assistant friday-ai-runtime-row is-${variant}`,
	});
	const bubbleEl = rowEl.createDiv({
		cls: `friday-ai-message is-assistant friday-ai-runtime-preview is-${variant}`,
	});
	const metaEl = bubbleEl.createDiv({ cls: "friday-ai-message-meta" });
	renderAssistantAvatar(metaEl);
	metaEl.createSpan({
		cls: "friday-ai-message-role",
		text: translate("ai.assistant", "FRIDAY"),
	});

	const contentEl = bubbleEl.createDiv({
		cls: `friday-ai-message-content friday-ai-runtime-card-content${expanded ? "" : " is-streaming"}`,
	});
	const cardEl = contentEl.createDiv({ cls: `friday-runtime-card is-${snapshot.status}` });
	const headerEl = cardEl.createDiv({ cls: "friday-runtime-card-header" });
	headerEl.createDiv({
		cls: "friday-runtime-card-brand",
		text: variant === "completed"
			? translate("ai.runtime.summary.completed", "This turn's tool record")
			: translate("ai.runtime.summary.title", "Tool execution summary"),
	});
	const toggleButton = headerEl.createEl("button", {
		cls: `friday-runtime-card-toggle${variant === "completed" ? " is-completed" : ""}`,
		text: expanded
			? translate("ai.runtime.summary.collapse", "Collapse")
			: variant === "completed"
				? translate("ai.runtime.summary.expandCompleted", "View")
				: translate("ai.runtime.summary.expand", "Details"),
	});
	toggleButton.onclick = onToggle;

	cardEl.createEl("h4", {
		cls: "friday-runtime-card-title",
		text: snapshot.headline,
	});
	if (snapshot.summary) {
		cardEl.createEl("p", {
			cls: "friday-runtime-card-summary",
			text: snapshot.summary,
		});
	}
	if (snapshot.failure?.message) {
		cardEl.createEl("p", {
			cls: "friday-runtime-card-summary is-failed",
			text: snapshot.failure.message,
		});
	}

	if (!expanded) {
		const collapsedMeta = cardEl.createDiv({ cls: "friday-runtime-card-collapsed" });
		for (const item of snapshot.items.slice(-3)) {
			collapsedMeta.createSpan({
				cls: `friday-runtime-pill is-${item.status}`,
				text: item.title,
			});
		}
		return;
	}

	const stageRailEl = cardEl.createDiv({ cls: "friday-runtime-stage-rail" });
	for (const stage of snapshot.stages) {
		stageRailEl.createDiv({
			cls: `friday-runtime-stage is-${stage.status}`,
			text: stage.label,
		});
	}

	if (snapshot.items.length === 0) {
		return;
	}
	const timelineEl = cardEl.createDiv({ cls: "friday-runtime-timeline" });
	for (const item of snapshot.items.slice(-10)) {
		renderTimelineItem(timelineEl, item);
	}
}

function renderTimelineItem(containerEl: HTMLElement, item: AgentTrajectoryItem): void {
	const rowEl = containerEl.createDiv({
		cls: `friday-runtime-entry is-${item.status} is-${item.kind}`,
	});
	rowEl.createDiv({
		cls: `friday-runtime-entry-dot is-${item.status}`,
	});
	const bodyEl = rowEl.createDiv({ cls: "friday-runtime-entry-body" });
	bodyEl.createDiv({
		cls: "friday-runtime-entry-label",
		text: item.title,
	});
	if (item.detail) {
		bodyEl.createDiv({
			cls: "friday-runtime-entry-detail",
			text: item.detail,
		});
	}
	const metaParts = [
		item.tool,
		item.targetPath,
		item.step === undefined ? "" : `step ${item.step}`,
	].filter(Boolean);
	if (metaParts.length > 0) {
		bodyEl.createDiv({
			cls: "friday-runtime-entry-meta",
			text: metaParts.join(" · "),
		});
	}
}
