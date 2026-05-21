/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const llmSettingsSectionPath = path.join(projectRoot, "src/settings/sections/LlmSettingsSection.ts");
const soulSettingsSectionPath = path.join(projectRoot, "src/settings/sections/SoulSettingsSection.ts");
const projectSettingsSectionPath = path.join(projectRoot, "src/settings/sections/ProjectSettingsSection.ts");
const settingsModelPath = path.join(projectRoot, "src/types/settings.ts");
const pluginTypePath = path.join(projectRoot, "src/types/plugin.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const settingsKitPath = path.join(projectRoot, "src/ui/obsidian-native/SettingsKit.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const studioBasicConfigPath = path.join(projectRoot, "src/content/studio/Start Here · 从这里开始/02 基础配置.md");
const studioGeneratedPath = path.join(projectRoot, "src/content/studio/generated.ts");

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

test("SettingsKit exposes native hooks for settings status feedback and local states", () => {
	const kitSource = read(settingsKitPath);

	for (const exportedHelper of [
		"renderNativeSettingStatus",
		"markNativeDangerSetting",
		"renderNativeSettingsFeedback",
		"renderNativePrerequisiteList",
		"renderNativeSettingsEmptyState",
		"renderNativeInlineAlert",
	]) {
		assert.match(kitSource, new RegExp(`export function ${exportedHelper}\\(`));
	}

	for (const hook of [
		"friday-native-setting-status",
		"friday-native-danger-setting",
		"friday-native-settings-feedback",
		"friday-native-prerequisite-list",
		"friday-native-empty-state",
		"friday-native-inline-alert",
	]) {
		assert.match(kitSource, new RegExp(hook));
	}
});

test("settings tab wires Native Kit hooks to explicit settings-page components", () => {
	const source = read(settingsPath);
	const llmSectionSource = read(llmSettingsSectionPath);
	const soulSectionSource = read(soulSettingsSectionPath);

	assert.match(llmSectionSource, /renderNativeSettingStatus/);
	assert.match(soulSectionSource, /markNativeDangerSetting/);
	assert.match(llmSectionSource, /renderNativeSettingsFeedback/);
	assert.match(source, /renderNativePrerequisiteList/);
	assert.match(source, /renderNativeSettingsEmptyState/);
	assert.match(source, /renderNativeInlineAlert/);
	assert.match(source, /renderPluginUpdatePrerequisitesSetting\(card, prereqDetails\)/);
	assert.match(source, /renderOfficialContentRefreshStatus\(controls\)/);
	assert.match(source, /pendingOfficialContentArchiveConfirm/);
	assert.match(soulSectionSource, /pendingSoulCleanupConfirm/);
});

test("agent runtime settings hide max tool iterations emergency fuse from user-facing UI", () => {
	const settingsSource = read(settingsPath);
	const en = read(enLocalePath);
	const zh = read(zhLocalePath);
	const studioBasicConfig = read(studioBasicConfigPath);
	const studioGenerated = read(studioGeneratedPath);

	assert.doesNotMatch(settingsSource, /settings\.agent\.maxToolIterations/);
	assert.doesNotMatch(settingsSource, /maxToolIterations\.name/);
	assert.doesNotMatch(settingsSource, /maxToolIterations\.desc/);
	assert.doesNotMatch(en, /settings\.agent\.maxToolIterations/);
	assert.doesNotMatch(zh, /settings\.agent\.maxToolIterations/);

	for (const source of [settingsSource, en, zh, studioBasicConfig, studioGenerated]) {
		assert.doesNotMatch(source, /单轮最大工具步数/);
		assert.doesNotMatch(source, /限制单次对话中的工具循环次数/);
		assert.doesNotMatch(source, /Advanced emergency fuse/);
		assert.doesNotMatch(source, /工具循环紧急保险/);
	}
});

test("agent runtime settings hide exec controls from user-facing UI", () => {
	const settingsSource = read(settingsPath);

	assert.doesNotMatch(settingsSource, /settings\.agent\.enableExec\.name/);
	assert.doesNotMatch(settingsSource, /settings\.agent\.enableExec\.desc/);
	assert.doesNotMatch(settingsSource, /settings\.agent\.execTimeout\.name/);
	assert.doesNotMatch(settingsSource, /settings\.agent\.execTimeout\.desc/);
	assert.doesNotMatch(settingsSource, /enableExecTool\)\.onChange/);
	assert.doesNotMatch(settingsSource, /agentRuntime\.execTimeout\s*=/);
});

