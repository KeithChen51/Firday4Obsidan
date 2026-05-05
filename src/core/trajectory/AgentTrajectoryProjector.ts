import type { TurnReplaySummary } from "../runtime/TurnReplayReader";
import type { RuntimeProgressEvent } from "../../services/AgentRuntimeService";
import type {
	AgentTrajectoryAction,
	AgentTrajectoryFailure,
	AgentTrajectoryIdentity,
	AgentTrajectoryItem,
	AgentTrajectoryItemKind,
	AgentTrajectoryItemStatus,
	AgentTrajectoryMutation,
	AgentTrajectorySnapshot,
	AgentTrajectoryStage,
	AgentTrajectoryStatus,
} from "./AgentTrajectory";

type RuntimeProgressIdentity = Partial<AgentTrajectoryIdentity>;
type RuntimeProgressWithIdentity = RuntimeProgressEvent & RuntimeProgressIdentity & {
	at?: string;
	reasoningProvider?: string;
	reasoningRawFormat?: string;
	reasoningContinuationPolicy?: string;
	reasoningVisibleSummary?: string;
	reasoningWarnings?: string[];
};
type ReplaySummaryWithIdentity = TurnReplaySummary & Partial<Pick<AgentTrajectoryIdentity, "traceId" | "agentId">>;

const STAGE_LABELS: Record<AgentTrajectoryStage["key"], string> = {
	context: "Context",
	reasoning: "Reasoning",
	tools: "Tools",
	review: "Review",
	finalize: "Finalize",
};

const STAGE_KEYS: AgentTrajectoryStage["key"][] = ["context", "reasoning", "tools", "review", "finalize"];

export function createEmptyTrajectorySnapshot(
	identity: Partial<AgentTrajectoryIdentity> = {},
): AgentTrajectorySnapshot {
	return {
		identity: {
			turnId: identity.turnId?.trim() || "unknown-turn",
			...(identity.taskId ? { taskId: identity.taskId } : {}),
			...(identity.traceId ? { traceId: identity.traceId } : {}),
			...(identity.conversationId ? { conversationId: identity.conversationId } : {}),
			...(identity.agentId ? { agentId: identity.agentId } : {}),
		},
		status: "idle",
		headline: "Agent is idle",
		summary: "",
		time: {},
		stages: createStages(),
		items: [],
		actions: [],
		mutations: [],
		privacy: {
			redacted: true,
			source: "live",
		},
	};
}

export function projectRuntimeProgress(events: RuntimeProgressEvent[]): AgentTrajectorySnapshot {
	const runtimeEvents = events as RuntimeProgressWithIdentity[];
	const snapshot = createEmptyTrajectorySnapshot(extractRuntimeIdentity(runtimeEvents));
	snapshot.privacy.source = "live";
	snapshot.status = events.length > 0 ? "running" : "idle";
	snapshot.headline = events.length > 0 ? "Agent is preparing" : "Agent is idle";
	snapshot.summary = events.length > 0 ? safeText(events[events.length - 1]?.message ?? "") : "";

	for (const [index, event] of runtimeEvents.entries()) {
		mergeIdentity(snapshot.identity, event);
		updateSnapshotTimeFromEvent(snapshot, event.at);
		applyRuntimeProgress(snapshot, event, index);
	}

	finalizeSnapshotTime(snapshot);
	deriveStageStatuses(snapshot);
	snapshot.actions = deriveActions(snapshot);
	return snapshot;
}

