export type ReasoningProvider =
	| "openai"
	| "deepseek"
	| "zenmux"
	| "bailian"
	| "dashscope"
	| "anthropic"
	| "google"
	| "unknown";

export type ReasoningRawFormat =
	| "reasoning_content"
	| "reasoning"
	| "reasoning_details"
	| "responses_reasoning"
	| "anthropic_thinking"
	| "redacted_thinking"
	| "think_tags"
	| "unknown";

export type ReasoningContinuationPolicy =
	| "drop"
	| "preserve_raw"
	| "preserve_signature_only"
	| "provider_managed";

export type ReasoningSourceProtocol =
	| "chat_completions"
	| "responses"
	| "dashscope"
	| "anthropic_messages"
	| "unknown";

export interface ReasoningArtifact {
	hasReasoning: boolean;
	provider: ReasoningProvider;
	model: string;
	rawFormat: ReasoningRawFormat;
	visibleSummary: string;
	rawReasoning?: string;
	continuationPolicy: ReasoningContinuationPolicy;
	continuationPayload?: unknown;
	metadata: {
		tokenCount?: number;
		encrypted?: boolean;
		redacted?: boolean;
		streamed?: boolean;
		sourceProtocol?: ReasoningSourceProtocol;
		warnings?: string[];
	};
}
