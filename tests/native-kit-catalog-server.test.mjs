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

	assert.deepEqual(decisions.counts, { keep: 13, adjust: 0, hold: 1 });
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
		"不单独定义“执行过程时间线”组件",
		"每个过程步骤都可以点击展开",
		"不要再加“过程”标题",
		"视觉强度必须低于上层步骤",
		"按文件类型显示 icon",
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
	const adjustedComponents = ["工作台顶部栏", "助手消息", "项目状态组", "行内提醒"];

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
		"friday-project-panel-v2",
		"friday-inline-notice-v2",
	]) {
		assert.match(html, new RegExp(`class="[^"]*${className}`, "u"));
	}

	assert.match(html, />调整版候选</);
	assert.match(html, />Native Kit v0.2</);
	assert.doesNotMatch(html, /data-component="执行过程时间线"/u);
	assert.doesNotMatch(html, /<h2>执行过程组件<\/h2>/u);
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
		"assistant-result-meta-v6",
		"assistant-process-toggle-v6",
		"assistant-process-detail-v6",
		"assistant-process-event-v6",
		"assistant-step-narration-v6",
		"assistant-step-toggle-v6",
		"assistant-step-detail-v6",
	]) {
		assert.match(html, new RegExp(className, "u"));
	}

	assert.match(html, />已思考</u);
	assert.match(html, />已完成工作</u);
	assert.match(html, />正在工作</u);
	assert.match(html, />已读取当前规范，确认过程说明只写工作日志，不展示内部推理。</u);
	assert.match(html, />已整理消息状态，明确正在思考、正在工作、已思考和已完成工作四种状态。</u);
	assert.match(html, />本次产出</u);
	assert.match(html, /aria-controls="assistant-process-detail-demo"/u);
	assert.match(html, /aria-controls="assistant-result-step-read"/u);
	assert.match(html, /aria-controls="assistant-work-step-message"/u);
	assert.match(html, /kit-event-row-v1\.kit-running-surface-v1\.assistant-process-event-v6\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/u);
	assert.match(html, /classList\.toggle\("is-process-open", !isOpen\)/u);
	assert.match(html, /classList\.toggle\("is-open", !isOpen\)/u);
	assert.match(html, /assistant-tool-call-v5\s*\{[\s\S]*--kit-event-row-height:\s*26px[\s\S]*opacity:\s*0\.86/u);
	assert.match(html, /assistant-tool-call-v5 \.kit-event-row-main-v1\s*\{[\s\S]*font-size:\s*0\.74rem/u);
	assert.match(html, /assistant-step-narration-v6\s*\{[\s\S]*white-space:\s*nowrap/u);
	assert.match(html, /id="assistant-work-step-read"[\s\S]*assistant-tool-call-v5[\s\S]*<div class="assistant-step-narration-v6">已读取当前规范/u);
	const runningStepStart = html.indexOf('aria-controls="assistant-work-step-message"');
	const runningStepEnd = html.indexOf('<div class="assistant-turn-v2 is-assistant is-simple-result"', runningStepStart);
	const runningStepMarkup = html.slice(runningStepStart, runningStepEnd);
	assert.doesNotMatch(runningStepMarkup, /assistant-step-narration-v6/u);
	assert.doesNotMatch(html, />文档流输出</u);
	assert.doesNotMatch(html, />上下文 3</u);
	assert.doesNotMatch(html, />可进入执行过程详情</u);
	assert.doesNotMatch(html, /assistant-process-heading-v6/u);
	assert.doesNotMatch(html, />过程<\/div>/u);

	for (const className of ["kit-file-type-icon-v1 is-markdown", "kit-file-type-icon-v1 is-canvas", "kit-file-type-icon-v1 is-note"]) {
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
		"assistant-output-block is-artifact",
		"kit-tool-icon-v1",
		"icon-tool-action",
		"assistant-result-meta-v6",
		"assistant-process-toggle-v6",
		"assistant-process-chevron-v6",
		"assistant-process-detail-v6",
		"assistant-process-detail-inner-v6",
		"assistant-process-event-v6",
		"assistant-step-narration-v6",
		"assistant-step-toggle-v6",
		"assistant-step-detail-v6",
		"assistant-step-detail-inner-v6",
		"已思考",
		"已完成工作",
		"正在工作",
		"过程步骤可带工作叙述",
		"已整理消息状态，明确正在思考、正在工作、已思考和已完成工作四种状态。",
		"本次产出",
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
		"kit-popover-item-v1 is-text-only",
		"composer-mention-popover-demo-v5",
		"composer-mention-picker-v5",
		"composer-mention-picker-v5 kit-popover-list-v1 is-above-input",
		"kit-popover-item-v1",
		"composer-mention-copy-v5",
		"kit-file-type-icon-v1 is-note",
		"kit-file-type-icon-v1 is-code",
		"kit-file-type-icon-v1 is-markdown",
		"kit-file-type-icon-v1 is-canvas",
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
		"kit-control-button-v1 is-model",
		"kit-control-button-v1 is-permission",
		"kit-control-button-v1 is-context",
		"kit-control-button-v1 is-skill",
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

test("native kit catalog preserves theme responsive and reduced-motion CSS contracts", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");

	assert.match(html, /<html lang="zh-CN" data-theme="light" data-density="comfortable">/u);
	assert.match(html, /:root\s*\{[\s\S]*color-scheme:\s*light/u);
	assert.match(html, /html\[data-theme="dark"\]\s*\{[\s\S]*color-scheme:\s*dark/u);
	assert.match(html, /data-theme-target="light"[\s\S]*data-theme-target="dark"/u);
	assert.match(html, /@media\s*\(max-width:\s*980px\)\s*\{[\s\S]*\.catalog-layout\s*\{[\s\S]*grid-template-columns:\s*1fr/u);
	assert.match(html, /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*\.catalog-header-inner\s*\{[\s\S]*grid-template-columns:\s*1fr/u);
	assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.kit-running-surface-v1::after\s*\{[\s\S]*animation:\s*none[\s\S]*opacity:\s*0/u);
});

test("native kit catalog includes scanned components and reusable primitives", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const specPath = path.resolve("docs", "design", "friday-native-kit.md");
	const migrationMapPath = path.resolve("docs", "design", "friday-native-kit-migration-map.md");
	const html = await readFile(htmlPath, "utf8");
	const spec = await readFile(specPath, "utf8");
	const migrationMap = await readFile(migrationMapPath, "utf8");

	for (const component of [
		"状态徽标",
		"文件类型图标元件",
		"低强调事件行",
		"运行中表面",
		"浮层列表项",
		"控制按钮组",
		"设置页状态反馈",
		"变更审阅 Diff",
		"首次引导步骤",
		"运行状态提示组",
		"能力控制中心",
		"对话记录抽屉",
		"同步冲突差异",
	]) {
		assert.match(html, new RegExp(`data-component="${component}"`, "u"));
		assert.match(spec, new RegExp(component.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
	}

	for (const className of [
		"foundation-grid-v1",
		"kit-soft-chip-v1",
		"kit-file-type-icon-v1",
		"kit-event-row-v1",
		"kit-event-row-main-v1",
		"kit-running-surface-v1",
		"kit-popover-list-v1",
		"kit-tool-icon-v1",
		"kit-skill-icon-v1",
		"settings-status-stack-v1",
		"diff-preview-kit-v1",
		"onboarding-step-action-v1",
		"onboarding-steps-v1",
		"runtime-stack-v1",
		"control-center-kit-v1",
		"session-drawer-kit-v1",
		"sync-conflict-layout-v1",
		"scan-row-v1 is-text-only",
		"friday-kit-running-sheen",
		"prefers-reduced-motion",
		"--kit-event-row-height, 40px",
		"text-overflow: ellipsis",
		"white-space: nowrap",
		"icon-file",
		"icon-tool-action",
		"icon-skill",
	]) {
		assert.match(html, new RegExp(className, "u"));
	}

	const sections = new Map(
		[...html.matchAll(/<section class="kit-section" id="([^"]+)"[\s\S]*?(?=<section class="kit-section" id=|<\/main>)/gu)]
			.map((match) => [match[1], match[0]]),
	);
	assert.match(sections.get("foundation") || "", /data-component="状态徽标"/u);
	assert.match(sections.get("settings") || "", /data-component="设置页状态反馈"/u);
	assert.match(sections.get("actions") || "", /data-component="变更审阅 Diff"/u);
	assert.match(sections.get("shell") || "", /data-component="首次引导步骤"/u);
	assert.match(sections.get("control") || "", /data-component="能力控制中心"/u);
	assert.match(sections.get("ai") || "", /data-component="对话记录抽屉"/u);
	assert.match(sections.get("project") || "", /data-component="同步冲突差异"/u);

	const runningSurfaceMarkup = html.match(/data-component="运行中表面"[\s\S]*?<\/article>/u)?.[0] || "";
	assert.match(runningSurfaceMarkup, /CSS 背景扫光/u);
	assert.doesNotMatch(runningSurfaceMarkup, /icon-refresh/u);

	const controlCenterMarkup = sections.get("control") || "";
	assert.match(controlCenterMarkup, /icon-tool-action/u);
	assert.match(controlCenterMarkup, /icon-skill/u);

	const sessionDrawerMarkup = html.match(/data-component="对话记录抽屉"[\s\S]*?<\/article>/u)?.[0] || "";
	assert.match(sessionDrawerMarkup, /scan-row-v1 is-selected is-text-only/u);
	assert.doesNotMatch(sessionDrawerMarkup, /kit-file-type-icon-v1/u);
	assert.doesNotMatch(sessionDrawerMarkup, /friday-mark is-contained/u);

	for (const requiredMapText of [
		"跨组件元组件",
		"新增组件候选已进 HTML 画板",
		"这些候选不改变当前 `native-kit-catalog-decisions.json` 的 13/0/1 选择计数",
		"同步冲突差异不是解除项目状态组暂缓",
	]) {
		assert.match(migrationMap, new RegExp(requiredMapText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
	}
});

test("native kit catalog applies reusable primitives to downstream component examples", async () => {
	const htmlPath = path.resolve("docs", "design", "native-kit-catalog.html");
	const html = await readFile(htmlPath, "utf8");

	for (const legacyClass of [
		"status-pill",
		"artifact-type-icon",
		"composer-file-type-icon-v5",
		"assistant-tool-icon-v5",
		"runtime-strip-v1",
		"agent-running-surface-v5",
		"composer-mention-option-v5",
		"composer-skill-option-v5",
		"assistant-control-button",
	]) {
		assert.doesNotMatch(html, new RegExp(legacyClass, "u"), `${legacyClass} should be folded into kit primitives`);
	}

	for (const primitiveClass of [
		"kit-control-button-v1",
		"kit-popover-item-v1 is-text-only",
		"kit-event-row-v1 kit-running-surface-v1",
		"kit-tool-icon-v1",
		"kit-file-type-icon-v1",
		"kit-soft-chip-v1",
	]) {
		assert.match(html, new RegExp(primitiveClass, "u"));
	}
});
