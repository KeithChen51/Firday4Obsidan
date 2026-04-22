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
	assert.match(source, /\\u9879\\u76ee|项目/);
	assert.match(source, /\\u4e2a\\u4eba|个人/);
	assert.match(source, /_\\u914d\\u7f6e\.md|_配置\.md/);
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