export function projectReplaySummary(summary: TurnReplaySummary): AgentTrajectorySnapshot {
	const replaySummary = summary as ReplaySummaryWithIdentity;
	const snapshot = createEmptyTrajectorySnapshot({
		turnId: replaySummary.turnId,
		taskId: replaySummary.taskId,
		traceId: replaySummary.traceId,
		conversationId: replaySummary.conversationId,
		agentId: replaySummary.agentId,
	});
	snapshot.privacy.source = "replay";
	snapshot.status = resolveReplayStatus(replaySummary);
	snapshot.headline = replayHeadline(snapshot.status);
	snapshot.summary = safeText(replaySummary.finalAnswerSummary || replaySummary.errors[0] || "");
	snapshot.time = {
		...(replaySummary.startedAt ? { startedAt: replaySummary.startedAt } : {}),
		...(replaySummary.updatedAt ? { updatedAt: replaySummary.updatedAt } : {}),
		...(replaySummary.completedAt ? { completedAt: replaySummary.completedAt } : {}),
		...(typeof replaySummary.durationMs === "number" ? { durationMs: replaySummary.durationMs } : {}),
	};

	for (const [index, reasoning] of (replaySummary.reasoningTimeline ?? []).entries()) {
		upsertItem(snapshot, "reasoning", {
			id: `replay:reasoning:${reasoning.step}:${index}`,
			kind: "reasoning",
			title: "FRIDAY 的思路",
			detail: safeText(reasoning.visibleSummary),
			status: "ok",
			step: reasoning.step,
			at: reasoning.at,
			rawEventType: "model_response",
			reasoningProvider: reasoning.provider,
			reasoningRawFormat: reasoning.rawFormat,
			reasoningContinuationPolicy: reasoning.continuationPolicy,
		});
	}

	for (const toolCall of replaySummary.toolCalls) {
		const status = mapReplayToolStatus(toolCall.status);
		upsertItem(snapshot, stageForKind("tool"), {
			id: `replay:tool:${toolCall.step}:${toolCall.tool}:${toolCall.toolCallId || toolCall.targetPath}`,
			kind: "tool",
			title: formatToolTitle(toolCall.tool, toolCall.targetPath),
			detail: toolCall.status === "requested" ? "Tool requested." : `Tool ${toolCall.status}.`,
			status,
			step: toolCall.step,
			at: toolCall.at,
			tool: toolCall.tool,
			targetPath: toolCall.targetPath || undefined,
			evidenceRef: toolCall.toolCallId || undefined,
			rawEventType: "tool_call",
		});
	}

	for (const [index, transport] of replaySummary.transportTimeline.entries()) {
		upsertItem(snapshot, "reasoning", {
			id: `replay:transport:${transport.step}:${index}:${transport.type}`,
			kind: "transport",
			title: "Model transport",
			detail: formatReplayTransportDetail(transport),
			status: mapReplayTransportStatus(transport.type, snapshot.status),
			step: transport.step,
			at: transport.at,
			rawEventType: transport.type,
		});
	}

	for (const [index, checkpoint] of (replaySummary.checkpointTimeline ?? []).entries()) {
		upsertItem(snapshot, "reasoning", {
			id: `replay:checkpoint:${checkpoint.checkpointId || index}:${checkpoint.event}`,
			kind: "system",
			title: formatCheckpointTitle(checkpoint.event),
			detail: formatCheckpointDetail(checkpoint),
			status: mapCheckpointStatus(checkpoint.event, snapshot.status),
			step: checkpoint.nextStep ?? checkpoint.step,
			at: checkpoint.at,
			actionRef: checkpoint.canAutoResume === false ? undefined : checkpoint.checkpointId || undefined,
			rawEventType: `checkpoint_${checkpoint.event}`,
		});
	}

	if (replaySummary.approvals.requested > 0) {
		const waiting = replaySummary.approvals.requested > replaySummary.approvals.resolved;
		upsertItem(snapshot, "review", {
			id: "replay:approval:summary",
			kind: "approval",
			title: "Tool approval",
			detail: waiting
				? `${replaySummary.approvals.requested - replaySummary.approvals.resolved} approval request(s) waiting.`
				: `${replaySummary.approvals.resolved} approval request(s) resolved.`,
			status: waiting ? "waiting" : replaySummary.approvals.denied > 0 ? "denied" : "ok",
			at: replaySummary.completedAt ?? replaySummary.updatedAt,
			rawEventType: "tool_approval",
		});
	}

	for (const mutation of replaySummary.mutationTimeline) {
		const projectedMutation: AgentTrajectoryMutation = {
			id: mutation.id,
			event: mutation.event,
			operation: mutation.operation,
			targetPath: mutation.targetPath,
			status: mutation.status,
			summary: safeText(mutation.summary),
			reason: safeText(mutation.reason),
		};
		snapshot.mutations.push(projectedMutation);
		upsertItem(snapshot, "review", {
			id: `replay:mutation:${mutation.id}:${mutation.event}`,
			kind: "mutation",
			title: formatMutationTitle(projectedMutation),
			detail: projectedMutation.summary || projectedMutation.reason || mutation.event,
			status: mapMutationStatus(mutation.event),
			at: mutation.at,
			targetPath: mutation.targetPath || undefined,
			actionRef: mutation.id || undefined,
			rawEventType: `mutation_${mutation.event}`,
		});
	}

	for (const task of replaySummary.taskTimeline) {
		if (task.taskId && !snapshot.identity.taskId) {
			snapshot.identity.taskId = task.taskId;
		}
		upsertItem(snapshot, "context", {
			id: `replay:task:${task.taskId}:${task.event}`,
			kind: "task",
			title: formatTaskTitle(task.event),
			detail: safeText(task.summary || task.reason || task.status || task.event),
			status: mapTaskStatus(task.event),
			at: task.at,
			actionRef: task.taskId || undefined,
			rawEventType: `task_${task.event}`,
		});
	}

	if (replaySummary.finalAnswerSummary) {
		upsertItem(snapshot, "finalize", {
			id: "replay:final",
			kind: "final",
			title: "Final response",
			detail: safeText(replaySummary.finalAnswerSummary),
			status: snapshot.status === "completed" || snapshot.status === "safe_stopped" ? "ok" : "pending",
			at: replaySummary.completedAt ?? replaySummary.updatedAt,
			rawEventType: "assistant_final",
		});
	}

	const failure = buildReplayFailure(replaySummary, snapshot.status);
	if (failure) {
		snapshot.failure = failure;
		upsertItem(snapshot, "finalize", {
			id: "replay:failure",
			kind: "failure",
			title: "Run failed",
			detail: failure.message,
			status: failure.class === "cancelled" ? "cancelled" : "failed",
			at: replaySummary.completedAt ?? replaySummary.updatedAt,
			rawEventType: replaySummary.terminalStatus,
		});
	}

	deriveStageStatuses(snapshot);
	snapshot.actions = deriveActions(snapshot);
	return snapshot;
}

