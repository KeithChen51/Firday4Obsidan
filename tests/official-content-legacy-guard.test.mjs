/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const modulePath = path.join(projectRoot, "src", "services", "LegacyFridayRootMigrationService.ts");
const officialContentServicePath = path.join(projectRoot, "src", "services", "OfficialContentService.ts");
const settingsPath = path.join(projectRoot, "src", "settings", "FridaySettingTab.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("legacy safety gate scans friday root ownership before destructive apply", () => {
	const source = read(modulePath);
	assert.match(source, /inspectDestructiveApplySafety/);
	assert.match(source, /ownedTopLevelPaths/);
	assert.match(source, /blockingPaths/);
	assert.match(source, /canRefreshCatalog/);
	assert.match(source, /F\.R\.I\.D\.A\.Y|fridayRoot/);
});

test("legacy safety gate blocks known historical paths while catalog refresh stays available", () => {
	const source = read(modulePath);
	assert.match(source, /runtime/);
	assert.match(source, /Agents/);
	assert.match(source, /PRIMARY_PATHS\.projects|\\u9879\\u76ee|椤圭洰/);
	assert.match(source, /PRIMARY_PATHS\.personal|\\u4e2a\\u4eba|涓汉/);
	assert.match(source, /PRIMARY_PATHS\.configFile|_\\u914d\\u7f6e\.md|_閰嶇疆\.md/);
	assert.match(source, /canRefreshCatalog:\s*true/);
});

test("official content service still distinguishes catalog refresh from destructive apply", () => {
	assert.ok(fs.existsSync(officialContentServicePath), "official content service should exist");
	const source = read(officialContentServicePath);
	assert.match(source, /refreshCatalog/);
	assert.match(source, /applySubscriptions/);
	assert.match(source, /blocked/);
	assert.match(source, /canRefreshCatalog/);
});

test("subscriptions settings surface a blocking warning and explicit archive action for legacy root content", () => {
	const source = read(settingsPath);
	assert.match(source, /blockingPaths/);
	assert.match(source, /settings\.subscriptions\.legacy\.warning/);
	assert.match(source, /settings\.subscriptions\.legacy\.archive/);
	assert.match(source, /settings\.subscriptions\.legacy\.archiveConfirm/);
	assert.match(source, /archiveVisibleLegacyRoot\(/);
	assert.match(source, /officialContentService\.applySubscriptions\(/);
});
