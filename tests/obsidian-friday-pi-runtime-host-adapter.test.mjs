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

async function waitFor(predicate, message, timeoutMs = 100) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	assert.fail(message);
}

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
			assert.notEqual(executeContext, context);
			assert.equal(executeContext.turnId, context.turnId);
			assert.equal(executeContext.taskId, context.taskId);
			assert.equal(executeContext.traceId, context.traceId);
			assert.equal(executeContext.conversationId, context.conversationId);
			assert.equal(executeContext.agentId, context.agentId);
			assert.equal(executeContext.mode, context.mode);
			assert.deepEqual(executeContext.budget, context.budget);
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

test("ObsidianFridayPiRuntimeHostAdapter reports PI persistence failures diagnostically without changing the result", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ conversationId: "conversation-persist-failure" });
	const context = await createContext({ conversationId: "conversation-persist-failure" });
	let packageWriteAttempts = 0;
	const originalWarn = console.warn;
	const warnings = [];
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

	let result;
	console.warn = (...args) => warnings.push(args);
	try {
		result = await runtime.execute(input, context);
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(packageWriteAttempts, 1);
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, delegatedResult.assistantText);
	assert.equal(result.rawFinalReply, delegatedResult.rawFinalReply);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0][0], "[Friday] PI runtime persistence failed.");
	assert.deepEqual(warnings[0][1], {
		turnId: context.turnId,
		conversationId: context.conversationId,
		taskId: "task-persist-failure",
		traceId: context.traceId,
	});
	assert.equal(warnings[0][2] instanceof Error, true);
	assert.match(warnings[0][2].message, /Synthetic PI persistence failure/);
});

test("ObsidianFridayPiRuntimeHostAdapter settles host results before slow PI persistence can trip the terminal timeout", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({
		turnId: "turn-slow-persist",
		taskId: "task-slow-persist",
		traceId: "trace-slow-persist",
		conversationId: "conversation-slow-persist",
	});
	const context = await createContext({
		turnId: "turn-slow-persist",
		taskId: "task-slow-persist",
		traceId: "trace-slow-persist",
		conversationId: "conversation-slow-persist",
	});
	const packageRef = {
		packageId: "friday-pi-local-bridge",
		manifestPath: "runtime/pi/packages/friday-pi-local-bridge/manifest.json",
	};
	const delegatedResult = {
		turnId: context.turnId,
		taskId: "task-result-slow-persist",
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Slow persistence must not delay the terminal result.",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "Slow persistence must not delay the terminal result.",
	};
	let markPackageWriteStarted;
	const packageWriteStarted = new Promise((resolve) => {
		markPackageWriteStarted = resolve;
	});
	let releasePackageWrite;
	const packageWriteReleased = new Promise((resolve) => {
		releasePackageWrite = resolve;
	});
	let packageWriteCompleted = false;
	const persisted = {
		sessions: [],
		traces: [],
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
					markPackageWriteStarted();
					await packageWriteReleased;
					packageWriteCompleted = true;
					return packageRef;
				},
				async appendSessionTurnRecord(record) {
					persisted.sessions.push(record);
				},
				async appendToolTraceRecords(records) {
					persisted.traces.push(...records);
				},
			},
		},
	);
	const runtime = new FridayPiRuntime(
		adapter,
		undefined,
		{ terminalEventTimeoutMs: 5, cancelledPromptGraceMs: 0 },
	);

	const resultPromise = runtime.execute(input, context);
	try {
		await packageWriteStarted;
		const result = await resultPromise;

		assert.equal(result.status, "completed");
		assert.equal(result.assistantText, delegatedResult.assistantText);
		assert.equal(packageWriteCompleted, false, "runtime result should not wait for slow PI persistence");
	} finally {
		releasePackageWrite();
		await resultPromise.catch(() => undefined);
	}

	await waitFor(() => packageWriteCompleted, "slow PI persistence did not finish after being released");
	await waitFor(() => persisted.sessions.length === 1, "slow PI session record was not persisted after release");
	assert.equal(persisted.sessions[0].turnId, context.turnId);
	assert.equal(persisted.traces.length, 0);
});

test("ObsidianFridayPiRuntimeHostAdapter aborts delegated host turns and suppresses late persistence after PI timeout", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { ObsidianFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({
		turnId: "turn-timeout-abort",
		taskId: "task-timeout-abort",
		traceId: "trace-timeout-abort",
		conversationId: "conversation-timeout-abort",
	});
	const context = await createContext({
		turnId: "turn-timeout-abort",
		taskId: "task-timeout-abort",
		traceId: "trace-timeout-abort",
		conversationId: "conversation-timeout-abort",
	});
	let executeContext;
	let resolveDelegatedResult;
	let delegatedStarted;
	const delegatedStartedPromise = new Promise((resolve) => {
		delegatedStarted = resolve;
	});
	let persistedAfterTimeout = false;
	let markPersistenceAttempt;
	const persistenceAttempted = new Promise((resolve) => {
		markPersistenceAttempt = resolve;
	});
	const delegatedResultPromise = new Promise((resolve) => {
		resolveDelegatedResult = () => resolve({
			turnId: context.turnId,
			taskId: "task-late-timeout-abort",
			traceId: context.traceId,
			conversationId: context.conversationId,
			status: "completed",
			assistantText: "Late delegated result.",
			events: executeContext.snapshotEvents(),
			traces: [],
			rawFinalReply: "Late delegated result.",
		});
	});
	const adapter = new ObsidianFridayPiRuntimeHostAdapter(
		() => ({
			async execute(_executeInput, delegatedContext) {
				executeContext = delegatedContext;
				delegatedStarted();
				return delegatedResultPromise;
			},
		}),
		{
			stateStore: {
				async writePackageMetadata(metadata) {
					return {
						packageId: metadata.packageId,
						manifestPath: "runtime/pi/packages/friday-pi-local-bridge/manifest.json",
					};
				},
				async appendSessionTurnRecord() {
					persistedAfterTimeout = true;
					markPersistenceAttempt();
				},
				async appendToolTraceRecords() {},
			},
		},
	);
	const runtime = new FridayPiRuntime(
		adapter,
		undefined,
		{ terminalEventTimeoutMs: 5, cancelledPromptGraceMs: 0 },
	);

	const resultPromise = runtime.execute(input, context);
	await delegatedStartedPromise;
	const result = await resultPromise;

	assert.equal(result.status, "failed");
	assert.equal(context.isCancelled(), false, "PI timeout should not cancel the outer user turn context");
	assert.equal(executeContext.isCancelled(), true, "PI timeout must abort the delegated host context");

	resolveDelegatedResult();
	const latePersistence = await Promise.race([
		persistenceAttempted.then(() => "persisted"),
		new Promise((resolve) => setTimeout(() => resolve("not-persisted"), 30)),
	]);

	assert.equal(latePersistence, "not-persisted");
	assert.equal(persistedAfterTimeout, false);
});
