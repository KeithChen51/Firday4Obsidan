/* eslint-env node */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const traceStorePath = path.join(projectRoot, "src/desktop/state/TraceStore.ts");
const traceHostPath = path.join(projectRoot, "src/desktop/host/node/DesktopTraceHost.ts");
const permissionHostPath = path.join(projectRoot, "src/desktop/host/node/DesktopPermissionHost.ts");
const toolExecutionHostPath = path.join(projectRoot, "src/desktop/host/node/DesktopToolExecutionHost.ts");

async function loadModules() {
	return {
		traceStore: await jiti.import(traceStorePath),
		traceHost: await jiti.import(traceHostPath),
		permissionHost: await jiti.import(permissionHostPath),
		toolExecutionHost: await jiti.import(toolExecutionHostPath),
	};
}

async function withTempProject(prefix, callback) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		return await callback(tempRoot);
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
}

function createContext(projectRootPath, overrides = {}) {
	return {
		projectId: "desktop-project",
		conversationId: "conversation-1",
		turnId: "turn-1",
		permissionMode: "standard",
		projectRoot: projectRootPath,
		...overrides,
	};
}

async function readTraceTypes(projectRootPath, conversationId = "conversation-1", turnId = "turn-1") {
	const tracePath = path.join(projectRootPath, "FRIDAY", "traces", conversationId, `${turnId}.jsonl`);
	const raw = await fs.readFile(tracePath, "utf8");
	return raw.trim().split("\n").map((line) => JSON.parse(line).type);
}

test("safe mode requires review for real writes, commands, network, and delete while tracing each interception", async () => {
	const { traceHost, permissionHost } = await loadModules();

	await withTempProject("friday-desktop-permission-safe-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const host = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const context = createContext(projectRootPath, { permissionMode: "safe" });

		const readDecision = await host.requestApproval(context, {
			action: "read_project_file",
			summary: "Read project note",
			target: "notes/brief.md",
		});
		assert.equal(readDecision.allowed, true);
		assert.equal(readDecision.requiresReview, false);

		for (const action of ["write_project_file", "run_command", "network_access", "delete_project_file"]) {
			const decision = await host.requestApproval(context, {
				action,
				summary: `Request ${action}`,
				target: action === "network_access" ? "https://example.com" : "notes/brief.md",
				risk: "high",
			});
			assert.equal(decision.allowed, false);
			assert.equal(decision.requiresReview, true);
			assert.match(decision.reason, /review|confirm|approval/i);
			assert.match(decision.traceEventId, /^trace-/);
		}

		const events = await traces.queryTraceEvents({ projectId: "desktop-project", conversationId: "conversation-1", turnId: "turn-1" });
		assert.deepEqual(
			events.map((event) => event.type),
			[
				"permission_allowed",
				"permission_review_required",
				"permission_review_required",
				"permission_review_required",
				"permission_review_required",
			],
		);
		assert.deepEqual(events.slice(1).map((event) => event.payload.action), [
			"write_project_file",
			"run_command",
			"network_access",
			"delete_project_file",
		]);
	});
});

test("standard mode allows reads and FRIDAY artifact writes but reviews real project writes and high-risk actions", async () => {
	const { traceHost, permissionHost } = await loadModules();

	await withTempProject("friday-desktop-permission-standard-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const host = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const context = createContext(projectRootPath, { permissionMode: "standard" });

		const readDecision = await host.requestApproval(context, {
			action: "read_project_file",
			summary: "Read source",
			target: "docs/source.md",
		});
		const artifactDecision = await host.requestApproval(context, {
			action: "write_friday_artifact",
			summary: "Write generated artifact",
			target: "FRIDAY/artifacts/conversation-1/report.md",
		});
		const projectWriteDecision = await host.requestApproval(context, {
			action: "write_project_file",
			summary: "Write user project file",
			target: "docs/source.md",
		});
		const commandDecision = await host.requestApproval(context, {
			action: "run_command",
			summary: "Install dependency",
			target: "npm install",
			risk: "high",
		});

		assert.equal(readDecision.allowed, true);
		assert.equal(artifactDecision.allowed, true);
		assert.equal(projectWriteDecision.allowed, false);
		assert.equal(projectWriteDecision.requiresReview, true);
		assert.equal(commandDecision.allowed, false);
		assert.equal(commandDecision.requiresReview, true);

		const events = await traces.queryTraceEvents({ projectId: "desktop-project", conversationId: "conversation-1", turnId: "turn-1" });
		assert.deepEqual(events.map((event) => event.type), [
			"permission_allowed",
			"permission_allowed",
			"permission_review_required",
			"permission_review_required",
		]);
	});
});

