import type {
	AgentTrajectoryAction,
	AgentTrajectoryItem,
	AgentTrajectoryItemStatus,
	AgentTrajectoryMutation,
	AgentTrajectoryPlanTaskStatus,
	AgentTrajectorySnapshot,
	AgentTrajectoryStatus,
} from "../core/trajectory/AgentTrajectory";
import {
	productizeActionLabel,
	productizeRuntimeText,
} from "./agentUserFacingPresenter";

export type AgentProcessPanelMode = "simple_thinking" | "stepped_process" | "completed_replay";

export type AgentProcessSurface =
	| "hidden"
	| "inline_thinking"
	| "compact_live_process"
	| "expanded_live_process"
	| "action_required"
	| "compact_recovery"
	| "collapsed_completed_replay";

export type AgentProcessTriggerReason =
	| "tool_activity"
	| "context_activity"
	| "memory_activity"
	| "mutation_review"
	| "approval_required"
	| "user_input_required"
	| "transport_retry"
	| "failure_recovery"
	| "long_running"
	| "completed_audit";

export type AgentProcessTone =
	| "idle"
	| "running"
	| "reconnecting"
	| "waiting"
	| "failed"
	| "completed"
	| "cancelled"
	| "safe_stopped";

export type AgentProcessStepStatus =
	| "running"
	| "completed"
	| "waiting_for_approval"
	| "failed"
	| "retryable"
	| "cancelled"
	| "denied";

type AgentProcessStepKey =
	| "receipt"
	| "plan"
	| "context"
	| "reasoning"
	| "file_change"
	| "approval"
	| "transport"
	| "failure"
	| "internal";

type AgentProcessInteractionRoute = "direct_answer" | "clarify" | "light_task" | "task_with_process";
type AgentTrajectoryIntakeSurfaceItem = AgentTrajectoryItem & {
	intakeInteractionRoute?: AgentProcessInteractionRoute;
	intakeShouldShowProcess?: boolean;
	intakeShouldUseVisiblePlan?: boolean;
};

const USER_VISIBLE_RETRY_LIMIT = 5;
const RETRY_RECOVERY_COPY_PREFIX = "网络波动，正在恢复请求";
const REQUEST_EXHAUSTED_COPY = "请求多次未成功，请稍后重试。";

export interface AgentProcessStatusView {
	key: AgentTrajectoryStatus;
	label: string;
	tone: AgentProcessTone;
	needsAttention: boolean;
}

export interface AgentProcessEvidenceView {
	id: string;
	label: string;
	source: "file" | "tool" | "event";
	detail: string;
}

export interface AgentProcessFileRefView {
	path: string;
	name: string;
	operation: string;
}

export interface AgentProcessMutationView {
	id: string;
	event: AgentTrajectoryMutation["event"];
	operation: string;
	targetPath: string;
	summary: string;
	reason: string;
	tone: AgentProcessTone;
}

export interface AgentProcessArtifactView {
	id: string;
	path: string;
	name: string;
	extension: string;
	metadata: string;
	status: "created" | "modified" | "applied";
	summary: string;
}

export interface AgentProcessDiffSummaryView {
	changedFiles: number;
	summary: string;
	files: Array<{
		path: string;
		summary: string;
		additions?: number;
		deletions?: number;
	}>;
}

export interface AgentProcessActionView extends AgentTrajectoryAction {
	tone: "primary" | "secondary" | "danger";
}

export type AgentProcessTimelineStatus =
	| "hidden"
	| "thinking"
	| "running"
	| "waiting"
	| "retrying"
	| "recovering"
	| "failed"
	| "cancelled"
	| "completed";

export type AgentProcessTimelineItemKind =
	| "receipt"
	| "plan"
	| "context"
	| "reasoning"
	| "tool_batch"
	| "file_change"
	| "validation"
	| "retry"
	| "approval"
	| "blocked"
	| "finalizing"
	| "done";

export type AgentProcessTimelineItemStatus =
	| "pending"
	| "running"
	| "done"
	| "warning"
	| "error"
	| "waiting";

export interface AgentProcessTimelineDetailView {
	title?: string;
	lines: string[];
	initiallyExpanded: boolean;
}

export interface AgentProcessTimelineActionView {
	id: AgentTrajectoryAction["id"];
	label: string;
	enabled: boolean;
	tone: "primary" | "secondary" | "danger";
	targetId?: string;
	reason?: string;
}

export interface AgentProcessTimelineNoteView {
	id: string;
	text: string;
	tone: "progress" | "done" | "warning";
}

export interface AgentProcessTimelineItemView {
	id: string;
	kind: AgentProcessTimelineItemKind;
	status: AgentProcessTimelineItemStatus;
	title: string;
	summary: string;
	meta?: string;
	detail?: AgentProcessTimelineDetailView;
	notes?: AgentProcessTimelineNoteView[];
	artifactRefs?: string[];
	actionRefs?: string[];
	sourceItemIds?: string[];
}

export interface AgentProcessTimelineStatusBarView {
	phase: string;
	action: string;
	elapsed: string;
	status: AgentProcessTimelineStatus;
}

export interface AgentProcessTimelineGroupView {
	id: string;
	title: string;
	status: AgentProcessTimelineItemStatus;
	summary: string;
	defaultExpanded: boolean;
	items: AgentProcessTimelineItemView[];
}

export interface AgentProcessTimelineView {
	title: string;
	status: AgentProcessTimelineStatus;
	defaultExpanded: boolean;
	canExpand: boolean;
	collapsedSummary?: string;
	statusBar: AgentProcessTimelineStatusBarView | null;
	groups: AgentProcessTimelineGroupView[];
	items: AgentProcessTimelineItemView[];
	actions: AgentProcessTimelineActionView[];
	finalArtifacts: AgentProcessArtifactView[];
	diffSummary: AgentProcessDiffSummaryView | null;
}

export interface AgentComposerTaskBarTaskView {
	id: string;
	index: number;
	title: string;
	status: AgentTrajectoryPlanTaskStatus;
}

export interface AgentComposerTaskBarView {
	collapsed: {
		statusLabel: string;
		stepLabel: string;
		taskTitle: string;
		elapsed: string;
	};
	expandedTasks: AgentComposerTaskBarTaskView[];
	actionSlot: null;
}

export interface AgentProcessStepActionView {
	id: string;
	label: string;
	detail: string;
	kind: "event" | "control";
	tone: AgentProcessTone | "primary" | "secondary" | "danger";
	status?: AgentTrajectoryItemStatus;
	tool?: string;
	targetPath?: string;
	rawEventType?: string;
	action?: AgentProcessActionView;
}

export interface AgentProcessStepView {
	id: string;
	title: string;
	status: AgentProcessStepStatus;
	summary: string;
	actions: AgentProcessStepActionView[];
	evidence: AgentProcessEvidenceView[];
	fileRefs: AgentProcessFileRefView[];
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
}

export interface AgentProcessRecoveryView {
	title: string;
	summary: string;
	retryable: boolean;
	recoverable: boolean;
}

export interface AgentProcessPanelViewModel {
	mode: AgentProcessPanelMode;
	surface: AgentProcessSurface;
	shouldRenderProcessPanel: boolean;
	hasExpandableContent: boolean;
	canExpand: boolean;
	triggerReason: AgentProcessTriggerReason | null;
	durationSeconds: number;
	title: string;
	status: AgentProcessStatusView;
	header: {
		label: string;
		headline: string;
		summary: string;
	};
	timeline: AgentProcessTimelineView | null;
	composerTaskBar: AgentComposerTaskBarView | null;
	visibleSteps: AgentProcessStepView[];
	evidence: AgentProcessEvidenceView[];
	mutations: AgentProcessMutationView[];
	resultArtifacts: AgentProcessArtifactView[];
	diffSummary: AgentProcessDiffSummaryView | null;
	actions: AgentProcessActionView[];
	recovery: AgentProcessRecoveryView | null;
	isEmpty: boolean;
	overflowCount: number;
}

export interface BuildAgentProcessPanelViewModelOptions {
	maxCollapsedItems?: number;
	maxExpandedItems?: number;
	now?: Date | (() => Date);
}

export function buildAgentProcessPanelViewModel(
	snapshot: AgentTrajectorySnapshot | null,
	options: BuildAgentProcessPanelViewModelOptions = {},
): AgentProcessPanelViewModel {
	if (!snapshot) {
		return createEmptyViewModel();
	}

	const visibleItems = snapshot.items.filter((item) =>
		isRenderableTrajectoryItem(item) &&
		!isStageReportNarrationItem(item) &&
		!isTaskBarPlanProcessItem(snapshot, item) &&
		!isGenericLiveModelLifecycleItem(snapshot, item)
	);
	const actions = buildActionViews(snapshot);
	const mutations = buildMutations(snapshot);
	const recovery = buildRecovery(snapshot, mutations);
	const interactionRoute = resolveInteractionRoute(snapshot);
	const visibleSteps = buildVisibleSteps(snapshot, visibleItems, actions, recovery, interactionRoute);
	const mode = resolveMode(snapshot, visibleSteps);
	const durationSeconds = calculateDurationSeconds(snapshot, options.now);
	const triggerReason = resolveTriggerReason(snapshot, visibleItems, mutations);
	const surface = resolveSurface(snapshot, mode, triggerReason, interactionRoute, visibleItems);
	const status = buildStatus(snapshot, visibleSteps);
	const evidence = buildEvidence(visibleItems);
	const resultArtifacts = buildResultArtifacts(snapshot);
	const diffSummary = buildDiffSummary(resultArtifacts);
	const hasExpandableContent = resolveHasExpandableContent(surface, visibleSteps);
	const headline = headerHeadline(snapshot, mode, triggerReason, durationSeconds);
	const timeline = buildTimelineView(snapshot, options, {
		mode,
		surface,
		triggerReason,
		durationSeconds,
		visibleSteps,
		actions,
		resultArtifacts,
		diffSummary,
		recovery,
		interactionRoute,
	});
	const composerTaskBarDurationSeconds = snapshot.status === "running"
		? durationSeconds
		: calculateRecordedDurationSeconds(snapshot, durationSeconds);
	const composerTaskBar = buildComposerTaskBar(snapshot, composerTaskBarDurationSeconds);

	return {
		mode,
		surface,
		shouldRenderProcessPanel: surface !== "hidden",
		hasExpandableContent,
		canExpand: hasExpandableContent,
		triggerReason,
		durationSeconds,
		title: headline,
		status,
		header: {
			label: headerLabel(snapshot, mode),
			headline,
			summary: headerSummary(snapshot, visibleSteps),
		},
		timeline,
		composerTaskBar,
		visibleSteps,
		evidence,
		mutations,
		resultArtifacts,
		diffSummary,
		actions,
		recovery,
		isEmpty: snapshot.items.length === 0 && snapshot.mutations.length === 0,
		overflowCount: 0,
	};
}

function createEmptyViewModel(): AgentProcessPanelViewModel {
	return {
		mode: "simple_thinking",
		surface: "hidden",
		shouldRenderProcessPanel: false,
		hasExpandableContent: false,
		canExpand: false,
		triggerReason: null,
		durationSeconds: 0,
		title: "FRIDAY is ready",
		status: {
			key: "idle",
			label: "Idle",
			tone: "idle",
			needsAttention: false,
		},
		header: {
			label: "Idle",
			headline: "FRIDAY is ready",
			summary: "",
		},
		timeline: null,
		composerTaskBar: null,
		visibleSteps: [],
		evidence: [],
		mutations: [],
		resultArtifacts: [],
		diffSummary: null,
		actions: [],
		recovery: null,
		isEmpty: true,
		overflowCount: 0,
	};
}

