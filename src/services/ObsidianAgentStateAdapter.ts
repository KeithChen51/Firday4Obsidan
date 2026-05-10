import { AgentMutationCoordinator } from "../core/agent-kernel/AgentMutationCoordinator";
import { AgentReplayRecorder } from "../core/agent-kernel/AgentReplayRecorder";
import { AgentResumeController } from "../core/agent-kernel/AgentResumeController";
import { AgentTaskManager } from "../core/agent-kernel/AgentTaskManager";
import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import { validateCheckpointForResume, type AgentLoopCheckpoint } from "../core/agent-kernel/checkpoints/AgentLoopCheckpoint";
import type { AgentLoopCheckpointStore } from "../core/agent-kernel/checkpoints/AgentLoopCheckpointStore";
import type { AgentTurnInput, AgentTurnResult, AgentTurnStatus, RuntimeMutationPlan } from "../core/agent-kernel/contracts";
import {
	containsRawMaxToolIterationText,
	extractMutationPlans,
	MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT,
	MAX_TOOL_ITERATION_SAFE_SUMMARY,
	type RuntimeEnvelope,
} from "../core/agent-kernel/RuntimeProtocol";
import type { TurnEventInput, TurnEventLog } from "../core/runtime/TurnEventLog";
import type { StepTraceEvent } from "../core/turn-state/TurnStateMachine";
import type { AgentTask } from "../core/tasks/AgentTask";
import type { AgentTaskStore } from "../core/tasks/AgentTaskStore";
import type { MutationChangeType, MutationOperation, MutationPlan, MutationRiskLevel } from "../core/mutations/MutationPlan";
import type { MutationPlanStore } from "../core/mutations/MutationPlanStore";
import { formatFileMutationEventSummary } from "../core/tools/ToolResultFormatter";
import type { EditPlanRecord, WorkbenchStateStore } from "../features/workbench/WorkbenchStateStore";
import type { RuntimeProfile } from "../platform/runtime/RuntimeProfile";

