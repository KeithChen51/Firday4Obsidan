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
const commandExecPath = path.join(projectRoot, "src/services/CommandExecService.ts");

async function loadModules() {
	const [policy, commandExec] = await Promise.all([
		jiti.import(policyPath),
		jiti.import(commandExecPath),
	]);
	return { policy, commandExec };
}

test("exec profile policy accepts only the debug/developer allowlist", async () => {
	const { policy } = await loadModules();
	const capabilityPolicy = new policy.CapabilityPolicy();

	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "debug",
		enableExecTool: true,
		command: "npm",
		args: ["test"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).allow, true);
	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "developer",
		enableExecTool: true,
		command: "git",
		args: ["diff", "--", "src/main.ts"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).allow, true);
	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "debug",
		enableExecTool: true,
		command: "rg",
		args: ["TODO", "src"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).allow, true);
});

test("exec profile policy rejects normal modes shell chaining deletion and outside cwd", async () => {
	const { policy } = await loadModules();
	const capabilityPolicy = new policy.CapabilityPolicy();

	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "ask",
		enableExecTool: true,
		command: "git",
		args: ["status"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).code, "exec_requires_debug_profile");
	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "debug",
		enableExecTool: true,
		command: "npm",
		args: ["test", "&&", "echo", "bad"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).code, "exec_shell_chaining_denied");
	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "debug",
		enableExecTool: true,
		command: "rm",
		args: ["-rf", "Project"],
		workspaceRoot: projectRoot,
		cwd: projectRoot,
	}).code, "exec_delete_denied");
	assert.equal(capabilityPolicy.evaluateExecRequest({
		agentMode: "debug",
		enableExecTool: true,
		command: "git",
		args: ["status"],
		workspaceRoot: projectRoot,
		cwd: path.dirname(projectRoot),
	}).code, "exec_cwd_outside_workspace");
});

test("CommandExecService defaults to non-exec agent mode unless the caller passes debug or developer", async () => {
	const { commandExec } = await loadModules();
	const service = new commandExec.CommandExecService(
		() => projectRoot,
		() => ({
			agentRuntime: {
				enableExecTool: true,
				blockedCommands: [],
				execTimeout: 1000,
				execWorkingDir: "vault",
				execCustomCwd: "",
			},
		}),
	);

	await assert.rejects(
		() => service.exec("git", ["status"]),
		/debug/i,
	);
	const result = await service.exec("git", ["status"], { agentMode: "debug", timeout: 3000 });
	assert.equal(result.command, "git");
	assert.deepEqual(result.args, ["status"]);
});

test("CommandExecService enforces the same allowlist before spawning", async () => {
	const { commandExec } = await loadModules();
	const service = new commandExec.CommandExecService(
		() => projectRoot,
		() => ({
			agentRuntime: {
				enableExecTool: true,
				blockedCommands: [],
				execTimeout: 1000,
				execWorkingDir: "vault",
				execCustomCwd: "",
			},
		}),
	);

	await assert.rejects(
		() => service.exec("node", ["-e", "console.log('not allowlisted')"], { agentMode: "debug" }),
		/allowlist/i,
	);
	await assert.rejects(
		() => service.exec("git", ["status"], { cwd: path.dirname(projectRoot), agentMode: "debug" }),
		/outside workspace/i,
	);
});