function resolveMode(snapshot: AgentTrajectorySnapshot, visibleSteps: AgentProcessStepView[]): AgentProcessPanelMode {
	if (snapshot.privacy.source === "replay" || snapshot.status === "completed" || snapshot.status === "safe_stopped") {
		return visibleSteps.length > 0 ? "completed_replay" : "simple_thinking";
	}
	if (snapshot.status === "running" && visibleSteps.length === 0) {
		return "simple_thinking";
	}
	return "stepped_process";
}

function isLifecycleOnlyItem(item: AgentTrajectoryItem): boolean {
	if (item.rawEventType === "start" && !item.targetPath && !item.evidenceRef) {
		return true;
	}
	return item.kind === "task" &&
		(item.rawEventType === "task_created" ||
			item.rawEventType === "task_running" ||
			item.rawEventType === "task_completed");
}

function isRenderableTrajectoryItem(item: AgentTrajectoryItem): boolean {
	return !isLifecycleOnlyItem(item) &&
		item.kind !== "plan" &&
		!(item.kind === "narration" && item.narrationKind === "plan_declared") &&
		!isInternalPreflightItem(item);
}

function isTaskBarPlanProcessItem(snapshot: AgentTrajectorySnapshot, item: AgentTrajectoryItem): boolean {
	if (!hasTaskBarPlan(snapshot)) {
		return false;
	}
	if (item.kind === "narration" && item.narrationKind === "plan_declared") {
		return true;
	}
	return (item.kind === "reasoning" || item.kind === "model") &&
		isGenericLifecycleReasoningText(lifecycleItemText(item));
}

function isGenericLiveModelLifecycleItem(snapshot: AgentTrajectorySnapshot, item: AgentTrajectoryItem): boolean {
	if (snapshot.privacy.source !== "live") {
		return false;
	}
	if (item.kind !== "model" && item.kind !== "reasoning") {
		return false;
	}
	if (item.targetPath || item.evidenceRef || item.tool) {
		return false;
	}
	const text = lifecycleItemText(item);
	if (item.rawEventType === "model_request") {
		return true;
	}
	const generic = isGenericLifecycleReasoningText(text) ||
		isGenericLifecycleContextText(text) ||
		/requesting model decision|model response received/i.test(text) ||
		/FRIDAY\s*正在理解你的请求|正在理解你的请求|理解请求|完成理解|已整理当前判断/.test(text);
	if (item.reasoningProvider || item.reasoningRawFormat) {
		return generic;
	}
	return generic;
}

function hasTaskBarPlan(snapshot: AgentTrajectorySnapshot): boolean {
	const plan = snapshot.plan;
	return Boolean(plan && isTaskBarPlanVisibility(plan.visibility) && plan.tasks.length > 0);
}

function isInternalPreflightItem(item: AgentTrajectoryItem): boolean {
	return isInternalPreflightContextItem(item) || isContextReadyCheckpointItem(item);
}

function isInternalPreflightContextItem(item: AgentTrajectoryItem): boolean {
	if (item.kind !== "context" || item.rawEventType !== "context") {
		return false;
	}
	return /(?:^|:)context:(instructions|skills|memory|compact)$/i.test(item.id) ||
		/^Context:\s*(instructions|skills|memory|compact)$/i.test(cleanText(item.title));
}

function isContextReadyCheckpointItem(item: AgentTrajectoryItem): boolean {
	return item.kind === "system" &&
		item.rawEventType === "checkpoint_saved" &&
		/Context package built before|context_ready|native model request/i.test(lifecycleItemText(item));
}

function resolveSurface(
	snapshot: AgentTrajectorySnapshot,
	mode: AgentProcessPanelMode,
	triggerReason: AgentProcessTriggerReason | null,
	interactionRoute: AgentProcessInteractionRoute | null,
	visibleItems: AgentTrajectoryItem[],
): AgentProcessSurface {
	if (
		isQuietInteractionRoute(interactionRoute) &&
		!hasNontrivialProcessEvidence(snapshot, visibleItems) &&
		!isActionRequiredStatus(snapshot.status)
	) {
		return "hidden";
	}
	if (mode === "simple_thinking") {
		return snapshot.status === "completed" ? "inline_thinking" : "hidden";
	}
	if (isActionRequiredStatus(snapshot.status) || triggerReason === "mutation_review") {
		return "action_required";
	}
	if (snapshot.status === "failed" || snapshot.status === "cancelled" || snapshot.status === "safe_stopped" || triggerReason === "failure_recovery") {
		return "compact_recovery";
	}
	if (mode === "completed_replay") {
		return "collapsed_completed_replay";
	}
	if (snapshot.status === "running") {
		return "expanded_live_process";
	}
	return "compact_live_process";
}

function resolveHasExpandableContent(
	surface: AgentProcessSurface,
	visibleSteps: AgentProcessStepView[],
): boolean {
	if (surface === "hidden") {
		return false;
	}
	return visibleSteps.length > 0;
}

function resolveInteractionRoute(snapshot: AgentTrajectorySnapshot): AgentProcessInteractionRoute | null {
	for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
		const item = snapshot.items[index];
		if (!item || item.kind !== "intake") {
			continue;
		}
		const route = (item as AgentTrajectoryIntakeSurfaceItem).intakeInteractionRoute;
		if (isInteractionRoute(route)) {
			return route;
		}
	}
	return null;
}

function isInteractionRoute(value: unknown): value is AgentProcessInteractionRoute {
	return value === "direct_answer" ||
		value === "clarify" ||
		value === "light_task" ||
		value === "task_with_process";
}

function isQuietInteractionRoute(route: AgentProcessInteractionRoute | null): boolean {
	return route === "direct_answer" || route === "clarify";
}

function isActionRequiredStatus(status: AgentTrajectoryStatus): boolean {
	return status === "waiting_for_approval" || status === "waiting_for_user";
}

function hasNontrivialProcessEvidence(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
): boolean {
	if (snapshot.failure || snapshot.mutations.length > 0 || isActionRequiredStatus(snapshot.status)) {
		return true;
	}
	if (snapshot.plan && snapshot.plan.visibility === "visible" && snapshot.plan.tasks.length > 0) {
		return true;
	}
	return visibleItems.some((item) =>
		item.kind === "tool" ||
		item.kind === "approval" ||
		item.kind === "mutation" ||
		item.kind === "transport" ||
		Boolean(item.targetPath) ||
		Boolean(item.evidenceRef)
	);
}

function resolveTriggerReason(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
	mutations: AgentProcessMutationView[],
): AgentProcessTriggerReason | null {
	if (snapshot.status === "waiting_for_approval" || visibleItems.some((item) => item.kind === "approval")) {
		return "approval_required";
	}
	if (snapshot.status === "waiting_for_user") {
		return "user_input_required";
	}
	if (snapshot.failure) {
		return "failure_recovery";
	}
	if (mutations.some((mutation) => mutation.event === "planned" || mutation.event === "conflicted" || mutation.event === "apply_failed")) {
		return "mutation_review";
	}
	if (visibleItems.some((item) => item.kind === "transport")) {
		return "transport_retry";
	}
	if (visibleItems.some((item) => item.kind === "tool" || item.kind === "mutation" || Boolean(item.targetPath))) {
		return "tool_activity";
	}
	if (visibleItems.some((item) => item.rawEventType === "memory")) {
		return "memory_activity";
	}
	if (visibleItems.some((item) =>
		item.kind === "narration" ||
		item.kind === "context" ||
		item.kind === "reasoning" ||
		item.kind === "model" ||
		item.kind === "system" ||
		Boolean(item.evidenceRef)
	)) {
		return "context_activity";
	}
	if (snapshot.privacy.source === "replay" || snapshot.status === "completed") {
		return "completed_audit";
	}
	return null;
}

function buildStatus(
	snapshot: AgentTrajectorySnapshot,
	visibleSteps: AgentProcessStepView[],
): AgentProcessStatusView {
	const tone = statusTone(snapshot.status, visibleSteps);
	return {
		key: snapshot.status,
		label: statusLabel(snapshot.status, tone),
		tone,
		needsAttention: tone === "waiting" || tone === "failed",
	};
}

function statusTone(status: AgentTrajectoryStatus, visibleSteps: AgentProcessStepView[]): AgentProcessTone {
	const currentStep = visibleSteps.at(-1);
	if (currentStep?.title === "恢复请求" && currentStep.status !== "failed") {
		return "reconnecting";
	}
	switch (status) {
		case "waiting_for_approval":
		case "waiting_for_user":
			return "waiting";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "safe_stopped":
			return "safe_stopped";
		case "completed":
			return "completed";
		case "running":
			return "running";
		default:
			return "idle";
	}
}

function statusLabel(status: AgentTrajectoryStatus, tone: AgentProcessTone): string {
	if (tone === "reconnecting") {
		return "恢复中";
	}
	switch (status) {
		case "waiting_for_approval":
			return "等待确认";
		case "waiting_for_user":
			return "等待回复";
		case "failed":
			return "运行遇到问题";
		case "cancelled":
			return "已停止";
		case "safe_stopped":
			return "已安全停止";
		case "completed":
			return "已完成";
		case "running":
			return "执行中";
		default:
			return "空闲";
	}
}

function headerLabel(snapshot: AgentTrajectorySnapshot, mode: AgentProcessPanelMode): string {
	if (mode === "simple_thinking") {
		return snapshot.status === "running" ? "FRIDAY 思考中" : "FRIDAY 的思路";
	}
	return "FRIDAY 的工作过程";
}

function headerHeadline(
	snapshot: AgentTrajectorySnapshot,
	mode: AgentProcessPanelMode,
	triggerReason: AgentProcessTriggerReason | null,
	durationSeconds: number,
): string {
	if (mode === "simple_thinking") {
		return snapshot.status === "running" ? "FRIDAY 思考中" : "FRIDAY 已思考";
	}
	if (snapshot.status === "completed") {
		return "FRIDAY 已完成工作";
	}
	const label = triggerReason === "context_activity" || triggerReason === "memory_activity"
		? "FRIDAY 的思路"
		: "FRIDAY 的工作过程";
	return `${label} ${durationSeconds}s`;
}

function headerSummary(snapshot: AgentTrajectorySnapshot, visibleSteps: AgentProcessStepView[]): string {
	if (snapshot.status === "waiting_for_approval") {
		const waitingStep = visibleSteps.find((step) => step.status === "waiting_for_approval");
		return shortText(waitingStep?.summary || "文件改动待审核。");
	}
	const latestTransportStep = [...visibleSteps].reverse().find((step) => step.id.includes(":transport:"));
	if (latestTransportStep) {
		return retryTimelineSummaryForStep(latestTransportStep);
	}
	const summary = snapshotProcessSummary(snapshot) || visibleSteps.at(-1)?.summary || "";
	if (snapshot.status === "failed") {
		return shortText(sanitizeFailedRequestSummary(summary));
	}
	return shortText(sanitizeTimelineSummary(summary));
}

function snapshotProcessHeadline(snapshot: AgentTrajectorySnapshot): string {
	const headline = sanitizeTimelineSummary(snapshot.headline || "");
	return isStageReportSnapshotText(snapshot, headline) ? "" : headline;
}

function snapshotProcessSummary(snapshot: AgentTrajectorySnapshot): string {
	const summary = sanitizeTimelineSummary(snapshot.summary || "");
	return isStageReportSnapshotText(snapshot, summary) ? "" : summary;
}

