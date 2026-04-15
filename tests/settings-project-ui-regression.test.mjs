/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");

function readSettingsSource() {
	return fs.readFileSync(settingsPath, "utf8");
}

test("settings project editor opens inline instead of redirecting to workspace", async () => {
	const source = readSettingsSource();
	const match = source.match(/private async openRegisterProjectModal\(initial\?: ProjectEntry\): Promise<void> \{([\s\S]*?)\n\t\}/);
	assert.ok(match, "openRegisterProjectModal block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /workbenchStateStore\.setProjectEditorRequest/);
	assert.doesNotMatch(block, /openWorkspaceView\(/);
	assert.match(block, /const draft = this\.createProjectEditorDraft/);
	assert.match(block, /this\.projectEditorDraft = draft/);
	assert.match(block, /this\.display\(\)/);
});

test("settings project section renders inline editor before empty-state return", async () => {
	const source = readSettingsSource();
	const match = source.match(/private renderProjectSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderActiveProjectSelector/);
	assert.ok(match, "renderProjectSection block should exist");
	const block = match[1] ?? "";
	const editorIndex = block.indexOf("if (this.projectEditorDraft) {");
	const emptyIndex = block.indexOf("if (this.host.settings.projects.length === 0) {");
	assert.ok(editorIndex >= 0, "settings project editor branch should exist");
	assert.ok(emptyIndex >= 0, "settings project empty-state branch should exist");
	assert.ok(editorIndex < emptyIndex, "inline editor should render before the early return");
	assert.match(block, /this\.renderProjectEditorCard\(containerEl\)/);
});

test("settings project section no longer runs sync actions directly", async () => {
	const source = readSettingsSource();
	const match = source.match(/private renderProjectSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderActiveProjectSelector/);
	assert.ok(match, "renderProjectSection block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /settings\.project\.sync/);
	assert.doesNotMatch(block, /syncService\.sync\(/);
});

test("settings project editor reads and writes project credentials through secure storage hooks", async () => {
	const source = readSettingsSource();
	assert.match(source, /getProjectGitCredential\(/);
	assert.match(source, /setProjectGitCredential\(/);
	assert.doesNotMatch(source, /settings\.user\.gitUsername/);
	assert.doesNotMatch(source, /settings\.user\.gitToken/);
});

test("settings project editor no longer renders a local path field and now exposes vault directory options", async () => {
	const source = readSettingsSource();
	assert.doesNotMatch(source, /projects\.editor\.local/);
	assert.match(source, /listVaultDirectoryOptions\(/);
});

test("settings project editor surfaces detected parent repository hints for nested git folders", async () => {
	const source = readSettingsSource();
	assert.match(source, /detectedParentRepository/);
	assert.match(source, /repositoryRoot/);
});

test("settings project section manages ignore candidates inline instead of redirecting to workspace view", async () => {
	const source = readSettingsSource();
	assert.match(source, /loadProjectIgnoreCandidates\(/);
	assert.match(source, /renderProjectIgnoreManager\(/);
	assert.doesNotMatch(source, /openWorkspaceView\(\)/);
});
