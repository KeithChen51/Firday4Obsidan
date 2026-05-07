export type ToolResultStatus = "ok" | "failed" | "denied";

export type ToolResultFailureClass =
	| "invalid_input"
	| "dependency_unavailable"
	| "transport_unstable"
	| "tool_runtime_error"
	| "cancelled";

export interface ToolResultRecovery {
	recoverable: boolean;
	retryable: boolean;
	code?: string;
	message?: string;
	suggestedArgs?: Record<string, unknown>;
	candidatePaths?: string[];
}

export interface ToolResultTraceMetadata {
	inputPath?: string;
	targetPath?: string;
	resolvedPath?: string;
	displayPath?: string;
	projectRoot?: string;
}

export interface ToolResultPayload {
	ok: boolean;
	tool: string;
	data?: unknown;
	error?: string;
	status?: ToolResultStatus;
	failureClass?: ToolResultFailureClass;
	recovery?: ToolResultRecovery;
	trace?: ToolResultTraceMetadata;
}

export interface ToolResultFormatOptions {
	maxChars?: number;
}
