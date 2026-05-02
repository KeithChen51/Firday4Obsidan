/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const adapterPath = path.join(projectRoot, "src/services/LegacyAgentRuntimeAdapter.ts");
const orchestratorPath = path.join(projectRoot, "src/core/execution/ExecutionOrchestrator.ts");

test("AgentKernel routes turns through RuntimeTurnExecutorPort with an execution context", async () => {
	const { AgentKernel, AgentRuntimeFacade } = await jiti.import(kernelPath);
	const calls = [];
	const executor = {
		async execute(input, context) {
			calls.push({ input, context });
			return {
				turnId: context.turnId,
				conversationId: context.conversationId,
				status: "completed",
				assistantText: "kernel routed",
				events: context.snapshotEvents(),
				traces: [],
				rawFinalReply: "kernel routed",
			};
		},
	};

	const facade = new AgentRuntimeFacade(new AgentKernel(executor));
	const result = await facade.runTurn({
		agentId: "agent",
		conversationId: "conversation",
		conversation: [],
		userPrompt: "route this turn",
		agentMode: "research",
	});

	assert.equal(result.assistantText, "kernel routed");
	assert.deepEqual(calls.map((call) => call.input.userPrompt), ["route this turn"]);
	assert.equal(calls[0].context.conversationId, "conversation");
	assert.equal(calls[0].context.agentId, "agent");
	assert.equal(calls[0].context.mode, "research");
	assert.deepEqual(result.events.map((event) => event.type), ["turn_started", "turn_completed"]);
});

test("AgentKernel classifies thrown executor failures and emits terminal events", async () => {
	const { AgentKernel } = await jiti.import(kernelPath);
	const kernel = new AgentKernel({
		async execute() {
			throw new Error("504 Gateway Timeout from model gateway");
		},
	});

	const result = await kernel.runTurn({
		conversationId: "conversation",
		agentId: "agent",
		conversation: [],
		userPrompt: "fail this turn",
		mode: "ask",
	});

	assert.equal(result.status, "failed");
	assert.equal(result.failure.category, "model_transport");
	assert.deepEqual(result.events.map((event) => event.type), ["turn_started", "turn_failed"]);
});

test("AgentKernel turns pre-aborted input into a cancelled result without executing the port", async () => {
	const { AgentKernel } = await jiti.import(kernelPath);
	let executed = false;
	const controller = new AbortController();
	controller.abort("already cancelled");
	const kernel = new AgentKernel({
		async execute() {
			executed = true;
			throw new Error("must not execute");
		},
	});

	const result = await kernel.runTurn({
		conversationId: "conversation",
		agentId: "agent",
		conversation: [],
		userPrompt: "cancel this turn",
		mode: "ask",
		signal: controller.signal,
	});

	assert.equal(executed, false);
	assert.equal(result.status, "cancelled");
	assert.equal(result.failure.category, "cancelled");
	assert.deepEqual(result.events.map((event) => event.type), ["turn_started", "turn_cancelled"]);
});

test("LegacyAgentRuntimeAdapter maps legacy runtime results without dropping task traces mutations or signal", async () => {
	const { LegacyAgentRuntimeAdapter } = await jiti.import(adapterPath);
	const { AgentExecutionContext } = await jiti.import(path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts"));
	const legacyInputs = [];
	const legacyRuntime = {
		async runTurn(input) {
			legacyInputs.push(input);
			return {
				turnId: "legacy-turn",
				assistantText: "legacy result",
				rawFinalReply: "legacy raw",
				traces: [{ tool: "read", ok: true, status: "ok", summary: "read ok" }],
				pendingMutations: [{ id: "mutation-1", status: "pending", targetPath: "Project/a.md" }],
				task: { id: "task-1", status: "completed" },
				parseError: "legacy parse metadata",
			};
		},
	};
	const context = new AgentExecutionContext({
		turnId: "kernel-turn",
		conversationId: "conversation",
		agentId: "agent",
		mode: "write",
	});
	const adapter = new LegacyAgentRuntimeAdapter(legacyRuntime);

	const result = await adapter.execute(
		{
			turnId: "kernel-turn",
			conversationId: "conversation",
			agentId: "agent",
			conversation: [],
			userPrompt: "adapt this turn",
			mode: "write",
			allowedTools: ["read"],
		},
		context,
	);

	assert.equal(legacyInputs[0].turnId, "kernel-turn");
	assert.equal(legacyInputs[0].conversationId, "conversation");
	assert.equal(legacyInputs[0].agentMode, "write");
	assert.equal(legacyInputs[0].signal, context.signal);
	assert.equal(result.turnId, "legacy-turn");
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "legacy result");
	assert.equal(result.rawFinalReply, "legacy raw");
	assert.equal(result.traces[0].tool, "read");
	assert.equal(result.pendingMutations[0].id, "mutation-1");
	assert.equal(result.task.id, "task-1");
	assert.equal(result.parseError, "legacy parse metadata");
});

test("ExecutionOrchestrator depends on the runtime facade instead of the legacy runtime service", () => {
	const source = fs.readFileSync(orchestratorPath, "utf8");
	assert.match(source, /AgentRuntimeFacade/);
	assert.doesNotMatch(source, /AgentRuntimeService/);
	assert.doesNotMatch(source, /agentRuntimeService\.runTurn/);
});
