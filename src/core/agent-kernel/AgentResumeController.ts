import type { AgentTask } from "../tasks/AgentTask";
import type { AgentMode } from "../tools/ToolRegistry";
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
	runTurn(input: AgentRuntimeFacadeInput): Promise<AgentTurnResult>;
}

export interface AgentResumeRunResult {
	input: AgentRuntimeFacadeInput;
	result: AgentTurnResult;
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

	private buildInput(task: AgentTask, kind: "retry" | "continue", options: AgentResumeRunOptions): AgentRuntimeFacadeInput {
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
			conversation: [],
			userPrompt,
			modelOverride: snapshot.modelOverride,
			depth: snapshot.depth,
			currentFilePath: snapshot.currentFilePath,
			extraSystemContext: snapshot.extraSystemContext,
			allowedTools: snapshot.allowedTools,
			agentMode: snapshot.agentMode as AgentMode | undefined,
			onProgress: options.onProgress,
			signal: options.signal,
			traceId: options.traceId,
			...(kind === "retry" ? { retryOfTaskId: task.id } : { continueFromTaskId: task.id }),
		};
	}
}
