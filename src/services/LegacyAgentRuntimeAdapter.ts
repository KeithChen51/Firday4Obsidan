import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import { AgentFailureClassifier } from "../core/agent-kernel/AgentFailureClassifier";
import type { RuntimeTurnExecutorPort } from "../core/agent-kernel/AgentKernelPorts";
import type { AgentFailureClassifierPort } from "../core/agent-kernel/AgentKernelPorts";
import type { AgentTurnInput, AgentTurnResult, AgentTurnStatus } from "../core/agent-kernel/contracts";
import type {
	RuntimeTurnInput as LegacyRuntimeTurnInput,
	RuntimeTurnResult as LegacyRuntimeTurnResult,
} from "./AgentRuntimeService";

export interface LegacyAgentRuntimeRunner {
	runTurn(input: LegacyRuntimeTurnInput): Promise<LegacyRuntimeTurnResult>;
}

export class LegacyAgentRuntimeAdapter implements RuntimeTurnExecutorPort {
	constructor(
		private readonly runtime: LegacyAgentRuntimeRunner,
		private readonly failureClassifier: AgentFailureClassifierPort = new AgentFailureClassifier(),
	) {}

	async execute(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult> {
		try {
			const legacyResult = await this.runtime.runTurn(this.toLegacyInput(input, context));
			return this.toKernelResult(legacyResult, input, context);
		} catch (error) {
			const failure = this.failureClassifier.classify(error);
			const status: AgentTurnStatus = failure.category === "cancelled" ? "cancelled" : "failed";
			return {
				turnId: context.turnId,
				taskId: context.taskId,
				traceId: context.traceId,
				conversationId: input.conversationId,
				status,
				assistantText: failure.userMessage,
				events: context.snapshotEvents(),
				traces: [],
				rawFinalReply: "",
				budget: context.budget,
				failure,
				parseError: failure.technicalMessage,
				raw: error,
			};
		}
	}

	private toLegacyInput(input: AgentTurnInput, context: AgentExecutionContext): LegacyRuntimeTurnInput {
		return {
			turnId: context.turnId,
			conversationId: input.conversationId,
			agentId: input.agentId,
			conversation: input.conversation as LegacyRuntimeTurnInput["conversation"],
			userPrompt: input.userPrompt,
			modelOverride: input.modelOverride,
			depth: input.depth,
			currentFilePath: input.currentFilePath,
			extraSystemContext: input.extraSystemContext,
			mentionContext: input.mentionContext as LegacyRuntimeTurnInput["mentionContext"],
			allowedTools: input.allowedTools,
			agentMode: input.mode,
			onProgress: input.onProgress as LegacyRuntimeTurnInput["onProgress"],
			signal: context.signal,
			retryOfTaskId: input.retryOfTaskId,
			continueFromTaskId: input.continueFromTaskId,
		};
	}

	private toKernelResult(
		result: LegacyRuntimeTurnResult,
		input: AgentTurnInput,
		context: AgentExecutionContext,
	): AgentTurnResult {
		const status = this.resolveStatus(result, context);
		context.setTaskId(result.task?.id);
		const failure = status === "failed" || status === "cancelled"
			? this.failureClassifier.classify(undefined, {
				...result,
				conversationId: input.conversationId,
				status,
				events: context.snapshotEvents(),
			})
			: undefined;
		return {
			...result,
			turnId: result.turnId ?? context.turnId,
			taskId: result.task?.id ?? context.taskId,
			traceId: context.traceId,
			conversationId: input.conversationId,
			status,
			assistantText: result.assistantText ?? "",
			events: context.snapshotEvents(),
			traces: result.traces ?? [],
			rawFinalReply: result.rawFinalReply ?? result.assistantText ?? "",
			budget: context.budget,
			pendingMutations: result.pendingMutations,
			task: result.task,
			stepTraces: result.stepTraces,
			runtimeProfile: result.runtimeProfile,
			contextSummary: result.contextSummary,
			parseError: result.parseError,
			raw: result,
			...(failure ? { failure } : {}),
		};
	}

	private resolveStatus(result: LegacyRuntimeTurnResult, context: AgentExecutionContext): AgentTurnStatus {
		if (context.isCancelled()) {
			return "cancelled";
		}
		switch (result.task?.status) {
			case "waiting_for_approval":
			case "waiting_for_user":
			case "failed":
			case "cancelled":
			case "completed":
				return result.task.status;
			default:
				return "completed";
		}
	}
}
