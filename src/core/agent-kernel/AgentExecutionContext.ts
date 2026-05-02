import type { AgentMode } from "../tools/ToolRegistry";
import type { AgentExecutionBudget, AgentTurnEvent, AgentTurnEventDraft } from "./contracts";

export interface AgentExecutionContextInput {
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId: string;
	agentId: string;
	mode: AgentMode;
	startedAt?: string;
	signal?: AbortSignal;
	budget?: AgentExecutionBudget;
	metadata?: Record<string, unknown>;
}

export class AgentExecutionContext {
	readonly turnId: string;
	readonly traceId: string;
	readonly conversationId: string;
	readonly agentId: string;
	readonly mode: AgentMode;
	readonly startedAt: string;
	readonly abortController: AbortController;
	readonly budget: AgentExecutionBudget;
	readonly metadata: Record<string, unknown>;

	private readonly events: AgentTurnEvent[] = [];
	private taskIdValue?: string;
	private cancelReason: unknown;

	constructor(input: AgentExecutionContextInput) {
		this.turnId = input.turnId;
		this.traceId = input.traceId?.trim() || input.turnId;
		this.taskIdValue = normalizeOptionalId(input.taskId);
		this.conversationId = input.conversationId;
		this.agentId = input.agentId;
		this.mode = input.mode;
		this.startedAt = input.startedAt ?? new Date().toISOString();
		this.abortController = new AbortController();
		this.budget = cloneBudget(input.budget);
		this.metadata = { ...(input.metadata ?? {}) };

		if (input.signal?.aborted) {
			this.cancel(input.signal.reason);
		} else if (input.signal) {
			input.signal.addEventListener("abort", () => this.cancel(input.signal?.reason), { once: true });
		}
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	get taskId(): string | undefined {
		return this.taskIdValue;
	}

	setTaskId(taskId: string | undefined): void {
		const normalized = normalizeOptionalId(taskId);
		if (normalized) {
			this.taskIdValue = normalized;
		}
	}

	emit(event: AgentTurnEventDraft): AgentTurnEvent {
		const taskId = event.taskId ?? this.taskId;
		const normalized: AgentTurnEvent = {
			...event,
			turnId: event.turnId ?? this.turnId,
			...(taskId ? { taskId } : {}),
			traceId: event.traceId ?? this.traceId,
			conversationId: event.conversationId ?? this.conversationId,
			agentId: event.agentId ?? this.agentId,
			at: event.at ?? new Date().toISOString(),
		};
		this.events.push(cloneEvent(normalized));
		return cloneEvent(normalized);
	}

	cancel(reason?: unknown): void {
		this.cancelReason = reason;
		if (!this.abortController.signal.aborted) {
			this.abortController.abort(reason);
		}
	}

	isCancelled(): boolean {
		return this.abortController.signal.aborted;
	}

	getCancelReason(): unknown {
		return this.cancelReason;
	}

	snapshotEvents(): AgentTurnEvent[] {
		return this.events.map(cloneEvent);
	}
}

function normalizeOptionalId(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

function cloneBudget(budget: AgentExecutionBudget | undefined): AgentExecutionBudget {
	return {
		...(budget?.token ? { token: { ...budget.token } } : {}),
		...(budget?.turn ? { turn: { ...budget.turn } } : {}),
		...(budget?.tool ? { tool: { ...budget.tool } } : {}),
		...(budget?.time ? { time: { ...budget.time } } : {}),
	};
}

function cloneEvent(event: AgentTurnEvent): AgentTurnEvent {
	return {
		...event,
		...(event.payload ? { payload: { ...event.payload } } : {}),
		...(event.failure ? { failure: { ...event.failure } } : {}),
	};
}
