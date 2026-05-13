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

function readBuiltinGroupModels() {
	const source = readSettingTabSource();
	const matched = source.match(/const BUILTIN_GROUP_MODELS = \[([\s\S]*?)\];/);
	assert.ok(matched, "BUILTIN_GROUP_MODELS should be defined");
	return [...matched[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test("llm settings reads opencode.json and exposes opencode sync wiring", () => {
	const source = readSettingTabSource();
	assert.match(source, /opencode\.json/);
	assert.match(source, /syncSelectedOpencodeProvider/);
	assert.match(source, /extraHeaders/);
	assert.match(source, /settings\.llm\.opencodeProvider[\s\S]*settings\.llm\.apiUrl/);
	assert.match(source, /if \(mode === "group"\)[\s\S]*settings\.llm\.defaultModel\.name/);
	assert.match(source, /if \(mode !== "group"\)[\s\S]*settings\.llm\.defaultModel\.name/);
	assert.doesNotMatch(source, /MANUAL_MODEL_OPTION/);
	assert.match(source, /runVisionCapabilityTest/);
	assert.match(source, /settings\.llm\.vision\.test/);
	assert.doesNotMatch(source, /runLlmConnectionTest[\s\S]*checkConnectionCapabilities/);
	assert.match(source, /runVisionCapabilityTest[\s\S]*probeVisionCapability/);
	assert.match(source, /testedVisionCapability = null/);
	const settingsSource = readSettingsTypeSource();
	assert.match(settingsSource, /openaiConfig/);
	assert.match(settingsSource, /groupConfig/);
});

test("group mode builtin fallback models reflect the current internal OpenCode defaults", () => {
	assert.deepEqual(readBuiltinGroupModels(), [
		"glm-4.7",
		"kimi-k2.5",
		"glm-5.1",
		"MiniMax/MiniMax-M2.7",
		"qwen3-coder-plus",
		"deepseek-v4-pro",
		"qwen3.6-plus",
		"qwen3-max-preview",
		"qwen3.5-flash-2026-02-23",
		"qwen3-vl-235b-a22b-instruct",
		"qwen3-max-2026-01-23",
	]);
});
