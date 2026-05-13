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
		assert.ok(["read", "write", "delete", "system", "memory", "skill", "knowledge", "planning"].includes(tool.category));
		assert.equal(typeof tool.concurrencySafe, "boolean", `${tool.name} missing concurrencySafe`);
		assert.equal(typeof tool.idempotent, "boolean", `${tool.name} missing idempotent`);
		assert.equal(typeof tool.cacheable, "boolean", `${tool.name} missing cacheable`);
		assert.equal(typeof tool.mutatesVault, "boolean", `${tool.name} missing mutatesVault`);
		assert.equal(typeof tool.mutatesExternal, "boolean", `${tool.name} missing mutatesExternal`);
		assert.equal(typeof tool.resultKind, "string", `${tool.name} missing resultKind`);
		assert.equal(typeof tool.outputBudget, "number", `${tool.name} missing outputBudget`);
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
		concurrencySafe: true,
		idempotent: true,
		cacheable: true,
		mutatesVault: false,
		mutatesExternal: false,
		resultKind: "document",
		outputBudget: 10000,
		primary: true,
	});
	assert.equal(manifest.findToolManifest("compile_wiki"), null);
});

test("tool contracts mark observation tools concurrency-safe and mutation tools unsafe", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();

	for (const name of ["read", "ls", "grep", "search_text", "glob", "read_many", "search_and_read", "project_tree"]) {
		const tool = toolRegistry.get(name);
		assert.equal(tool?.readOnly, true, `${name} should be read-only`);
		assert.equal(tool?.concurrencySafe, true, `${name} should be safe to run concurrently`);
		assert.equal(tool?.idempotent, true, `${name} should be idempotent`);
		assert.equal(tool?.cacheable, true, `${name} should be cacheable`);
		assert.equal(tool?.mutatesVault, false, `${name} should not mutate vault state`);
		assert.equal(tool?.mutatesExternal, false, `${name} should not mutate external state`);
		assert.ok(tool?.outputBudget > 0, `${name} should declare an output budget`);
	}

	for (const name of ["write", "edit", "delete", "exec", "memory", "compile_wiki"]) {
		const tool = toolRegistry.get(name);
		if (!tool) {
			continue;
		}
		assert.equal(tool.concurrencySafe, false, `${name} should not run concurrently`);
		assert.equal(tool.cacheable, false, `${name} should not be cacheable`);
	}

	assert.equal(toolRegistry.get("use_skill")?.concurrencySafe, false);
});

test("composite read-only tools are available to normal agent modes", async () => {
	const { registry } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();

	for (const name of ["read_many", "search_and_read", "project_tree"]) {
		const tool = toolRegistry.get(name);
		assert.ok(tool, `${name} should be registered`);
		assert.equal(tool.readOnly, true, `${name} should be read-only`);
		assert.equal(tool.concurrencySafe, true, `${name} should be concurrency-safe`);
		assert.equal(tool.idempotent, true, `${name} should be idempotent`);
		assert.equal(tool.cacheable, true, `${name} should be cacheable`);
		assert.equal(tool.mutatesVault, false, `${name} should not mutate vault state`);
		assert.equal(tool.mutatesExternal, false, `${name} should not mutate external state`);
		assert.equal(tool.riskLevel, "low", `${name} should be a low-risk tool`);
		assert.ok(tool.outputBudget > 0, `${name} should declare output budget`);
	}

	const askNames = toolRegistry.listForAgentMode("ask").map((tool) => tool.name);
	assert.ok(askNames.includes("read_many"));
	assert.ok(askNames.includes("search_and_read"));
	assert.ok(askNames.includes("project_tree"));
	assert.ok(toolRegistry.buildPromptToolNameUnion({ agentMode: "ask" }).includes("read_many"));
	assert.ok(toolRegistry.buildNativeToolDefinitions({ agentMode: "research" }).some((tool) => tool.name === "search_and_read"));
});

test("plan_write is model-only planning infrastructure hidden from user manifests", async () => {
	const { registry, manifest } = await loadModules();
	const toolRegistry = registry.ToolRegistry.getInstance();
	const planWrite = toolRegistry.get("plan_write");

	assert.ok(planWrite, "plan_write should be registered");
	assert.equal(planWrite.modelOnly, true);
	assert.equal(planWrite.userVisible, false);
	assert.equal(planWrite.category, "planning");
	assert.equal(planWrite.resultKind, "plan");
	assert.equal(planWrite.readOnly, true);
	assert.equal(planWrite.concurrencySafe, false, "plan writes must run before other tool work");
	assert.equal(planWrite.mutatesVault, false);
	assert.equal(planWrite.mutatesExternal, false);

	const askTools = toolRegistry.listForAgentMode("ask").map((tool) => tool.name);
	assert.ok(askTools.includes("plan_write"), "normal agent modes should expose plan_write to the model");
	assert.ok(toolRegistry.buildNativeToolDefinitions({ agentMode: "research" }).some((tool) => tool.name === "plan_write"));
	assert.ok(toolRegistry.buildPromptToolNameUnion({ agentMode: "write" }).includes("plan_write"));

	const readOnlyAllowlist = toolRegistry.listForAgentMode("ask", { allowedTools: ["read"] }).map((tool) => tool.name);
	assert.ok(readOnlyAllowlist.includes("read"));
	assert.ok(readOnlyAllowlist.includes("plan_write"), "file-tool allowlists should not remove harness planning");
	assert.deepEqual(manifest.findToolManifest("plan_write"), null);
	assert.ok(!toolRegistry.listManifests().some((tool) => tool.name === "plan_write"));
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

	for (const name of ["ls", "read", "read_many", "grep", "search_text", "search_and_read", "glob", "project_tree", "write", "edit", "delete"]) {
		assert.match(lineFor(name), /project-relative/i, `${name} prompt line should use project-relative guidance`);
		assert.doesNotMatch(lineFor(name), /Vault-relative path/i, `${name} prompt line should not require vault-relative paths`);
	}
});