test("autonomous mode allows file, command, network, git, and dependency actions while tracing allows", async () => {
	const { traceHost, permissionHost } = await loadModules();

	await withTempProject("friday-desktop-permission-autonomous-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const host = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const context = createContext(projectRootPath, { permissionMode: "autonomous" });
		const actions = [
			"write_project_file",
			"delete_project_file",
			"run_command",
			"network_access",
			"git_push",
			"install_dependency",
		];

		for (const action of actions) {
			const decision = await host.requestApproval(context, {
				action,
				summary: `Autonomous ${action}`,
				target: action,
				risk: "high",
			});
			assert.equal(decision.allowed, true);
			assert.equal(decision.requiresReview, false);
		}

		const events = await traces.queryTraceEvents({ projectId: "desktop-project", conversationId: "conversation-1", turnId: "turn-1" });
		assert.equal(events.length, actions.length);
		assert.ok(events.every((event) => event.type === "permission_allowed"));
	});
});

test("permission host records confirmation, rejection, and cancellation decisions", async () => {
	const { traceHost, permissionHost } = await loadModules();

	await withTempProject("friday-desktop-permission-review-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const host = new permissionHost.DesktopPermissionHost({
			traceHost: traces,
			reviewHandler: async (request) => {
				if (request.target === "allow.md") {
					return "allow";
				}
				if (request.target === "cancel.md") {
					return "cancel";
				}
				return "deny";
			},
		});
		const context = createContext(projectRootPath, { permissionMode: "safe" });

		const confirmed = await host.requestApproval(context, {
			action: "write_project_file",
			summary: "Allowed by user",
			target: "allow.md",
		});
		const denied = await host.requestApproval(context, {
			action: "write_project_file",
			summary: "Denied by user",
			target: "deny.md",
		});
		const cancelled = await host.requestApproval(context, {
			action: "write_project_file",
			summary: "Cancelled by user",
			target: "cancel.md",
		});

		assert.deepEqual(
			[confirmed.allowed, denied.allowed, cancelled.allowed],
			[true, false, false],
		);
		assert.deepEqual(
			await readTraceTypes(projectRootPath),
			[
				"permission_review_required",
				"permission_confirmed",
				"permission_review_required",
				"permission_denied",
				"permission_review_required",
				"permission_cancelled",
			],
		);
	});
});

test("permission host catches review handler failures and records a failed review trace", async () => {
	const { traceHost, permissionHost } = await loadModules();

	await withTempProject("friday-desktop-permission-review-failure-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const host = new permissionHost.DesktopPermissionHost({
			traceHost: traces,
			reviewHandler: async () => {
				throw new Error("review ui unavailable");
			},
		});
		const context = createContext(projectRootPath, { permissionMode: "safe" });

		const decision = await host.requestApproval(context, {
			action: "write_project_file",
			summary: "Write project file",
			target: "notes/brief.md",
		});

		assert.equal(decision.allowed, false);
		assert.equal(decision.requiresReview, true);
		assert.match(decision.reason, /review ui unavailable/);
		assert.deepEqual(await readTraceTypes(projectRootPath), [
			"permission_review_required",
			"permission_review_failed",
		]);
	});
});

