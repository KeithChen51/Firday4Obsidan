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

test("native friday preset seeds the warm tone preset", () => {
	const source = read(mainPath);
	assert.match(source, /tonePreset: "warm"/);
	assert.match(source, /亲和、自然、有分寸/);
});
