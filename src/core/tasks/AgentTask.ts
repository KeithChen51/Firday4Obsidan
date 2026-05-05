export const AGENT_TASK_STATUSES = [
	"created",
	"running",
	"waiting_for_approval",
	"waiting_for_user",
	"failed",
	"cancelled",
	"completed",
] as const;

export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];

export type AgentTaskAction = "retry" | "cancel" | "continue" | "apply" | "reject";

export interface AgentTaskApprovalWait {
	kind: "tool" | "mutation";
	tool?: string;
	targetPath?: string;
	summary?: string;
	approvalId?: string;
	mutationPlanIds?: string[];
}

export interface AgentTaskUserWait {
	prompt: string;
	summary?: string;
}

export interface AgentTaskRunInputSnapshot {
	agentId: string;
	userPrompt: string;
	modelOverride?: string;
	depth?: number;
	currentFilePath?: string;
	extraSystemContext?: string;
	allowedTools?: string[];
	agentMode?: string;
}

export interface AgentTask {
	id: string;
	conversationId: string;
	turnId?: string;
	agentId?: string;
	mode?: string;
	title: string;
	status: AgentTaskStatus;
	summary: string;
	failureReason?: string;
	waitingForApproval?: AgentTaskApprovalWait;
	waitingForUser?: AgentTaskUserWait;
	pendingMutationCount: number;
	changedFileCount: number;
	availableActions: AgentTaskAction[];
	retryOfTaskId?: string;
	continueFromTaskId?: string;
	runInput?: AgentTaskRunInputSnapshot;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	cancelledAt?: string;
	failedAt?: string;
}

export interface AgentTaskCreateInput {
	id?: string;
	conversationId: string;
	turnId?: string;
	agentId?: string;
	mode?: string;
	title: string;
	summary?: string;
	retryOfTaskId?: string;
	continueFromTaskId?: string;
	runInput?: AgentTaskRunInputSnapshot;
	createdAt?: string;
}

export interface AgentTaskTransitionPatch {
	summary?: string;
	failureReason?: string;
	waitingForApproval?: AgentTaskApprovalWait;
	waitingForUser?: AgentTaskUserWait;
	pendingMutationCount?: number;
	changedFileCount?: number;
	turnId?: string;
}

const ALLOWED_TRANSITIONS: Record<AgentTaskStatus, AgentTaskStatus[]> = {
	created: ["running", "waiting_for_approval", "waiting_for_user", "failed", "cancelled", "completed"],
	running: ["waiting_for_approval", "waiting_for_user", "failed", "cancelled", "completed"],
	waiting_for_approval: ["running", "waiting_for_user", "failed", "cancelled", "completed"],
	waiting_for_user: ["running", "waiting_for_approval", "failed", "cancelled", "completed"],
	failed: [],
	cancelled: [],
	completed: [],
};

export function createAgentTask(input: AgentTaskCreateInput, now: Date = new Date()): AgentTask {
	const createdAt = input.createdAt ?? now.toISOString();
	const task: AgentTask = {
		id: input.id ?? createAgentTaskId(now),
		conversationId: input.conversationId,
		...(input.turnId ? { turnId: input.turnId } : {}),
		...(input.agentId ? { agentId: input.agentId } : {}),
		...(input.mode ? { mode: input.mode } : {}),
		title: normalizeTaskTitle(input.title),
		status: "created",
		summary: sanitizeTaskText(input.summary?.trim() || "Task created.", 240),
		pendingMutationCount: 0,
		changedFileCount: 0,
		availableActions: [],
		...(input.retryOfTaskId ? { retryOfTaskId: input.retryOfTaskId } : {}),
		...(input.continueFromTaskId ? { continueFromTaskId: input.continueFromTaskId } : {}),
		...(input.runInput ? { runInput: sanitizeRunInputSnapshot(input.runInput) } : {}),
		createdAt,
		updatedAt: createdAt,
	};
	return withDerivedActions(task);
}

export function transitionAgentTask(
	task: AgentTask,
	nextStatus: AgentTaskStatus,
	patch: AgentTaskTransitionPatch = {},
	now: Date = new Date(),
): AgentTask {
	if (task.status !== nextStatus && !ALLOWED_TRANSITIONS[task.status].includes(nextStatus)) {
		throw new Error(`Invalid AgentTask transition: ${task.status} -> ${nextStatus}`);
	}
	const updatedAt = now.toISOString();
	const clearsMutationCounts = nextStatus === "completed" || nextStatus === "cancelled";
	const next: AgentTask = {
		...task,
		status: nextStatus,
		...(patch.turnId ? { turnId: patch.turnId } : {}),
		summary: sanitizeTaskText(patch.summary?.trim() || task.summary, 240),
		pendingMutationCount: patch.pendingMutationCount ?? (clearsMutationCounts ? 0 : task.pendingMutationCount),
		changedFileCount: patch.changedFileCount ?? (clearsMutationCounts ? 0 : task.changedFileCount),
		updatedAt,
	};
	delete next.waitingForApproval;
	delete next.waitingForUser;
	delete next.failureReason;
	delete next.completedAt;
	delete next.cancelledAt;
	delete next.failedAt;
	if (nextStatus === "waiting_for_approval" && patch.waitingForApproval) {
		next.waitingForApproval = sanitizeApprovalWait(patch.waitingForApproval);
	}
	if (nextStatus === "waiting_for_user" && patch.waitingForUser) {
		next.waitingForUser = sanitizeUserWait(patch.waitingForUser);
	}
	if (nextStatus === "failed") {
		next.failureReason = sanitizeTaskText(
			patch.failureReason?.trim() || patch.summary?.trim() || task.failureReason || "Task failed.",
			320,
		);
		next.failedAt = updatedAt;
	}
	if (nextStatus === "cancelled") {
		next.failureReason = sanitizeTaskText(
			patch.failureReason?.trim() || patch.summary?.trim() || task.failureReason || "Task cancelled.",
			320,
		);
		next.cancelledAt = updatedAt;
	}
	if (nextStatus === "completed") {
		next.completedAt = updatedAt;
	}
	return withDerivedActions(next);
}