function applyRuntimeProgress(
	snapshot: AgentTrajectorySnapshot,
	event: RuntimeProgressWithIdentity,
	index: number,
): void {
	const step = event.step ?? 0;
	switch (event.phase) {
		case "start":
			snapshot.status = "running";
			snapshot.headline = "Agent is preparing";
			snapshot.summary = safeText(event.message);
			setStageStatus(snapshot, "context", "running");
			break;
		case "context":
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = formatContextHeadline(event.contextKey);
			snapshot.summary = safeText(event.message);
			upsertItem(snapshot, "context", {
				id: `live:context:${event.contextKey ?? "general"}`,
				kind: "context",
				title: formatContextTitle(event.contextKey),
				detail: safeText(event.message),
				status: "running",
				rawEventType: event.phase,
			});
			break;
		case "model_request":
			completeRunningItems(snapshot, "context");
			setStageStatus(snapshot, "context", hasKind(snapshot, "context") ? "ok" : "pending");
			setStageStatus(snapshot, "reasoning", "running");
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = "Agent is reasoning";
			snapshot.summary = safeText(event.message);
			upsertItem(snapshot, "reasoning", {
				id: `live:model:${step}`,
				kind: "model",
				title: `Model step ${step}`,
				detail: safeText(event.message),
				status: "running",
				step,
				rawEventType: event.phase,
			});
			break;
		case "model_response":
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = "Model decision received";
			snapshot.summary = safeText(event.reasoningVisibleSummary || event.message);
			upsertItem(snapshot, "reasoning", event.reasoningVisibleSummary ? {
				id: `live:reasoning:${step}`,
				kind: "reasoning",
				title: "FRIDAY 的思路",
				detail: safeText(event.reasoningVisibleSummary),
				status: "ok",
				step,
				rawEventType: event.phase,
				...(event.reasoningProvider ? { reasoningProvider: event.reasoningProvider } : {}),
				...(event.reasoningRawFormat ? { reasoningRawFormat: event.reasoningRawFormat } : {}),
				...(event.reasoningContinuationPolicy ? { reasoningContinuationPolicy: event.reasoningContinuationPolicy } : {}),
			} : {
				id: `live:model:${step}`,
				kind: "model",
				title: `Model step ${step}`,
				detail: safeText(event.message),
				status: "ok",
				step,
				rawEventType: event.phase,
			});
			break;
		case "model_retry": {
			const transport = event.transport;
			const itemStatus = transport?.type === "request_exhausted" ? "failed" : "running";
			if (!isWaitingStatus(snapshot.status)) {
				snapshot.status = itemStatus === "failed" ? "failed" : "running";
				snapshot.headline = "Reconnecting to model";
			}
			snapshot.summary = formatRuntimeTransportDetail(event);
			setStageStatus(snapshot, "reasoning", itemStatus);
			upsertItem(snapshot, "reasoning", {
				id: `live:transport:${transport?.requestId ?? "unknown"}:${step}`,
				kind: "transport",
				title: "Model transport",
				detail: snapshot.summary,
				status: itemStatus,
				step,
				rawEventType: transport?.type ?? event.phase,
			});
			if (itemStatus === "failed") {
				snapshot.failure = {
					class: "model_transport",
					message: snapshot.summary || "Model transport retries exhausted.",
					retryable: true,
					recoverable: true,
				};
			}
			break;
		}
		case "checkpoint": {
			const checkpoint = event.checkpoint;
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = checkpoint?.type === "resume_started"
				? "Resuming from checkpoint"
				: checkpoint?.type === "resume_rejected"
					? "Checkpoint resume skipped"
					: checkpoint?.type === "resume_completed"
						? "Checkpoint resume completed"
						: "Checkpoint saved";
			snapshot.summary = safeText(event.message);
			setStageStatus(snapshot, "reasoning", checkpoint?.type === "resume_rejected" ? "ok" : "running");
			upsertItem(snapshot, "reasoning", {
				id: `live:checkpoint:${checkpoint?.checkpointId ?? index}:${checkpoint?.type ?? "event"}`,
				kind: "system",
				title: checkpoint ? formatCheckpointTitle(runtimeCheckpointToReplayEvent(checkpoint.type)) : "Checkpoint",
				detail: safeText(event.message || checkpoint?.reason || ""),
				status: checkpoint?.type === "resume_completed" || checkpoint?.type === "saved" || checkpoint?.type === "resume_rejected"
					? "ok"
					: "running",
				step,
				actionRef: checkpoint?.checkpointId,
				rawEventType: checkpoint ? `checkpoint_${runtimeCheckpointToReplayEvent(checkpoint.type)}` : event.phase,
			});
			break;
		}
		case "tool_approval":
			snapshot.status = "waiting_for_approval";
			snapshot.headline = "Waiting for approval";
			snapshot.summary = safeText(event.message);
			setStageStatus(snapshot, "review", "waiting");
			upsertItem(snapshot, "review", {
				id: `live:approval:${step}:${event.tool ?? "tool"}:${event.targetPath ?? ""}`,
				kind: "approval",
				title: "Approval required",
				detail: safeText(event.message),
				status: "waiting",
				step,
				tool: event.tool,
				targetPath: event.targetPath,
				rawEventType: event.phase,
			});
			break;
		case "tool_call":
			if (snapshot.status === "idle" || snapshot.status === "waiting_for_approval") {
				snapshot.status = "running";
			}
			setStageStatus(snapshot, "reasoning", hasKind(snapshot, "model") || hasKind(snapshot, "reasoning") ? "ok" : "pending");
			setStageStatus(snapshot, "tools", "running");
			snapshot.headline = "Agent is using a tool";
			snapshot.summary = safeText(event.message);
			upsertItem(snapshot, "tools", {
				id: runtimeToolItemId(event),
				kind: "tool",
				title: formatToolTitle(event.tool, event.targetPath),
				detail: safeText(event.message),
				status: "running",
				step,
				tool: event.tool,
				targetPath: event.targetPath,
				rawEventType: event.phase,
			});
			break;
		case "tool_result": {
			const itemStatus = event.status === "ok" ? "ok" : event.status === "denied" ? "denied" : "failed";
			upsertItem(snapshot, "tools", {
				id: runtimeToolItemId(event),
				kind: "tool",
				title: formatToolTitle(event.tool, event.targetPath),
				detail: safeText(event.summary || event.message),
				status: itemStatus,
				step,
				tool: event.tool,
				targetPath: event.targetPath,
				rawEventType: event.phase,
			});
			if (itemStatus === "failed" || itemStatus === "denied") {
				snapshot.failure = {
					class: itemStatus === "denied" ? "approval" : "tool",
					message: safeText(event.summary || event.message || "Tool failed."),
					retryable: itemStatus === "failed",
					recoverable: itemStatus === "failed",
				};
				snapshot.headline = itemStatus === "denied" ? "Tool denied" : "Tool failed";
			} else {
				snapshot.headline = "Tool result received";
			}
			snapshot.summary = safeText(event.summary || event.message);
			break;
		}
		case "fallback":
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = "Runtime fallback";
			snapshot.summary = safeText(event.message);
			upsertItem(snapshot, "reasoning", {
				id: `live:fallback:${index}`,
				kind: "system",
				title: "Fallback",
				detail: safeText(event.message),
				status: "failed",
				rawEventType: event.phase,
			});
			break;
		case "done":
			completeRunningItems(snapshot, "context");
			completeRunningItems(snapshot, "model");
			completeRunningItems(snapshot, "reasoning");
			completeRunningItems(snapshot, "tool");
			snapshot.status = "completed";
			snapshot.headline = "Agent finished";
			snapshot.summary = safeText(event.message);
			upsertItem(snapshot, "finalize", {
				id: "live:final",
				kind: "final",
				title: "Final response",
				detail: safeText(event.message),
				status: "ok",
				rawEventType: event.phase,
			});
			break;
		case "error": {
			snapshot.status = "failed";
			snapshot.headline = "Agent failed";
			snapshot.summary = safeText(event.message);
			if (!snapshot.failure) {
				snapshot.failure = {
					class: "runtime",
					message: safeText(event.message || "Runtime failed."),
					retryable: true,
					recoverable: true,
				};
			}
			upsertItem(snapshot, "finalize", {
				id: `live:error:${index}`,
				kind: "failure",
				title: "Runtime error",
				detail: safeText(event.message),
				status: "failed",
				rawEventType: event.phase,
			});
			break;
		}
		default:
			break;
	}
}

