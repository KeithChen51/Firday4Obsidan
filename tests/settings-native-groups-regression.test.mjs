/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const stylesPath = path.join(projectRoot, "styles.css");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("settings tab exposes a shared native settings group helper", () => {
	const source = read(settingsPath);
	assert.match(source, /private createNativeSettingsGroup\(/);
	assert.match(source, /friday-native-settings-group-header/);
	assert.match(source, /friday-native-settings-group-title/);
	assert.match(source, /friday-native-settings-group-description/);
});

test("sync llm and agent sections render settings inside native groups", () => {
	const source = read(settingsPath);
	assert.match(source, /private renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?const group = this\.createNativeSettingsGroup\(containerEl\);[\s\S]*?new Setting\(group\)/);
	assert.match(source, /private renderLlmSection\(containerEl: HTMLElement\): void \{[\s\S]*?createNativeSettingsGroup\(containerEl/);
	assert.match(source, /private renderAgentSection\(containerEl: HTMLElement\): void \{[\s\S]*?createNativeSettingsGroup\(containerEl/);
});

test("settings tab is ready to rename the agent section to soul", () => {
	const source = read(settingsPath);
	assert.match(source, /private renderSoulSection\(containerEl: HTMLElement\): void \{/);
	assert.doesNotMatch(source, /private renderAgentSection\(containerEl: HTMLElement\): void \{/);
	assert.match(source, /settings\.section\.soul/);
	assert.doesNotMatch(source, /settings\.section\.agent/);
});

test("tab content sections no longer repeat the selected tab title as an extra h3 header", () => {
	const source = read(settingsPath);
	assert.doesNotMatch(source, /renderUserSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.user"\) \}\)/);
	assert.doesNotMatch(source, /renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.sync"\) \}\)/);
	assert.doesNotMatch(source, /renderLlmSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.llm"\) \}\)/);
	assert.doesNotMatch(source, /renderAgentSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.agent"\) \}\)/);
	assert.doesNotMatch(source, /renderSlashCommandSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.slash"\) \}\)/);
	assert.doesNotMatch(source, /renderProjectSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.project"\) \}\)/);
});

test("slash and project sections replace old friday-card settings panels with native groups", () => {
	const source = read(settingsPath);
	assert.doesNotMatch(source, /const card = containerEl\.createDiv\(\{ cls: "friday-card" \}\)/);
	assert.doesNotMatch(source, /friday-card friday-project-settings-panel/);
	assert.match(source, /createNativeSettingsGroup\(containerEl,\s*\{\s*title: `\/\$\{command\.name\}`/);
	assert.match(source, /createNativeSettingsGroup\(containerEl,\s*\{/);
	assert.match(source, /friday-project-settings-panel/);
});

test("native settings group styles define grouped headers and divider behavior", () => {
	const styles = read(stylesPath);
	assert.match(styles, /\.friday-native-settings-group \{/);
	assert.match(styles, /\.friday-native-settings-group-header \{/);
	assert.match(styles, /\.friday-native-settings-group-title \{/);
	assert.match(styles, /\.friday-native-settings-group-description \{/);
	assert.match(styles, /\.friday-native-settings-group > \.setting-item:first-child/);
	assert.match(styles, /\.friday-native-settings-group > \.friday-native-settings-group-header \+ \.setting-item/);
});
