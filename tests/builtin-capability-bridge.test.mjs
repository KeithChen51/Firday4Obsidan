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
const compileCapabilityPath = path.join(projectRoot, "src/platform/capability/WikiCompileCapability.ts");
const lookupCapabilityPath = path.join(projectRoot, "src/platform/capability/WikiLookupCapability.ts");
const memoryStorePath = path.join(projectRoot, "src/core/memory/MemoryStoreV1.ts");
const conflictCapabilityPath = path.join(projectRoot, "src/platform/capability/GitConflictCapability.ts");

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

async function loadCapabilityModules() {
	return {
		compile: await jiti.import(compileCapabilityPath),
		lookup: await jiti.import(lookupCapabilityPath),
		memory: await jiti.import(memoryStorePath),
		conflict: await jiti.import(conflictCapabilityPath),
	};
}

test("builtin execution paths are bridged through dedicated capability modules", async () => {
	const source = readRuntimeSource();
	assert.match(source, /WikiCompileCapability/);
	assert.match(source, /WikiLookupCapability/);
	assert.match(source, /MemoryStoreV1/);
	assert.match(source, /GitConflictCapability/);
	assert.doesNotMatch(source, /runLookupWikiSkill\(/);
	assert.doesNotMatch(source, /runMaintainMemorySkill\(/);
	assert.doesNotMatch(source, /runResolveConflictSkill\(/);
	assert.match(source, /wikiLookupCapability\.execute\(/);
	assert.match(source, /memoryStore\.write\(/);
	assert.match(source, /memoryStore\.readPromptContext\(/);
	assert.match(source, /gitConflictCapability\.generateProposal\(/);
	assert.match(source, /wikiCompileCapability\.execute\(/);
});

test("capability bridge modules export executable classes", async () => {
	const modules = await loadCapabilityModules();
	assert.equal(typeof modules.compile.WikiCompileCapability, "function");
	assert.equal(typeof modules.lookup.WikiLookupCapability, "function");
	assert.equal(typeof modules.memory.MemoryStoreV1, "function");
	assert.equal(typeof modules.conflict.GitConflictCapability, "function");
});
