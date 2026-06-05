import { AgentFailureClassifier } from "../AgentFailureClassifier";
import type { AgentExecutionContext } from "../AgentExecutionContext";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "../AgentKernelPorts";
import type {
	AgentFailure,
	AgentTurnEvent,
	AgentTurnInput,
	AgentTurnResult,
	AgentTurnStatus,
	RuntimeProgressEvent,
	RuntimeToolTrace,
} from "../contracts";
import type {
	FridayPiDoneEvent,
	FridayPiErrorEvent,
	FridayPiHostResultEvent,
	FridayPiSessionEndEvent,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionPort,
	FridayPiRuntimeOptions,
	FridayPiToolCallEvent,
	FridayPiToolResultEvent,
} from "./FridayPiRuntimePorts";

const DEFAULT_TERMINAL_EVENT_TIMEOUT_MS = 30_000;
const DEFAULT_CANCELLED_PROMPT_GRACE_MS = 250;

interface PiTurnState {
	textDeltas: string[];
	finalText?: string;
	traces: RuntimeToolTrace[];
	hostResult?: AgentTurnResult;
	error?: unknown;
	doneReported: boolean;
}

interface TerminalSettlement {
	promise: Promise<unknown | undefined>;
	settle(error?: unknown): void;
	readonly settled: boolean;
	readonly error: unknown | undefined;
	dispose(): void;
}

type PromptSettlement =
	| { type: "prompt"; error?: unknown }
	| { type: "terminal"; error?: unknown };

export class FridayPiRuntime implements RuntimeTurnExecutorPort {
	constructor(
		private readonly host: FridayPiSessionHostPort,
		private readonly failureClassifier: AgentFailureClassifierPort = new AgentFailureClassifier(),
		private readonly options: FridayPiRuntimeOptions = {},
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
		const terminal = this.createTerminalSettlement(context);

		this.report(input, context, {
			phase: "start",
			depth: this.depth(input),
			message: "PI runtime started.",
		});

		try {
			session = await this.host.createSession(input, context);
			unsubscribe = session.subscribe((event) => this.handleSessionEvent(event, input, context, state, terminal));
			const promptSettlement = this.startPrompt(session, input, context);
			const firstSettlement = await Promise.race([
				promptSettlement,
				terminal.promise.then((error): PromptSettlement => ({ type: "terminal", error })),
			]);
			if (firstSettlement.type === "terminal" && firstSettlement.error && context.isCancelled()) {
				await this.waitForPromptAfterCancellation(promptSettlement);
			}
			if (state.hostResult && !state.error) {
				terminal.settle();
			}
			if (firstSettlement.error && !state.hostResult) {
				throw firstSettlement.error;
			}
			if (firstSettlement.type === "prompt" && !state.error && !context.isCancelled()) {
				const terminalError = terminal.settled ? terminal.error : await terminal.promise;
				if (terminalError) {
					throw terminalError;
				}
			}
		} catch (error) {
			if (!state.error) {
				state.error = error;
				this.reportError(input, context, error);
			}
		} finally {
			terminal.dispose();
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

		if (state.hostResult) {
			return this.hostResult(input, context, state.hostResult);
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

	private startPrompt(
		session: FridayPiSessionPort,
		input: AgentTurnInput,
		context: AgentExecutionContext,
	): Promise<PromptSettlement> {
		return session.prompt(input.userPrompt, {
			signal: context.signal,
			metadata: this.buildPromptMetadata(input, context),
		}).then(
			() => ({ type: "prompt" as const }),
			(error) => ({ type: "prompt" as const, error }),
		);
	}

	private async waitForPromptAfterCancellation(
		promptSettlement: Promise<PromptSettlement>,
	): Promise<PromptSettlement | undefined> {
		const graceMs = this.resolveCancelledPromptGraceMs();
		if (!Number.isFinite(graceMs) || graceMs <= 0) {
			return undefined;
		}
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promptSettlement,
				new Promise<undefined>((resolve) => {
					timeout = setTimeout(() => resolve(undefined), graceMs);
				}),
			]);
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
	}

	private handleSessionEvent(
		event: FridayPiSessionEvent,
		input: AgentTurnInput,
		context: AgentExecutionContext,
		state: PiTurnState,
		terminal: TerminalSettlement,
	): void {
		switch (event.type) {
			case "text_delta":
				state.textDeltas.push(event.text);
				this.emitContextEvent(context, "model_response", {
					text: event.text,
					final: false,
				});
				this.report(input, context, {
					phase: "model_response",
					depth: this.depth(input),
					message: event.text,
				});
				break;
			case "text_final":
				state.finalText = event.text;
				this.emitContextEvent(context, "model_response", {
					text: event.text,
					final: true,
				});
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
				this.emitContextEvent(context, "tool_result", {
					runId: trace.runId,
					step: trace.step,
					tool: trace.tool,
					scope: trace.scope,
					targetPath: trace.targetPath,
					status: trace.status,
					ok: trace.ok,
					summary: trace.summary,
					error: trace.error,
					failureClass: trace.failureClass,
				});
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
			case "host_result":
				state.hostResult = event.result;
				state.doneReported = true;
				this.reportHostResult(input, context, event);
				terminal.settle();
				break;
			case "error":
				state.error = state.error ?? this.toError(event);
				this.reportError(input, context, state.error);
				terminal.settle(state.error);
				break;
			case "done":
			case "session_end":
				state.doneReported = true;
				this.reportDone(input, context, this.sessionEndSummary(event));
				terminal.settle();
				break;
		}
	}

	private hostResult(input: AgentTurnInput, context: AgentExecutionContext, result: AgentTurnResult): AgentTurnResult {
		const assistantText = result.assistantText ?? "";
		return {
			...result,
			turnId: result.turnId || context.turnId,
			taskId: result.taskId ?? result.task?.id ?? context.taskId,
			traceId: result.traceId ?? context.traceId,
			conversationId: result.conversationId || input.conversationId,
			status: result.status ?? "completed",
			assistantText,
			events: this.mergeEvents(result.events ?? [], context.snapshotEvents()),
			traces: result.traces ?? [],
			rawFinalReply: result.rawFinalReply ?? assistantText,
			budget: result.budget ?? context.budget,
		};
	}

	private reportHostResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		event: FridayPiHostResultEvent,
	): void {
		const status = event.result.status ?? "completed";
		const failed = status === "failed" || status === "cancelled";
		const summary = event.summary ?? (failed ? "PI host bridge failed." : "PI host bridge completed.");
		this.emitContextEvent(context, "model_response", {
			source: "pi_host_bridge",
			terminal: true,
			status,
			summary,
			taskId: event.result.taskId ?? event.result.task?.id,
			traceId: event.result.traceId,
		});
		this.report(input, context, {
			phase: failed ? "error" : "done",
			depth: this.depth(input),
			...(status === "completed" ? { status: "ok" as const } : failed ? { status: "failed" as const } : {}),
			message: summary,
		});
	}

