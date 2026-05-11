export type ToolFailureClass =
	| "invalid_input"
	| "dependency_unavailable"
	| "transport_unstable"
	| "tool_runtime_error";

const FALLBACK_PATTERNS: RegExp[] = [
	/400/i,
	/404/i,
	/405/i,
	/tool/i,
	/function/i,
	/responses/i,
	/unsupported/i,
	/invalid json/i,
	/no usable message content/i,
	/tool_calls/i,
];

const TRANSPORT_PATTERNS: RegExp[] = [
	/429/i,
	/500/i,
	/502/i,
	/503/i,
	/504/i,
	/timeout/i,
	/timed out/i,
	/gateway/i,
	/econnreset/i,
	/err_connection_reset/i,
	/econnclosed/i,
	/err_connection_closed/i,
	/fetch failed/i,
	/network/i,
	/socket hang up/i,
	/connection closed/i,
];

const INVALID_INPUT_PATTERNS: RegExp[] = [
	/missing required/i,
	/invalid argument/i,
	/invalid input/i,
	/unsupported tool/i,
	/does not exist/i,
];

const DEPENDENCY_PATTERNS: RegExp[] = [
	/no permission/i,
	/denied/i,
	/not found/i,
	/dependency/i,
	/unavailable/i,
];

export class ToolGovernor {
	shouldFallbackToPrompt(rawMessage: string): boolean {
		const message = rawMessage.trim();
		if (!message) {
			return false;
		}
		return FALLBACK_PATTERNS.some((pattern) => pattern.test(message));
	}

	isRetryableTransportFailure(rawMessage: string): boolean {
		const message = rawMessage.trim();
		if (!message) {
			return false;
		}
		return TRANSPORT_PATTERNS.some((pattern) => pattern.test(message));
	}

	classifyFailure(rawMessage: string): ToolFailureClass {
		const message = rawMessage.trim();
		if (!message) {
			return "tool_runtime_error";
		}
		if (INVALID_INPUT_PATTERNS.some((pattern) => pattern.test(message))) {
			return "invalid_input";
		}
		if (DEPENDENCY_PATTERNS.some((pattern) => pattern.test(message))) {
			return "dependency_unavailable";
		}
		if (this.isRetryableTransportFailure(message)) {
			return "transport_unstable";
		}
		return "tool_runtime_error";
	}

	createRunId(tool: string, step: number): string {
		const safeTool = tool.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
		const rand = Math.random().toString(16).slice(2, 8);
		return `run-${Date.now()}-${step}-${safeTool || "tool"}-${rand}`;
	}
}
