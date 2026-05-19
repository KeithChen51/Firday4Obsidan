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

test("runtime prompt assembly separates stable identity from style-specific identity voice", () => {
	const source = read(runtimePath);

	assert.match(source, /buildSoulIdentityProfile\(soulDefinition\)/);
	assert.match(source, /const soulIdentityProfile = this\.buildSoulIdentityProfile\(soulDefinition\);/);
	assert.match(source, /identityVoice\?\.\s*trim\(\)/);
	assert.match(source, /styleDisclosure\?\.\s*trim\(\)/);
	for (const expected of [
		"identity name: FRIDAY",
		"active Soul changes voice, not identity",
		"identity question handling:",
		"identity answer voice:",
		"style disclosure when asked:",
		"Do not answer identity questions with only the bare identity name.",
		"Use these as behavior specs, not text to recite.",
	]) {
		assert.ok(source.includes(expected), `Expected structured identity profile: ${expected}`);
	}
	assert.doesNotMatch(source, /buildFridayIdentityPrompt/);
	assert.ok(!source.includes("被问身份只答“我是 FRIDAY”"));
});

test("runtime derives style-specific identity voice for copied MBTI souls", () => {
	const source = read(runtimePath);

	for (const expected of [
		"resolveSoulIdentityVoice(soulDefinition)",
		"resolveSoulStyleDisclosure(soulDefinition)",
		"resolveMbtiIdentityProfile(soulDefinition)",
		"mbti-enfp",
		"可以叫我 FRIDAY。我会先把散掉的念头点成一把小火花，再帮你选一个马上能试的方向。",
		"当前是 ENFP · 灵感火花沟通风格",
		"normalizeSoulBehaviorRulesForIdentity(soulDefinition)",
		"normalizeSoulAntiPatternsForIdentity(soulDefinition)",
	]) {
		assert.ok(source.includes(expected), `Expected style-specific runtime identity support: ${expected}`);
	}
	assert.ok(
		!source.includes("FRIDAY 是产品名，别译成“周五”“周五伙伴”。"),
		"runtime identity profile should not contain translation examples that the model may repeat",
	);
});

test("runtime upgrades legacy MBTI identity voice fragments before prompt assembly", () => {
	const source = read(runtimePath);

	for (const expected of [
		"normalizeSoulIdentityVoice(soulDefinition, explicitVoice)",
		"isLegacyBareIdentityVoice(voice)",
		"this.isLegacyBareIdentityVoice(voice) && this.isMbtiSoulDefinition(soulDefinition)",
		"return this.resolveMbtiIdentityProfile(soulDefinition)?.identityVoice",
	]) {
		assert.ok(source.includes(expected), `Expected legacy identity voice upgrade support: ${expected}`);
	}
});

test("runtime prompt assembly sanitizes copied MBTI role prompts before model use", () => {
	const source = read(runtimePath);

	assert.match(source, /normalizeSoulRolePromptForIdentity\(soulDefinition\)/);
	assert.match(source, /isMbtiSoulDefinition\(soulDefinition\)/);
	assert.match(source, /const presetRefs = Array\.isArray\(soulDefinition\.presetRefs\)/);
	assert.match(source, /const tags = Array\.isArray\(soulDefinition\.tags\)/);
	assert.match(source, /presetRefs\.some\(\(item\) => item\.startsWith\("mbti-"\)\)/);
	assert.match(source, /tags\.includes\("mbti"\)/);
	assert.ok(source.includes('.replace(/^你是 [A-Z]{4} · [^。\\n]+ FRIDAY。\\n?/u,'));
	assert.ok(source.includes('"你是 FRIDAY。MBTI 只影响沟通方式，不改变身份。\\n"'));
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