function extractRuntimeIdentity(events: RuntimeProgressWithIdentity[]): Partial<AgentTrajectoryIdentity> {
	for (const event of events) {
		if (event.turnId || event.taskId || event.traceId || event.conversationId || event.agentId) {
			return {
				turnId: event.turnId,
				taskId: event.taskId,
				traceId: event.traceId,
				conversationId: event.conversationId,
				agentId: event.agentId,
			};
		}
	}
	return {};
}

function mergeIdentity(identity: AgentTrajectoryIdentity, event: RuntimeProgressWithIdentity): void {
	if (event.turnId) identity.turnId = event.turnId;
	if (event.taskId) identity.taskId = event.taskId;
	if (event.traceId) identity.traceId = event.traceId;
	if (event.conversationId) identity.conversationId = event.conversationId;
	if (event.agentId) identity.agentId = event.agentId;
}

function createStages(): AgentTrajectoryStage[] {
	return STAGE_KEYS.map((key) => ({
		key,
		label: STAGE_LABELS[key],
		status: "pending",
		itemIds: [],
	}));
}

function setStageStatus(
	snapshot: AgentTrajectorySnapshot,
	key: AgentTrajectoryStage["key"],
	status: AgentTrajectoryItemStatus,
): void {
	const stage = snapshot.stages.find((item) => item.key === key);
	if (stage) {
		stage.status = status;
	}
}

