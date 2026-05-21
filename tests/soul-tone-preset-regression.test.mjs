/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const soulSettingsSectionPath = path.join(projectRoot, "src/settings/sections/SoulSettingsSection.ts");
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
	const source = read(soulSettingsSectionPath);
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
	assert.match(source, /NATIVE_FRIDAY_SOUL_PRESET_VERSION = 4/);
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

test("challenger friday is no longer seeded as a standalone built-in soul", () => {
	const source = read(mainPath);
	for (const forbidden of [
		'CHALLENGER_FRIDAY_SOUL_ID = "challenger"',
		"CHALLENGER_FRIDAY_SOUL_PRESET_VERSION",
		"LEGACY_CHALLENGER_FRIDAY_SOUL_PRESET_V1",
		"CHALLENGER_FRIDAY_SOUL_PRESET",
		"ensureBuiltInSoulPreset(CHALLENGER_FRIDAY_SOUL_ID",
		"matchesKnownChallengerPreset",
		"matchesBuiltInSoulPreset(soul, LEGACY_CHALLENGER_FRIDAY_SOUL_PRESET_V1)",
	]) {
		assert.ok(!source.includes(forbidden), `Standalone Challenger preset should be removed: ${forbidden}`);
	}
});

test("retired standalone challenger soul is removed from persisted SoulStore state", () => {
	const source = read(mainPath);

	assert.match(source, /RETIRED_STANDALONE_SOUL_IDS/);
	assert.match(source, /"challenger"/);
	assert.match(source, /removeRetiredStandaloneSouls/);
	assert.match(source, /this\.soulStore\.deleteSoul\(soul\.id\)/);
	assert.match(source, /!this\.isRetiredStandaloneSoulId\(item\.id\)/);
	assert.match(source, /this\.isRetiredStandaloneSoulId\(activeSoulId\)/);
});

test("ENTP Soul template absorbs Challenger-style critical feedback", () => {
	const templateSource = read(path.join(projectRoot, "src/features/soul/SoulExperimentTemplates.ts"));
	const profileSource = read(path.join(projectRoot, "src/features/soul/SoulProfile.ts"));

	assert.match(profileSource, /criticalFeedback\?:/);
	assert.match(templateSource, /criticalFeedback:\s*\{/);
	const entpBlock = templateSource.slice(templateSource.indexOf('typeCode: "ENTP"'), templateSource.indexOf('typeCode: "INFJ"'));
	for (const expected of [
		"目标",
		"证据",
		"边界",
		"取舍",
		"验收标准",
		"最薄弱的一环",
		"修正方向",
		"不要羞辱用户",
	]) {
		assert.ok(entpBlock.includes(expected), `ENTP should absorb Challenger capability: ${expected}`);
	}
});

test("built-in soul reset remains internal and is not exposed on read-only Soul rows", () => {
	const mainSource = read(mainPath);
	const settingsSource = read(settingsPath);
	const pluginTypeSource = read(pluginTypePath);

	assert.match(mainSource, /canResetBuiltInSoulPreset\(soulId: string\): boolean/);
	assert.match(mainSource, /resolveBuiltInSoulPreset\(soulId\)/);
	assert.doesNotMatch(settingsSource, /this\.host\.canResetBuiltInSoulPreset\(activeSoulDefinition\.id\)/);
	assert.doesNotMatch(settingsSource, /new Setting\(editorGroup\)[\s\S]{0,500}settings\.agent\.profile\.reset/);
	assert.doesNotMatch(settingsSource, /activeSoulDefinition\.id\.startsWith\("default"\)/);
	assert.match(pluginTypeSource, /canResetBuiltInSoulPreset\(soulId: string\): boolean;/);
});
