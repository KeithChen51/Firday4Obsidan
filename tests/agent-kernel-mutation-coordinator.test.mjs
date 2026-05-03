/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const coordinatorPath = path.join(projectRoot, "src/core/agent-kernel/AgentMutationCoordinator.ts");
const executionContextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");
const mutationStorePath = path.join(projectRoot, "src/core/mutations/MutationPlanStore.ts");

async function loadModules() {
	const [coordinatorModule, contextModule, storeModule] = await Promise.all([
		jiti.import(coordinatorPath),
		jiti.import(executionContextPath),
		jiti.import(mutationStorePath),
	]);
	return {
		AgentMutationCoordinator: coordinatorModule.AgentMutationCoordinator,
		AgentExecutionContext: contextModule.AgentExecutionContext,
		MutationPlanStore: storeModule.MutationPlanStore,
	};
}

function createContext(AgentExecutionContext) {
	return new AgentExecutionContext({
		turnId: "turn-i-mutation",
		taskId: "task-i",
		traceId: "trace-i",
		conversationId: "conversation-i",
		agentId: "agent-i",
		mode: "ask",
	});
}

test("AgentMutationCoordinator creates review-first mutation plans bound to taskId and traceId", async () => {
	const { AgentMutationCoordinator, AgentExecutionContext, MutationPlanStore } = await loadModules();
	const store = new MutationPlanStore();
	const coordinator = new AgentMutationCoordinator({ mutationStore: store });
	const context = createContext(AgentExecutionContext);

	const plan = await coordinator.createPlan(context, {
		id: "mutation-i",
		operation: "write",
		targetPath: "Note.md",
		before: "",
		after: "hello",
		summary: "write Note.md",
		toolCallId: "tool-i",
	});
	const stored = await store.get("mutation-i");

	assert.equal(plan.status, "pending");
	assert.equal(plan.taskId, "task-i");
	assert.equal(plan.traceId, "trace-i");
	assert.equal(stored.taskId, "task-i");
	assert.equal(stored.traceId, "trace-i");
	const event = context.snapshotEvents().find((item) => item.type === "mutation_planned");
	assert.equal(event.taskId, "task-i");
	assert.equal(event.traceId, "trace-i");
	assert.equal(event.payload.id, "mutation-i");
	assert.equal(event.payload.status, "pending");
});

test("AgentMutationCoordinator applies and rejects through Kernel events", async () => {
	const { AgentMutationCoordinator, AgentExecutionContext, MutationPlanStore } = await loadModules();
	const store = new MutationPlanStore();
	const coordinator = new AgentMutationCoordinator({ mutationStore: store });
	const context = createContext(AgentExecutionContext);
	await coordinator.createPlan(context, {
		id: "mutation-i",
		operation: "write",
		targetPath: "Note.md",
		before: "",
		after: "hello",
		summary: "write Note.md",
	});

	const applied = await coordinator.markApplied(context, "mutation-i", "Applied by test.");
	await coordinator.createPlan(context, {
		id: "mutation-reject",
		operation: "delete",
		targetPath: "Old.md",
		before: "old",
		after: "",
		summary: "delete Old.md",
	});
	const rejected = await coordinator.rejectPlan(context, "mutation-reject", "Rejected by test.");

	assert.equal(applied.status, "applied");
	assert.equal(rejected.status, "rejected");
	const eventTypes = context.snapshotEvents().map((event) => event.type);
	assert.equal(eventTypes.includes("mutation_applied"), true);
	assert.equal(eventTypes.includes("mutation_rejected"), true);
	for (const event of context.snapshotEvents().filter((item) => item.type.startsWith("mutation_"))) {
		assert.equal(event.taskId, "task-i");
		assert.equal(event.traceId, "trace-i");
	}
});
