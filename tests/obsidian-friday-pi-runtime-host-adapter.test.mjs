/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const runtimePath = path.join(projectRoot, "src/core/agent-kernel/pi/FridayPiRuntime.ts");
const adapterPath = path.join(projectRoot, "src/services/ObsidianFridayPiRuntimeHostAdapter.ts");
const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

const terminalEventTypes = new Set(["turn_completed", "turn_failed", "turn_cancelled"]);

function createInput(overrides = {}) {
	const progress = [];
	return {
		input: {
			turnId: "turn-host",
			taskId: "task-host-input",
			traceId: "trace-host",
			conversationId: "conversation-host",
			agentId: "agent-host",
			conversation: [],
			userPrompt: "delegate through the host bridge",
			mode: "ask",
			onProgress: (event) => progress.push(event),
			...overrides,
		},
		progress,
	};
}

async function createContext(overrides = {}) {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	return new AgentExecutionContext({
		turnId: "turn-host",
		taskId: "task-host-input",
		traceId: "trace-host",
		conversationId: "conversation-host",
		agentId: "agent-host",
		mode: "ask",
		...overrides,
	});
}

test("ObsidianFridayPiRuntimeHostAdapter exposes delegated host results through FridayPiRuntime", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const budget = {
		token: { used: 12, softLimit: 100, hardLimit: 200 },
		tool: { usedIterations: 1, maxIterations: 3 },
	};
	const { input, progress } = createInput({ budget });
	const context = await createContext({ budget });
	const trace = {
		runId: "host-run-1",
		step: 1,
		tool: "read",
		scope: "vault",
		targetPath: "Daily.md",
		approved: true,
		approvalReason: "No approval required",
		persistedRule: false,
		viaRule: false,
		status: "ok",
		ok: true,
		summary: "Read Daily.md",
	};
	const pendingMutations = [{
		id: "mutation-host-1",
		operation: "edit",
		targetPath: "Daily.md",
		summary: "Edit Daily.md",
		status: "pending",
	}];
	const task = {
		id: "task-host-result",
		status: "completed",
		conversationId: input.conversationId,
		turnId: input.turnId,
		agentId: input.agentId,
	};
	const contextSummary = {
		used: 42,
		softLimit: 100,
		hardLimit: 200,
		trimmedChannels: ["memory"],
		hasWikiContext: false,
		hasMemoryContext: true,
		hasAutoSkillContext: false,
		hasMentionContext: false,
		mentionResolvedCount: 0,
		mentionTokenTypes: [],
		mentionSourceMap: [],
	};
	const stepTraces = [{ type: "step_started", step: 1, at: "2026-06-05T00:00:00.000Z" }];
	let executeCount = 0;

	const adapter = new ObsidianFridayPiRuntimeHostAdapter(() => ({
		async execute(executeInput, executeContext) {
			executeCount += 1;
			assert.equal(executeInput, input);
			assert.equal(executeContext, context);
			executeContext.emit({
				type: "model_response",
				payload: { source: "host", text: "Host side event." },
			});
			return {
				turnId: context.turnId,
				taskId: task.id,
				traceId: context.traceId,
				conversationId: context.conversationId,
				status: "completed",
				assistantText: "Delegated host answer.",
				events: executeContext.snapshotEvents(),
				traces: [trace],
				rawFinalReply: "Raw delegated host reply.",
				budget,
				pendingMutations,
				task,
				stepTraces,
				runtimeProfile: { id: "unit-test-profile", supported: true },
				contextSummary,
			};
		},
	}));
	const runtime = new FridayPiRuntime(adapter);

	const result = await runtime.execute(input, context);

	assert.equal(executeCount, 1);
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Delegated host answer.");
	assert.equal(result.rawFinalReply, "Raw delegated host reply.");
	assert.equal(result.taskId, task.id);
	assert.equal(result.traceId, context.traceId);
	assert.deepEqual(result.budget, budget);
	assert.deepEqual(result.traces, [trace]);
	assert.deepEqual(result.pendingMutations, pendingMutations);
	assert.deepEqual(result.task, task);
	assert.deepEqual(result.stepTraces, stepTraces);
	assert.deepEqual(result.runtimeProfile, { id: "unit-test-profile", supported: true });
	assert.deepEqual(result.contextSummary, contextSummary);
	assert.equal(result.events.filter((event) => terminalEventTypes.has(event.type)).length, 0);
	assert.ok(
		result.events.some((event) =>
			event.type === "model_response" &&
			event.payload?.source === "pi_host_bridge" &&
			event.payload?.status === "completed"
		),
		"PI host bridge should record a non-terminal progress event",
	);
	assert.ok(
		progress.some((event) =>
			event.phase === "done" &&
			event.message === "PI host bridge completed."
		),
		"PI host bridge should emit a progress shape for the delegated result",
	);
});

test("ObsidianFridayPiRuntimeHostAdapter preserves delegated host failures without terminal turn events", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput();
	const context = await createContext();
	const failure = {
		category: "unknown",
		code: "host_failure",
		retryable: false,
		userMessage: "Host runtime failed.",
		technicalMessage: "Synthetic host failure.",
	};

	const adapter = new ObsidianFridayPiRuntimeHostAdapter(() => ({
		async execute(_executeInput, executeContext) {
			return {
				turnId: executeContext.turnId,
				taskId: "task-host-failed",
				traceId: executeContext.traceId,
				conversationId: executeContext.conversationId,
				status: "failed",
				assistantText: "Host failure text.",
				events: executeContext.snapshotEvents(),
				traces: [],
				rawFinalReply: "Raw host failure.",
				failure,
				parseError: "Synthetic parse error.",
			};
		},
	}));
	const runtime = new FridayPiRuntime(adapter);

	const result = await runtime.execute(input, context);

	assert.equal(result.status, "failed");
	assert.equal(result.assistantText, "Host failure text.");
	assert.equal(result.rawFinalReply, "Raw host failure.");
	assert.equal(result.taskId, "task-host-failed");
	assert.deepEqual(result.failure, failure);
	assert.equal(result.parseError, "Synthetic parse error.");
	assert.equal(result.events.filter((event) => terminalEventTypes.has(event.type)).length, 0);
	assert.ok(
		result.events.some((event) =>
			event.type === "model_response" &&
			event.payload?.source === "pi_host_bridge" &&
			event.payload?.status === "failed"
		),
		"PI host bridge failure should stay non-terminal until AgentKernel wraps it",
	);
});
