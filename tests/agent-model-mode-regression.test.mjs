/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const mainPath = path.join(projectRoot, "src/main.ts");
const settingTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const soulSettingsSectionPath = path.join(projectRoot, "src/settings/sections/SoulSettingsSection.ts");
const soulTypePath = path.join(projectRoot, "src/types/soul.ts");

test("soul definition stores model source and main resolves effective llm settings from it", () => {
	const mainSource = fs.readFileSync(mainPath, "utf8");
	const settingsSource = fs.readFileSync(settingTabPath, "utf8");
	const soulSettingsSectionSource = fs.readFileSync(soulSettingsSectionPath, "utf8");
	const soulTypeSource = fs.readFileSync(soulTypePath, "utf8");

	assert.match(soulTypeSource, /preferredModelMode\?: "openai" \| "group"/);
	assert.match(mainSource, /switchLlmMode/);
	assert.match(mainSource, /activeSoul\?\.preferredModelMode/);
	assert.match(settingsSource, /buildAgentModelCatalogFromSettings/);
	assert.match(soulSettingsSectionSource, /parseAgentModelChoice/);
	assert.match(soulSettingsSectionSource, /addDropdown\(\(dropdown\) =>/);
});

test("main bootstraps and migrates the native friday soul preset explicitly", () => {
	const mainSource = fs.readFileSync(mainPath, "utf8");
	assert.match(mainSource, /NATIVE_FRIDAY_SOUL_PRESET_VERSION/);
	assert.match(mainSource, /builtInPresetVersion/);
	assert.match(mainSource, /tonePreset:\s*"warm"/);
	assert.match(mainSource, /shouldRefreshBuiltInSoulPreset/);
	assert.match(mainSource, /matchesBuiltInSoulPreset/);
	assert.match(mainSource, /applyBuiltInSoulPreset/);
	assert.match(mainSource, /有温度但不黏人的协作者/);
});
