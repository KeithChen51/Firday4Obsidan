import type {
	AgentTrajectoryAction,
	AgentTrajectoryItem,
	AgentTrajectoryItemKind,
	AgentTrajectoryItemStatus,
	AgentTrajectoryMutation,
	AgentTrajectorySnapshot,
	AgentTrajectoryStage,
	AgentTrajectoryStatus,
} from "../core/trajectory/AgentTrajectory";

export type AgentProcessPanelMode = "simple_thinking" | "stepped_process" | "completed_replay";

export type AgentProcessTone =
	| "idle"
	| "running"
	| "reconnecting"
	| "waiting"
	| "failed"
	| "completed"
	| "cancelled"
	| "safe_stopped";

export interface AgentProcessStatusView {
	key: AgentTrajectoryStatus;
	label: string;
	tone: AgentProcessTone;
	needsAttention: boolean;
}

export interface AgentProcessTimelineItemView {
	id: string;
	kind: AgentTrajectoryItemKind;
	title: string;
	detail: string;
	status: AgentTrajectoryItemStatus;
	tone: AgentProcessTone;
	meta: string;
	tool?: string;
	targetPath?: string;
	step?: number;
	rawEventType?: string;
}

export interface AgentProcessStageView {
	key: AgentTrajectoryStage["key"];
	label: string;
	status: AgentTrajectoryItemStatus;
	tone: AgentProcessTone;
	count: number;
	current: boolean;
}

export interface AgentProcessStepGroupView {
	key: AgentTrajectoryStage["key"];
	title: string;
	status: AgentTrajectoryItemStatus;
	tone: AgentProcessTone;
	summary: string;
	items: AgentProcessTimelineItemView[];
	collapsedByDefault: boolean;
}