function upsertItem(
	snapshot: AgentTrajectorySnapshot,
	stageKey: AgentTrajectoryStage["key"],
	item: AgentTrajectoryItem,
): void {
	const existing = snapshot.items.find((entry) => entry.id === item.id);
	const nextItem = {
		...item,
		at: item.at ?? existing?.at ?? snapshot.time.updatedAt,
	};
	if (existing) {
		Object.assign(existing, nextItem);
	} else {
		snapshot.items.push(nextItem);
	}
	const stage = snapshot.stages.find((entry) => entry.key === stageKey);
	if (stage && !stage.itemIds.includes(item.id)) {
		stage.itemIds.push(item.id);
	}
}

function updateSnapshotTimeFromEvent(snapshot: AgentTrajectorySnapshot, at: string | undefined): void {
	const parsed = at ? Date.parse(at) : NaN;
	if (!Number.isFinite(parsed)) {
		return;
	}
	if (!snapshot.time.startedAt) {
		snapshot.time.startedAt = at;
	}
	snapshot.time.updatedAt = at;
}

function finalizeSnapshotTime(snapshot: AgentTrajectorySnapshot): void {
	if (isTerminalTrajectoryStatus(snapshot.status) && snapshot.time.updatedAt) {
		snapshot.time.completedAt = snapshot.time.updatedAt;
	}
	const startedMs = snapshot.time.startedAt ? Date.parse(snapshot.time.startedAt) : NaN;
	const endedAt = snapshot.time.completedAt ?? snapshot.time.updatedAt;
	const endedMs = endedAt ? Date.parse(endedAt) : NaN;
	if (Number.isFinite(startedMs) && Number.isFinite(endedMs)) {
		snapshot.time.durationMs = Math.max(0, endedMs - startedMs);
	}
}

function isTerminalTrajectoryStatus(status: AgentTrajectoryStatus): boolean {
	return status === "completed" || status === "failed" || status === "cancelled" || status === "safe_stopped";
}

