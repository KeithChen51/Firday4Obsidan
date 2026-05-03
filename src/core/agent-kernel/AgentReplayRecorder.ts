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
				return [{ type: "turn_started", payload }];
			case "context_compacted":
				return [{ type: "context_built", payload: { contextKey: "compact", ...payload } }];
			case "model_request":
				return [{ type: "model_requested", payload }];
			case "model_response":
				return [{ type: "model_completed", payload }];
			case "tool_call":
				return [
					{ type: "tool_requested", payload },
					{ type: "tool_policy_checked", payload: { ...payload, decision: "kernel_port" } },
				];
			case "tool_result":
				return [{ type: this.toToolResultType(event), payload }];
			case "approval_requested":
				return [{ type: "tool_approval_requested", payload }];
			case "approval_resolved":
				return [{ type: "tool_approval_resolved", payload }];
			case "mutation_planned":
				return [{ type: "mutation_planned", payload }];
			case "mutation_applied":
				return [{ type: "mutation_applied", payload }];
			case "mutation_rejected":
				return [{ type: "mutation_rejected", payload }];
			case "task_updated":
				return this.mapTaskEvent(event, payload);
			case "fallback":
				return [{ type: "fallback", payload }];
			case "turn_failed":
				return [{ type: "turn_failed", payload }];
			case "turn_cancelled":
				return [{ type: "turn_cancelled", payload }];
			case "turn_completed":
				return [{ type: "turn_completed", payload }];
			default:
				return [];
		}
	}

	private mapTaskEvent(event: AgentTurnEvent, payload: Record<string, unknown>): TurnEventInput[] {
		const status = typeof event.payload?.status === "string" ? event.payload.status : "";
		const type = this.toTaskEventType(status);
		return type ? [{ type, payload }] : [];
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
}