	private reportToolCall(input: AgentTurnInput, context: AgentExecutionContext, event: FridayPiToolCallEvent): void {
		this.emitContextEvent(context, "tool_call", {
			runId: event.runId,
			step: event.step,
			tool: event.tool,
			scope: event.scope,
			targetPath: event.targetPath,
			summary: event.summary,
		});
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
		const failure = this.failureClassifier.classify(error, {
			status: context.isCancelled() ? "cancelled" : "failed",
		});
		this.emitContextEvent(context, "model_response", {
			source: "pi",
			terminal: true,
			status: context.isCancelled() ? "cancelled" : "failed",
			message: this.stringifyError(error) || "PI runtime failed.",
			failureCategory: failure.category,
		});
		this.report(input, context, {
			phase: "error",
			depth: this.depth(input),
			status: "failed",
			message: this.stringifyError(error) || "PI runtime failed.",
		});
	}

	private reportDone(input: AgentTurnInput, context: AgentExecutionContext, message: string): void {
		this.emitContextEvent(context, "model_response", {
			source: "pi",
			terminal: true,
			summary: message,
		});
		this.report(input, context, {
			phase: "done",
			depth: this.depth(input),
			status: "ok",
			message,
		});
	}

	private emitContextEvent(
		context: AgentExecutionContext,
		type: AgentTurnEvent["type"],
		payload: Record<string, unknown>,
		status?: AgentTurnStatus,
		failure?: AgentFailure,
	): void {
		context.emit({
			type,
			...(status ? { status } : {}),
			payload: this.sanitizePayload(payload),
			...(failure ? { failure } : {}),
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

	private createTerminalSettlement(context: AgentExecutionContext): TerminalSettlement {
		let settled = false;
		let settledError: unknown | undefined;
		let resolvePromise: (error?: unknown) => void = () => {};
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const promise = new Promise<unknown | undefined>((resolve) => {
			resolvePromise = resolve;
		});
		const settle = (error?: unknown): void => {
			if (settled) {
				return;
			}
			settled = true;
			settledError = error;
			if (timeout) {
				clearTimeout(timeout);
			}
			context.signal.removeEventListener("abort", onAbort);
			resolvePromise(error);
		};
		const onAbort = (): void => {
			settle(context.getCancelReason() ?? context.signal.reason ?? "PI runtime turn cancelled.");
		};
		const timeoutMs = this.resolveTerminalEventTimeoutMs();
		if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
			timeout = setTimeout(() => {
				settle(new Error(`PI runtime timed out waiting for a terminal event after ${timeoutMs}ms.`));
			}, timeoutMs);
		}
		if (context.signal.aborted) {
			onAbort();
		} else {
			context.signal.addEventListener("abort", onAbort, { once: true });
		}
		return {
			promise,
			settle,
			get settled() {
				return settled;
			},
			get error() {
				return settledError;
			},
			dispose() {
				if (timeout) {
					clearTimeout(timeout);
				}
				context.signal.removeEventListener("abort", onAbort);
			},
		};
	}

	private resolveTerminalEventTimeoutMs(): number {
		return this.options.terminalEventTimeoutMs ?? DEFAULT_TERMINAL_EVENT_TIMEOUT_MS;
	}

	private resolveCancelledPromptGraceMs(): number {
		return this.options.cancelledPromptGraceMs ?? DEFAULT_CANCELLED_PROMPT_GRACE_MS;
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

	private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (value === undefined) {
				continue;
			}
			if (typeof value === "string") {
				sanitized[key] = value.slice(0, 2_000);
				continue;
			}
			if (typeof value === "number" || typeof value === "boolean" || value === null) {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	private mergeEvents(first: AgentTurnEvent[], second: AgentTurnEvent[]): AgentTurnEvent[] {
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

	private sessionEndSummary(event: FridayPiDoneEvent | FridayPiSessionEndEvent): string {
		return event.summary ?? "PI session finished.";
	}

	private depth(input: AgentTurnInput): number {
		return input.depth ?? 0;
	}
}
