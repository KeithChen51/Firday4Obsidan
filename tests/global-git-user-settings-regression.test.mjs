/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

const settingsPath = path.join(projectRoot, "src/types/settings.ts");
const projectTypesPath = path.join(projectRoot, "src/types/project.ts");
const settingTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const syncServicePath = path.join(projectRoot, "src/services/SyncService.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const gitOperatorPath = path.join(projectRoot, "src/platform/git/SimpleGitOperator.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("synced settings model keeps git email only and no longer stores git username or token", async () => {
	const source = read(settingsPath);
	assert.match(source, /user:\s*\{[\s\S]*gitUserEmail:\s*string;/);
	assert.doesNotMatch(source, /user:\s*\{[\s\S]*gitUsername:\s*string;/);
	assert.doesNotMatch(source, /user:\s*\{[\s\S]*gitToken:\s*string;/);
});

test("project entry no longer stores git credential fields", async () => {
	const source = read(projectTypesPath);
	const match = source.match(/export interface ProjectEntry \{([\s\S]*?)\n\}/);
	assert.ok(match, "ProjectEntry interface should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /gitUsername:/);
	assert.doesNotMatch(block, /gitUserEmail:/);
	assert.doesNotMatch(block, /gitToken:/);
});

test("settings tab keeps git email in user section but removes global username and token fields", async () => {
	const source = read(settingTabPath);
	const userSectionMatch = source.match(/private renderUserSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncSection/);
	assert.ok(userSectionMatch, "renderUserSection block should exist");
	const block = userSectionMatch[1] ?? "";
	assert.match(block, /settings\.user\.gitUserEmail/);
	assert.doesNotMatch(block, /settings\.user\.gitUsername/);
	assert.doesNotMatch(block, /settings\.user\.gitToken/);
});

test("settings nav places project immediately after user", async () => {
	const source = read(settingTabPath);
	const match = source.match(/const items: Array<\{ id: SettingsSection; label: string \}> = \[([\s\S]*?)\n\t\t\];/);
	assert.ok(match, "settings tab items block should exist");
	const block = match[1] ?? "";
	const userIndex = block.indexOf('{ id: "user"');
	const projectIndex = block.indexOf('{ id: "project"');
	const syncIndex = block.indexOf('{ id: "sync"');
	assert.ok(userIndex >= 0, "user tab should exist");
	assert.ok(projectIndex >= 0, "project tab should exist");
	assert.ok(syncIndex >= 0, "sync tab should exist");
	assert.ok(userIndex < projectIndex, "project should appear after user");
	assert.ok(projectIndex < syncIndex, "project should appear before sync");
});

test("project editor no longer renders git credential inputs", async () => {
	const source = read(dailyBoardPath);
	assert.doesNotMatch(source, /projects\.editor\.user/);
	assert.doesNotMatch(source, /projects\.editor\.email/);
	assert.doesNotMatch(source, /projects\.editor\.token/);
	assert.doesNotMatch(source, /draft\.gitUsername/);
	assert.doesNotMatch(source, /draft\.gitUserEmail/);
	assert.doesNotMatch(source, /draft\.gitToken/);
});

test("sync service reads git credentials from secure storage instead of synced settings or project entry", async () => {
	const source = read(syncServicePath);
	assert.match(source, /getProjectGitCredential/);
	assert.doesNotMatch(source, /project\.gitUsername/);
	assert.doesNotMatch(source, /project\.gitUserEmail/);
	assert.doesNotMatch(source, /project\.gitToken/);
	assert.doesNotMatch(source, /user\.gitUsername/);
	assert.doesNotMatch(source, /user\.gitToken/);
});

test("settings migration still detects legacy git credentials for secure-storage migration", async () => {
	const source = read(mainPath);
	assert.match(source, /migrateSettings\(/);
	assert.match(source, /gitUsername/);
	assert.match(source, /gitUserEmail/);
	assert.match(source, /gitToken/);
	assert.match(source, /pendingLegacyGitCredentials|migrateLegacyGitCredentials/);
});

test("git identity inference no longer hardcodes a gitee noreply fallback for every remote", async () => {
	const source = read(gitOperatorPath);
	assert.match(source, /inferNoreplyEmail|parseRemoteHost/);
	assert.doesNotMatch(source, /owner \? `\$\{owner\}@users\.noreply\.gitee\.com` : ""/);
});
