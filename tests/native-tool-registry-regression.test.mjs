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
	const planWrite = definitions.find((tool) => tool.name === "plan_write");

	assert.equal(read?.description, registry.get("read")?.description);
	assert.deepEqual(read?.parameters, registry.get("read")?.parameters);
	assert.deepEqual(write?.parameters.required, ["path", "content"]);
	assert.ok(planWrite, "model-native tool definitions should include plan_write");
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

	assert.deepEqual(definitions.map((tool) => tool.name).sort(), ["exec", "plan_write", "read"]);
});

test("native filesystem tool descriptions align with project-relative path normalization", async () => {
	const mod = await loadRegistry();
	const registry = mod.ToolRegistry.getInstance();
	const definitions = registry.buildNativeToolDefinitions({ agentMode: "developer", enableExecTool: true });
	const byName = new Map(definitions.map((tool) => [tool.name, tool]));
	const filesystemTools = ["ls", "read", "grep", "search_text", "glob", "write", "edit", "delete"];

	for (const name of filesystemTools) {
		const tool = byName.get(name);
		assert.ok(tool, `${name} definition missing`);
		assert.match(tool.description, /project-relative paths/i, `${name} description should mention project-relative paths`);
		assert.doesNotMatch(tool.description, /Vault-relative path by default/i, `${name} description should not force vault-relative defaults`);
		const pathSchema = tool.parameters.properties.path;
		assert.equal(typeof pathSchema?.description, "string", `${name} path schema should describe path behavior`);
		assert.match(pathSchema.description, /project-relative/i, `${name} path schema should mention project-relative normalization`);
	}

	assert.match(byName.get("read").description, /allowed external/i);
	assert.match(byName.get("write").description, /active project workspace/i);
	assert.match(byName.get("delete").description, /canonical vault path/i);
});
