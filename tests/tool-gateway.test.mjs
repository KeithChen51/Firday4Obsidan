/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const gatewayPath = path.join(projectRoot, "src/core/tools/ToolGateway.ts");
const policyPath = path.join(projectRoot, "src/core/policy/CapabilityPolicy.ts");

async function loadModules() {
	const [gateway, policy] = await Promise.all([
		jiti.import(gatewayPath),
		jiti.import(policyPath),
	]);
	return { gateway, policy };
}

function createPolicyInput(overrides = {}) {
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
		args: { path: "Project/workspace/a.md" },
		scope: "vault",
		targetPath: "Project/workspace/a.md",
		disabledTools: [],
		allowedTools: null,
		policyEffect: "allow",
		workspaceRoot: projectRoot,
		...overrides,
	};
}

test("tool gateway does not execute a policy-denied tool", async () => {
	const { gateway, policy } = await loadModules();
	const toolGateway = new gateway.ToolGateway(new policy.CapabilityPolicy());
	let executed = false;

	const result = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "unknown_tool" }),
		execute: async () => {
			executed = true;
		},
	});

	assert.equal(executed, false);
	assert.equal(result.status, "denied");
	assert.equal(result.decision.code, "tool_unknown");
	assert.deepEqual(result.audit.policy, {
		allow: false,
		code: "tool_unknown",
		reason: "Unknown tool: unknown_tool.",
		approval: "none",
	});
	assert.equal(result.audit.tool, "unknown_tool");
	assert.equal(result.audit.capability, "unknown");
	assert.equal(result.audit.scope, "vault");
	assert.equal(result.audit.targetPath, "Project/workspace/a.md");
	assert.deepEqual(result.audit.execution, {
		attempted: false,
		status: "denied",
	});
});

test("tool gateway stops when human approval denies a risky tool", async () => {
	const { gateway, policy } = await loadModules();
	const toolGateway = new gateway.ToolGateway(new policy.CapabilityPolicy());
	let executed = false;

	const result = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "write", policyEffect: "ask" }),
		approvalRequest: {
			agentId: "agent",
			tool: "write",
			scope: "vault",
			targetPath: "Project/workspace/a.md",
			description: "write",
		},
		requestApproval: async () => ({
			allowed: false,
			persisted: false,
			viaRule: false,
			reason: "User denied tool call.",
		}),
		execute: async () => {
			executed = true;
		},
	});

	assert.equal(executed, false);
	assert.equal(result.status, "denied");
	assert.equal(result.approval?.reason, "User denied tool call.");
	assert.deepEqual(result.audit.approval, {
		requested: true,
		allowed: false,
		persisted: false,
		viaRule: false,
		reason: "User denied tool call.",
	});
	assert.deepEqual(result.audit.execution, {
		attempted: false,
		status: "denied",
	});
});

test("tool gateway records allowed read success with no approval", async () => {
	const { gateway, policy } = await loadModules();
	const toolGateway = new gateway.ToolGateway(new policy.CapabilityPolicy());

	const success = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "read" }),
		execute: async () => ({ content: "alpha" }),
	});
	assert.equal(success.status, "ok");
	assert.deepEqual(success.data, { content: "alpha" });
	assert.equal(success.audit.policy.approval, "none");
	assert.equal(success.audit.policy.reason, "Tool read is allowed.");
	assert.deepEqual(success.audit.execution, {
		attempted: true,
		status: "ok",
	});
});

test("tool gateway classifies execution failures through the governor", async () => {
	const { gateway, policy } = await loadModules();
	const toolGateway = new gateway.ToolGateway(new policy.CapabilityPolicy());

	const failed = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "read" }),
		execute: async () => {
			throw new Error("504 Gateway Timeout");
		},
	});
	assert.equal(failed.status, "failed");
	assert.equal(failed.error, "504 Gateway Timeout");
	assert.deepEqual(failed.audit.execution, {
		attempted: true,
		status: "failed",
		failureClass: "transport_unstable",
	});
});
