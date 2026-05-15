/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsModelPath = path.join(projectRoot, "src/types/settings.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const settingsTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const onboardingServicePath = path.join(projectRoot, "src/services/OnboardingService.ts");
const eventsPath = path.join(projectRoot, "src/constants/events.ts");
const stylesPath = path.join(projectRoot, "styles.css");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("settings model exposes default workbench startup behavior", () => {
	const source = read(settingsModelPath);
	assert.match(source, /export type WorkbenchStartupPlacement =[\s\S]*"right-sidebar"[\s\S]*"left-sidebar"/);
	assert.doesNotMatch(source, /"workspace-right"|"workspace-left"|"workspace-below"|"workspace-above"/);
	assert.match(source, /workbench:\s*\{\s*openOnStartup: boolean;\s*startupPlacement: WorkbenchStartupPlacement;\s*onboardingDismissed: boolean;\s*\};/);
	assert.match(source, /export const SETTINGS_VERSION = 10;/);
	assert.match(source, /workbench:\s*\{\s*openOnStartup: true,\s*startupPlacement: "right-sidebar",\s*onboardingDismissed: false,\s*\}/);
});

test("plugin startup opens the workbench after layout restore without triggering heavy work", () => {
	const source = read(mainPath);
	assert.match(source, /this\.app\.workspace\.onLayoutReady\(\(\) => \{[\s\S]*?this\.settings\.workbench\.openOnStartup[\s\S]*?this\.openWorkspaceView\(this\.settings\.workbench\.startupPlacement\)/);
	const startupBlock = source.match(/onLayoutReady\(\(\) => \{([\s\S]*?)\}\);/);
	assert.ok(startupBlock, "startup workbench onLayoutReady block should exist");
	assert.doesNotMatch(startupBlock[1] ?? "", /runStartupSync|runStartupOfficialContentCheck|runStartupPluginUpdateCheck|refreshCatalog|applySubscriptions|aiService/);
});

test("openWorkspaceView supports configured placement and reuses an existing Friday leaf", () => {
	const source = read(mainPath);
	assert.match(source, /async openWorkspaceView\(placement: FridaySettings\["workbench"\]\["startupPlacement"\] = this\.settings\.workbench\.startupPlacement\): Promise<void>/);
	assert.match(source, /getLeavesOfType\(VIEW_TYPE_DAILY_BOARD\)/);
	assert.match(source, /getLeftLeaf\(false\)/);
	assert.match(source, /getRightLeaf\(false\)/);
	assert.doesNotMatch(source, /createLeafBySplit|getLeaf\("split"|workspace-right|workspace-left|workspace-below|workspace-above/);
});

test("settings tab lets users control startup open behavior and placement", () => {
	const source = read(settingsTabPath);
	assert.match(source, /settings\.workbench\.openOnStartup\.name/);
	assert.match(source, /this\.host\.settings\.workbench\.openOnStartup/);
	assert.match(source, /settings\.workbench\.startupPlacement\.name/);
	assert.match(source, /this\.host\.settings\.workbench\.startupPlacement/);
	for (const placement of ["right-sidebar", "left-sidebar"]) {
		assert.match(source, new RegExp(`addOption\\("${placement}"`));
	}
	for (const placement of ["workspace-right", "workspace-left", "workspace-below", "workspace-above"]) {
		assert.doesNotMatch(source, new RegExp(`addOption\\("${placement}"`));
	}
});

test("onboarding service derives cold-start state without model git token or official content side effects", () => {
	assert.ok(fs.existsSync(onboardingServicePath), "OnboardingService should exist");
	const source = read(onboardingServicePath);
	assert.match(source, /export class OnboardingService/);
	assert.match(source, /getSnapshot\(\): OnboardingSnapshot/);
	assert.match(source, /modelConfigured/);
	assert.match(source, /projectRegistered/);
	assert.match(source, /onboardingDismissed/);
	assert.match(source, /shouldShowPanel:\s*!settings\.workbench\.onboardingDismissed\s*&&\s*\(!projectRegistered\s*\|\|\s*!modelConfigured\)/);
	assert.doesNotMatch(source, /userProfileConfigured|gitUserEmail/);
	assert.doesNotMatch(source, /PRIMARY_PATHS|studioStartHereFile|getStartHerePath|startHereInstalled|officialContentInstalled/);
	assert.doesNotMatch(source, /AgentService|AIService|refreshCatalog|applySubscriptions|runStartupCheck|syncAllProjects/);
});

test("settings changes refresh onboarding without waiting for project events", () => {
	const events = read(eventsPath);
	const mainSource = read(mainPath);
	const dailySource = read(dailyBoardPath);
	assert.match(events, /FRIDAY_SETTINGS_CHANGED_EVENT/);
	assert.match(mainSource, /FRIDAY_SETTINGS_CHANGED_EVENT/);
	assert.match(mainSource, /window\.dispatchEvent\(new CustomEvent\(FRIDAY_SETTINGS_CHANGED_EVENT\)\)/);
	assert.match(dailySource, /window\.addEventListener\(FRIDAY_SETTINGS_CHANGED_EVENT,\s*this\.handleSettingsChanged\)/);
	assert.match(dailySource, /window\.removeEventListener\(FRIDAY_SETTINGS_CHANGED_EVENT,\s*this\.handleSettingsChanged\)/);
	assert.match(dailySource, /private handleSettingsChanged = \(\): void => \{[\s\S]*?void this\.safeRenderBoard\(\);[\s\S]*?\};/);
});

test("daily board renders onboarding panel when basic setup is incomplete", () => {
	const source = read(dailyBoardPath);
	const panelMethod = source.match(/private renderOnboardingPanel\(contentEl: HTMLElement\): void \{[\s\S]*?\n\t\}\n\n\tprivate renderOnboardingStep/);
	assert.ok(panelMethod, "renderOnboardingPanel method should exist");
	assert.match(source, /renderOnboardingPanel\(contentEl/);
	assert.match(source, /friday-onboarding-panel/);
	assert.match(source, /onboarding\.title/);
	assert.match(panelMethod[0], /onboarding\.title", "开启和FRIDAY的首次对话"/);
	assert.match(panelMethod[0], /onboarding\.step\.project\.title", "选择一个文件夹"/);
	assert.doesNotMatch(panelMethod[0], /header\.createEl\("p"/);
	assert.ok(
		panelMethod[0].indexOf("onboarding.step.project.title") < panelMethod[0].indexOf("onboarding.step.model.title"),
		"project registration should appear before model configuration",
	);
	assert.match(source, /onboarding\.action\.configureModel/);
	assert.match(source, /onboarding\.action\.skip/);
	assert.match(source, /onboardingDismissed = true/);
	assert.match(source, /await this\.plugin\.saveSettings\(\)/);
	assert.match(source, /openSettingsTab\("llm"\)/);
	assert.match(source, /onboarding\.action\.registerProject/);
	assert.match(source, /openSettingsTab\("project"\)/);
	assert.match(panelMethod[0], /friday-onboarding-actions/);
	assert.doesNotMatch(panelMethod[0], /onboarding\.step\.git|onboarding\.action\.checkGit|Git 与用户凭证/);
	assert.doesNotMatch(panelMethod[0], /openSettingsTab\("user"\)/);
	assert.doesNotMatch(panelMethod[0], /onboarding\.step\.official|官方内容与 Start Here/);
	assert.doesNotMatch(source, /onboarding\.action\.openStartHere|onboarding\.action\.disableAutoOpen/);
	assert.doesNotMatch(source, /refreshOfficialContentFromOnboarding|openStartHere/);
});

test("onboarding panel styles are present and avoid card nesting", () => {
	const styles = read(stylesPath);
	const headerStyles = styles.match(/\.friday-onboarding-header\s*\{[\s\S]*?\}/);
	const panelStyles = styles.match(/\.friday-onboarding-panel\s*\{[\s\S]*?\}/);
	assert.ok(headerStyles, "onboarding header styles should exist");
	assert.ok(panelStyles, "onboarding panel styles should exist");
	assert.match(styles, /\.friday-onboarding-panel\s*\{/);
	assert.match(styles, /\.friday-onboarding-list\s*\{/);
	assert.match(styles, /\.friday-onboarding-step\s*\{/);
	assert.match(headerStyles[0], /align-items:\s*center;/);
	assert.match(headerStyles[0], /text-align:\s*center;/);
	assert.match(styles, /\.friday-onboarding-actions\s*\{/);
	assert.doesNotMatch(panelStyles[0], /\.friday-card/);
});
