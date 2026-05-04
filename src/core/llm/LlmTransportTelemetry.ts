import { extractHttpStatus } from "./LlmTransportPolicy";

export type LlmTransportEventType =
	| "request_started"
	| "retry_scheduled"
	| "retry_started"
	| "request_succeeded"
	| "request_failed"
	| "request_exhausted";

export type LlmTransportChannel = "chat" | "chat_stream" | "chat_with_tools" | "connection_check";

export interface LlmTransportEvent {
	type: LlmTransportEventType;
	requestId: string;
	channel: LlmTransportChannel;
	endpointIndex: number;
	endpointCount: number;
	attempt: number;
	maxAttempts: number;
	delayMs?: number;
	httpStatus?: number;
	retryable: boolean;
	message: string;
}

export interface LlmTransportObserver {
	onTransportEvent?: (event: LlmTransportEvent) => void;
}

export interface LlmTransportEventInput {
	type: LlmTransportEventType;
	requestId: string;
	channel: LlmTransportChannel;
	endpointIndex: number;
	endpointCount: number;
	attempt: number;
	maxAttempts: number;
	delayMs?: number;
	httpStatus?: number;
	retryable: boolean;
	message?: string;
	error?: unknown;
}

let requestCounter = 0;

export function createLlmTransportRequestId(prefix = "llm"): string {
	requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
	const safePrefix = prefix.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "llm";
	return `${safePrefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

export function summarizeTransportError(error: unknown): { httpStatus?: number; message: string } {
	const httpStatus = extractHttpStatus(error);
	const rawMessage = error instanceof Error
		? error.message
		: typeof error === "string"
			? error
			: String(error ?? "Unknown transport error");
	const message = sanitizeTransportMessage(rawMessage || "Unknown transport error");
	return {
		...(httpStatus != null ? { httpStatus } : {}),
		message,
	};
}

export function createLlmTransportEvent(input: LlmTransportEventInput): LlmTransportEvent {
	const summary = input.error !== undefined
		? summarizeTransportError(input.error)
		: { message: sanitizeTransportMessage(input.message ?? "") };
	const httpStatus = input.httpStatus ?? summary.httpStatus;
	return {
		type: input.type,
		requestId: input.requestId,
		channel: input.channel,
		endpointIndex: input.endpointIndex,
		endpointCount: input.endpointCount,
		attempt: input.attempt,
		maxAttempts: input.maxAttempts,
		...(input.delayMs !== undefined ? { delayMs: input.delayMs } : {}),
		...(httpStatus !== undefined ? { httpStatus } : {}),
		retryable: input.type === "request_exhausted" ? false : input.retryable,
		message: summary.message || defaultTransportMessage(input.type),
	};
}

function sanitizeTransportMessage(value: string): string {
	const sanitized = value
		.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "[endpoint]")
		.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g, "[endpoint]")
		.replace(/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted]")
		.replace(/Authorization\s*:\s*[^\s,;]+/gi, "[redacted]")
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\b[A-Za-z0-9_]*(?:secret|token|password|apikey|api_key)[A-Za-z0-9_-]*\s*=\s*\S+/gi, "[redacted]")
		.trim();
	return truncateTransportMessage(sanitized || "Transport event");
}

function truncateTransportMessage(value: string, maxLength = 220): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength)}...`;
}

function defaultTransportMessage(type: LlmTransportEventType): string {
	switch (type) {
		case "request_started":
			return "Model request started";
		case "retry_scheduled":
			return "Model request retry scheduled";
		case "retry_started":
			return "Model request retry started";
		case "request_succeeded":
			return "Model request succeeded";
		case "request_failed":
			return "Model request failed";
		case "request_exhausted":
			return "Model request exhausted";
		default:
			return "Model transport event";
	}
}