function completeRunningItems(snapshot: AgentTrajectorySnapshot, kind: AgentTrajectoryItemKind): void {
	for (const item of snapshot.items) {
		if (item.kind === kind && item.status === "running") {
			item.status = "ok";
		}
	}
}

function hasKind(snapshot: AgentTrajectorySnapshot, kind: AgentTrajectoryItemKind): boolean {
	return snapshot.items.some((item) => item.kind === kind);
}

function deriveStageStatuses(snapshot: AgentTrajectorySnapshot): void {
	for (const stage of snapshot.stages) {
		const items = stage.itemIds
			.map((id) => snapshot.items.find((item) => item.id === id))
			.filter((item): item is AgentTrajectoryItem => Boolean(item));
		if (items.length === 0) {
			continue;
		}
		if (items.some((item) => item.status === "failed")) {
			stage.status = "failed";
		} else if (items.some((item) => item.status === "denied")) {
			stage.status = "denied";
		} else if (items.some((item) => item.status === "waiting")) {
			stage.status = "waiting";
		} else if (items.some((item) => item.status === "running")) {
			stage.status = "running";
		} else if (items.some((item) => item.status === "cancelled")) {
			stage.status = "cancelled";
		} else if (items.every((item) => item.status === "ok")) {
			stage.status = "ok";
		}
	}
	if (snapshot.status === "completed" || snapshot.status === "safe_stopped") {
		for (const stage of snapshot.stages) {
			if (stage.itemIds.length > 0 && stage.status === "pending") {
				stage.status = "ok";
			}
		}
	}
	if (snapshot.status === "failed") {
		setStageStatus(snapshot, "finalize", "failed");
	}
	if (snapshot.status === "cancelled") {
		setStageStatus(snapshot, "finalize", "cancelled");
	}
}

function deriveActions(snapshot: AgentTrajectorySnapshot): AgentTrajectoryAction[] {
	const actions: AgentTrajectoryAction[] = [];
	if (snapshot.status === "running") {
		actions.push({
			id: "cancel",
			label: "Cancel",
			enabled: true,
			targetId: snapshot.identity.taskId,
		});
	}
	if (snapshot.status === "failed" && snapshot.failure?.retryable) {
		if (hasResumableCheckpoint(snapshot)) {
			actions.push({
				id: "resume",
				label: "Resume",
				enabled: true,
				targetId: snapshot.identity.taskId,
			});
		}
		actions.push({
			id: "retry",
			label: "Retry",
			enabled: true,
			targetId: snapshot.identity.taskId,
		});
	}
	if (snapshot.status === "waiting_for_user") {
		actions.push({
			id: "continue",
			label: "Continue",
			enabled: true,
			targetId: snapshot.identity.taskId,
		});
	}
	if (snapshot.status === "waiting_for_approval") {
		const approvalTarget = snapshot.items.find((item) => item.kind === "approval" && item.status === "waiting")?.id ??
			snapshot.identity.taskId;
		actions.push(
			{
				id: "approve",
				label: "Approve",
				enabled: false,
				reason: "Use the approval controls in the conversation.",
				targetId: approvalTarget,
			},
			{
				id: "reject",
				label: "Reject",
				enabled: false,
				reason: "Use the approval controls in the conversation.",
				targetId: approvalTarget,
			},
		);
	}
	for (const mutation of snapshot.mutations) {
		if (mutation.event !== "planned") {
			continue;
		}
		if (snapshot.mutations.some((item) => item.id === mutation.id && item.event !== "planned")) {
			continue;
		}
		actions.push(
			{
				id: "apply",
				label: "Apply",
				enabled: true,
				targetId: mutation.id,
			},
			{
				id: "reject",
				label: "Reject",
				enabled: true,
				targetId: mutation.id,
			},
		);
	}
	if ((snapshot.status === "completed" || snapshot.status === "safe_stopped") && snapshot.privacy.source === "replay") {
		actions.push({
			id: "view_replay",
			label: "View replay",
			enabled: true,
			targetId: snapshot.identity.turnId,
		});
	}
	return actions;
}

function hasResumableCheckpoint(snapshot: AgentTrajectorySnapshot): boolean {
	const rejectedIds = new Set(snapshot.items
		.filter((item) => item.rawEventType === "checkpoint_resume_rejected")
		.map((item) => item.actionRef)
		.filter((value): value is string => Boolean(value)));
	return snapshot.items.some((item) => {
		const actionRef = item.actionRef;
		return item.rawEventType === "checkpoint_saved" &&
			typeof actionRef === "string" &&
			actionRef.length > 0 &&
			!rejectedIds.has(actionRef);
	});
}

