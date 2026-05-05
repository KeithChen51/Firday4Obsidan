import type {
	AgentTrajectoryAction,
	AgentTrajectoryItem,
	AgentTrajectoryItemStatus,
	AgentTrajectoryMutation,
	AgentTrajectorySnapshot,
	AgentTrajectoryStatus,
} from "../core/trajectory/AgentTrajectory";

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

type AgentProcessStepKey = "context" | "reasoning" | "file_change" | "approval" | "transport" | "failure" | "internal";

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

	const visibleItems = snapshot.items.filter(isRenderableTrajectoryItem);
	const actions = buildActionViews(snapshot);
	const mutations = buildMutations(snapshot);
	const recovery = buildRecovery(snapshot, mutations);
	const visibleSteps = buildVisibleSteps(snapshot, visibleItems, actions, recovery);
	const mode = resolveMode(snapshot, visibleSteps);
	const durationSeconds = calculateDurationSeconds(snapshot, options.now);
	const triggerReason = resolveTriggerReason(snapshot, visibleItems, mutations);
	const surface = resolveSurface(snapshot, mode, triggerReason);
	const status = buildStatus(snapshot, visibleSteps);
	const evidence = buildEvidence(visibleItems);
	const resultArtifacts = buildResultArtifacts(snapshot);
	const diffSummary = buildDiffSummary(resultArtifacts);
	const hasExpandableContent = resolveHasExpandableContent(surface, visibleSteps);
	const headline = headerHeadline(snapshot, mode, triggerReason, durationSeconds);

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
	return item.kind === "task" &&
		(item.rawEventType === "task_created" ||
			item.rawEventType === "task_running" ||
			item.rawEventType === "task_completed");
}

function isRenderableTrajectoryItem(item: AgentTrajectoryItem): boolean {
	return !isLifecycleOnlyItem(item);
}

