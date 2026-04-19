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
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function readSettingsSource() {
	return fs.readFileSync(settingsPath, "utf8").replace(/\r\n?/g, "\n");
}

function readStylesSource() {
	return fs.readFileSync(stylesPath, "utf8").replace(/\r\n?/g, "\n");
}

function readLocaleSource(localePath) {
	return fs.readFileSync(localePath, "utf8").replace(/\r\n?/g, "\n");
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
	assert.match(block, /void this\.refreshProjectGitDetection\(draft\)/);
	assert.doesNotMatch(block, /await this\.refreshProjectGitDetection\(draft\)/);
	const displayIndex = block.indexOf("this.display();");
	const refreshIndex = block.indexOf("void this.refreshProjectGitDetection(draft)");
	assert.ok(displayIndex >= 0, "openRegisterProjectModal should render the editor immediately");
	assert.ok(refreshIndex >= 0, "openRegisterProjectModal should still trigger git detection");
	assert.ok(displayIndex < refreshIndex, "editor should display before the background git detection starts");
});

test("settings project section renders inline editor before empty-state return", async () => {
	const source = readSettingsSource();
	const match = source.match(/private renderProjectSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderActiveProjectSelector/);
	assert.ok(match, "renderProjectSection block should exist");
	const block = match[1] ?? "";
	const activeIndex = block.indexOf("this.renderActiveProjectSelector(shell);");
	const editorIndex = block.indexOf("if (this.projectEditorDraft) {");
	const groupIndex = block.indexOf("this.renderProjectGroupSection(shell);");
	const emptyIndex = block.indexOf("if (this.host.settings.projects.length === 0) {");
	assert.ok(activeIndex >= 0, "register-project row should exist");
	assert.ok(editorIndex >= 0, "settings project editor branch should exist");
	assert.ok(groupIndex >= 0, "project group management should exist");
	assert.ok(activeIndex < editorIndex, "editor should render below the register-project row");
	assert.ok(editorIndex < groupIndex, "editor should render before project group management");
	assert.ok(emptyIndex >= 0, "settings project empty-state branch should exist");
	assert.ok(editorIndex < emptyIndex, "inline editor should render before the early return");
	assert.match(block, /this\.renderProjectEditorCard\(shell\)/);
});

