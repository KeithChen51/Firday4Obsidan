/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const taskManagerPath = path.join(projectRoot, "src/core/agent-kernel/AgentTaskManager.ts");
const resumeControllerPath = path.join(projectRoot, "src/core/agent-kernel/AgentResumeController.ts");
const executionContextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");
const taskStorePath = path.join(projectRoot, "src/core/tasks/AgentTaskStore.ts");
const obsidianRuntimePortsPath = path.join(projectRoot, "src/services/ObsidianKernelRuntimePorts.ts");
const runtimeServicePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

async function loadModules() {
	const [taskManagerModule, resumeModule, contextModule, storeModule] = await Promise.all([
		jiti.import(taskManagerPath),
		jiti.import(resumeControllerPath),
		jiti.import(executionContextPath),
		jiti.import(taskStorePath),
	]);
	return {
		AgentTaskManager: taskManagerModule.AgentTaskManager,
		AgentResumeController: resumeModule.AgentResumeController,
		AgentExecutionContext: contextModule.AgentExecutionContext,
		AgentTaskStore: storeModule.AgentTaskStore,
	};
}

function createContext(AgentExecutionContext, taskId = "task-i", turnId = "turn-i-approval", traceId = "trace-i") {
	return new AgentExecutionContext({
		turnId,
		taskId,
		traceId,
		conversationId: "conversation-i",
		agentId: "agent-i",
		mode: "ask",
	});
}

test("approval pause and resume are Kernel task transitions and events", async () => {
	const { AgentTaskManager, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore();
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);

	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-approval",
		userPrompt: "Write a note",
		conversation: [],
		mode: "ask",
	}, context);
	const waiting = await manager.requestApproval(context, {
		kind: "tool",
		tool: "write",
		targetPath: "Note.md",
		summary: "Approve write.",
	});
	const running = await manager.resolveApproval(context, {
		tool: "write",
		approved: true,
		reason: "User allowed write.",
	});

	assert.equal(waiting.status, "waiting_for_approval");
	assert.equal(running.status, "running");
	const eventTypes = context.snapshotEvents().map((event) => event.type);
	assert.deepEqual(eventTypes.filter((type) => type.startsWith("approval_")), [
		"approval_requested",
		"approval_resolved",
	]);
	for (const event of context.snapshotEvents().filter((item) => item.type.startsWith("approval_"))) {
		assert.equal(event.taskId, "task-i");
		assert.equal(event.traceId, "trace-i");
	}
});

test("AgentResumeController retries and continues from recorded kernel task input", async () => {
	const { AgentTaskManager, AgentResumeController, AgentExecutionContext, AgentTaskStore } = await loadModules();
	const store = new AgentTaskStore();
	const manager = new AgentTaskManager({ taskStore: store });
	const context = createContext(AgentExecutionContext);
	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-approval",
		userPrompt: "Original prompt",
		conversation: [],
		mode: "ask",
		modelOverride: "model-i",
	}, context);
	await manager.failTurn(new Error("model failed"), context);
	const resume = new AgentResumeController({
		taskManager: manager,
		runTurn: async (input) => ({
			turnId: input.turnId ?? "retry-turn",
			taskId: input.taskId,
			traceId: input.traceId,
			conversationId: input.conversationId ?? input.agentId,
			status: "completed",
			assistantText: input.userPrompt,
			events: [],
			traces: [],
			rawFinalReply: input.userPrompt,
		}),
	});

	const retry = await resume.retryTask("task-i", { traceId: "trace-retry" });
	const waitingContext = createContext(AgentExecutionContext, "task-wait", "turn-i-wait", "trace-wait");
	await manager.beginTurn({
		agentId: "agent-i",
		conversationId: "conversation-i",
		turnId: "turn-i-wait",
		userPrompt: "Original prompt",
		conversation: [],
		mode: "ask",
		modelOverride: "model-i",
	}, waitingContext);
	const waiting = await manager.requestUserInput(waitingContext, {
		prompt: "Need details.",
		summary: "Waiting for details.",
	});
	const continued = await resume.continueTask(waiting.id, {
		traceId: "trace-continue",
		userPrompt: "More details",
	});

	assert.equal(retry.input.retryOfTaskId, "task-i");
	assert.equal(retry.input.traceId, "trace-retry");
	assert.equal(retry.result.assistantText, "Original prompt");
	assert.equal(continued.input.continueFromTaskId, "task-wait");
	assert.match(continued.input.userPrompt, /User continuation: More details/);
	assert.equal(continued.result.traceId, "trace-continue");
});

test("default Obsidian kernel path uses Kernel state components instead of legacy runtime state helpers", () => {
	const portsSource = fs.readFileSync(obsidianRuntimePortsPath, "utf8");
	const runtimeSource = fs.readFileSync(runtimeServicePath, "utf8");
	const retryBlock = runtimeSource.match(/async retryAgentTask[\s\S]*?\n\t\}/)?.[0] ?? "";
	const continueBlock = runtimeSource.match(/async continueAgentTask[\s\S]*?\n\t\}/)?.[0] ?? "";

	assert.match(portsSource, /getAgentStateAdapter\(\)/);
	assert.match(portsSource, /stateAdapter\.beginTurn/);
	assert.match(portsSource, /stateAdapter\.completeTurn/);
	assert.match(portsSource, /stateAdapter\.failTurn/);
	assert.match(portsSource, /stateAdapter\.recordMutationPlansFromEnvelope/);
	assert.doesNotMatch(portsSource, /runtime\.recordMutationPlansFromEnvelope/);
	assert.doesNotMatch(portsSource, /recordMutationPlansFromEnvelope\(envelope:/);
	assert.doesNotMatch(portsSource, /startAgentTaskForTurn\(/);
	assert.doesNotMatch(portsSource, /finalizeTurnResult\(/);
	assert.doesNotMatch(portsSource, /persistTurnEvents\(/);
	assert.doesNotMatch(portsSource, /markActiveTaskFailure\(/);
	assert.doesNotMatch(retryBlock, /this\.runTurn\(/);
	assert.doesNotMatch(continueBlock, /this\.runTurn\(/);
});
