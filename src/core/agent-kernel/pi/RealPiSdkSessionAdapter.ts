import { Agent as BundledPiAgent } from "@earendil-works/pi-agent-core";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { AgentExecutionContext } from "../AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, RuntimeToolTrace } from "../contracts";
import type {
	FridayPiPromptOptions,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionListener,
	FridayPiSessionPort,
	FridayPiSessionUnsubscribe,
} from "./FridayPiRuntimePorts";

type UnknownRecord = Record<string, unknown>;
type RealPiSdkResolvedAgentOptions = AgentOptions | UnknownRecord;
export type RealPiSdkAgentOptionsProvider =
	| RealPiSdkResolvedAgentOptions
	| ((
		input: AgentTurnInput,
		context: AgentExecutionContext,
	) => RealPiSdkResolvedAgentOptions | Promise<RealPiSdkResolvedAgentOptions>);

export type RealPiSdkEventListener = (event: UnknownRecord, signal?: AbortSignal) => void | Promise<void>;

export interface RealPiSdkAgentLike {
	subscribe(listener: RealPiSdkEventListener): (() => void) | void;
	prompt(input: string, options?: UnknownRecord): Promise<unknown> | unknown;
	steer?(input: unknown, options?: UnknownRecord): Promise<unknown> | unknown;
	followUp?(input: unknown, options?: UnknownRecord): Promise<unknown> | unknown;
	abort?(reason?: unknown): Promise<unknown> | unknown;
}

export type RealPiSdkCreateAgent = (
	input: AgentTurnInput,
	context: AgentExecutionContext,
) => RealPiSdkAgentLike | Promise<RealPiSdkAgentLike>;

export interface RealPiSdkAgentConstructor {
	new (options?: RealPiSdkResolvedAgentOptions): RealPiSdkAgentLike;
}

export interface RealPiSdkAgentModule {
	Agent?: RealPiSdkAgentConstructor;
	default?: RealPiSdkAgentConstructor | { Agent?: RealPiSdkAgentConstructor };
}

export interface RealPiSdkAgentFactoryOptions {
	moduleSpecifier?: string;
	agentOptions?: RealPiSdkAgentOptionsProvider;
	importModule?: (specifier: string) => Promise<RealPiSdkAgentModule>;
}

export interface RealPiSdkSessionHostAdapterOptions {
	createAgent?: RealPiSdkCreateAgent;
	moduleSpecifier?: string;
	agentOptions?: RealPiSdkAgentOptionsProvider;
	importModule?: (specifier: string) => Promise<RealPiSdkAgentModule>;
}

interface ActiveToolCall {
	runId: string;
	step: number;
	tool: string;
	targetPath: string;
	summary?: string;
}

export class RealPiSdkSessionHostAdapter implements FridayPiSessionHostPort {
	private readonly createAgent: RealPiSdkCreateAgent;

	constructor(options: RealPiSdkSessionHostAdapterOptions = {}) {
		this.createAgent =
			options.createAgent ??
			createRealPiSdkAgentFactory({
				moduleSpecifier: options.moduleSpecifier,
				agentOptions: options.agentOptions,
				importModule: options.importModule,
			});
	}

	async createSession(input: AgentTurnInput, context: AgentExecutionContext): Promise<FridayPiSessionPort> {
		const agent = await this.createAgent(input, context);
		return new RealPiSdkSessionAdapter(agent, input, context);
	}
}

export class RealPiSdkSessionAdapter implements FridayPiSessionPort {
	private readonly listeners = new Set<FridayPiSessionListener>();
	private readonly activeToolCalls = new Map<string, ActiveToolCall>();
	private readonly completedTraces: RuntimeToolTrace[] = [];
	private unsubscribeFromAgent?: () => void;
	private disposed = false;
	private lastAssistantText = "";
	private completed = false;
	private promptInFlight = false;
	private latestTurnResult?: AgentTurnResult;
	private latestTurnSummary?: string;
	private stepCounter = 0;

