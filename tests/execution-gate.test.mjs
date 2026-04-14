/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const gateModulePath = path.join(projectRoot, "src/core/execution/ExecutionGate.ts");

async function loadGateModule() {
	return jiti.import(gateModulePath);
}

function createSettings(overrides = {}) {
	return {
		agentRuntime: {
			toolRuntimeEnabled: true,
			disabledSkills: [],
			disabledTools: [],
			enableExecTool: true,
			enableSubagent: true,
			...overrides,
		},
	};
}

function createRuntimeProfile(overrides = {}) {
	return {
		id: "windows-desktop",
		platform: "win32",
		supported: true,
		shell: "powershell",
		capabilities: {
			supportsExecTool: true,
			supportsExternalRead: true,
			supportsSubagent: true,
		},
		...overrides,
	};
}

function createInvocation(overrides = {}) {
	return {
		request: {
			source: "chat_prompt",
			intentType: "plan",
			prompt: "test",
		},
		resolvedType: "plan",
		resolvedId: "agent-runtime-turn",
		requiresRuntime: true,
		requiredCapabilities: [],
		...overrides,
	};
}

test("execution gate denies runtime requests when tool runtime is disabled", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings({ toolRuntimeEnabled: false }));
	const decision = gate.evaluate(createInvocation(), createRuntimeProfile());
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "runtime_disabled");
});

test("execution gate denies disabled skills", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings({ disabledSkills: ["compile-wiki"] }));
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "slash_skill", intentType: "skill", prompt: "/compile-wiki now" },
			resolvedType: "skill",
			resolvedId: "compile-wiki",
		}),
		createRuntimeProfile(),
	);
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "skill_disabled");
});

test("execution gate denies disabled tools", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings({ disabledTools: ["write"] }));
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "chat_prompt", intentType: "tool", prompt: "write file" },
			resolvedType: "tool",
			resolvedId: "write",
		}),
		createRuntimeProfile(),
	);
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "tool_disabled");
});

test("execution gate denies skill requests that depend on disabled capabilities", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings({ disabledTools: ["compile_wiki"] }));
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "chat_prompt", intentType: "skill", prompt: "compile wiki" },
			resolvedType: "skill",
			resolvedId: "compile-wiki",
			requiredCapabilities: ["compile_wiki"],
		}),
		createRuntimeProfile(),
	);
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "capability_disabled");
});

test("execution gate denies exec capability when exec tool is turned off", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings({ enableExecTool: false }));
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "chat_prompt", intentType: "tool", prompt: "run command" },
			resolvedType: "tool",
			resolvedId: "exec",
			requiredCapabilities: ["exec"],
		}),
		createRuntimeProfile(),
	);
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "exec_disabled");
});

test("execution gate denies subagent capability when runtime profile does not support it", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings());
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "chat_prompt", intentType: "tool", prompt: "delegate task" },
			resolvedType: "tool",
			resolvedId: "subagent",
			requiredCapabilities: ["subagent"],
		}),
		createRuntimeProfile({
			id: "unsupported",
			platform: "linux",
			supported: false,
			shell: "unknown",
			capabilities: {
				supportsExecTool: false,
				supportsExternalRead: false,
				supportsSubagent: false,
			},
		}),
	);
	assert.equal(decision.allow, false);
	assert.equal(decision.code, "subagent_unsupported");
});

test("execution gate allows enabled runtime skill invocation", async () => {
	const mod = await loadGateModule();
	const gate = new mod.ExecutionGate(() => createSettings());
	const decision = gate.evaluate(
		createInvocation({
			request: { source: "slash_skill", intentType: "skill", prompt: "/lookup-wiki foo" },
			resolvedType: "skill",
			resolvedId: "lookup-wiki",
		}),
		createRuntimeProfile(),
	);
	assert.equal(decision.allow, true);
	assert.equal(decision.code, "allowed");
});
