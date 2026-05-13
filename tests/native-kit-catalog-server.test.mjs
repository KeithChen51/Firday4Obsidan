import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createNativeKitCatalogServer } from "../scripts/native-kit-catalog-server.mjs";

async function createTempRepo() {
	const repoRoot = await mkdtemp(path.join(os.tmpdir(), "friday-native-kit-"));
	await mkdir(path.join(repoRoot, "docs", "design"), { recursive: true });
	await mkdir(path.join(repoRoot, "brand", "logo"), { recursive: true });
	await writeFile(
		path.join(repoRoot, "docs", "design", "native-kit-catalog.html"),
		"<!doctype html><title>FRIDAY Native Kit</title>",
		"utf8",
	);
	await writeFile(path.join(repoRoot, "brand", "logo", "friday-logo.svg"), "<svg></svg>", "utf8");
	return repoRoot;
}

test("native kit catalog server persists decisions to docs/design", async (t) => {
	const repoRoot = await createTempRepo();
	t.after(() => rm(repoRoot, { recursive: true, force: true }));

	const server = createNativeKitCatalogServer({ repoRoot, host: "127.0.0.1", port: 0, log: false });
	const running = await server.start();
	t.after(() => running.close());

	const payload = {
		theme: "dark",
		density: "compact",
		choices: {
			"品牌页头": "keep",
			"设置页框架": "adjust",
			"插件入口图标": "hold",
		},
	};

	const postResponse = await fetch(`${running.url}/api/native-kit-catalog-decisions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	assert.equal(postResponse.status, 200);
	const posted = await postResponse.json();
	assert.deepEqual(posted.counts, { keep: 1, adjust: 1, hold: 1 });

	const decisionsPath = path.join(repoRoot, "docs", "design", "native-kit-catalog-decisions.json");
	const written = JSON.parse(await readFile(decisionsPath, "utf8"));
	assert.equal(written.schemaVersion, 1);
	assert.equal(written.theme, "dark");
	assert.equal(written.density, "compact");
	assert.deepEqual(written.choices, payload.choices);
	assert.deepEqual(written.counts, { keep: 1, adjust: 1, hold: 1 });
	assert.match(written.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

	const getResponse = await fetch(`${running.url}/api/native-kit-catalog-decisions`);
	assert.equal(getResponse.status, 200);
	const fetched = await getResponse.json();
	assert.deepEqual(fetched.choices, payload.choices);
	assert.deepEqual(fetched.counts, { keep: 1, adjust: 1, hold: 1 });
});

test("native kit catalog server serves the catalog and brand assets", async (t) => {
	const repoRoot = await createTempRepo();
	t.after(() => rm(repoRoot, { recursive: true, force: true }));

	const server = createNativeKitCatalogServer({ repoRoot, host: "127.0.0.1", port: 0, log: false });
	const running = await server.start();
	t.after(() => running.close());

	const htmlResponse = await fetch(`${running.url}/docs/design/native-kit-catalog.html`);
	assert.equal(htmlResponse.status, 200);
	assert.equal(htmlResponse.headers.get("content-type"), "text/html; charset=utf-8");
	assert.match(await htmlResponse.text(), /FRIDAY Native Kit/);

	const assetResponse = await fetch(`${running.url}/brand/logo/friday-logo.svg`);
	assert.equal(assetResponse.status, 200);
	assert.equal(assetResponse.headers.get("content-type"), "image/svg+xml");
	assert.match(await assetResponse.text(), /<svg/);

	const blockedResponse = await fetch(`${running.url}/package.json`);
	assert.equal(blockedResponse.status, 404);
});

test("native kit catalog page can sync choices to the local server", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");

	assert.match(html, /id="syncStatus"/);
	assert.match(html, /\/api\/native-kit-catalog-decisions/);
	assert.match(html, /function loadServerState/);
	assert.match(html, /function syncStateToServer/);
});

test("native kit accepted spec matches the reviewed catalog decisions", async () => {
	const decisionsPath = path.resolve("docs", "design", "native-kit-catalog-decisions.json");
	const specPath = path.resolve("docs", "design", "friday-native-kit.md");
	const migrationMapPath = path.resolve("docs", "design", "friday-native-kit-migration-map.md");

	const decisions = JSON.parse(await readFile(decisionsPath, "utf8"));
	const spec = await readFile(specPath, "utf8");
	const migrationMap = await readFile(migrationMapPath, "utf8");

	assert.deepEqual(decisions.counts, { keep: 14, adjust: 0, hold: 1 });
	assert.equal(decisions.choices["项目状态组"], "hold");

	for (const component of [
		"品牌页头",
		"小尺寸标识",
		"插件入口图标",
		"设置页框架",
		"设置行状态",
		"危险操作设置行",
		"空状态",
		"行内提醒",
		"前置条件列表",
		"审批强提醒",
		"工作台顶部栏",
		"助手消息",
		"对话输入区",
		"执行过程时间线",
	]) {
		assert.equal(decisions.choices[component], "keep", `${component} should remain accepted`);
		assert.match(spec, new RegExp(component, "u"), `${component} should be documented in the spec`);
	}

	for (const requiredSpecText of [
		"FRIDAY Obsidian Native Kit v0.2",
		"`项目状态组` 不在首批实现范围内",
		"去掉输入框下方的小上下文状态条",
		"Skill 被选中后只显示技能名，不显示前导 `/`",
		"已选中的 `@` token 不需要文件类型 icon",
		"Task Bar 收起并贴住输入框",
		"审批卡片占用对话输入区",
		"产物用文件类型 icon 区分",
	]) {
		assert.match(spec, new RegExp(requiredSpecText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
	}

	for (const requiredMapText of [
		"`项目状态组` 暂缓，不进入首批迁移",
		"对话输入区 + Task Bar",
		"Task Bar 收起态贴住输入框上方",
		"Skill 列表项显示技能名，不显示 `Skill` 前缀",
		"`@` 文件列表可按文件类型显示 icon，已选 token 不显示 icon",
		"首批迁移不改 `项目状态组`",
	]) {
		assert.match(migrationMap, new RegExp(requiredMapText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
	}
});

test("native kit catalog exposes v2 candidates for adjusted components", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");
	const adjustedComponents = ["工作台顶部栏", "助手消息", "执行过程时间线", "项目状态组", "行内提醒"];

	for (const component of adjustedComponents) {
		assert.match(
			html,
			new RegExp(`data-component="${component}"[^>]*data-adjusted-candidate="true"`, "u"),
			`${component} should be marked as a v2 adjusted candidate`,
		);
	}

	for (const className of [
		"friday-workbench-bar-v2",
		"friday-assistant-thread-v2",
		"friday-agent-run-list-v2",
		"friday-project-panel-v2",
		"friday-inline-notice-v2",
	]) {
		assert.match(html, new RegExp(`class="[^"]*${className}`, "u"));
	}

	assert.match(html, />调整版候选</);
	assert.match(html, />Native Kit v0.2</);
});

test("native kit catalog reflects the reviewed v2 component direction", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");

	assert.match(html, /friday-native-inline-callout/);
	assert.match(html, /workbench-brand-text-v3/);
	const workbenchMarkup = html.match(/data-component="工作台顶部栏"[\s\S]*?<\/article>/u)?.[0] || "";
	assert.doesNotMatch(workbenchMarkup, /friday-mark is-contained/);

	for (const className of [
		"assistant-document-flow-v3",
		"assistant-user-bubble-v3",
		"assistant-output-block is-prose",
		"assistant-output-block is-tool",
	]) {
		assert.match(html, new RegExp(className, "u"));
	}

	for (const className of ["artifact-type-icon is-markdown", "artifact-type-icon is-canvas", "artifact-type-icon is-note"]) {
		assert.match(html, new RegExp(className, "u"));
	}

	assert.match(html, /project-candidate-grid-v3/);
	assert.match(html, /data-project-variant="list"/);
	assert.match(html, /data-project-variant="compact"/);
	assert.match(html, /data-project-variant="inspector"/);
});

test("native kit catalog includes assistant process taskbar system refinements", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");

	const workbenchMarkup = html.match(/data-component="工作台顶部栏"[\s\S]*?<\/article>/u)?.[0] || "";
	assert.match(workbenchMarkup, /workbench-brand-logo-v4/);
	assert.match(workbenchMarkup, /friday-icon\.svg/);

	for (const className of [
		"assistant-output-block is-prose",
		"assistant-output-block is-tool",
		"assistant-output-block is-artifact",
		"assistant-tool-call-v5",
		"assistant-tool-icon-v5",
		"assistant-tool-name-v5",
		"composer-input-kit-v5 is-empty",
		"composer-input-kit-v5 is-skill",
		"composer-input-kit-v5 is-skill-picker",
		"composer-input-kit-v5 is-approval",
		"composer-control-row-v5",
		"composer-live-combo-grid-v5",
		"composer-live-shell-v5",
		"composer-live-caption-v5",
		"composer-live-compose-v5 is-attached",
		"composer-live-compose-v5 is-attached is-attached-surface",
		"composer-live-input-v5",
		"composer-skill-popover-demo-v5",
		"composer-skill-picker-v5",
		"composer-skill-picker-v5 is-above-input",
		"composer-skill-anchor-v5",
		"composer-skill-query-v5",
		"composer-skill-list-v5",
		"composer-skill-option-v5",
		"composer-mention-popover-demo-v5",
		"composer-mention-picker-v5",
		"composer-mention-picker-v5 is-above-input",
		"composer-mention-option-v5",
		"composer-mention-copy-v5",
		"composer-file-type-icon-v5 is-note",
		"composer-file-type-icon-v5 is-html",
		"composer-file-type-icon-v5 is-markdown",
		"composer-file-type-icon-v5 is-canvas",
		"icon-code",
		"composer-mention-anchor-v5",
		"composer-token-v5 is-context",
		"composer-dialog-approval-demo-v5",
		"composer-approval-card-v5",
		"friday-approval-card composer-approval-card-v5",
		"composer-taskbar-kit-v5 is-collapsed",
		"composer-taskbar-kit-v5 is-expanded",
		"friday-composer-task-bar",
		"friday-ai-composer-task-bar-host",
		"assistant-control-button is-model",
		"assistant-control-button is-permission",
		"assistant-control-button is-context",
		"assistant-control-button is-skill",
		"Skill 列表沿用 friday-mention-dropdown，向输入框上方展开",
		"@ 引用文件选择",
		"审批强提醒",
		"审批操作占用对话框输入区",
		"Task Bar 与对话框组合态",
		"收起态：默认跟随输入框上方常驻",
		"展开态：临时查看步骤，输入框仍在下方",
		"把 Task Bar 和输入区贴在一起看一下",
		"补齐输入区状态",
		"确认迁移规范",
		"Task Bar 不占用输入内容区域",
		"native-kit-catalog",
		"docs/design/native-kit-catalog.html",
		"docs/design/native-kit-map.canvas",
		"当前笔记",
	]) {
		assert.match(html, new RegExp(className, "u"));
	}

	assert.match(html, /<span class="composer-token-v5">obsidian-markdown<\/span>/u);
	assert.match(html, /<span class="composer-token-v5 is-context">@ native-kit-catalog<\/span>/u);
	assert.doesNotMatch(html, /composer-token-file-icon-v5/u);
	assert.match(html, /<strong>json-canvas<\/strong>/u);
	assert.match(html, /<strong>obsidian-bases<\/strong>/u);
	assert.match(html, /<strong>obsidian-cli<\/strong>/u);
	assert.doesNotMatch(html, /Skill · (json-canvas|obsidian-bases|obsidian-cli)/u);
	assert.match(html, />\/skills</u);
	assert.doesNotMatch(html, /<span class="composer-token-v5">\/[^<]+<\/span>/u);
	assert.doesNotMatch(html, /composer-context-strip-v5/u);
	assert.doesNotMatch(html, /composer-skill-form-v5/u);
	assert.doesNotMatch(html, /friday-task-bar-v4/);
	assert.doesNotMatch(html, /assistant-output-block is-plan/);
	assert.doesNotMatch(html, /data-component="审批卡片"/u);
	assert.doesNotMatch(html, />审批占用输入区</u);

	const projectMarkup = html.match(/data-project-variant="compact"[\s\S]*?data-project-variant="inspector"/u)?.[0] || "";
	assert.match(projectMarkup, /project-focus-strip-v4/);
	assert.match(projectMarkup, /project-health-meter-v4/);
});
