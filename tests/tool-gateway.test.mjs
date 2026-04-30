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
});

test("tool gateway executes allowed tools and normalizes failures", async () => {
	const { gateway, policy } = await loadModules();
	const toolGateway = new gateway.ToolGateway(new policy.CapabilityPolicy());

	const success = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "read" }),
		execute: async () => ({ content: "alpha" }),
	});
	assert.equal(success.status, "ok");
	assert.deepEqual(success.data, { content: "alpha" });

	const failed = await toolGateway.run({
		policyInput: createPolicyInput({ toolName: "read" }),
		execute: async () => {
			throw new Error("read failed");
		},
	});
	assert.equal(failed.status, "failed");
	assert.equal(failed.error, "read failed");
});
