/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/services/SkillCommandService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("single slash opens skill catalog mode", async () => {
	const mod = await loadModule();
	const service = new mod.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [] } }),
		() => projectRoot,
	);
	const parsed = service.parseSlashCommand("/");
	assert.equal(parsed.type, "list");
});

test("skill system context supports auto invocation metadata", async () => {
	const mod = await loadModule();
	const service = new mod.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [] } }),
		() => projectRoot,
	);
	const context = await service.buildSkillSystemContext("obsidian-cli", {
		invocationMode: "auto",
		selectionReason: "matched live obsidian operation",
	});
	assert.equal(context.skill.command, "obsidian-cli");
	assert.equal(context.systemContext.includes("mode: auto"), true);
	assert.equal(context.systemContext.includes("selection_reason: matched live obsidian operation"), true);
	assert.equal(context.systemContext.includes("auto-matched"), true);
});

test("obsidian cli is prioritized for live obsidian operations", async () => {
	const mod = await loadModule();
	const service = new mod.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [] } }),
		() => projectRoot,
	);
	const suggestions = await service.suggestSkillsForPrompt("在 Obsidian 里重载 friday 插件并截图检查界面");
	assert.equal(suggestions[0]?.skill.command, "obsidian-cli");
});
