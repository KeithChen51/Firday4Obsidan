/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/ToolBoundaryFilter.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("tool boundary filter removes orphan tool results", async () => {
	const mod = await loadModule();
	const filter = new mod.ToolBoundaryFilter();

	const result = filter.repair([
		{ role: "user", content: "read the file" },
		{ role: "tool", toolCallId: "missing", name: "read", content: "TOOL_RESULT orphan" },
		{ role: "assistant", content: "done" },
	]);

	assert.deepEqual(result.messages.map((message) => message.role), ["user", "assistant"]);
	assert.deepEqual(result.repairs.map((repair) => repair.reason), ["orphan_tool_result"]);
});

test("tool boundary filter keeps one matching result and removes duplicate or mismatched tool results", async () => {
	const mod = await loadModule();
	const filter = new mod.ToolBoundaryFilter();

	const result = filter.repair([
		{ role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read", args: { path: "a.md" } }] },
		{ role: "tool", toolCallId: "call-1", name: "read", content: "TOOL_RESULT ok" },
		{ role: "tool", toolCallId: "call-1", name: "read", content: "TOOL_RESULT duplicate" },
		{ role: "tool", toolCallId: "call-2", name: "grep", content: "TOOL_RESULT wrong" },
		{ role: "assistant", content: "final" },
	]);

	assert.equal(result.messages.filter((message) => message.role === "tool").length, 1);
	assert.equal(result.messages.find((message) => message.role === "tool")?.toolCallId, "call-1");
	assert.deepEqual(
		result.repairs.map((repair) => repair.reason),
		["duplicate_tool_result", "orphan_tool_result"],
	);
});

test("tool boundary filter clears dangling assistant tool calls and trims oversized tool results", async () => {
	const mod = await loadModule();
	const filter = new mod.ToolBoundaryFilter();

	const result = filter.repair([
		{ role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read", args: { path: "a.md" } }] },
		{ role: "user", content: "new request" },
		{ role: "assistant", content: "", toolCalls: [{ id: "call-2", name: "read", args: { path: "b.md" } }] },
		{ role: "tool", toolCallId: "call-2", name: "read", content: "alpha ".repeat(200) },
	], {
		maxToolResultTokens: 24,
	});

	const firstAssistant = result.messages[0];
	const tool = result.messages.find((message) => message.role === "tool");
	assert.equal(Array.isArray(firstAssistant.toolCalls), false);
	assert.match(tool?.content ?? "", /\[trimmed tool result\]/);
	assert.deepEqual(
		result.repairs.map((repair) => repair.reason),
		["dangling_tool_call", "trimmed_tool_result"],
	);
});
