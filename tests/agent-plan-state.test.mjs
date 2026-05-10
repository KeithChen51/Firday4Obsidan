/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const planStatePath = path.join(projectRoot, "src/core/agent-kernel/PlanState.ts");

async function loadPlanState() {
	return jiti.import(planStatePath);
}

test("PlanState creates a task-bar plan with exactly one in-progress task", async () => {
	const { createPlanState } = await loadPlanState();

	const state = createPlanState({
		planId: "plan-1",
		tasks: ["确认上下文", "实现过程叙事", "运行验收"],
		now: "2026-05-07T00:00:00.000Z",
	});

	assert.equal(state.visibility, "task_bar");
	assert.equal(state.status, "running");
	assert.equal(state.currentTaskId, "plan-1-1");
	assert.deepEqual(state.tasks.map((task) => [task.id, task.title, task.status]), [
		["plan-1-1", "确认上下文", "in_progress"],
		["plan-1-2", "实现过程叙事", "pending"],
		["plan-1-3", "运行验收", "pending"],
	]);
	assert.equal(state.tasks.filter((task) => task.status === "in_progress").length, 1);
});

test("PlanState creates model-authored tasks with normalized status including blocked", async () => {
	const { createPlanState } = await loadPlanState();

	const state = createPlanState({
		planId: "plan-model-authored",
		visibility: "visible",
		tasks: [
			{ id: "read", title: "Read evidence", status: "completed" },
			{ id: "blocked-edit", title: "Read-only replacement for edit", status: "blocked" },
			{ id: "summarize", title: "Summarize findings", status: "pending" },
		],
		now: "2026-05-07T00:00:00.000Z",
	});

	assert.equal(state.visibility, "visible");
	assert.deepEqual(state.tasks.map((task) => [task.id, task.title, task.status]), [
		["read", "Read evidence", "completed"],
		["blocked-edit", "Read-only replacement for edit", "blocked"],
		["summarize", "Summarize findings", "in_progress"],
	]);
	assert.equal(state.currentTaskId, "summarize");
	assert.equal(state.tasks.filter((task) => task.status === "in_progress").length, 1);
});

test("PlanState does not complete blocked tasks through completePlanTask", async () => {
	const { createPlanState, completePlanTask } = await loadPlanState();
	const state = createPlanState({
		planId: "plan-blocked-task",
		tasks: [
			{ id: "blocked-edit", title: "Read-only replacement for edit", status: "blocked" },
		],
		now: "2026-05-07T00:00:00.000Z",
	});

	const afterComplete = completePlanTask(state, "blocked-edit", {
		now: "2026-05-07T00:00:05.000Z",
		reason: "Finalization should not override blocked status.",
	});

	assert.equal(afterComplete.currentTaskId, "blocked-edit");
	assert.deepEqual(afterComplete.tasks.map((task) => [task.id, task.status, task.completedAt]), [
		["blocked-edit", "blocked", undefined],
	]);
});

test("PlanState does not complete blocked tasks through plan revisions", async () => {
	const { createPlanState, revisePlanState } = await loadPlanState();
	const state = createPlanState({
		planId: "plan-blocked-revise",
		tasks: [
			{ id: "blocked-edit", title: "Read-only replacement for edit", status: "blocked" },
		],
		now: "2026-05-07T00:00:00.000Z",
	});

	const revised = revisePlanState(state, {
		changes: [
			{ type: "status", taskId: "blocked-edit", status: "completed" },
		],
		now: "2026-05-07T00:00:05.000Z",
	});

	assert.equal(revised.currentTaskId, "blocked-edit");
	assert.deepEqual(revised.tasks.map((task) => [task.id, task.status, task.completedAt]), [
		["blocked-edit", "blocked", undefined],
	]);
});

