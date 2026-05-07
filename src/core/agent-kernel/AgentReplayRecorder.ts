import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { AgentTurnEvent, AgentTurnResult } from "./contracts";
import type { TurnEventInput, TurnEventLog, TurnEventRecord } from "../runtime/TurnEventLog";

export interface AgentReplayRecorderOptions {
	eventLog: Pick<TurnEventLog, "appendMany">;
}

export interface AgentReplayRecordTurnInput {
	context: AgentExecutionContext;
	result: AgentTurnResult;
	events?: AgentTurnEvent[];
	extraEvents?: TurnEventInput[];
}

export class AgentReplayRecorder {
	constructor(private readonly options: AgentReplayRecorderOptions) {}

	async recordTurn(input: AgentReplayRecordTurnInput): Promise<TurnEventRecord[]> {
		const events = input.events ?? input.result.events ?? input.context.snapshotEvents();
		const mapped = events.flatMap((event) => this.mapKernelEvent(event));
		mapped.push(...(input.extraEvents ?? []));
		if (mapped.length === 0) {
			return [];
		}
		return this.options.eventLog.appendMany({
			conversationId: input.context.conversationId,
			turnId: input.context.turnId,
			taskId: input.context.taskId,
		}, mapped);
	}

	private mapKernelEvent(event: AgentTurnEvent): TurnEventInput[] {
		const payload = this.withKernelIdentity(event);
		switch (event.type) {
			case "turn_started":
				return [this.replayEvent(event, "turn_started", payload)];
			case "context_compacted":
				return [this.replayEvent(event, "context_built", { contextKey: "compact", ...payload })];
			case "checkpoint_saved":
				return [this.replayEvent(event, "checkpoint_saved", payload)];
			case "checkpoint_resume_started":
				return [this.replayEvent(event, "checkpoint_resume_started", payload)];
			case "checkpoint_resume_rejected":
				return [this.replayEvent(event, "checkpoint_resume_rejected", payload)];
			case "checkpoint_resume_completed":
				return [this.replayEvent(event, "checkpoint_resume_completed", payload)];
			case "model_request":
				return [this.replayEvent(event, "model_requested", payload)];
			case "model_response":
				return [this.replayEvent(event, "model_completed", payload)];
			case "tool_call":
				return [
					this.replayEvent(event, "tool_requested", payload),
					this.replayEvent(event, "tool_policy_checked", { ...payload, decision: "kernel_port" }),
				];
			case "tool_result":
				return [this.replayEvent(event, this.toToolResultType(event), payload)];
			case "approval_requested":
				return [this.replayEvent(event, "tool_approval_requested", payload)];
			case "approval_resolved":
				return [this.replayEvent(event, "tool_approval_resolved", payload)];
			case "mutation_planned":
				return [this.replayEvent(event, "mutation_planned", payload)];
			case "mutation_applied":
				return [this.replayEvent(event, "mutation_applied", payload)];
			case "mutation_rejected":
				return [this.replayEvent(event, "mutation_rejected", payload)];
			case "task_updated":
				return this.mapTaskEvent(event, payload);
			case "fallback":
				return [this.replayEvent(event, "fallback", payload)];
			case "max_tool_iterations":
				return [this.replayEvent(event, "max_tool_iterations", payload)];
			case "turn_failed":
				return [this.replayEvent(event, "turn_failed", payload)];
			case "turn_cancelled":
				return [this.replayEvent(event, "turn_cancelled", payload)];
			case "turn_completed":
				return [this.replayEvent(event, "turn_completed", payload)];
			default:
				return [];
		}
	}

	private mapTaskEvent(event: AgentTurnEvent, payload: Record<string, unknown>): TurnEventInput[] {
		const status = typeof event.payload?.status === "string" ? event.payload.status : "";
		const type = this.toTaskEventType(status);
		return type ? [this.replayEvent(event, type, payload)] : [];
	}

	private toTaskEventType(status: string): TurnEventInput["type"] | null {
		switch (status) {
			case "created":
				return "task_created";
			case "running":
				return "task_running";
			case "waiting_for_approval":
				return "task_waiting_for_approval";
			case "waiting_for_user":
				return "task_waiting_for_user";
			case "failed":
				return "task_failed";
			case "cancelled":
				return "task_cancelled";
			case "completed":
				return "task_completed";
			default:
				return null;
		}
	}

	private toToolResultType(event: AgentTurnEvent): TurnEventInput["type"] {
		const status = event.payload?.status;
		if (status === "denied") {
			return "tool_denied";
		}
		if (status === "failed") {
			return "tool_failed";
		}
		return "tool_completed";
	}

	private withKernelIdentity(event: AgentTurnEvent): Record<string, unknown> {
		return {
			...(event.payload ?? {}),
			...(event.taskId ? { taskId: event.taskId } : {}),
			...(event.traceId ? { traceId: event.traceId } : {}),
			...(event.agentId ? { agentId: event.agentId } : {}),
			...(event.status ? { status: event.status } : {}),
			...(event.failure ? { failureClass: event.failure.category, summary: event.failure.userMessage } : {}),
		};
	}

	private replayEvent(
		event: AgentTurnEvent,
		type: TurnEventInput["type"],
		payload: Record<string, unknown>,
	): TurnEventInput {
		return {
			type,
			...(event.at ? { at: event.at } : {}),
			payload,
		};
	}
}
