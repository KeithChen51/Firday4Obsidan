/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const stateAdapterPath = path.join(projectRoot, "src/services/ObsidianAgentStateAdapter.ts");
const executionContextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");
const taskStorePath = path.join(projectRoot, "src/core/tasks/AgentTaskStore.ts");

async function loadModules() {
	const [adapterModule, contextModule, storeModule] = await Promise.all([
		jiti.import(stateAdapterPath),
		jiti.import(executionContextPath),
		jiti.import(taskStorePath),
	]);
	return {
		ObsidianAgentStateAdapter: adapterModule.ObsidianAgentStateAdapter,
		AgentExecutionContext: contextModule.AgentExecutionContext,
		AgentTaskStore: storeModule.AgentTaskStore,
	};
}

function createContext(AgentExecutionContext) {
	return new AgentExecutionContext({
		turnId: "turn-state-adapter",
		taskId: "task-state-adapter",
		traceId: "trace-state-adapter",
		conversationId: "conversation-state-adapter",
		agentId: "agent-state-adapter",
		mode: "ask",
		startedAt: "2026-05-12T00:00:00.000Z",
	});
}

function createInput(context) {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		turnId: context.turnId,
		userPrompt: "Create a canvas",
		conversation: [],
		mode: "ask",
	};
}

function createAdapter(ObsidianAgentStateAdapter, AgentTaskStore, overrides = {}) {
	const taskStore = overrides.taskStore ?? new AgentTaskStore({ now: () => new Date("2026-05-12T00:00:00.000Z") });
	const eventRecords = [];
	const eventLog = overrides.eventLog ?? {
		async appendMany(_ref, events) {
			eventRecords.push(...events);
			return events.map((event, index) => ({
				conversationId: "conversation-state-adapter",
				turnId: "turn-state-adapter",
				taskId: "task-state-adapter",
				sequence: index + 1,
				at: "2026-05-12T00:00:00.000Z",
				...event,
				payload: event.payload ?? {},
			}));
		},
	};
	const adapter = new ObsidianAgentStateAdapter({
		taskStore,
		checkpointStore: {
			async save() {},
			async get() { return null; },
			async getLatestForTask() { return null; },
			async markConsumed() {},
		},
		eventLog,
		mutationStore: {},
		workbenchStateStore: {
			getEditPlans() { return []; },
			recordEditPlan() {},
		},
		async runTurn() {
			throw new Error("runTurn should not be called");
		},
	});
	return { adapter, taskStore, eventRecords };
}

function completedResult(context) {
	return {
		turnId: context.turnId,
		taskId: context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "已完成。",
		rawFinalReply: "已完成。",
		traces: [],
		events: context.snapshotEvents(),
	};
}

test("ObsidianAgentStateAdapter returns completed output when replay recording fails after completion", async () => {
	const { ObsidianAgentStateAdapter, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const context = createContext(AgentExecutionContext);
	const input = createInput(context);
	const { adapter, taskStore } = createAdapter(ObsidianAgentStateAdapter, AgentTaskStore, {
		eventLog: {
			async appendMany() {
				throw new Error("replay disk unavailable");
			},
		},
	});

	await adapter.beginTurn(input, context);
	const output = await adapter.completeTurn(input, context, completedResult(context));
	const persisted = await taskStore.get(context.taskId);

	assert.equal(output.status, "completed");
	assert.equal(output.task?.status, "completed");
	assert.equal(persisted?.status, "completed");
});

test("ObsidianAgentStateAdapter does not record a failed turn for a completed task", async () => {
	const { ObsidianAgentStateAdapter, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const context = createContext(AgentExecutionContext);
	const input = createInput(context);
	const { adapter, eventRecords } = createAdapter(ObsidianAgentStateAdapter, AgentTaskStore);

	await adapter.beginTurn(input, context);
	await adapter.completeTurn(input, context, completedResult(context));
	await adapter.failTurn(new Error("late persistence failure"), context);

	assert.equal(eventRecords.some((event) => event.type === "turn_failed"), false);
	assert.equal(eventRecords.some((event) => event.type === "model_failed"), false);
});