	constructor(
		private readonly agent: RealPiSdkAgentLike,
		private readonly input: AgentTurnInput,
		private readonly context: AgentExecutionContext,
	) {
		const unsubscribe = this.agent.subscribe((event) => {
			this.handlePiEvent(event);
		});
		if (typeof unsubscribe === "function") {
			this.unsubscribeFromAgent = unsubscribe;
		}
	}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string, options: FridayPiPromptOptions = {}): Promise<void> {
		this.assertActive();
		this.promptInFlight = true;
		try {
			await this.callWithAbort(() => this.agent.prompt(text), options.signal);
		} finally {
			this.promptInFlight = false;
		}
	}

	async steer(text: string, options: FridayPiPromptOptions = {}): Promise<void> {
		this.assertActive();
		if (!this.agent.steer) {
			throw new Error("The loaded PI Agent does not expose steer().");
		}
		await this.callWithAbort(() => this.agent.steer?.(this.toUserMessage(text), options.metadata), options.signal);
	}

	async followUp(text: string, options: FridayPiPromptOptions = {}): Promise<void> {
		this.assertActive();
		if (!this.agent.followUp) {
			throw new Error("The loaded PI Agent does not expose followUp().");
		}
		await this.callWithAbort(() => this.agent.followUp?.(this.toUserMessage(text), options.metadata), options.signal);
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.listeners.clear();
		this.unsubscribeFromAgent?.();
		if (this.promptInFlight && !this.completed) {
			this.requestAbort("FRIDAY disposed the PI session.");
		}
	}

	private async callWithAbort(action: () => Promise<unknown> | unknown, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) {
			this.requestAbort(signal.reason);
			return;
		}
		const onAbort = (): void => {
			this.requestAbort(signal?.reason);
		};
		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		try {
			await action();
		} finally {
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	}

	private handlePiEvent(event: UnknownRecord): void {
		switch (event.type) {
			case "message_update":
				this.handleMessageUpdate(event);
				break;
			case "message_end":
				this.handleMessageEnd(event);
				break;
			case "tool_execution_start":
				this.handleToolExecutionStart(event);
				break;
			case "tool_execution_end":
				this.handleToolExecutionEnd(event);
				break;
			case "turn_end":
				this.handleTurnEnd(event);
				break;
			case "agent_end":
				this.handleAgentEnd(event);
				break;
			case "turn_error":
			case "agent_error":
			case "error":
				this.emit({
					type: "error",
					error: this.pick(event, "error"),
					message: this.firstString(this.pick(event, "message"), this.pick(event, "summary")),
				});
				break;
		}
	}

	private handleMessageUpdate(event: UnknownRecord): void {
		const text = this.extractMessageText(this.pickRecord(event, "message"));
		if (!text) {
			return;
		}
		const delta = this.toAssistantDelta(text);
		if (delta) {
			this.emit({ type: "text_delta", text: delta });
		}
	}

	private handleMessageEnd(event: UnknownRecord): void {
		const text = this.extractMessageText(this.pickRecord(event, "message"));
		if (text) {
			this.lastAssistantText = text;
			this.emit({ type: "text_final", text });
		}
	}

	private handleToolExecutionStart(event: UnknownRecord): void {
		const runId = this.resolveToolRunId(event);
		const tool = this.stringValue(this.pick(event, "toolName")) ?? this.stringValue(this.pick(event, "tool")) ?? "unknown_tool";
		const args = this.pickRecord(event, "args");
		const targetPath = this.extractTargetPath(args, event);
		const activeCall: ActiveToolCall = {
			runId,
			step: this.nextStep(),
			tool,
			targetPath,
			summary: `Calling ${tool}.`,
		};
		this.activeToolCalls.set(runId, activeCall);
		this.emit({
			type: "tool_call",
			runId,
			step: activeCall.step,
			tool,
			targetPath,
			summary: activeCall.summary,
		});
	}

	private handleToolExecutionEnd(event: UnknownRecord): void {
		const runId = this.resolveToolRunId(event, { matchActiveCall: true });
		const existing = this.activeToolCalls.get(runId);
		const tool =
			this.stringValue(this.pick(event, "toolName")) ??
			this.stringValue(this.pick(event, "tool")) ??
			existing?.tool ??
			"unknown_tool";
		const result = this.pickRecord(event, "result");
		const isError = Boolean(this.pick(event, "isError"));
		const error = this.firstString(this.pick(event, "error"), this.pick(result, "error"), this.pick(result, "message"));
		const status = isError || error ? "failed" : "ok";
		const summary = isError || error ? error ?? `${tool} failed.` : this.extractToolSummary(result) ?? `${tool} completed.`;
		const targetPath = this.extractTargetPath(this.pickRecord(event, "args"), result, event) || existing?.targetPath || "";
		this.activeToolCalls.delete(runId);
		const step = existing?.step ?? this.nextStep();
		const trace: RuntimeToolTrace = {
			runId,
			step,
			tool,
			scope: "vault",
			targetPath,
			approved: false,
			approvalReason: "",
			persistedRule: false,
			viaRule: false,
			status,
			ok: status === "ok",
			summary,
			...(status === "failed" && summary ? { error: summary } : {}),
		};
		this.completedTraces.push(trace);
		this.emit({
			type: "tool_result",
			runId,
			step,
			tool,
			targetPath,
			status,
			ok: status === "ok",
			summary,
			...(status === "failed" && summary ? { error: summary } : {}),
		});
	}

	private handleTurnEnd(event: UnknownRecord): void {
		const message = this.pickRecord(event, "message");
		const assistantText = this.extractMessageText(message) || this.lastAssistantText;
		this.lastAssistantText = assistantText;
		const failureMessage = this.firstString(this.pick(event, "errorMessage"), this.pick(message, "errorMessage"));
		const stopReason = this.stringValue(this.pick(message, "stopReason")) ?? this.stringValue(this.pick(event, "stopReason"));
		const status = failureMessage || stopReason === "error" || stopReason === "aborted" ? "failed" : "completed";
		this.latestTurnResult = {
			turnId: this.context.turnId,
			taskId: this.context.taskId,
			traceId: this.context.traceId,
			conversationId: this.input.conversationId,
			status,
			assistantText: assistantText || failureMessage || "",
			events: this.context.snapshotEvents(),
			traces: this.completedTraces.map((trace) => ({ ...trace })),
			rawFinalReply: assistantText || failureMessage || "",
			budget: this.context.budget,
			...(failureMessage ? { raw: { errorMessage: failureMessage } } : {}),
		};
		this.latestTurnSummary = status === "completed" ? "PI Agent turn completed." : failureMessage ?? "PI Agent turn failed.";
	}

	private handleAgentEnd(event: UnknownRecord): void {
		if (this.completed) {
			return;
		}
		this.completed = true;
		const assistantText = this.extractLastAssistantText(event) || this.latestTurnResult?.assistantText || this.lastAssistantText;
		if (assistantText && assistantText !== this.lastAssistantText) {
			this.lastAssistantText = assistantText;
			this.emit({ type: "text_final", text: assistantText });
		}
		const result = this.buildAgentEndResult(assistantText);
		this.emit({
			type: "host_result",
			result,
			summary: this.latestTurnSummary ?? "PI Agent session ended.",
		});
	}

	private emit(event: FridayPiSessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}

	private requestAbort(reason?: unknown): void {
		if (!this.agent.abort) {
			return;
		}
		try {
			void Promise.resolve(this.agent.abort(reason)).catch((error) => {
				this.emit({
					type: "error",
					error,
					message: this.stringifyError(error) || "PI Agent abort failed.",
				});
			});
		} catch (error) {
			this.emit({
				type: "error",
				error,
				message: this.stringifyError(error) || "PI Agent abort failed.",
			});
		}
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error("PI SDK session has already been disposed.");
		}
	}

	private nextStep(): number {
		this.stepCounter += 1;
		return this.stepCounter;
	}

	private nextRunId(): string {
		return `${this.context.turnId}:pi-tool:${this.stepCounter + 1}`;
	}

	private resolveToolRunId(event: UnknownRecord, options: { matchActiveCall?: boolean } = {}): string {
		const explicitRunId = this.stringValue(this.pick(event, "toolCallId")) ?? this.stringValue(this.pick(event, "id"));
		if (explicitRunId) {
			return explicitRunId;
		}
		if (options.matchActiveCall && this.activeToolCalls.size === 1) {
			const activeRunId = this.activeToolCalls.keys().next().value;
			if (activeRunId) {
				return activeRunId;
			}
		}
		return this.nextRunId();
	}

	private buildAgentEndResult(assistantText: string): AgentTurnResult {
		const base = this.latestTurnResult;
		return {
			turnId: this.context.turnId,
			taskId: this.context.taskId,
			traceId: this.context.traceId,
			conversationId: this.input.conversationId,
			status: base?.status ?? "completed",
			assistantText,
			events: this.context.snapshotEvents(),
			traces: this.completedTraces.map((trace) => ({ ...trace })),
			rawFinalReply: assistantText,
			budget: this.context.budget,
			...(base?.failure ? { failure: base.failure } : {}),
			...(base?.raw ? { raw: base.raw } : {}),
			...(base?.parseError ? { parseError: base.parseError } : {}),
		};
	}

	private toAssistantDelta(nextText: string): string {
		if (!this.lastAssistantText) {
			this.lastAssistantText = nextText;
			return nextText;
		}
		if (nextText.startsWith(this.lastAssistantText)) {
			const delta = nextText.slice(this.lastAssistantText.length);
			this.lastAssistantText = nextText;
			return delta;
		}
		this.lastAssistantText = nextText;
		return nextText;
	}

	private extractLastAssistantText(event: UnknownRecord): string {
		const messages = this.pick(event, "messages");
		if (!Array.isArray(messages)) {
			return "";
		}
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = this.asRecord(messages[index]);
			if (this.stringValue(this.pick(message, "role")) !== "assistant") {
				continue;
			}
			const text = this.extractMessageText(message);
			if (text) {
				return text;
			}
		}
		return "";
	}

	private extractMessageText(message: UnknownRecord | undefined): string {
		if (!message) {
			return "";
		}
		const content = this.pick(message, "content");
		if (typeof content === "string") {
			return content;
		}
		if (!Array.isArray(content)) {
			return "";
		}
		return content.map((part) => this.extractTextPart(this.asRecord(part))).filter(Boolean).join("");
	}

	private extractTextPart(part: UnknownRecord | undefined): string {
		if (!part) {
			return "";
		}
		const text = this.pick(part, "text");
		if (typeof text === "string") {
			return text;
		}
		const content = this.pick(part, "content");
		return typeof content === "string" ? content : "";
	}

	private extractToolSummary(result: UnknownRecord | undefined): string | undefined {
		if (!result) {
			return undefined;
		}
		return (
			this.firstString(this.pick(result, "summary"), this.pick(this.pickRecord(result, "details"), "summary")) ??
			this.extractContentText(result)
		);
	}

	private extractContentText(record: UnknownRecord): string | undefined {
		const content = this.pick(record, "content");
		if (typeof content === "string") {
			return content;
		}
		if (!Array.isArray(content)) {
			return undefined;
		}
		const text = content.map((part) => this.extractTextPart(this.asRecord(part))).filter(Boolean).join("");
		return text || undefined;
	}

	private extractTargetPath(...records: Array<UnknownRecord | undefined>): string {
		for (const record of records) {
			if (!record) {
				continue;
			}
			const direct = this.firstString(this.pick(record, "path"), this.pick(record, "targetPath"));
			if (direct) {
				return direct;
			}
			const nested = this.pickRecord(record, "details");
			const fromDetails = this.firstString(this.pick(nested, "path"), this.pick(nested, "targetPath"));
			if (fromDetails) {
				return fromDetails;
			}
		}
		return "";
	}

	private toUserMessage(text: string): UnknownRecord {
		return {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};
	}

	private firstString(...values: unknown[]): string | undefined {
		for (const value of values) {
			const text = this.stringValue(value);
			if (text) {
				return text;
			}
		}
		return undefined;
	}

	private stringValue(value: unknown): string | undefined {
		return typeof value === "string" && value.trim() ? value : undefined;
	}

	private pick(record: UnknownRecord | undefined, key: string): unknown {
		return record?.[key];
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

	private pickRecord(record: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
		return this.asRecord(this.pick(record, key));
	}

	private asRecord(value: unknown): UnknownRecord | undefined {
		return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
	}
}

