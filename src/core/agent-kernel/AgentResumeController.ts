import type { AgentTask } from "../tasks/AgentTask";
import type { AgentMode } from "../tools/ToolRegistry";
import type { AgentLoopCheckpoint } from "./checkpoints/AgentLoopCheckpoint";
import { validateCheckpointForResume } from "./checkpoints/AgentLoopCheckpoint";
import type { AgentRuntimeFacadeInput, AgentTurnResult, RuntimeProgressEvent } from "./contracts";
import type { AgentTaskManager } from "./AgentTaskManager";

export interface AgentResumeRunOptions {
	traceId?: string;
	userPrompt?: string;
	onProgress?: (event: RuntimeProgressEvent) => void;
	signal?: AbortSignal;
}

export interface AgentResumeControllerOptions {
	taskManager: AgentTaskManager;
	checkpointStore?: {
		getLatestForTask(taskId: string): Promise<AgentLoopCheckpoint | null>;
		markConsumed?(checkpointId: string, result: "resumed" | "rejected" | "expired", reason: string): Promise<void>;
	};
	runTurn(input: AgentRuntimeFacadeInput): Promise<AgentTurnResult>;
}

export interface AgentResumeRunResult {
	input: AgentRuntimeFacadeInput;
	result: AgentTurnResult;
	resumedFromCheckpoint?: boolean;
	checkpointId?: string;
}

export class AgentResumeController {
	constructor(private readonly options: AgentResumeControllerOptions) {}

	async retryTask(taskId: string, options: AgentResumeRunOptions = {}): Promise<AgentResumeRunResult> {
		const task = await this.requireTask(taskId);
		if (task.status === "running" || task.status === "waiting_for_approval" || task.status === "waiting_for_user") {
			throw new Error(`Only terminal tasks can be retried: ${taskId}`);
		}
		const input = this.buildInput(task, "retry", options);
		const result = await this.options.runTurn(input);
		return { input, result };
	}

	async resumeTask(taskId: string, options: AgentResumeRunOptions = {}): Promise<AgentResumeRunResult> {
		const task = await this.requireTask(taskId);
		if (task.status !== "failed") {
			throw new Error(`Only failed tasks can be resumed from checkpoint: ${taskId}`);
		}
		const checkpoint = await this.resolveResumeCheckpoint(task);
		if (!checkpoint) {
			throw new Error(`Agent task ${taskId} has no safe checkpoint to resume.`);
		}
		const input = this.buildInput(task, "resume", options, checkpoint);
		const result = await this.options.runTurn(input);
		return {
			input,
			result,
			resumedFromCheckpoint: true,
			checkpointId: checkpoint.id,
		};
	}

	async continueTask(taskId: string, options: AgentResumeRunOptions = {}): Promise<AgentResumeRunResult> {
		const task = await this.requireTask(taskId);
		if (task.status !== "waiting_for_approval" && task.status !== "waiting_for_user") {
			throw new Error(`Only waiting tasks can be continued: ${taskId}`);
		}
		const input = this.buildInput(task, "continue", options);
		const result = await this.options.runTurn(input);
		return { input, result };
	}

	async cancelTask(taskId: string, reason = "Task cancelled."): Promise<AgentTask> {
		return this.options.taskManager.cancelTask(taskId, reason);
	}

	private async requireTask(taskId: string): Promise<AgentTask> {
		const task = await this.options.taskManager.getTask(taskId);
		if (!task) {
			throw new Error(`Agent task not found: ${taskId}`);
		}
		return task;
	}

	private async resolveResumeCheckpoint(task: AgentTask): Promise<AgentLoopCheckpoint | null> {
		if (task.status !== "failed" || !this.isRetryableTaskFailure(task) || !this.options.checkpointStore) {
			return null;
		}
		const checkpoint = await this.options.checkpointStore.getLatestForTask(task.id);
		const validation = validateCheckpointForResume({
			checkpoint,
			conversationId: task.conversationId,
			agentId: task.agentId,
			taskId: task.id,
			allowedTools: task.runInput?.allowedTools,
		});
		if (!validation.ok) {
			if (checkpoint) {
				await this.options.checkpointStore.markConsumed?.(checkpoint.id, "rejected", validation.reason);
			}
			return null;
		}
		return checkpoint;
	}

	private buildInput(
		task: AgentTask,
		kind: "retry" | "resume" | "continue",
		options: AgentResumeRunOptions,
		checkpoint?: AgentLoopCheckpoint | null,
	): AgentRuntimeFacadeInput {
		const snapshot = task.runInput;
		if (!snapshot) {
			throw new Error(`Agent task ${task.id} cannot be ${kind === "retry" ? "retried" : "continued"} because its original turn input was not recorded.`);
		}
		const continuationText = options.userPrompt?.trim() || "";
		const userPrompt = kind === "continue"
			? [
				snapshot.userPrompt,
				continuationText ? `User continuation: ${continuationText}` : "User continuation: Continue from the current task state.",
			].join("\n\n")
			: snapshot.userPrompt;
		return {
			agentId: snapshot.agentId || task.agentId || task.conversationId,
			conversationId: task.conversationId,
			conversation: [],
			userPrompt,
			modelOverride: snapshot.modelOverride,
			depth: snapshot.depth,
			activeFileContext: snapshot.activeFileContext,
			extraSystemContext: snapshot.extraSystemContext,
			allowedTools: snapshot.allowedTools,
			agentMode: snapshot.agentMode as AgentMode | undefined,
			onProgress: options.onProgress,
			signal: options.signal,
			traceId: options.traceId,
			...(kind === "continue" ? { continueFromTaskId: task.id } : { retryOfTaskId: task.id }),
			...(checkpoint ? {
				resumeFromCheckpointId: checkpoint.id,
				metadata: {
					resumeFromCheckpointId: checkpoint.id,
					recoveryKind: "checkpoint_resume",
					retryOfTaskId: task.id,
				},
			} : {}),
		};
	}

	private isRetryableTaskFailure(task: AgentTask): boolean {
		const reason = `${task.failureReason ?? ""}\n${task.summary ?? ""}`;
		return /(gateway timeout|504|timeout|econnreset|retryable|temporarily unavailable|transport|network|网关|网络|暂时不可用)/i.test(reason);
	}
}
