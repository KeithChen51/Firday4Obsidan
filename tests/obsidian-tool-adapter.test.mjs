/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const adapterPath = path.join(projectRoot, "src/services/tools/ObsidianToolAdapter.ts");
const handlersPath = path.join(projectRoot, "src/services/tools/ObsidianToolHandlers.ts");
const contextPath = path.join(projectRoot, "src/services/tools/ObsidianToolContext.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("Obsidian tool adapter owns dispatch and preserves use_skill as a special registry-adjacent tool", async () => {
	const { ObsidianToolAdapter } = await jiti.import(adapterPath);
	const calls = [];
	const handlers = {
		toolUseSkill: async (args) => {
			calls.push(["use_skill", args]);
			return { loaded: true, command: args.command };
		},
		toolRead: async (args) => {
			calls.push(["read", args]);
			return { content: "read result" };
		},
	};
	const adapter = new ObsidianToolAdapter(handlers);

	assert.deepEqual(await adapter.runToolByName("use_skill", { command: "careful" }, "agent-a"), {
		loaded: true,
		command: "careful",
	});
	assert.deepEqual(await adapter.runToolByName("read", { path: "Project/workspace/a.md" }, "agent-a"), {
		content: "read result",
	});
	assert.deepEqual(calls, [
		["use_skill", { command: "careful" }],
		["read", { path: "Project/workspace/a.md" }],
	]);
});

test("Obsidian tool adapter threads mutation review identifiers to write edit and delete handlers", async () => {
	const { ObsidianToolAdapter } = await jiti.import(adapterPath);
	const threaded = [];
	const handlers = {
		toolWrite: async (args, agentId, toolCallId) => {
			threaded.push(["write", args, agentId, toolCallId]);
			return { status: "pending_review" };
		},
		toolEdit: async (args, agentId, toolCallId) => {
			threaded.push(["edit", args, agentId, toolCallId]);
			return { status: "pending_review" };
		},
		toolDelete: async (args, agentId, toolCallId) => {
			threaded.push(["delete", args, agentId, toolCallId]);
			return { status: "pending_review" };
		},
	};
	const adapter = new ObsidianToolAdapter(handlers);

	await adapter.runToolByName("write", { path: "a.md", content: "new" }, "agent-a", "tool-call-1");
	await adapter.runToolByName("edit", { path: "a.md", edits: [] }, "agent-a", "tool-call-2");
	await adapter.runToolByName("delete", { path: "a.md" }, "agent-a", "tool-call-3");

	assert.deepEqual(threaded, [
		["write", { path: "a.md", content: "new" }, "agent-a", "tool-call-1"],
		["edit", { path: "a.md", edits: [] }, "agent-a", "tool-call-2"],
		["delete", { path: "a.md" }, "agent-a", "tool-call-3"],
	]);
});

test("AgentRuntimeService wires through the Obsidian tool adapter instead of owning concrete tool handlers", () => {
	const runtimeSource = read(runtimePath);
	const adapterSource = read(adapterPath);
	const handlersSource = read(handlersPath);
	const contextSource = read(contextPath);

	assert.match(runtimeSource, /ObsidianToolAdapter/);
	assert.match(runtimeSource, /new ObsidianToolAdapter\(/);
	assert.match(runtimeSource, /const mutationToolCallId = tool\.id \|\| runId/);
	assert.match(runtimeSource, /\.runToolByName\(name, args, agentId, mutationToolCallId\)/);
	assert.doesNotMatch(runtimeSource, /private async toolUseSkill\(/);
	assert.doesNotMatch(runtimeSource, /private async toolMemory\(/);
	assert.doesNotMatch(runtimeSource, /private async toolWrite\(/);
	assert.match(adapterSource, /CapabilityResolver/);
	assert.match(adapterSource, /findToolManifest/);
	assert.match(handlersSource, /async toolUseSkill\(/);
	assert.match(handlersSource, /async toolMemory\(/);
	assert.match(handlersSource, /async toolWrite\(/);
	assert.match(contextSource, /export class ObsidianToolContext/);
	assert.match(contextSource, /beforeLines: number/);
	assert.doesNotMatch(contextSource, /added: number;\n\t\tremoved: number;\n\t\tchanged: boolean/);
});

test("Obsidian handlers keep vault path lookup behind the runtime ToolPathResolver", () => {
	const runtimeSource = read(runtimePath);

	assert.match(runtimeSource, /private resolveVaultFilePath\(rawPath: string\): string \{\s*const resolution = this\.createToolPathResolver\(\)\.resolve\(\{\s*intent: "read_file"/s);
	assert.match(runtimeSource, /private resolveExistingVaultFilePath\(rawPath: string\): string \| null \{\s*const resolution = this\.createToolPathResolver\(\)\.resolve\(\{\s*intent: "read_file"/s);
	assert.match(runtimeSource, /private resolveDefaultVaultSearchPath\(rawPath: string \| undefined\): string \{\s*const resolution = this\.createToolPathResolver\(\)\.resolve\(\{\s*intent: "search"/s);
	assert.match(runtimeSource, /private normalizeToolArgs\(name: string, args: Record<string, unknown>\): Record<string, unknown> \{[\s\S]*?if \(!resolution\.ok\) \{\s*return args;\s*\}/);
});
