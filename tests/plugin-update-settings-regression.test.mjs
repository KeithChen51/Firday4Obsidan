/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const settingsTypePath = path.join(projectRoot, "src/types/settings.ts");
const pluginTypePath = path.join(projectRoot, "src/types/plugin.ts");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("settings model includes update state for plugin auto-update", () => {
	const source = read(settingsTypePath);
	assert.match(source, /update:\s*\{/);
	assert.match(source, /availableVersion:\s*string;/);
	assert.match(source, /startupDelayMs:\s*number;/);
});

test("plugin api exposes plugin update and git runtime accessors", () => {
	const source = read(pluginTypePath);
	assert.match(source, /pluginUpdateService:/);
	assert.match(source, /getGitRuntimeStatus\(\): Promise</);
});

test("settings section label renames user section to basic configuration in both locales", () => {
	const zh = read(zhLocalePath);
	const en = read(enLocalePath);
	assert.match(zh, /"settings\.section\.user":/);
	assert.match(en, /"settings\.section\.user": "Basic Configuration"/);
	assert.match(zh, /"settings\.user\.update\.title":/);
	assert.match(zh, /"settings\.user\.update\.enabled\.name":/);
	assert.match(zh, /"settings\.user\.update\.currentVersion\.name":/);
	assert.match(en, /"settings\.user\.update\.title": "Automatic Updates"/);
	assert.match(en, /"settings\.user\.update\.enabled\.name": "Enable automatic updates"/);
	assert.match(en, /"settings\.user\.update\.currentVersion\.name":/);
	assert.match(zh, /"settings\.user\.update\.prerequisites\.name":/);
	assert.match(en, /"settings\.user\.update\.prerequisites\.name": "Prerequisites"/);
});

test("renderUserSection includes an automatic update group after git credential inputs", () => {
	const source = read(settingsPath);
	const match = source.match(/private renderUserSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncSection/);
	assert.ok(match, "renderUserSection block should exist");
	const block = match[1] ?? "";
	const gitTokenIndex = block.indexOf('settings.user.gitToken.name');
	const updateGroupIndex = block.indexOf("renderPluginUpdateCard(");
	assert.ok(gitTokenIndex >= 0, "git token input should exist");
	assert.ok(updateGroupIndex >= 0, "plugin update section should be rendered");
	assert.ok(updateGroupIndex > gitTokenIndex, "plugin update section should render after git credential inputs");
});

test("plugin update section uses a native settings group and hides advanced controls until prerequisites are ready", () => {
	const source = read(settingsPath);
	assert.match(source, /renderPluginUpdateCard\(/);
	assert.match(source, /createEl\("h3",\s*\{\s*text:\s*this\.t\("settings\.user\.update\.title"/);
	assert.match(source, /createNativeSettingsGroup\(containerEl,\s*\{\s*extraClass:\s*"friday-plugin-update-group"/);
	assert.match(source, /settings\.user\.update\.currentVersion\.name/);
	assert.match(source, /this\.host\.manifest\.version/);
	assert.match(source, /gitRuntimeStatus/);
	assert.match(source, /gitAvailable/);
	assert.match(source, /setDisabled\(/);
	assert.match(source, /settings\.user\.gitUserEmail/);
	assert.match(source, /userGitUsernameDraft/);
	assert.match(source, /userGitTokenDraft/);
	assert.match(source, /renderPluginUpdatePrerequisitesSetting\(/);
	assert.match(source, /getPluginUpdatePrereqDetails\(/);
	assert.match(source, /settings\.user\.update\.prerequisites\.name/);
	assert.match(source, /settings\.user\.update\.prerequisites\.ready/);
	assert.match(source, /settings\.user\.update\.prerequisites\.pending/);
	assert.doesNotMatch(source, /settings\.user\.update\.unavailable\.profileIncomplete/);
	assert.doesNotMatch(source, /friday-card friday-plugin-update-card/);
	assert.match(source, /if \(prerequisitesReady\)/);
	assert.match(source, /settings\.user\.update\.checkOnStartup\.name/);
	assert.match(source, /settings\.user\.update\.actions\.name/);
});

test("plugin update card shows current version before update toggles and does not keep git runtime inside the card", () => {
	const source = read(settingsPath);
	const match = source.match(/private renderPluginUpdateCard\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderPluginUpdatePrerequisitesSetting/);
	assert.ok(match, "renderPluginUpdateCard block should exist");
	const block = match[1] ?? "";
	const currentVersionIndex = block.indexOf('settings.user.update.currentVersion.name');
	const prerequisitesIndex = block.indexOf("renderPluginUpdatePrerequisitesSetting(");
	const enabledIndex = block.indexOf('settings.user.update.enabled.name');
	assert.ok(currentVersionIndex >= 0, "current version row should exist");
	assert.ok(prerequisitesIndex >= 0, "prerequisites row should exist");
	assert.ok(enabledIndex >= 0, "enable update toggle should exist");
	assert.ok(currentVersionIndex < prerequisitesIndex, "current version row should render before prerequisites");
	assert.ok(currentVersionIndex < enabledIndex, "current version row should render before the auto update toggle");
	assert.doesNotMatch(block, /settings\.user\.update\.gitRuntime\.name/);
	assert.doesNotMatch(block, /settings\.user\.update\.actions\.checkNow/);
});
