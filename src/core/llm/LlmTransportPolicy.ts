const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_PATTERNS: RegExp[] = [
	/timeout/i,
	/timed out/i,
	/err_connection_reset/i,
	/econnreset/i,
	/socket hang up/i,
	/fetch failed/i,
	/network error/i,
	/gateway/i,
	/service unavailable/i,
	/temporarily unavailable/i,
	/connection reset/i,
];

function hasHeader(headers: Record<string, string>, expectedName: string): boolean {
	const target = expectedName.trim().toLowerCase();
	return Object.keys(headers).some((name) => name.trim().toLowerCase() === target);
}

export function buildLlmHeaders(
	apiKey: string,
	extraHeaders: Record<string, string> | null | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	for (const [key, value] of Object.entries(extraHeaders ?? {})) {
		const headerName = key.trim();
		const headerValue = value.trim();
		if (!headerName || !headerValue) {
			continue;
		}
		headers[headerName] = headerValue;
	}

	const normalizedApiKey = apiKey.trim();
	if (normalizedApiKey && !hasHeader(headers, "Authorization")) {
		headers.Authorization = `Bearer ${normalizedApiKey}`;
	}
	return headers;
}

export function extractHttpStatus(error: unknown): number | null {
	const raw = String(error ?? "").toLowerCase();
	const matched = raw.match(/\b(400|401|403|404|405|408|409|422|429|500|502|503|504)\b/);
	return matched ? Number.parseInt(matched[1]!, 10) : null;
}

export function shouldRetryLlmRequest(error: unknown, attempt: number, maxRetries: number): boolean {
	if (attempt >= maxRetries) {
		return false;
	}
	const status = extractHttpStatus(error);
	if (status != null) {
		return RETRYABLE_STATUS.has(status);
	}
	const raw = String(error ?? "");
	return RETRYABLE_PATTERNS.some((pattern) => pattern.test(raw));
}

export function getLlmRetryDelayMs(attempt: number): number {
	const safeAttempt = Math.max(0, attempt);
	return Math.min(4_000, 700 * 2 ** safeAttempt);
}
