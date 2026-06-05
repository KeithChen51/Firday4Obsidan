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
const adapterPath = path.join(projectRoot, "src/services/PersistedFridayPiSessionHostAdapter.ts");
const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

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
	return {
		turnId: "turn-persisted-host",
		taskId: "task-persisted-host",
		traceId: "trace-persisted-host",
		conversationId: "conversation-persisted-host",
		agentId: "agent-persisted-host",
		conversation: [],
		userPrompt: "run persisted PI host",
		mode: "ask",
		...overrides,
	};
}

async function createContext(overrides = {}) {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	return new AgentExecutionContext({
		turnId: "turn-persisted-host",
		taskId: "task-persisted-host",
		traceId: "trace-persisted-host",
		conversationId: "conversation-persisted-host",
		agentId: "agent-persisted-host",
		mode: "ask",
		...overrides,
	});
}

class HostResultSession {
	constructor(result) {
		this.result = result;
		this.listeners = new Set();
		this.promptInputs = [];
		this.disposed = false;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text) {
		this.promptInputs.push(text);
		for (const listener of [...this.listeners]) {
			listener({
				type: "host_result",
				result: this.result,
				summary: "Persisted host completed.",
			});
		}
	}

	dispose() {
		this.disposed = true;
	}
}

test("PersistedFridayPiSessionHostAdapter persists session package policy and tool traces without changing the result", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { PersistedFridayPiSessionHostAdapter, FRIDAY_PI_REAL_SDK_PACKAGE_METADATA } = await jiti.import(adapterPath);
	const input = createInput();
	const context = await createContext();
	const trace = {
		runId: "real-pi-run-1",
		step: 1,
		tool: "read",
		scope: "vault",
		targetPath: "Project/workspace/a.md",
		approved: false,
		approvalReason: "",
		persistedRule: false,
		viaRule: false,
		status: "ok",
		ok: true,
		summary: "Read Project/workspace/a.md",
	};
	const result = {
		turnId: context.turnId,
		taskId: "task-real-pi-result",
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Real PI persisted answer.",
		events: context.snapshotEvents(),
		traces: [trace],
		rawFinalReply: "Real PI persisted raw reply.",
	};
	const persisted = {
		sessions: [],
		traces: [],
		packages: [],
	};
	const packageRef = {
		packageId: "friday-pi-real-sdk",
		manifestPath: "runtime/pi/packages/friday-pi-real-sdk/manifest.json",
		runtime: "friday-pi",
		kind: "runtime_sdk",
		marketplace: false,
	};
	const workspacePolicy = {
		trustBoundary: "project",
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
	let createdSession;
	const host = {
		createSession() {
			createdSession = new HostResultSession(result);
			return createdSession;
		},
	};
	const runtime = new FridayPiRuntime(
		new PersistedFridayPiSessionHostAdapter(host, {
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
			packageMetadata: FRIDAY_PI_REAL_SDK_PACKAGE_METADATA,
		}),
	);

	const runtimeResult = await runtime.execute(input, context);

	assert.equal(runtimeResult.status, "completed");
	assert.equal(runtimeResult.assistantText, result.assistantText);
	assert.deepEqual(runtimeResult.traces, [trace]);
	assert.deepEqual(createdSession.promptInputs, [input.userPrompt]);
	assert.equal(createdSession.disposed, true);
	await waitFor(() => persisted.sessions.length === 1, "real PI session state was not persisted");
	assert.equal(persisted.packages.length, 1);
	assert.equal(persisted.packages[0].packageId, "friday-pi-real-sdk");
	assert.equal(persisted.packages[0].bridge, "real-pi-sdk");
	assert.equal(persisted.sessions[0].sessionId, "conversation-persisted-host");
	assert.equal(persisted.sessions[0].turnId, "turn-persisted-host");
	assert.equal(persisted.sessions[0].taskId, "task-real-pi-result");
	assert.deepEqual(persisted.sessions[0].packageRef, packageRef);
	assert.deepEqual(persisted.sessions[0].workspacePolicy, workspacePolicy);
	assert.equal(persisted.traces.length, 1);
	assert.equal(persisted.traces[0].kind, "pi_tool_trace");
	assert.equal(persisted.traces[0].packageRef.packageId, "friday-pi-real-sdk");
	assert.equal(persisted.traces[0].tool, "read");
	assert.equal(persisted.traces[0].targetPath, "Project/workspace/a.md");
	assert.equal(persisted.traces[0].workspacePolicy.externalWrite, false);
});

test("PersistedFridayPiSessionHostAdapter reports persistence failures diagnostically without changing the result", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { PersistedFridayPiSessionHostAdapter, FRIDAY_PI_REAL_SDK_PACKAGE_METADATA } = await jiti.import(adapterPath);
	const input = createInput({
		turnId: "turn-persisted-host-failure",
		conversationId: "conversation-persisted-host-failure",
	});
	const context = await createContext({
		turnId: "turn-persisted-host-failure",
		conversationId: "conversation-persisted-host-failure",
	});
	const result = {
		turnId: context.turnId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status: "completed",
		assistantText: "Persistence failure should not change this.",
		events: context.snapshotEvents(),
		traces: [],
		rawFinalReply: "Persistence failure should not change this.",
	};
	const warnings = [];
	const originalWarn = console.warn;
	const runtime = new FridayPiRuntime(
		new PersistedFridayPiSessionHostAdapter(
			{ createSession: () => new HostResultSession(result) },
			{
				stateStore: {
					async writePackageMetadata() {
						throw new Error("Synthetic real PI persistence failure.");
					},
					async appendSessionTurnRecord() {
						throw new Error("Should not append session after package metadata failure.");
					},
					async appendToolTraceRecords() {
						throw new Error("Should not append traces after package metadata failure.");
					},
				},
				packageMetadata: FRIDAY_PI_REAL_SDK_PACKAGE_METADATA,
			},
		),
	);

	let runtimeResult;
	console.warn = (...args) => warnings.push(args);
	try {
		runtimeResult = await runtime.execute(input, context);
		await waitFor(() => warnings.length === 1, "PI persistence failure warning was not reported");
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(runtimeResult.status, "completed");
	assert.equal(runtimeResult.assistantText, result.assistantText);
	assert.equal(warnings[0][0], "[Friday] PI runtime persistence failed.");
	assert.equal(warnings[0][1].turnId, "turn-persisted-host-failure");
	assert.equal(warnings[0][1].conversationId, "conversation-persisted-host-failure");
	assert.equal(warnings[0][2] instanceof Error, true);
	assert.match(warnings[0][2].message, /Synthetic real PI persistence failure/);
});