export interface ObsidianAgentStateAdapterOptions {
	taskStore: AgentTaskStore;
	checkpointStore: AgentLoopCheckpointStore;
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
			checkpointStore: options.checkpointStore,
			runTurn: (input) => options.runTurn(input as AgentTurnInput),
		});
	}

	async saveCheckpoint(checkpoint: AgentLoopCheckpoint): Promise<void> {
		await this.options.checkpointStore.save(checkpoint);
		if (!checkpoint.taskId) {
			return;
		}
		const validation = validateCheckpointForResume({
			checkpoint,
			conversationId: checkpoint.conversationId,
			agentId: checkpoint.agentId,
			taskId: checkpoint.taskId,
			allowedTools: checkpoint.allowedTools,
		});
		await this.taskManager.updateCheckpoint(checkpoint.taskId, {
			latestId: checkpoint.id,
			boundary: checkpoint.boundary,
			canResume: validation.ok,
			reason: validation.ok ? checkpoint.safety.reason : validation.reason,
			updatedAt: checkpoint.createdAt,
		});
	}

	getResumeCheckpoint(input: AgentTurnInput, _context: AgentExecutionContext): Promise<AgentLoopCheckpoint | null> {
		const checkpointId = input.resumeFromCheckpointId?.trim() ||
			(typeof input.metadata?.resumeFromCheckpointId === "string" ? input.metadata.resumeFromCheckpointId.trim() : "");
		if (checkpointId) {
			return this.options.checkpointStore.get(checkpointId);
		}
		if (input.retryOfTaskId) {
			return this.options.checkpointStore.getLatestForTask(input.retryOfTaskId);
		}
		return Promise.resolve(null);
	}

	markCheckpointConsumed(
		checkpointId: string,
		result: "resumed" | "rejected" | "expired",
		reason: string,
	): Promise<void> {
		return this.options.checkpointStore.markConsumed(checkpointId, result, reason);
	}

	beginTurn(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTask> {
		return this.taskManager.beginTurn(input, context);
	}

	async recordMutationPlansFromEnvelope(
		envelope: RuntimeEnvelope,
		source: string,
		context: AgentExecutionContext,
	): Promise<RuntimeMutationPlan[]> {
		const rawPlans = extractMutationPlans(envelope);
		const planned: RuntimeMutationPlan[] = [];
		for (const [index, rawPlan] of rawPlans.entries()) {
			const normalized = this.normalizeRuntimeMutationPlan(rawPlan, index, source, context);
			if (this.canPersistRuntimeMutation(rawPlan, normalized)) {
				const plan = await this.mutationCoordinator.createPlan(context, {
					id: normalized.id,
					operation: normalized.operation,
					targetPath: normalized.targetPath,
					before: rawPlan.before ?? "",
					after: rawPlan.after ?? "",
					summary: normalized.summary ?? `${normalized.operation} ${normalized.targetPath}`.trim(),
					changeType: normalized.changeType as MutationChangeType | undefined,
					riskLevel: normalized.riskLevel as MutationRiskLevel | undefined,
					toolCallId: normalized.toolCallId,
				});
				this.options.workbenchStateStore.recordEditPlan(this.toEditPlanRecord(plan));
				planned.push(this.toRuntimeMutationPlanFromStored(plan, source));
				continue;
			}
			context.emit({
				type: "mutation_planned",
				payload: {
					id: normalized.id,
					operation: normalized.operation,
					targetPath: normalized.targetPath,
					summary: normalized.summary,
					status: normalized.status,
					source: normalized.source,
					taskId: context.taskId,
					traceId: context.traceId,
				},
			});
			planned.push(normalized);
		}
		return planned;
	}

	async completeTurn(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		result: AgentTurnResult,
		options: ObsidianCompleteTurnOptions = {},
	): Promise<AgentTurnResult> {
		const finalResult = this.withSafeStopUserText(this.withPendingMutationNotice(result, context));
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
			.map((plan) => this.toRuntimeMutationPlanFromEditRecord(plan));
		const byId = new Map<string, RuntimeMutationPlan>();
		for (const plan of [...fromResult, ...fromWorkbench]) {
			const key = plan.id ?? `${plan.operation}:${plan.targetPath}`;
			byId.set(key, plan);
		}
		return [...byId.values()];
	}

	private toRuntimeMutationPlanFromEditRecord(plan: EditPlanRecord): RuntimeMutationPlan {
		const firstItem = plan.items[0];
		return {
			id: plan.id,
			operation: plan.tool,
			targetPath: firstItem?.path ?? "",
			summary: this.formatMutationSummary(plan.tool, firstItem?.path ?? "", firstItem?.changeType, "planned"),
			status: "pending",
			source: "tool",
			taskId: plan.originTaskId,
			traceId: plan.originTraceId,
			toolCallId: plan.toolCallId,
		};
	}

	private toRuntimeMutationPlanFromStored(plan: MutationPlan, source: string): RuntimeMutationPlan {
		return {
			id: plan.id,
			operation: plan.operation,
			targetPath: plan.targetPath,
			summary: this.formatMutationSummary(plan.operation, plan.targetPath, plan.items[0]?.changeType, plan.status === "pending" ? "planned" : plan.status),
			status: plan.status,
			source,
			taskId: plan.taskId,
			traceId: plan.traceId,
			toolCallId: plan.toolCallId,
		};
	}

	private toEditPlanRecord(plan: MutationPlan): EditPlanRecord {
		return {
			id: plan.id,
			agentId: plan.agentId,
			originConversationId: plan.conversationId,
			originTurnId: plan.turnId,
			originTaskId: plan.taskId,
			originTraceId: plan.traceId,
			toolCallId: plan.toolCallId,
			tool: plan.operation,
			recordedAt: plan.createdAt,
			items: plan.items.map((item) => ({
				path: item.path,
				before: item.before,
				after: item.after,
				beforeHash: item.beforeHash,
				afterHash: item.afterHash,
				status: item.status,
				changeType: item.changeType,
				riskLevel: plan.riskLevel,
				summary: plan.summary,
			})),
		};
	}

	private normalizeRuntimeMutationPlan(
		plan: RuntimeMutationPlan,
		index: number,
		source: string,
		context: AgentExecutionContext,
	): RuntimeMutationPlan {
		const operation = typeof plan.operation === "string" ? plan.operation.trim() : "";
		const targetPath = typeof plan.targetPath === "string" ? this.normalizeTargetPath(plan.targetPath) : "";
		const id = typeof plan.id === "string" && plan.id.trim()
			? plan.id.trim()
			: `mutation-plan-${context.turnId}-${index + 1}`;
		const status = typeof plan.status === "string" && plan.status.trim() ? plan.status.trim() : "pending";
		const summary = this.formatMutationSummary(operation, targetPath, plan.changeType, status === "pending" ? "planned" : status);
		return {
			...plan,
			id,
			operation,
			targetPath,
			summary,
			status,
			source,
			taskId: context.taskId,
			traceId: context.traceId,
			toolCallId: typeof plan.toolCallId === "string" && plan.toolCallId.trim() ? plan.toolCallId.trim() : undefined,
			changeType: this.normalizeChangeType(plan.changeType),
			riskLevel: this.normalizeRiskLevel(plan.riskLevel),
		};
	}

	private canPersistRuntimeMutation(rawPlan: RuntimeMutationPlan, normalized: RuntimeMutationPlan): normalized is RuntimeMutationPlan & {
		operation: MutationOperation;
		targetPath: string;
	} {
		if (!this.isMutationOperation(normalized.operation) || !normalized.targetPath) {
			return false;
		}
		if (normalized.operation === "delete") {
			return typeof rawPlan.before === "string";
		}
		return typeof rawPlan.before === "string" && typeof rawPlan.after === "string";
	}

	private isMutationOperation(value: string | undefined): value is MutationOperation {
		return value === "write" || value === "edit" || value === "delete";
	}

	private normalizeChangeType(value: string | undefined): MutationChangeType | undefined {
		return value === "create" || value === "update" || value === "delete" ? value : undefined;
	}

	private normalizeRiskLevel(value: string | undefined): MutationRiskLevel | undefined {
		return value === "standard" || value === "high" ? value : undefined;
	}

	private formatMutationSummary(
		operation: string | undefined,
		targetPath: string | undefined,
		changeType: string | undefined,
		status: string | undefined,
	): string {
		return formatFileMutationEventSummary({
			operation,
			targetPath,
			changeType,
			status,
		});
	}

	private normalizeTargetPath(value: string): string {
		return value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	}

	private withPendingMutationNotice(result: AgentTurnResult, context: AgentExecutionContext): AgentTurnResult {
		const pendingCount = this.collectPendingMutations(result, context).length;
		if (pendingCount === 0) {
			return result;
		}
		const notice = `Pending file changes: ${pendingCount} change(s) prepared but not applied. Review and apply or reject them in FRIDAY.`;
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
				return result.status === "failed" || result.status === "safe_stopped" ? result.status : "completed";
			default:
				return result.status === "safe_stopped" ? "safe_stopped" : "completed";
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
		if (this.isMaxToolIterationStop(result)) {
			if (result.events?.some((event) => event.type === "max_tool_iterations")) {
				return events;
			}
			events.push({
				type: "max_tool_iterations",
				payload: {
					status: "safe_stopped",
					summary: MAX_TOOL_ITERATION_SAFE_SUMMARY,
					traceId: result.traceId,
				},
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
				status: this.isMaxToolIterationStop(result)
					? "safe_stopped"
					: status === "waiting_for_approval" || status === "waiting_for_user" ? status : "completed",
				traceId: result.traceId,
			},
		};
	}

	private withSafeStopUserText(result: AgentTurnResult): AgentTurnResult {
		if (!this.isMaxToolIterationStop(result)) {
			return result;
		}
		if (!containsRawMaxToolIterationText(result.assistantText)) {
			return result;
		}
		return {
			...result,
			assistantText: MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT,
		};
	}

	private isMaxToolIterationStop(result: AgentTurnResult): boolean {
		return result.status === "safe_stopped" || containsRawMaxToolIterationText(result.assistantText);
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
