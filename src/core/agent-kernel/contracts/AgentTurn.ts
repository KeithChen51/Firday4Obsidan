import type { StepTraceEvent } from "../../turn-state/TurnStateMachine";
import type { LlmTransportChannel, LlmTransportEventType } from "../../llm/LlmTransportTelemetry";
import type { AgentMode } from "../../tools/ToolRegistry";
import type { AgentTask } from "../../tasks/AgentTask";
import type { RuntimeProfile } from "../../../platform/runtime/RuntimeProfile";
import type { AgentFailure } from "./AgentFailure";
import type { AgentTurnEvent } from "./AgentTurnEvent";

export const AGENT_TURN_STATUSES = [
	"completed",
	"waiting_for_approval",
	"waiting_for_user",
	"failed",
	"cancelled",
] as const;

export type AgentTurnStatus = typeof AGENT_TURN_STATUSES[number];

export interface AgentChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	parts?: unknown[];
	toolCallId?: string;
	name?: string;
	toolCalls?: unknown[];
	reasoningContent?: string;
	uiMeta?: unknown;
}

export interface RuntimeProgressEvent {
	phase:
		| "start"
		| "context"
		| "model_request"
		| "model_retry"
		| "model_response"
		| "tool_approval"
		| "tool_call"
		| "tool_result"
		| "fallback"
		| "done"
		| "error";
	depth: number;
	step?: number;
	tool?: string;
	contextKey?: "instructions" | "skills" | "wiki" | "memory" | "compact";
	targetPath?: string;
	status?: "ok" | "failed" | "denied";
	summary?: string;
	taskId?: string;
	transport?: RuntimeTransportProgress;
	message: string;
}

export interface RuntimeTransportProgress {
	type: LlmTransportEventType;
	requestId: string;
	attempt: number;
	maxAttempts: number;
	delayMs?: number;
	httpStatus?: number;
	retryable: boolean;
	channel: LlmTransportChannel;
	endpointIndex: number;
	endpointCount: number;
}

export interface RuntimeMutationPlan {
	id?: string;
	operation?: string;
	targetPath?: string;
	summary?: string;
	status?: string;
	source?: string;
	taskId?: string;
	traceId?: string;
	toolCallId?: string;
	before?: string;
	after?: string;
	changeType?: string;
	riskLevel?: string;
}

export interface RuntimeToolTrace {
	runId: string;
	step: number;
	tool: string;
	scope: "vault" | "external" | "any";
	targetPath: string;
	approved: boolean;
	approvalReason: string;
	persistedRule: boolean;
	viaRule: boolean;
	status: "ok" | "failed" | "denied";
	failureClass?: "invalid_input" | "dependency_unavailable" | "transport_unstable" | "tool_runtime_error";
	ok: boolean;
	summary: string;
	error?: string;
}

export interface RuntimeContextSummary {
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	overflowChannels?: string[];
	hasWikiContext: boolean;
	hasMemoryContext: boolean;
	hasAutoSkillContext: boolean;
	hasMentionContext: boolean;
	mentionResolvedCount: number;
	mentionTokenTypes: string[];
	mentionSourceMap: Array<{
		tokenId: string;
		tokenType: string;
		channel: string;
		target: string;
		zone?: string;
		dynamic?: boolean;
	}>;
}

export type RuntimeProfileSummary = RuntimeProfile;

export interface AgentExecutionBudget {
	token?: {
		used?: number;
		softLimit?: number;
		hardLimit?: number;
		maxTokens?: number;
	};
	turn?: {
		depth?: number;
		maxDepth?: number;
		maxTurns?: number;
		remainingTurns?: number;
	};
	tool?: {
		usedIterations?: number;
		maxIterations?: number;
		maxToolResultTokens?: number;
	};
	time?: {
		startedAt?: string;
		elapsedMs?: number;
		timeoutMs?: number;
		deadlineAt?: string;
	};
}

export interface AgentTurnInput {
	turnId?: string;
	taskId?: string;
	traceId?: string;
	conversationId: string;
	agentId: string;
	userPrompt: string;
	conversation: AgentChatMessage[];
	mode: AgentMode;
	allowedTools?: string[];
	modelOverride?: string;
	currentFilePath?: string;
	extraSystemContext?: string;
	depth?: number;
	signal?: AbortSignal;
	budget?: AgentExecutionBudget;
	metadata?: Record<string, unknown>;
	mentionContext?: unknown;
	onProgress?: (event: RuntimeProgressEvent) => void;
	retryOfTaskId?: string;
	continueFromTaskId?: string;
}

export interface AgentRuntimeFacadeInput extends Omit<AgentTurnInput, "conversationId" | "mode"> {
	conversationId?: string;
	mode?: AgentMode;
	agentMode?: AgentMode;
}

export interface AgentTurnResult {
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId: string;
	status: AgentTurnStatus;
	assistantText: string;
	events: AgentTurnEvent[];
	traces: RuntimeToolTrace[];
	rawFinalReply: string;
	budget?: AgentExecutionBudget;
	pendingMutations?: RuntimeMutationPlan[];
	task?: AgentTask;
	failure?: AgentFailure;
	raw?: unknown;
	stepTraces?: StepTraceEvent[];
	runtimeProfile?: RuntimeProfileSummary;
	contextSummary?: RuntimeContextSummary;
	parseError?: string;
}

export type RuntimeTurnInput = AgentRuntimeFacadeInput;
export type RuntimeTurnResult = AgentTurnResult;