export function deriveAgentTaskActions(task: Pick<AgentTask, "status" | "waitingForApproval" | "pendingMutationCount">): AgentTaskAction[] {
	switch (task.status) {
		case "created":
		case "running":
			return ["cancel"];
		case "waiting_for_approval":
			return task.pendingMutationCount > 0 || task.waitingForApproval?.kind === "mutation"
				? ["cancel", "apply", "reject"]
				: ["cancel", "continue"];
		case "waiting_for_user":
			return ["cancel", "continue"];
		case "failed":
			return ["retry"];
		case "cancelled":
		case "completed":
			return [];
		default:
			return [];
	}
}

export function cloneAgentTask(task: AgentTask): AgentTask {
	return {
		...task,
		title: normalizeTaskTitle(task.title),
		summary: sanitizeTaskText(task.summary, 240),
		...(task.failureReason ? { failureReason: sanitizeTaskText(task.failureReason, 320) } : {}),
		availableActions: [...task.availableActions],
		...(task.waitingForApproval ? { waitingForApproval: sanitizeApprovalWait(task.waitingForApproval) } : {}),
		...(task.waitingForUser ? { waitingForUser: sanitizeUserWait(task.waitingForUser) } : {}),
		...(task.runInput ? { runInput: sanitizeRunInputSnapshot(task.runInput) } : {}),
	};
}

function withDerivedActions(task: AgentTask): AgentTask {
	return {
		...task,
		availableActions: deriveAgentTaskActions(task),
	};
}

function createAgentTaskId(now: Date): string {
	const rand = Math.random().toString(16).slice(2, 8);
	return `agent-task-${now.getTime()}-${rand}`;
}

function normalizeTaskTitle(value: string): string {
	const title = sanitizeTaskText(value, 96).replace(/\s+/g, " ").trim();
	if (!title) {
		return "Agent task";
	}
	return title.length <= 96 ? title : `${title.slice(0, 93)}...`;
}

function sanitizeApprovalWait(wait: AgentTaskApprovalWait): AgentTaskApprovalWait {
	return {
		...wait,
		...(wait.tool ? { tool: sanitizeTaskText(wait.tool, 80) } : {}),
		...(wait.targetPath ? { targetPath: sanitizeTaskText(wait.targetPath, 240) } : {}),
		...(wait.summary ? { summary: sanitizeTaskText(wait.summary, 240) } : {}),
		...(wait.approvalId ? { approvalId: sanitizeTaskText(wait.approvalId, 120) } : {}),
		...(wait.mutationPlanIds ? { mutationPlanIds: [...wait.mutationPlanIds] } : {}),
	};
}

function sanitizeUserWait(wait: AgentTaskUserWait): AgentTaskUserWait {
	return {
		prompt: sanitizeTaskText(wait.prompt, 320),
		...(wait.summary ? { summary: sanitizeTaskText(wait.summary, 240) } : {}),
	};
}

function sanitizeRunInputSnapshot(snapshot: AgentTaskRunInputSnapshot): AgentTaskRunInputSnapshot {
	return {
		agentId: sanitizeTaskText(snapshot.agentId, 120),
		userPrompt: sanitizeTaskText(snapshot.userPrompt, 2000),
		...(snapshot.modelOverride ? { modelOverride: sanitizeTaskText(snapshot.modelOverride, 120) } : {}),
		...(snapshot.depth !== undefined ? { depth: snapshot.depth } : {}),
		...(snapshot.currentFilePath ? { currentFilePath: sanitizeTaskText(snapshot.currentFilePath, 240) } : {}),
		...(snapshot.extraSystemContext ? { extraSystemContext: sanitizeTaskText(snapshot.extraSystemContext, 2000) } : {}),
		...(snapshot.allowedTools ? { allowedTools: snapshot.allowedTools.map((tool) => sanitizeTaskText(tool, 80)) } : {}),
		...(snapshot.agentMode ? { agentMode: sanitizeTaskText(snapshot.agentMode, 80) } : {}),
	};
}

function sanitizeTaskText(value: string, maxLength: number): string {
	const redacted = value
		.replace(/\b(authorization|api[_-]?key|token|secret)\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi, "$1=[redacted]")
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\b[A-Za-z0-9_]*secret[A-Za-z0-9_-]{8,}\b/gi, "[redacted]");
	if (redacted.length <= maxLength) {
		return redacted;
	}
	return `${redacted.slice(0, Math.max(0, maxLength - 3))}...`;
}
