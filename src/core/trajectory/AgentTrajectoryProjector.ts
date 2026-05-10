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
	AgentTrajectoryPlanState,
	AgentTrajectorySnapshot,
	AgentTrajectoryStage,
	AgentTrajectoryStatus,
} from "./AgentTrajectory";
import {
	inferInteractionRouteFromLegacy,
	type IntakeDecision,
	type IntakeInteractionRoute,
	type PlanState,
	type RuntimePlanProgress,
} from "../agent-kernel/PlanState";

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
type ProjectableNarration =
	| NonNullable<RuntimeProgressWithIdentity["narration"]>
	| TurnReplaySummary["narrationTimeline"][number];
type ProjectableIntake = IntakeDecision & { at?: string };
type ProjectablePlan = RuntimePlanProgress & { at?: string };
type AgentTrajectoryIntakeItem = AgentTrajectoryItem & {
	intakeInteractionRoute?: IntakeInteractionRoute;
	intakeShouldShowProcess?: boolean;
	intakeShouldUseVisiblePlan?: boolean;
};

const STAGE_LABELS: Record<AgentTrajectoryStage["key"], string> = {
	context: "Context",
	reasoning: "Reasoning",
	tools: "Tools",
	review: "Review",
	finalize: "Finalize",
};

const STAGE_KEYS: AgentTrajectoryStage["key"][] = ["context", "reasoning", "tools", "review", "finalize"];
const DEFAULT_RUNTIME_START_COPY = "FRIDAY \u6b63\u5728\u7406\u89e3\u4f60\u7684\u8bf7\u6c42";

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
	snapshot.headline = events.length > 0 ? DEFAULT_RUNTIME_START_COPY : "Agent is idle";
	snapshot.summary = events.length > 0 ? DEFAULT_RUNTIME_START_COPY : "";

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

	for (const [index, intake] of (replaySummary.intakeTimeline ?? []).entries()) {
		projectIntake(snapshot, intake, `replay:intake:${index}`, true);
	}

	for (const plan of replaySummary.planTimeline ?? []) {
		projectPlan(snapshot, plan);
	}

	for (const [index, narration] of (replaySummary.narrationTimeline ?? []).entries()) {
		upsertItem(snapshot, stageForNarration(narration.kind), {
			id: `replay:narration:${narration.kind}:${index}`,
			kind: "narration",
			title: formatNarrationTitle(narration.kind),
			detail: formatNarrationDetail(narration),
			status: mapNarrationStatus(narration.status, true),
			at: narration.at,
			rawEventType: "narration_report",
			narrationKind: narration.kind,
			narrationSource: narration.source,
			...(narration.plan?.length ? { narrationPlan: [...narration.plan] } : {}),
			...(narration.justDone ? { narrationJustDone: narration.justDone } : {}),
			...(narration.next ? { narrationNext: narration.next } : {}),
		});
	}

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
			title: formatTransportTitle(transport.type),
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
			title: "等待确认操作",
			detail: waiting
				? `${replaySummary.approvals.requested - replaySummary.approvals.resolved} 个操作等待你确认。`
				: `${replaySummary.approvals.resolved} 个操作已处理。`,
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
			snapshot.headline = formatRuntimeStartCopy(event.message);
			snapshot.summary = formatRuntimeStartCopy(event.message);
			setStageStatus(snapshot, "context", "running");
			break;
		case "intake": {
			const intake = event.intake ?? {
				complexity: "unclear" as const,
				route: "answer" as const,
				statement: event.message,
				requiresPlan: false,
				shouldShowProcess: false,
				shouldUseVisiblePlan: false,
				source: "fallback" as const,
			};
			projectIntake(snapshot, { ...intake, at: event.at }, `live:intake:${index}`, false);
			break;
		}
		case "plan": {
			if (event.plan) {
				projectPlan(snapshot, event.plan);
			}
			break;
		}
		case "narration": {
			const narration = event.narration ?? {
				kind: "stage_report" as const,
				summary: event.message,
				source: "fallback" as const,
			};
			const itemStatus = mapNarrationStatus(narration.status, false);
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			snapshot.headline = formatNarrationTitle(narration.kind);
			snapshot.summary = safeText(narration.summary || event.message);
			upsertItem(snapshot, stageForNarration(narration.kind), {
				id: `live:narration:${narration.kind}:${index}`,
				kind: "narration",
				title: formatNarrationTitle(narration.kind),
				detail: formatNarrationDetail(narration),
				status: itemStatus,
				step,
				at: event.at,
				rawEventType: "narration_report",
				narrationKind: narration.kind,
				narrationSource: narration.source,
				...(narration.plan?.length ? { narrationPlan: [...narration.plan] } : {}),
				...(narration.justDone ? { narrationJustDone: narration.justDone } : {}),
				...(narration.next ? { narrationNext: narration.next } : {}),
			});
			break;
		}
		case "context":
			snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
			if (!isInternalPreflightContext(event.contextKey)) {
				snapshot.headline = formatContextHeadline(event.contextKey);
				snapshot.summary = safeText(event.message);
			}
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
			if (!isVisibleTransportEvent(transport?.type)) {
				break;
			}
			const itemStatus = transport?.type === "request_exhausted" ? "failed" : "running";
			if (!isWaitingStatus(snapshot.status)) {
				snapshot.status = itemStatus === "failed" ? "failed" : "running";
				snapshot.headline = itemStatus === "failed" ? "请求恢复失败" : "正在恢复请求";
			}
			snapshot.summary = formatRuntimeTransportDetail(event);
			setStageStatus(snapshot, "reasoning", itemStatus);
			upsertItem(snapshot, "reasoning", {
				id: `live:transport:${transport?.requestId ?? "unknown"}:${step}`,
				kind: "transport",
				title: formatTransportTitle(transport?.type),
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
			snapshot.headline = "等待确认";
			snapshot.summary = formatApprovalDetail(event);
			setStageStatus(snapshot, "review", "waiting");
			upsertItem(snapshot, "review", {
				id: `live:approval:${step}:${event.tool ?? "tool"}:${event.targetPath ?? ""}`,
				kind: "approval",
				title: "需要确认操作",
				detail: snapshot.summary,
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
			snapshot.headline = findLatestFailedToolItem(snapshot) ? "Recovering from tool issue" : "Agent is using a tool";
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
				snapshot.headline = itemStatus === "denied" ? "Tool denied" : "Recovering from tool issue";
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
				const failedTool = findLatestFailedToolItem(snapshot);
				snapshot.failure = {
					class: failedTool ? "tool" : "runtime",
					message: safeText(failedTool?.detail || event.message || "Runtime failed."),
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

function projectIntake(
	snapshot: AgentTrajectorySnapshot,
	intake: ProjectableIntake,
	id: string,
	completed: boolean,
): void {
	const statement = safeText(intake.statement);
	if (!statement) {
		return;
	}
	const interactionRoute = intake.interactionRoute ?? inferInteractionRouteFromLegacy(intake);
	snapshot.status = snapshot.status === "idle" ? "running" : snapshot.status;
	snapshot.headline = statement;
	snapshot.summary = statement;
	const item: AgentTrajectoryIntakeItem = {
		id,
		kind: "intake",
		title: statement,
		detail: statement,
		status: completed ? "ok" : "running",
		at: intake.at,
		rawEventType: "intake_decision",
		intakeInteractionRoute: interactionRoute,
		intakeShouldShowProcess: intake.shouldShowProcess,
		intakeShouldUseVisiblePlan: intake.shouldUseVisiblePlan,
	};
	upsertItem(snapshot, "context", item);
}

function projectPlan(
	snapshot: AgentTrajectorySnapshot,
	plan: ProjectablePlan,
): void {
	snapshot.plan = clonePlanState(plan.state);
}

function findLatestFailedToolItem(snapshot: AgentTrajectorySnapshot): AgentTrajectoryItem | null {
	for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
		const item = snapshot.items[index];
		if (!item) {
			continue;
		}
		if (item.kind === "tool" && (item.status === "failed" || item.status === "denied")) {
			return item;
		}
	}
	return null;
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
				label: "允许执行",
				enabled: false,
				reason: "请在确认面板中处理。",
				targetId: approvalTarget,
			},
			{
				id: "reject",
				label: "拒绝",
				enabled: false,
				reason: "请在确认面板中处理。",
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
				label: "应用修改",
				enabled: true,
				targetId: mutation.id,
			},
			{
				id: "reject",
				label: "不应用",
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
		case "intake":
		case "narration":
		case "context":
		case "task":
			return "context";
		case "plan":
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

function stageForNarration(kind: ProjectableNarration["kind"]): AgentTrajectoryStage["key"] {
	return kind === "task_acknowledged" ? "context" : "reasoning";
}

function formatNarrationTitle(kind: ProjectableNarration["kind"]): string {
	switch (kind) {
		case "task_acknowledged":
			return "收到任务";
		case "plan_declared":
			return "整理方案";
		case "stage_report":
		default:
			return "阶段性汇报";
	}
}

function formatNarrationDetail(narration: ProjectableNarration): string {
	if (narration.kind === "task_acknowledged") {
		return safeText(narration.understanding || narration.summary);
	}
	if (narration.kind === "plan_declared") {
		const plan = Array.isArray(narration.plan) && narration.plan.length > 0
			? narration.plan.join("；")
			: "";
		return safeText(plan || narration.summary);
	}
	if (narration.justDone || narration.next) {
		return safeText([narration.justDone, narration.next].filter(Boolean).join("，"));
	}
	return safeText(narration.summary);
}

function clonePlanState(state: PlanState): AgentTrajectoryPlanState {
	return {
		planId: state.planId,
		visibility: state.visibility,
		status: state.status,
		...(state.currentTaskId ? { currentTaskId: state.currentTaskId } : {}),
		tasks: state.tasks.map((task) => ({
			id: task.id,
			title: task.title,
			status: task.status,
			...(task.summary ? { summary: task.summary } : {}),
			...(task.startedAt ? { startedAt: task.startedAt } : {}),
			...(task.completedAt ? { completedAt: task.completedAt } : {}),
		})),
		...(state.createdAt ? { createdAt: state.createdAt } : {}),
		...(state.updatedAt ? { updatedAt: state.updatedAt } : {}),
		...(state.completedAt ? { completedAt: state.completedAt } : {}),
	};
}

function mapNarrationStatus(
	status: ProjectableNarration["status"] | undefined,
	completedReplay: boolean,
): AgentTrajectoryItemStatus {
	if (completedReplay && status === "running") {
		return "ok";
	}
	switch (status) {
		case "running":
			return "running";
		case "waiting":
			return "waiting";
		case "failed":
			return "failed";
		case "completed":
		default:
			return "ok";
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
	if (transport.type === "request_exhausted") {
		return "请求多次未成功，请稍后重试。";
	}
	return formatRecoveryAttempt(transport.attempt, transport.maxAttempts);
}

function formatTransportTitle(type: string | undefined): string {
	if (type === "request_exhausted") {
		return "请求恢复失败";
	}
	return "恢复请求";
}

function formatApprovalDetail(event: RuntimeProgressEvent): string {
	const tool = event.tool?.trim().toLowerCase();
	if (tool === "exec") {
		return "FRIDAY 需要运行一个本地命令，确认后才会继续。";
	}
	if (event.targetPath) {
		return "FRIDAY 已准备好需要确认的操作，确认后才会继续。";
	}
	return "FRIDAY 暂停在一个需要你确认的操作上。";
}

function formatReplayTransportDetail(transport: TurnReplaySummary["transportTimeline"][number]): string {
	if (transport.type === "request_exhausted") {
		return "请求多次未成功，请稍后重试。";
	}
	return formatRecoveryAttempt(transport.attempt, transport.maxAttempts);
}

function isVisibleTransportEvent(type: string | undefined): boolean {
	return type === "retry_scheduled" || type === "retry_started" || type === "request_exhausted";
}

function formatRecoveryAttempt(attempt: number, maxAttempts: number): string {
	const displayMax = Math.max(1, maxAttempts - 1);
	return `网络波动，正在恢复请求（第 ${attempt}/${displayMax} 次）`;
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

function formatRuntimeStartCopy(message: string | undefined): string {
	const text = safeText(message ?? "");
	if (!text || isTechnicalRuntimeStartCopy(text)) {
		return DEFAULT_RUNTIME_START_COPY;
	}
	return text;
}

function isTechnicalRuntimeStartCopy(text: string): boolean {
	const normalized = text.toLowerCase().replace(/\.+$/, "");
	return normalized === "runtime started" || normalized === ["agent", "is", "preparing"].join(" ");
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

function isInternalPreflightContext(contextKey: RuntimeProgressEvent["contextKey"]): boolean {
	return contextKey === "instructions" ||
		contextKey === "skills" ||
		contextKey === "memory" ||
		contextKey === "compact";
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
