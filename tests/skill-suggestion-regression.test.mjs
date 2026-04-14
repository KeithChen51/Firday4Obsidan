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

const servicePath = path.join(projectRoot, "src/services/SkillCommandService.ts");

async function loadSkillServiceModule() {
	return jiti.import(servicePath);
}

function createService(mod) {
	return new mod.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [], disabledSkills: [] } }),
		() => projectRoot,
		() => "zh-CN",
	);
}

test("skill suggestions can promote json-canvas for chinese whiteboard prompts", async () => {
	const mod = await loadSkillServiceModule();
	const service = createService(mod);
	const suggestions = await service.suggestSkillsForPrompt("对胖东来这几个文件构建白板");
	assert.equal(suggestions[0]?.skill.command, "json-canvas");
});

test("skill suggestion source no longer contains hardcoded compile or obsidian-cli priority boosts", async () => {
	const source = fs.readFileSync(servicePath, "utf8");
	assert.doesNotMatch(source, /OBSIDIAN_CLI_PRIORITY_PATTERNS/);
	assert.doesNotMatch(source, /compile-wiki 技能触发规则/);
	assert.doesNotMatch(source, /Obsidian CLI 高优先级运行态操作规则/);
});
