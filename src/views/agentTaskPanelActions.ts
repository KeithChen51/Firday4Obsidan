import type { AgentTask } from "../core/tasks/AgentTask";
import type { RuntimeProgressEvent, RuntimeTurnResult } from "../services/AgentRuntimeService";

export interface AgentTaskPanelRuntime {
	retryAgentTask(
		taskId: string,
		options?: AgentTaskPanelResumeOptions,
	): Promise<Pick<RuntimeTurnResult, "task">>;
	cancelAgentTask(taskId: string): Promise<AgentTask>;
	continueAgentTask(
		taskId: string,
		options?: AgentTaskPanelResumeOptions,
	): Promise<Pick<RuntimeTurnResult, "task">>;
	acceptEditPlan(planId: string): Promise<unknown>;
	rejectEditPlan(planId: string): Promise<unknown>;
	getAgentTask(taskId: string): Promise<AgentTask | undefined>;
}

export interface AgentTaskPanelResumeOptions {
	userPrompt?: string;
	onProgress?: (event: RuntimeProgressEvent) => void;
	signal?: AbortSignal;
}

export interface AgentTaskPanelActionCallbacks {
	abortCurrentRun?: () => void;
	getContinuePrompt?: () => string;
	onProgress?: (event: RuntimeProgressEvent) => void;
	recordAgentTask: (task?: AgentTask) => void;
	render: () => void;
	signal?: AbortSignal;
}

export interface AgentTaskPanelActionHandlers {
	retry(): Promise<Pick<RuntimeTurnResult, "task">>;
	cancel(): Promise<AgentTask>;
	continue(): Promise<Pick<RuntimeTurnResult, "task">>;
	apply(planId?: string): Promise<AgentTask | undefined>;
	reject(planId?: string): Promise<AgentTask | undefined>;
}

export function createAgentTaskPanelActionHandlers(
	taskId: string,
	runtime: AgentTaskPanelRuntime,
	callbacks: AgentTaskPanelActionCallbacks,
): AgentTaskPanelActionHandlers {
	const refreshTask = async (): Promise<AgentTask | undefined> => {
		const updated = await runtime.getAgentTask(taskId);
		callbacks.recordAgentTask(updated);
		callbacks.render();
		return updated;
	};

	return {
		async retry() {
			const result = await runtime.retryAgentTask(taskId, {
				onProgress: callbacks.onProgress,
				signal: callbacks.signal,
			});
			callbacks.recordAgentTask(result.task);
			callbacks.render();
			return result;
		},

		async cancel() {
			callbacks.abortCurrentRun?.();
			const task = await runtime.cancelAgentTask(taskId);
			callbacks.recordAgentTask(task);
			callbacks.render();
			return task;
		},

		async continue() {
			const result = await runtime.continueAgentTask(taskId, {
				userPrompt: callbacks.getContinuePrompt?.() || "Continue.",
				onProgress: callbacks.onProgress,
				signal: callbacks.signal,
			});
			callbacks.recordAgentTask(result.task);
			callbacks.render();
			return result;
		},

		async apply(planId?: string) {
			if (!planId) {
				return undefined;
			}
			await runtime.acceptEditPlan(planId);
			return refreshTask();
		},

		async reject(planId?: string) {
			if (!planId) {
				return undefined;
			}
			await runtime.rejectEditPlan(planId);
			return refreshTask();
		},
	};
}

export async function recordTaskFromRuntimeProgress(
	event: Pick<RuntimeProgressEvent, "taskId">,
	runtime: Pick<AgentTaskPanelRuntime, "getAgentTask">,
	seenTaskIds: Set<string>,
	callbacks: Pick<AgentTaskPanelActionCallbacks, "recordAgentTask" | "render">,
): Promise<AgentTask | undefined> {
	if (!event.taskId || seenTaskIds.has(event.taskId)) {
		return undefined;
	}
	seenTaskIds.add(event.taskId);
	const task = await runtime.getAgentTask(event.taskId);
	if (!task) {
		return undefined;
	}
	callbacks.recordAgentTask(task);
	callbacks.render();
	return task;
}
