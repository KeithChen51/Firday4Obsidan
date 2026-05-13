/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const taskManagerPath = path.join(projectRoot, "src/core/agent-kernel/AgentTaskManager.ts");
const executionContextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");
const taskStorePath = path.join(projectRoot, "src/core/tasks/AgentTaskStore.ts");

async function loadModules() {
	const [managerModule, contextModule, storeModule] = await Promise.all([
		jiti.import(taskManagerPath),
		jiti.import(executionContextPath),
		jiti.import(taskStorePath),
	]);
	return {
		AgentTaskManager: managerModule.AgentTaskManager,
		AgentExecutionContext: contextModule.AgentExecutionContext,
		AgentTaskStore: storeModule.AgentTaskStore,
	};
}

function createContext(AgentExecutionContext) {
	return new AgentExecutionContext({
		turnId: "turn-i-task",
		taskId: "task-i",
		traceId: "trace-i",
		conversationId: "conversation-i",
		agentId: "agent-i",
		mode: "ask",
		budget: { tool: { maxIterations: 4 } },
		startedAt: "2026-05-03T00:00:00.000Z",
	});
}

test("AgentTaskManager creates and completes task lifecycle from AgentExecutionContext.taskId", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore({ now: () => new Date("2026-05-03T00:00:00.000Z") });
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);

	const running = await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-task",
		userPrompt: "Do Batch I",
		conversation: [],
		mode: "ask",
		retryOfTaskId: "task-h",
	}, context);
	const completed = await manager.completeTurn({
		turnId: context.turnId,
		taskId: context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "done",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "done",
	}, context);

	assert.equal(running.id, "task-i");
	assert.equal(completed.id, "task-i");
	assert.equal(context.taskId, "task-i");
	assert.deepEqual((await store.get("task-i")).availableActions, []);

	const taskEvents = context.snapshotEvents().filter((event) => event.type === "task_updated");
	assert.deepEqual(taskEvents.map((event) => event.payload.status), ["created", "running", "completed"]);
	for (const event of taskEvents) {
		assert.equal(event.taskId, "task-i");
		assert.equal(event.traceId, "trace-i");
		assert.equal(event.payload.taskId, "task-i");
	}
});

test("AgentTaskManager ignores late failTurn for a completed task", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore({ now: () => new Date("2026-05-03T00:00:00.000Z") });
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);

	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-task",
		userPrompt: "Create a canvas",
		conversation: [],
		mode: "ask",
	}, context);
	await manager.completeTurn({
		turnId: context.turnId,
		taskId: context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "done",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "done",
	}, context);

	const afterLateFailure = await manager.failTurn(new Error("late replay persistence failure"), context);
	const persisted = await store.get("task-i");

	assert.equal(afterLateFailure?.status, "completed");
	assert.equal(persisted?.status, "completed");
	const taskEvents = context.snapshotEvents().filter((event) => event.type === "task_updated");
	assert.deepEqual(taskEvents.map((event) => event.payload.status), ["created", "running", "completed"]);
});

test("AgentTaskManager re-emits an externally cancelled task during failTurn", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore({ now: () => new Date("2026-05-03T00:00:00.000Z") });
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);

	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-task",
		userPrompt: "Create a canvas",
		conversation: [],
		mode: "ask",
	}, context);
	await store.cancelTask("task-i", {
		summary: "User cancelled task.",
		failureReason: "User cancelled task.",
	});

	const afterLateFailure = await manager.failTurn(new Error("Task cancelled."), context);

	assert.equal(afterLateFailure?.status, "cancelled");
	const taskEvents = context.snapshotEvents().filter((event) => event.type === "task_updated");
	assert.deepEqual(taskEvents.map((event) => event.payload.status), ["created", "running", "cancelled"]);
});

test("AgentTaskManager marks pending mutations as approval wait without string-only inference", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore();
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);

	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-task",
		userPrompt: "Plan an edit",
		conversation: [],
		mode: "ask",
	}, context);
	const waiting = await manager.completeTurn({
		turnId: context.turnId,
		taskId: context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Mutation prepared.",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "Mutation prepared.",
		pendingMutations: [{ id: "mutation-i", operation: "write", targetPath: "Note.md", status: "pending" }],
	}, context);

	assert.equal(waiting.status, "waiting_for_approval");
	assert.equal(waiting.waitingForApproval.kind, "mutation");
	assert.equal(waiting.waitingForApproval.mutationPlanIds[0], "mutation-i");
	assert.equal(waiting.pendingMutationCount, 1);
	assert.equal(context.snapshotEvents().at(-1).payload.status, "waiting_for_approval");
});

test("AgentTaskManager records loop-control safe stops without maximum-iteration wording", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore({ now: () => new Date("2026-05-03T00:00:00.000Z") });
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);
	const assistantText = "FRIDAY 重复检查了相同内容，没有获得新信息，已暂停本轮操作。你可以换一个更具体的范围，或让 FRIDAY 基于已读内容直接总结。";

	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-task",
		userPrompt: "Read everything",
		conversation: [],
		mode: "ask",
	}, context);
	const failed = await manager.completeTurn({
		turnId: context.turnId,
		taskId: context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "safe_stopped",
		assistantText,
		events: [{
			type: "loop_control_stop",
			turnId: context.turnId,
			traceId: context.traceId,
			conversationId: context.conversationId,
			agentId: context.agentId,
			at: "2026-05-03T00:00:00.000Z",
			status: "safe_stopped",
			payload: { reason: "no_progress", status: "safe_stopped" },
		}],
		traces: [],
		rawFinalReply: "",
	}, context);

	assert.equal(failed.status, "failed");
	assert.equal(failed.summary, assistantText);
	assert.equal(failed.failureReason, assistantText);
	assert.equal(failed.summary.includes("maximum tool iteration"), false);
	assert.equal(failed.summary.includes("最大工具"), false);
});