function isStageReportSnapshotText(snapshot: AgentTrajectorySnapshot, value: string): boolean {
	const normalizedValue = normalizeTimelineDedupeText(value);
	if (!normalizedValue) {
		return false;
	}
	return snapshot.items
		.filter(isStageReportNarrationItem)
		.flatMap((item) => [
			item.title,
			item.detail,
			item.narrationJustDone,
			item.narrationNext,
		])
		.map((text) => normalizeTimelineDedupeText(text ?? ""))
		.filter(Boolean)
		.some((text) => text === normalizedValue || text.includes(normalizedValue) || normalizedValue.includes(text));
}

interface TimelineBuildContext {
	mode: AgentProcessPanelMode;
	surface: AgentProcessSurface;
	triggerReason: AgentProcessTriggerReason | null;
	interactionRoute: AgentProcessInteractionRoute | null;
	durationSeconds: number;
	visibleSteps: AgentProcessStepView[];
	actions: AgentProcessActionView[];
	resultArtifacts: AgentProcessArtifactView[];
	diffSummary: AgentProcessDiffSummaryView | null;
	recovery: AgentProcessRecoveryView | null;
}

function buildTimelineView(
	snapshot: AgentTrajectorySnapshot,
	_options: BuildAgentProcessPanelViewModelOptions,
	context: TimelineBuildContext,
): AgentProcessTimelineView | null {
	if (context.surface === "hidden") {
		return null;
	}
	const status = timelineStatus(snapshot, context);
	if (context.mode === "simple_thinking" && snapshot.status === "completed") {
		return {
			title: completedTimelineTitle("FRIDAY 已思考", context.durationSeconds),
			status,
			defaultExpanded: false,
			canExpand: false,
			statusBar: null,
			groups: [],
			items: [],
			actions: [],
			finalArtifacts: context.resultArtifacts,
			diffSummary: context.diffSummary,
		};
	}
	if (status === "thinking") {
		return {
			title: "FRIDAY 思考中",
			status,
			defaultExpanded: false,
			canExpand: false,
			collapsedSummary: shortText(snapshotProcessSummary(snapshot) || "正在整理回答。"),
			statusBar: null,
			groups: [],
			items: [],
			actions: [],
			finalArtifacts: context.resultArtifacts,
			diffSummary: context.diffSummary,
		};
	}
	const items = compactRepeatedContextTimelineItems(buildTimelineItems(snapshot, context));
	const actions = buildTimelineActions(context.actions, status);
	const groups = buildTimelineGroups(items, status);
	return {
		title: timelineTitle(status, context.durationSeconds),
		status,
		defaultExpanded: timelineDefaultExpanded(status, context.interactionRoute),
		canExpand: items.length > 0,
		collapsedSummary: collapsedTimelineSummary(snapshot, context, status, items),
		statusBar: buildTimelineStatusBar(snapshot, groups, status, context.durationSeconds),
		groups,
		items,
		actions,
		finalArtifacts: context.resultArtifacts,
		diffSummary: context.diffSummary,
	};
}

function buildComposerTaskBar(
	snapshot: AgentTrajectorySnapshot,
	durationSeconds: number,
): AgentComposerTaskBarView | null {
	const plan = composerTaskBarPlan(snapshot);
	if (!plan) {
		return null;
	}
	const currentTask = plan.tasks.find((task) => task.id === plan.currentTaskId) ??
		plan.tasks.find((task) => task.status === "in_progress") ??
		plan.tasks.at(-1);
	if (!currentTask) {
		return null;
	}
	const currentIndex = Math.max(1, plan.tasks.findIndex((task) => task.id === currentTask.id) + 1);
	return {
		collapsed: {
			statusLabel: composerTaskBarStatusLabel(snapshot.status, plan.status),
			stepLabel: `${currentIndex}/${plan.tasks.length}`,
			taskTitle: currentTask.title,
			elapsed: formatDuration(durationSeconds),
		},
		expandedTasks: plan.tasks.map((task, index) => ({
			id: task.id,
			index: index + 1,
			title: task.title,
			status: task.status,
		})),
		actionSlot: null,
	};
}

type ComposerTaskBarPlan = NonNullable<AgentTrajectorySnapshot["plan"]>;

function composerTaskBarPlan(snapshot: AgentTrajectorySnapshot): ComposerTaskBarPlan | null {
	const plan = snapshot.plan;
	if (!plan || !isTaskBarPlanVisibility(plan.visibility) || plan.tasks.length === 0) {
		return null;
	}
	if (
		snapshot.privacy.source === "live" &&
		snapshot.planSource &&
		snapshot.planSource !== "model" &&
		snapshot.planSource !== "legacy"
	) {
		return null;
	}
	if (snapshot.status === "running") {
		return coercePlanRunning(plan);
	}
	if (snapshot.status === "failed") {
		return coercePlanFailed(plan);
	}
	return plan;
}

function coercePlanRunning(plan: ComposerTaskBarPlan): ComposerTaskBarPlan {
	if (plan.status !== "completed" && plan.tasks.some((task) => task.status === "in_progress" || task.status === "blocked")) {
		return plan;
	}
	const currentTaskId = selectCurrentPlanTaskId(plan);
	if (!currentTaskId) {
		return { ...plan, status: "running", completedAt: undefined };
	}
	return {
		...plan,
		status: "running",
		currentTaskId,
		completedAt: undefined,
		tasks: plan.tasks.map((task) =>
			task.id === currentTaskId && task.status !== "blocked"
				? { ...task, status: "in_progress", completedAt: undefined }
				: task
		),
	};
}

function coercePlanFailed(plan: ComposerTaskBarPlan): ComposerTaskBarPlan {
	if (plan.status === "failed" || plan.tasks.some((task) => task.status === "failed")) {
		return plan;
	}
	const currentTaskId = selectCurrentPlanTaskId(plan);
	if (!currentTaskId) {
		return { ...plan, status: "failed", completedAt: undefined };
	}
	return {
		...plan,
		status: "failed",
		currentTaskId,
		completedAt: undefined,
		tasks: plan.tasks.map((task) =>
			task.id === currentTaskId && task.status !== "blocked"
				? { ...task, status: "failed", completedAt: undefined }
				: task
		),
	};
}

function selectCurrentPlanTaskId(plan: ComposerTaskBarPlan): string {
	return plan.currentTaskId ||
		plan.tasks.find((task) => task.status === "in_progress")?.id ||
		plan.tasks.find((task) => task.status === "blocked")?.id ||
		plan.tasks.find((task) => task.status === "pending")?.id ||
		plan.tasks.at(-1)?.id ||
		"";
}

function isTaskBarPlanVisibility(visibility: NonNullable<AgentTrajectorySnapshot["plan"]>["visibility"]): boolean {
	return visibility === "task_bar" || visibility === "visible";
}

function composerTaskBarStatusLabel(
	snapshotStatus: AgentTrajectoryStatus,
	planStatus: NonNullable<AgentTrajectorySnapshot["plan"]>["status"],
): string {
	if (snapshotStatus === "failed" || planStatus === "failed") {
		return "运行异常";
	}
	if (snapshotStatus === "completed" || planStatus === "completed") {
		return "已完成";
	}
	if (snapshotStatus === "cancelled") {
		return "已停止";
	}
	return "正在执行";
}

function hasRecoverableToolWarning(snapshot: AgentTrajectorySnapshot): boolean {
	const hasToolFailure = snapshot.items.some((item) =>
		item.kind === "tool" && (item.status === "failed" || item.status === "denied")
	);
	const hasContinuingWork = snapshot.items.some((item) => item.status === "running" || item.status === "waiting");
	return hasToolFailure && hasContinuingWork;
}

function timelineStatus(
	snapshot: AgentTrajectorySnapshot,
	context: TimelineBuildContext,
): AgentProcessTimelineStatus {
	if (snapshot.status === "waiting_for_approval" || snapshot.status === "waiting_for_user" || context.triggerReason === "mutation_review") {
		return "waiting";
	}
	if (context.triggerReason === "transport_retry" && snapshot.status === "running") {
		return "retrying";
	}
	if (snapshot.status === "running" && hasRecoverableToolWarning(snapshot)) {
		return "recovering";
	}
	if (snapshot.status === "cancelled") {
		return "cancelled";
	}
	if (snapshot.status === "failed" || snapshot.status === "safe_stopped" || context.recovery) {
		return "failed";
	}
	if (snapshot.status === "completed") {
		return "completed";
	}
	if (snapshot.status === "running") {
		return context.mode === "simple_thinking" ? "thinking" : "running";
	}
	return "hidden";
}

function timelineTitle(status: AgentProcessTimelineStatus, durationSeconds: number): string {
	const duration = formatDuration(durationSeconds);
	switch (status) {
		case "recovering":
			return `执行遇到问题，正在换一种方式继续 · ${duration}`;
		case "completed":
			return completedTimelineTitle("FRIDAY 已完成工作", durationSeconds);
		case "waiting":
			return "等待确认";
		case "retrying":
			return `正在恢复请求 ${duration}`;
		case "failed":
			return "运行遇到问题";
		case "cancelled":
			return "已停止处理";
		case "running":
			return `正在处理 ${duration}`;
		case "thinking":
			return "FRIDAY 思考中";
		default:
			return "FRIDAY";
	}
}

function timelineDefaultExpanded(
	status: AgentProcessTimelineStatus,
	_interactionRoute: AgentProcessInteractionRoute | null,
): boolean {
	if (status === "waiting" || status === "retrying" || status === "recovering") {
		return true;
	}
	return status === "running";
}

function collapsedTimelineSummary(
	snapshot: AgentTrajectorySnapshot,
	context: TimelineBuildContext,
	status: AgentProcessTimelineStatus,
	items: AgentProcessTimelineItemView[],
): string {
	if (status === "waiting") {
		return pendingMutationSummary(snapshot) || "FRIDAY 需要你确认后继续。";
	}
	if (status === "retrying") {
		return retrySummaryFromItems(items);
	}
	if (status === "recovering") {
		return "执行遇到问题，正在换一种方式继续。";
	}
	if (status === "failed") {
		return sanitizeTimelineSummary(context.recovery?.summary || snapshot.failure?.message || snapshotProcessSummary(snapshot) || "运行遇到问题，可以重试。");
	}
	if (status === "cancelled") {
		return "已停止本次任务。";
	}
	if (status === "completed") {
		return "";
	}
	return sanitizeTimelineSummary(items.find((item) => item.status === "running")?.summary || snapshotProcessSummary(snapshot) || items.at(-1)?.summary || "");
}

function completedTimelineTitle(label: string, durationSeconds: number): string {
	return durationSeconds > 0 ? `${label} · ${formatDuration(durationSeconds)}` : label;
}

function retrySummaryFromItems(items: AgentProcessTimelineItemView[]): string {
	const retryItem = [...items].reverse().find((item) => item.kind === "retry");
	return retryItem?.summary || "网络波动，正在恢复请求（第 1/5 次）";
}

function buildTimelineItems(
	snapshot: AgentTrajectorySnapshot,
	context: TimelineBuildContext,
): AgentProcessTimelineItemView[] {
	const items: AgentProcessTimelineItemView[] = [];
	if (shouldAddReceiptItem(context)) {
		items.push({
			id: "timeline:receipt",
			kind: "receipt",
			status: "done",
			title: "收到任务",
			summary: receiptSummary(snapshot),
		});
	}
	for (const step of context.visibleSteps) {
		items.push(timelineItemFromStep(step, snapshot));
	}
	const annotatedItems = attachStageReportNotes(items, snapshot.items);
	if (snapshot.status === "completed" && context.visibleSteps.length > 0) {
		annotatedItems.push({
			id: "timeline:done",
			kind: "done",
			status: "done",
			title: "完成",
			summary: doneTimelineSummary(snapshot, context),
		});
	}
	return annotatedItems;
}

