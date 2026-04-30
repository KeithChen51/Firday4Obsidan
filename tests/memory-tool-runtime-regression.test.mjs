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
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const promptContextPath = path.join(projectRoot, "src/core/context/PromptContextEngine.ts");
const manifestPath = path.join(projectRoot, "src/platform/tools/ToolManifestCatalog.ts");

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("runtime exposes explicit memory tool and removes legacy maintain-memory shortcut", async () => {
	const manifest = await jiti.import(manifestPath);
	const runtimeSource = readSource(runtimePath);
	assert.equal(manifest.findToolManifest("memory")?.capability, "memory.write");
	assert.equal(manifest.findToolManifest("subagent"), null);
	assert.doesNotMatch(runtimeSource, /maintain-memory/);
	assert.doesNotMatch(runtimeSource, /memory\.extraction_requested/);
});

test("runtime memory copy explains next-turn visibility instead of mutating current turn", async () => {
	const registry = await jiti.import(path.join(projectRoot, "src/core/tools/ToolRegistry.ts"));
	const runtimeSource = readSource(runtimePath);
	assert.match(registry.ToolRegistry.getInstance().get("memory")?.description ?? "", /next turn/i);
	assert.match(runtimeSource, /loadMemoryContext/);
	assert.doesNotMatch(runtimeSource, /Memory extraction attempted/);
});

test("prompt context engine documents the memory tool contract and no longer documents subagent envelopes", async () => {
	const mod = await jiti.import(promptContextPath);
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "Remember this",
		agentProfile: "agent",
	});
	assert.match(result.prompt, /memory/);
	assert.match(result.prompt, /action":"add\|replace\|remove/);
	assert.match(result.prompt, /scope":"global\|project/);
	assert.doesNotMatch(result.prompt, /"type":"subagent"/);
});
