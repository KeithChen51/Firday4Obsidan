import type { AgentExecutionContext } from "../AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, RuntimeToolTrace } from "../contracts";

export type FridayPiSessionUnsubscribe = () => void;

export type FridayPiSessionListener = (event: FridayPiSessionEvent) => void;

export interface FridayPiPromptOptions {
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
}

export interface FridayPiSessionPort {
	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe;
	/** Resolves when the prompt is accepted; streaming may continue until a terminal session event. */
	prompt(text: string, options?: FridayPiPromptOptions): Promise<void>;
	steer?(text: string, options?: FridayPiPromptOptions): Promise<void>;
	followUp?(text: string, options?: FridayPiPromptOptions): Promise<void>;
	dispose?(): void | Promise<void>;
}

export interface FridayPiSessionHostPort {
	createSession(input: AgentTurnInput, context: AgentExecutionContext): FridayPiSessionPort | Promise<FridayPiSessionPort>;
}

export interface FridayPiRuntimeOptions {
	terminalEventTimeoutMs?: number;
	cancelledPromptGraceMs?: number;
}

export type FridayPiSessionEvent =
	| FridayPiTextDeltaEvent
	| FridayPiTextFinalEvent
	| FridayPiToolCallEvent
	| FridayPiToolResultEvent
	| FridayPiHostResultEvent
	| FridayPiErrorEvent
	| FridayPiDoneEvent
	| FridayPiSessionEndEvent;

export interface FridayPiTextDeltaEvent {
	type: "text_delta";
	text: string;
}

export interface FridayPiTextFinalEvent {
	type: "text_final";
	text: string;
}

export interface FridayPiToolCallEvent {
	type: "tool_call";
	runId?: string;
	step?: number;
	tool: string;
	scope?: RuntimeToolTrace["scope"];
	targetPath?: string;
	summary?: string;
}

export interface FridayPiToolResultEvent {
	type: "tool_result";
	runId?: string;
	step?: number;
	tool: string;
	scope?: RuntimeToolTrace["scope"];
	targetPath?: string;
	approved?: boolean;
	approvalReason?: string;
	persistedRule?: boolean;
	viaRule?: boolean;
	status?: RuntimeToolTrace["status"];
	ok?: boolean;
	summary?: string;
	error?: string;
	failureClass?: RuntimeToolTrace["failureClass"];
}

export interface FridayPiHostResultEvent {
	type: "host_result";
	result: AgentTurnResult;
	summary?: string;
}

export interface FridayPiErrorEvent {
	type: "error";
	message?: string;
	error?: unknown;
	summary?: string;
}

export interface FridayPiDoneEvent {
	type: "done";
	summary?: string;
}

export interface FridayPiSessionEndEvent {
	type: "session_end";
	summary?: string;
}
