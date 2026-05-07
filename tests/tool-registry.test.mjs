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
const manifestPath = path.join(projectRoot, "src/platform/tools/ToolManifestCatalog.ts");

async function loadModules() {
	const [registry, manifest] = await Promise.all([
		jiti.import(registryPath),
		jiti.import(manifestPath),
	]);
	return { registry, manifest };
}

test("tool registry owns complete tool contracts with unique names", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();
	const tools = toolRegistry.list();
	const names = tools.map((tool) => tool.name);

	assert.ok(names.includes("read"));
	assert.ok(names.includes("search_text"));
	assert.ok(names.includes("memory"));
	assert.equal(new Set(names).size, names.length);
	for (const tool of tools) {
		assert.equal(typeof tool.description, "string", `${tool.name} missing description`);
		assert.equal(typeof tool.capability, "string", `${tool.name} missing capability`);
		assert.equal(typeof tool.handlerName, "string", `${tool.name} missing handlerName`);
		assert.equal(tool.parameters.type, "object", `${tool.name} missing object schema`);
		assert.ok(["low", "medium", "high"].includes(tool.riskLevel), `${tool.name} missing risk level`);
		assert.ok(["read", "write", "delete", "system", "memory", "skill", "knowledge"].includes(tool.category));
	}
});

test("tool manifest catalog is derived from the tool registry", async () => {
	const { registry, manifest } = await loadModules();
	const expected = registry.ToolRegistry.getInstance()
		.listManifests()
		.map((tool) => tool.name)
		.sort();
	const actual = manifest.TOOL_MANIFESTS.map((tool) => tool.name).sort();

	assert.deepEqual(actual, expected);
	assert.deepEqual(manifest.findToolManifest("read"), {
		name: "read",
		capability: "filesystem.read",
		readOnly: true,
		primary: true,
	});
	assert.equal(manifest.findToolManifest("compile_wiki"), null);
});

test("default Obsidian modes hide debug-only exec from prompt and native surfaces", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();

	assert.ok(!toolRegistry.listForAgentMode("ask", { enableExecTool: true }).some((tool) => tool.name === "exec"));
	assert.ok(!toolRegistry.listForAgentMode("research", { enableExecTool: true }).some((tool) => tool.name === "exec"));
	assert.ok(!toolRegistry.buildPromptToolNameUnion({ agentMode: "write", enableExecTool: true }).includes("exec"));
	assert.ok(!toolRegistry.buildNativeToolDefinitions({ agentMode: "review", enableExecTool: true }).some((tool) => tool.name === "exec"));
});

test("debug mode can expose exec only when explicitly enabled", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();

	assert.ok(!toolRegistry.listForAgentMode("debug", { enableExecTool: false }).some((tool) => tool.name === "exec"));
	assert.ok(toolRegistry.listForAgentMode("debug", { enableExecTool: true }).some((tool) => tool.name === "exec"));
	assert.ok(toolRegistry.buildPromptToolNameUnion({ agentMode: "debug", enableExecTool: true }).includes("exec"));
	assert.ok(toolRegistry.buildNativeToolDefinitions({ agentMode: "debug", enableExecTool: true }).some((tool) => tool.name === "exec"));
});

test("prompt tool argument lines describe project-relative filesystem paths", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();
	const lines = toolRegistry.buildPromptToolArgumentLines({ agentMode: "developer", enableExecTool: true });
	const lineFor = (name) => lines.find((line) => line.startsWith(`- ${name}:`)) ?? "";

	for (const name of ["ls", "read", "grep", "search_text", "glob", "write", "edit", "delete"]) {
		assert.match(lineFor(name), /project-relative/i, `${name} prompt line should use project-relative guidance`);
		assert.doesNotMatch(lineFor(name), /Vault-relative path/i, `${name} prompt line should not require vault-relative paths`);
	}
});