function attachStageReportNotes(
	items: AgentProcessTimelineItemView[],
	snapshotItems: AgentTrajectoryItem[],
): AgentProcessTimelineItemView[] {
	const stageEntries = snapshotItems
		.map((item, index) => ({ item, index }))
		.filter((entry) => isStageReportNarrationItem(entry.item));
	if (stageEntries.length === 0 || items.length === 0) {
		return items;
	}
	const sourceItemById = new Map(snapshotItems.map((item) => [item.id, item]));
	const sourceIndexById = new Map(snapshotItems.map((item, index) => [item.id, index]));
	let result = items;
	for (const stageEntry of stageEntries) {
		const text = stageReportNoteText(stageEntry.item);
		if (!text) {
			continue;
		}
		const targetIndex = findStageReportNoteTargetIndex(
			result,
			stageEntry.item,
			stageEntry.index,
			sourceItemById,
			sourceIndexById,
		);
		if (targetIndex < 0) {
			continue;
		}
		const target = result[targetIndex];
		if (!target) {
			continue;
		}
		if (target.notes?.some((note) => note.text === text)) {
			continue;
		}
		result = [...result];
		result[targetIndex] = {
			...target,
			notes: [
				...(target.notes ?? []),
				{
					id: `note:${stageEntry.item.id}`,
					text,
					tone: stageReportNoteTone(stageEntry.item.status),
				},
			],
		};
	}
	return result;
}

function findStageReportNoteTargetIndex(
	items: AgentProcessTimelineItemView[],
	stageItem: AgentTrajectoryItem,
	stageIndex: number,
	sourceItemById: Map<string, AgentTrajectoryItem>,
	sourceIndexById: Map<string, number>,
): number {
	const eligible = items
		.map((item, index) => ({ item, index, sourceItems: timelineSourceItems(item, sourceItemById) }))
		.filter((entry) => isStageReportNoteAnchor(entry.item));
	if (eligible.length === 0) {
		return -1;
	}
	if (stageItem.step !== undefined) {
		const sameStep = eligible.find((entry) => entry.sourceItems.some((item) => item.step === stageItem.step));
		if (sameStep) {
			return sameStep.index;
		}
	}
	const next = eligible.find((entry) =>
		entry.sourceItems.some((item) => (sourceIndexById.get(item.id) ?? Number.POSITIVE_INFINITY) > stageIndex)
	);
	if (next) {
		return next.index;
	}
	for (let index = eligible.length - 1; index >= 0; index -= 1) {
		const entry = eligible[index];
		if (!entry) {
			continue;
		}
		if (entry.sourceItems.some((item) => (sourceIndexById.get(item.id) ?? -1) < stageIndex)) {
			return entry.index;
		}
	}
	return -1;
}

function timelineSourceItems(
	item: AgentProcessTimelineItemView,
	sourceItemById: Map<string, AgentTrajectoryItem>,
): AgentTrajectoryItem[] {
	return (item.sourceItemIds ?? [])
		.map((id) => sourceItemById.get(id))
		.filter((sourceItem): sourceItem is AgentTrajectoryItem => Boolean(sourceItem));
}

function isStageReportNoteAnchor(item: AgentProcessTimelineItemView): boolean {
	return item.kind === "context" || item.kind === "tool_batch" || item.kind === "file_change";
}

function stageReportNoteText(item: AgentTrajectoryItem): string {
	const detail = productizeRuntimeText(item.detail || "");
	const progress = productizeRuntimeText([item.narrationJustDone, item.narrationNext].filter(Boolean).join(" "));
	const text = detail || progress;
	if (!text || /stage_report|narration_report|阶段性汇报/i.test(text)) {
		return "";
	}
	return sanitizeTimelineSummary(text);
}

function stageReportNoteTone(status: AgentTrajectoryItemStatus): AgentProcessTimelineNoteView["tone"] {
	if (status === "failed" || status === "denied" || status === "cancelled") {
		return "warning";
	}
	return status === "ok" ? "done" : "progress";
}

function buildTimelineGroups(
	items: AgentProcessTimelineItemView[],
	timelineStatusValue: AgentProcessTimelineStatus,
): AgentProcessTimelineGroupView[] {
	const groups = new Map<string, AgentProcessTimelineGroupView>();
	for (const item of items) {
		const id = timelineGroupIdForItem(item);
		let group = groups.get(id);
		if (!group) {
			group = {
				id,
				title: timelineGroupTitle(id),
				status: "pending",
				summary: "",
				defaultExpanded: false,
				items: [],
			};
			groups.set(id, group);
		}
		group.items.push(item);
	}
	const result = [...groups.values()].map((group) => ({
		...group,
		status: timelineGroupStatus(group.items),
		summary: timelineGroupSummary(group.items),
	}));
	void timelineStatusValue;
	return result;
}

function buildTimelineStatusBar(
	snapshot: AgentTrajectorySnapshot,
	groups: AgentProcessTimelineGroupView[],
	status: AgentProcessTimelineStatus,
	durationSeconds: number,
): AgentProcessTimelineStatusBarView | null {
	const currentTaskTitle = status === "completed" ? "" : currentVisiblePlanTaskTitle(snapshot);
	if (currentTaskTitle) {
		return {
			phase: "任务",
			action: currentTaskTitle,
			elapsed: formatDuration(durationSeconds),
			status,
		};
	}
	if (groups.length === 0) {
		return null;
	}
	const activeGroup = groups.find((group) =>
		group.status === "running" ||
		group.status === "waiting" ||
		group.status === "warning" ||
		group.status === "error"
	) ?? groups.at(-1);
	if (!activeGroup) {
		return null;
	}
	const activeItem = activeGroup.items.find((item) =>
		item.status === "running" ||
		item.status === "waiting" ||
		item.status === "warning" ||
		item.status === "error"
	) ?? activeGroup.items.at(-1);
	return {
		phase: activeGroup.title,
		action: activeItem?.title || activeGroup.summary || activeGroup.title,
		elapsed: formatDuration(durationSeconds),
		status,
	};
}

function currentVisiblePlanTaskTitle(snapshot: AgentTrajectorySnapshot): string {
	const plan = snapshot.plan;
	if (!plan || !isTaskBarPlanVisibility(plan.visibility) || plan.tasks.length === 0) {
		return "";
	}
	const currentTask = plan.tasks.find((task) => task.id === plan.currentTaskId) ??
		plan.tasks.find((task) => task.status === "in_progress") ??
		plan.tasks.find((task) => task.status === "blocked");
	return sanitizeTimelineSummary(currentTask?.title ?? "");
}

function timelineGroupIdForItem(item: AgentProcessTimelineItemView): string {
	switch (item.kind) {
		case "receipt":
			if (isIntakeReceiptTimelineItem(item)) {
				return "intake";
			}
			return "receipt";
		case "plan":
		case "reasoning":
			return "plan";
		case "approval":
		case "validation":
		case "blocked":
			return "check";
		case "done":
		case "finalizing":
			return "complete";
		default:
			return "execute";
	}
}

function timelineGroupTitle(id: string): string {
	switch (id) {
		case "intake":
			return "";
		case "receipt":
			return "收到任务";
		case "plan":
			return "计划";
		case "execute":
			return "执行";
		case "check":
			return "检查";
		case "complete":
			return "完成";
		default:
			return "执行";
	}
}

function timelineGroupStatus(items: AgentProcessTimelineItemView[]): AgentProcessTimelineItemStatus {
	if (items.some((item) => item.status === "running")) {
		return "running";
	}
	if (items.some((item) => item.status === "waiting")) {
		return "waiting";
	}
	if (items.some((item) => item.status === "error")) {
		return "error";
	}
	if (items.some((item) => item.status === "warning")) {
		return "warning";
	}
	if (items.length > 0 && items.every((item) => item.status === "done")) {
		return "done";
	}
	return "pending";
}

function timelineGroupSummary(items: AgentProcessTimelineItemView[]): string {
	if (items.length > 0 && items.every(isIntakeReceiptTimelineItem)) {
		return "";
	}
	const activeItem = items.find((item) => item.status === "running" || item.status === "waiting") ?? items.at(-1);
	return activeItem?.summary || activeItem?.title || "";
}

function isIntakeReceiptTimelineItem(item: AgentProcessTimelineItemView): boolean {
	return item.kind === "receipt" && item.summary === "" && item.title !== "收到任务";
}

function shouldAddReceiptItem(context: TimelineBuildContext): boolean {
	return context.mode !== "simple_thinking" &&
		context.visibleSteps.length > 0 &&
		!context.visibleSteps.some((step) => step.id.includes(":receipt:"));
}

function receiptSummary(snapshot: AgentTrajectorySnapshot): string {
	if (snapshot.status === "cancelled") {
		return "FRIDAY 已收到任务，开始按当前上下文处理。";
	}
	const summary = sanitizeTimelineSummary(snapshotProcessHeadline(snapshot) || snapshotProcessSummary(snapshot) || "");
	if (!summary || /^Agent\b/i.test(summary)) {
		return "FRIDAY 已收到任务，开始按当前上下文处理。";
	}
	return shortText(summary, 120);
}

function doneTimelineSummary(
	snapshot: AgentTrajectorySnapshot,
	context: TimelineBuildContext,
): string {
	if (context.resultArtifacts.length > 0) {
		return `本次已完成 ${context.resultArtifacts.length} 个文件产物。`;
	}
	return "本次工作已完成。";
}

function timelineItemFromStep(
	step: AgentProcessStepView,
	snapshot: AgentTrajectorySnapshot,
): AgentProcessTimelineItemView {
	const kind = timelineKindForStep(step);
	const status = timelineStatusForStep(step.status, kind);
	const title = timelineTitleForStep(step, kind);
	const summary = timelineSummaryForStep(step, snapshot, kind, status);
	const meta = timelineMetaForStep(step, kind);
	const detail = timelineDetailForStep(step, kind, [title, summary, meta]);
	const actionRefs = step.actions
		.filter((action) => action.kind === "control" && action.action)
		.map((action) => action.action?.id)
		.filter((value): value is AgentTrajectoryAction["id"] => Boolean(value));
	const artifactRefs = step.fileRefs.map((file) => file.path);
	return {
		id: `timeline:${step.id}`,
		kind,
		status,
		title,
		summary,
		...(meta ? { meta } : {}),
		...(detail ? { detail } : {}),
		sourceItemIds: step.actions.map((action) => action.id),
		...(artifactRefs.length > 0 ? { artifactRefs } : {}),
		...(actionRefs.length > 0 ? { actionRefs } : {}),
	};
}

function timelineKindForStep(step: AgentProcessStepView): AgentProcessTimelineItemKind {
	if (step.id.includes(":approval:") || step.status === "waiting_for_approval") {
		return "approval";
	}
	if (step.id.includes(":transport:")) {
		return "retry";
	}
	if (step.id.includes(":receipt:")) {
		return "receipt";
	}
	if (step.id.includes(":plan:")) {
		return "plan";
	}
	if (step.id.includes(":failure:")) {
		return "blocked";
	}
	if (step.id.includes(":file_change:")) {
		return "file_change";
	}
	if (step.id.includes(":reasoning:")) {
		return "reasoning";
	}
	if (step.id.includes(":context:")) {
		return "context";
	}
	return "tool_batch";
}

