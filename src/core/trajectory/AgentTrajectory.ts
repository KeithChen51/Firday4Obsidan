export type AgentTrajectoryStatus =
	| "idle"
	| "running"
	| "waiting_for_approval"
	| "waiting_for_user"
	| "completed"
	| "failed"
	| "cancelled"
	| "safe_stopped";

export type AgentTrajectoryItemKind =
	| "context"
	| "intake"
	| "plan"
	| "narration"
	| "reasoning"
	| "model"
	| "transport"
	| "tool"
	| "approval"
	| "mutation"
	| "task"
	| "failure"
	| "final"
	| "system";

export type AgentTrajectoryItemStatus =
	| "pending"
	| "running"
	| "ok"
	| "failed"
	| "denied"
	| "waiting"
	| "cancelled";

export interface AgentTrajectoryIdentity {
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId?: string;
	agentId?: string;
}

export interface AgentTrajectoryStage {
	key: "context" | "reasoning" | "tools" | "review" | "finalize";
	label: string;
	status: AgentTrajectoryItemStatus;
	itemIds: string[];
}

export interface AgentTrajectoryItem {
	id: string;
	kind: AgentTrajectoryItemKind;
	title: string;
	detail: string;
	status: AgentTrajectoryItemStatus;
	at?: string;
	step?: number;
	tool?: string;
	targetPath?: string;
	evidenceRef?: string;
	actionRef?: string;
	rawEventType?: string;
	reasoningProvider?: string;
	reasoningRawFormat?: string;
	reasoningContinuationPolicy?: string;
	narrationKind?: "task_acknowledged" | "plan_declared" | "stage_report";
	narrationSource?: "runtime" | "model" | "fallback" | string;
	narrationPlan?: string[];
	narrationJustDone?: string;
	narrationNext?: string;
}

export type AgentTrajectoryPlanTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed" | "blocked";

export interface AgentTrajectoryPlanTask {
	id: string;
	title: string;
	status: AgentTrajectoryPlanTaskStatus;
	summary?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface AgentTrajectoryPlanState {
	planId: string;
	visibility: "hidden" | "task_bar" | "visible" | "internal";
	status: "pending" | "running" | "completed" | "skipped" | "failed";
	currentTaskId?: string;
	tasks: AgentTrajectoryPlanTask[];
	createdAt?: string;
	updatedAt?: string;
	completedAt?: string;
}

export interface AgentTrajectoryAction {
	id: "resume" | "retry" | "cancel" | "continue" | "approve" | "reject" | "apply" | "view_changes" | "view_replay";
	label: string;
	enabled: boolean;
	reason?: string;
	targetId?: string;
}

export interface AgentTrajectoryMutation {
	id: string;
	event: "planned" | "applied" | "rejected" | "conflicted" | "apply_failed";
	operation: string;
	targetPath: string;
	status: string;
	summary: string;
	reason: string;
}

export interface AgentTrajectoryFailure {
	class: "model" | "model_transport" | "tool" | "approval" | "mutation" | "runtime" | "cancelled" | "unknown";
	message: string;
	retryable: boolean;
	recoverable: boolean;
}

export interface AgentTrajectoryTime {
	startedAt?: string;
	updatedAt?: string;
	completedAt?: string;
	durationMs?: number;
}

export interface AgentTrajectorySnapshot {
	identity: AgentTrajectoryIdentity;
	status: AgentTrajectoryStatus;
	headline: string;
	summary: string;
	time: AgentTrajectoryTime;
	stages: AgentTrajectoryStage[];
	items: AgentTrajectoryItem[];
	actions: AgentTrajectoryAction[];
	mutations: AgentTrajectoryMutation[];
	plan?: AgentTrajectoryPlanState;
	failure?: AgentTrajectoryFailure;
	privacy: {
		redacted: boolean;
		source: "live" | "replay" | "mixed";
	};
}
