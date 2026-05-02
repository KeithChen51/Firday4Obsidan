export const AGENT_FAILURE_CATEGORIES = [
	"model_transport",
	"model_protocol",
	"tool_denied",
	"tool_failed",
	"approval_denied",
	"mutation_conflict",
	"mutation_failed",
	"context_overflow",
	"cancelled",
	"max_iterations",
	"unknown",
] as const;

export type AgentFailureCategory = typeof AGENT_FAILURE_CATEGORIES[number];

export interface AgentFailure {
	category: AgentFailureCategory;
	code: string;
	retryable: boolean;
	userMessage: string;
	technicalMessage?: string;
	cause?: unknown;
}