function isIntakeReceiptStep(step: AgentProcessStepView): boolean {
	return step.id.includes(":receipt:") &&
		(step.id.includes(":intake") || step.actions.some((action) => action.rawEventType === "intake_decision"));
}

function timelineStatusForStep(
	status: AgentProcessStepStatus,
	kind: AgentProcessTimelineItemKind,
): AgentProcessTimelineItemStatus {
	if (kind === "approval" || status === "waiting_for_approval") {
		return "waiting";
	}
	if (kind === "retry" && status !== "failed") {
		return status === "running" ? "running" : "warning";
	}
	switch (status) {
		case "running":
			return "running";
		case "completed":
			return "done";
		case "retryable":
		case "denied":
		case "cancelled":
			return "warning";
		case "failed":
			return "error";
		default:
			return "pending";
	}
}

function timelineTitleForStep(
	step: AgentProcessStepView,
	kind: AgentProcessTimelineItemKind,
): string {
	if (kind === "blocked" && step.status === "cancelled") {
		return "已停止处理";
	}
	if (kind === "receipt") {
		return step.title || "收到任务";
	}
	switch (kind) {
		case "context":
			return "读取项目现状";
		case "plan":
			return "整理方案";
		case "reasoning":
			return "整理方案";
		case "file_change":
			return "创建/修改文件";
		case "approval":
			return "等待确认";
		case "retry":
			return "恢复请求";
		case "blocked":
			return step.status === "retryable" ? "遇到可恢复问题" : "运行遇到问题";
		default:
			return "执行操作";
	}
}

function timelineSummaryForStep(
	step: AgentProcessStepView,
	snapshot: AgentTrajectorySnapshot,
	kind: AgentProcessTimelineItemKind,
	status: AgentProcessTimelineItemStatus,
): string {
	if (kind === "approval") {
		return pendingMutationSummary(snapshot) || "FRIDAY 需要你确认后继续。";
	}
	if (kind === "retry") {
		return retryTimelineSummaryForStep(step);
	}
	if (kind === "context") {
		const fileCount = step.fileRefs.length;
		if (fileCount > 0) {
			return fileCount === 1 ? "已查看相关文件和项目上下文。" : `已查看 ${fileCount} 个相关文件和项目上下文。`;
		}
		return sanitizeTimelineSummary(step.summary || "已读取项目上下文。");
	}
	if (kind === "receipt") {
		const summary = sanitizeTimelineSummary(step.summary);
		return isIntakeReceiptStep(step) && normalizeTimelineDedupeText(step.title) === normalizeTimelineDedupeText(summary)
			? ""
			: summary;
	}
	if (kind === "plan") {
		return sanitizeTimelineSummary(step.summary);
	}
	if (kind === "reasoning") {
		return reasoningTimelineSummary(step.summary);
	}
	if (kind === "file_change") {
		const fileCount = step.fileRefs.length;
		if (status === "done") {
			return fileCount > 0 ? `已完成 ${fileCount} 个文件改动。` : sanitizeTimelineSummary(step.summary || "已完成文件改动。");
		}
		return fileCount > 0 ? `已准备 ${fileCount} 个文件改动。` : sanitizeTimelineSummary(step.summary || "已准备文件改动。");
	}
	return sanitizeTimelineSummary(step.summary);
}

function pendingMutationCountForSnapshot(snapshot: AgentTrajectorySnapshot): number {
	return activePlannedMutations(snapshot.mutations).length;
}

function pendingMutationSummary(snapshot: AgentTrajectorySnapshot): string {
	const count = pendingMutationCountForSnapshot(snapshot);
	return count > 0 ? `已准备好 ${count} 个待应用的文件修改，确认后才会写入 Obsidian。` : "";
}

function activePlannedMutations(mutations: AgentTrajectorySnapshot["mutations"]): AgentTrajectorySnapshot["mutations"] {
	const resolvedIds = new Set(mutations
		.filter((mutation) => mutation.event !== "planned" && Boolean(mutation.id))
		.map((mutation) => mutation.id));
	return mutations.filter((mutation) =>
		mutation.event === "planned" &&
		(!mutation.id || !resolvedIds.has(mutation.id))
	);
}

function reasoningTimelineSummary(summary: string): string {
	const sanitized = sanitizeTimelineSummary(summary);
	if (!sanitized || /received model reasoning/i.test(sanitized)) {
		return "FRIDAY 已整理当前判断。";
	}
	const sentences = sanitized.split(/(?<=[。.!?])\s+/).filter(Boolean).slice(0, 2);
	return sentences.join(" ") || sanitized;
}

function timelineMetaForStep(step: AgentProcessStepView, kind: AgentProcessTimelineItemKind): string {
	if (kind === "context") {
		const commandCount = step.actions.filter((action) => action.kind === "event").length;
		return commandCount > 0 ? `已运行 ${commandCount} 条命令` : "";
	}
	if (kind === "retry") {
		return retryAttemptMeta(step.summary);
	}
	if (kind === "file_change" && step.fileRefs.length > 0) {
		return `${step.fileRefs.length} 个文件`;
	}
	return "";
}

function retryAttemptMeta(value: string): string {
	const attempt = parseRetryAttempt(value);
	if (!attempt) {
		return "";
	}
	return `第 ${attempt}/${USER_VISIBLE_RETRY_LIMIT} 次`;
}

function timelineDetailForStep(
	step: AgentProcessStepView,
	kind: AgentProcessTimelineItemKind,
	visibleTexts: string[] = [],
): AgentProcessTimelineDetailView | undefined {
	const lines: string[] = [];
	const visible = new Set(visibleTexts.map(normalizeTimelineDedupeText).filter(Boolean));
	for (const action of step.actions) {
		if (action.kind !== "event") {
			continue;
		}
		const rawLines = (action.detail || action.label).split(/\r?\n/);
		for (const rawLine of rawLines) {
			const line = sanitizeTimelineDetail(rawLine, kind);
			const normalized = normalizeTimelineDedupeText(line);
			if (line && normalized && !visible.has(normalized) && !lines.some((item) => normalizeTimelineDedupeText(item) === normalized)) {
				lines.push(line);
			}
		}
	}
	for (const file of step.fileRefs) {
		const normalized = normalizeTimelineDedupeText(file.path);
		if (normalized && !visible.has(normalized) && !lines.some((item) => normalizeTimelineDedupeText(item) === normalized)) {
			lines.push(file.path);
		}
	}
	if (lines.length === 0) {
		return undefined;
	}
	return {
		title: "技术细节",
		lines: lines.slice(0, 6),
		initiallyExpanded: false,
	};
}

function sanitizeTimelineDetail(value: string, kind: AgentProcessTimelineItemKind): string {
	if (kind === "retry") {
		return retryRecoverySummary(value);
	}
	if (kind === "approval" && normalizeFileMutationStatusText(value)) {
		return "";
	}
	if (/Context package built before|context_ready/i.test(value)) {
		return "";
	}
	return sanitizeTimelineSummary(value);
}

function sanitizeTimelineSummary(value: string): string {
	const text = shortText(value, 140);
	if (!text) {
		return "";
	}
	const productText = productizeRuntimeText(text);
	if (productText && productText !== text) {
		return productText;
	}
	if (!productText && /checkpoint|model_request|model request|replay|debug/i.test(text)) {
		return "FRIDAY 正在整理当前进度。";
	}
	if (/Context package built before|context_ready/i.test(text)) {
		return "已整理上下文，准备进入下一步。";
	}
	if (/received model reasoning/i.test(text)) {
		return "FRIDAY 已整理当前判断。";
	}
	if (/^Listed\s+\d+\s+item/i.test(text)) {
		return "已查看目录内容。";
	}
	if (/^Tool requested\.?$/i.test(text)) {
		return "正在执行操作。";
	}
	const fileMutationStatusText = normalizeFileMutationStatusText(text);
	if (fileMutationStatusText) {
		return fileMutationStatusText;
	}
	if (/task failed/i.test(text)) {
		return "运行遇到问题。";
	}
	if (isRequestExhaustedText(text)) {
		return REQUEST_EXHAUSTED_COPY;
	}
	if (/HTTP\s+\d+|status\s+\d+|backoff|request id|gateway|transport/i.test(text)) {
		return REQUEST_EXHAUSTED_COPY;
	}
	return text;
}

function normalizeFileMutationStatusText(text: string): string {
	if (
		/Waiting for review of\s+\d+\s+pending file change\(s\)/i.test(text) ||
		/Review pending file changes/i.test(text) ||
		/Pending file changes/i.test(text) ||
		/\b\d+\s+file changes?\s+pending review\b/i.test(text) ||
		/Prepared\b.*\bfile (creation|update|deletion|change)\b.*\b(review|confirmation)/i.test(text)
	) {
		return "已准备好文件修改，确认后才会写入 Obsidian。";
	}
	if (/Applied file creation/i.test(text)) {
		return "已应用文件创建。";
	}
	if (/Applied file (update|change)/i.test(text)) {
		return "已应用文件修改。";
	}
	if (/Applied file deletion/i.test(text)) {
		return "已应用文件删除。";
	}
	if (/Rejected file/i.test(text)) {
		return "已取消文件修改，文件未被写入。";
	}
	return "";
}

function retryTimelineSummaryForStep(step: AgentProcessStepView): string {
	const event = retryEventFromStep(step);
	const rawText = retryRawTextForStep(step);
	if (event === "request_exhausted" || step.status === "failed" || isRequestExhaustedText(rawText)) {
		return REQUEST_EXHAUSTED_COPY;
	}
	if (event === "retry_scheduled" || event === "retry_started" || isRetryRecoveryText(rawText)) {
		return retryRecoverySummary(rawText);
	}
	return retryRecoverySummary(step.summary);
}

function transportSummaryForItems(items: AgentTrajectoryItem[]): string {
	const event = transportEventFromItems(items);
	const rawText = items.map((item) => `${item.detail || ""} ${item.title || ""}`).join(" ");
	if (event === "request_exhausted" || items.some((item) => item.status === "failed") || isRequestExhaustedText(rawText)) {
		return REQUEST_EXHAUSTED_COPY;
	}
	if (event === "retry_scheduled" || event === "retry_started" || isRetryRecoveryText(rawText)) {
		return retryRecoverySummary(rawText);
	}
	return sanitizeTimelineSummary(firstMeaningfulDetail(items));
}

function transportEventFromItems(items: AgentTrajectoryItem[]): string {
	return [...items].reverse().find((item) =>
		item.rawEventType === "retry_scheduled" ||
		item.rawEventType === "retry_started" ||
		item.rawEventType === "request_exhausted"
	)?.rawEventType || "";
}

function retryEventFromStep(step: AgentProcessStepView): string {
	return step.actions.find((action) =>
		action.rawEventType === "retry_scheduled" ||
		action.rawEventType === "retry_started" ||
		action.rawEventType === "request_exhausted"
	)?.rawEventType || "";
}

function retryRawTextForStep(step: AgentProcessStepView): string {
	return [
		step.summary,
		...step.actions.map((action) => `${action.detail} ${action.label}`),
	].join(" ");
}

function retryRecoverySummary(value: string): string {
	const attempt = parseRetryAttempt(value) || 1;
	return `${RETRY_RECOVERY_COPY_PREFIX}（第 ${attempt}/${USER_VISIBLE_RETRY_LIMIT} 次）`;
}

