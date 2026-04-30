/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const policyPath = path.join(projectRoot, "src/core/policy/CapabilityPolicy.ts");

async function loadPolicy() {
	return jiti.import(policyPath);
}

function createContext(overrides = {}) {
	return {
		agentMode: "ask",
		enableExecTool: false,
		runtimeProfile: {
			id: "windows-desktop",
			capabilities: {
				supportsExecTool: true,
				supportsExternalRead: true,
			},
		},
		toolName: "read",
		args: {},
		scope: "vault",
		targetPath: "Project/workspace/a.md",
		disabledTools: [],
		allowedTools: null,
		policyEffect: "allow",
		workspaceRoot: projectRoot,
		...overrides,
	};
}

test("capability policy allows read tools without approval", async () => {
	const mod = await loadPolicy();
	const policy = new mod.CapabilityPolicy();
	const decision = policy.evaluateToolCall(createContext({ toolName: "read" }));

	assert.deepEqual(decision, {
		allow: true,
		approval: "none",
		reason: "Tool read is allowed.",
	});
});

test("capability policy sends write tools through standard approval", async () => {
	const mod = await loadPolicy();
	const policy = new mod.CapabilityPolicy();
	const decision = policy.evaluateToolCall(createContext({ toolName: "write" }));

	assert.equal(decision.allow, true);
	assert.equal(decision.approval, "standard");
});

test("capability policy denies unknown disabled and disallowed tools", async () => {
	const mod = await loadPolicy();
	const policy = new mod.CapabilityPolicy();

	assert.equal(policy.evaluateToolCall(createContext({ toolName: "not_a_tool" })).code, "tool_unknown");
	assert.equal(policy.evaluateToolCall(createContext({ toolName: "read", disabledTools: ["read"] })).code, "tool_disabled");
	assert.equal(
		policy.evaluateToolCall(createContext({ toolName: "read", allowedTools: new Set(["grep"]) })).code,
		"tool_not_allowed",
	);
});

test("capability policy keeps exec out of normal Obsidian modes", async () => {
	const mod = await loadPolicy();
	const policy = new mod.CapabilityPolicy();
	const decision = policy.evaluateToolCall(createContext({
		toolName: "exec",
		agentMode: "research",
		enableExecTool: true,
		args: { command: "git", args: ["status"] },
	}));

	assert.equal(decision.allow, false);
	assert.equal(decision.code, "exec_requires_debug_profile");
});

test("capability policy allows only debug-profile allowlisted exec", async () => {
	const mod = await loadPolicy();
	const policy = new mod.CapabilityPolicy();

	const allowed = policy.evaluateToolCall(createContext({
		toolName: "exec",
		agentMode: "debug",
		enableExecTool: true,
		args: { command: "git", args: ["status"] },
	}));
	assert.equal(allowed.allow, true);
	assert.equal(allowed.approval, "strict");

	const denied = policy.evaluateToolCall(createContext({
		toolName: "exec",
		agentMode: "debug",
		enableExecTool: true,
		args: { command: "node", args: ["script.js"] },
	}));
	assert.equal(denied.allow, false);
	assert.equal(denied.code, "exec_not_allowlisted");
});
