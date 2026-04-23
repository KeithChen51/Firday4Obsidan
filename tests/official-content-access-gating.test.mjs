/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src", "settings", "FridaySettingTab.ts");
const zhLocalePath = path.join(projectRoot, "src", "i18n", "locales", "zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src", "i18n", "locales", "en-US.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("subscriptions section blocks access when release-feed prerequisites are incomplete", () => {
	const source = read(settingsPath);
	assert.match(source, /renderSubscriptionsSection\(containerEl: HTMLElement\)/);
	assert.match(source, /renderSubscriptionsUnavailableState\(/);
	assert.match(source, /getReleaseFeedAccessStatus\(/);
	assert.match(source, /focusSection\("user"\)|this\.activeSection = "user"/);
});

test("locale files describe the subscriptions prerequisite blocker and jump action", () => {
	const zh = read(zhLocalePath);
	const en = read(enLocalePath);
	assert.match(zh, /settings\.subscriptions\.unavailable\.title/);
	assert.match(zh, /settings\.subscriptions\.unavailable\.desc/);
	assert.match(zh, /settings\.subscriptions\.unavailable\.action/);
	assert.match(en, /settings\.subscriptions\.unavailable\.title/);
	assert.match(en, /settings\.subscriptions\.unavailable\.desc/);
	assert.match(en, /settings\.subscriptions\.unavailable\.action/);
});