function parseRetryAttempt(value: string): number | null {
	const text = cleanText(value);
	const match = text.match(/attempt\s+(\d+)\s*\/\s*\d+/i) ??
		text.match(/第\s*(\d+)\s*\/\s*\d+\s*次/) ??
		text.match(/第\s*(\d+)\s*次/);
	if (!match) {
		return null;
	}
	const attempt = Number.parseInt(match[1] || "", 10);
	if (!Number.isFinite(attempt)) {
		return null;
	}
	return Math.min(USER_VISIBLE_RETRY_LIMIT, Math.max(1, attempt));
}

function isRetryRecoveryText(value: string): boolean {
	return /attempt\s+\d+\s*\/\s*\d+|第\s*\d+\s*\/\s*\d+\s*次|backoff|retry_scheduled|retry_started/i.test(value) ||
		(value.includes("模型连接") && value.includes("不稳定"));
}

function isRequestExhaustedText(value: string): boolean {
	return /request[_\s-]*exhausted|max(?:imum)? retries exhausted|exhausted retries|after attempt\s+\d+\s*\/\s*\d+/i.test(value);
}

function sanitizeFailedRequestSummary(value: string): string {
	const text = cleanText(value);
	if (isRequestExhaustedText(text) || /HTTP\s+\d+|status\s+\d+|backoff|request id|gateway|transport/i.test(text)) {
		return REQUEST_EXHAUSTED_COPY;
	}
	return text;
}

function normalizeTimelineDedupeText(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[。.!?]+$/g, "")
		.replace(/\s+/g, " ");
}

function compactRepeatedContextTimelineItems(
	items: AgentProcessTimelineItemView[],
): AgentProcessTimelineItemView[] {
	const compacted: AgentProcessTimelineItemView[] = [];
	let activeContext: AgentProcessTimelineItemView | null = null;
	let activeBatches = 0;
	let activeCommands = 0;
	for (const item of items) {
		if (item.kind === "context") {
			const commandCount = contextCommandCount(item);
			if (!activeContext) {
				activeContext = { ...item };
				activeBatches = 1;
				activeCommands = commandCount;
				compacted.push(activeContext);
				continue;
			}
			activeBatches += 1;
			activeCommands += commandCount;
			mergeContextTimelineItem(activeContext, item, activeBatches, activeCommands);
			continue;
		}
		compacted.push(item);
		activeContext = null;
		activeBatches = 0;
		activeCommands = 0;
	}
	return compacted;
}

function mergeContextTimelineItem(
	target: AgentProcessTimelineItemView,
	item: AgentProcessTimelineItemView,
	batches: number,
	commands: number,
): void {
	target.status = mergeTimelineStatus(target.status, item.status);
	target.summary = `已合并 ${batches} 批项目现状读取。`;
	target.meta = commands > 0 ? `已运行 ${commands} 条命令` : `${batches} 批`;
	target.artifactRefs = mergeUnique([...(target.artifactRefs ?? []), ...(item.artifactRefs ?? [])]);
	target.actionRefs = mergeUnique([...(target.actionRefs ?? []), ...(item.actionRefs ?? [])]);
	target.sourceItemIds = mergeUnique([...(target.sourceItemIds ?? []), ...(item.sourceItemIds ?? [])]);
	target.notes = mergeTimelineNotes(target.notes, item.notes);
	target.detail = mergeTimelineDetails(target.detail, item.detail);
}

function mergeTimelineNotes(
	current: AgentProcessTimelineNoteView[] | undefined,
	next: AgentProcessTimelineNoteView[] | undefined,
): AgentProcessTimelineNoteView[] | undefined {
	const notes = [...(current ?? [])];
	for (const note of next ?? []) {
		if (!notes.some((entry) => entry.id === note.id || entry.text === note.text)) {
			notes.push(note);
		}
	}
	return notes.length > 0 ? notes : undefined;
}

function contextCommandCount(item: AgentProcessTimelineItemView): number {
	const match = item.meta?.match(/\d+/);
	if (match) {
		return Number(match[0]);
	}
	return 1;
}

function mergeTimelineStatus(
	current: AgentProcessTimelineItemStatus,
	next: AgentProcessTimelineItemStatus,
): AgentProcessTimelineItemStatus {
	if (current === "error" || next === "error") {
		return "error";
	}
	if (current === "waiting" || next === "waiting") {
		return "waiting";
	}
	if (current === "running" || next === "running") {
		return "running";
	}
	if (current === "warning" || next === "warning") {
		return "warning";
	}
	return current === "done" || next === "done" ? "done" : "pending";
}

function mergeTimelineDetails(
	current: AgentProcessTimelineDetailView | undefined,
	next: AgentProcessTimelineDetailView | undefined,
): AgentProcessTimelineDetailView | undefined {
	const lines = mergeUnique([...(current?.lines ?? []), ...(next?.lines ?? [])].filter(Boolean));
	if (lines.length === 0) {
		return current ?? next;
	}
	return {
		title: current?.title ?? next?.title,
		lines,
		initiallyExpanded: Boolean(current?.initiallyExpanded || next?.initiallyExpanded),
	};
}

function mergeUnique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function buildTimelineActions(
	actions: AgentProcessActionView[],
	status: AgentProcessTimelineStatus,
): AgentProcessTimelineActionView[] {
	if (status === "waiting") {
		return [];
	}
	if (status !== "failed") {
		return [];
	}
	const hasFileChangeDecision = actions.some((action) => action.id === "apply" || action.id === "view_changes");
	return actions
		.filter((action) =>
			action.id === "resume" ||
			action.id === "retry" ||
			action.id === "continue"
		)
		.map((action) => ({
			id: action.id,
			label: timelineActionLabel(action, hasFileChangeDecision),
			enabled: action.enabled,
			tone: action.tone,
			...(action.targetId ? { targetId: action.targetId } : {}),
			...(action.reason ? { reason: action.reason } : {}),
		}));
}

function timelineActionLabel(action: AgentProcessActionView, hasFileChangeDecision: boolean): string {
	if (action.id === "approve") {
		return "允许执行";
	}
	if (action.id === "apply") {
		return "应用修改";
	}
	if (action.id === "reject") {
		return hasFileChangeDecision ? "不应用" : "拒绝";
	}
		return productizeActionLabel(action.id, action.label);
	}

function buildVisibleSteps(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
	actions: AgentProcessActionView[],
	recovery: AgentProcessRecoveryView | null,
	interactionRoute: AgentProcessInteractionRoute | null,
): AgentProcessStepView[] {
	if (isSimpleCompletedLifecycleReplay(snapshot, visibleItems)) {
		return [];
	}
	if (isQuietInteractionRoute(interactionRoute) && !hasNontrivialProcessEvidence(snapshot, visibleItems)) {
		return [];
	}
	if (!hasVisibleProcessTrigger(snapshot, visibleItems)) {
		return [];
	}
	const items = coalesceReceiptItems(enrichItemsFromSnapshot(snapshot, visibleItems));
	const builders: StepBuilder[] = [];
	for (const item of items) {
		if (item.kind === "final") {
			continue;
		}
		const key = semanticStepKey(item);
		const previous = builders.at(-1);
		const shouldStartNewStep = !previous || previous.key !== key || shouldSplitStep(previous, item, key);
		const builder = shouldStartNewStep ? createStepBuilder(key, item) : previous;
		if (shouldStartNewStep) {
			builders.push(builder);
		}
		builder.items.push(item);
		addItemFileRef(builder, item);
		addItemEvidence(builder, item);
	}
	if (snapshot.failure && !builders.some((builder) => builder.key === "failure")) {
		const failureItem = failureToItem(snapshot);
		const builder = createStepBuilder("failure", failureItem);
		builder.items.push(failureItem);
		builders.push(builder);
	}
	return builders
		.map((builder) => finalizeStepBuilder(builder, snapshot, actions, recovery))
		.filter((step) => step.actions.length > 0 || step.fileRefs.length > 0 || step.status !== "completed");
}

function coalesceReceiptItems(items: AgentTrajectoryItem[]): AgentTrajectoryItem[] {
	const hasIntake = items.some((item) => item.kind === "intake");
	if (!hasIntake) {
		return items;
	}
	let keptIntake = false;
	return items.filter((item) => {
		if (item.kind === "intake") {
			if (keptIntake) {
				return false;
			}
			keptIntake = true;
			return true;
		}
		return !isTaskAcknowledgementItem(item);
	});
}

function isTaskAcknowledgementItem(item: AgentTrajectoryItem): boolean {
	return item.kind === "narration" && item.narrationKind === "task_acknowledged";
}

function isStageReportNarrationItem(item: AgentTrajectoryItem): boolean {
	return item.kind === "narration" && item.narrationKind === "stage_report";
}

function hasVisibleProcessTrigger(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
): boolean {
	if (snapshot.failure || snapshot.mutations.length > 0) {
		return true;
	}
	return visibleItems.some(isVisibleProcessTriggerItem);
}

function isVisibleProcessTriggerItem(item: AgentTrajectoryItem): boolean {
	return (
		item.kind === "intake" ||
		item.kind === "context" ||
		item.kind === "reasoning" ||
		item.kind === "narration" ||
		item.kind === "tool" ||
		item.kind === "approval" ||
		item.kind === "mutation" ||
		item.kind === "transport" ||
		item.kind === "failure" ||
		item.kind === "system" ||
		Boolean(item.targetPath) ||
		Boolean(item.evidenceRef) ||
		item.rawEventType === "memory"
	);
}

function isSimpleCompletedLifecycleReplay(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
): boolean {
	if (snapshot.status !== "completed" || snapshot.failure || snapshot.mutations.length > 0) {
		return false;
	}
	if (snapshot.actions.some((action) => action.id !== "view_replay")) {
		return false;
	}
	if (snapshot.plan && isTaskBarPlanVisibility(snapshot.plan.visibility) && snapshot.plan.tasks.length > 0) {
		return false;
	}
	const processItems = visibleItems.filter((item) => item.kind !== "final" && isVisibleProcessTriggerItem(item));
	return processItems.length > 0 && processItems.every(isGenericCompletedLifecycleItem);
}

function isGenericCompletedLifecycleItem(item: AgentTrajectoryItem): boolean {
	if (item.kind === "narration") {
		return isGenericLifecycleNarration(item);
	}
	if (item.kind === "reasoning") {
		return isGenericLifecycleReasoning(item);
	}
	if (item.kind === "context" || item.kind === "system") {
		return isGenericLifecycleContext(item);
	}
	if (item.kind === "intake") {
		return isGenericLifecycleReceiptText(lifecycleItemText(item));
	}
	return false;
}

function isGenericLifecycleNarration(item: AgentTrajectoryItem): boolean {
	const text = lifecycleItemText(item);
	if (item.narrationKind === "task_acknowledged") {
		return isGenericLifecycleReceiptText(text);
	}
	if (item.narrationKind === "plan_declared") {
		return isGenericLifecycleReasoningText(text);
	}
	if (item.narrationKind === "stage_report") {
		return isGenericLifecycleContextText(text);
	}
	return isGenericLifecycleReceiptText(text) ||
		isGenericLifecycleReasoningText(text) ||
		isGenericLifecycleContextText(text);
}

function isGenericLifecycleReceiptText(text: string): boolean {
	return /FRIDAY\s*已收到任务/.test(text) ||
		/开始按当前上下文处理/.test(text) ||
		/^收到任务[。.!?]?$/.test(text);
}

function isGenericLifecycleReasoning(item: AgentTrajectoryItem): boolean {
	if (Boolean(item.reasoningProvider) || Boolean(item.reasoningRawFormat)) {
		return true;
	}
	return isGenericLifecycleReasoningText(lifecycleItemText(item));
}

