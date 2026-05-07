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
const orchestratorPath = path.join(projectRoot, "src/core/execution/ExecutionOrchestrator.ts");
const promptContextPath = path.join(projectRoot, "src/core/context/PromptContextEngine.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const toolAdapterPath = path.join(projectRoot, "src/services/tools/ObsidianToolAdapter.ts");
const toolHandlersPath = path.join(projectRoot, "src/services/tools/ObsidianToolHandlers.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const registryPath = path.join(projectRoot, "src/core/tools/ToolRegistry.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("generic runtime context is built from skill catalog summaries instead of preselected skill content", async () => {
	const source = read(orchestratorPath);
	assert.match(source, /buildSkillCatalogContext\(/);
	assert.doesNotMatch(source, /suggestSkillsForPrompt/);
});

test("prompt context teaches the model to load skills through use_skill before execution", async () => {
	const source = read(promptContextPath);
	assert.match(source, /use_skill/);
	assert.match(source, /SkillCatalog/);
	assert.match(source, /call use_skill first/i);
});

test("agent runtime exposes use_skill as a first-class runtime tool and reinjects loaded skill context", async () => {
	const registry = await jiti.import(registryPath);
	const useSkill = registry.ToolRegistry.getInstance().get("use_skill");
	const source = read(runtimePath);
	const adapterSource = read(toolAdapterPath);
	const handlersSource = read(toolHandlersPath);
	assert.equal(useSkill?.handlerName, "toolUseSkill");
	assert.equal(useSkill?.category, "skill");
	assert.match(source, /ObsidianToolAdapter/);
	assert.match(adapterSource, /name === "use_skill"/);
	assert.match(handlersSource, /async toolUseSkill\(/);
	assert.match(source, /extractLoadedSkillSystemContext\(/);
	assert.match(source, /role:\s*"system", content: loadedSkillContext/);
});

test("main wires execution planner without local skill suggestion scoring", async () => {
	const source = read(mainPath);
	assert.match(source, /new ExecutionPlanner\(\)/);
	assert.doesNotMatch(source, /suggestSkillsForPrompt/);
});
