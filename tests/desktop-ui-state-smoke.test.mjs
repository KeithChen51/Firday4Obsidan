/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const workbenchRoot = path.join(projectRoot, "src/desktop/ui/workbench");
const modelPath = path.join(workbenchRoot, "WorkbenchSmokeModel.ts");
const htmlPath = path.join(workbenchRoot, "workbench.html");
const cssPath = path.join(workbenchRoot, "workbench.css");
const jsPath = path.join(workbenchRoot, "workbench.js");

function readRequiredFile(filePath) {
	assert.equal(fs.existsSync(filePath), true, `${path.relative(projectRoot, filePath)} should exist`);
	return fs.readFileSync(filePath, "utf8");
}

function assertContainsAll(source, tokens, label) {
	for (const token of tokens) {
		assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} should include ${token}`);
	}
}

async function loadSmokeState() {
	const model = await jiti.import(modelPath);
	return model.createWorkbenchSmokeState();
}

test("desktop workbench state models the approved FRIDAY information architecture", async () => {
	const state = await loadSmokeState();

	assert.deepEqual(
		state.primaryRail.map((item) => [item.id, item.label, item.icon]),
		[
			["search", "搜索", "⌕"],
			["projects", "项目", "▦"],
			["team", "团队", "◌"],
			["calendar", "日历", "□"],
			["modules", "模块", "◇"],
			["soul", "SOUL", "✦"],
			["settings", "设置", "⚙"],
		],
	);

	assert.equal(state.projectMenu.currentProject.name, "Friday Desktop Runtime");
	assert.equal(state.projectMenu.homeAction.label, "返回项目主页");
	assert.deepEqual(
		state.projectMenu.bottomEntrypoints.map((entry) => entry.id),
		["library", "wiki", "skills"],
		"the second project menu bottom should only expose library, Wiki, and skills",
	);
	assert.equal(
		state.projectMenu.bottomEntrypoints.some((entry) => entry.id === "artifacts"),
		false,
		"artifacts should not be a second-level project menu entry",
	);

	assert.deepEqual(
		state.projectHome.sections.map((section) => section.id),
		[
			"composer",
			"projectConversations",
			"librarySummary",
			"skillSummary",
			"wikiPlaceholder",
			"calendarPlaceholder",
			"collaborators",
			"remoteConfigStatus",
		],
	);
});

test("desktop workbench resource window excludes Wiki and keeps one shared tab surface", async () => {
	const state = await loadSmokeState();

	assert.deepEqual(
		state.resourceWindow.tabs.map((tab) => [tab.id, tab.label]),
		[
			["library", "资料库"],
			["fileTree", "项目文件树"],
			["skills", "技能"],
			["artifacts", "产物"],
		],
	);
	assert.equal(state.resourceWindow.tabs.some((tab) => tab.id === "wiki" || tab.label === "Wiki"), false);
	assert.equal(state.resourceWindow.presentation, "shared-window");
	assert.equal(state.conversation.withoutCanvas.resourceWindow.presentation, "right-shared-window");
	assert.equal(state.conversation.withCanvas.resourceWindow.presentation, "title-row-popover");

	for (const item of state.resourceWindow.library.items) {
		assert.deepEqual(Object.keys(item).sort(), ["name", "type"], "library tab items should expose only type and file name");
	}
	assert.deepEqual(
		state.resourceWindow.fileTree.items[0].actions,
		[
			{ id: "openInCanvas", label: "在画布中打开" },
			{ id: "addToConversation", label: "添加到对话" },
		],
	);
	assert.equal(state.resourceWindow.skills.scopeDefault, "project");
	assert.equal(state.resourceWindow.skills.scopeToggle, "global");
	assert.equal(state.resourceWindow.artifacts.conversationScoped, true);
});

test("desktop workbench composer encodes conversation-level permission controls", async () => {
	const state = await loadSmokeState();

	assert.deepEqual(state.composer.bottomControls, ["+", "FRIDAY Local 0.1", "标准"]);
	assert.equal(state.composer.permissionMode, "standard");
	assert.equal(state.composer.permissionScope, "current-conversation");
	assert.equal(state.composer.displayText, "+ · FRIDAY Local 0.1 · 标准");
});

test("desktop renderer files expose the static workbench entry without forbidden runtime imports", () => {
	const html = readRequiredFile(htmlPath);
	const css = readRequiredFile(cssPath);
	const js = readRequiredFile(jsPath);
	const model = readRequiredFile(modelPath);
	const rendererSources = `${html}\n${css}\n${js}\n${model}`;
	const canvasView = html.match(/<section class="workbench-view" data-view="conversation-canvas"[\s\S]*?<\/section>\s*<\/main>/)?.[0] ?? "";
	const resourceButtons = [...html.matchAll(/<button\b[^>]*data-resource-tab="([^"]+)"[^>]*>/g)];

	assertContainsAll(
		html,
		[
			"data-view=\"project-home\"",
			"data-view=\"conversation-no-canvas\"",
			"data-view=\"conversation-canvas\"",
			"data-resource-tab=\"library\"",
			"data-resource-tab=\"fileTree\"",
			"data-resource-tab=\"skills\"",
			"data-resource-tab=\"artifacts\"",
			"data-canvas-resource-window",
			"fridayDesktop",
			"+ · FRIDAY Local 0.1 · 标准",
			"进入项目资料库",
			"在画布中打开",
			"添加到对话",
		],
		"workbench.html",
	);
	assert.doesNotMatch(html, /data-resource-tab=["']wiki["']/i, "conversation resource tabs should not include Wiki");
	assert.equal(resourceButtons.length, 8, "no-canvas and canvas views should each expose four resource buttons");
	for (const match of resourceButtons) {
		const tabId = match[1];
		const buttonHtml = match[0];
		assert.match(buttonHtml, /\baria-label="[^"]+"/, `resource ${tabId} button should have an aria-label`);
		assert.match(buttonHtml, /\baria-pressed="(?:true|false)"/, `resource ${tabId} button should expose aria-pressed`);
	}
	assertContainsAll(
		canvasView,
		[
			"data-canvas-resource-window",
			"data-resource-panel=\"library\"",
			"data-resource-panel=\"fileTree\"",
			"data-resource-panel=\"skills\"",
			"data-resource-panel=\"artifacts\"",
			"进入项目资料库",
			"在画布中打开",
			"添加到对话",
		],
		"canvas conversation resource popover",
	);
	assertContainsAll(css, ["#1E1F21", "#F4F1EB", "#4A7F7B", "#D9D5CA", "#E07A5F"], "workbench.css");
	assertContainsAll(js, ["window.fridayDesktop", "getSmokeState", "data-resource-tab", "data-view", "data-canvas-resource-window", "is-open", "aria-pressed"], "workbench.js");
	assert.doesNotMatch(rendererSources, /from\s+["']electron["']|require\(["']electron["']\)/);
	assert.doesNotMatch(rendererSources, /from\s+["']node:|require\(["'](?:fs|child_process|path)["']\)/);
	assert.doesNotMatch(rendererSources, /@earendil-works\/pi-/);
});
