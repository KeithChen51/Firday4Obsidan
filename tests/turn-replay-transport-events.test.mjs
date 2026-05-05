/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const logPath = path.join(projectRoot, "src/core/runtime/TurnEventLog.ts");
const readerPath = path.join(projectRoot, "src/core/runtime/TurnReplayReader.ts");

async function loadModules() {
	const [logModule, readerModule] = await Promise.all([
		jiti.import(logPath),
		jiti.import(readerPath),
	]);
	return {
		TurnEventLog: logModule.TurnEventLog,
		TurnReplayReader: readerModule.TurnReplayReader,
	};
}

function resolveTurnPath(root) {
	return ({ conversationId, turnId }) =>
		path.join(root, "runtime", "conversations", conversationId, "turns", `${turnId}.jsonl`);
}

function makeTransport(type, overrides = {}) {
	return {
		type,
		requestId: "llm-transport-1",
		attempt: type === "retry_started" ? 2 : type === "request_exhausted" ? 4 : 1,
		maxAttempts: 4,
		delayMs: type === "retry_scheduled" ? 700 : undefined,
		httpStatus: 504,
		retryable: type !== "request_exhausted",
		channel: "chat_with_tools",
		endpointIndex: 0,
		endpointCount: 1,
		...overrides,
	};
}

test("TurnReplayReader summarizes persisted model retry transport events", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-transport-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-transport", taskId: "task-transport" };
	const longMessage = `${"x".repeat(400)} Bearer sk-supersecret123456`;

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { traceId: "trace-transport" } },
		{ type: "model_requested", payload: { step: 1 } },
		{
			type: "model_retry",
			payload: {
				step: 1,
				summary: longMessage,
				transport: makeTransport("retry_scheduled"),
			},
		},
		{
			type: "model_retry",
			payload: {
				step: 1,
				summary: "Retry started",
				transport: makeTransport("retry_started"),
			},
		},
		{
			type: "model_retry",
			payload: {
				step: 1,
				summary: "Retries exhausted",
				transport: makeTransport("request_exhausted"),
			},
		},
		{ type: "model_failed", payload: { step: 1, error: "504 Gateway Timeout" } },
		{ type: "turn_failed", payload: { error: "504 Gateway Timeout" } },
	]);

	const events = await reader.readTurn(ref);
	const validation = reader.validateOrder(events);
	const summary = reader.summarize(events);

	assert.equal(validation.ok, true);
	assert.equal(summary.transport.retries, 1);
	assert.equal(summary.transport.exhausted, 1);
	assert.equal(summary.transport.lastStatus, 504);
	assert.equal(summary.transport.lastMessage, "Retries exhausted");
	assert.deepEqual(summary.transportTimeline, [
		{
			type: "retry_scheduled",
			step: 1,
			attempt: 1,
			maxAttempts: 4,
			delayMs: 700,
			httpStatus: 504,
			message: events[2].payload.summary,
			at: events[2].at,
		},
		{
			type: "retry_started",
			step: 1,
			attempt: 2,
			maxAttempts: 4,
			httpStatus: 504,
			message: "Retry started",
			at: events[3].at,
		},
		{
			type: "request_exhausted",
			step: 1,
			attempt: 4,
			maxAttempts: 4,
			httpStatus: 504,
			message: "Retries exhausted",
			at: events[4].at,
		},
	]);
	assert.equal(summary.startedAt, events[0].at);
	assert.equal(summary.completedAt, events[6].at);
	assert.ok(summary.durationMs >= 0);
	assert.doesNotMatch(JSON.stringify(events), /sk-supersecret/);
	assert.match(String(events[2].payload.summary), /truncated/);
});

test("TurnReplayReader rejects model retry events after terminal turn events", async () => {
	const { TurnReplayReader } = await loadModules();
	const reader = new TurnReplayReader({ resolveTurnPath: resolveTurnPath(await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-transport-bad-"))) });

	const validation = reader.validateOrder([
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 1,
			type: "turn_started",
			at: "2026-05-04T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 2,
			type: "turn_failed",
			at: "2026-05-04T00:00:01.000Z",
			payload: { error: "failed" },
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 3,
			type: "model_retry",
			at: "2026-05-04T00:00:02.000Z",
			payload: { step: 1, transport: makeTransport("retry_started") },
		},
	]);

	assert.equal(validation.ok, false);
	assert.ok(validation.errors.some((error) => error.includes("terminal event")));
});