function isGenericLifecycleReasoningText(text: string): boolean {
	return /received model reasoning/i.test(text) ||
		/FRIDAY\s*已整理当前判断/.test(text);
}

function isGenericLifecycleContext(item: AgentTrajectoryItem): boolean {
	return isGenericLifecycleContextText(lifecycleItemText(item));
}

function isGenericLifecycleContextText(text: string): boolean {
	return /Context package built before|context_ready|native model request/i.test(text) ||
		/已整理上下文，准备进入下一步/.test(text);
}

function lifecycleItemText(item: AgentTrajectoryItem): string {
	return cleanText(`${item.title || ""} ${item.detail || ""}`).replace(/\s+/g, " ");
}

interface StepBuilder {
	key: AgentProcessStepKey;
	id: string;
	items: AgentTrajectoryItem[];
	fileRefs: Map<string, AgentProcessFileRefView>;
	evidence: Map<string, AgentProcessEvidenceView>;
}

function createStepBuilder(key: AgentProcessStepKey, item: AgentTrajectoryItem): StepBuilder {
	return {
		key,
		id: `step:${key}:${item.id}`,
		items: [],
		fileRefs: new Map(),
		evidence: new Map(),
	};
}

function shouldSplitStep(previous: StepBuilder, item: AgentTrajectoryItem, key: AgentProcessStepKey): boolean {
	if (key === "receipt" || key === "plan") {
		return true;
	}
	if (key === "approval" || key === "failure" || key === "transport") {
		return true;
	}
	if (key === "file_change" && previous.items.some((entry) => semanticStepKey(entry) !== "file_change")) {
		return true;
	}
	return false;
}

function finalizeStepBuilder(
	builder: StepBuilder,
	snapshot: AgentTrajectorySnapshot,
	actions: AgentProcessActionView[],
	recovery: AgentProcessRecoveryView | null,
): AgentProcessStepView {
	const status = deriveStepStatus(builder, snapshot, recovery);
	const eventActions = builder.items.map(toStepEventAction);
	const controlActions = buildStepControlActions(builder, snapshot, actions);
	const timestamps = builder.items
		.map((item) => item.at ? Date.parse(item.at) : NaN)
		.filter((value) => Number.isFinite(value));
	const startedAt = firstDefined(builder.items.map((item) => item.at));
	const completedAt = status === "completed" ? lastDefined(builder.items.map((item) => item.at)) : undefined;
	const durationMs = timestamps.length >= 2 ? Math.max(0, Math.max(...timestamps) - Math.min(...timestamps)) : undefined;
	return {
		id: builder.id,
		title: titleForStep(builder, status),
		status,
		summary: summaryForStep(builder, snapshot, status),
		actions: controlActions.length > 0 ? controlActions : eventActions,
		evidence: [...builder.evidence.values()],
		fileRefs: [...builder.fileRefs.values()],
		...(startedAt ? { startedAt } : {}),
		...(completedAt ? { completedAt } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
	};
}

function enrichItemsFromSnapshot(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
): AgentTrajectoryItem[] {
	const items = [...visibleItems];
	for (const mutation of snapshot.mutations) {
		if (items.some((item) => item.actionRef === mutation.id && item.rawEventType === `mutation_${mutation.event}`)) {
			continue;
		}
		if (items.some((item) =>
			item.kind === "mutation" &&
			item.targetPath === mutation.targetPath &&
			((mutation.event === "planned" && item.status === "waiting") ||
				(mutation.event === "applied" && item.status === "ok") ||
				((mutation.event === "conflicted" || mutation.event === "apply_failed") && item.status === "failed"))
		)) {
			continue;
		}
		if (mutation.event === "planned" && items.some((item) =>
			item.kind === "approval" &&
			item.targetPath === mutation.targetPath &&
			(item.status === "waiting" || item.status === "running")
		)) {
			continue;
		}
		items.push({
			id: `mutation:${mutation.id}:${mutation.event}`,
			kind: "mutation",
			title: formatMutationTitle(mutation),
			detail: cleanText(mutation.summary || mutation.reason || mutation.event),
			status: mapMutationStatus(mutation.event),
			targetPath: mutation.targetPath,
			actionRef: mutation.id,
			rawEventType: `mutation_${mutation.event}`,
		});
	}
	return items;
}

function failureToItem(snapshot: AgentTrajectorySnapshot): AgentTrajectoryItem {
	const failure = snapshot.failure;
	return {
		id: "snapshot:failure",
		kind: "failure",
		title: "Run failed",
		detail: cleanText(failure?.message || snapshot.summary || "Run failed."),
		status: failure?.class === "cancelled" ? "cancelled" : "failed",
		rawEventType: "failure",
	};
}

function semanticStepKey(item: AgentTrajectoryItem): AgentProcessStepKey {
	if (item.kind === "intake") {
		return "receipt";
	}
	if (item.kind === "narration") {
		if (item.narrationKind === "task_acknowledged") {
			return "receipt";
		}
		if (item.narrationKind === "plan_declared") {
			return "plan";
		}
		if (item.narrationKind === "stage_report") {
			return "internal";
		}
		return "context";
	}
	if (item.kind === "approval") {
		return "approval";
	}
	if (item.kind === "failure") {
		return "failure";
	}
	if (item.kind === "transport") {
		return "transport";
	}
	if (item.kind === "mutation") {
		return item.status === "waiting" ? "approval" : item.status === "failed" ? "failure" : "file_change";
	}
	if (item.kind === "tool" && isWriteLikeTool(item.tool)) {
		return "file_change";
	}
	if (item.kind === "reasoning") {
		return "reasoning";
	}
	if (item.kind === "tool" || item.kind === "context" || item.kind === "model" || item.kind === "system" || item.kind === "task") {
		return "context";
	}
	return "internal";
}

function isWriteLikeTool(tool: string | undefined): boolean {
	const normalized = normalizeToken(tool);
	return normalized === "write" ||
		normalized === "edit" ||
		normalized === "create" ||
		normalized === "modify" ||
		normalized === "update" ||
		normalized === "apply_patch";
}

function addItemFileRef(builder: StepBuilder, item: AgentTrajectoryItem): void {
	if (!item.targetPath) {
		return;
	}
	builder.fileRefs.set(item.targetPath, {
		path: item.targetPath,
		name: filenameForPath(item.targetPath),
		operation: item.tool || item.kind,
	});
}

function addItemEvidence(builder: StepBuilder, item: AgentTrajectoryItem): void {
	if (item.targetPath) {
		const id = `file:${item.targetPath}`;
		builder.evidence.set(id, {
			id,
			label: item.targetPath,
			source: "file",
			detail: item.tool || item.title,
		});
	} else if (item.evidenceRef) {
		const id = `event:${item.evidenceRef}`;
		builder.evidence.set(id, {
			id,
			label: item.evidenceRef,
			source: "event",
			detail: item.title,
		});
	}
}

function deriveStepStatus(
	builder: StepBuilder,
	snapshot: AgentTrajectorySnapshot,
	recovery: AgentProcessRecoveryView | null,
): AgentProcessStepStatus {
	if (builder.key === "approval") {
		return "waiting_for_approval";
	}
	if (builder.items.some((item) => item.status === "failed")) {
		if (snapshot.status === "running" && builder.items.some((item) => item.status === "running" || item.status === "waiting")) {
			return "running";
		}
		return recovery?.retryable || snapshot.failure?.retryable ? "retryable" : "failed";
	}
	if (builder.items.some((item) => item.status === "denied")) {
		if (snapshot.status === "running" && builder.items.some((item) => item.status === "running" || item.status === "waiting")) {
			return "running";
		}
		return "denied";
	}
	if (builder.items.some((item) => item.status === "cancelled")) {
		return "cancelled";
	}
	if (builder.items.some((item) => item.status === "running" || item.status === "waiting")) {
		return "running";
	}
	return "completed";
}

function titleForStep(builder: StepBuilder, status: AgentProcessStepStatus): string {
	if (builder.key === "receipt" && builder.items.some((item) => item.kind === "intake")) {
		return firstMeaningfulDetail(builder.items) || "FRIDAY 正在理解你的请求";
	}
	switch (builder.key) {
		case "receipt":
			return "收到任务";
		case "plan":
			return "整理方案";
		case "context":
			return "读取上下文";
		case "reasoning":
			return "FRIDAY 的思路";
		case "file_change":
			return "创建/修改文件";
		case "approval":
			return "等待确认";
		case "transport":
			return "恢复请求";
		case "failure":
			return status === "cancelled" ? "已停止处理" : status === "retryable" ? "运行遇到问题，可重试" : "运行遇到问题";
		default:
			return "处理请求";
	}
}

function summaryForStep(
	builder: StepBuilder,
	snapshot: AgentTrajectorySnapshot,
	status: AgentProcessStepStatus,
): string {
	if (builder.key === "approval") {
		const pendingCount = pendingMutationCount(snapshot, builder);
		return pendingCount > 0
			? `已准备好 ${pendingCount} 个待应用的文件修改，确认后才会写入 Obsidian。`
			: "FRIDAY 需要你确认后继续。";
	}
	if (builder.key === "failure") {
		return status === "cancelled"
			? "已停止本次任务。"
			: firstMeaningfulDetail(builder.items) || snapshot.failure?.message || "运行失败。";
	}
	if (builder.key === "file_change") {
		return firstMeaningfulDetail(builder.items);
	}
	if (builder.key === "transport") {
		return transportSummaryForItems(builder.items);
	}
	if (builder.key === "receipt" || builder.key === "plan") {
		return firstMeaningfulDetail(builder.items);
	}
	if (status === "running") {
		return firstMeaningfulDetail(builder.items);
	}
	return firstMeaningfulDetail(builder.items);
}

function pendingMutationCount(snapshot: AgentTrajectorySnapshot, builder: StepBuilder): number {
	const filePaths = new Set([...builder.fileRefs.keys()]);
	const count = activePlannedMutations(snapshot.mutations).filter((mutation) =>
		(!filePaths.size || filePaths.has(mutation.targetPath))
	).length;
	return count || filePaths.size;
}

function firstMeaningfulDetail(items: AgentTrajectoryItem[]): string {
	for (const item of [...items].reverse()) {
		const detail = sanitizeTimelineSummary(firstMeaningfulLine(item.detail));
		if (detail) {
			return detail;
		}
	}
	return sanitizeTimelineSummary(firstMeaningfulLine(items.at(-1)?.title || ""));
}

function firstMeaningfulLine(value: string | undefined): string {
	return String(value ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean) ?? "";
}

function buildStepControlActions(
	builder: StepBuilder,
	snapshot: AgentTrajectorySnapshot,
	actions: AgentProcessActionView[],
): AgentProcessStepActionView[] {
	if (builder.key === "approval") {
		void snapshot;
		void actions;
		return [];
	}
	if (builder.key === "failure") {
		return actions
			.filter((action) =>
				action.id === "resume" ||
				action.id === "retry" ||
				action.id === "continue"
			)
			.map(toStepControlAction);
	}
	return [];
}

function toStepEventAction(item: AgentTrajectoryItem): AgentProcessStepActionView {
	const narrationDetail = item.kind === "narration" && Array.isArray(item.narrationPlan) && item.narrationPlan.length > 0
		? item.narrationPlan.join("\n")
		: item.kind === "transport"
			? transportSummaryForItems([item])
			: cleanText(item.detail);
	return {
		id: item.id,
		label: item.status === "cancelled" ? "已停止处理" : sanitizeTimelineSummary(item.title) || "FRIDAY 正在处理",
		detail: item.kind === "narration" && Array.isArray(item.narrationPlan) && item.narrationPlan.length > 0
			? item.narrationPlan.map((line) => sanitizeTimelineSummary(line)).filter(Boolean).join("\n")
			: sanitizeTimelineSummary(narrationDetail),
		kind: "event",
		tone: itemTone(item.status),
		status: item.status,
		...(item.tool ? { tool: item.tool } : {}),
		...(item.targetPath ? { targetPath: item.targetPath } : {}),
		...(item.rawEventType ? { rawEventType: item.rawEventType } : {}),
	};
}

function toStepControlAction(action: AgentProcessActionView): AgentProcessStepActionView {
	return {
		id: `control:${action.id}:${action.targetId || ""}`,
		label: productizeActionLabel(action.id, action.label),
		detail: sanitizeTimelineSummary(action.reason || ""),
		kind: "control",
		tone: action.tone,
		action,
	};
}

function buildEvidence(items: AgentTrajectoryItem[]): AgentProcessEvidenceView[] {
	const evidence = new Map<string, AgentProcessEvidenceView>();
	for (const item of items) {
		if (item.targetPath) {
			const id = `file:${item.targetPath}`;
			if (!evidence.has(id)) {
				evidence.set(id, {
					id,
					label: item.targetPath,
					source: "file",
					detail: sanitizeTimelineSummary(item.tool || item.title),
				});
			}
		} else if (item.evidenceRef) {
			const id = `event:${item.evidenceRef}`;
			if (!evidence.has(id)) {
				evidence.set(id, {
					id,
					label: item.evidenceRef,
					source: "event",
					detail: sanitizeTimelineSummary(item.title),
				});
			}
		}
	}
	return [...evidence.values()].slice(0, 8);
}

function buildMutations(snapshot: AgentTrajectorySnapshot): AgentProcessMutationView[] {
	const activePlanned = new Set(activePlannedMutations(snapshot.mutations));
	return snapshot.mutations
		.filter((mutation) => mutation.event !== "planned" || activePlanned.has(mutation))
		.map((mutation) => ({
		id: mutation.id,
		event: mutation.event,
		operation: mutation.operation,
		targetPath: mutation.targetPath,
		summary: mutationDisplaySummary(mutation.summary),
		reason: mutationDisplaySummary(mutation.reason),
		tone: mutationTone(mutation.event),
	}));
}

function buildResultArtifacts(snapshot: AgentTrajectorySnapshot): AgentProcessArtifactView[] {
	const artifacts = new Map<string, AgentProcessArtifactView>();
	for (const mutation of snapshot.mutations) {
		if (mutation.event !== "applied" || !mutation.targetPath) {
			continue;
		}
		artifacts.set(mutation.targetPath, {
			id: mutation.id,
			path: mutation.targetPath,
			name: filenameForPath(mutation.targetPath),
			extension: extensionForPath(mutation.targetPath),
			metadata: metadataForPath(mutation.targetPath),
			status: artifactStatusForMutation(mutation),
			summary: mutationDisplaySummary(mutation.summary || mutation.reason),
		});
	}
	return [...artifacts.values()];
}

function mutationDisplaySummary(value: string | undefined): string {
	const text = cleanText(value);
	return normalizeFileMutationStatusText(text) || sanitizeTimelineSummary(text);
}

function buildDiffSummary(artifacts: AgentProcessArtifactView[]): AgentProcessDiffSummaryView | null {
	if (artifacts.length === 0) {
		return null;
	}
	return {
		changedFiles: artifacts.length,
		summary: `${artifacts.length} 个文件已修改`,
		files: artifacts.map((artifact) => ({
			path: artifact.path,
			summary: artifact.summary,
		})),
	};
}

function buildRecovery(
	snapshot: AgentTrajectorySnapshot,
	mutations: AgentProcessMutationView[],
): AgentProcessRecoveryView | null {
	const failedMutation = mutations.find((mutation) => mutation.event === "conflicted" || mutation.event === "apply_failed");
	if (snapshot.failure) {
		if (snapshot.failure.class === "cancelled") {
			return {
				title: "已停止处理",
				summary: sanitizeTimelineSummary(snapshot.failure.message),
				retryable: false,
				recoverable: false,
			};
		}
		return {
			title: snapshot.failure.recoverable ? "可以恢复" : "运行已停止",
			summary: sanitizeTimelineSummary(snapshot.failure.message),
			retryable: snapshot.failure.retryable,
			recoverable: snapshot.failure.recoverable,
		};
	}
	if (failedMutation) {
		return {
			title: "文件改动需要处理",
			summary: sanitizeTimelineSummary(failedMutation.reason || failedMutation.summary || "A pending change needs review."),
			retryable: failedMutation.event === "apply_failed",
			recoverable: true,
		};
	}
	return null;
}

function buildActionViews(snapshot: AgentTrajectorySnapshot): AgentProcessActionView[] {
	const explicitActions = snapshot.actions
		.filter((action) => action.id !== "view_replay")
		.map(toActionView);
	const actions = [...explicitActions];
	for (const mutation of activePlannedMutations(snapshot.mutations)) {
		if (!actions.some((action) => action.id === "view_changes" && action.targetId === mutation.id)) {
			actions.push(toActionView({
				id: "view_changes",
				label: "查看改动",
				enabled: true,
				targetId: mutation.id,
			}));
		}
		if (!actions.some((action) => (action.id === "apply" || action.id === "approve") && action.targetId === mutation.id)) {
			actions.push(toActionView({
				id: "apply",
				label: "应用修改",
				enabled: true,
				targetId: mutation.id,
			}));
		}
		if (!actions.some((action) => action.id === "reject" && action.targetId === mutation.id)) {
			actions.push(toActionView({
				id: "reject",
				label: "不应用",
				enabled: true,
				targetId: mutation.id,
			}));
		}
	}
	return actions;
}

function toActionView(action: AgentTrajectoryAction): AgentProcessActionView {
	return {
		...action,
		label: productizeActionLabel(action.id, action.label),
		...(action.reason ? { reason: sanitizeTimelineSummary(action.reason) } : {}),
		tone: action.id === "retry" || action.id === "continue" || action.id === "approve" || action.id === "apply"
			? "primary"
			: action.id === "reject"
				? "danger"
				: "secondary",
	};
}

function itemTone(status: AgentTrajectoryItemStatus): AgentProcessTone {
	switch (status) {
		case "failed":
		case "denied":
			return "failed";
		case "waiting":
			return "waiting";
		case "running":
			return "running";
		case "cancelled":
			return "cancelled";
		case "ok":
			return "completed";
		default:
			return "idle";
	}
}

function mutationTone(event: AgentTrajectoryMutation["event"]): AgentProcessTone {
	switch (event) {
		case "applied":
			return "completed";
		case "conflicted":
		case "apply_failed":
			return "failed";
		case "planned":
			return "waiting";
		case "rejected":
		default:
			return "cancelled";
	}
}

function mapMutationStatus(event: AgentTrajectoryMutation["event"]): AgentTrajectoryItemStatus {
	switch (event) {
		case "applied":
			return "ok";
		case "rejected":
			return "denied";
		case "conflicted":
		case "apply_failed":
			return "failed";
		case "planned":
		default:
			return "waiting";
	}
}

function calculateDurationSeconds(
	snapshot: AgentTrajectorySnapshot,
	nowOption?: Date | (() => Date),
): number {
	const time = snapshot.time ?? {};
	if (typeof time.durationMs === "number") {
		return Math.max(0, Math.round(time.durationMs / 1000));
	}
	const startedMs = time.startedAt ? Date.parse(time.startedAt) : NaN;
	if (Number.isFinite(startedMs)) {
		const endedAt = snapshot.status === "running"
			? resolveNow(nowOption).getTime()
			: Date.parse(time.completedAt ?? time.updatedAt ?? "");
		if (Number.isFinite(endedAt)) {
			return Math.max(0, Math.round((endedAt - startedMs) / 1000));
		}
	}
	const timestamps = snapshot.items
		.map((item) => item.at ? Date.parse(item.at) : NaN)
		.filter((value) => Number.isFinite(value));
	if (timestamps.length < 2) {
		return 0;
	}
	return Math.max(0, Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000));
}

