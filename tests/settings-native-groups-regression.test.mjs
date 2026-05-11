/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const settingsModelPath = path.join(projectRoot, "src/types/settings.ts");
const pluginTypePath = path.join(projectRoot, "src/types/plugin.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const settingsKitPath = path.join(projectRoot, "src/ui/obsidian-native/SettingsKit.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("settings tab exposes a shared native settings group helper", () => {
	const source = read(settingsPath);
	const kitSource = read(settingsKitPath);
	assert.match(source, /private createNativeSettingsGroup\(/);
	assert.match(source, /createNativeSettingsGroup\(containerEl, options\)/);
	assert.match(kitSource, /friday-native-settings-group-header/);
	assert.match(kitSource, /friday-native-settings-group-title/);
	assert.match(kitSource, /friday-native-settings-group-description/);
});

test("sync llm and soul sections render settings inside native groups", () => {
	const source = read(settingsPath);
	assert.match(source, /private renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?const group = this\.createNativeSettingsGroup\(containerEl\);[\s\S]*?new Setting\(group\)/);
	assert.match(source, /private renderLlmSection\(containerEl: HTMLElement\): void \{[\s\S]*?createNativeSettingsGroup\(containerEl/);
	assert.match(source, /private renderSoulSection\(containerEl: HTMLElement\): void \{[\s\S]*?createNativeSettingsGroup\(containerEl/);
});

test("settings model exposes activeSoulId before the full soul UI switch", () => {
	const source = read(settingsModelPath);
	assert.match(source, /activeSoulId: string;/);
	assert.match(source, /activeSoulId: "",/);
	assert.doesNotMatch(source, /agents: AgentProfile\[];/);
	assert.doesNotMatch(source, /activeAgentId: string;/);
	assert.doesNotMatch(source, /agents: \[\],/);
	assert.doesNotMatch(source, /activeAgentId: "",/);
});

test("settings tab keeps Agent as the user-facing section while exposing soul definition controls", () => {
	const source = read(settingsPath);
	assert.match(source, /settings\.section\.agent/);
	assert.match(source, /private renderSoulSection\(containerEl: HTMLElement\): void \{/);
	assert.doesNotMatch(source, /private renderAgentSection\(containerEl: HTMLElement\): void \{/);
	assert.match(source, /legacyAgentCleanupService/);
	assert.match(source, /settings\.soul\.cleanup/);
	assert.match(source, /pendingSoulCleanupConfirm/);
	assert.match(source, /settings\.soul\.cleanup\.confirm/);
	assert.match(source, /settings\.soul\.cleanup\.danger/);
	assert.doesNotMatch(source, /settings\.agents/);
	assert.doesNotMatch(source, /getActiveAgent\(/);
	assert.doesNotMatch(source, /activeAgentId/);
	assert.doesNotMatch(source, /\$\{soul\.name\} \(\$\{soul\.id\}\)/);
	assert.match(source, /settings\.agent\.currentSoul\.name/);
	assert.match(source, /settings\.agent\.currentSoul\.desc/);
	assert.match(source, /settings\.agent\.currentModel\.name/);
	assert.match(source, /settings\.agent\.manage\.title/);
	assert.match(source, /settings\.agent\.manage\.setCurrent/);
	assert.match(source, /settings\.agent\.manage\.edit/);
	assert.match(source, /settings\.agent\.manage\.delete/);
	assert.match(source, /settings\.agent\.manage\.deleteBlocked/);
	assert.doesNotMatch(source, /"新建 Agent"/);
	assert.doesNotMatch(source, /"Agent 名称"/);
	assert.doesNotMatch(source, /"保存 Agent 设定"/);
	assert.match(source, /"新建 Soul"/);
	assert.match(source, /"Soul 名称"/);
	assert.match(source, /"保存 Soul 定义"/);
	assert.match(source, /原生 FRIDAY/);
	assert.match(source, /settings\.agent\.profile\.name/);
	assert.match(source, /settings\.agent\.profile\.summary/);
	assert.match(source, /settings\.agent\.profile\.definition/);
	assert.match(source, /settings\.agent\.profile\.reset/);
	assert.match(source, /settings\.agent\.profile\.resetDesc/);
	assert.match(source, /resetActiveSoulToBuiltInPreset/);
	assert.match(source, /settings\.agent\.profile\.save/);
	assert.match(source, /await this\.host\.soulStore\.updateSoul\(activeSoulDefinition\.id,\s*\{/);
	assert.match(source, /await this\.host\.soulStore\.deleteSoul\(/);
	assert.match(source, /name:/);
	assert.match(source, /summary:/);
	assert.match(source, /description:/);
	assert.match(source, /rolePrompt:/);
});

test("plugin api exposes soul-only identity controls", () => {
	const source = read(pluginTypePath);
	assert.match(source, /getActiveSoul\(\): SoulSummary \| null;/);
	assert.match(source, /setActiveSoul\(soulId: string\): Promise<void>;/);
	assert.match(source, /createSoul\(input: \{ name: string; summary: string; description\?: string \}\): Promise<SoulSummary>;/);
	assert.match(source, /resetBuiltInSoulPreset\(soulId: string\): Promise<SoulSummary>;/);
	assert.doesNotMatch(source, /getActiveAgent\(\): AgentProfile \| null;/);
	assert.doesNotMatch(source, /setActiveAgent\(agentId: string\): Promise<void>;/);
	assert.doesNotMatch(source, /createAgent\(input: \{ name: string; description: string;/);
});

test("tab content sections no longer repeat the selected tab title as an extra h3 header", () => {
	const source = read(settingsPath);
	assert.doesNotMatch(source, /renderUserSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.user"\) \}\)/);
	assert.doesNotMatch(source, /renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.sync"\) \}\)/);
	assert.doesNotMatch(source, /renderLlmSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.llm"\) \}\)/);
	assert.doesNotMatch(source, /renderAgentSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.agent"\) \}\)/);
	assert.doesNotMatch(source, /renderSubscriptionsSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.subscriptions"\) \}\)/);
	assert.doesNotMatch(source, /renderProjectSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.project"\) \}\)/);
});

test("subscriptions and project sections replace old friday-card settings panels with native groups", () => {
	const source = read(settingsPath);
	assert.doesNotMatch(source, /const card = containerEl\.createDiv\(\{ cls: "friday-card" \}\)/);
	assert.doesNotMatch(source, /friday-card friday-project-settings-panel/);
	assert.match(source, /renderSubscriptionsSection\(containerEl: HTMLElement\): void \{/);
	assert.match(source, /officialContentService\.runBackgroundSync\(/);
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

test("user settings only expose display name and remove user id controls", () => {
	const source = read(settingsPath);
	const start = source.indexOf("private renderUserSection(containerEl: HTMLElement): void {");
	const end = source.indexOf("\n\tprivate renderPluginUpdateCard(", start);
	assert.ok(start >= 0 && end > start, "renderUserSection block should exist");
	const block = source.slice(start, end);
	assert.doesNotMatch(block, /settings\.user\.autoDetect\./);
	assert.doesNotMatch(block, /settings\.user\.userId\./);
	assert.match(block, /settings\.user\.displayName\.name/);
	assert.match(block, /setName\(this\.t\("settings\.user\.displayName\.name", "FRIDAY 如何称呼你"\)\)/);
	assert.match(block, /settings\.user\.displayName\.placeholder/);
	assert.match(block, /setPlaceholder\(this\.t\("settings\.user\.displayName\.placeholder", "FRIDAY [^"]*"\)\)/);
});
