import type { ChatMessage, ChatWithToolsResult } from "./AIService";
import type { ModelDriverPort, ModelDriverRequest, ModelDriverResponse, ModelDriverToolRequest } from "../core/agent-kernel/ModelDriverPort";
import type { LlmTransportObserver } from "../core/llm/LlmTransportTelemetry";
import type { ToolDefinition } from "../types/tools";

export interface AIServiceModelDriver {
	chat(messages: ChatMessage[], options?: { modelOverride?: string; signal?: AbortSignal } & LlmTransportObserver): Promise<string>;
	chatWithTools(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		options?: { modelOverride?: string; signal?: AbortSignal; toolChoice?: "auto" | "none" } & LlmTransportObserver,
	): Promise<ChatWithToolsResult>;
}

export class AIServiceModelDriverAdapter implements ModelDriverPort {
	constructor(private readonly aiService: AIServiceModelDriver) {}

	async requestText(input: ModelDriverRequest): Promise<ModelDriverResponse> {
		const assistantText = await this.aiService.chat(input.messages as ChatMessage[], {
			modelOverride: input.modelOverride,
			signal: input.signal,
			onTransportEvent: input.onTransportEvent,
		});
		return {
			assistantText,
			toolCalls: [],
			finishReason: "stop",
			reasoningContent: "",
		};
	}

	async requestWithTools(input: ModelDriverToolRequest): Promise<ModelDriverResponse> {
		const result = await this.aiService.chatWithTools(input.messages as ChatMessage[], input.tools, {
			modelOverride: input.modelOverride,
			signal: input.signal,
			onTransportEvent: input.onTransportEvent,
		});
		return {
			assistantText: result.assistantText,
			toolCalls: result.toolCalls,
			finishReason: result.finishReason,
			reasoningContent: result.reasoningContent,
		};
	}
}
