/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const soulTypePath = path.join(projectRoot, "src/types/soul.ts");
const pluginTypePath = path.join(projectRoot, "src/types/plugin.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const mainPath = path.join(projectRoot, "src/main.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("soul definition stores a structured tone preset alongside optional tone text", () => {
	const source = read(soulTypePath);
	assert.match(source, /export type SoulTonePreset = "balanced" \| "calm" \| "warm";/);
	assert.match(source, /tonePreset: SoulTonePreset;/);
	assert.match(source, /tonePrompt: string;/);
});

test("settings tab replaces freeform tone prompt editing with preset dropdown plus optional note", () => {
	const source = read(settingsPath);
	assert.match(source, /settings\.agent\.profile\.tonePreset/);
	assert.match(source, /settings\.agent\.profile\.tonePresetDesc/);
	assert.match(source, /dropdown\.addOption\("balanced"/);
	assert.match(source, /dropdown\.addOption\("calm"/);
	assert.match(source, /dropdown\.addOption\("warm"/);
	assert.match(source, /settings\.agent\.profile\.toneNote/);
	assert.match(source, /settings\.agent\.profile\.toneNoteDesc/);
	assert.doesNotMatch(source, /setName\(this\.t\("settings\.agent\.profile\.tone", "语气提示（可选）"\)\)/);
});

test("runtime prompt assembly resolves tone presets into stable prompt text", () => {
	const source = read(runtimePath);
	assert.match(source, /resolveSoulTonePrompt\(/);
	assert.match(source, /soulDefinition\.tonePreset/);
	assert.match(source, /soulDefinition\.tonePrompt/);
});

test("runtime prompt assembly delegates identity and style behavior to Soul Profile v2", () => {
	const source = read(runtimePath);

	assert.match(source, /compileSoulProfileForPrompt/);
	assert.match(source, /buildSoulProfilePrompt\(soulDefinition, userPrompt \?\? ""\)/);
	assert.match(source, /const soulProfilePrompt = this\.buildSoulProfilePrompt\(soulDefinition, userPrompt \?\? ""\);/);
	assert.match(source, /soulDefinition\?\.profile/);
	for (const expected of [
		"soulProfilePrompt",
		"soulProfilePrompt,",
		"soulDefinition.rolePrompt",
		"soulDefinition.behaviorRules.length > 0",
		"soulDefinition.antiPatterns.length > 0",
	]) {
		assert.ok(source.includes(expected), `Expected Soul profile prompt assembly: ${expected}`);
	}
	assert.doesNotMatch(source, /buildFridayIdentityPrompt/);
	assert.doesNotMatch(source, /buildSoulIdentityProfile/);
	assert.ok(!source.includes("identity answer voice:"));
	assert.ok(!source.includes("style disclosure when asked:"));
	assert.ok(!source.includes("被问身份只答“我是 FRIDAY”"));
});

test("copied MBTI souls carry their profile from the template instead of runtime fallback maps", () => {
	const runtimeSource = read(runtimePath);
	const settingsSource = read(settingsPath);

	assert.match(settingsSource, /profile:\s*template\.profile/);
	assert.doesNotMatch(settingsSource, /identityVoice:\s*template\.identityVoice/);
	assert.doesNotMatch(settingsSource, /styleDisclosure:\s*template\.styleDisclosure/);
	assert.doesNotMatch(runtimeSource, /resolveMbtiIdentityProfile/);
	assert.doesNotMatch(runtimeSource, /mbti-enfp/);
	assert.ok(
		!runtimeSource.includes("FRIDAY 是产品名，别译成“周五”“周五伙伴”。"),
		"runtime profile prompt should not contain translation examples that the model may repeat",
	);
});

test("runtime does not keep legacy MBTI identity upgrade paths when v1 migration is out of scope", () => {
	const source = read(runtimePath);

	for (const forbidden of [
		"normalizeSoulIdentityVoice",
		"isLegacyBareIdentityVoice",
		"resolveMbtiIdentityProfile",
		"resolveSoulIdentityVoice",
		"resolveSoulStyleDisclosure",
	]) {
		assert.ok(!source.includes(forbidden), `Legacy identity path should be removed: ${forbidden}`);
	}
});

test("runtime prompt assembly uses raw Soul text plus structured profile policy", () => {
	const source = read(runtimePath);

	assert.match(source, /soulProfilePrompt,/);
	assert.match(source, /soulDefinition\.rolePrompt/);
	assert.match(source, /soulDefinition\.behaviorRules\.length > 0/);
	assert.match(source, /soulDefinition\.antiPatterns\.length > 0/);
	assert.doesNotMatch(source, /normalizeSoulRolePromptForIdentity/);
	assert.doesNotMatch(source, /normalizeSoulBehaviorRulesForIdentity/);
	assert.doesNotMatch(source, /normalizeSoulAntiPatternsForIdentity/);
	assert.doesNotMatch(source, /isMbtiSoulDefinition/);
});

test("native friday preset seeds the warm tone preset", () => {
	const source = read(mainPath);
	assert.match(source, /tonePreset: "warm"/);
	assert.match(source, /亲和、自然、有分寸/);
});

test("native friday preset carries anti-ai response rules and bumps preset version", () => {
	const source = read(mainPath);
	assert.match(source, /NATIVE_FRIDAY_SOUL_PRESET_VERSION = 3/);
	assert.match(source, /LEGACY_NATIVE_FRIDAY_SOUL_PRESET_V2/);
	assert.match(source, /matchesBuiltInSoulPreset\(soul, LEGACY_NATIVE_FRIDAY_SOUL_PRESET_V2\)/);
	for (const expected of [
		"回答要像熟悉上下文的合作者，而不是 AI 助手或宣传文案。",
		"直接说明事实、判断和下一步，不用开场白铺垫。",
		"完成任务后只说明结果、验证和未完成项，不追加客套结尾。",
		"不要使用“当然可以”“一定”“好问题”“你说得完全正确”“希望这对你有帮助”“请告诉我”等聊天机器人套话。",
		"不要使用“此外”“值得注意的是”“不仅仅是……而是……”“综上所述”等模板连接。",
	]) {
		assert.ok(source.includes(expected), `Expected native FRIDAY preset to include: ${expected}`);
	}
});

test("native friday refresh recognizes branded v2 built-in preset", () => {
	const source = read(mainPath);
	assert.match(source, /LEGACY_NATIVE_FRIDAY_SOUL_PRESET_V2_BRANDED/);
	assert.ok(source.includes('name: "原生F.R.I.D.A.Y"'));
	assert.ok(source.includes("原生 F.R.I.D.A.Y 以自然、低压的方式陪用户推进工作。"));
	assert.match(source, /matchesBuiltInSoulPreset\(soul, LEGACY_NATIVE_FRIDAY_SOUL_PRESET_V2_BRANDED\)/);
});

test("challenger friday is seeded as a second built-in soul", () => {
	const source = read(mainPath);
	for (const expected of [
		'CHALLENGER_FRIDAY_SOUL_ID = "challenger"',
		'CHALLENGER_FRIDAY_SOUL_PRESET_VERSION = 2',
		'name: "质询型 FRIDAY"',
		"像一位高标准、挑剔但负责的领导",
		"先指出当前方案、表达或判断里最薄弱的一环。",
		"默认只在对话中完成质询、判断和追问。",
		"不得主动创建、修改或保存 Obsidian 文档。",
		"只有当用户明确要求写入、保存、生成文档、创建文件或更新笔记时，才允许提出文件写入动作。",
		"不要羞辱用户、挖苦用户或做人身评价。",
		"不要把质询、咨询、复盘或记录问题理解为必须生成文档。",
		"ensureBuiltInSoulPreset(CHALLENGER_FRIDAY_SOUL_ID",
	]) {
		assert.ok(source.includes(expected), `Expected challenger built-in Soul preset to include: ${expected}`);
	}
});

test("challenger friday refresh recognizes v1 built-in preset", () => {
	const source = read(mainPath);
	assert.match(source, /LEGACY_CHALLENGER_FRIDAY_SOUL_PRESET_V1/);
	assert.match(source, /matchesBuiltInSoulPreset\(soul, LEGACY_CHALLENGER_FRIDAY_SOUL_PRESET_V1\)/);
});

test("built-in soul reset works for all built-in presets, not only default", () => {
	const mainSource = read(mainPath);
	const settingsSource = read(settingsPath);
	const pluginTypeSource = read(pluginTypePath);

	assert.match(mainSource, /canResetBuiltInSoulPreset\(soulId: string\): boolean/);
	assert.match(mainSource, /resolveBuiltInSoulPreset\(soulId\)/);
	assert.match(settingsSource, /this\.host\.canResetBuiltInSoulPreset\(activeSoulDefinition\.id\)/);
	assert.doesNotMatch(settingsSource, /activeSoulDefinition\.id\.startsWith\("default"\)/);
	assert.match(pluginTypeSource, /canResetBuiltInSoulPreset\(soulId: string\): boolean;/);
});