test("trace store appends per-turn JSONL and supports query and replay", async () => {
	const { traceStore } = await loadModules();

	await withTempProject("friday-desktop-trace-store-", async (projectRootPath) => {
		const store = new traceStore.TraceStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:00.000Z"),
			idFactory: () => "trace-fixed",
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-trace",
			turnId: "turn-trace",
		});

		await store.appendTraceEvent(context, { type: "file_read", at: "", payload: { path: "notes/a.md" } });
		await store.appendTraceEvent(context, { type: "file_write", at: "", payload: { path: "notes/b.md" } });

		const queried = await store.queryTraceEvents({
			projectId: "desktop-project",
			conversationId: "conversation-trace",
			turnId: "turn-trace",
			type: "file_read",
		});
		const replayed = [];
		for await (const event of store.replayTraceEvents({
			projectId: "desktop-project",
			conversationId: "conversation-trace",
			turnId: "turn-trace",
		})) {
			replayed.push(event);
		}

		assert.equal(queried.length, 1);
		assert.equal(queried[0].id, "trace-fixed");
		assert.equal(queried[0].at, "2026-06-12T00:00:00.000Z");
		assert.deepEqual(replayed.map((event) => event.type), ["file_read", "file_write"]);
	});
});

test("trace store skips malformed JSONL lines while preserving valid events", async () => {
	const { traceStore } = await loadModules();

	await withTempProject("friday-desktop-trace-corrupt-", async (projectRootPath) => {
		const store = new traceStore.TraceStore(projectRootPath);
		const context = createContext(projectRootPath, {
			conversationId: "conversation-corrupt",
			turnId: "turn-corrupt",
		});
		await store.appendTraceEvent(context, { id: "trace-valid-1", type: "file_read", at: "2026-06-12T00:00:00.000Z" });
		await fs.appendFile(
			path.join(projectRootPath, "FRIDAY", "traces", "conversation-corrupt", "turn-corrupt.jsonl"),
			"{not valid json}\n",
			"utf8",
		);
		await store.appendTraceEvent(context, { id: "trace-valid-2", type: "file_write", at: "2026-06-12T00:00:01.000Z" });

		const queried = await store.queryTraceEvents({
			projectId: "desktop-project",
			conversationId: "conversation-corrupt",
			turnId: "turn-corrupt",
		});
		const replayed = [];
		for await (const event of store.replayTraceEvents({
			projectId: "desktop-project",
			conversationId: "conversation-corrupt",
			turnId: "turn-corrupt",
		})) {
			replayed.push(event);
		}

		assert.deepEqual(queried.map((event) => event.id), ["trace-valid-1", "trace-valid-2"]);
		assert.deepEqual(replayed.map((event) => event.type), ["file_read", "file_write"]);
	});
});

test("tool execution host delegates through an injected gateway and traces start, success, failure, and cancellation", async () => {
	const { traceHost, permissionHost, toolExecutionHost } = await loadModules();

	await withTempProject("friday-desktop-tool-exec-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const permissions = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const gatewayCalls = [];
		const executorCalls = [];
		const gateway = {
			async run(input) {
				gatewayCalls.push(input);
				try {
					const data = await input.execute();
					return {
						status: "ok",
						data,
						decision: { allow: true, approval: "none", reason: "fake gateway allow" },
						audit: { execution: { attempted: true, status: "ok" } },
					};
				} catch (error) {
					return {
						status: "failed",
						error: error instanceof Error ? error.message : String(error),
						decision: { allow: true, approval: "none", reason: "fake gateway allow" },
						audit: { execution: { attempted: true, status: "failed" } },
					};
				}
			},
		};
		const host = new toolExecutionHost.DesktopToolExecutionHost({
			traceHost: traces,
			permissionHost: permissions,
			gateway,
			executor: async (invocation) => {
				executorCalls.push(invocation);
				if (invocation.toolName === "fail") {
					throw new Error("tool failed");
				}
				return { value: "done" };
			},
		});
		const context = createContext(projectRootPath, { permissionMode: "autonomous" });

		const success = await host.executeToolInvocation(context, {
			id: "tool-1",
			toolName: "read",
			input: { path: "notes/a.md" },
			reason: "Read a project file",
		});
		const failure = await host.executeToolInvocation(context, {
			id: "tool-2",
			toolName: "fail",
			input: {},
			reason: "Fail deliberately",
		});
		await permissions.cancelTurn({ ...context, turnId: "turn-cancelled" }, "User stopped the turn.");
		const cancelled = await host.executeToolInvocation({ ...context, turnId: "turn-cancelled" }, {
			id: "tool-3",
			toolName: "read",
			input: { path: "notes/b.md" },
		});

		assert.equal(success.status, "ok");
		assert.deepEqual(success.output, { value: "done" });
		assert.equal(failure.status, "error");
		assert.match(failure.error, /tool failed/);
		assert.equal(cancelled.status, "cancelled");
		assert.equal(gatewayCalls.length, 2);
		assert.equal(executorCalls.length, 2);

		const activeTypes = await readTraceTypes(projectRootPath, "conversation-1", "turn-1");
		assert.deepEqual(activeTypes, [
			"permission_allowed",
			"tool_execution_start",
			"tool_execution_success",
			"permission_allowed",
			"tool_execution_start",
			"tool_execution_failure",
		]);
		assert.deepEqual(await readTraceTypes(projectRootPath, "conversation-1", "turn-cancelled"), [
			"permission_cancelled",
			"tool_execution_cancelled",
		]);
	});
});

