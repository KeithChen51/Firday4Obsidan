import type { ToolCallingMode } from "../../types/tools";
import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { AgentChatMessage, AgentTurnInput, RuntimeContextSummary } from "./contracts";

export interface ContextEngineRequest {
	channel: "native" | "prompt";
}

export interface ContextPackage {
	toolCallingMode: ToolCallingMode;
	maxIterations: number;
	messages: AgentChatMessage[];
	contextSummary?: RuntimeContextSummary;
}

export interface ContextEnginePort {
	buildContext(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		request: ContextEngineRequest,
	): Promise<ContextPackage>;
}
