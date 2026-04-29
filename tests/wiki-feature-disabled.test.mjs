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

const builtinPackModulePath = path.join(projectRoot, "src/skills/packs/builtin/index.ts");
const capabilityRegistryPath = path.join(projectRoot, "src/core/capability/CapabilityRegistry.ts");
const toolManifestPath = path.join(projectRoot, "src/platform/tools/ToolManifestCatalog.ts");
const promptContextEnginePath = path.join(projectRoot, "src/core/context/PromptContextEngine.ts");
const skillCommandServicePath = path.join(projectRoot, "src/services/SkillCommandService.ts");

test("wiki tools and skills are hidden from users and unavailable to agents", async () => {
	const builtinPack = await jiti.import(builtinPackModulePath);
	const capability = await jiti.import(capabilityRegistryPath);
	const toolManifest = await jiti.import(toolManifestPath);

	const builtinCommands = builtinPack.BUILTIN_SKILL_DEFINITIONS.map((item) => item.command);
	assert.equal(builtinCommands.includes("compile-wiki"), false);
	assert.equal(builtinCommands.includes("lookup-wiki"), false);
	assert.equal(builtinPack.resolveBuiltinSkill("compile-wiki"), null);
	assert.equal(builtinPack.resolveBuiltinSkill("lookup-wiki"), null);

	const userVisibleTools = capability.CapabilityRegistry.getInstance()
		.listUserVisibleTools()
		.map((item) => item.name);
	assert.equal(userVisibleTools.includes("compile_wiki"), false);
	assert.equal(toolManifest.findToolManifest("compile_wiki"), null);

	const promptContextSource = fs.readFileSync(promptContextEnginePath, "utf8");
	assert.equal(promptContextSource.includes("compile_wiki"), false);
	assert.equal(promptContextSource.includes("compile/rebuild Wiki"), false);

	const skillServiceModule = await jiti.import(skillCommandServicePath);
	const skillService = new skillServiceModule.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [], disabledSkills: [] } }),
		() => projectRoot,
	);
	const visibleSkills = await skillService.listSkills(50);
	const visibleCommands = visibleSkills.map((item) => item.command);
	assert.equal(visibleCommands.includes("compile-wiki"), false);
	assert.equal(visibleCommands.includes("lookup-wiki"), false);
	await assert.rejects(() => skillService.buildSkillSystemContext("compile-wiki"), /未找到技能/);
	await assert.rejects(() => skillService.buildSkillSystemContext("lookup-wiki"), /未找到技能/);
});