test("standard mode reviews artifact-looking writes when path traversal escapes FRIDAY artifacts", async () => {
	const { traceHost, permissionHost, toolExecutionHost } = await loadModules();

	await withTempProject("friday-desktop-artifact-traversal-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const permissions = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		let executorCalls = 0;
		const host = new toolExecutionHost.DesktopToolExecutionHost({
			traceHost: traces,
			permissionHost: permissions,
			gateway: {
				async run(input) {
					const data = await input.execute();
					return {
						status: "ok",
						data,
						decision: { allow: true, approval: "none", reason: "fake gateway allow" },
						audit: { execution: { attempted: true, status: "ok" } },
					};
				},
			},
			executor: async () => {
				executorCalls += 1;
				return { value: "should not run" };
			},
		});

		const result = await host.executeToolInvocation(
			createContext(projectRootPath, { permissionMode: "standard" }),
			{
				id: "tool-artifact-traversal",
				toolName: "write",
				input: {
					path: "FRIDAY/artifacts/../../notes.md",
					content: "# escaped\n",
				},
			},
		);

		assert.equal(result.status, "error");
		assert.equal(executorCalls, 0);
		assert.deepEqual(await readTraceTypes(projectRootPath), ["permission_review_required"]);
	});
});

test("autonomous mode default desktop gateway lets exec npm install reach the executor", async () => {
	const { traceHost, permissionHost, toolExecutionHost } = await loadModules();

	await withTempProject("friday-desktop-autonomous-exec-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const permissions = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const executorCalls = [];
		const host = new toolExecutionHost.DesktopToolExecutionHost({
			traceHost: traces,
			permissionHost: permissions,
			executor: async (invocation) => {
				executorCalls.push(invocation);
				return { installed: true };
			},
		});

		const result = await host.executeToolInvocation(
			createContext(projectRootPath, { permissionMode: "autonomous" }),
			{
				id: "tool-npm-install",
				toolName: "exec",
				input: {
					command: "npm",
					args: ["install"],
					cwd: projectRootPath,
				},
			},
		);

		assert.equal(result.status, "ok");
		assert.deepEqual(result.output, { installed: true });
		assert.equal(executorCalls.length, 1);
		assert.deepEqual(await readTraceTypes(projectRootPath), [
			"permission_allowed",
			"tool_execution_start",
			"tool_execution_success",
		]);
	});
});

test("tool execution host records a failure trace when the injected gateway throws", async () => {
	const { traceHost, permissionHost, toolExecutionHost } = await loadModules();

	await withTempProject("friday-desktop-tool-gateway-throw-", async (projectRootPath) => {
		const traces = new traceHost.DesktopTraceHost(projectRootPath);
		const permissions = new permissionHost.DesktopPermissionHost({ traceHost: traces });
		const host = new toolExecutionHost.DesktopToolExecutionHost({
			traceHost: traces,
			permissionHost: permissions,
			gateway: {
				async run() {
					throw new Error("gateway boom");
				},
			},
			executor: async () => ({ value: "unreachable" }),
		});

		const result = await host.executeToolInvocation(
			createContext(projectRootPath, { permissionMode: "autonomous" }),
			{
				id: "tool-gateway-throws",
				toolName: "read",
				input: { path: "notes/a.md" },
			},
		);

		assert.equal(result.status, "error");
		assert.match(result.error, /gateway boom/);
		assert.deepEqual(await readTraceTypes(projectRootPath), [
			"permission_allowed",
			"tool_execution_start",
			"tool_execution_failure",
		]);
	});
});