function calculateRecordedDurationSeconds(
	snapshot: AgentTrajectorySnapshot,
	fallbackSeconds: number,
): number {
	const time = snapshot.time ?? {};
	if (typeof time.durationMs === "number") {
		return Math.max(0, Math.round(time.durationMs / 1000));
	}
	const startedMs = time.startedAt ? Date.parse(time.startedAt) : NaN;
	const endedMs = time.completedAt || time.updatedAt ? Date.parse(time.completedAt ?? time.updatedAt ?? "") : NaN;
	if (Number.isFinite(startedMs) && Number.isFinite(endedMs)) {
		return Math.max(0, Math.round((endedMs - startedMs) / 1000));
	}
	return fallbackSeconds;
}

function formatDuration(seconds: number): string {
	const safeSeconds = Math.max(0, Math.round(seconds));
	if (safeSeconds < 60) {
		return `${safeSeconds}s`;
	}
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = safeSeconds % 60;
	return remainingSeconds > 0 ? `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s` : `${minutes}m`;
}

function resolveNow(nowOption?: Date | (() => Date)): Date {
	if (typeof nowOption === "function") {
		return nowOption();
	}
	return nowOption ?? new Date();
}

function filenameForPath(pathValue: string): string {
	return pathValue.split(/[\\/]/).filter(Boolean).at(-1) || pathValue;
}

function extensionForPath(pathValue: string): string {
	const name = filenameForPath(pathValue);
	const dotIndex = name.lastIndexOf(".");
	return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function metadataForPath(pathValue: string): string {
	const extension = extensionForPath(pathValue);
	if (extension === "md") {
		return "文档 · MD";
	}
	if (extension === "canvas") {
		return "画布 · Canvas";
	}
	return extension ? `文件 · ${extension.toUpperCase()}` : "文件";
}

function artifactStatusForMutation(mutation: AgentTrajectoryMutation): AgentProcessArtifactView["status"] {
	const operation = mutation.operation.toLowerCase();
	if (operation === "write" || operation === "create") {
		return "created";
	}
	if (operation === "edit" || operation === "modify" || operation === "update") {
		return "modified";
	}
	return "applied";
}

function formatMutationTitle(mutation: AgentTrajectoryMutation): string {
	const label = formatMutationLabel(mutation);
	return mutation.targetPath ? `${label}：${mutation.targetPath}` : label;
}

function formatMutationLabel(mutation: AgentTrajectoryMutation): string {
	switch (mutation.event) {
		case "planned":
			return "准备文件修改";
		case "applied":
			return "已应用文件修改";
		case "rejected":
			return "已取消文件修改";
		case "conflicted":
			return "文件修改需要重新确认";
		case "apply_failed":
			return "文件修改未能应用";
		default:
			return "文件修改";
	}
}

function firstDefined(values: Array<string | undefined>): string | undefined {
	return values.find((value) => Boolean(value));
}

function lastDefined(values: Array<string | undefined>): string | undefined {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		const value = values[index];
		if (value) {
			return value;
		}
	}
	return undefined;
}

function normalizeToken(value: string | undefined): string {
	return cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function shortText(value: string, maxLength = 96): string {
	const text = cleanText(value).replace(/\s+/g, " ");
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength).trimEnd()}...`;
}

function cleanText(value: string | undefined): string {
	return String(value ?? "").trim();
}
