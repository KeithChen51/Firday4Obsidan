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
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
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
	assert.match(source, /reloadFridayPlugin\(\): Promise<void>;/);
});

test("settings section label renames user section to basic configuration in both locales", () => {
	const zh = read(zhLocalePath);
	const en = read(enLocalePath);
	assert.match(zh, /"settings\.section\.user":/);
	assert.match(en, /"settings\.section\.user": "Basic Configuration"/);
	assert.match(zh, /"settings\.user\.update\.title":/);
	assert.match(zh, /"settings\.user\.update\.enabled\.name":/);
	assert.match(zh, /"settings\.user\.update\.currentVersion\.name":/);
	assert.match(zh, /"settings\.user\.update\.currentVersion\.apply":/);
	assert.match(en, /"settings\.user\.update\.title": "Automatic Updates"/);
	assert.match(en, /"settings\.user\.update\.enabled\.name": "Enable automatic updates"/);
	assert.match(en, /"settings\.user\.update\.currentVersion\.name":/);
	assert.match(en, /"settings\.user\.update\.currentVersion\.apply":/);
	assert.match(zh, /"settings\.user\.update\.prerequisites\.name":/);
	assert.match(en, /"settings\.user\.update\.prerequisites\.name": "Prerequisites"/);
	assert.match(zh, /"settings\.user\.update\.notice\.applied":/);
	assert.match(en, /"settings\.user\.update\.notice\.applied":/);
	assert.match(zh, /"settings\.user\.update\.notice\.restart":/);
	assert.match(en, /"settings\.user\.update\.notice\.restart":/);
	assert.doesNotMatch(zh, /bundled studio|内置 studio|重建“来自制作组”栏目/);
	assert.doesNotMatch(en, /bundled studio|From the Studio/);
	assert.match(zh, /完整 changelog|官方频道|Changelog/);
	assert.match(en, /official channel|Changelog/);
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
	assert.match(source, /userGitUsernameDraft/);
	assert.match(source, /userGitTokenDraft/);
	assert.match(source, /renderPluginUpdatePrerequisitesSetting\(/);
	assert.match(source, /getReleaseFeedAccessStatus\(/);
	assert.match(source, /settings\.user\.update\.prerequisites\.name/);
	assert.match(source, /settings\.user\.update\.prerequisites\.ready/);
	assert.match(source, /settings\.user\.update\.prerequisites\.pending/);
	assert.doesNotMatch(source, /settings\.user\.update\.unavailable\.profileIncomplete/);
	assert.doesNotMatch(source, /friday-card friday-plugin-update-card/);
	assert.match(source, /if \(prerequisitesReady\)/);
	assert.match(source, /settings\.user\.update\.checkOnStartup\.name/);
	assert.doesNotMatch(source, /settings\.user\.update\.actions\.name/);
	assert.doesNotMatch(source, /settings\.user\.update\.enabled\.name/);
});

test("plugin update prerequisites no longer require git email for read-only release fetches", () => {
	const source = read(settingsPath);
	const match = source.match(/private getReleaseFeedAccessStatus\(\): \{ ready: boolean; readyLabels: string\[\]; pendingLabels: string\[\]; summary: string \} \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncSection/);
	assert.ok(match, "getReleaseFeedAccessStatus block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /settings\.user\.gitUserEmail/);
	assert.match(block, /userGitUsernameDraft/);
	assert.match(block, /userGitTokenDraft/);
	assert.match(block, /gitRuntimeStatus/);
});

test("plugin update card uses the current-version row as the only check-or-apply action", () => {
	const source = read(settingsPath);
	const match = source.match(/private renderPluginUpdateCard\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderPluginUpdatePrerequisitesSetting/);
	assert.ok(match, "renderPluginUpdateCard block should exist");
	const block = match[1] ?? "";
	const currentVersionIndex = block.indexOf('settings.user.update.currentVersion.name');
	const prerequisitesIndex = block.indexOf("renderPluginUpdatePrerequisitesSetting(");
	const startupCheckIndex = block.indexOf('settings.user.update.checkOnStartup.name');
	assert.ok(currentVersionIndex >= 0, "current version row should exist");
	assert.ok(prerequisitesIndex >= 0, "prerequisites row should exist");
	assert.ok(startupCheckIndex >= 0, "startup check toggle should exist");
	assert.ok(currentVersionIndex < prerequisitesIndex, "current version row should render before prerequisites");
	assert.ok(currentVersionIndex < startupCheckIndex, "current version row should render before startup auto-check");
	assert.doesNotMatch(block, /settings\.user\.update\.gitRuntime\.name/);
	assert.doesNotMatch(block, /settings\.user\.update\.actions\.apply/);
	assert.doesNotMatch(block, /settings\.user\.update\.actions\.dismiss/);
	assert.doesNotMatch(block, /dismissedVersion/);
	assert.match(block, /const hasAvailableUpdate = Boolean\(availableVersion\);/);
	assert.match(block, /const needsPluginReload = this\.host\.settings\.update\.lastResult === "applied";/);
	assert.match(block, /setButtonText\([\s\S]*needsPluginReload[\s\S]*settings\.user\.update\.notice\.restart[\s\S]*hasAvailableUpdate[\s\S]*settings\.user\.update\.currentVersion\.apply/);
	assert.match(block, /if \(needsPluginReload \|\| hasAvailableUpdate\) \{\s*button\.setCta\(\);\s*\} else \{\s*button\.removeCta\(\);\s*\}/);
	assert.doesNotMatch(block, /settings\.user\.update\.status\.name/);
});

test("plugin update apply flow keeps the reload action inside settings instead of spawning a persistent notice", () => {
	const source = read(settingsPath);
	assert.match(source, /settings\.user\.update\.notice\.restart/);
	assert.match(source, /private async runPluginUpdateReload\(\): Promise<void> \{/);
	assert.match(source, /this\.host\.reloadFridayPlugin\(\)/);
	assert.doesNotMatch(source, /private showPluginUpdateRestartNotice\(\): void \{/);

	const match = source.match(/private async runPluginUpdateApply\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate buildProjectDescription/);
	assert.ok(match, "runPluginUpdateApply block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /showPluginUpdateRestartNotice\(\)/);
	assert.doesNotMatch(block, /new Notice\(this\.t\("settings\.user\.update\.notice\.applied"/);
	assert.match(block, /this\.host\.settings\.update\.availableVersion = "";/);
	assert.doesNotMatch(block, /dismissedVersion/);
});