export interface AgentProcessEvidenceView {
	id: string;
	label: string;
	source: "file" | "tool" | "event";
	detail: string;
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

export interface AgentProcessActionView extends AgentTrajectoryAction {
	tone: "primary" | "secondary" | "danger";
}

export interface AgentProcessRecoveryView {
	title: string;
	summary: string;
	retryable: boolean;
	recoverable: boolean;
}

export interface AgentProcessPanelViewModel {
	mode: AgentProcessPanelMode;
	status: AgentProcessStatusView;
	header: {
		label: string;
		headline: string;
		summary: string;
	};
	current: AgentProcessTimelineItemView | null;
	stages: AgentProcessStageView[];
	stepGroups: AgentProcessStepGroupView[];
	timeline: AgentProcessTimelineItemView[];
	evidence: AgentProcessEvidenceView[];
	mutations: AgentProcessMutationView[];
	actions: AgentProcessActionView[];
	recovery: AgentProcessRecoveryView | null;
	isEmpty: boolean;
	overflowCount: number;
}

export interface BuildAgentProcessPanelViewModelOptions {
	maxCollapsedItems?: number;
	maxExpandedItems?: number;
}

const DEFAULT_MAX_EXPANDED_ITEMS = 10;

const STAGE_TITLES: Record<AgentTrajectoryStage["key"], string> = {
	context: "Context",
	reasoning: "Reasoning",
	tools: "Tools",
	review: "Review",
	finalize: "Finalize",
};

const STAGE_ORDER: AgentTrajectoryStage["key"][] = ["context", "reasoning", "tools", "review", "finalize"];

export function buildAgentProcessPanelViewModel(
	snapshot: AgentTrajectorySnapshot | null,
	options: BuildAgentProcessPanelViewModelOptions = {},
): AgentProcessPanelViewModel {
	const maxExpandedItems = Math.max(1, options.maxExpandedItems ?? DEFAULT_MAX_EXPANDED_ITEMS);
	if (!snapshot) {
		return createEmptyViewModel();
	}

	const allTimeline = snapshot.items.map(toTimelineItemView);
	const timeline = allTimeline.slice(-maxExpandedItems);
	const overflowCount = Math.max(0, allTimeline.length - timeline.length);
	const current = findCurrentItem(allTimeline);
	const mode = resolveMode(snapshot);
	const status = buildStatus(snapshot, current);
	const evidence = buildEvidence(snapshot);
	const mutations = buildMutations(snapshot);
	const actions = snapshot.actions.map(toActionView);
	const recovery = buildRecovery(snapshot, mutations);

	return {
		mode,
		status,
		header: {
			label: headerLabel(snapshot, mode),
			headline: headerHeadline(snapshot, mode, current),
			summary: headerSummary(snapshot, current),
		},
		current,
		stages: buildStages(snapshot, current),
		stepGroups: mode === "simple_thinking" ? [] : buildStepGroups(snapshot),
		timeline,
		evidence,
		mutations,
		actions,
		recovery,
		isEmpty: snapshot.items.length === 0 && snapshot.mutations.length === 0,
		overflowCount,
	};
}

function createEmptyViewModel(): AgentProcessPanelViewModel {
	return {
		mode: "simple_thinking",
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
		current: null,
		stages: [],
		stepGroups: [],
		timeline: [],
		evidence: [],
		mutations: [],
		actions: [],
		recovery: null,
		isEmpty: true,
		overflowCount: 0,
	};
}

function resolveMode(snapshot: AgentTrajectorySnapshot): AgentProcessPanelMode {
	if (snapshot.privacy.source === "replay" || snapshot.status === "completed" || snapshot.status === "safe_stopped") {
		return "completed_replay";
	}
	if (snapshot.status === "running" && !hasTaskLikeFacts(snapshot)) {
		return "simple_thinking";
	}
	return "stepped_process";
}

function hasTaskLikeFacts(snapshot: AgentTrajectorySnapshot): boolean {
	if (snapshot.failure || snapshot.mutations.length > 0) {
		return true;
	}
	return snapshot.items.some((item) =>
		item.kind === "tool" ||
		item.kind === "approval" ||
		item.kind === "mutation" ||
		item.kind === "failure" ||
		item.kind === "transport" ||
		item.kind === "task" ||
		Boolean(item.targetPath)
	);
}

function buildStatus(
	snapshot: AgentTrajectorySnapshot,
	current: AgentProcessTimelineItemView | null,
): AgentProcessStatusView {
	const tone = statusTone(snapshot.status, current);
	return {
		key: snapshot.status,
		label: statusLabel(snapshot.status, tone),
		tone,
		needsAttention: tone === "waiting" || tone === "failed",
	};
}

function statusTone(status: AgentTrajectoryStatus, current: AgentProcessTimelineItemView | null): AgentProcessTone {
	if (current?.kind === "transport" && current.status !== "failed") {
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
		return "Thinking";
	}
	if (mode === "completed_replay") {
		return "Completed";
	}
	return statusLabel(snapshot.status, statusTone(snapshot.status, null));
}

function headerHeadline(
	snapshot: AgentTrajectorySnapshot,
	mode: AgentProcessPanelMode,
	current: AgentProcessTimelineItemView | null,
): string {
	if (mode === "simple_thinking") {
		return "FRIDAY is thinking";
	}
	return snapshot.headline || current?.title || "FRIDAY is working";
}

function headerSummary(snapshot: AgentTrajectorySnapshot, current: AgentProcessTimelineItemView | null): string {
	return cleanText(snapshot.summary || current?.detail || "");
}

function findCurrentItem(items: AgentProcessTimelineItemView[]): AgentProcessTimelineItemView | null {
	return findLast(items, (item) => item.kind === "approval" && item.status === "waiting") ??
		findLast(items, (item) => item.status === "failed" || item.status === "denied") ??
		findLast(items, (item) => item.status === "running" || item.status === "waiting") ??
		items.at(-1) ??
		null;
}

function buildStages(
	snapshot: AgentTrajectorySnapshot,
	current: AgentProcessTimelineItemView | null,
): AgentProcessStageView[] {
	return STAGE_ORDER.map((key) => {
		const source = snapshot.stages.find((stage) => stage.key === key);
		const items = snapshot.items.filter((item) => stageForItem(item) === key);
		const status = source?.status ?? deriveGroupStatus(items);
		return {
			key,
			label: source?.label || STAGE_TITLES[key],
			status,
			tone: itemTone(status, key === "finalize" && snapshot.status === "completed" ? "completed" : undefined),
			count: items.length,
			current: current ? stageForKind(current.kind) === key : false,
		};
	});
}

function buildStepGroups(snapshot: AgentTrajectorySnapshot): AgentProcessStepGroupView[] {
	return STAGE_ORDER
		.map((key) => {
			const items = snapshot.items
				.filter((item) => stageForItem(item) === key)
				.map(toTimelineItemView);
			if (items.length === 0) {
				return null;
			}
			const status = deriveGroupStatus(items);
			return {
				key,
				title: STAGE_TITLES[key],
				status,
				tone: itemTone(status),
				summary: summarizeGroup(items),
				items,
				collapsedByDefault: key !== "tools" && key !== "review" && items.every((item) => item.status === "ok"),
			};
		})
		.filter((group): group is AgentProcessStepGroupView => Boolean(group));
}

function buildEvidence(snapshot: AgentTrajectorySnapshot): AgentProcessEvidenceView[] {
	const evidence = new Map<string, AgentProcessEvidenceView>();
	for (const item of snapshot.items) {
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
			title: "Review required",
			summary: failedMutation.reason || failedMutation.summary || "A pending change needs review.",
			retryable: failedMutation.event === "apply_failed",
			recoverable: true,
		};
	}
	return null;
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

function toTimelineItemView(item: AgentTrajectoryItem): AgentProcessTimelineItemView {
	const meta = [
		item.tool,
		item.targetPath,
		item.step === undefined ? "" : `step ${item.step}`,
	].filter((value): value is string => typeof value === "string" && value.length > 0);
	return {
		id: item.id,
		kind: item.kind,
		title: item.title,
		detail: cleanText(item.detail),
		status: item.status,
		tone: itemTone(item.status),
		meta: meta.join(" | "),
		...(item.tool ? { tool: item.tool } : {}),
		...(item.targetPath ? { targetPath: item.targetPath } : {}),
		...(item.step !== undefined ? { step: item.step } : {}),
		...(item.rawEventType ? { rawEventType: item.rawEventType } : {}),
	};
}

function stageForItem(item: AgentTrajectoryItem): AgentTrajectoryStage["key"] {
	return stageForKind(item.kind);
}

function stageForKind(kind: AgentTrajectoryItemKind): AgentTrajectoryStage["key"] {
	switch (kind) {
		case "context":
		case "task":
			return "context";
		case "model":
		case "transport":
		case "system":
			return "reasoning";
		case "tool":
			return "tools";
		case "approval":
		case "mutation":
			return "review";
		case "failure":
		case "final":
		default:
			return "finalize";
	}
}

function deriveGroupStatus(items: Array<AgentTrajectoryItem | AgentProcessTimelineItemView>): AgentTrajectoryItemStatus {
	if (items.some((item) => item.status === "failed")) return "failed";
	if (items.some((item) => item.status === "denied")) return "denied";
	if (items.some((item) => item.status === "waiting")) return "waiting";
	if (items.some((item) => item.status === "running")) return "running";
	if (items.some((item) => item.status === "cancelled")) return "cancelled";
	if (items.length > 0 && items.every((item) => item.status === "ok")) return "ok";
	return "pending";
}

function summarizeGroup(items: AgentProcessTimelineItemView[]): string {
	const current = findCurrentItem(items);
	if (current?.detail) {
		return current.detail;
	}
	return current?.title || `${items.length} event${items.length === 1 ? "" : "s"}`;
}

function itemTone(status: AgentTrajectoryItemStatus, override?: AgentProcessTone): AgentProcessTone {
	if (override) {
		return override;
	}
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

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | null {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item && predicate(item)) {
			return item;
		}
	}
	return null;
}

function cleanText(value: string): string {
	return String(value ?? "").trim();
}
