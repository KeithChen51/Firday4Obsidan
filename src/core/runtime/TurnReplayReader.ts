import { readFile } from "fs/promises";

import type { TurnEventRecord, TurnEventRef } from "./TurnEventLog";
import type { ReasoningArtifact } from "../llm/ReasoningArtifact";
import type { IntakeDecision, PlanState, RuntimePlanProgress } from "../agent-kernel/PlanState";
import {
	getIntakeRouteDefaults,
	inferInteractionRouteFromLegacy,
	isIntakeInteractionRoute,
} from "../agent-kernel/PlanState";

export interface TurnReplayReaderOptions {
	resolveTurnPath: (ref: TurnEventRef) => string;
}

export interface TurnReplayValidation {
	ok: boolean;
	errors: string[];
}

export interface TurnReplaySummary extends TurnEventRef {
	traceId?: string;
	agentId?: string;
	totalEvents: number;
	eventTypes: string[];
	status: "completed" | "failed" | "cancelled" | "safe_stopped" | "open";
	startedAt: string;
	updatedAt: string;
	completedAt?: string;
	durationMs: number;
	modelCalls: {
		requested: number;
		completed: number;
		failed: number;
	};
	intakeTimeline: Array<IntakeDecision & { at?: string }>;
	planTimeline: Array<RuntimePlanProgress & { at?: string }>;
	reasoningTimeline: Array<{
		step: number;
		provider: ReasoningArtifact["provider"] | "unknown";
		rawFormat: ReasoningArtifact["rawFormat"] | "unknown";
		continuationPolicy: ReasoningArtifact["continuationPolicy"] | "drop";
		visibleSummary: string;
		warnings: string[];
		at?: string;
	}>;
	narrationTimeline: Array<{
		kind: "task_acknowledged" | "plan_declared" | "stage_report";
		summary: string;
		source: "runtime" | "model" | "fallback";
		status?: "running" | "completed" | "waiting" | "failed";
		understanding?: string;
		plan?: string[];
		justDone?: string;
		next?: string;
		at?: string;
	}>;
	transport: {
		retries: number;
		exhausted: number;
		lastStatus?: number;
		lastMessage: string;
	};
	checkpoints: {
		saved: number;
		resumed: number;
		rejected: number;
		latestBoundary: string;
	};
	checkpointTimeline: Array<{
		event: "saved" | "resume_started" | "resume_rejected" | "resume_completed";
		checkpointId: string;
		boundary: string;
		reason: string;
		step?: number;
		nextStep?: number;
		canAutoResume?: boolean;
		at?: string;
	}>;
	transportTimeline: Array<{
		type: "retry_scheduled" | "retry_started" | "request_exhausted";
		step: number;
		attempt: number;
		maxAttempts: number;
		delayMs?: number;
		httpStatus?: number;
		message: string;
		at?: string;
	}>;
	toolEvents: {
		requested: number;
		completed: number;
		failed: number;
		denied: number;
	};
	toolCalls: Array<{
		step: number;
		tool: string;
		toolCallId: string;
		status: "requested" | "ok" | "failed" | "denied";
		targetPath: string;
		at?: string;
	}>;
	recoveryTimeline: Array<{
		event: "tool_failed" | "tool_denied";
		step: number;
		tool: string;
		toolCallId: string;
		targetPath: string;
		failureClass: string;
		recoverable: boolean;
		retryable: boolean;
		code: string;
		message: string;
		candidatePaths: string[];
		suggestedArgs: Record<string, unknown>;
		at?: string;
	}>;
	loopPreventionTimeline: Array<{
		event: "duplicate_failed_tool_call" | "loop_control_stop" | "max_tool_iterations";
		channel?: string;
		step: number;
		tool: string;
		toolCallId: string;
		status: string;
		summary: string;
		reason?: string;
		repetitionKind?: string;
		maxIterations?: number;
		configuredMaxIterations?: number;
		at?: string;
	}>;
	approvals: {
		requested: number;
		resolved: number;
		approved: number;
		denied: number;
	};
	mutations: {
		planned: number;
		applied: number;
		rejected: number;
		conflicted: number;
		applyFailed: number;
	};
	mutationTimeline: Array<{
		id: string;
		event: "planned" | "applied" | "rejected" | "conflicted" | "apply_failed";
		operation: string;
		targetPath: string;
		status: string;
		summary: string;
		reason: string;
		at?: string;
	}>;
	taskTimeline: Array<{
		taskId: string;
		event: "created" | "running" | "waiting_for_approval" | "waiting_for_user" | "failed" | "cancelled" | "completed";
		status: string;
		summary: string;
		reason: string;
		at?: string;
	}>;
	finalAnswerSummary: string;
	errors: string[];
	terminalStatus: "turn_completed" | "turn_failed" | "turn_cancelled" | "open";
}

