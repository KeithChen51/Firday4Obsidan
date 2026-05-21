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
const stylesPath = path.join(projectRoot, "styles.css");
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

	assert.match(source, /famousExamples: string\[\]/);
	assert.match(source, /famousExamples: input\.famousExamples/);
	assert.equal(
		source.match(/famousExamples:\s*\[/g)?.length ?? 0,
		6,
		"famousExamples should be written for all 6 templates as display-only Soul Lab context",
	);

	for (const field of [
		"responseRhythm: string",
		"informationStructure: string",
		"feedbackStyle: string",
		"riskBoundary: string",
		"bestFor: string\\[\\]",
		"famousExamples: string\\[\\]",
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

test("mbti soul templates model profile strategy instead of fixed identity scripts", () => {
	const source = read(templatePath);

	for (const field of [
		"profile: SoulProfile",
		"createMbtiSoulProfile",
		"profile: createMbtiSoulProfile",
		"identityExamples: string[]",
		"disclosureExamples: string[]",
		"identityExamples: input.identityExamples",
		"disclosureExamples: input.disclosureExamples",
		"posture: [input.roleFocus]",
	]) {
		assert.ok(source.includes(field), `Expected structured Soul profile field: ${field}`);
	}
	assert.equal(source.match(/identityExamples:\s*\[/g)?.length ?? 0, 6, "each MBTI template needs identity examples");
	assert.equal(source.match(/disclosureExamples:\s*\[/g)?.length ?? 0, 6, "each MBTI template needs disclosure examples");
	assert.equal(
		source.match(/identityExamples:\s*\[\s*"可以叫我 FRIDAY/g)?.length ?? 0,
		6,
		"each MBTI identity strategy should include natural self-introduction examples, not bare label fragments",
	);
	for (const expected of [
		"可以叫我 FRIDAY。我会先把混乱信息压成判断、路径和下一步。",
		"可以叫我 FRIDAY。我会先把散掉的念头点成一把小火花，再帮你选一个马上能试的方向。",
		"可以叫我 FRIDAY。少绕路，先把眼前能动的一步找出来。",
		"当前是 ENFP · 灵感火花沟通风格",
	]) {
		assert.ok(source.includes(expected), `Expected style-specific profile example: ${expected}`);
	}
	assert.ok(!source.includes("identityVoice: string"), "template interface should not expose identityVoice");
	assert.ok(!source.includes("styleDisclosure: string"), "template interface should not expose styleDisclosure");
	assert.ok(!source.includes("identityVoice: input.identityVoice"), "templates should not copy identity scripts");
	assert.ok(!source.includes("styleDisclosure: input.styleDisclosure"), "templates should not copy disclosure scripts");
	assert.ok(!source.includes('identityVoice: "FRIDAY。'), "identity strategy should not be a bare FRIDAY label fragment");
	assert.ok(
		!source.includes("被问“你是谁”时，直接回答“我是 FRIDAY”。"),
		"template should not force a single mechanical identity answer",
	);
});

test("settings soul section opens Soul Lab and subscribes read-only experiment souls", () => {
	const source = read(settingsPath);

	assert.match(source, /SoulExperimentTemplate/);
	assert.match(source, /SOUL_EXPERIMENT_TEMPLATE_SERIES/);
	assert.match(source, /private soulPanelMode: "manage" \| "lab" \| "editor"/);
	assert.match(source, /private soulLabDetailsExpanded = false/);
	assert.doesNotMatch(source, /soulLabPreviewTemplateId/);
	assert.match(source, /private renderSoulLabSection\(containerEl: HTMLElement\): void/);
	assert.match(source, /private renderSoulEditorSection\(containerEl: HTMLElement\): void/);
	assert.match(source, /private canEditSoul/);
	assert.match(source, /private isExperimentSoul/);
	assert.match(source, /private async setCurrentSoulFromSettings/);
	assert.match(source, /settings\.agent\.create\.fromTemplate/);
	assert.match(source, /settings\.soulLab\.title/);
	assert.match(source, /extraClass:\s*"friday-soul-lab-intro"/);
	assert.match(source, /friday-soul-lab-intro-header/);
	assert.match(source, /friday-soul-lab-back-button/);
	assert.match(source, /friday-soul-lab-series-header/);
	assert.match(source, /friday-soul-lab-detail-toggle/);
	assert.match(source, /settings\.soulLab\.detailsExpand/);
	assert.match(source, /settings\.soulLab\.detailsCollapse/);
	assert.doesNotMatch(source, /new Setting\(introGroup\)/);
	assert.doesNotMatch(source, /renderNativeInlineAlert\(introGroup/);
	assert.doesNotMatch(source, /settings\.soulLab\.notice/);
	assert.doesNotMatch(source, /settings\.soulLab\.backDesc/);
	assert.doesNotMatch(source, /createSoulFromExperimentTemplate\(template, false\)/);
	assert.doesNotMatch(source, /createSoulFromExperimentTemplate\(template, true\)/);
	assert.match(source, /toggleSoulExperimentTemplate\(template\)/);
	assert.match(source, /installSoulExperimentTemplate\(template\)/);
	assert.match(source, /removeSoulExperimentTemplate\(template\)/);
	assert.match(source, /const fallbackId = this\.getNativeSoulFallbackId/);
	assert.match(source, /await this\.host\.setActiveSoul\(fallbackId\)/);
	assert.match(source, /this\.host\.soulStore\.createSoul\(\{/);
	assert.match(source, /presetRefs:\s*\[template\.id\]/);
	assert.match(source, /tags:\s*template\.tags/);
	assert.match(source, /builtIn:\s*false/);
	assert.match(source, /editable:\s*false/);
	assert.match(source, /template\.responseRhythm/);
	assert.match(source, /template\.informationStructure/);
	assert.match(source, /template\.feedbackStyle/);
	assert.match(source, /template\.riskBoundary/);
	assert.match(source, /template\.bestFor\.join/);
	assert.match(source, /template\.famousExamples\.join/);
	assert.match(source, /profile:\s*template\.profile/);
	assert.match(source, /renderSoulTemplateCard/);
	assert.match(source, /renderSoulTemplateCard\(\s*gridEl,[\s\S]*detailsExpanded/);
	assert.match(source, /SOUL_SUGGESTION_FORM_URL/);
	assert.ok(
		source.includes("https://doc.weixin.qq.com/smartsheet/form/1_wpUqE6CAAALSz4zPkCQY74bj5Fy9lPBw_69e0b4"),
		"Soul Lab should link to the configured Enterprise WeChat collection form",
	);
	assert.match(source, /renderSoulSuggestionPanel/);
	assert.match(source, /friday-soul-suggestion-panel/);
	assert.match(source, /settings\.soulLab\.suggestion\.title/);
	assert.match(source, /settings\.soulLab\.suggestion\.note/);
	assert.match(source, /window\.open\(SOUL_SUGGESTION_FORM_URL,\s*"_blank",\s*"noopener,noreferrer"\)/);
	assert.match(source, /friday-soul-lab-series/);
	assert.match(source, /friday-soul-template-grid/);
	assert.match(source, /friday-soul-template-card/);
	assert.match(source, /friday-soul-template-title-row/);
	assert.match(source, /friday-soul-template-body/);
	assert.match(source, /createDiv\(\{\s*cls:\s*"friday-soul-template-title"/);
	assert.match(source, /friday-soul-template-preview/);
	assert.match(source, /friday-soul-template-famous/);
	assert.match(source, /friday-soul-template-status/);
	assert.match(source, /friday-soul-template-subscribe/);
	assert.match(source, /aria-pressed/);
	assert.doesNotMatch(source, /previewButton/);
	assert.doesNotMatch(source, /settings\.soulLab\.preview"/);
	assert.doesNotMatch(source, /settings\.soulLab\.create/);
	assert.doesNotMatch(source, /settings\.soulLab\.createCurrent/);
	assert.doesNotMatch(source, /createEl\("h4",\s*\{\s*cls:\s*"friday-soul-template-title"/);
	assert.match(source, /is-current/);
	assert.match(source, /template\.typeCode/);
	assert.doesNotMatch(source, /identityVoice:\s*template\.identityVoice/);
	assert.doesNotMatch(source, /styleDisclosure:\s*template\.styleDisclosure/);
	assert.doesNotMatch(source, /famousExamples:\s*template\.famousExamples/);
	assert.doesNotMatch(source, /new Setting\(seriesGroup\)[\s\S]{0,900}\.setName\(template\.name\)/);
});

test("Soul Lab template cards have responsive native styles", () => {
	const styles = read(stylesPath);

	for (const expected of [
		".friday-soul-lab-series",
		".friday-soul-lab-series-header",
		".friday-soul-lab-detail-toggle",
		".friday-soul-template-grid",
		".friday-soul-template-card",
		".friday-soul-template-card.is-current",
		".friday-soul-template-card.is-detail-open",
		".friday-soul-template-title-row",
		".friday-soul-template-body",
		".friday-soul-template-preview",
		".friday-soul-template-famous",
		".friday-soul-template-status",
		".friday-soul-template-chip",
		".friday-soul-template-subscribe",
		".friday-soul-template-subscribe.is-installed",
		".friday-soul-lab-intro",
		".friday-soul-lab-intro-header",
		".friday-soul-lab-back-button",
		".friday-soul-suggestion-panel",
		".friday-soul-suggestion-action",
	]) {
		assert.ok(styles.includes(expected), `Expected Soul Lab card style: ${expected}`);
	}
	assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(/);
	assert.match(styles, /\.friday-soul-lab-series-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
	assert.match(styles, /\.friday-soul-lab-detail-toggle\s*\{[^}]*height:\s*30px/);
	assert.match(styles, /\.friday-soul-template-card\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto/);
	assert.match(styles, /\.friday-soul-template-card\.is-detail-open\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto\s+auto/);
	assert.doesNotMatch(styles, /\.friday-soul-template-card\s*\{[^}]*minmax\(118px,\s*1fr\)/);
	assert.doesNotMatch(styles, /\.friday-soul-template-card\s*\{[^}]*min-height:\s*236px/);
	assert.match(styles, /\.friday-soul-template-header\s*\{[^}]*min-height:\s*26px/);
	assert.match(styles, /\.friday-soul-template-title\s*\{[^}]*margin:\s*0\s*!important/);
	assert.match(styles, /\.friday-soul-template-body\s*\{[^}]*grid-template-rows:\s*minmax\(42px,\s*auto\)\s+auto/);
	assert.match(styles, /\.friday-soul-template-summary\s*\{[^}]*min-height:\s*42px/);
	assert.match(styles, /\.friday-soul-template-summary\s*\{[^}]*-webkit-line-clamp:\s*2/);
	assert.match(styles, /\.friday-soul-template-chips\s*\{[^}]*min-height:\s*24px/);
	assert.match(styles, /\.friday-soul-template-actions\s*\{[^}]*min-height:\s*32px/);
	assert.match(styles, /\.friday-soul-template-actions\s*\{[^}]*margin-top:\s*0/);
	assert.match(styles, /\.friday-soul-template-subscribe\s*\{[^}]*height:\s*32px/);
	assert.match(styles, /\.friday-soul-lab-intro-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
	assert.match(styles, /\.friday-soul-lab-back-button\s*\{[^}]*height:\s*30px/);
	assert.match(styles, /\.friday-soul-suggestion-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
	assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*\.friday-soul-suggestion-panel\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("locales cover Soul Lab entry and MBTI series copy", () => {
	const zh = read(zhLocalePath);
	const en = read(enLocalePath);

	for (const source of [zh, en]) {
		assert.match(source, /settings\.agent\.create\.fromTemplate/);
		assert.match(source, /settings\.soulLab\.title/);
		assert.match(source, /settings\.soulLab\.mbti\.title/);
		assert.match(source, /settings\.soulLab\.detailsExpand/);
		assert.match(source, /settings\.soulLab\.detailsCollapse/);
		assert.match(source, /settings\.soulLab\.subscribe/);
		assert.match(source, /settings\.soulLab\.subscribed/);
		assert.match(source, /settings\.soulLab\.unsubscribed/);
		assert.match(source, /settings\.soulLab\.suggestion\.title/);
		assert.match(source, /settings\.soulLab\.suggestion\.action/);
	}

	assert.ok(zh.includes('"settings.soulLab.mbti.title": "MBTI 沟通风格实验"'));
	assert.ok(zh.includes("第一批"));
	assert.ok(!zh.includes("模板只作为起点"));
	assert.ok(!zh.includes("实验模板不会直接改写当前 Soul"));
	assert.ok(en.includes('"settings.soulLab.mbti.title": "MBTI Communication Style Experiments"'));
	assert.ok(en.includes("first alpha set"));
	assert.ok(!en.includes("Templates are only starting points"));
	assert.ok(!en.includes("Experimental templates do not rewrite the current Soul"));
	assert.ok(zh.includes("展开 Soul 详情"));
	assert.ok(zh.includes("收起 Soul 详情"));
	assert.ok(en.includes("Expand Soul details"));
	assert.ok(en.includes("Collapse Soul details"));
	assert.ok(en.includes("Recommend a Soul"));
	assert.ok(en.includes("Enterprise WeChat collection form"));
});
