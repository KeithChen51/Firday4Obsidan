/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const templatePath = path.join(projectRoot, "src/features/soul/SoulExperimentTemplates.ts");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function read(filePath) {
	assert.ok(fs.existsSync(filePath), `${path.basename(filePath)} should exist`);
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("soul experiment templates define a vivid MBTI alpha set with visible role titles", () => {
	const source = read(templatePath);
	const typeCodes = [...source.matchAll(/typeCode:\s*"([EI][NS][TF][JP])"/g)].map((match) => match[1]);

	assert.deepEqual(typeCodes, ["INTJ", "ENTP", "INFJ", "ENFP", "ISTJ", "ESTP"]);
	assert.match(source, /MBTI_SOUL_TEMPLATES/);
	assert.match(source, /SOUL_EXPERIMENT_TEMPLATE_SERIES/);
	assert.match(source, /seriesId:\s*"mbti-communication"/);
	assert.match(source, /MBTI 沟通风格实验/);

	assert.match(source, /const name = `\$\{input\.typeCode\} · \$\{input\.archetype\}`;/);
	for (const [typeCode, archetype] of [
		["INTJ", "战略军师"],
		["ENTP", "反方辩手"],
		["INFJ", "深度洞察者"],
		["ENFP", "灵感火花"],
		["ISTJ", "秩序管家"],
		["ESTP", "现场推进者"],
	]) {
		assert.ok(source.includes(`typeCode: "${typeCode}"`), `Expected MBTI type code: ${typeCode}`);
		assert.ok(source.includes(`archetype: "${archetype}"`), `Expected visible role archetype: ${archetype}`);
	}
});

test("mbti soul templates define differentiated communication dimensions", () => {
	const source = read(templatePath);

	for (const field of [
		"responseRhythm",
		"informationStructure",
		"feedbackStyle",
		"riskBoundary",
	]) {
		const occurrences = source.match(new RegExp(`${field}:\\s*"`, "g")) ?? [];
		assert.equal(occurrences.length, 6, `${field} should be written for all 6 templates`);
		assert.match(source, new RegExp(`${field}: input\\.${field}`));
	}

	for (const field of [
		"responseRhythm: string",
		"informationStructure: string",
		"feedbackStyle: string",
		"riskBoundary: string",
		"bestFor: string\\[\\]",
	]) {
		assert.match(source, new RegExp(field));
	}

	const bestForOccurrences = source.match(/bestFor:\s*\[/g) ?? [];
	assert.equal(bestForOccurrences.length, 6, "bestFor should be written for all 6 templates");

	for (const expected of [
		"目标 → 约束 → 关键变量 → 方案排序 → 长期代价",
		"默认假设 → 反向观点 → 替代路线 → 小实验",
		"表层问题 → 隐含动机 → 反复模式 → 现实下一步",
		"可能性池 → 灵感连接 → 小原型 → 轻量行动",
		"已知事实 → 缺口 → 检查清单 → 验收标准",
		"当前局面 → 立刻动作 → 反馈信号 → 下一次调整",
	]) {
		assert.ok(source.includes(expected), `Expected distinct information structure: ${expected}`);
	}
});

test("mbti soul templates are framed as communication preferences, not personality diagnosis", () => {
	const source = read(templatePath);

	for (const expected of [
		"受 16 型沟通偏好启发",
		"不是心理测评",
		"不推断或评价用户的人格类型",
		"不要把 MBTI 标签当成用户身份或能力判断。",
	]) {
		assert.ok(source.includes(expected), `Expected MBTI template framing to include: ${expected}`);
	}
});

test("mbti soul templates preserve FRIDAY as identity and untranslated product name", () => {
	const source = read(templatePath);

	for (const expected of [
		"无论切换到哪个 MBTI Soul，你的自我认知始终是 FRIDAY。",
		"FRIDAY 是专名，始终原样使用",
		"不要把它当作普通英文词翻译或解释",
	]) {
		assert.ok(source.includes(expected), `Expected FRIDAY identity rule: ${expected}`);
	}
	assert.match(source, /`你是 FRIDAY；\$\{name\} 只定义当前沟通风格。`/);
	assert.doesNotMatch(source, /`你是 \$\{name\} FRIDAY。`/);
});

test("mbti soul templates model identity voice separately from style disclosure", () => {
	const source = read(templatePath);

	for (const field of [
		"identityVoice: string",
		"styleDisclosure: string",
		"identityVoice: input.identityVoice",
		"styleDisclosure: input.styleDisclosure",
	]) {
		assert.ok(source.includes(field), `Expected structured identity field: ${field}`);
	}
	assert.equal(source.match(/identityVoice:\s*"/g)?.length ?? 0, 6, "each MBTI template needs an identity voice");
	assert.equal(source.match(/styleDisclosure:\s*"/g)?.length ?? 0, 6, "each MBTI template needs a style disclosure");
	assert.equal(
		source.match(/identityVoice:\s*"可以叫我 FRIDAY/g)?.length ?? 0,
		6,
		"each MBTI identity voice should be a natural self-introduction, not a bare label fragment",
	);
	for (const expected of [
		"可以叫我 FRIDAY。我会先把混乱信息压成判断、路径和下一步。",
		"可以叫我 FRIDAY。我会先把散掉的念头点成一把小火花，再帮你选一个马上能试的方向。",
		"可以叫我 FRIDAY。少绕路，先把眼前能动的一步找出来。",
		"当前是 ENFP · 灵感火花沟通风格",
	]) {
		assert.ok(source.includes(expected), `Expected style-specific identity design: ${expected}`);
	}
	assert.ok(!source.includes('identityVoice: "FRIDAY。'), "identity voice should not be a bare FRIDAY label fragment");
	assert.ok(
		!source.includes("被问“你是谁”时，直接回答“我是 FRIDAY”。"),
		"template should not force a single mechanical identity answer",
	);
});

test("settings soul section opens Soul Lab and creates editable souls from templates", () => {
	const source = read(settingsPath);

	assert.match(source, /SoulExperimentTemplate/);
	assert.match(source, /SOUL_EXPERIMENT_TEMPLATE_SERIES/);
	assert.match(source, /private soulPanelMode: "manage" \| "lab"/);
	assert.match(source, /private renderSoulLabSection\(containerEl: HTMLElement\): void/);
	assert.match(source, /settings\.agent\.create\.fromTemplate/);
	assert.match(source, /settings\.soulLab\.title/);
	assert.match(source, /createSoulFromExperimentTemplate\(template, false\)/);
	assert.match(source, /createSoulFromExperimentTemplate\(template, true\)/);
	assert.match(source, /this\.host\.soulStore\.createSoul\(\{/);
	assert.match(source, /presetRefs:\s*\[template\.id\]/);
	assert.match(source, /tags:\s*template\.tags/);
	assert.match(source, /builtIn:\s*false/);
	assert.match(source, /template\.responseRhythm/);
	assert.match(source, /template\.informationStructure/);
	assert.match(source, /template\.feedbackStyle/);
	assert.match(source, /template\.riskBoundary/);
	assert.match(source, /template\.bestFor\.join/);
	assert.match(source, /identityVoice:\s*template\.identityVoice/);
	assert.match(source, /styleDisclosure:\s*template\.styleDisclosure/);
});

test("locales cover Soul Lab entry and MBTI series copy", () => {
	const zh = read(zhLocalePath);
	const en = read(enLocalePath);

	for (const source of [zh, en]) {
		assert.match(source, /settings\.agent\.create\.fromTemplate/);
		assert.match(source, /settings\.soulLab\.title/);
		assert.match(source, /settings\.soulLab\.mbti\.title/);
		assert.match(source, /settings\.soulLab\.create/);
		assert.match(source, /settings\.soulLab\.createCurrent/);
	}

	assert.ok(zh.includes('"settings.soulLab.mbti.title": "MBTI 沟通风格实验"'));
	assert.ok(zh.includes("第一批"));
	assert.ok(en.includes('"settings.soulLab.mbti.title": "MBTI Communication Style Experiments"'));
	assert.ok(en.includes("first alpha set"));
});
