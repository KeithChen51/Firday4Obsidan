/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const kitPath = path.join(projectRoot, "src/ui/obsidian-native/SettingsKit.ts");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const contractPath = path.join(projectRoot, "docs/design/obsidian-plugin-ui-contract.md");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("FRIDAY Obsidian Native Kit exposes shared settings primitives", () => {
	const source = read(kitPath);
	assert.match(source, /export interface NativeSettingsGroupOptions/);
	assert.match(source, /export function createNativeSettingsGroup\(/);
	assert.match(source, /export interface NativeSectionTabItem/);
	assert.match(source, /export function renderNativeSectionTabs/);
	assert.match(source, /export function renderFridaySettingsTitle\(/);
	assert.match(source, /friday-native-settings-group/);
	assert.match(source, /friday-nav-button/);
	assert.match(source, /friday-wordmark/);
});

test("settings tab consumes the shared Obsidian Native Kit instead of owning primitives inline", () => {
	const source = read(settingsPath);
	assert.match(
		source,
		/import \{[\s\S]*createNativeSettingsGroup[\s\S]*renderFridaySettingsTitle[\s\S]*renderNativeSectionTabs[\s\S]*\} from "\.\.\/ui\/obsidian-native\/SettingsKit";/,
	);
	assert.doesNotMatch(source, /const group = containerEl\.createDiv\(\{\s*cls: \["friday-native-settings-group"/);
	assert.doesNotMatch(source, /const nav = containerEl\.createDiv\(\{ cls: "friday-top-nav" \}\);/);
	assert.doesNotMatch(source, /const titleEl = containerEl\.createEl\("h2", \{ cls: "friday-settings-title" \}\);/);
});

test("UI contract points implementers to the first Native Kit module", () => {
	const contract = read(contractPath);
	assert.match(contract, /src\/ui\/obsidian-native/);
	assert.match(contract, /SettingsKit\.ts/);
});