test("PlanState advances, skips, revises, and completes without approval side effects", async () => {
	const {
		createPlanState,
		completePlanTask,
		skipPlanTask,
		revisePlanState,
		completePlanState,
	} = await loadPlanState();
	const initial = createPlanState({
		planId: "plan-2",
		tasks: ["确认上下文", "实现过程叙事", "运行验收"],
		now: "2026-05-07T00:00:00.000Z",
	});

	const afterFirst = completePlanTask(initial, "plan-2-1", { now: "2026-05-07T00:00:05.000Z" });
	assert.equal(afterFirst.currentTaskId, "plan-2-2");
	assert.deepEqual(afterFirst.tasks.map((task) => task.status), ["completed", "in_progress", "pending"]);

	const afterSkip = skipPlanTask(afterFirst, "plan-2-2", {
		now: "2026-05-07T00:00:06.000Z",
		reason: "已有等价实现",
	});
	assert.equal(afterSkip.currentTaskId, "plan-2-3");
	assert.deepEqual(afterSkip.tasks.map((task) => task.status), ["completed", "skipped", "in_progress"]);
	assert.equal(afterSkip.tasks[1]?.summary, "已有等价实现");

	const revised = revisePlanState(afterSkip, {
		tasks: [
			{ id: "plan-2-1", title: "确认上下文" },
			{ id: "plan-2-3", title: "运行验收" },
			{ id: "plan-2-4", title: "最终审查" },
		],
		now: "2026-05-07T00:00:07.000Z",
	});
	assert.deepEqual(revised.tasks.map((task) => [task.id, task.status]), [
		["plan-2-1", "completed"],
		["plan-2-3", "in_progress"],
		["plan-2-4", "pending"],
	]);

	const completed = completePlanState(revised, { now: "2026-05-07T00:00:12.000Z" });
	assert.equal(completed.status, "completed");
	assert.equal(completed.completedAt, "2026-05-07T00:00:12.000Z");
	assert.equal("approval" in completed, false);
	assert.equal("permission" in completed, false);
	assert.deepEqual(completed.tasks.map((task) => task.status), ["completed", "completed", "completed"]);
});

test("PlanState complete preserves blocked and skipped tasks while completing active work", async () => {
	const {
		createPlanState,
		revisePlanState,
		completePlanState,
	} = await loadPlanState();
	const state = createPlanState({
		planId: "plan-blocked-complete",
		tasks: ["Confirm scope", "Wait for access", "Already covered", "Run final check"],
		now: "2026-05-07T00:00:00.000Z",
	});

	const revised = revisePlanState(state, {
		changes: [
			{ type: "status", taskId: "plan-blocked-complete-2", status: "blocked" },
			{ type: "status", taskId: "plan-blocked-complete-3", status: "skipped" },
		],
		now: "2026-05-07T00:00:03.000Z",
	});

	const completed = completePlanState(revised, { now: "2026-05-07T00:00:12.000Z" });

	assert.equal(completed.status, "completed");
	assert.deepEqual(completed.tasks.map((task) => task.status), [
		"completed",
		"blocked",
		"skipped",
		"completed",
	]);
	assert.equal(completed.tasks[1]?.completedAt, undefined);
});

test("PlanState supports visible/internal visibility and revision changes with blocked tasks", async () => {
	const {
		createPlanState,
		revisePlanState,
		skipPlanState,
	} = await loadPlanState();
	const visible = createPlanState({
		planId: "plan-visible",
		tasks: ["Gather evidence", "Patch runtime", "Run tests"],
		visibility: "visible",
		now: "2026-05-07T00:00:00.000Z",
	});
	const internal = createPlanState({
		planId: "plan-internal",
		tasks: ["Think through answer"],
		visibility: "internal",
		now: "2026-05-07T00:00:00.000Z",
	});

	assert.equal(visible.visibility, "visible");
	assert.equal(internal.visibility, "internal");

	const revised = revisePlanState(visible, {
		reason: "New evidence changed the route.",
		changes: [
			{ type: "rename", taskId: "plan-visible-1", title: "Confirm evidence" },
			{ type: "status", taskId: "plan-visible-2", status: "blocked" },
			{ type: "add", taskId: "plan-visible-4", title: "Replay skipped branch", status: "pending" },
			{ type: "remove", taskId: "plan-visible-3" },
		],
		now: "2026-05-07T00:00:03.000Z",
	});

	assert.equal(revised.visibility, "visible");
	assert.deepEqual(revised.tasks.map((task) => [task.id, task.title, task.status]), [
		["plan-visible-1", "Confirm evidence", "in_progress"],
		["plan-visible-2", "Patch runtime", "blocked"],
		["plan-visible-4", "Replay skipped branch", "pending"],
	]);
	assert.equal(revised.tasks.filter((task) => task.status === "in_progress").length, 1);

	const skipped = skipPlanState(revised, {
		reason: "No visible plan is needed anymore.",
		now: "2026-05-07T00:00:04.000Z",
	});
	assert.equal(skipped.status, "skipped");
	assert.equal(skipped.completedAt, "2026-05-07T00:00:04.000Z");
	assert.deepEqual(skipped.tasks.map((task) => task.status), ["skipped", "blocked", "skipped"]);
	assert.equal(skipped.tasks[0]?.summary, "No visible plan is needed anymore.");
});
