/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("n-neco wordmark font stays scoped to targeted F.R.I.D.A.Y labels", () => {
	const view = read(viewPath);
	const settings = read(settingsPath);
	const main = read(mainPath);
	const styles = read(stylesPath);
	const zhLocale = read(zhLocalePath);
	const enLocale = read(enLocalePath);

	assert.doesNotMatch(styles, /@font-face\s*\{/);
	assert.match(styles, /\.friday-wordmark\s*\{[\s\S]*font-family:\s*"FridayWordmarkNNeco"/);
	assert.match(styles, /\.friday-settings-title\b/);
	assert.match(styles, /\.friday-settings-title-brand\.friday-wordmark\b/);
	assert.match(styles, /\.friday-shell-project-brand\.friday-wordmark\s*\{[\s\S]*font-size:\s*max\(12\.8px,\s*0\.84em\);/);
	assert.match(styles, /\.friday-ai-message-role\.friday-wordmark\s*\{[\s\S]*font-size:\s*max\(12\.8px,\s*0\.84em\);/);
	assert.match(styles, /\.friday-settings-title-brand\.friday-wordmark\s*\{[\s\S]*font-size:\s*1\.04em;/);
	assert.doesNotMatch(styles, /\.friday-shell-project-subtitle\b/);

	assert.match(main, /ensureWordmarkFontLoaded/);
	assert.match(main, /FRIDAY_WORDMARK_FONT_FAMILY/);
	assert.match(main, /new FontFace\(FRIDAY_WORDMARK_FONT_FAMILY/);
	assert.match(main, /fontSet\.add\(fontFace\)/);
	assert.match(main, /FRIDAY_WORDMARK_FONT_TTF_BASE64/);

	assert.match(view, /cls:\s*"friday-shell-project-brand friday-wordmark"/);
	assert.doesNotMatch(view, /friday-shell-project-subtitle/);
	assert.doesNotMatch(view, /shell\.subtitle/);
	assert.match(view, /cls:\s*isUser \? "friday-ai-message-role" : "friday-ai-message-role friday-wordmark"/);
	assert.match(view, /cls:\s*"friday-ai-message-role friday-wordmark"/);
	assert.match(view, /projectBrandEl\.style\.fontFamily = `\$\{FRIDAY_WORDMARK_FONT_FAMILY\}, "Segoe UI", sans-serif`;/);
	assert.match(view, /roleEl\.style\.fontFamily = `\$\{FRIDAY_WORDMARK_FONT_FAMILY\}, "Segoe UI", sans-serif`;/);

	assert.doesNotMatch(zhLocale, /"shell\.subtitle"/);
	assert.doesNotMatch(enLocale, /"shell\.subtitle"/);

	assert.match(settings, /const titleText = this\.host\.t\("settings\.title"\)/);
	assert.match(settings, /const brandText = this\.t\("nav\.friday", "F\.R\.I\.D\.A\.Y"\)/);
	assert.match(settings, /cls:\s*"friday-settings-title-brand friday-wordmark"/);
	assert.match(settings, /brandEl\.style\.fontFamily = `\$\{FRIDAY_WORDMARK_FONT_FAMILY\}, "Segoe UI", sans-serif`;/);
});
