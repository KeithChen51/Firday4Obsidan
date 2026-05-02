import type { AgentMode } from "../tools/ToolRegistry";
import type { AgentTurnEvent, AgentTurnEventDraft } from "./contracts";

export interface AgentExecutionContextInput {
	turnId: string;
	conversationId: string;
	agentId: string;
	mode: AgentMode;
	startedAt?: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
}

export class AgentExecutionContext {
	readonly turnId: string;
	readonly conversationId: string;
	readonly agentId: string;
	readonly mode: AgentMode;
	readonly startedAt: string;
	readonly abortController: AbortController;
	readonly metadata: Record<string, unknown>;

	private readonly events: AgentTurnEvent[] = [];
	private cancelReason: unknown;

	constructor(input: AgentExecutionContextInput) {
		this.turnId = input.turnId;
		this.conversationId = input.conversationId;
		this.agentId = input.agentId;
		this.mode = input.mode;
		this.startedAt = input.startedAt ?? new Date().toISOString();
		this.abortController = new AbortController();
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

	emit(event: AgentTurnEventDraft): AgentTurnEvent {
		const normalized: AgentTurnEvent = {
			...event,
			turnId: event.turnId ?? this.turnId,
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

function cloneEvent(event: AgentTurnEvent): AgentTurnEvent {
	return {
		...event,
		...(event.payload ? { payload: { ...event.payload } } : {}),
		...(event.failure ? { failure: { ...event.failure } } : {}),
	};
}
