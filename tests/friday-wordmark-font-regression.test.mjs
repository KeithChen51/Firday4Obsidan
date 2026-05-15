/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const rendererPath = path.join(projectRoot, "src/views/agentTrajectoryRenderer.ts");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const settingsKitPath = path.join(projectRoot, "src/ui/obsidian-native/SettingsKit.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const iconPath = path.join(projectRoot, "src/constants/icon.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("FRIDAY wordmark and Obsidian icons use the current brand system", () => {
	const view = read(viewPath);
	const renderer = read(rendererPath);
	const settings = read(settingsPath);
	const settingsKit = read(settingsKitPath);
	const main = read(mainPath);
	const icon = read(iconPath);
	const styles = read(stylesPath);
	const zhLocale = read(zhLocalePath);
	const enLocale = read(enLocalePath);

	assert.doesNotMatch(styles, /@font-face\s*\{/);
	assert.match(styles, /\.friday-wordmark\s*\{[\s\S]*font-family:\s*"Avenir Next", Inter, "Segoe UI", Arial, sans-serif;/);
	assert.match(styles, /\.friday-settings-title\b/);
	assert.match(styles, /\.friday-settings-title-brand\.friday-wordmark\b/);
	assert.match(styles, /\.friday-shell-project-brand\.friday-wordmark\s*\{[\s\S]*font-size:\s*max\(14px,\s*0\.94em\);/);
	assert.match(styles, /\.friday-shell-project-brand\.friday-wordmark\s*\{[\s\S]*line-height:\s*22px;/);
	assert.match(styles, /\.friday-ai-message-role\.friday-wordmark\s*\{[\s\S]*font-size:\s*max\(12\.8px,\s*0\.84em\);/);
	assert.match(styles, /\.friday-settings-title-brand\.friday-wordmark\s*\{[\s\S]*font-size:\s*1\.04em;/);
	assert.match(styles, /\.friday-shell-project-mark\b/);
	assert.match(styles, /\.friday-ai-message-avatar\s*\{[\s\S]*border:\s*0;/);
	assert.match(styles, /\.friday-ai-message-avatar\s*\{[\s\S]*background:\s*transparent;/);
	assert.doesNotMatch(styles, /\.friday-shell-project-subtitle\b/);

	assert.match(main, /addIcon\(FRIDAY_ICON_ID,\s*FRIDAY_ICON_SVG\)/);
	assert.doesNotMatch(main, /ensureWordmarkFontLoaded/);
	assert.doesNotMatch(main, /new FontFace/);
	assert.doesNotMatch(main, /FRIDAY_WORDMARK_FONT_TTF_BASE64/);
	assert.match(icon, /export const FRIDAY_ICON_ID = "friday-double-shell";/);
	assert.match(icon, /<g transform="translate\(13 5\) scale\(0\.67\)">/);
	assert.match(icon, /fill="currentColor"/);
	assert.match(icon, /V121\.2/);
	assert.doesNotMatch(icon, /M7\.25 4\.25/);

	assert.match(view, /FRIDAY_ICON_ID/);
	assert.match(view, /getIcon\(\): string \{\s*return FRIDAY_ICON_ID;\s*\}/);
	assert.match(view, /cls:\s*"friday-shell-project-mark"/);
	assert.match(view, /renderAssistantAvatar\(metaEl\)/);
	assert.match(view, /setIcon\(avatarEl,\s*FRIDAY_ICON_ID\)/);
	assert.match(view, /cls:\s*"friday-shell-project-brand friday-wordmark"/);
	assert.doesNotMatch(view, /friday-shell-project-subtitle/);
	assert.doesNotMatch(view, /shell\.subtitle/);
	assert.match(view, /renderAgentAnswerFlow/);
	assert.match(renderer, /friday-ai-answer-flow/);
	assert.match(renderer, /assistant-source-mark-v3/);
	assert.match(view, /projectBrandEl\.style\.fontFamily = FRIDAY_WORDMARK_FONT_FAMILY;/);
	assert.doesNotMatch(renderer, /assistant-meta-v2 friday-ai-answer-meta/);
	assert.doesNotMatch(renderer, /metaEl\.createSpan\(\{ cls: "friday-ai-message-role friday-wordmark", text: "FRIDAY" \}\)/);

	assert.doesNotMatch(zhLocale, /"shell\.subtitle"/);
	assert.doesNotMatch(enLocale, /"shell\.subtitle"/);
	assert.match(zhLocale, /"app\.name": "FRIDAY"/);
	assert.match(enLocale, /"app\.name": "FRIDAY"/);
	assert.match(zhLocale, /"ai\.role\.assistant": "FRIDAY"/);
	assert.match(enLocale, /"ai\.role\.assistant": "FRIDAY"/);

	assert.match(settings, /renderFridaySettingsTitle\(containerEl,\s*\{/);
	assert.match(settings, /titleText: this\.host\.t\("settings\.title"\)/);
	assert.match(settings, /brandText: this\.t\("nav\.friday", "FRIDAY"\)/);
	assert.match(settings, /wordmarkFontFamily: FRIDAY_WORDMARK_FONT_FAMILY/);
	assert.match(settingsKit, /cls:\s*"friday-settings-title-brand friday-wordmark"/);
	assert.match(settingsKit, /brandEl\.style\.fontFamily = options\.wordmarkFontFamily;/);
});