test("sync llm and soul sections render settings inside native groups", () => {
	const source = read(settingsPath);
	const llmSectionSource = read(llmSettingsSectionPath);
	const soulSectionSource = read(soulSettingsSectionPath);
	assert.match(source, /private renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?const group = this\.createNativeSettingsGroup\(containerEl\);[\s\S]*?new Setting\(group\)/);
	assert.match(source, /import \{ renderLlmSettingsSection \} from "\.\/sections\/LlmSettingsSection";/);
	assert.match(source, /import \{ renderSoulSettingsSection \} from "\.\/sections\/SoulSettingsSection";/);
	assert.match(source, /private renderLlmSection\(containerEl: HTMLElement\): void \{[\s\S]*?renderLlmSettingsSection\(this, containerEl\);[\s\S]*?\}/);
	assert.match(source, /private renderSoulSection\(containerEl: HTMLElement\): void \{[\s\S]*?renderSoulSettingsSection\(this, containerEl\);[\s\S]*?\}/);
	assert.match(llmSectionSource, /export function renderLlmSettingsSection/);
	assert.match(llmSectionSource, /createNativeSettingsGroup\(containerEl/);
	assert.match(llmSectionSource, /new Setting\(statusGroup\)/);
	assert.match(soulSectionSource, /export function renderSoulSettingsSection/);
	assert.match(soulSectionSource, /createNativeSettingsGroup\(containerEl/);
	assert.match(soulSectionSource, /new Setting\(managementGroup\)/);
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
	const soulSectionSource = read(soulSettingsSectionPath);
	const zhLocale = read(zhLocalePath);
	assert.match(source, /settings\.section\.agent/);
	assert.match(source, /private renderSoulSection\(containerEl: HTMLElement\): void \{[\s\S]*?renderSoulSettingsSection\(this, containerEl\);[\s\S]*?\}/);
	assert.doesNotMatch(source, /private renderAgentSection\(containerEl: HTMLElement\): void \{/);
	assert.match(soulSectionSource, /legacyAgentCleanupService/);
	assert.match(soulSectionSource, /settings\.soul\.cleanup/);
	assert.match(source, /pendingSoulCleanupConfirm/);
	assert.match(soulSectionSource, /settings\.soul\.cleanup\.confirm/);
	assert.match(soulSectionSource, /settings\.soul\.cleanup\.danger/);
	assert.doesNotMatch(source, /settings\.agents/);
	assert.doesNotMatch(source, /getActiveAgent\(/);
	assert.doesNotMatch(source, /activeAgentId/);
	assert.doesNotMatch(soulSectionSource, /\$\{soul\.name\} \(\$\{soul\.id\}\)/);
	assert.match(soulSectionSource, /settings\.agent\.currentSoul\.name/);
	assert.match(soulSectionSource, /settings\.agent\.currentSoul\.desc/);
	assert.match(soulSectionSource, /settings\.agent\.currentModel\.name/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.title/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.setCurrent/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.current/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.edit/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.editUnavailable/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.delete/);
	assert.match(soulSectionSource, /settings\.agent\.manage\.deleteUnavailable/);
	assert.match(source, /settings\.agent\.manage\.deleteBlocked/);
	assert.match(soulSectionSource, /settings\.agent\.create\.fromTemplateAction/);
	assert.match(zhLocale, /"settings\.agent\.create\.fromTemplateAction": "去实验室看看"/);
	assert.match(soulSectionSource, /friday-soul-manage-icon-button/);
	assert.match(soulSectionSource, /friday-soul-manage-row/);
	assert.match(soulSectionSource, /friday-soul-manage-actions/);
	assert.match(soulSectionSource, /friday-soul-manage-placeholder/);
	assert.match(soulSectionSource, /setIcon\(isCurrent \? "check-circle-2" : "circle"\)/);
	assert.match(soulSectionSource, /setIcon\("pencil"\)/);
	assert.match(soulSectionSource, /setIcon\("trash-2"\)/);
	assert.match(soulSectionSource, /setDisabled\(!canEdit\)/);
	assert.match(soulSectionSource, /setDisabled\(!canDelete\)/);
	assert.match(soulSectionSource, /if \(isCurrent && ctx\.isExperimentSoul\(definition\)\)/);
	assert.match(soulSectionSource, /await ctx\.setCurrentSoulFromSettings\(ctx\.getNativeSoulFallbackId\(souls, soul\.id\)\)/);
	assert.match(source, /private canEditSoul/);
	assert.match(source, /private isExperimentSoul/);
	assert.match(soulSectionSource, /function renderSoulEditorSettingsSection/);
	assert.doesNotMatch(soulSectionSource, /"新建 Agent"/);
	assert.doesNotMatch(soulSectionSource, /"Agent 名称"/);
	assert.doesNotMatch(soulSectionSource, /"保存 Agent 设定"/);
	assert.match(soulSectionSource, /"新建 Soul"/);
	assert.match(soulSectionSource, /"Soul 名称"/);
	assert.match(soulSectionSource, /"保存 Soul 定义"/);
	assert.match(soulSectionSource, /原生 FRIDAY/);
	assert.match(soulSectionSource, /settings\.agent\.profile\.name/);
	assert.match(soulSectionSource, /settings\.agent\.profile\.summary/);
	assert.match(soulSectionSource, /settings\.agent\.profile\.definition/);
	assert.doesNotMatch(soulSectionSource, /new Setting\(editorGroup\)[\s\S]{0,500}settings\.agent\.profile\.reset/);
	assert.match(soulSectionSource, /settings\.agent\.profile\.save/);
	assert.match(source, /await this\.host\.soulStore\.updateSoul\(soulId,\s*\{/);
	assert.match(source, /await this\.host\.soulStore\.deleteSoul\(/);
	assert.match(source, /await this\.host\.setActiveSoul\(fallbackId\)/);
	assert.match(source, /name:/);
	assert.match(source, /summary:/);
	assert.match(source, /description:/);
	assert.match(source, /rolePrompt:/);
});

test("soul management icon controls keep a fixed three-column action rail", () => {
	const styles = read(stylesPath);
	assert.match(styles, /\.friday-soul-manage-row[\s\S]*?\.setting-item-control\s*\{/);
	assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*34px\)/);
	assert.match(styles, /\.friday-soul-manage-icon-button\s*\{[\s\S]*?border:\s*1px solid var\(--friday-kit-border\)/);
	assert.match(styles, /\.friday-soul-manage-icon-button\.is-current\s*\{[\s\S]*?var\(--interactive-accent\)/);
	assert.match(styles, /\.friday-soul-manage-icon-button\.friday-soul-manage-placeholder/);
	assert.match(styles, /\.friday-soul-manage-icon-button:disabled/);
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
	const llmSectionSource = read(llmSettingsSectionPath);
	const projectSectionSource = read(projectSettingsSectionPath);
	assert.doesNotMatch(source, /renderUserSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.user"\) \}\)/);
	assert.doesNotMatch(source, /renderSyncSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.sync"\) \}\)/);
	assert.doesNotMatch(llmSectionSource, /createEl\("h3", \{ text: ctx\.host\.t\("settings\.section\.llm"\) \}\)/);
	assert.doesNotMatch(source, /renderAgentSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.agent"\) \}\)/);
	assert.doesNotMatch(source, /renderSubscriptionsSection\(containerEl: HTMLElement\): void \{[\s\S]*?createEl\("h3", \{ text: this\.host\.t\("settings\.section\.subscriptions"\) \}\)/);
	assert.doesNotMatch(projectSectionSource, /createEl\("h3", \{ text: ctx\.host\.t\("settings\.section\.project"\) \}\)/);
});

test("subscriptions and project sections replace old friday-card settings panels with native groups", () => {
	const source = read(settingsPath);
	const projectSectionSource = read(projectSettingsSectionPath);
	assert.doesNotMatch(source, /const card = containerEl\.createDiv\(\{ cls: "friday-card" \}\)/);
	assert.doesNotMatch(source, /friday-card friday-project-settings-panel/);
	assert.match(source, /renderSubscriptionsSection\(containerEl: HTMLElement\): void \{/);
	assert.match(source, /officialContentService\.runBackgroundSync\(/);
	assert.match(projectSectionSource, /createNativeSettingsGroup\(shell,\s*\{/);
	assert.match(projectSectionSource, /friday-project-settings-panel/);
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

test("settings title uses configuration copy and aligns with native group content", () => {
	const settings = read(settingsPath);
	const zhLocale = read(zhLocalePath);
	const styles = read(stylesPath);
	const titleBlock = styles.match(/\.friday-settings-title\s*\{([\s\S]*?)\}/)?.[1] ?? "";
	const scopedTitleBlock = styles.match(/\.vertical-tab-content \.friday-settings-title\s*\{([\s\S]*?)\}/)?.[1] ?? "";
	const settingsNavBlock = styles.match(/\.modal\.mod-settings \.friday-top-nav\s*\{([\s\S]*?)\}/)?.[1] ?? "";
	const groupBlock = styles.match(/\.friday-native-settings-group\s*\{([\s\S]*?)\}/)?.[1] ?? "";

	assert.match(settings, /titleText: this\.host\.t\("settings\.title"\)/);
	assert.match(zhLocale, /"settings\.title": "配置你的FRIDAY"/);
	assert.match(titleBlock, /padding-left:\s*20px;/);
	assert.match(scopedTitleBlock, /padding:\s*0\s+20px;/);
	assert.match(settingsNavBlock, /padding:\s*0\s+0\s+0\s+10px;/);
	assert.match(groupBlock, /padding:\s*20px;/);
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
