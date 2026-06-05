import { AgentFailureClassifier } from "../AgentFailureClassifier";
import type { AgentExecutionContext } from "../AgentExecutionContext";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "../AgentKernelPorts";
import type {
	AgentFailure,
	AgentTurnInput,
	AgentTurnResult,
	AgentTurnStatus,
	RuntimeProgressEvent,
	RuntimeToolTrace,
} from "../contracts";
import type {
	FridayPiDoneEvent,
	FridayPiErrorEvent,
	FridayPiSessionEndEvent,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionPort,
	FridayPiToolCallEvent,
	FridayPiToolResultEvent,
} from "./FridayPiRuntimePorts";

interface PiTurnState {
	textDeltas: string[];
	finalText?: string;
	traces: RuntimeToolTrace[];
	error?: unknown;
	doneReported: boolean;
}

export class FridayPiRuntime implements RuntimeTurnExecutorPort {
	constructor(
		private readonly host: FridayPiSessionHostPort,
		private readonly failureClassifier: AgentFailureClassifierPort = new AgentFailureClassifier(),
	) {}

	async execute(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult> {
		if (context.isCancelled()) {
			return this.cancelledResult(input, context);
		}

		const state: PiTurnState = {
			textDeltas: [],
			traces: [],
			doneReported: false,
		};
		let session: FridayPiSessionPort | undefined;
		let unsubscribe: (() => void) | undefined;

		this.report(input, context, {
			phase: "start",
			depth: this.depth(input),
			message: "PI runtime started.",
		});

		try {
			session = await this.host.createSession(input, context);
			unsubscribe = session.subscribe((event) => this.handleSessionEvent(event, input, context, state));
			await session.prompt(input.userPrompt, {
				signal: context.signal,
				metadata: this.buildPromptMetadata(input, context),
			});
		} catch (error) {
			state.error = state.error ?? error;
			this.reportError(input, context, error);
		} finally {
			try {
				unsubscribe?.();
			} catch (error) {
				state.error = state.error ?? error;
				this.reportError(input, context, error);
			}

			try {
				await session?.dispose?.();
			} catch (error) {
				state.error = state.error ?? error;
				this.reportError(input, context, error);
			}
		}

		if (context.isCancelled() && !state.error) {
			return this.cancelledResult(input, context, state);
		}

		if (state.error) {
			return this.failedResult(input, context, state, state.error);
		}

		if (!state.doneReported) {
			this.reportDone(input, context, "PI session finished.");
		}

		return {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: input.conversationId,
			status: "completed",
			assistantText: this.resolveAssistantText(state),
			events: context.snapshotEvents(),
			traces: state.traces,
			rawFinalReply: this.resolveAssistantText(state),
			budget: context.budget,
		};
	}

	private handleSessionEvent(
		event: FridayPiSessionEvent,
		input: AgentTurnInput,
		context: AgentExecutionContext,
		state: PiTurnState,
	): void {
		switch (event.type) {
			case "text_delta":
				state.textDeltas.push(event.text);
				this.report(input, context, {
					phase: "model_response",
					depth: this.depth(input),
					message: event.text,
				});
				break;
			case "text_final":
				state.finalText = event.text;
				this.report(input, context, {
					phase: "model_response",
					depth: this.depth(input),
					message: event.text,
				});
				break;
			case "tool_call":
				this.reportToolCall(input, context, event);
				break;
			case "tool_result": {
				const trace = this.toToolTrace(event, context, state.traces.length + 1);
				state.traces.push(trace);
				this.report(input, context, {
					phase: "tool_result",
					depth: this.depth(input),
					step: trace.step,
					tool: trace.tool,
					targetPath: trace.targetPath,
					status: trace.status,
					summary: trace.summary,
					message: trace.summary,
				});
				break;
			}
			case "error":
				state.error = state.error ?? this.toError(event);
				this.reportError(input, context, state.error);
				break;
			case "done":
			case "session_end":
				state.doneReported = true;
				this.reportDone(input, context, this.sessionEndSummary(event));
				break;
		}
	}

	private reportToolCall(input: AgentTurnInput, context: AgentExecutionContext, event: FridayPiToolCallEvent): void {
		this.report(input, context, {
			phase: "tool_call",
			depth: this.depth(input),
			step: event.step,
			tool: event.tool,
			targetPath: event.targetPath ?? "",
			summary: event.summary,
			message: event.summary ?? `Calling ${event.tool}.`,
		});
	}

	private toToolTrace(event: FridayPiToolResultEvent, context: AgentExecutionContext, fallbackStep: number): RuntimeToolTrace {
		const step = event.step ?? fallbackStep;
		const status = event.status ?? (event.ok === false || event.error ? "failed" : "ok");
		const ok = event.ok ?? status === "ok";
		const tool = event.tool || "unknown_tool";
		const summary = event.summary ?? event.error ?? `${tool} ${status}`;
		return {
			runId: event.runId ?? `${context.turnId}:${step}:${tool}`,
			step,
			tool,
			scope: event.scope ?? "vault",
			targetPath: event.targetPath ?? "",
			approved: event.approved ?? false,
			approvalReason: event.approvalReason ?? "",
			persistedRule: event.persistedRule ?? false,
			viaRule: event.viaRule ?? false,
			status,
			ok,
			summary,
			...(event.error ? { error: event.error } : {}),
			...(event.failureClass ? { failureClass: event.failureClass } : {}),
		};
	}

	private failedResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		state: PiTurnState,
		error: unknown,
	): AgentTurnResult {
		const status: AgentTurnStatus = context.isCancelled() ? "cancelled" : "failed";
		const failure = this.failureClassifier.classify(error, {
			conversationId: input.conversationId,
			status,
			assistantText: this.resolveAssistantText(state),
			events: context.snapshotEvents(),
			traces: state.traces,
		});
		return this.terminalResult(input, context, state, status, failure, error);
	}

