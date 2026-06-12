/* eslint-env node */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const adrPath = path.join(
	projectRoot,
	"docs/plans/friday-desktop/adr/2026-06-11-desktop-shell-tech-spike.zh.md",
);
const smokePath = path.join(projectRoot, "spikes/desktop-shell/smoke.mjs");
const selfPath = fileURLToPath(import.meta.url);

function hasUtf8Bom(filePath) {
	const bytes = fs.readFileSync(filePath);
	return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function readRequiredFile(filePath) {
	assert.equal(fs.existsSync(filePath), true, `${path.relative(projectRoot, filePath)} should exist`);
	return fs.readFileSync(filePath, "utf8");
}

test("desktop shell ADR and test files are readable UTF-8 Chinese in Windows tools", () => {
	const adr = readRequiredFile(adrPath);
	const self = readRequiredFile(selfPath);

	assert.equal(hasUtf8Bom(adrPath), true, "ADR should be saved as UTF-8 with BOM for Windows readability");
	assert.equal(hasUtf8Bom(selfPath), true, "this test should be saved as UTF-8 with BOM for Windows readability");
	assert.doesNotMatch(adr, /\uFFFD/, "ADR should not contain replacement characters");
	assert.doesNotMatch(self, /\uFFFD/, "test should not contain replacement characters");
	assert.match(adr, /推荐技术栈/);
	assert.match(adr, /文件系统/);
	assert.match(self, /推荐技术栈/);
	assert.match(self, /文件系统/);
});

test("desktop shell tech spike ADR records the M2 decision fields", () => {
	const adr = readRequiredFile(adrPath);
	const requiredDecisionFields = [
		"推荐技术栈",
		"不选另一个的原因",
		"v0 风险",
		"后续迁移成本",
		"M11 UI integration",
	];
	const requiredHostCapabilities = [
		"文件系统",
		"命令执行",
		"窗口",
		"拖拽",
		"剪贴板",
		"原生菜单",
		"本地 WebView",
		"权限提示",
		"日志路径",
		"自动更新后移",
	];
	const requiredElectronEvidence = [
		"Node 22+",
		"PI SDK import",
		"最小 PI session",
		"shell command",
		"文件读写",
		"WebView 渲染",
		"本地日志",
		"Electron GUI smoke 未执行",
	];
	const requiredTauriEvaluation = [
		"Rust host",
		"Node sidecar",
		"内嵌 runtime",
		"PI SDK",
		"shell",
		"文件权限",
		"打包",
		"更新路径",
	];

	for (const token of [
		...requiredDecisionFields,
		...requiredHostCapabilities,
		...requiredElectronEvidence,
		...requiredTauriEvaluation,
	]) {
		assert.match(adr, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `ADR should include ${token}`);
	}
});

test("desktop shell smoke script executes outside the plugin build and covers host primitives", () => {
	const smoke = readRequiredFile(smokePath);
	const requiredSmokeChecks = [
		"@earendil-works/pi-agent-core",
		"registerFauxProvider",
		"fauxAssistantMessage",
		"process.versions.node",
		"execFile",
		"mkdtemp",
		"rm(",
		"writeFile",
		"readFile",
		"appendFile",
		"FRIDAY_DESKTOP_SMOKE_KEEP_TEMP",
		"unsubscribe",
		"FRIDAY desktop shell smoke passed",
	];

	const smokeEnv = { ...process.env };
	delete smokeEnv.FRIDAY_DESKTOP_SMOKE_KEEP_TEMP;
	const stdout = execFileSync(process.execPath, [smokePath], {
		cwd: projectRoot,
		encoding: "utf8",
		env: smokeEnv,
		timeout: 30_000,
		windowsHide: true,
	});
	assert.match(stdout, /FRIDAY desktop shell smoke passed/);
	const summaryStart = stdout.indexOf("{");
	assert.notEqual(summaryStart, -1, "smoke stdout should include a JSON summary");
	const summary = JSON.parse(stdout.slice(summaryStart));
	assert.equal(fs.existsSync(summary.files.root), false, "smoke should clean its temp root by default");

	for (const token of requiredSmokeChecks) {
		assert.match(smoke, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `smoke script should include ${token}`);
	}
});
