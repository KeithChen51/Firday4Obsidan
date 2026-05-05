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

test("TurnReplayReader summarizes checkpoint save and resume events", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-checkpoint-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "conversation-checkpoint", turnId: "turn-checkpoint", taskId: "task-checkpoint" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { traceId: "trace-checkpoint" } },
		{
			type: "checkpoint_saved",
			payload: {
				checkpointId: "checkpoint-a",
				boundary: "context_ready",
				step: 0,
				nextStep: 1,
				canAutoResume: true,
				reason: "Context package ready.",
			},
		},
		{
			type: "checkpoint_saved",
			payload: {
				checkpointId: "checkpoint-b",
				boundary: "after_tool_result",
				step: 1,
				nextStep: 2,
				canAutoResume: true,
				reason: "Tool result checkpoint ready.",
			},
		},
		{
			type: "checkpoint_resume_started",
			payload: {
				checkpointId: "checkpoint-b",
				boundary: "after_tool_result",
				step: 1,
				nextStep: 2,
				reason: "Resuming from stable tool result.",
			},
		},
		{
			type: "checkpoint_resume_completed",
			payload: {
				checkpointId: "checkpoint-b",
				boundary: "after_tool_result",
				step: 2,
				reason: "Checkpoint resume completed.",
			},
		},
		{ type: "assistant_final", payload: { summary: "Recovered from checkpoint." } },
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const summary = await reader.readSummary(ref);

	assert.deepEqual(summary.checkpoints, {
		saved: 2,
		resumed: 1,
		rejected: 0,
		latestBoundary: "after_tool_result",
	});
	assert.deepEqual(summary.checkpointTimeline.map((event) => [
		event.event,
		event.checkpointId,
		event.boundary,
		event.reason,
	]), [
		["saved", "checkpoint-a", "context_ready", "Context package ready."],
		["saved", "checkpoint-b", "after_tool_result", "Tool result checkpoint ready."],
		["resume_started", "checkpoint-b", "after_tool_result", "Resuming from stable tool result."],
		["resume_completed", "checkpoint-b", "after_tool_result", "Checkpoint resume completed."],
	]);
	assert.equal(summary.finalAnswerSummary, "Recovered from checkpoint.");
});

test("TurnReplayReader keeps checkpoint rejection reasons sanitized", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-checkpoint-redact-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "conversation-checkpoint", turnId: "turn-checkpoint-rejected" };
	const secret = "secret_token_abcdefghijklmnopqrstuvwxyz";

	await log.appendMany(ref, [
		{ type: "turn_started", payload: {} },
		{
			type: "checkpoint_resume_rejected",
			payload: {
				checkpointId: "checkpoint-unsafe",
				boundary: "during_tool_execution",
				reason: `Unsafe checkpoint contained ${secret}`,
				rawReasoning: "raw chain of thought must be redacted",
			},
		},
		{ type: "turn_failed", payload: { error: "Transport failed." } },
	]);

	const rawJsonl = await fs.readFile(resolvePath(ref), "utf8");
	const summary = await reader.readSummary(ref);

	assert.equal(rawJsonl.includes(secret), false);
	assert.equal(rawJsonl.includes("raw chain of thought"), false);
	assert.equal(summary.checkpoints.rejected, 1);
	assert.equal(summary.checkpointTimeline[0].event, "resume_rejected");
	assert.equal(summary.checkpointTimeline[0].checkpointId, "checkpoint-unsafe");
	assert.equal(summary.checkpointTimeline[0].reason.includes(secret), false);
	assert.match(summary.checkpointTimeline[0].reason, /\[redacted\]/);
});