	private cancelledResult(input: AgentTurnInput, context: AgentExecutionContext, state?: PiTurnState): AgentTurnResult {
		const cancelReason = context.getCancelReason() ?? "PI runtime turn cancelled.";
		const failure = this.failureClassifier.classify(cancelReason, { status: "cancelled" });
		const turnState = state ?? { textDeltas: [], traces: [], doneReported: false };
		return this.terminalResult(input, context, turnState, "cancelled", failure, cancelReason);
	}

	private terminalResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		state: PiTurnState,
		status: AgentTurnStatus,
		failure: AgentFailure,
		raw: unknown,
	): AgentTurnResult {
		const assistantText = this.resolveAssistantText(state) || failure.userMessage;
		return {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: input.conversationId,
			status,
			assistantText,
			events: context.snapshotEvents(),
			traces: state.traces,
			rawFinalReply: assistantText,
			budget: context.budget,
			failure,
			parseError: failure.technicalMessage,
			raw,
		};
	}

	private reportError(input: AgentTurnInput, context: AgentExecutionContext, error: unknown): void {
		this.report(input, context, {
			phase: "error",
			depth: this.depth(input),
			status: "failed",
			message: this.stringifyError(error) || "PI runtime failed.",
		});
	}

	private reportDone(input: AgentTurnInput, context: AgentExecutionContext, message: string): void {
		this.report(input, context, {
			phase: "done",
			depth: this.depth(input),
			status: "ok",
			message,
		});
	}

	private report(input: AgentTurnInput, context: AgentExecutionContext, event: RuntimeProgressEvent): void {
		input.onProgress?.({
			...event,
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			agentId: context.agentId,
		});
	}

	private buildPromptMetadata(input: AgentTurnInput, context: AgentExecutionContext): Record<string, unknown> {
		return {
			...(input.metadata ?? {}),
			...context.metadata,
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			agentId: context.agentId,
			mode: context.mode,
		};
	}

	private resolveAssistantText(state: PiTurnState): string {
		return state.finalText ?? state.textDeltas.join("");
	}

	private toError(event: FridayPiErrorEvent): Error {
		if (event.error instanceof Error) {
			return event.error;
		}
		if (event.error !== undefined) {
			return new Error(this.stringifyError(event.error));
		}
		return new Error(event.message ?? event.summary ?? "PI runtime emitted an error.");
	}

	private stringifyError(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === "string") {
			return error;
		}
		if (error && typeof error === "object" && "message" in error) {
			const message = (error as { message?: unknown }).message;
			return typeof message === "string" ? message : String(message ?? "");
		}
		return error === undefined || error === null ? "" : String(error);
	}

	private sessionEndSummary(event: FridayPiDoneEvent | FridayPiSessionEndEvent): string {
		return event.summary ?? "PI session finished.";
	}

	private depth(input: AgentTurnInput): number {
		return input.depth ?? 0;
	}
}
