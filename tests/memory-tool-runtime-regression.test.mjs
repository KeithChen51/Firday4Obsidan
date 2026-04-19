/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const promptContextPath = path.join(projectRoot, "src/core/context/PromptContextEngine.ts");
const manifestPath = path.join(projectRoot, "src/platform/tools/ToolManifestCatalog.ts");

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("runtime exposes explicit memory tool and removes legacy maintain-memory shortcut", async () => {
	const runtimeSource = readSource(runtimePath);
	const manifestSource = readSource(manifestPath);
	assert.match(manifestSource, /name:\s*"memory"/);
	assert.doesNotMatch(manifestSource, /name:\s*"subagent"/);
	assert.doesNotMatch(runtimeSource, /maintain-memory/);
	assert.doesNotMatch(runtimeSource, /memory\.extraction_requested/);
});

test("runtime memory copy explains next-turn visibility instead of mutating current turn", async () => {
	const runtimeSource = readSource(runtimePath);
	assert.match(runtimeSource, /next turn/i);
	assert.match(runtimeSource, /loadMemoryContext/);
	assert.doesNotMatch(runtimeSource, /Memory extraction attempted/);
});

test("prompt context engine documents the memory tool contract and no longer documents subagent envelopes", async () => {
	const source = readSource(promptContextPath);
	assert.match(source, /memory/);
	assert.match(source, /action":"add\|replace\|remove/);
	assert.match(source, /scope":"global\|project/);
	assert.doesNotMatch(source, /"type":"subagent"/);
});
