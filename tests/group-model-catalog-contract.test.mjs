/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsPath = path.join(projectRoot, "src/types/settings.ts");
const pluginTypePath = path.join(projectRoot, "src/types/plugin.ts");
const mainPath = path.join(projectRoot, "src/main.ts");
const settingsTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const constantsPath = path.join(projectRoot, "src/constants/groupModelCatalog.ts");
const samplePath = path.join(projectRoot, "docs/examples/group-model-catalog.sample.json");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("group model catalog settings and plugin service are wired like other startup sync services", () => {
	assert.ok(fs.existsSync(constantsPath), "group model catalog constants should exist");
	const settingsSource = read(settingsPath);
	const pluginSource = read(pluginTypePath);
	const mainSource = read(mainPath);

	assert.match(settingsSource, /groupModelCatalog:\s*\{/);
	assert.match(settingsSource, /repoUrl:\s*string;/);
	assert.match(settingsSource, /branch:\s*string;/);
	assert.match(settingsSource, /filePath:\s*string;/);
	assert.match(settingsSource, /models:\s*GroupModelCatalogModel\[\];/);
	assert.match(pluginSource, /groupModelCatalogService:/);
	assert.match(mainSource, /new GroupModelCatalogService/);
	assert.match(mainSource, /groupModelCatalog\.checkOnStartup/);
	assert.match(mainSource, /runStartupGroupModelCatalogCheck/);
});

test("settings model selector falls back to the synced group model catalog before builtin models", () => {
	const source = read(settingsTabPath);

	assert.match(source, /loadModelPresetsFromGroupModelCatalog/);
	assert.match(source, /groupModelCatalogService\.refreshCatalog/);
	assert.match(source, /settings\.llm\.groupModelCatalog\.refresh/);
	assert.match(source, /settings\.llm\.groupModelCatalog\.source/);
});

test("group model catalog status only shows last check time and available model count", () => {
	const source = read(settingsTabPath);
	const descMatch = source.match(/settings\.llm\.groupModelCatalog\.desc",\s*"([^"]+)"/);
	assert.ok(descMatch, "group model catalog status fallback copy should be present");
	assert.equal(descMatch[1], "最近检查：{checkedAt} | 可用模型：{count}");
	assert.doesNotMatch(source, /\.setDesc\(catalog\.lastError \?/);
});

test("sample group model catalog is public metadata only and documents the recommended branch", () => {
	assert.ok(fs.existsSync(samplePath), "sample model catalog should exist");
	const raw = read(samplePath);
	const sample = JSON.parse(raw);

	assert.equal(sample.schemaVersion, 1);
	assert.equal(sample.recommendedBranch, "friday-model-catalog");
	assert.equal(sample.models.some((item) => item.id === "qwen3.6-plus"), true);
	assert.equal(JSON.stringify(sample).includes("baseURL"), false);
	assert.equal(JSON.stringify(sample).includes("apiKey"), false);
	assert.equal(JSON.stringify(sample).includes("headers"), false);
});
