import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { AgentLoopCheckpoint } from "./checkpoints/AgentLoopCheckpoint";
import type { AgentTurnInput, AgentTurnResult, RuntimeProgressEvent } from "./contracts";

export interface AgentLoopProgressPort {
	report(input: AgentTurnInput, event: RuntimeProgressEvent): void;
}

export interface AgentLoopLifecyclePort {
	begin?(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult | void>;
	complete?(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		result: AgentTurnResult,
	): Promise<AgentTurnResult>;
	fail?(input: AgentTurnInput, context: AgentExecutionContext, error: unknown): Promise<AgentTurnResult | void>;
	cleanup?(input: AgentTurnInput, context: AgentExecutionContext): Promise<void>;
}

export interface AgentLoopCheckpointPort {
	save(checkpoint: AgentLoopCheckpoint): Promise<void>;
	getResumeCheckpoint?(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentLoopCheckpoint | null>;
	markConsumed?(checkpointId: string, result: "resumed" | "rejected" | "expired", reason: string): Promise<void>;
}

export interface AgentLoopFallbackPolicy {
	isRetryableTransportFailure(message: string): boolean;
	shouldFallbackToPrompt(message: string): boolean;
}