function runtimeCheckpointToReplayEvent(
	event: NonNullable<RuntimeProgressEvent["checkpoint"]>["type"],
): TurnReplaySummary["checkpointTimeline"][number]["event"] {
	switch (event) {
		case "resume_started":
			return "resume_started";
		case "resume_rejected":
			return "resume_rejected";
		case "resume_completed":
			return "resume_completed";
		case "saved":
		default:
			return "saved";
	}
}

function runtimeToolItemId(event: RuntimeProgressEvent): string {
	return `live:tool:${event.step ?? 0}:${event.tool ?? "tool"}:${event.targetPath ?? ""}`;
}

function resolveReplayStatus(summary: ReplaySummaryWithIdentity): AgentTrajectoryStatus {
	const waitingTask = [...summary.taskTimeline].reverse().find((task) =>
		task.event === "waiting_for_approval" || task.event === "waiting_for_user"
	);
	if (waitingTask?.event === "waiting_for_approval") {
		return "waiting_for_approval";
	}
	if (waitingTask?.event === "waiting_for_user") {
		return "waiting_for_user";
	}
	if (summary.mutationTimeline.some((mutation) => mutation.event === "conflicted" || mutation.event === "apply_failed")) {
		return "failed";
	}
	if (summary.status === "failed" || summary.status === "cancelled" || summary.status === "safe_stopped") {
		return summary.status;
	}
	if (summary.terminalStatus === "turn_failed") {
		return "failed";
	}
	if (summary.terminalStatus === "turn_cancelled") {
		return "cancelled";
	}
	return summary.status === "open" ? "running" : "completed";
}

function replayHeadline(status: AgentTrajectoryStatus): string {
	switch (status) {
		case "waiting_for_approval":
			return "Waiting for approval";
		case "waiting_for_user":
			return "Waiting for user";
		case "failed":
			return "Agent failed";
		case "cancelled":
			return "Agent cancelled";
		case "safe_stopped":
			return "Agent stopped safely";
		case "completed":
			return "Agent finished";
		case "running":
			return "Agent run is open";
		default:
			return "Agent trajectory";
	}
}

function buildReplayFailure(
	summary: ReplaySummaryWithIdentity,
	status: AgentTrajectoryStatus,
): AgentTrajectoryFailure | undefined {
	const mutationFailure = summary.mutationTimeline.find((mutation) =>
		mutation.event === "conflicted" || mutation.event === "apply_failed"
	);
	if (mutationFailure) {
		return {
			class: "mutation",
			message: safeText(mutationFailure.reason || mutationFailure.summary || "Mutation failed."),
			retryable: mutationFailure.event === "apply_failed",
			recoverable: true,
		};
	}
	if (status === "cancelled") {
		return {
			class: "cancelled",
			message: safeText(summary.errors[0] || "Run cancelled."),
			retryable: false,
			recoverable: true,
		};
	}
	if (status === "failed" && summary.transport.exhausted > 0) {
		return {
			class: "model_transport",
			message: safeText(summary.transport.lastMessage || summary.errors[0] || "Model transport retries exhausted."),
			retryable: true,
			recoverable: true,
		};
	}
	if (status !== "failed" || summary.errors.length === 0) {
		return undefined;
	}
	return {
		class: summary.toolEvents.failed > 0 ? "tool" : summary.modelCalls.failed > 0 ? "model" : "runtime",
		message: safeText(summary.errors[0] ?? "Run failed."),
		retryable: true,
		recoverable: true,
	};
}

function stageForKind(kind: AgentTrajectoryItemKind): AgentTrajectoryStage["key"] {
	switch (kind) {
		case "context":
		case "task":
			return "context";
		case "model":
		case "reasoning":
		case "transport":
		case "system":
			return "reasoning";
		case "tool":
			return "tools";
		case "approval":
		case "mutation":
			return "review";
		case "final":
		case "failure":
		default:
			return "finalize";
	}
}

function mapReplayToolStatus(status: TurnReplaySummary["toolCalls"][number]["status"]): AgentTrajectoryItemStatus {
	switch (status) {
		case "ok":
			return "ok";
		case "failed":
			return "failed";
		case "denied":
			return "denied";
		case "requested":
		default:
			return "running";
	}
}

