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

async function loadSkillService() {
	return jiti.import(modulePath);
}

test("inline explicit /skill invocation still resolves when the prompt already has text", async () => {
	const mod = await loadSkillService();
	const service = new mod.SkillCommandService(
		{},
		() => ({ agentRuntime: { disabledSkills: [], externalSkillPaths: [] } }),
		() => projectRoot,
		() => "zh-CN",
	);

	const result = service.parseSlashCommand("先看一下现状，再 /skill investigate 定位对话框闪烁根因");

	assert.deepEqual(result, {
		type: "use",
		skillName: "investigate",
		taskPrompt: "先看一下现状，再 定位对话框闪烁根因",
	});
});
