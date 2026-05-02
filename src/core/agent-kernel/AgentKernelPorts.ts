import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { AgentFailure, AgentTurnEvent, AgentTurnInput, AgentTurnResult } from "./contracts";

export interface RuntimeTurnExecutorPort {
	execute(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult>;
}

export interface AgentEventSinkPort {
	emit(event: AgentTurnEvent): void | Promise<void>;
}

export interface AgentFailureClassifierPort {
	classify(error: unknown, partial?: Partial<AgentTurnResult>): AgentFailure;
}
