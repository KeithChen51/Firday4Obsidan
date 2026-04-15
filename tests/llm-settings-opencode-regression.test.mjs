/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const settingsTypePath = path.join(projectRoot, "src/types/settings.ts");

function readSettingTabSource() {
	return fs.readFileSync(settingTabPath, "utf8");
}

function readSettingsTypeSource() {
	return fs.readFileSync(settingsTypePath, "utf8");
}

test("llm settings reads opencode.json and exposes opencode sync wiring", () => {
	const source = readSettingTabSource();
	assert.match(source, /opencode\.json/);
	assert.match(source, /syncSelectedOpencodeProvider/);
	assert.match(source, /extraHeaders/);
	assert.match(source, /settings\.llm\.opencodeProvider[\s\S]*settings\.llm\.apiUrl/);
	assert.match(source, /if \(mode === "group"\)[\s\S]*settings\.llm\.defaultModel\.name/);
	assert.match(source, /if \(mode !== "group"\)[\s\S]*settings\.llm\.defaultModel\.name/);
	assert.doesNotMatch(source, /settings\.llm\.presetModel\.name/);
	const settingsSource = readSettingsTypeSource();
	assert.match(settingsSource, /openaiConfig/);
	assert.match(settingsSource, /groupConfig/);
});