function resolveSurface(
	snapshot: AgentTrajectorySnapshot,
	mode: AgentProcessPanelMode,
	triggerReason: AgentProcessTriggerReason | null,
): AgentProcessSurface {
	if (mode === "simple_thinking") {
		return snapshot.status === "running" ? "inline_thinking" : "hidden";
	}
	if (snapshot.status === "waiting_for_approval" || snapshot.status === "waiting_for_user" || triggerReason === "mutation_review") {
		return "action_required";
	}
	if (snapshot.status === "failed" || snapshot.status === "cancelled" || snapshot.status === "safe_stopped" || triggerReason === "failure_recovery") {
		return "compact_recovery";
	}
	if (mode === "completed_replay") {
		return "collapsed_completed_replay";
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
	if (currentStep?.title === "重新连接模型" && currentStep.status !== "failed") {
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
		return "Reconnecting";
	}
	switch (status) {
		case "waiting_for_approval":
			return "Waiting for approval";
		case "waiting_for_user":
			return "Waiting for user";
		case "failed":
			return "Failed";
		case "cancelled":
			return "Cancelled";
		case "safe_stopped":
			return "Stopped safely";
		case "completed":
			return "Completed";
		case "running":
			return "Working";
		default:
			return "Idle";
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
		return snapshot.status === "running" ? "FRIDAY 思考中" : `FRIDAY 的思路 ${durationSeconds}s`;
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
	return shortText(snapshot.summary || visibleSteps.at(-1)?.summary || "");
}

function buildVisibleSteps(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
	actions: AgentProcessActionView[],
	recovery: AgentProcessRecoveryView | null,
): AgentProcessStepView[] {
	if (!hasVisibleProcessTrigger(snapshot, visibleItems)) {
		return [];
	}
	const items = enrichItemsFromSnapshot(snapshot, visibleItems);
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

function hasVisibleProcessTrigger(
	snapshot: AgentTrajectorySnapshot,
	visibleItems: AgentTrajectoryItem[],
): boolean {
	if (snapshot.failure || snapshot.mutations.length > 0) {
		return true;
	}
	return visibleItems.some((item) =>
		item.kind === "context" ||
		item.kind === "reasoning" ||
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
		return recovery?.retryable || snapshot.failure?.retryable ? "retryable" : "failed";
	}
	if (builder.items.some((item) => item.status === "denied")) {
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
	switch (builder.key) {
		case "context":
			return "读取上下文";
		case "reasoning":
			return "FRIDAY 的思路";
		case "file_change":
			return "创建/修改文件";
		case "approval":
			return "等待确认文件修改";
		case "transport":
			return "重新连接模型";
		case "failure":
			return status === "retryable" ? "运行遇到问题，可重试" : "运行遇到问题";
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
		return pendingCount > 0 ? `${pendingCount} 个文件改动待审核` : firstMeaningfulDetail(builder.items);
	}
	if (builder.key === "failure") {
		return firstMeaningfulDetail(builder.items) || snapshot.failure?.message || "运行失败。";
	}
	if (builder.key === "file_change") {
		return firstMeaningfulDetail(builder.items);
	}
	if (builder.key === "transport") {
		return firstMeaningfulDetail(builder.items);
	}
	if (status === "running") {
		return firstMeaningfulDetail(builder.items);
	}
	return firstMeaningfulDetail(builder.items);
}

function pendingMutationCount(snapshot: AgentTrajectorySnapshot, builder: StepBuilder): number {
	const filePaths = new Set([...builder.fileRefs.keys()]);
	const count = snapshot.mutations.filter((mutation) =>
		mutation.event === "planned" &&
		(!filePaths.size || filePaths.has(mutation.targetPath))
	).length;
	return count || filePaths.size;
}

function firstMeaningfulDetail(items: AgentTrajectoryItem[]): string {
	for (const item of [...items].reverse()) {
		const detail = cleanText(item.detail);
		if (detail) {
			return detail;
		}
	}
	return cleanText(items.at(-1)?.title || "");
}

function buildStepControlActions(
	builder: StepBuilder,
	snapshot: AgentTrajectorySnapshot,
	actions: AgentProcessActionView[],
): AgentProcessStepActionView[] {
	if (builder.key === "approval") {
		const targetIds = new Set(builder.items.map((item) => item.actionRef).filter((value): value is string => Boolean(value)));
		const pendingMutationIds = snapshot.mutations
			.filter((mutation) => mutation.event === "planned" && (builder.fileRefs.size === 0 || builder.fileRefs.has(mutation.targetPath)))
			.map((mutation) => mutation.id);
		for (const id of pendingMutationIds) {
			targetIds.add(id);
		}
		const relevantActions = actions.filter((action) =>
			action.id === "apply" ||
			action.id === "reject" ||
			action.id === "approve" ||
			action.id === "view_changes" ||
			(targetIds.size > 0 && action.targetId && targetIds.has(action.targetId))
		);
		const controls = ensureChangeApprovalControls(relevantActions, [...targetIds][0]);
		return controls.map(toStepControlAction);
	}
	if (builder.key === "failure") {
		return actions
			.filter((action) =>
				action.id === "resume" ||
				action.id === "retry" ||
				action.id === "continue" ||
				action.id === "apply" ||
				action.id === "reject"
			)
			.map(toStepControlAction);
	}
	return [];
}

function ensureChangeApprovalControls(
	actions: AgentProcessActionView[],
	targetId: string | undefined,
): AgentProcessActionView[] {
	const controls = [...actions];
	if (!controls.some((action) => action.id === "view_changes")) {
		controls.unshift({
			id: "view_changes",
			label: "查看改动",
			enabled: true,
			targetId,
			tone: "secondary",
		});
	}
	if (!controls.some((action) => action.id === "apply" || action.id === "approve")) {
		controls.push({
			id: "apply",
			label: "应用",
			enabled: true,
			targetId,
			tone: "primary",
		});
	}
	if (!controls.some((action) => action.id === "reject")) {
		controls.push({
			id: "reject",
			label: "拒绝",
			enabled: true,
			targetId,
			tone: "danger",
		});
	}
	return controls;
}

function toStepEventAction(item: AgentTrajectoryItem): AgentProcessStepActionView {
	return {
		id: item.id,
		label: item.title,
		detail: cleanText(item.detail),
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
		label: action.label,
		detail: action.reason || "",
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
					detail: item.tool || item.title,
				});
			}
		} else if (item.evidenceRef) {
			const id = `event:${item.evidenceRef}`;
			if (!evidence.has(id)) {
				evidence.set(id, {
					id,
					label: item.evidenceRef,
					source: "event",
					detail: item.title,
				});
			}
		}
	}
	return [...evidence.values()].slice(0, 8);
}

function buildMutations(snapshot: AgentTrajectorySnapshot): AgentProcessMutationView[] {
	return snapshot.mutations.map((mutation) => ({
		id: mutation.id,
		event: mutation.event,
		operation: mutation.operation,
		targetPath: mutation.targetPath,
		summary: cleanText(mutation.summary),
		reason: cleanText(mutation.reason),
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
			summary: cleanText(mutation.summary || mutation.reason),
		});
	}
	return [...artifacts.values()];
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
		return {
			title: snapshot.failure.recoverable ? "Recovery available" : "Run stopped",
			summary: cleanText(snapshot.failure.message),
			retryable: snapshot.failure.retryable,
			recoverable: snapshot.failure.recoverable,
		};
	}
	if (failedMutation) {
		return {
			title: "文件改动需要处理",
			summary: failedMutation.reason || failedMutation.summary || "A pending change needs review.",
			retryable: failedMutation.event === "apply_failed",
			recoverable: true,
		};
	}
	return null;
}

function buildActionViews(snapshot: AgentTrajectorySnapshot): AgentProcessActionView[] {
	const explicitActions = snapshot.actions.map(toActionView);
	const actions = [...explicitActions];
	for (const mutation of snapshot.mutations) {
		if (mutation.event !== "planned") {
			continue;
		}
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
				label: "应用",
				enabled: true,
				targetId: mutation.id,
			}));
		}
		if (!actions.some((action) => action.id === "reject" && action.targetId === mutation.id)) {
			actions.push(toActionView({
				id: "reject",
				label: "拒绝",
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
	const operation = mutation.operation || "mutation";
	return mutation.targetPath ? `${operation} ${mutation.targetPath}` : operation;
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
