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

const capabilityRegistryPath = path.join(projectRoot, "src/core/capability/CapabilityRegistry.ts");
const skillRegistryPath = path.join(projectRoot, "src/core/execution/SkillRegistry.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const settingsTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");

async function loadRegistries() {
	const capability = await jiti.import(capabilityRegistryPath);
	const skill = await jiti.import(skillRegistryPath);
	return { capability, skill };
}

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("capability registry exposes user-visible tools and internal capabilities", async () => {
	const { capability } = await loadRegistries();
	const registry = capability.CapabilityRegistry.getInstance();
	const userVisible = registry.listUserVisibleTools();
	const internal = registry.listInternalCapabilities();
	assert.ok(userVisible.some((item) => item.name === "compile_wiki"));
	assert.ok(userVisible.some((item) => item.name === "subagent"));
	assert.ok(internal.some((item) => item.id === "knowledge.lookup"));
	assert.ok(internal.some((item) => item.id === "memory.persist"));
});

test("skill registry groups builtin and personal skills consistently", async () => {
	const { skill } = await loadRegistries();
	const registry = skill.SkillRegistry.getInstance();
	const groups = registry.groupDescriptors([
		{
			name: "Compile Wiki",
			description: "compile",
			filePath: "builtin://compile-wiki/SKILL.md",
			command: "compile-wiki",
			aliases: [],
			tags: [],
			globs: [],
			trigger: "auto",
		},
		{
			name: "Custom Skill",
			description: "custom",
			filePath: "C:/tmp/custom/SKILL.md",
			command: "custom-skill",
			aliases: [],
			tags: [],
			globs: [],
			trigger: "manual",
		},
	]);
	assert.equal(groups.builtinSkills.length, 1);
	assert.equal(groups.personalSkills.length, 1);
	assert.equal(groups.builtinSkills[0]?.command, "compile-wiki");
	assert.equal(groups.personalSkills[0]?.command, "custom-skill");
});

test("daily board and settings consume capability registry instead of raw tool manifest array", () => {
	const dailyBoardSource = readSource(dailyBoardPath);
	const settingsSource = readSource(settingsTabPath);
	assert.match(dailyBoardSource, /CapabilityRegistry/);
	assert.match(settingsSource, /CapabilityRegistry/);
	assert.doesNotMatch(dailyBoardSource, /import\s+\{\s*TOOL_MANIFESTS/);
	assert.doesNotMatch(settingsSource, /import\s+\{\s*TOOL_MANIFESTS/);
	assert.doesNotMatch(dailyBoardSource, /for\s*\(const tool of TOOL_MANIFESTS\)/);
	assert.doesNotMatch(settingsSource, /for\s*\(const tool of TOOL_MANIFESTS\)/);
});
