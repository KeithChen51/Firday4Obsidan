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
const modulePath = path.join(projectRoot, "src/core/runtime/TurnEventLog.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function resolveTurnPath(root) {
	return ({ conversationId, turnId }) =>
		path.join(root, "runtime", "conversations", conversationId, "turns", `${turnId}.jsonl`);
}

async function readJsonl(filePath) {
	const content = await fs.readFile(filePath, "utf8");
	return content
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

test("TurnEventLog appends ordered JSONL records under the conversation turn path", async () => {
	const { TurnEventLog } = await loadModule();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-event-log-"));
	const log = new TurnEventLog({ resolveTurnPath: resolveTurnPath(root) });
	const ref = { conversationId: "agent", turnId: "turn-1", taskId: "task-1" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "model_requested", payload: { step: 1 } },
		{ type: "assistant_final", payload: { summary: "Answered" } },
	]);

	const records = await readJsonl(resolveTurnPath(root)(ref));
	assert.deepEqual(records.map((event) => event.sequence), [1, 2, 3]);
	assert.deepEqual(records.map((event) => event.type), [
		"turn_started",
		"model_requested",
		"assistant_final",
	]);
	assert.equal(records[0].conversationId, "agent");
	assert.equal(records[0].turnId, "turn-1");
	assert.equal(records[0].taskId, "task-1");
	assert.match(records[0].at, /^\d{4}-\d{2}-\d{2}T/);
	assert.deepEqual(records[1].payload, { step: 1 });
});

test("TurnEventLog preserves explicit event timestamps when appending a batch", async () => {
	const { TurnEventLog } = await loadModule();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-event-log-"));
	const log = new TurnEventLog({
		resolveTurnPath: resolveTurnPath(root),
		now: () => new Date("2026-05-05T00:00:30.000Z"),
	});
	const ref = { conversationId: "agent", turnId: "turn-duration" };

	await log.appendMany(ref, [
		{ type: "turn_started", at: "2026-05-05T00:00:00.000Z", payload: { summary: "Started" } },
		{ type: "turn_completed", at: "2026-05-05T00:00:07.000Z", payload: { status: "completed" } },
	]);

	const records = await readJsonl(resolveTurnPath(root)(ref));
	assert.deepEqual(records.map((event) => event.at), [
		"2026-05-05T00:00:00.000Z",
		"2026-05-05T00:00:07.000Z",
	]);
});

test("TurnEventLog redacts oversized payload values before writing", async () => {
	const { TurnEventLog } = await loadModule();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-event-log-"));
	const log = new TurnEventLog({
		resolveTurnPath: resolveTurnPath(root),
		maxPayloadStringLength: 16,
	});
	const ref = { conversationId: "agent", turnId: "turn-redacted" };

	await log.appendMany(ref, [
		{
			type: "tool_completed",
			payload: {
				tool: "read",
				fullText: "this payload is intentionally longer than the event log limit",
			},
		},
	]);

	const [record] = await readJsonl(resolveTurnPath(root)(ref));
	assert.equal(record.payload.tool, "read");
	assert.match(record.payload.fullText, /truncated/);
	assert.ok(record.payload.fullText.length <= 40);
});

test("TurnEventLog redacts sensitive keys and secret-like values before persisting", async () => {
	const { TurnEventLog } = await loadModule();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-event-log-"));
	const log = new TurnEventLog({ resolveTurnPath: resolveTurnPath(root) });
	const ref = { conversationId: "agent", turnId: "turn-sensitive" };

	await log.appendMany(ref, [
		{
			type: "tool_completed",
			payload: {
				tool: "exec",
				authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwxyz123456",
				headers: {
					"x-api-key": "friday_secret_1234567890",
				},
				message: "Token sk-test-abcdefghijklmnopqrstuvwxyz123456 should not be written.",
			},
		},
	]);

	const [record] = await readJsonl(resolveTurnPath(root)(ref));
	const persisted = JSON.stringify(record);
	assert.doesNotMatch(persisted, /sk-live/);
	assert.doesNotMatch(persisted, /sk-test/);
	assert.doesNotMatch(persisted, /friday_secret/);
	assert.equal(record.payload.authorization, "[redacted]");
	assert.equal(record.payload.headers["x-api-key"], "[redacted]");
	assert.match(record.payload.message, /\[redacted\]/);
});
