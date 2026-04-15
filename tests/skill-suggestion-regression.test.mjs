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

test("skill glob conversion accepts raw path patterns", async () => {
	const mod = await loadSkillServiceModule();
	const service = createService(mod);
	const regex = service.globToRegex("**/raw/**");
	assert.equal(regex.test("0002_哲学/raw/胖东来/胖东来企业全面调研报告.md"), true);
});

test("skill suggestions accept currentFilePath values under raw directories", async () => {
	const mod = await loadSkillServiceModule();
	const service = createService(mod);
	const suggestions = await service.suggestSkillsForPrompt(
		"对胖东来这几个文件构建白板",
		"0002_哲学/raw/胖东来/胖东来企业全面调研报告.md",
	);
	assert.ok(suggestions.length > 0);
	assert.equal(suggestions[0]?.skill.command, "json-canvas");
});

test("skill suggestions give whiteboard prompts enough confidence for planner auto-selection", async () => {
	const mod = await loadSkillServiceModule();
	const service = createService(mod);
	const suggestions = await service.suggestSkillsForPrompt(
		"提灯的结构是什么样的，做一个白板",
		"00_02_哲学/workspace/“Lantern (提灯)”企业文化数字平台.md",
	);
	assert.ok(suggestions.length > 0);
	assert.equal(suggestions[0]?.skill.command, "json-canvas");
	assert.ok((suggestions[0]?.score ?? 0) >= 8);
});

test("skill catalog context exposes summaries but does not inline full skill markdown", async () => {
	const mod = await loadSkillServiceModule();
	const service = createService(mod);
	const catalog = await service.buildSkillCatalogContext({
		currentFilePath: "00_02_哲学/workspace/“Lantern (提灯)”企业文化数字平台.md",
	});
	assert.match(catalog, /\[SkillCatalog\]/);
	assert.match(catalog, /use_skill/);
	assert.match(catalog, /json-canvas/);
	assert.doesNotMatch(catalog, /skill_markdown:/);
});

test("skill suggestion source no longer contains hardcoded compile or obsidian-cli priority boosts", async () => {
	const source = fs.readFileSync(servicePath, "utf8");
	assert.doesNotMatch(source, /OBSIDIAN_CLI_PRIORITY_PATTERNS/);
	assert.doesNotMatch(source, /compile-wiki 技能触发规则/);
	assert.doesNotMatch(source, /Obsidian CLI 高优先级运行态操作规则/);
});
