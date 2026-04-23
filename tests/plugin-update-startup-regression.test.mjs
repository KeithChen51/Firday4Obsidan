/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const mainPath = path.join(projectRoot, "src/main.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("main constructs plugin update service and stores it on the plugin", () => {
	const source = read(mainPath);
	assert.match(source, /pluginUpdateService!/);
	assert.match(source, /new PluginUpdateService\(/);
});

test("startup update check is gated by startup toggle, git runtime, and credential completeness only", () => {
	const source = read(mainPath);
	assert.match(source, /checkOnStartup/);
	assert.match(source, /gitAvailable/);
	assert.match(source, /gitProfileComplete/);
	assert.match(source, /setTimeout/);
	assert.doesNotMatch(source, /this\.settings\.update\.enabled && this\.settings\.update\.checkOnStartup/);
	const match = source.match(/private async runStartupPluginUpdateCheck\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async runStartupOfficialContentCheck/);
	assert.ok(match, "runStartupPluginUpdateCheck block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /gitUserEmail/);
});

test("main leaves studio publication to agent bootstrap instead of running a startup changelog backfill", () => {
	const source = read(mainPath);
	assert.doesNotMatch(source, /pluginUpdateService\.syncBundledUpdateLog\(\)/);
});

test("main exposes a reload helper that prefers Obsidian's reload command and falls back to window reload", () => {
	const source = read(mainPath);
	assert.match(source, /reloadObsidianApp\(\): void \{/);
	assert.match(source, /executeCommandById\("app:reload"\)/);
	assert.match(source, /window\.location\.reload\(\)/);
});

test("main exposes a plugin-level reload helper that prefers disable-enable before app reload fallback", () => {
	const source = read(mainPath);
	assert.match(source, /async reloadFridayPlugin\(\): Promise<void> \{/);
	assert.match(source, /disablePlugin/);
	assert.match(source, /enablePlugin/);
	assert.match(source, /window\.setTimeout/);
	assert.match(source, /this\.reloadObsidianApp\(\)/);
});

test("startup plugin update check no longer suppresses notices via dismissed versions", () => {
	const source = read(mainPath);
	const match = source.match(/private async runStartupPluginUpdateCheck\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate startAutoSync/);
	assert.ok(match, "runStartupPluginUpdateCheck block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /dismissedVersion/);
});
