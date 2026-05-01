/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const taskPanelActionsPath = path.join(projectRoot, "src/views/agentTaskPanelActions.ts");
const jiti = createJiti(import.meta.url);

async function loadTaskPanelActions() {
	return jiti.import(taskPanelActionsPath);
}

function readViewSource() {
	return fs.readFileSync(viewPath, "utf8").replace(/\r\n?/g, "\n");
}

function readStylesSource() {
	return fs.readFileSync(stylesPath, "utf8").replace(/\r\n?/g, "\n");
}

test("daily board renders agent task lifecycle outside plain chat bubbles", async () => {
	const source = readViewSource();
	assert.match(source, /type AgentTaskStatus/);
	assert.match(source, /interface AgentTaskViewState/);
	assert.match(source, /private renderAgentTaskPanel\(/);
	assert.match(source, /friday-agent-task-panel/);
	assert.match(source, /friday-agent-task-status/);
	assert.match(source, /friday-agent-task-summary/);
	assert.match(source, /friday-agent-task-actions/);
	assert.match(source, /waiting_for_approval/);
	assert.match(source, /waiting_for_user/);
	assert.match(source, /failed/);
});

test("daily board exposes retry, cancel, continue, apply, and reject task actions", async () => {
	const source = readViewSource();
	const match = source.match(/private renderAgentTaskPanel\([\s\S]*?\n\t\}\n\n\tprivate renderApprovalMessage/);
	assert.ok(match, "task panel should render before approval messages in the chat stream");
	const block = match[0] ?? "";
	assert.match(block, /taskActions\.retry/);
	assert.match(block, /taskActions\.cancel/);
	assert.match(block, /taskActions\.continue/);
	assert.match(block, /taskActions\.apply/);
	assert.match(block, /taskActions\.reject/);
	assert.match(source, /"Retry"/);
	assert.match(source, /"Cancel"/);
	assert.match(source, /"Continue"/);
	assert.match(source, /"Apply"/);
	assert.match(source, /"Reject"/);
	assert.match(source, /createAgentTaskPanelActionHandlers/);
});

test("agent task UI actions call runtime services and update visible task state", async () => {
	const { createAgentTaskPanelActionHandlers } = await loadTaskPanelActions();
	const calls = [];
	const recorded = [];
	let renderCount = 0;
	let abortCount = 0;
	const runtime = {
		async retryAgentTask(taskId, options) {
			calls.push(["retry", taskId, Boolean(options?.onProgress)]);
			options?.onProgress?.({ phase: "model_request", depth: 0, taskId, message: "retrying" });
			return { task: makeTask(taskId, "completed") };
		},
		async cancelAgentTask(taskId) {
			calls.push(["cancel", taskId]);
			return makeTask(taskId, "cancelled");
		},
		async continueAgentTask(taskId, options) {
			calls.push(["continue", taskId, options?.userPrompt]);
			options?.onProgress?.({ phase: "model_request", depth: 0, taskId, message: "continuing" });
			return { task: makeTask(taskId, "completed") };
		},
		async acceptEditPlan(planId) {
			calls.push(["apply", planId]);
			return "applied";
		},
		async rejectEditPlan(planId) {
			calls.push(["reject", planId]);
		},
		async getAgentTask(taskId) {
			calls.push(["get", taskId]);
			return makeTask(taskId, "waiting_for_user");
		},
	};
	const progressEvents = [];
	const handlers = createAgentTaskPanelActionHandlers("task-1", runtime, {
		abortCurrentRun: () => {
			abortCount += 1;
		},
		getContinuePrompt: () => "additional detail",
		onProgress: (event) => progressEvents.push(event),
		recordAgentTask: (task) => recorded.push(task),
		render: () => {
			renderCount += 1;
		},
	});

	await handlers.retry();
	await handlers.cancel();
	await handlers.continue();
	await handlers.apply("plan-1");
	await handlers.reject("plan-1");

	assert.deepEqual(calls, [
		["retry", "task-1", true],
		["cancel", "task-1"],
		["continue", "task-1", "additional detail"],
		["apply", "plan-1"],
		["get", "task-1"],
		["reject", "plan-1"],
		["get", "task-1"],
	]);
	assert.equal(abortCount, 1);
	assert.equal(renderCount, 5);
	assert.deepEqual(
		recorded.map((task) => task?.status),
		["completed", "cancelled", "completed", "waiting_for_user", "waiting_for_user"],
	);
	assert.deepEqual(progressEvents.map((event) => event.message), ["retrying", "continuing"]);
});

test("runtime progress with task id hydrates the running task before final result", async () => {
	const { recordTaskFromRuntimeProgress } = await loadTaskPanelActions();
	const seenTaskIds = new Set();
	const recorded = [];
	let renderCount = 0;
	let fetchCount = 0;
	const runtime = {
		async getAgentTask(taskId) {
			fetchCount += 1;
			return makeTask(taskId, "running");
		},
	};

	const hydrated = await recordTaskFromRuntimeProgress(
		{ phase: "model_request", depth: 0, taskId: "task-live", message: "thinking" },
		runtime,
		seenTaskIds,
		{
			recordAgentTask: (task) => recorded.push(task),
			render: () => {
				renderCount += 1;
			},
		},
	);
	const duplicate = await recordTaskFromRuntimeProgress(
		{ phase: "tool_call", depth: 0, taskId: "task-live", message: "still thinking" },
		runtime,
		seenTaskIds,
		{
			recordAgentTask: (task) => recorded.push(task),
			render: () => {
				renderCount += 1;
			},
		},
	);

	assert.equal(hydrated?.status, "running");
	assert.equal(duplicate, undefined);
	assert.equal(fetchCount, 1);
	assert.equal(renderCount, 1);
	assert.deepEqual(recorded.map((task) => task?.id), ["task-live"]);
});

test("daily board passes abort signals into runtime turns and hydrates live task progress", async () => {
	const source = readViewSource();

	assert.match(source, /signal:\s*runAbortController\.signal/);
	assert.match(source, /recordTaskFromRuntimeProgress/);
	assert.match(source, /aiRuntimeProgressTaskIds/);
});

test("daily board agent chat does not bypass the orchestrator when tool runtime is disabled", async () => {
	const source = readViewSource();

	assert.doesNotMatch(source, /settings\.agentRuntime\.toolRuntimeEnabled\)\s*\{/);
	assert.doesNotMatch(source, /plugin\.aiService\.chatStream\(modelMessages/);
	assert.doesNotMatch(source, /plugin\.aiService\.chat\(modelMessages/);
});

test("daily board hydrates persisted task panels when loading or switching conversations", async () => {
	const source = readViewSource();

	assert.match(source, /private async hydrateAgentTasksForCurrentSession\(/);
	assert.match(source, /listAgentTasksByConversationId/);
	assert.match(source, /uiMeta\?\.taskId/);
	assert.match(source, /await this\.hydrateAgentTasksForCurrentSession\(\)/);
});

test("agent task panel has stable native-feeling layout classes", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-agent-task-panel\b/);
	assert.match(styles, /\.friday-agent-task-header\b/);
	assert.match(styles, /\.friday-agent-task-status\b/);
	assert.match(styles, /\.friday-agent-task-actions\b/);
	assert.match(styles, /\.friday-agent-task-action\b/);
	const panelBlock = styles.match(/\.friday-agent-task-panel\s*\{[\s\S]*?\}/)?.[0] ?? "";
	assert.ok(panelBlock, "task panel style block should exist");
	assert.doesNotMatch(panelBlock, /position:\s*fixed/);
});

function makeTask(id, status) {
	return {
		id,
		status,
		title: "Knowledge task",
		summary: "Task summary",
		availableActions: [],
		pendingMutationCount: 0,
		changedFileCount: 0,
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-01T00:00:01.000Z",
		conversationId: "soul-1",
		turnId: "turn-1",
		agentId: "soul-1",
	};
}
