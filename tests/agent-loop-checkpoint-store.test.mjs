/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const storePath = path.join(projectRoot, "src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts");

function makeTempStorePath() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-checkpoints-"));
	return path.join(dir, "checkpoints.json");
}

function makeCheckpoint(overrides = {}) {
	const now = overrides.createdAt ?? "2026-05-05T00:00:00.000Z";
	return {
		schemaVersion: 1,
		id: overrides.id ?? `checkpoint-${Math.random().toString(16).slice(2)}`,
		turnId: overrides.turnId ?? "turn-1",
		taskId: overrides.taskId ?? "task-1",
		traceId: overrides.traceId ?? "trace-1",
		conversationId: overrides.conversationId ?? "conversation-1",
		agentId: overrides.agentId ?? "agent-1",
		boundary: overrides.boundary ?? "after_tool_result",
		channel: overrides.channel ?? "native",
		step: overrides.step ?? 1,
		nextStep: overrides.nextStep ?? 2,
		createdAt: now,
		modelOverride: overrides.modelOverride ?? "deepseek/deepseek-v4-pro",
		mode: overrides.mode ?? "ask",
		allowedTools: overrides.allowedTools ?? ["read"],
		modelMessages: overrides.modelMessages ?? [
			{ role: "system", content: "Authorization: Bearer super-secret-token" },
			{
				role: "assistant",
				content: "",
				reasoningArtifact: {
					hasReasoning: true,
					provider: "deepseek",
					model: "deepseek-reasoner",
					rawFormat: "reasoning_content",
					visibleSummary: "safe summary",
					rawReasoning: "raw chain of thought must not persist",
					continuationPolicy: "drop",
					continuationPayload: { reasoning_content: "do not store" },
					metadata: { sourceProtocol: "chat_completions" },
				},
			},
		],
		traces: overrides.traces ?? [],
		pendingMutations: overrides.pendingMutations ?? [],
		completedToolCalls: overrides.completedToolCalls ?? [
			{ toolCallId: "call-1", tool: "read", status: "ok", step: 1 },
		],
		safety: overrides.safety ?? { canAutoResume: true, reason: "stable tool result" },
		privacy: overrides.privacy ?? { redacted: true, localOnly: true },
		...overrides,
	};
}

test("AgentLoopCheckpointStore saves and retrieves latest checkpoint by task and turn", async () => {
	const { AgentLoopCheckpointStore } = await jiti.import(storePath);
	const checkpointStore = new AgentLoopCheckpointStore({
		storePath: makeTempStorePath(),
		now: () => new Date("2026-05-05T00:00:30.000Z"),
	});

	await checkpointStore.save(makeCheckpoint({ id: "old", taskId: "task-a", turnId: "turn-a", createdAt: "2026-05-05T00:00:00.000Z" }));
	await checkpointStore.save(makeCheckpoint({ id: "new", taskId: "task-a", turnId: "turn-a", createdAt: "2026-05-05T00:00:10.000Z" }));

	assert.equal((await checkpointStore.getLatestForTask("task-a"))?.id, "new");
	assert.equal((await checkpointStore.getLatestForTurn("turn-a"))?.id, "new");
	assert.equal((await checkpointStore.get("new"))?.id, "new");
});

test("AgentLoopCheckpointStore hides consumed rejected expired and stale checkpoints", async () => {
	const { AgentLoopCheckpointStore } = await jiti.import(storePath);
	const checkpointStore = new AgentLoopCheckpointStore({
		storePath: makeTempStorePath(),
		now: () => new Date("2026-05-05T00:10:00.000Z"),
		ttlMs: 60_000,
	});

	await checkpointStore.save(makeCheckpoint({ id: "fresh", taskId: "task-a", createdAt: "2026-05-05T00:09:30.000Z" }));
	await checkpointStore.save(makeCheckpoint({ id: "stale", taskId: "task-b", createdAt: "2026-05-05T00:00:00.000Z" }));
	await checkpointStore.save(makeCheckpoint({ id: "rejected", taskId: "task-c", createdAt: "2026-05-05T00:09:40.000Z" }));
	await checkpointStore.markConsumed("rejected", "rejected", "unsafe boundary");

	assert.equal((await checkpointStore.getLatestForTask("task-a"))?.id, "fresh");
	assert.equal(await checkpointStore.getLatestForTask("task-b"), null);
	assert.equal(await checkpointStore.getLatestForTask("task-c"), null);
	assert.equal((await checkpointStore.get("rejected"))?.consumed?.result, "rejected");
});

test("AgentLoopCheckpointStore sanitizes secrets and raw reasoning before persistence", async () => {
	const { AgentLoopCheckpointStore } = await jiti.import(storePath);
	const filePath = makeTempStorePath();
	const checkpointStore = new AgentLoopCheckpointStore({ storePath: filePath });

	await checkpointStore.save(makeCheckpoint({
		id: "secret-checkpoint",
		modelMessages: [
			{
				role: "assistant",
				content: "Use sk-thisshouldberemoved and cookie=sessionid",
				endpoint: "https://zenmux.ai/api/v1",
				requestHeaders: { authorization: "Bearer keep-out" },
				reasoningArtifact: {
					hasReasoning: true,
					provider: "zenmux",
					model: "deepseek/deepseek-v4-pro",
					rawFormat: "reasoning",
					visibleSummary: "safe",
					rawReasoning: "raw CoT",
					continuationPolicy: "preserve_raw",
					continuationPayload: { reasoning_content: "raw CoT" },
					metadata: { sourceProtocol: "chat_completions" },
				},
			},
			{
				role: "assistant",
				content: "",
				reasoningArtifact: {
					hasReasoning: true,
					provider: "zenmux",
					model: "zenmux/signed",
					rawFormat: "reasoning_details",
					visibleSummary: "signed",
					rawReasoning: "raw signature-adjacent CoT",
					continuationPolicy: "preserve_signature_only",
					continuationPayload: { reasoning: "raw CoT", reasoning_details: [{ signature: "sig-1" }] },
					metadata: { sourceProtocol: "chat_completions" },
				},
			},
		],
	}));

	const raw = fs.readFileSync(filePath, "utf8");
	assert.equal(raw.includes("raw CoT"), false);
	assert.equal(raw.includes("reasoning_content"), false);
	assert.equal(raw.includes("https://zenmux.ai/api/v1"), false);
	assert.equal(raw.includes("Bearer keep-out"), false);
	assert.equal(raw.includes("sk-thisshouldberemoved"), false);

	const restored = await checkpointStore.get("secret-checkpoint");
	const secondArtifact = restored.modelMessages[1].reasoningArtifact;
	assert.deepEqual(secondArtifact.continuationPayload, { reasoning_details: [{ signature: "sig-1" }] });
	assert.equal("rawReasoning" in secondArtifact, false);
});
