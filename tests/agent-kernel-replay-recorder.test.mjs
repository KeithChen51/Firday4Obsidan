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
const replayRecorderPath = path.join(projectRoot, "src/core/agent-kernel/AgentReplayRecorder.ts");
const executionContextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");
const eventLogPath = path.join(projectRoot, "src/core/runtime/TurnEventLog.ts");
const replayReaderPath = path.join(projectRoot, "src/core/runtime/TurnReplayReader.ts");

async function loadModules() {
	const [recorderModule, contextModule, logModule, readerModule] = await Promise.all([
		jiti.import(replayRecorderPath),
		jiti.import(executionContextPath),
		jiti.import(eventLogPath),
		jiti.import(replayReaderPath),
	]);
	return {
		AgentReplayRecorder: recorderModule.AgentReplayRecorder,
		AgentExecutionContext: contextModule.AgentExecutionContext,
		TurnEventLog: logModule.TurnEventLog,
		TurnReplayReader: readerModule.TurnReplayReader,
	};
}

function resolveTurnPath(root) {
	return ({ conversationId, turnId }) =>
		path.join(root, "runtime", "conversations", conversationId, "turns", `${turnId}.jsonl`);
}

test("AgentReplayRecorder persists Kernel event stream with shared taskId and traceId", async () => {
	const { AgentReplayRecorder, AgentExecutionContext, TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-kernel-replay-"));
	const resolvePath = resolveTurnPath(root);
	const recorder = new AgentReplayRecorder({
		eventLog: new TurnEventLog({ resolveTurnPath: resolvePath }),
	});
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const context = new AgentExecutionContext({
		turnId: "turn-i-replay",
		taskId: "task-i",
		traceId: "trace-i",
		conversationId: "conversation-i",
		agentId: "agent-i",
		mode: "ask",
	});

	context.emit({ type: "task_updated", payload: { taskId: "task-i", status: "created", summary: "Task created." } });
	context.emit({ type: "task_updated", payload: { taskId: "task-i", status: "running", summary: "Task running." } });
	context.emit({ type: "model_request", payload: { step: 1 } });
	context.emit({ type: "model_response", payload: { step: 1 } });
	context.emit({ type: "approval_requested", payload: { tool: "write", targetPath: "Note.md" } });
	context.emit({ type: "approval_resolved", payload: { tool: "write", approved: true } });
	context.emit({ type: "mutation_planned", payload: { id: "mutation-i", status: "pending", targetPath: "Note.md" } });
	context.emit({ type: "task_updated", payload: { taskId: "task-i", status: "completed", summary: "Done." } });
	context.emit({ type: "turn_completed", status: "completed" });

	const records = await recorder.recordTurn({
		context,
		result: {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			status: "completed",
			assistantText: "Done.",
			events: context.snapshotEvents(),
			traces: [],
			rawFinalReply: "Done.",
		},
	});
	const replay = await reader.readTurn({ conversationId: "conversation-i", turnId: "turn-i-replay" });
	const summary = reader.summarize(replay);

	assert.equal(records.length, 9);
	assert.equal(replay.every((event) => event.taskId === "task-i"), true);
	assert.equal(replay.every((event) => event.payload.traceId === "trace-i"), true);
	assert.equal(summary.status, "completed");
	assert.equal(summary.modelCalls.requested, 1);
	assert.equal(summary.approvals.requested, 1);
	assert.equal(summary.approvals.resolved, 1);
	assert.equal(summary.mutations.planned, 1);
	assert.deepEqual(summary.taskTimeline.map((item) => item.event), ["created", "running", "completed"]);
});

test("AgentReplayRecorder preserves Kernel event times for completed replay duration", async () => {
	const { AgentReplayRecorder, AgentExecutionContext, TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-kernel-replay-"));
	const resolvePath = resolveTurnPath(root);
	const recorder = new AgentReplayRecorder({
		eventLog: new TurnEventLog({
			resolveTurnPath: resolvePath,
			now: () => new Date("2026-05-05T00:00:30.000Z"),
		}),
	});
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const context = new AgentExecutionContext({
		turnId: "turn-duration",
		taskId: "task-duration",
		traceId: "trace-duration",
		conversationId: "conversation-duration",
		agentId: "agent-duration",
		mode: "ask",
	});

	context.emit({ type: "turn_started", at: "2026-05-05T00:00:00.000Z", payload: { mode: "ask" } });
	context.emit({ type: "tool_call", at: "2026-05-05T00:00:03.000Z", payload: { step: 1, tool: "read", targetPath: "Notes/A.md" } });
	context.emit({ type: "tool_result", at: "2026-05-05T00:00:04.000Z", payload: { step: 1, tool: "read", targetPath: "Notes/A.md", status: "ok" } });
	context.emit({ type: "turn_completed", at: "2026-05-05T00:00:07.000Z", status: "completed" });

	await recorder.recordTurn({
		context,
		result: {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			status: "completed",
			assistantText: "Done.",
			events: context.snapshotEvents(),
			traces: [],
			rawFinalReply: "Done.",
		},
	});
	const summary = reader.summarize(await reader.readTurn({
		conversationId: "conversation-duration",
		turnId: "turn-duration",
		taskId: "task-duration",
	}));

	assert.equal(summary.startedAt, "2026-05-05T00:00:00.000Z");
	assert.equal(summary.completedAt, "2026-05-05T00:00:07.000Z");
	assert.equal(summary.durationMs, 7000);
});

test("AgentReplayRecorder computes replay duration when terminal replay event is appended at completion", async () => {
	const { AgentReplayRecorder, AgentExecutionContext, TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-kernel-replay-"));
	const resolvePath = resolveTurnPath(root);
	const recorder = new AgentReplayRecorder({
		eventLog: new TurnEventLog({
			resolveTurnPath: resolvePath,
			now: () => new Date("2026-05-05T00:00:09.000Z"),
		}),
	});
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const context = new AgentExecutionContext({
		turnId: "turn-extra-terminal",
		taskId: "task-extra-terminal",
		traceId: "trace-extra-terminal",
		conversationId: "conversation-extra-terminal",
		agentId: "agent-extra-terminal",
		mode: "ask",
	});

	context.emit({ type: "turn_started", at: "2026-05-05T00:00:00.000Z", payload: { mode: "ask" } });
	await recorder.recordTurn({
		context,
		result: {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			status: "completed",
			assistantText: "Done.",
			events: context.snapshotEvents(),
			traces: [],
			rawFinalReply: "Done.",
		},
		extraEvents: [
			{ type: "assistant_final", payload: { summary: "Done.", traceId: context.traceId } },
			{ type: "turn_completed", payload: { status: "completed", traceId: context.traceId } },
		],
	});
	const summary = reader.summarize(await reader.readTurn({
		conversationId: "conversation-extra-terminal",
		turnId: "turn-extra-terminal",
		taskId: "task-extra-terminal",
	}));

	assert.equal(summary.startedAt, "2026-05-05T00:00:00.000Z");
	assert.equal(summary.completedAt, "2026-05-05T00:00:09.000Z");
	assert.equal(summary.durationMs, 9000);
});
