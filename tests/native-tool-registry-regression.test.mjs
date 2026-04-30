/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const registryPath = path.join(projectRoot, "src/core/tools/ToolRegistry.ts");

async function loadRegistry() {
	return jiti.import(registryPath);
}

test("native tool definitions are built from registry contracts", async () => {
	const mod = await loadRegistry();
	const registry = mod.ToolRegistry.getInstance();
	const definitions = registry.buildNativeToolDefinitions({ agentMode: "ask", enableExecTool: false });
	const read = definitions.find((tool) => tool.name === "read");
	const write = definitions.find((tool) => tool.name === "write");

	assert.equal(read?.description, registry.get("read")?.description);
	assert.deepEqual(read?.parameters, registry.get("read")?.parameters);
	assert.deepEqual(write?.parameters.required, ["path", "content"]);
	assert.ok(!definitions.some((tool) => tool.name === "exec"));
});

test("native tool definitions respect disabled and allowed tool filters", async () => {
	const mod = await loadRegistry();
	const registry = mod.ToolRegistry.getInstance();
	const definitions = registry.buildNativeToolDefinitions({
		agentMode: "debug",
		enableExecTool: true,
		disabledTools: ["delete"],
		allowedTools: new Set(["read", "delete", "exec"]),
	});

	assert.deepEqual(definitions.map((tool) => tool.name).sort(), ["exec", "read"]);
});
