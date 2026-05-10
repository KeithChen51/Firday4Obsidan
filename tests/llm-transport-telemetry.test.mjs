/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const telemetryPath = path.join(projectRoot, "src/core/llm/LlmTransportTelemetry.ts");

async function loadTelemetry() {
	return jiti.import(telemetryPath);
}

test("transport telemetry request events do not expose raw endpoint URLs or secrets", async () => {
	const { createLlmTransportEvent } = await loadTelemetry();
	const event = createLlmTransportEvent({
		type: "request_started",
		requestId: "llm-test-1",
		channel: "chat",
		endpointIndex: 0,
		endpointCount: 2,
		attempt: 1,
		maxAttempts: 6,
		retryable: false,
		message: "POST https://secret.example.com/v1/chat/completions Authorization: Bearer sk-testsecret123456",
	});

	assert.deepEqual(Object.keys(event).sort(), [
		"attempt",
		"channel",
		"endpointCount",
		"endpointIndex",
		"maxAttempts",
		"message",
		"requestId",
		"retryable",
		"type",
	]);
	const serialized = JSON.stringify(event);
	assert.doesNotMatch(serialized, /secret\.example\.com/);
	assert.doesNotMatch(serialized, /sk-testsecret/);
	assert.doesNotMatch(serialized, /Authorization/i);
});

test("retry scheduled telemetry includes attempt, max attempts, delay, retryability, and http status", async () => {
	const { createLlmTransportEvent } = await loadTelemetry();
	const event = createLlmTransportEvent({
		type: "retry_scheduled",
		requestId: "llm-test-2",
		channel: "chat_with_tools",
		endpointIndex: 0,
		endpointCount: 1,
		attempt: 1,
		maxAttempts: 6,
		delayMs: 700,
		retryable: true,
		error: new Error("504 Gateway Timeout from upstream"),
	});

	assert.equal(event.attempt, 1);
	assert.equal(event.maxAttempts, 6);
	assert.equal(event.delayMs, 700);
	assert.equal(event.retryable, true);
	assert.equal(event.httpStatus, 504);
	assert.match(event.message, /504/);
});

test("exhausted transport telemetry marks the retryable request as no longer retryable", async () => {
	const { createLlmTransportEvent } = await loadTelemetry();
	const event = createLlmTransportEvent({
		type: "request_exhausted",
		requestId: "llm-test-3",
		channel: "chat",
		endpointIndex: 0,
		endpointCount: 1,
		attempt: 6,
		maxAttempts: 6,
		retryable: true,
		error: "503 temporarily unavailable",
	});

	assert.equal(event.retryable, false);
	assert.equal(event.httpStatus, 503);
	assert.match(event.message, /503/);
});

test("one model request keeps the same transport request id across retry attempts", async () => {
	const { createLlmTransportEvent, createLlmTransportRequestId } = await loadTelemetry();
	const requestId = createLlmTransportRequestId("llm-chat");
	const retryScheduled = createLlmTransportEvent({
		type: "retry_scheduled",
		requestId,
		channel: "chat",
		endpointIndex: 0,
		endpointCount: 1,
		attempt: 1,
		maxAttempts: 6,
		delayMs: 700,
		retryable: true,
		error: "network timeout",
	});
	const retryStarted = createLlmTransportEvent({
		type: "retry_started",
		requestId,
		channel: "chat",
		endpointIndex: 0,
		endpointCount: 1,
		attempt: 1,
		maxAttempts: 6,
		retryable: true,
		message: "Retrying model request",
	});

	assert.match(requestId, /^llm-chat-/);
	assert.equal(retryScheduled.requestId, requestId);
	assert.equal(retryStarted.requestId, requestId);
});
