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
