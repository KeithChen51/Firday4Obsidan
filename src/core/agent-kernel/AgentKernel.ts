import { AgentExecutionContext } from "./AgentExecutionContext";
import { AgentFailureClassifier } from "./AgentFailureClassifier";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "./AgentKernelPorts";
import type {
	AgentRuntimeFacadeInput,
	AgentTurnEvent,
	AgentTurnInput,
	AgentTurnResult,
	AgentTurnStatus,
	RuntimeProgressEvent,
	RuntimeTurnInput,
	RuntimeTurnResult,
} from "./contracts";

export type { RuntimeProgressEvent, RuntimeTurnInput, RuntimeTurnResult };

export class AgentKernel {
	constructor(
		private readonly executor: RuntimeTurnExecutorPort,
		private readonly failureClassifier: AgentFailureClassifierPort = new AgentFailureClassifier(),
	) {}

	async runTurn(input: AgentTurnInput | AgentRuntimeFacadeInput): Promise<AgentTurnResult> {
		const normalizedInput = normalizeTurnInput(input);
		const context = new AgentExecutionContext({
			turnId: normalizedInput.turnId ?? createKernelTurnId(),
			taskId: normalizedInput.taskId,
			traceId: normalizedInput.traceId,
			conversationId: normalizedInput.conversationId,
			agentId: normalizedInput.agentId,
			mode: normalizedInput.mode,
			signal: normalizedInput.signal,
			budget: normalizedInput.budget,
			metadata: normalizedInput.metadata,
		});
		const kernelInput: AgentTurnInput = {
			...normalizedInput,
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			budget: context.budget,
		};
		context.emit({
			type: "turn_started",
			payload: { mode: kernelInput.mode },
		});
		if (context.isCancelled()) {
			const failure = this.failureClassifier.classify(
				{ name: "AbortError", message: "Turn cancelled before execution." },
				{ status: "cancelled" },
			);
			context.emit({ type: "turn_cancelled", status: "cancelled", failure });
			return {
				turnId: context.turnId,
				taskId: context.taskId,
				traceId: context.traceId,
				conversationId: context.conversationId,
				status: "cancelled",
				assistantText: failure.userMessage,
				events: context.snapshotEvents(),
				traces: [],
				rawFinalReply: "",
				budget: context.budget,
				failure,
			};
		}
		try {
			const result = await this.executor.execute(kernelInput, context);
			context.setTaskId(result.taskId ?? result.task?.id);
			const status = normalizeTurnStatus(result, context);
			const failure = status === "failed" || status === "cancelled"
				? result.failure ?? this.failureClassifier.classify(undefined, { ...result, status })
				: result.failure;
			context.emit({
				type: terminalEventType(status),
				status,
				...(failure ? { failure } : {}),
			});
			return normalizeTurnResult(result, kernelInput, context, status, failure);
		} catch (error) {
			const failure = this.failureClassifier.classify(error);
			const status: AgentTurnStatus = failure.category === "cancelled" ? "cancelled" : "failed";
			context.emit({
				type: terminalEventType(status),
				status,
				failure,
			});
			return {
				turnId: context.turnId,
				taskId: context.taskId,
				traceId: context.traceId,
				conversationId: context.conversationId,
				status,
				assistantText: failure.userMessage,
				events: context.snapshotEvents(),
				traces: [],
				rawFinalReply: "",
				budget: context.budget,
				failure,
				raw: error,
			};
		}
	}
}

export class AgentRuntimeFacade {
	constructor(private readonly kernel: AgentKernel) {}

	runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		return this.kernel.runTurn(input);
	}
}

function normalizeTurnInput(input: AgentTurnInput | AgentRuntimeFacadeInput): AgentTurnInput {
	const agentId = input.agentId?.trim() || "default";
	const facadeInput = input as AgentRuntimeFacadeInput;
	const mode = input.mode ?? facadeInput.agentMode ?? "ask";
	return {
		...input,
		agentId,
		taskId: normalizeOptionalString(input.taskId),
		traceId: normalizeOptionalString(input.traceId),
		conversationId: input.conversationId?.trim() || agentId,
		conversation: input.conversation ?? [],
		userPrompt: input.userPrompt ?? "",
		mode,
		metadata: { ...(input.metadata ?? {}) },
	};
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

function normalizeTurnStatus(result: AgentTurnResult, context: AgentExecutionContext): AgentTurnStatus {
	if (context.isCancelled()) {
		return "cancelled";
	}
	return result.status ?? "completed";
}

function normalizeTurnResult(
	result: AgentTurnResult,
	input: AgentTurnInput,
	context: AgentExecutionContext,
	status: AgentTurnStatus,
	failure: AgentTurnResult["failure"],
): AgentTurnResult {
	return {
		...result,
		turnId: result.turnId || context.turnId,
		taskId: result.taskId ?? result.task?.id ?? context.taskId,
		traceId: result.traceId ?? context.traceId,
		conversationId: result.conversationId || input.conversationId,
		status,
		assistantText: result.assistantText ?? "",
		events: mergeEvents(result.events ?? [], context.snapshotEvents()),
		traces: result.traces ?? [],
		rawFinalReply: result.rawFinalReply ?? result.assistantText ?? "",
		budget: result.budget ?? context.budget,
		...(failure ? { failure } : {}),
	};
}

function terminalEventType(status: AgentTurnStatus): AgentTurnEvent["type"] {
	if (status === "failed") {
		return "turn_failed";
	}
	if (status === "cancelled") {
		return "turn_cancelled";
	}
	return "turn_completed";
}

function mergeEvents(first: AgentTurnEvent[], second: AgentTurnEvent[]): AgentTurnEvent[] {
	const merged: AgentTurnEvent[] = [];
	const seen = new Set<string>();
	for (const event of [...first, ...second]) {
		const key = `${event.type}:${event.turnId}:${event.at}:${JSON.stringify(event.payload ?? {})}:${event.status ?? ""}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(event);
	}
	return merged;
}

function createKernelTurnId(): string {
	const random = Math.random().toString(16).slice(2, 8);
	return `kernel-turn-${Date.now()}-${random}`;
}