export function createRealPiSdkAgentFactory(options: RealPiSdkAgentFactoryOptions = {}): RealPiSdkCreateAgent {
	if (!options.importModule && !options.moduleSpecifier) {
		const Agent = BundledPiAgent as unknown as RealPiSdkAgentConstructor;
		return async (input, context) => {
			const agentOptions = await resolveRealPiSdkAgentOptions(options.agentOptions, input, context);
			return new Agent(agentOptions);
		};
	}
	const moduleSpecifier = options.moduleSpecifier ?? "@earendil-works/pi-agent-core";
	return async (input, context) => {
		const module = await (options.importModule ?? importPiSdkModule)(moduleSpecifier);
		const Agent = resolveAgentConstructor(module);
		if (!Agent) {
			throw new Error(`PI SDK module "${moduleSpecifier}" does not export Agent.`);
		}
		const agentOptions = await resolveRealPiSdkAgentOptions(options.agentOptions, input, context);
		return new Agent(agentOptions);
	};
}

export async function resolveRealPiSdkAgentOptions(
	agentOptions: RealPiSdkAgentOptionsProvider | undefined,
	input: AgentTurnInput,
	context: AgentExecutionContext,
): Promise<RealPiSdkResolvedAgentOptions | undefined> {
	if (typeof agentOptions === "function") {
		return agentOptions(input, context);
	}
	return agentOptions;
}

async function importPiSdkModule(moduleSpecifier: string): Promise<RealPiSdkAgentModule> {
	return import(moduleSpecifier) as Promise<RealPiSdkAgentModule>;
}

function resolveAgentConstructor(module: RealPiSdkAgentModule): RealPiSdkAgentConstructor | undefined {
	if (module.Agent) {
		return module.Agent;
	}
	if (typeof module.default === "function") {
		return module.default;
	}
	if (module.default && typeof module.default === "object") {
		return module.default.Agent;
	}
	return undefined;
}
