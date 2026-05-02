import type { ToolCall, ToolDefinition } from "../../types/tools";
import type { AgentChatMessage, AgentExecutionBudget } from "./contracts";

export interface ModelDriverRequest {
	messages: AgentChatMessage[];
	modelOverride?: string;
	signal?: AbortSignal;
	step?: number;
	taskId?: string;
	traceId?: string;
	budget?: AgentExecutionBudget;
}

export interface ModelDriverToolRequest extends ModelDriverRequest {
	tools: ToolDefinition[];
}

export interface ModelDriverResponse {
	assistantText: string;
	toolCalls: ToolCall[];
	finishReason?: string;
	reasoningContent?: string;
}

export interface ModelDriverPort {
	requestText(input: ModelDriverRequest): Promise<ModelDriverResponse>;
	requestWithTools(input: ModelDriverToolRequest): Promise<ModelDriverResponse>;
}
