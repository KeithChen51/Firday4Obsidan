import { AgentMutationCoordinator } from "../core/agent-kernel/AgentMutationCoordinator";
import { AgentReplayRecorder } from "../core/agent-kernel/AgentReplayRecorder";
import { AgentResumeController } from "../core/agent-kernel/AgentResumeController";
import { AgentTaskManager } from "../core/agent-kernel/AgentTaskManager";
import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, AgentTurnStatus, RuntimeMutationPlan } from "../core/agent-kernel/contracts";
import type { TurnEventInput, TurnEventLog } from "../core/runtime/TurnEventLog";
import type { StepTraceEvent } from "../core/turn-state/TurnStateMachine";
import type { AgentTask } from "../core/tasks/AgentTask";
import type { AgentTaskStore } from "../core/tasks/AgentTaskStore";
import type { MutationPlanStore } from "../core/mutations/MutationPlanStore";
import type { EditPlanRecord, WorkbenchStateStore } from "../features/workbench/WorkbenchStateStore";
import type { RuntimeProfile } from "../platform/runtime/RuntimeProfile";

export interface ObsidianAgentStateAdapterOptions {
	taskStore: AgentTaskStore;
	eventLog: TurnEventLog;
	mutationStore: MutationPlanStore;
	workbenchStateStore: WorkbenchStateStore;
	runTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
}

export interface ObsidianCompleteTurnOptions {
	stepTraces?: StepTraceEvent[];
	sideEvents?: TurnEventInput[];
	runtimeProfile?: RuntimeProfile;
	contextSummary?: AgentTurnResult["contextSummary"];
}

export interface ObsidianFailTurnOptions {
	stepTraces?: StepTraceEvent[];
	sideEvents?: TurnEventInput[];
}

export class ObsidianAgentStateAdapter {
	readonly taskManager: AgentTaskManager;
	readonly replayRecorder: AgentReplayRecorder;
	readonly mutationCoordinator: AgentMutationCoordinator;
	readonly resumeController: AgentResumeController;

	constructor(private readonly options: ObsidianAgentStateAdapterOptions) {
		this.taskManager = new AgentTaskManager({ taskStore: options.taskStore });
		this.replayRecorder = new AgentReplayRecorder({ eventLog: options.eventLog });
		this.mutationCoordinator = new AgentMutationCoordinator({ mutationStore: options.mutationStore });
		this.resumeController = new AgentResumeController({
			taskManager: this.taskManager,
			runTurn: (input) => options.runTurn(input as AgentTurnInput),
		});
	}

