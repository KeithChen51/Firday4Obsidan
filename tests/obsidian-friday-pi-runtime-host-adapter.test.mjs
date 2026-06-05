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

test("ObsidianFridayPiRuntimeHostAdapter persists PI session state, wrapper traces, package metadata, and policy metadata without changing the result", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({
		turnId: "turn-persist",
		taskId: "task-input-persist",
		traceId: "trace-persist",
		conversationId: "conversation-persist",
	});
	const context = await createContext({
		turnId: "turn-persist",
		taskId: "task-input-persist",
		traceId: "trace-persist",
		conversationId: "conversation-persist",
	});
	const persisted = {
		sessions: [],
		traces: [],
		packages: [],
	};
	const packageRef = {
		packageId: "friday-pi-local-bridge",
		manifestPath: "runtime/pi/packages/friday-pi-local-bridge/manifest.json",
	};
	const workspacePolicy = {
		trustBoundary: "vault",
		vault: { root: "/" },
		activeProject: {
			projectId: "project-1",
			slug: "project",
			name: "Project",
			vaultRoot: "Project",
			absoluteRoot: "C:/Vault/Project",
		},
		externalAccess: "explicit",
		externalWrite: false,
	};
	const trace = {
		runId: "wrapper-run-1",
		step: 1,
		tool: "read",
		scope: "vault",
		targetPath: "Project/workspace/Daily.md",
		approved: true,
		approvalReason: "No approval required",
		persistedRule: false,
		viaRule: false,
		status: "ok",
		ok: true,
		summary: "Read Project/workspace/Daily.md",
	};
	const delegatedResult = {
		turnId: context.turnId,
		taskId: "task-result-persist",
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Delegated persisted answer.",
		events: context.snapshotEvents(),
		traces: [trace],
		rawFinalReply: "Raw delegated persisted answer.",
	};
	const adapter = new ObsidianFridayPiRuntimeHostAdapter(
		() => ({
			async execute() {
				return delegatedResult;
			},
		}),
		{
			stateStore: {
				async writePackageMetadata(metadata) {
					persisted.packages.push(metadata);
					return packageRef;
				},
				async appendSessionTurnRecord(record) {
					persisted.sessions.push(record);
				},
				async appendToolTraceRecords(records) {
					persisted.traces.push(...records);
				},
			},
			workspacePolicyProvider: () => workspacePolicy,
		},
	);
	const runtime = new FridayPiRuntime(adapter);

	const result = await runtime.execute(input, context);

	assert.deepEqual(result, {
		...delegatedResult,
		events: result.events,
		budget: context.budget,
	});
	assert.equal(persisted.packages.length, 1);
	assert.equal(persisted.packages[0].packageId, "friday-pi-local-bridge");
	assert.equal(persisted.sessions.length, 1);
	assert.equal(persisted.sessions[0].sessionId, "conversation-persist");
	assert.equal(persisted.sessions[0].turnId, "turn-persist");
	assert.equal(persisted.sessions[0].taskId, "task-result-persist");
	assert.equal(persisted.sessions[0].traceId, "trace-persist");
	assert.equal(persisted.sessions[0].status, "completed");
	assert.equal(persisted.sessions[0].rawFinalReplyLength, delegatedResult.rawFinalReply.length);
	assert.deepEqual(persisted.sessions[0].packageRef, packageRef);
	assert.deepEqual(persisted.sessions[0].workspacePolicy, workspacePolicy);
	assert.equal(persisted.traces.length, 1);
	assert.equal(persisted.traces[0].kind, "pi_tool_trace");
	assert.equal(persisted.traces[0].sessionId, "conversation-persist");
	assert.equal(persisted.traces[0].turnId, "turn-persist");
	assert.equal(persisted.traces[0].taskId, "task-result-persist");
	assert.equal(persisted.traces[0].runId, "wrapper-run-1");
	assert.equal(persisted.traces[0].workspacePolicy.externalAccess, "explicit");
});

test("ObsidianFridayPiRuntimeHostAdapter swallows PI persistence failures after attempting persistence", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ conversationId: "conversation-persist-failure" });
	const context = await createContext({ conversationId: "conversation-persist-failure" });
	let packageWriteAttempts = 0;
	const delegatedResult = {
		turnId: context.turnId,
		taskId: "task-persist-failure",
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Result survives persistence failure.",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "Result survives persistence failure.",
	};
	const adapter = new ObsidianFridayPiRuntimeHostAdapter(
		() => ({
			async execute() {
				return delegatedResult;
			},
		}),
		{
			stateStore: {
				async writePackageMetadata() {
					packageWriteAttempts += 1;
					throw new Error("Synthetic PI persistence failure.");
				},
				async appendSessionTurnRecord() {
					throw new Error("Should not be reached after package metadata failure.");
				},
				async appendToolTraceRecords() {
					throw new Error("Should not be reached after package metadata failure.");
				},
			},
		},
	);
	const runtime = new FridayPiRuntime(adapter);

	const result = await runtime.execute(input, context);

	assert.equal(packageWriteAttempts, 1);
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, delegatedResult.assistantText);
	assert.equal(result.rawFinalReply, delegatedResult.rawFinalReply);
});
