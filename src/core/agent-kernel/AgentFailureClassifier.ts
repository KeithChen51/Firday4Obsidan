import type { AgentFailure, AgentFailureCategory, AgentTurnResult } from "./contracts";

export class AgentFailureClassifier {
	classify(error: unknown, partial: Partial<AgentTurnResult> = {}): AgentFailure {
		const message = collectFailureText(error, partial);
		const category = classifyCategory(message, error, partial);
		return {
			category,
			code: category,
			retryable: isRetryable(category),
			userMessage: buildUserMessage(category, message),
			technicalMessage: message || undefined,
			...(error !== undefined ? { cause: error } : {}),
		};
	}
}

function classifyCategory(
	message: string,
	error: unknown,
	partial: Partial<AgentTurnResult>,
): AgentFailureCategory {
	const normalized = message.toLowerCase();
	const errorName = getErrorName(error).toLowerCase();
	if (partial.status === "cancelled" || errorName === "aborterror" || /\b(abort|aborted|cancelled|canceled|取消)\b/i.test(message)) {
		return "cancelled";
	}
	if (partial.pendingMutations?.some((plan) => plan.status === "conflicted")) {
		return "mutation_conflict";
	}
	if (/\b(maximum tool-?iteration|max tool iterations|max iterations|iteration limit)\b/i.test(message)) {
		return "max_iterations";
	}
	if (/(gateway timeout|504|timeout|econnreset|retryable|temporarily unavailable|暂时不可用|网关)/i.test(message)) {
		return "model_transport";
	}
	if (/(parse|schema|protocol|invalid json|malformed|format)/i.test(message)) {
		return "model_protocol";
	}
	if (/(context overflow|context length|token limit|payload too large)/i.test(message)) {
		return "context_overflow";
	}
	if (/(approval denied|approval rejected|user denied)/i.test(message)) {
		return "approval_denied";
	}
	if (/(tool denied|permission denied|not allowed|disallowed|policy denied|blocked)/i.test(message)) {
		return "tool_denied";
	}
	if (partial.traces?.some((trace) => trace.status === "denied")) {
		return "tool_denied";
	}
	if (partial.traces?.some((trace) => trace.status === "failed")) {
		return "tool_failed";
	}
	if (/(mutation failed|apply failed|write failed|edit failed|delete failed)/i.test(message)) {
		return "mutation_failed";
	}
	return normalized ? "unknown" : "unknown";
}

function collectFailureText(error: unknown, partial: Partial<AgentTurnResult>): string {
	const parts = [
		stringifyError(error),
		partial.failure?.technicalMessage,
		partial.failure?.userMessage,
		partial.parseError,
		partial.assistantText,
	].filter((part): part is string => Boolean(part?.trim()));
	return parts.join("\n");
}

function stringifyError(error: unknown): string {
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

function getErrorName(error: unknown): string {
	if (error instanceof Error) {
		return error.name;
	}
	if (error && typeof error === "object" && "name" in error) {
		const name = (error as { name?: unknown }).name;
		return typeof name === "string" ? name : "";
	}
	return "";
}

function isRetryable(category: AgentFailureCategory): boolean {
	return category === "model_transport";
}

function buildUserMessage(category: AgentFailureCategory, message: string): string {
	if (category === "cancelled") {
		return "已停止本次任务。";
	}
	if (message.trim()) {
		return message.trim();
	}
	return "Agent turn failed.";
}