	beginTurn(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTask> {
		return this.taskManager.beginTurn(input, context);
	}

	async completeTurn(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		result: AgentTurnResult,
		options: ObsidianCompleteTurnOptions = {},
	): Promise<AgentTurnResult> {
		const finalResult = this.withPendingMutationNotice(result, context);
		const taskPendingMutations = this.collectPendingMutations(finalResult, context);
		const task = await this.taskManager.completeTurn({ ...finalResult, pendingMutations: taskPendingMutations }, context);
		const status = this.resolveTurnStatus(task, finalResult);
		const output: AgentTurnResult = {
			...finalResult,
			turnId: context.turnId,
			taskId: task.id,
			traceId: context.traceId,
			conversationId: context.conversationId,
			status,
			events: context.snapshotEvents(),
			pendingMutations: finalResult.pendingMutations,
			task,
			stepTraces: options.stepTraces ?? finalResult.stepTraces,
			runtimeProfile: options.runtimeProfile ?? finalResult.runtimeProfile,
			contextSummary: options.contextSummary ?? finalResult.contextSummary,
		};
		await this.replayRecorder.recordTurn({
			context,
			result: output,
			extraEvents: [
				...(options.sideEvents ?? []),
				...this.buildDiagnosticReplayEvents(output),
				{ type: "assistant_final", payload: { summary: this.truncate(output.assistantText, 240), traceId: context.traceId } },
				this.buildTerminalReplayEvent(status, output),
			],
		});
		void input;
		return output;
	}

	async failTurn(error: unknown, context: AgentExecutionContext, options: ObsidianFailTurnOptions = {}): Promise<void> {
		const task = await this.taskManager.failTurn(error, context);
		const message = error instanceof Error ? error.message : String(error ?? "Task failed.");
		const status: AgentTurnStatus = task?.status === "cancelled" ? "cancelled" : "failed";
		const diagnostics = this.buildFailureDiagnostics(message, status);
		await this.replayRecorder.recordTurn({
			context,
			result: {
				turnId: context.turnId,
				taskId: context.taskId,
				traceId: context.traceId,
				conversationId: context.conversationId,
				status,
				assistantText: message,
				events: context.snapshotEvents(),
				traces: [],
				rawFinalReply: "",
				...(task ? { task } : {}),
				stepTraces: options.stepTraces,
			},
			extraEvents: [
				...(options.sideEvents ?? []),
				{
					type: "model_failed",
					payload: { summary: this.truncate(message, 240), traceId: context.traceId, ...diagnostics },
				},
				{
					type: status === "cancelled" ? "turn_cancelled" : "turn_failed",
					payload: { summary: this.truncate(message, 240), traceId: context.traceId, ...diagnostics },
				},
			],
		});
	}

	private collectPendingMutations(result: AgentTurnResult, context: AgentExecutionContext): RuntimeMutationPlan[] {
		const fromResult = result.pendingMutations ?? [];
		const fromWorkbench = this.options.workbenchStateStore
			.getEditPlans()
			.filter((plan) =>
				plan.originConversationId === context.conversationId &&
				plan.originTurnId === context.turnId &&
				plan.items.some((item) => item.status === "pending")
			)
			.map((plan) => this.toRuntimeMutationPlan(plan));
		const byId = new Map<string, RuntimeMutationPlan>();
		for (const plan of [...fromResult, ...fromWorkbench]) {
			const key = plan.id ?? `${plan.operation}:${plan.targetPath}`;
			byId.set(key, plan);
		}
		return [...byId.values()];
	}

	private toRuntimeMutationPlan(plan: EditPlanRecord): RuntimeMutationPlan {
		const firstItem = plan.items[0];
		return {
			id: plan.id,
			operation: plan.tool,
			targetPath: firstItem?.path ?? "",
			summary: firstItem?.summary ?? `${plan.tool} ${firstItem?.path ?? ""}`.trim(),
			status: "pending",
			source: "tool",
		};
	}

	private withPendingMutationNotice(result: AgentTurnResult, context: AgentExecutionContext): AgentTurnResult {
		const pendingCount = this.collectPendingMutations(result, context).length;
		if (pendingCount === 0) {
			return result;
		}
		const notice = `Pending file review: ${pendingCount} change(s) prepared but not applied. Review and apply or reject them in FRIDAY.`;
		if (result.assistantText.includes(notice)) {
			return result;
		}
		return {
			...result,
			assistantText: `${result.assistantText.trim()}\n\n${notice}`.trim(),
		};
	}

	private resolveTurnStatus(task: AgentTask, result: AgentTurnResult): AgentTurnStatus {
		switch (task.status) {
			case "waiting_for_approval":
			case "waiting_for_user":
			case "cancelled":
				return task.status;
			case "failed":
				return result.status === "failed" ? "failed" : "completed";
			default:
				return "completed";
		}
	}

	private buildDiagnosticReplayEvents(result: AgentTurnResult): TurnEventInput[] {
		const events: TurnEventInput[] = [];
		if (result.parseError) {
			events.push({
				type: "parse_error",
				payload: { summary: this.truncate(result.parseError, 240), traceId: result.traceId },
			});
		}
		if (this.isMaxToolIterationStop(result.assistantText)) {
			events.push({
				type: "max_tool_iterations",
				payload: { summary: "Maximum tool iteration limit reached.", traceId: result.traceId },
			});
		}
		return events;
	}

	private buildTerminalReplayEvent(status: AgentTurnStatus, result: AgentTurnResult): TurnEventInput {
		if (status === "failed") {
			return {
				type: "turn_failed",
				payload: { summary: this.truncate(result.failure?.userMessage ?? result.assistantText, 240), traceId: result.traceId },
			};
		}
		if (status === "cancelled") {
			return {
				type: "turn_cancelled",
				payload: { summary: this.truncate(result.failure?.userMessage ?? result.assistantText, 240), traceId: result.traceId },
			};
		}
		return {
			type: "turn_completed",
			payload: {
				status: this.isMaxToolIterationStop(result.assistantText)
					? "safe_stopped"
					: status === "waiting_for_approval" || status === "waiting_for_user" ? status : "completed",
				traceId: result.traceId,
			},
		};
	}

	private isMaxToolIterationStop(assistantText: string): boolean {
		return assistantText.includes("Maximum tool-iteration limit reached");
	}

	private buildFailureDiagnostics(message: string, status: AgentTurnStatus): Record<string, unknown> {
		const failureClass = status === "cancelled"
			? "cancelled"
			: /(gateway timeout|504|timeout|econnreset|retryable|temporarily unavailable)/i.test(message)
				? "transport_unstable"
				: "tool_runtime_error";
		const retryable = failureClass === "transport_unstable";
		return {
			error: this.truncate(message, 500),
			failureClass,
			recoverable: retryable,
			retryable,
		};
	}

	private truncate(value: string, maxLength: number): string {
		return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
	}
}