test("settings project section no longer runs sync actions directly", async () => {
	const source = readSettingsSource();
	const match = source.match(/private renderProjectSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderActiveProjectSelector/);
	assert.ok(match, "renderProjectSection block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /settings\.project\.sync/);
	assert.doesNotMatch(block, /syncService\.sync\(/);
});

test("settings project section renders grouped native panels instead of a floating toolbar and project cards", async () => {
	const source = readSettingsSource();
	const match = source.match(/private renderProjectSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderActiveProjectSelector/);
	assert.ok(match, "renderProjectSection block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /settings\.section\.project/);
	assert.match(block, /const shell = containerEl\.createDiv\(\{ cls: "friday-project-settings-shell" \}\)/);
	assert.match(block, /this\.renderActiveProjectSelector\(shell\)/);
	assert.match(block, /this\.renderProjectGroupSection\(shell\)/);
	assert.doesNotMatch(block, /friday-project-settings-toolbar/);
	assert.doesNotMatch(block, /friday-project-grid/);
	assert.doesNotMatch(block, /this\.renderProjectCard\(/);
	assert.match(block, /this\.renderProjectListGroup\(shell, group, projectsInGroup\)/);
});

test("settings user section reads and writes git credentials through secure storage hooks", async () => {
	const source = readSettingsSource();
	assert.match(source, /getUserGitCredential\(/);
	assert.match(source, /setUserGitCredential\(/);
	assert.match(source, /userGitUsernameDraft/);
	assert.match(source, /userGitTokenDraft/);
});

test("settings project editor uses only local_only and remote_bootstrap registration modes", async () => {
	const source = readSettingsSource();
	assert.match(source, /\["local_only", "remote_bootstrap"\] as const/);
	assert.doesNotMatch(source, /register_existing_dir/);
});

test("settings project editor lets local mode choose an Obsidian local path from current vault folders", async () => {
	const source = readSettingsSource();
	assert.match(source, /draft\.mode === "local_only"/);
	assert.match(source, /this\.renderProjectEditorDropdownSetting\(\s*card,\s*this\.t\("projects\.editor\.vaultDir"/);
	assert.match(source, /this\.listVaultDirectoryOptions\(false\)/);
	assert.match(source, /settings\.project\.editor\.vaultDir\.localDesc/);
});

test("settings project editor keeps remote mode on the vault folder picker flow", async () => {
	const source = readSettingsSource();
	assert.match(source, /if \(draft\.mode === "remote_bootstrap"\) \{\s*this\.renderRemoteBootstrapDirectoryPicker\(fields, draft\);/);
	assert.match(source, /private renderRemoteBootstrapDirectoryPicker\(containerEl: HTMLElement, draft: ProjectEditorDraft\): void \{/);
	assert.match(source, /this\.listVaultDirectoryOptions\(true\)/);
	assert.match(source, /settings\.project\.editor\.vaultDir\.remoteDesc/);
});

test("settings project editor filters Friday-managed folders out of vault directory choices", async () => {
	const source = readSettingsSource();
	assert.match(source, /isFridayManagedProjectRoot/);
	assert.match(
		source,
		/listVaultDirectoryOptions\([\s\S]*?filter\(\(folderPath\) => !isFridayManagedProjectRoot\(folderPath,\s*this\.host\.dataService\.getFridayRoot\(\)\)\)/,
	);
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
	assert.match(source, /renderProjectListGroup\(/);
	assert.doesNotMatch(source, /openWorkspaceView\(\)/);
});

test("project top area renders a native setting row with title description and register button", async () => {
	const source = readSettingsSource();
	const activeMatch = source.match(/private renderActiveProjectSelector\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderProjectGroupSection/);
	assert.ok(activeMatch, "renderActiveProjectSelector block should exist");
	const activeBlock = activeMatch[1] ?? "";
	/*
	assert.match(activeBlock, /new Setting\(containerEl\)/);
	assert.match(activeBlock, /setName\(this\.t\("settings\.project\.register", "注册项目"\)\)/);
	assert.match(activeBlock, /setDesc\(this\.t\("settings\.project\.register\.desc", "创建一个新的项目配置。"\)\)/);
	assert.match(activeBlock, /settings\.project\.register/);
	*/
	assert.match(
		activeBlock,
		/const panel = this\.createNativeSettingsGroup\(containerEl,\s*\{\s*extraClass: "friday-project-register-panel",?\s*\}\);/,
	);
	assert.match(activeBlock, /new Setting\(panel\)/);
	assert.match(activeBlock, /setName\(this\.t\("settings\.project\.register", ".*?"\)\)/);
	assert.match(activeBlock, /setDesc\(this\.t\("settings\.project\.register\.desc", ".*?"\)\)/);
	assert.match(activeBlock, /settings\.project\.register/);
	assert.match(activeBlock, /registerSetting\.settingEl\.addClass\("friday-project-register-row"\)/);
	assert.doesNotMatch(activeBlock, /createEl\("select"/);
	assert.doesNotMatch(activeBlock, /addOption/);

	const groupMatch = source.match(/private renderProjectGroupSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate createProjectSettingsPanel/);
	assert.ok(groupMatch, "renderProjectGroupSection block should exist");
	const groupBlock = groupMatch[1] ?? "";
	assert.match(groupBlock, /createEl\("h4", \{\s*cls: "friday-project-group-heading",\s*text: this\.t\("settings\.project\.group\.manage"/);
	assert.doesNotMatch(groupBlock, /friday-project-group-summary/);
	assert.match(groupBlock, /new Setting\(panel\)/);
	assert.doesNotMatch(groupBlock, /friday-project-group-manager-list/);
	assert.doesNotMatch(groupBlock, /friday-project-group-item/);
});

test("project list entries use native grouped settings instead of custom project cards and badges", async () => {
	const source = readSettingsSource();
	assert.match(source, /private renderProjectListGroup\(/);
	assert.match(source, /private renderProjectRow\(/);
	assert.match(source, /new Setting\(listGroup\)/);
	assert.match(source, /actionsSetting\.addButton/);
	assert.doesNotMatch(source, /private renderProjectCard\(/);
	assert.doesNotMatch(source, /friday-project-card/);
	assert.doesNotMatch(source, /friday-badge/);
});

test("settings project ignore flow asks for confirmation before writing shared gitignore rules", async () => {
	const source = readSettingsSource();
	assert.match(source, /ignoreManagerPendingRulePath/);
	assert.match(source, /projects\.ignore\.confirmAction/);
	assert.doesNotMatch(source, /window\.confirm\(/);
});

test("project editor only syncs derived path logic for remote mode and no longer rewrites local selections from project name", async () => {
	const source = readSettingsSource();
	assert.match(source, /draft\.projectName = value\.trim\(\)/);
	assert.match(source, /if \(draft\.mode === "remote_bootstrap"\) \{\s*this\.syncRemoteBootstrapBoundaryPath\(draft\);/);
	assert.doesNotMatch(source, /draft\.mode !== "register_existing_dir"/);
});

test("project editor no longer asks users to type project id manually when creating projects", async () => {
	const source = readSettingsSource();
	assert.doesNotMatch(source, /projects\.editor\.projectId/);
	assert.doesNotMatch(source, /renderProjectEditorText\(fields, this\.t\("projects\.editor\.projectId"/);
	assert.match(source, /submitProjectDraft\(/);
});

test("settings project editor renders native setting rows without an extra header block", async () => {
	const source = readSettingsSource();
	const match = source.match(
		/private renderProjectEditorCard\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderProjectEditorTextSetting/,
	);
	assert.ok(match, "renderProjectEditorCard block should exist");
	const block = match[1] ?? "";
	assert.match(
		block,
		/const card = this\.createNativeSettingsGroup\(containerEl,\s*\{\s*extraClass: "friday-project-settings-panel friday-project-editor-card",?\s*\}\);/,
	);
	assert.match(block, /this\.renderProjectEditorDropdownSetting\(\s*card,/);
	assert.match(block, /this\.renderProjectEditorTextSetting\(\s*card,/);
	assert.match(block, /this\.renderProjectEditorToggleSetting\(\s*card,/);
	assert.doesNotMatch(block, /friday-project-editor-layout/);
	assert.doesNotMatch(block, /friday-project-editor-summary/);
	assert.doesNotMatch(block, /friday-project-editor-grid/);
	assert.doesNotMatch(block, /createProjectSettingsPanel\(/);
	assert.doesNotMatch(block, /settings\.project\.editor\.desc/);
	assert.doesNotMatch(block, /friday-project-panel-title/);
});

test("settings project styles define the new project settings panels", async () => {
	const styles = readStylesSource();
	const shellMatch = styles.match(/\.friday-project-settings-shell \{([\s\S]*?)\n\}/);
	assert.ok(shellMatch, "project settings shell rule should exist");
	assert.match(shellMatch[1] ?? "", /margin-top: 8px/);
	assert.match(styles, /\.friday-project-settings-shell > \.friday-project-settings-panel \{[\s\S]*margin: 0/);
	assert.match(
		styles,
		/\.friday-project-settings-shell > \.friday-project-group-heading \+ \.friday-project-settings-panel \{[\s\S]*margin-top: -6px/,
	);
	assert.match(styles, /\.friday-project-group-heading \{[\s\S]*margin: 0/);
	assert.match(styles, /\.friday-project-settings-panel \{/);
	assert.match(styles, /\.friday-project-register-panel \{/);
	assert.match(styles, /\.friday-project-register-row \{/);
	assert.match(styles, /\.friday-project-setting-detail \{/);
	assert.match(styles, /\.friday-project-group-heading \{/);
	assert.match(styles, /\.friday-project-editor-setting \{/);
	assert.doesNotMatch(styles, /\.friday-project-editor-summary \{/);
});

test("settings project panel headers are explicitly left aligned", async () => {
	const source = readSettingsSource();
	const styles = readStylesSource();
	assert.match(source, /friday-project-panel-title/);
	assert.match(source, /friday-project-empty-title/);
	assert.match(source, /settings\.project\.remoteBootstrap\.nonEmpty\.title/);
	assert.match(styles, /\.friday-project-panel-title \{[\s\S]*text-align: left/);
	assert.match(styles, /\.friday-project-empty-title \{[\s\S]*text-align: left/);
});

test("settings project editor uses translated labels instead of raw registration mode ids", async () => {
	const source = readSettingsSource();
	assert.match(source, /this\.getProjectRegistrationModeOptions\(\)/);
	assert.doesNotMatch(source, /summaryBadges\.createSpan\(\{ cls: "friday-badge", text: draft\.mode \}\)/);
});

test("settings project locale files cover active project, project group, editor mode labels, and auto-sync guidance", async () => {
	for (const localeSource of [readLocaleSource(zhLocalePath), readLocaleSource(enLocalePath)]) {
		assert.match(localeSource, /"settings\.project\.active\.name":/);
		assert.match(localeSource, /"settings\.project\.group\.manage":/);
		assert.match(localeSource, /"projects\.editor\.mode":/);
		assert.match(localeSource, /"projects\.editor\.mode\.local_only":/);
		assert.match(localeSource, /"projects\.editor\.mode\.remote_bootstrap":/);
		assert.match(localeSource, /"projects\.editor\.vaultDir":/);
		assert.match(localeSource, /"projects\.editor\.parentRepoDetected":/);
		assert.match(localeSource, /"settings\.project\.editor\.vaultDir\.localDesc":/);
		assert.match(localeSource, /"settings\.project\.editor\.vaultDir\.remoteDesc":/);
		assert.match(localeSource, /"settings\.project\.editor\.autoSync\.needsRemote":/);
	}
});

test("settings project text inputs do not rerender the whole tab on every keystroke", async () => {
	const source = readSettingsSource();
	const projectNameIndex = source.indexOf('this.t("projects.editor.projectName", "Project name")');
	assert.ok(projectNameIndex >= 0, "project name editor block should exist");
	const projectNameBlock = source.slice(projectNameIndex, projectNameIndex + 700);
	assert.doesNotMatch(projectNameBlock, /this\.display\(\)/);

	const remoteIndex = source.indexOf('this.t("projects.editor.remote", "Git remote")');
	assert.ok(remoteIndex >= 0, "git remote editor block should exist");
	const remoteBlock = source.slice(remoteIndex, remoteIndex + 450);
	assert.doesNotMatch(remoteBlock, /this\.display\(\)/);

	assert.match(source, /input\.onblur = \(\) => \{\s*onCommit\?\.\(\);\s*\};/);
});

test("settings project editor disables auto sync until a git remote is available", async () => {
	const source = readSettingsSource();
	assert.match(source, /setDisabled\(disabled\)/);
	assert.match(source, /settings\.project\.editor\.autoSync\.needsRemote/);
	assert.match(source, /this\.getDraftAutoSyncAvailability\(draft\)/);
});
