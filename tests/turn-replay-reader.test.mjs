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

test("TurnReplayReader reads a turn, validates order, and returns a summary", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-1" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "model_requested", payload: { step: 1 } },
		{ type: "model_completed", payload: { step: 1 } },
		{ type: "tool_requested", payload: { step: 1, tool: "read", toolCallId: "tool-1" } },
		{ type: "tool_policy_checked", payload: { step: 1, tool: "read", decision: "allow" } },
		{ type: "tool_completed", payload: { step: 1, tool: "read", toolCallId: "tool-1", status: "ok" } },
		{ type: "assistant_final", payload: { summary: "Answered from the note." } },
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const events = await reader.readTurn(ref);
	const validation = reader.validateOrder(events);
	const summary = reader.summarize(events);

	assert.equal(validation.ok, true);
	assert.deepEqual(validation.errors, []);
	assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
	assert.equal(summary.conversationId, "agent");
	assert.equal(summary.turnId, "turn-1");
	assert.equal(summary.totalEvents, 8);
	assert.equal(summary.status, "completed");
	assert.equal(summary.modelCalls.requested, 1);
	assert.equal(summary.modelCalls.completed, 1);
	assert.equal(summary.modelCalls.failed, 0);
	assert.equal(summary.toolEvents.completed, 1);
	assert.equal(summary.toolEvents.failed, 0);
	assert.equal(summary.toolEvents.denied, 0);
	assert.equal(summary.approvals.requested, 0);
	assert.equal(summary.approvals.resolved, 0);
	assert.equal(summary.mutations.planned, 0);
	assert.equal(summary.finalAnswerSummary, "Answered from the note.");
	assert.equal(summary.terminalStatus, "turn_completed");
	assert.deepEqual(summary.toolCalls, [
		{ step: 1, tool: "read", toolCallId: "tool-1", status: "ok", targetPath: "" },
	]);
	assert.deepEqual(summary.eventTypes, [
		"turn_started",
		"model_requested",
		"model_completed",
		"tool_requested",
		"tool_policy_checked",
		"tool_completed",
		"assistant_final",
		"turn_completed",
	]);
});

test("TurnReplayReader reports sequence gaps and late events after a terminal event", async () => {
	const { TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const reader = new TurnReplayReader({ resolveTurnPath: resolveTurnPath(root) });

	const validation = reader.validateOrder([
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 3,
			type: "turn_completed",
			at: "2026-04-30T00:00:01.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 4,
			type: "tool_requested",
			at: "2026-04-30T00:00:02.000Z",
			payload: { tool: "read" },
		},
	]);

	assert.equal(validation.ok, false);
	assert.ok(validation.errors.some((error) => error.includes("sequence 2")));
	assert.ok(validation.errors.some((error) => error.includes("terminal event")));
});

test("TurnReplayReader summarizes failed cancelled safe-stopped approval and mutation events", async () => {
	const { TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const reader = new TurnReplayReader({ resolveTurnPath: resolveTurnPath(root) });

	const failed = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 2,
			type: "model_failed",
			at: "2026-04-30T00:00:01.000Z",
			payload: {
				error: "504 gateway timeout",
				failureClass: "transport_unstable",
				recoverable: true,
				retryable: true,
			},
		},
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 3,
			type: "turn_failed",
			at: "2026-04-30T00:00:02.000Z",
			payload: {
				error: "504 gateway timeout",
				failureClass: "transport_unstable",
				recoverable: true,
				retryable: true,
			},
		},
	]);
	assert.equal(failed.status, "failed");
	assert.equal(failed.modelCalls.failed, 1);
	assert.deepEqual(failed.errors, ["504 gateway timeout", "504 gateway timeout"]);

	const rich = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 2,
			type: "tool_approval_requested",
			at: "2026-04-30T00:00:01.000Z",
			payload: { step: 1, tool: "write" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 3,
			type: "tool_approval_resolved",
			at: "2026-04-30T00:00:02.000Z",
			payload: { step: 1, tool: "write", approved: true },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 4,
			type: "mutation_planned",
			at: "2026-04-30T00:00:03.000Z",
			payload: { id: "plan-1", targetPath: "a.md" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 5,
			type: "mutation_applied",
			at: "2026-04-30T00:00:04.000Z",
			payload: { id: "plan-1", targetPath: "a.md" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 6,
			type: "mutation_conflicted",
			at: "2026-04-30T00:00:04.500Z",
			payload: { id: "plan-2", targetPath: "b.md", reason: "Before snapshot changed." },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 7,
			type: "mutation_apply_failed",
			at: "2026-04-30T00:00:04.700Z",
			payload: { id: "plan-3", operation: "write", targetPath: "c.md", error: "Disk write failed." },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 8,
			type: "turn_completed",
			at: "2026-04-30T00:00:05.000Z",
			payload: { status: "safe_stopped" },
		},
	]);
	assert.equal(rich.status, "safe_stopped");
	assert.equal(rich.approvals.requested, 1);
	assert.equal(rich.approvals.resolved, 1);
	assert.equal(rich.mutations.planned, 1);
	assert.equal(rich.mutations.applied, 1);
	assert.equal(rich.mutations.conflicted, 1);
	assert.equal(rich.mutations.applyFailed, 1);
	assert.deepEqual(rich.mutationTimeline, [
		{ id: "plan-1", event: "planned", operation: "", targetPath: "a.md", status: "", summary: "", reason: "" },
		{ id: "plan-1", event: "applied", operation: "", targetPath: "a.md", status: "", summary: "", reason: "" },
		{ id: "plan-2", event: "conflicted", operation: "", targetPath: "b.md", status: "", summary: "", reason: "Before snapshot changed." },
		{ id: "plan-3", event: "apply_failed", operation: "write", targetPath: "c.md", status: "", summary: "", reason: "Disk write failed." },
	]);

	const cancelled = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 2,
			type: "turn_cancelled",
			at: "2026-04-30T00:00:01.000Z",
			payload: { summary: "User cancelled." },
		},
	]);
	assert.equal(cancelled.status, "cancelled");
	assert.equal(reader.validateOrder([
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 2,
			type: "turn_cancelled",
			at: "2026-04-30T00:00:01.000Z",
			payload: { summary: "User cancelled." },
		},
	]).ok, true);
});

test("TurnReplayReader summarizes task lifecycle timeline", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-task-"));
	const resolvePath = resolveTurnPath(root);
	const ref = { conversationId: "agent", turnId: "turn-task", taskId: "task-1" };
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "task_created", payload: { taskId: "task-1", status: "created", summary: "Task created." } },
		{ type: "task_running", payload: { taskId: "task-1", status: "running", summary: "Runtime started." } },
		{ type: "task_waiting_for_approval", payload: { taskId: "task-1", status: "waiting_for_approval", summary: "Review changes." } },
		{ type: "task_cancelled", payload: { taskId: "task-1", status: "cancelled", summary: "User cancelled." } },
		{ type: "turn_cancelled", payload: { summary: "User cancelled." } },
	]);

	const summary = await reader.readSummary(ref);
	assert.equal(summary.status, "cancelled");
	assert.deepEqual(summary.taskTimeline, [
		{ taskId: "task-1", event: "created", status: "created", summary: "Task created.", reason: "" },
		{ taskId: "task-1", event: "running", status: "running", summary: "Runtime started.", reason: "" },
		{ taskId: "task-1", event: "waiting_for_approval", status: "waiting_for_approval", summary: "Review changes.", reason: "" },
		{ taskId: "task-1", event: "cancelled", status: "cancelled", summary: "User cancelled.", reason: "" },
	]);
});
