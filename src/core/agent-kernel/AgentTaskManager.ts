import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { HumanApprovalRequest, HumanApprovalResolution } from "./HumanApprovalPort";
import type { AgentTurnInput, AgentTurnResult } from "./contracts";
import type {
	AgentTask,
	AgentTaskCheckpoint,
	AgentTaskCreateInput,
	AgentTaskTransitionPatch,
} from "../tasks/AgentTask";

export interface AgentTaskStorePort {
	create(input: AgentTaskCreateInput): Promise<AgentTask>;
	get(taskId: string): Promise<AgentTask | undefined>;
	markRunning(taskId: string, patch?: AgentTaskTransitionPatch): Promise<AgentTask>;
	markWaitingForApproval(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask>;
	markWaitingForUser(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask>;
	markFailed(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask>;
	markCompleted(taskId: string, patch?: AgentTaskTransitionPatch): Promise<AgentTask>;
	cancelTask(taskId: string, patch?: AgentTaskTransitionPatch): Promise<AgentTask>;
	createRetryTask(taskId: string, input?: Partial<AgentTaskCreateInput>): Promise<AgentTask>;
	createContinuationTask(taskId: string, input?: Partial<AgentTaskCreateInput>): Promise<AgentTask>;
	updateCheckpoint?(taskId: string, checkpoint: AgentTaskCheckpoint): Promise<AgentTask>;
}

export interface AgentTaskManagerOptions {
	taskStore: AgentTaskStorePort;
}

export interface UserWaitRequest {
	prompt: string;
	summary?: string;
}

export class AgentTaskManager {
	constructor(private readonly options: AgentTaskManagerOptions) {}

	async beginTurn(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTask> {
		const created = await this.options.taskStore.create({
			id: context.taskId,
			agentId: input.agentId,
			conversationId: context.conversationId,
			turnId: context.turnId,
			mode: input.mode,
			title: input.userPrompt,
			summary: "Task created.",
			retryOfTaskId: input.retryOfTaskId,
			continueFromTaskId: input.continueFromTaskId,
			runInput: this.createRunInputSnapshot(input),
		});
		context.setTaskId(created.id);
		this.emitTask(context, created);
		const running = await this.options.taskStore.markRunning(created.id, {
			summary: `Runtime started for ${input.mode} mode.`,
		});
		this.emitTask(context, running);
		return running;
	}

	async completeTurn(result: AgentTurnResult, context: AgentExecutionContext): Promise<AgentTask> {
		const taskId = this.requireContextTaskId(context);
		const currentTask = await this.options.taskStore.get(taskId);
		if (
			currentTask?.status === "failed" ||
			currentTask?.status === "cancelled" ||
			currentTask?.status === "completed"
		) {
			return currentTask;
		}
		if (result.status === "waiting_for_approval" && result.task) {
			this.emitTask(context, result.task);
			return result.task;
		}
		const pendingMutations = (result.pendingMutations ?? [])
			.filter((mutation) => !mutation.status || mutation.status === "pending");
		if (pendingMutations.length > 0) {
			const first = pendingMutations[0] ?? {};
			const task = await this.options.taskStore.markWaitingForApproval(taskId, {
				summary: `Waiting for review of ${pendingMutations.length} pending file change(s).`,
				waitingForApproval: {
					kind: "mutation",
					tool: first.operation ?? "mutation",
					targetPath: first.targetPath ?? "",
					summary: first.summary ?? "Review pending file changes.",
					mutationPlanIds: pendingMutations.map((mutation) => mutation.id).filter(isNonEmptyString),
				},
				pendingMutationCount: pendingMutations.length,
				changedFileCount: pendingMutations.length,
			});
			this.emitTask(context, task);
			return task;
		}
		if (result.status === "failed" || (result.parseError && result.assistantText === result.parseError)) {
			const task = await this.options.taskStore.markFailed(taskId, {
				summary: this.truncate(result.failure?.userMessage ?? result.parseError ?? "Task failed.", 240),
				failureReason: result.failure?.technicalMessage ?? result.parseError ?? result.assistantText,
			});
			this.emitTask(context, task);
			return task;
		}
		if (result.status === "cancelled") {
			const task = await this.options.taskStore.cancelTask(taskId, {
				summary: this.truncate(result.failure?.userMessage ?? "Task cancelled.", 240),
				failureReason: result.failure?.technicalMessage ?? result.failure?.userMessage ?? "Task cancelled.",
			});
			this.emitTask(context, task);
			return task;
		}
		if (this.isMaxToolIterationStop(result)) {
			const task = await this.options.taskStore.markFailed(taskId, {
				summary: "Runtime stopped at the maximum tool iteration limit.",
				failureReason: result.assistantText,
			});
			this.emitTask(context, task);
			return task;
		}
		const completed = await this.options.taskStore.markCompleted(taskId, {
			summary: "Final answer delivered.",
		});
		this.emitTask(context, completed);
		return completed;
	}

	async failTurn(error: unknown, context: AgentExecutionContext): Promise<AgentTask | undefined> {
		const taskId = context.taskId;
		if (!taskId) {
			return undefined;
		}
		const message = error instanceof Error ? error.message : String(error ?? "Task failed.");
		const task = this.isCancellationFailure(message) || context.isCancelled()
			? await this.options.taskStore.cancelTask(taskId, {
				summary: this.truncate(message, 240),
				failureReason: message,
			})
			: await this.options.taskStore.markFailed(taskId, {
				summary: this.truncate(message, 240),
				failureReason: message,
			});
		this.emitTask(context, task);
		return task;
	}

	async requestApproval(context: AgentExecutionContext, request: HumanApprovalRequest): Promise<AgentTask> {
		const taskId = this.requireContextTaskId(context);
		context.emit({
			type: "approval_requested",
			payload: {
				kind: request.kind,
				tool: request.tool,
				targetPath: request.targetPath,
				summary: request.summary,
				approvalId: request.approvalId,
				mutationPlanIds: request.mutationPlanIds,
			},
		});
		const task = await this.options.taskStore.markWaitingForApproval(taskId, {
			summary: request.summary,
			waitingForApproval: request,
			pendingMutationCount: request.kind === "mutation" ? request.mutationPlanIds?.length ?? 0 : 0,
		});
		this.emitTask(context, task);
		return task;
	}

	async resolveApproval(context: AgentExecutionContext, resolution: HumanApprovalResolution): Promise<AgentTask> {
		const taskId = this.requireContextTaskId(context);
		context.emit({
			type: "approval_resolved",
			payload: {
				tool: resolution.tool,
				approved: resolution.approved,
				reason: resolution.reason,
				approvalId: resolution.approvalId,
			},
		});
		const currentTask = await this.options.taskStore.get(taskId);
		if (
			currentTask?.status === "failed" ||
			currentTask?.status === "cancelled" ||
			currentTask?.status === "completed"
		) {
			return currentTask;
		}
		const task = resolution.approved
			? await this.options.taskStore.markRunning(taskId, {
				summary: resolution.reason || "Approval resolved.",
				pendingMutationCount: 0,
			})
			: await this.options.taskStore.markFailed(taskId, {
				summary: resolution.reason || "Approval denied.",
				failureReason: resolution.reason || "Approval denied.",
			});
		this.emitTask(context, task);
		return task;
	}

	async requestUserInput(context: AgentExecutionContext, request: UserWaitRequest): Promise<AgentTask> {
		const taskId = this.requireContextTaskId(context);
		const task = await this.options.taskStore.markWaitingForUser(taskId, {
			summary: request.summary ?? request.prompt,
			waitingForUser: request,
		});
		this.emitTask(context, task);
		return task;
	}

	getTask(taskId: string): Promise<AgentTask | undefined> {
		return this.options.taskStore.get(taskId);
	}

	cancelTask(taskId: string, reason = "Task cancelled."): Promise<AgentTask> {
		return this.options.taskStore.cancelTask(taskId, {
			summary: this.truncate(reason, 240),
			failureReason: reason,
		});
	}

	createRetryTask(taskId: string, input: Partial<AgentTaskCreateInput> = {}): Promise<AgentTask> {
		return this.options.taskStore.createRetryTask(taskId, input);
	}

	createContinuationTask(taskId: string, input: Partial<AgentTaskCreateInput> = {}): Promise<AgentTask> {
		return this.options.taskStore.createContinuationTask(taskId, input);
	}

	async updateCheckpoint(taskId: string, checkpoint: AgentTaskCheckpoint): Promise<AgentTask | undefined> {
		if (!this.options.taskStore.updateCheckpoint) {
			return undefined;
		}
		const task = await this.options.taskStore.updateCheckpoint(taskId, checkpoint);
		return task;
	}

	private emitTask(context: AgentExecutionContext, task: AgentTask): void {
		context.setTaskId(task.id);
		context.emit({
			type: "task_updated",
			status: this.toTurnStatus(task.status),
			payload: {
				taskId: task.id,
				status: task.status,
				summary: task.summary,
				...(task.failureReason ? { reason: task.failureReason } : {}),
				...(task.pendingMutationCount ? { pendingMutationCount: task.pendingMutationCount } : {}),
				...(task.changedFileCount ? { changedFileCount: task.changedFileCount } : {}),
			},
		});
	}

	private createRunInputSnapshot(input: AgentTurnInput): AgentTaskCreateInput["runInput"] {
		return {
			agentId: input.agentId,
			userPrompt: input.userPrompt,
			...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
			...(input.depth !== undefined ? { depth: input.depth } : {}),
			...(input.activeFileContext ? { activeFileContext: input.activeFileContext } : {}),
			...(input.extraSystemContext ? { extraSystemContext: input.extraSystemContext } : {}),
			...(input.allowedTools ? { allowedTools: [...input.allowedTools] } : {}),
			agentMode: input.mode,
		};
	}

	private requireContextTaskId(context: AgentExecutionContext): string {
		if (!context.taskId) {
			throw new Error("AgentExecutionContext.taskId is required for task state transitions.");
		}
		return context.taskId;
	}

	private isCancellationFailure(message: string): boolean {
		return /(abort|cancel|cancelled|canceled)/i.test(message);
	}

	private isMaxToolIterationStop(result: AgentTurnResult): boolean {
		return result.status === "safe_stopped" || result.assistantText.includes("Maximum tool-iteration limit reached");
	}

	private truncate(value: string, maxLength: number): string {
		return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
	}

	private toTurnStatus(status: AgentTask["status"]): AgentTurnResult["status"] | undefined {
		if (status === "waiting_for_approval" || status === "waiting_for_user" || status === "failed" || status === "cancelled" || status === "completed") {
			return status;
		}
		return undefined;
	}
}

function isNonEmptyString(value: string | undefined): value is string {
	return Boolean(value?.trim());
}
