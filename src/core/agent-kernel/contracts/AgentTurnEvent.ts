import type { AgentFailure } from "./AgentFailure";
import type { AgentTurnStatus } from "./AgentTurn";

export const AGENT_TURN_EVENT_TYPES = [
	"turn_started",
	"intake_decision",
	"plan_create",
	"plan_update",
	"plan_revise",
	"plan_complete",
	"plan_skip",
	"narration",
	"model_request",
	"model_response",
	"tool_call",
	"tool_result",
	"approval_requested",
	"approval_resolved",
	"mutation_planned",
	"mutation_applied",
	"mutation_rejected",
	"context_compacted",
	"checkpoint_saved",
	"checkpoint_resume_started",
	"checkpoint_resume_rejected",
	"checkpoint_resume_completed",
	"fallback",
	"loop_control_stop",
	"max_tool_iterations",
	"task_updated",
	"turn_completed",
	"turn_failed",
	"turn_cancelled",
] as const;

export type AgentTurnEventType = typeof AGENT_TURN_EVENT_TYPES[number];

export interface AgentTurnEvent {
	type: AgentTurnEventType;
	turnId: string;
	at: string;
	taskId?: string;
	traceId?: string;
	conversationId?: string;
	agentId?: string;
	status?: AgentTurnStatus;
	payload?: Record<string, unknown>;
	failure?: AgentFailure;
}

export type AgentTurnEventDraft =
	& Omit<AgentTurnEvent, "turnId" | "at">
	& Partial<Pick<AgentTurnEvent, "turnId" | "at">>;