const TERMINAL_EVENTS = new Set(["turn_completed", "turn_failed", "turn_cancelled"]);
const POST_TURN_REVIEW_EVENTS = new Set([
	"mutation_applied",
	"mutation_rejected",
	"mutation_conflicted",
	"mutation_apply_failed",
	"task_waiting_for_approval",
	"task_waiting_for_user",
	"task_failed",
	"task_cancelled",
	"task_completed",
]);

export class TurnReplayReader {
	constructor(private readonly options: TurnReplayReaderOptions) {}

	async readTurn(ref: TurnEventRef): Promise<TurnEventRecord[]> {
		const filePath = this.options.resolveTurnPath(ref);
		try {
			const content = await readFile(filePath, "utf8");
			return content
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as TurnEventRecord);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	validateOrder(events: TurnEventRecord[]): TurnReplayValidation {
		const errors: string[] = [];
		if (events.length === 0) {
			return { ok: false, errors: ["Turn event log is empty."] };
		}
		const first = events[0] as TurnEventRecord;
		if (first.type !== "turn_started") {
			errors.push(`First event must be turn_started, got ${first.type}.`);
		}
		for (const [index, event] of events.entries()) {
			const expectedSequence = index + 1;
			if (event.sequence !== expectedSequence) {
				errors.push(`Expected sequence ${expectedSequence} but found ${event.sequence}.`);
			}
			if (event.conversationId !== first.conversationId) {
				errors.push(`Event ${event.sequence} has mismatched conversationId.`);
			}
			if (event.turnId !== first.turnId) {
				errors.push(`Event ${event.sequence} has mismatched turnId.`);
			}
		}
		const terminalIndex = events.findIndex((event) => TERMINAL_EVENTS.has(event.type));
		if (terminalIndex >= 0 && terminalIndex !== events.length - 1) {
			const terminalEvent = events[terminalIndex] as TurnEventRecord;
			const invalidLateEvent = events
				.slice(terminalIndex + 1)
				.find((event) => !POST_TURN_REVIEW_EVENTS.has(event.type));
			if (invalidLateEvent) {
				errors.push(`Found events after terminal event ${terminalEvent.type}.`);
			}
		}
		return { ok: errors.length === 0, errors };
	}

	summarize(events: TurnEventRecord[]): TurnReplaySummary {
		const first = events[0];
		const terminal = [...events].reverse().find((event) => TERMINAL_EVENTS.has(event.type));
		const last = events[events.length - 1];
		const status = this.resolveStatus(terminal);
		const finalAnswer = [...events].reverse().find((event) => event.type === "assistant_final");
		const toolCalls = this.summarizeToolCalls(events);
		const transportTimeline = this.summarizeTransportTimeline(events);
		const checkpointTimeline = this.summarizeCheckpointTimeline(events);
		const lastTransport = transportTimeline[transportTimeline.length - 1];
		const latestSavedCheckpoint = [...checkpointTimeline].reverse().find((event) => event.event === "saved");
		const startedAt = first?.at ?? "";
		const updatedAt = last?.at ?? startedAt;
		const completedAt = terminal?.at;
		return {
			conversationId: first?.conversationId ?? "",
			turnId: first?.turnId ?? "",
			taskId: first?.taskId,
			traceId: this.findPayloadText(events, "traceId") || undefined,
			agentId: this.findPayloadText(events, "agentId") || undefined,
			totalEvents: events.length,
			eventTypes: events.map((event) => event.type),
			status,
			startedAt,
			updatedAt,
			...(completedAt ? { completedAt } : {}),
			durationMs: calculateDurationMs(startedAt, completedAt ?? updatedAt),
			modelCalls: {
				requested: events.filter((event) => event.type === "model_requested").length,
				completed: events.filter((event) => event.type === "model_completed").length,
				failed: events.filter((event) => event.type === "model_failed").length,
			},
			intakeTimeline: this.summarizeIntakeTimeline(events),
			planTimeline: this.summarizePlanTimeline(events),
			reasoningTimeline: this.summarizeReasoningTimeline(events),
			narrationTimeline: this.summarizeNarrationTimeline(events),
			transport: {
				retries: transportTimeline.filter((event) => event.type === "retry_scheduled").length,
				exhausted: transportTimeline.filter((event) => event.type === "request_exhausted").length,
				...(lastTransport?.httpStatus !== undefined ? { lastStatus: lastTransport.httpStatus } : {}),
				lastMessage: lastTransport?.message ?? "",
			},
			checkpoints: {
				saved: checkpointTimeline.filter((event) => event.event === "saved").length,
				resumed: checkpointTimeline.filter((event) => event.event === "resume_started").length,
				rejected: checkpointTimeline.filter((event) => event.event === "resume_rejected").length,
				latestBoundary: latestSavedCheckpoint?.boundary ?? "",
			},
			checkpointTimeline,
			transportTimeline,
			toolEvents: {
				requested: events.filter((event) => event.type === "tool_requested").length,
				completed: events.filter((event) => event.type === "tool_completed").length,
				failed: events.filter((event) => event.type === "tool_failed").length,
				denied: events.filter((event) => event.type === "tool_denied").length,
			},
			toolCalls,
			recoveryTimeline: this.summarizeRecoveryTimeline(events),
			loopPreventionTimeline: this.summarizeLoopPreventionTimeline(events),
			approvals: {
				requested: events.filter((event) => event.type === "tool_approval_requested").length,
				resolved: events.filter((event) => event.type === "tool_approval_resolved").length,
				approved: events.filter((event) =>
					event.type === "tool_approval_resolved" && event.payload.approved === true
				).length,
				denied: events.filter((event) =>
					event.type === "tool_approval_resolved" && event.payload.approved === false
				).length,
			},
			mutations: {
				planned: events.filter((event) => event.type === "mutation_planned").length,
				applied: events.filter((event) => event.type === "mutation_applied").length,
				rejected: events.filter((event) => event.type === "mutation_rejected").length,
				conflicted: events.filter((event) => event.type === "mutation_conflicted").length,
				applyFailed: events.filter((event) => event.type === "mutation_apply_failed").length,
			},
			mutationTimeline: this.summarizeMutationTimeline(events),
			taskTimeline: this.summarizeTaskTimeline(events),
			finalAnswerSummary: this.getPayloadText(finalAnswer, "summary") || this.getPayloadText(finalAnswer, "text"),
			errors: events
				.filter((event) => [
					"model_failed",
					"tool_failed",
					"parse_error",
					"turn_failed",
					"turn_cancelled",
					"mutation_apply_failed",
				].includes(event.type))
				.map((event) =>
					this.getPayloadText(event, "error") ||
					this.getPayloadText(event, "summary") ||
					this.getPayloadText(event, "message")
				)
				.filter((item) => item.length > 0),
			terminalStatus: terminal?.type === "turn_completed" || terminal?.type === "turn_failed" || terminal?.type === "turn_cancelled"
				? terminal.type
				: "open",
		};
	}

	private summarizeReasoningTimeline(events: TurnEventRecord[]): TurnReplaySummary["reasoningTimeline"] {
		const timeline: TurnReplaySummary["reasoningTimeline"] = [];
		for (const event of events) {
			if (event.type !== "model_completed") {
				continue;
			}
			const visibleSummary = this.getPayloadText(event, "reasoningVisibleSummary");
			const hasReasoning = event.payload.hasReasoning === true || visibleSummary.length > 0;
			if (!hasReasoning) {
				continue;
			}
			timeline.push({
				step: this.getPayloadNumber(event, "step"),
				provider: this.getPayloadText(event, "reasoningProvider") as ReasoningArtifact["provider"] || "unknown",
				rawFormat: this.getPayloadText(event, "reasoningRawFormat") as ReasoningArtifact["rawFormat"] || "unknown",
				continuationPolicy: this.getPayloadText(event, "reasoningContinuationPolicy") as ReasoningArtifact["continuationPolicy"] || "drop",
				visibleSummary,
				warnings: this.getPayloadStringArray(event, "reasoningWarnings"),
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizeNarrationTimeline(events: TurnEventRecord[]): TurnReplaySummary["narrationTimeline"] {
		const timeline: TurnReplaySummary["narrationTimeline"] = [];
		for (const event of events) {
			if (event.type !== "narration_report") {
				continue;
			}
			const kind = this.toNarrationKind(this.getPayloadText(event, "kind"));
			if (!kind) {
				continue;
			}
			const summary = this.getPayloadText(event, "summary") || this.getPayloadText(event, "message");
			if (!summary) {
				continue;
			}
			const source = this.toNarrationSource(this.getPayloadText(event, "source"));
			const status = this.toNarrationStatus(this.getPayloadText(event, "status"));
			const understanding = this.getPayloadText(event, "understanding");
			const plan = this.getPayloadStringArray(event, "plan").filter((item) => item.trim().length > 0);
			const justDone = this.getPayloadText(event, "justDone");
			const next = this.getPayloadText(event, "next");
			timeline.push({
				kind,
				summary,
				source,
				...(status ? { status } : {}),
				...(understanding ? { understanding } : {}),
				...(plan.length > 0 ? { plan } : {}),
				...(justDone ? { justDone } : {}),
				...(next ? { next } : {}),
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizeIntakeTimeline(events: TurnEventRecord[]): TurnReplaySummary["intakeTimeline"] {
		const timeline: TurnReplaySummary["intakeTimeline"] = [];
		for (const event of events) {
			if (event.type !== "intake_decision") {
				continue;
			}
			const statement = this.getPayloadText(event, "statement");
			if (!statement) {
				continue;
			}
			const legacyComplexity = this.toOptionalIntakeComplexity(this.getPayloadText(event, "complexity"));
			const legacyRoute = this.toOptionalIntakeRoute(this.getPayloadText(event, "route"));
			const interactionRoute = this.toOptionalIntakeInteractionRoute(this.getPayloadText(event, "interactionRoute")) ??
				inferInteractionRouteFromLegacy({
					...(legacyComplexity ? { complexity: legacyComplexity } : {}),
					...(legacyRoute ? { route: legacyRoute } : {}),
					requiresPlan: this.getPayloadOptionalBoolean(event, "requiresPlan"),
					shouldShowProcess: this.getPayloadOptionalBoolean(event, "shouldShowProcess"),
					shouldUseVisiblePlan: this.getPayloadOptionalBoolean(event, "shouldUseVisiblePlan"),
				});
			const defaults = getIntakeRouteDefaults(interactionRoute);
			timeline.push({
				complexity: legacyComplexity ?? defaults.complexity,
				route: legacyRoute ?? defaults.route,
				interactionRoute,
				statement,
				requiresPlan: this.getPayloadOptionalBoolean(event, "requiresPlan") ?? defaults.requiresPlan,
				shouldShowProcess: this.getPayloadOptionalBoolean(event, "shouldShowProcess") ??
					this.getPayloadOptionalBoolean(event, "requiresPlan") ??
					defaults.shouldShowProcess,
				shouldUseVisiblePlan: this.getPayloadOptionalBoolean(event, "shouldUseVisiblePlan") ??
					this.getPayloadOptionalBoolean(event, "requiresPlan") ??
					defaults.shouldUseVisiblePlan,
				source: this.toIntakeSource(this.getPayloadText(event, "source")),
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizePlanTimeline(events: TurnEventRecord[]): TurnReplaySummary["planTimeline"] {
		const timeline: TurnReplaySummary["planTimeline"] = [];
		for (const event of events) {
			if (!["plan_create", "plan_update", "plan_revise", "plan_complete", "plan_skip"].includes(event.type)) {
				continue;
			}
			const state = this.getPlanStateFromEvent(event);
			if (!state) {
				continue;
			}
			timeline.push({
				type: event.type as RuntimePlanProgress["type"],
				state,
				taskId: this.getPayloadText(event, "taskId") || undefined,
				message: this.getPayloadText(event, "message") || this.getPayloadText(event, "summary") || undefined,
				reason: this.getPayloadText(event, "reason") || undefined,
				changes: this.getPlanRevisionChangesFromEvent(event),
				at: event.at,
			});
		}
		return timeline;
	}

	private toIntakeComplexity(value: string): IntakeDecision["complexity"] {
		return this.toOptionalIntakeComplexity(value) ?? "unclear";
	}

	private toIntakeRoute(value: string): IntakeDecision["route"] {
		return this.toOptionalIntakeRoute(value) ?? "answer";
	}

	private toOptionalIntakeComplexity(value: string): IntakeDecision["complexity"] | undefined {
		if (value === "simple" || value === "light" || value === "complex" || value === "unclear") {
			return value;
		}
		return undefined;
	}

	private toOptionalIntakeRoute(value: string): IntakeDecision["route"] | undefined {
		if (value === "answer" || value === "clarify" || value === "plan_and_execute") {
			return value;
		}
		return undefined;
	}

	private toOptionalIntakeInteractionRoute(value: string): IntakeDecision["interactionRoute"] | undefined {
		return isIntakeInteractionRoute(value) ? value : undefined;
	}

	private toIntakeSource(value: string): IntakeDecision["source"] {
		if (value === "runtime" || value === "model" || value === "fallback") {
			return value;
		}
		return "fallback";
	}

	private getPlanStateFromEvent(event: TurnEventRecord): PlanState | null {
		const rawState = this.getPayloadRecord(event, "state");
		const planId = this.getRecordText(rawState, "planId");
		const rawTasks = rawState.tasks;
		if (!planId || !Array.isArray(rawTasks)) {
			return null;
		}
		const tasks = rawTasks
			.filter((task): task is Record<string, unknown> => Boolean(task && typeof task === "object" && !Array.isArray(task)))
			.map((task) => ({
				id: this.getRecordText(task, "id"),
				title: this.getRecordText(task, "title"),
				status: this.toPlanTaskStatus(this.getRecordText(task, "status")),
				...(this.getRecordText(task, "summary") ? { summary: this.getRecordText(task, "summary") } : {}),
				...(this.getRecordText(task, "startedAt") ? { startedAt: this.getRecordText(task, "startedAt") } : {}),
				...(this.getRecordText(task, "completedAt") ? { completedAt: this.getRecordText(task, "completedAt") } : {}),
			}))
			.filter((task) => task.id && task.title);
		return {
			planId,
			visibility: this.toPlanVisibility(this.getRecordText(rawState, "visibility")),
			status: this.toPlanStateStatus(this.getRecordText(rawState, "status")),
			...(this.getRecordText(rawState, "currentTaskId") ? { currentTaskId: this.getRecordText(rawState, "currentTaskId") } : {}),
			tasks,
			...(this.getRecordText(rawState, "createdAt") ? { createdAt: this.getRecordText(rawState, "createdAt") } : {}),
			...(this.getRecordText(rawState, "updatedAt") ? { updatedAt: this.getRecordText(rawState, "updatedAt") } : {}),
			...(this.getRecordText(rawState, "completedAt") ? { completedAt: this.getRecordText(rawState, "completedAt") } : {}),
		};
	}

	private getPlanRevisionChangesFromEvent(event: TurnEventRecord): RuntimePlanProgress["changes"] | undefined {
		const changes = this.getPayloadValue(event, "changes");
		if (!Array.isArray(changes)) {
			return undefined;
		}
		const normalized = changes
			.filter((change): change is Record<string, unknown> => Boolean(change && typeof change === "object" && !Array.isArray(change)))
			.map((change) => ({
				type: this.toPlanRevisionChangeType(this.getRecordText(change, "type")),
				...(this.getRecordText(change, "taskId") ? { taskId: this.getRecordText(change, "taskId") } : {}),
				...(this.getRecordText(change, "title") ? { title: this.getRecordText(change, "title") } : {}),
				...(this.getRecordText(change, "status") ? { status: this.toPlanTaskStatus(this.getRecordText(change, "status")) } : {}),
			}))
			.filter((change): change is NonNullable<RuntimePlanProgress["changes"]>[number] => Boolean(change.type));
		return normalized.length > 0 ? normalized : undefined;
	}

	private toPlanRevisionChangeType(value: string): NonNullable<RuntimePlanProgress["changes"]>[number]["type"] | "" {
		if (value === "add" || value === "remove" || value === "rename" || value === "reorder" || value === "status") {
			return value;
		}
		return "";
	}

	private toPlanVisibility(value: string): PlanState["visibility"] {
		if (value === "hidden" || value === "task_bar" || value === "visible" || value === "internal") {
			return value;
		}
		return "task_bar";
	}

	private toPlanTaskStatus(value: string): PlanState["tasks"][number]["status"] {
		if (value === "pending" || value === "in_progress" || value === "completed" || value === "skipped" || value === "failed" || value === "blocked") {
			return value;
		}
		return "pending";
	}

	private toPlanStateStatus(value: string): PlanState["status"] {
		if (value === "pending" || value === "running" || value === "completed" || value === "skipped" || value === "failed") {
			return value;
		}
		return "running";
	}

	private toNarrationKind(value: string): TurnReplaySummary["narrationTimeline"][number]["kind"] | null {
		if (value === "task_acknowledged" || value === "plan_declared" || value === "stage_report") {
			return value;
		}
		return null;
	}

	private toNarrationSource(value: string): TurnReplaySummary["narrationTimeline"][number]["source"] {
		if (value === "runtime" || value === "model" || value === "fallback") {
			return value;
		}
		return "fallback";
	}

	private toNarrationStatus(value: string): TurnReplaySummary["narrationTimeline"][number]["status"] | undefined {
		if (value === "running" || value === "completed" || value === "waiting" || value === "failed") {
			return value;
		}
		return undefined;
	}

	async readSummary(ref: TurnEventRef): Promise<TurnReplaySummary> {
		return this.summarize(await this.readTurn(ref));
	}

	private resolveStatus(
		terminal: TurnEventRecord | undefined,
	): TurnReplaySummary["status"] {
		if (!terminal) {
			return "open";
		}
		if (terminal.type === "turn_failed") {
			return "failed";
		}
		if (terminal.type === "turn_cancelled") {
			return "cancelled";
		}
		if (terminal.type === "turn_completed" && terminal.payload.status === "safe_stopped") {
			return "safe_stopped";
		}
		return "completed";
	}

	private summarizeToolCalls(events: TurnEventRecord[]): TurnReplaySummary["toolCalls"] {
		const calls: TurnReplaySummary["toolCalls"] = events
			.filter((event) => event.type === "tool_requested")
			.map((event) => ({
				step: this.getPayloadNumber(event, "step"),
				tool: this.getPayloadText(event, "tool"),
				toolCallId: this.getPayloadText(event, "toolCallId"),
				status: "requested" as const,
				targetPath: this.getPayloadText(event, "targetPath"),
				at: event.at,
			}));
		for (const event of events) {
			if (!["tool_completed", "tool_failed", "tool_denied"].includes(event.type)) {
				continue;
			}
			const toolCallId = this.getPayloadText(event, "toolCallId");
			const step = this.getPayloadNumber(event, "step");
			const tool = this.getPayloadText(event, "tool");
			const call = calls.find((item) =>
				(toolCallId && item.toolCallId === toolCallId) || (item.step === step && item.tool === tool)
			);
			if (!call) {
				continue;
			}
			call.status = event.type === "tool_completed"
				? "ok"
				: event.type === "tool_denied"
					? "denied"
					: "failed";
			call.at = call.at || event.at;
			if (!call.targetPath) {
				call.targetPath = this.getPayloadText(event, "targetPath");
			}
		}
		return calls;
	}

	private summarizeRecoveryTimeline(events: TurnEventRecord[]): TurnReplaySummary["recoveryTimeline"] {
		const timeline: TurnReplaySummary["recoveryTimeline"] = [];
		for (const event of events) {
			if (event.type !== "tool_failed" && event.type !== "tool_denied") {
				continue;
			}
			const recovery = this.getPayloadRecord(event, "recovery");
			const candidatePaths = this.getStringArrayFromPayloadOrRecord(event, recovery, "candidatePaths");
			const suggestedArgs = this.getRecordFromPayloadOrRecord(event, recovery, "suggestedArgs");
			if (candidatePaths.length === 0 && Object.keys(suggestedArgs).length === 0) {
				continue;
			}
			timeline.push({
				event: event.type,
				step: this.getPayloadNumber(event, "step"),
				tool: this.getPayloadText(event, "tool"),
				toolCallId: this.getPayloadText(event, "toolCallId"),
				targetPath: this.getPayloadText(event, "targetPath"),
				failureClass: this.getPayloadText(event, "failureClass"),
				recoverable: this.getBooleanFromPayloadOrRecord(event, recovery, "recoverable"),
				retryable: this.getBooleanFromPayloadOrRecord(event, recovery, "retryable"),
				code: this.getTextFromPayloadOrRecord(event, recovery, "code"),
				message: this.getTextFromPayloadOrRecord(event, recovery, "message") ||
					this.getPayloadText(event, "summary"),
				candidatePaths,
				suggestedArgs,
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizeLoopPreventionTimeline(events: TurnEventRecord[]): TurnReplaySummary["loopPreventionTimeline"] {
		const timeline: TurnReplaySummary["loopPreventionTimeline"] = [];
		for (const event of events) {
			if (event.type === "loop_control_stop") {
				const channel = this.getPayloadText(event, "channel");
				timeline.push({
					event: "loop_control_stop",
					...(channel ? { channel } : {}),
					step: this.getPayloadNumber(event, "step"),
					tool: this.getPayloadText(event, "tool"),
					toolCallId: this.getPayloadText(event, "toolCallId"),
					status: this.getPayloadText(event, "status"),
					summary: this.getPayloadText(event, "summary") || this.getPayloadText(event, "message"),
					reason: this.getPayloadText(event, "reason") || this.getPayloadText(event, "stopReason"),
					repetitionKind: this.getPayloadText(event, "repetitionKind"),
					at: event.at,
				});
				continue;
			}
			if (event.type === "max_tool_iterations") {
				const channel = this.getPayloadText(event, "channel");
				const maxIterations = this.getPayloadOptionalNumber(event, "maxIterations");
				const configuredMaxIterations = this.getPayloadOptionalNumber(event, "configuredMaxIterations");
				const reason = this.getPayloadText(event, "reason");
				timeline.push({
					event: "max_tool_iterations",
					...(channel ? { channel } : {}),
					step: this.getPayloadNumber(event, "step"),
					tool: this.getPayloadText(event, "tool"),
					toolCallId: this.getPayloadText(event, "toolCallId"),
					status: this.getPayloadText(event, "status"),
					summary: this.getPayloadText(event, "summary") || this.getPayloadText(event, "message"),
					...(reason ? { reason } : {}),
					...(maxIterations !== undefined ? { maxIterations } : {}),
					...(configuredMaxIterations !== undefined ? { configuredMaxIterations } : {}),
					at: event.at,
				});
				continue;
			}
			if (event.type !== "tool_failed") {
				continue;
			}
			const recovery = this.getPayloadRecord(event, "recovery");
			const failureClass = this.getPayloadText(event, "failureClass");
			const recoveryCode = this.getRecordText(recovery, "code");
			if (failureClass !== "duplicate_failed_tool_call" && recoveryCode !== "duplicate_failed_tool_call") {
				continue;
			}
			timeline.push({
				event: "duplicate_failed_tool_call",
				step: this.getPayloadNumber(event, "step"),
				tool: this.getPayloadText(event, "tool"),
				toolCallId: this.getPayloadText(event, "toolCallId"),
				status: this.getPayloadText(event, "status"),
				summary: this.getRecordText(recovery, "message") ||
					this.getPayloadText(event, "summary") ||
					this.getPayloadText(event, "message"),
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizeTransportTimeline(events: TurnEventRecord[]): TurnReplaySummary["transportTimeline"] {
		const timeline: TurnReplaySummary["transportTimeline"] = [];
		for (const event of events) {
			if (event.type !== "model_retry") {
				continue;
			}
			const transport = this.getPayloadRecord(event, "transport");
			const type = this.getRecordText(transport, "type");
			if (type !== "retry_scheduled" && type !== "retry_started" && type !== "request_exhausted") {
				continue;
			}
			const delayMs = this.getRecordOptionalNumber(transport, "delayMs");
			const httpStatus = this.getRecordOptionalNumber(transport, "httpStatus");
			timeline.push({
				type,
				step: this.getPayloadNumber(event, "step"),
				attempt: this.getRecordNumber(transport, "attempt"),
				maxAttempts: this.getRecordNumber(transport, "maxAttempts"),
				...(delayMs !== undefined ? { delayMs } : {}),
				...(httpStatus !== undefined ? { httpStatus } : {}),
				message: this.getPayloadText(event, "summary") ||
					this.getPayloadText(event, "message") ||
					this.getRecordText(transport, "message"),
				at: event.at,
			});
		}
		return timeline;
	}

	private summarizeCheckpointTimeline(events: TurnEventRecord[]): TurnReplaySummary["checkpointTimeline"] {
		const timeline: TurnReplaySummary["checkpointTimeline"] = [];
		for (const event of events) {
			if (![
				"checkpoint_saved",
				"checkpoint_resume_started",
				"checkpoint_resume_rejected",
				"checkpoint_resume_completed",
			].includes(event.type)) {
				continue;
			}
			const step = this.getPayloadOptionalNumber(event, "step");
			const nextStep = this.getPayloadOptionalNumber(event, "nextStep");
			const canAutoResume = this.getPayloadOptionalBoolean(event, "canAutoResume");
			timeline.push({
				event: this.toCheckpointTimelineEvent(event.type),
				checkpointId: this.getPayloadText(event, "checkpointId"),
				boundary: this.getPayloadText(event, "boundary"),
				reason: this.getPayloadText(event, "reason") ||
					this.getPayloadText(event, "summary") ||
					this.getPayloadText(event, "message"),
				...(step !== undefined ? { step } : {}),
				...(nextStep !== undefined ? { nextStep } : {}),
				...(canAutoResume !== undefined ? { canAutoResume } : {}),
				at: event.at,
			});
		}
		return timeline;
	}

	private toCheckpointTimelineEvent(type: string): TurnReplaySummary["checkpointTimeline"][number]["event"] {
		switch (type) {
			case "checkpoint_resume_started":
				return "resume_started";
			case "checkpoint_resume_rejected":
				return "resume_rejected";
			case "checkpoint_resume_completed":
				return "resume_completed";
			case "checkpoint_saved":
			default:
				return "saved";
		}
	}

	private summarizeMutationTimeline(events: TurnEventRecord[]): TurnReplaySummary["mutationTimeline"] {
		return events
			.filter((event) => [
				"mutation_planned",
				"mutation_applied",
				"mutation_rejected",
				"mutation_conflicted",
				"mutation_apply_failed",
			].includes(event.type))
			.map((event) => ({
				id: this.getPayloadText(event, "id"),
				event: this.toMutationTimelineEvent(event.type),
				operation: this.getPayloadText(event, "operation"),
				targetPath: this.getPayloadText(event, "targetPath"),
				status: this.getPayloadText(event, "status"),
				summary: this.getPayloadText(event, "summary"),
				reason: this.getPayloadText(event, "reason") || this.getPayloadText(event, "error"),
				at: event.at,
			}));
	}

	private toMutationTimelineEvent(
		type: string,
	): TurnReplaySummary["mutationTimeline"][number]["event"] {
		if (type === "mutation_applied") {
			return "applied";
		}
		if (type === "mutation_rejected") {
			return "rejected";
		}
		if (type === "mutation_conflicted") {
			return "conflicted";
		}
		if (type === "mutation_apply_failed") {
			return "apply_failed";
		}
		return "planned";
	}

	private summarizeTaskTimeline(events: TurnEventRecord[]): TurnReplaySummary["taskTimeline"] {
		return events
			.filter((event) => [
				"task_created",
				"task_running",
				"task_waiting_for_approval",
				"task_waiting_for_user",
				"task_failed",
				"task_cancelled",
				"task_completed",
			].includes(event.type))
			.map((event) => ({
				taskId: this.getPayloadText(event, "taskId") || event.taskId || "",
				event: this.toTaskTimelineEvent(event.type),
				status: this.getPayloadText(event, "status"),
				summary: this.getPayloadText(event, "summary"),
				reason: this.getPayloadText(event, "reason") || this.getPayloadText(event, "error"),
				at: event.at,
			}));
	}

	private toTaskTimelineEvent(type: string): TurnReplaySummary["taskTimeline"][number]["event"] {
		return type.replace(/^task_/, "") as TurnReplaySummary["taskTimeline"][number]["event"];
	}

	private getPayloadText(event: TurnEventRecord | undefined, key: string): string {
		const value = event?.payload?.[key];
		return typeof value === "string" ? value : "";
	}

	private findPayloadText(events: TurnEventRecord[], key: string): string {
		for (const event of events) {
			const value = this.getPayloadText(event, key);
			if (value) {
				return value;
			}
		}
		return "";
	}

	private getPayloadNumber(event: TurnEventRecord, key: string): number {
		const value = event.payload[key];
		return typeof value === "number" ? value : 0;
	}

	private getPayloadOptionalNumber(event: TurnEventRecord, key: string): number | undefined {
		const value = event.payload[key];
		return typeof value === "number" ? value : undefined;
	}

	private getPayloadOptionalBoolean(event: TurnEventRecord, key: string): boolean | undefined {
		const value = event.payload[key];
		return typeof value === "boolean" ? value : undefined;
	}

	private getPayloadStringArray(event: TurnEventRecord, key: string): string[] {
		const value = event.payload[key];
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	}

	private getPayloadValue(event: TurnEventRecord, key: string): unknown {
		return event.payload[key];
	}

	private getPayloadRecord(event: TurnEventRecord, key: string): Record<string, unknown> {
		const value = event.payload[key];
		return value && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: {};
	}

	private getRecordFromPayloadOrRecord(
		event: TurnEventRecord,
		record: Record<string, unknown>,
		key: string,
	): Record<string, unknown> {
		const payloadValue = event.payload[key];
		if (payloadValue && typeof payloadValue === "object" && !Array.isArray(payloadValue)) {
			return payloadValue as Record<string, unknown>;
		}
		const recordValue = record[key];
		return recordValue && typeof recordValue === "object" && !Array.isArray(recordValue)
			? recordValue as Record<string, unknown>
			: {};
	}

	private getStringArrayFromPayloadOrRecord(
		event: TurnEventRecord,
		record: Record<string, unknown>,
		key: string,
	): string[] {
		const payloadValue = event.payload[key];
		if (Array.isArray(payloadValue)) {
			return payloadValue.filter((item): item is string => typeof item === "string" && item.length > 0);
		}
		const recordValue = record[key];
		return Array.isArray(recordValue)
			? recordValue.filter((item): item is string => typeof item === "string" && item.length > 0)
			: [];
	}

	private getTextFromPayloadOrRecord(event: TurnEventRecord, record: Record<string, unknown>, key: string): string {
		return this.getPayloadText(event, key) || this.getRecordText(record, key);
	}

	private getBooleanFromPayloadOrRecord(event: TurnEventRecord, record: Record<string, unknown>, key: string): boolean {
		const payloadValue = event.payload[key];
		if (typeof payloadValue === "boolean") {
			return payloadValue;
		}
		const recordValue = record[key];
		return typeof recordValue === "boolean" ? recordValue : false;
	}

	private getRecordText(record: Record<string, unknown>, key: string): string {
		const value = record[key];
		return typeof value === "string" ? value : "";
	}

	private getRecordNumber(record: Record<string, unknown>, key: string): number {
		const value = record[key];
		return typeof value === "number" ? value : 0;
	}

	private getRecordOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
		const value = record[key];
		return typeof value === "number" ? value : undefined;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}

function calculateDurationMs(startedAt: string, endedAt: string): number {
	const startMs = Date.parse(startedAt);
	const endMs = Date.parse(endedAt);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
		return 0;
	}
	return Math.max(0, endMs - startMs);
}
