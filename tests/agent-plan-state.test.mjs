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
