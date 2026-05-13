/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const storePath = path.join(projectRoot, "src/core/trajectory/LiveTrajectoryStore.ts");

async function loadStore() {
	return jiti.import(storePath);
}

function startEvent(turnId = "turn-1") {
	return {
		phase: "start",
		depth: 0,
		message: "Runtime started.",
		turnId,
		taskId: `${turnId}-task`,
		traceId: `${turnId}-trace`,
		conversationId: "conversation-1",
	};
}

test("LiveTrajectoryStore appends progress and returns the current projected snapshot", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	const started = store.appendProgress(startEvent());
	const withTool = store.appendProgress({
		phase: "tool_call",
		depth: 0,
		step: 1,
		tool: "read",
		targetPath: "Notes/today.md",
		message: "Reading note.",
		turnId: "turn-1",
	});

	assert.equal(started.status, "running");
	assert.equal(withTool.status, "running");
	assert.equal(store.getSnapshot()?.identity.turnId, "turn-1");
	assert.ok(store.getSnapshot()?.items.some((item) => item.kind === "tool" && item.tool === "read"));
});

test("LiveTrajectoryStore stamps untimed events so live elapsed duration can update", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const times = [
		new Date("2026-05-05T00:00:00.000Z"),
		new Date("2026-05-05T00:00:02.000Z"),
		new Date("2026-05-05T00:00:05.000Z"),
	];
	const store = new LiveTrajectoryStore({ now: () => times.shift() ?? new Date("2026-05-05T00:00:05.000Z") });

	store.appendProgress(startEvent("turn-timed"));
	const running = store.appendProgress({
		phase: "tool_call",
		depth: 0,
		step: 1,
		tool: "read",
		targetPath: "Notes/today.md",
		message: "Reading.",
		turnId: "turn-timed",
	});
	const completed = store.completeFromProgress({
		phase: "done",
		depth: 0,
		message: "Done.",
		turnId: "turn-timed",
	});

	assert.equal(running.time.startedAt, "2026-05-05T00:00:00.000Z");
	assert.equal(running.time.updatedAt, "2026-05-05T00:00:02.000Z");
	assert.equal(running.items.find((item) => item.kind === "tool")?.at, "2026-05-05T00:00:02.000Z");
	assert.equal(completed?.time.completedAt, "2026-05-05T00:00:05.000Z");
	assert.equal(completed?.time.durationMs, 5000);
});

test("LiveTrajectoryStore refreshes elapsed duration between progress events", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const times = [
		new Date("2026-05-05T00:00:00.000Z"),
		new Date("2026-05-05T00:00:01.000Z"),
		new Date("2026-05-05T00:00:04.000Z"),
	];
	const store = new LiveTrajectoryStore({ now: () => times.shift() ?? new Date("2026-05-05T00:00:04.000Z") });

	store.appendProgress(startEvent("turn-refresh"));
	store.appendProgress({ phase: "model_request", depth: 0, step: 1, message: "Thinking.", turnId: "turn-refresh" });
	const refreshed = store.refreshElapsed();

	assert.equal(refreshed?.time.startedAt, "2026-05-05T00:00:00.000Z");
	assert.equal(refreshed?.time.updatedAt, "2026-05-05T00:00:04.000Z");
	assert.equal(refreshed?.time.durationMs, 4000);
	assert.equal(store.getSnapshot()?.time.durationMs, 4000);
});

test("LiveTrajectoryStore resets live history when a new turn starts", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	store.appendProgress(startEvent("turn-1"));
	store.appendProgress({ phase: "tool_call", depth: 0, step: 1, tool: "read", message: "Reading.", turnId: "turn-1" });
	const nextTurn = store.appendProgress(startEvent("turn-2"));

	assert.equal(nextTurn.identity.turnId, "turn-2");
	assert.equal(nextTurn.identity.taskId, "turn-2-task");
	assert.deepEqual(nextTurn.items.map((item) => item.kind), []);
	assert.equal(store.getCompletedSnapshot(), null);
});

test("LiveTrajectoryStore freezes a completed snapshot", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	store.appendProgress(startEvent("turn-complete"));
	store.appendProgress({ phase: "model_request", depth: 0, step: 1, message: "Thinking.", turnId: "turn-complete" });
	const completed = store.completeFromProgress({
		phase: "done",
		depth: 0,
		message: "Runtime finished.",
		turnId: "turn-complete",
	});

	assert.equal(completed?.status, "completed");
	assert.equal(store.getSnapshot(), null);
	assert.equal(store.getCompletedSnapshot()?.status, "completed");
	assert.ok(store.getCompletedSnapshot()?.items.some((item) => item.kind === "final"));
});

test("LiveTrajectoryStore reset clears stale completed snapshots before a fresh retry", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	store.appendProgress(startEvent("turn-retry-old"));
	store.completeFromProgress({
		phase: "done",
		depth: 0,
		message: "Old run completed.",
		turnId: "turn-retry-old",
	});

	assert.equal(store.getCompletedSnapshot()?.identity.turnId, "turn-retry-old");

	store.reset();

	assert.equal(store.getSnapshot(), null);
	assert.equal(store.getCompletedSnapshot(), null);
});

test("LiveTrajectoryStore terminal errors clear running state but keep replayable items", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	store.appendProgress(startEvent("turn-error"));
	store.appendProgress({
		phase: "tool_call",
		depth: 0,
		step: 1,
		tool: "grep",
		targetPath: "Notes",
		message: "Searching notes.",
		turnId: "turn-error",
	});
	const failed = store.completeFromProgress({
		phase: "error",
		depth: 0,
		message: "Runtime failed.",
		turnId: "turn-error",
	});

	assert.equal(failed?.status, "failed");
	assert.equal(store.getSnapshot(), null);
	assert.ok(store.getCompletedSnapshot()?.items.some((item) => item.kind === "tool" && item.status === "running"));
	assert.equal(store.getCompletedSnapshot()?.failure?.retryable, true);
});

test("LiveTrajectoryStore does not mutate previously returned snapshots", async () => {
	const { LiveTrajectoryStore } = await loadStore();
	const store = new LiveTrajectoryStore();

	const first = store.appendProgress(startEvent("turn-immutable"));
	store.appendProgress({
		phase: "tool_call",
		depth: 0,
		step: 1,
		tool: "read",
		targetPath: "Notes/today.md",
		message: "Reading note.",
		turnId: "turn-immutable",
	});

	assert.equal(first.items.length, 0);
	assert.equal(first.status, "running");
	assert.ok(store.getSnapshot()?.items.some((item) => item.kind === "tool"));
});