function mapReplayTransportStatus(
	type: TurnReplaySummary["transportTimeline"][number]["type"],
	snapshotStatus: AgentTrajectoryStatus,
): AgentTrajectoryItemStatus {
	if (type === "request_exhausted") {
		return "failed";
	}
	if (snapshotStatus === "completed" || snapshotStatus === "safe_stopped") {
		return "ok";
	}
	return "running";
}

function mapCheckpointStatus(
	event: TurnReplaySummary["checkpointTimeline"][number]["event"],
	snapshotStatus: AgentTrajectoryStatus,
): AgentTrajectoryItemStatus {
	if (event === "resume_rejected") {
		return snapshotStatus === "failed" ? "failed" : "ok";
	}
	if (event === "resume_started" && !isTerminalTrajectoryStatus(snapshotStatus)) {
		return "running";
	}
	return "ok";
}

function formatRuntimeTransportDetail(event: RuntimeProgressEvent): string {
	const transport = event.transport;
	if (!transport) {
		return safeText(event.message);
	}
	const parts = [
		event.message,
		`attempt ${transport.attempt}/${transport.maxAttempts}`,
		transport.delayMs !== undefined ? `backoff ${transport.delayMs}ms` : "",
		transport.httpStatus !== undefined ? `HTTP ${transport.httpStatus}` : "",
	].filter((part) => part.length > 0);
	return safeText(parts.join("; "));
}

function formatReplayTransportDetail(transport: TurnReplaySummary["transportTimeline"][number]): string {
	const parts = [
		transport.message,
		`attempt ${transport.attempt}/${transport.maxAttempts}`,
		transport.delayMs !== undefined ? `backoff ${transport.delayMs}ms` : "",
		transport.httpStatus !== undefined ? `HTTP ${transport.httpStatus}` : "",
	].filter((part) => part.length > 0);
	return safeText(parts.join("; "));
}

function isWaitingStatus(status: AgentTrajectoryStatus): boolean {
	return status === "waiting_for_approval" || status === "waiting_for_user";
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

function mapTaskStatus(event: TurnReplaySummary["taskTimeline"][number]["event"]): AgentTrajectoryItemStatus {
	switch (event) {
		case "completed":
			return "ok";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "waiting_for_approval":
		case "waiting_for_user":
			return "waiting";
		case "running":
			return "running";
		case "created":
		default:
			return "pending";
	}
}

function formatContextHeadline(contextKey: RuntimeProgressEvent["contextKey"]): string {
	switch (contextKey) {
		case "instructions":
			return "Loading instructions";
		case "skills":
			return "Matching skills";
		case "wiki":
			return "Checking wiki context";
		case "memory":
			return "Loading memory";
		case "compact":
			return "Compacting context";
		default:
			return "Preparing context";
	}
}

function formatContextTitle(contextKey: RuntimeProgressEvent["contextKey"]): string {
	return contextKey ? `Context: ${contextKey}` : "Context";
}

function formatToolTitle(tool: string | undefined, targetPath: string | undefined): string {
	const toolName = tool?.trim() || "tool";
	const target = targetPath?.trim();
	return target ? `${toolName} ${target}` : toolName;
}

function formatMutationTitle(mutation: AgentTrajectoryMutation): string {
	const operation = mutation.operation || "mutation";
	return mutation.targetPath ? `${operation} ${mutation.targetPath}` : operation;
}

function formatTaskTitle(event: TurnReplaySummary["taskTimeline"][number]["event"]): string {
	return `Task ${event.replace(/_/g, " ")}`;
}

function formatCheckpointTitle(event: TurnReplaySummary["checkpointTimeline"][number]["event"]): string {
	switch (event) {
		case "resume_started":
			return "Checkpoint resume";
		case "resume_completed":
			return "Checkpoint resume completed";
		case "resume_rejected":
			return "Checkpoint resume skipped";
		case "saved":
		default:
			return "Checkpoint saved";
	}
}

function formatCheckpointDetail(checkpoint: TurnReplaySummary["checkpointTimeline"][number]): string {
	const boundary = checkpoint.boundary ? ` (${checkpoint.boundary})` : "";
	const reason = safeText(checkpoint.reason);
	if (reason) {
		return `${reason}${boundary}`;
	}
	return `${formatCheckpointTitle(checkpoint.event)}${boundary}`.trim();
}

function safeText(value: string, maxLength = 220): string {
	const text = String(value ?? "")
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\b[A-Za-z0-9_]*(?:secret|token|password|apikey|api_key)[A-Za-z0-9_-]*\s*=\s*\S+/gi, "[redacted]")
		.trim();
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength)}...`;
}
