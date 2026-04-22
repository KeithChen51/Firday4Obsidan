/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const settingsModulePath = path.join(projectRoot, "src", "types", "settings.ts");
const officialContentTypesPath = path.join(projectRoot, "src", "types", "officialContent.ts");
const officialContentConstantsPath = path.join(projectRoot, "src", "constants", "officialContent.ts");
const pluginTypePath = path.join(projectRoot, "src", "types", "plugin.ts");
const mainPath = path.join(projectRoot, "src", "main.ts");
const settingsPath = path.join(projectRoot, "src", "settings", "FridaySettingTab.ts");
const officialContentServicePath = path.join(projectRoot, "src", "services", "OfficialContentService.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("settings defaults include official content state and keep new columns unsubscribed by default", () => {
	const source = read(settingsModulePath);
	assert.match(source, /officialContent:\s*\{/);
	assert.match(source, /checkOnStartup:\s*boolean;/);
	assert.match(source, /startupDelayMs:\s*number;/);
	assert.match(source, /lastCheckedAt:\s*string;/);
	assert.match(source, /lastCatalogVersion:\s*string;/);
	assert.match(source, /catalog:\s*[^;]*\[\];/);
	assert.match(source, /channels:\s*Record<string,\s*\{/);
	assert.match(source, /officialContent:\s*\{[\s\S]*?checkOnStartup:\s*true,/);
	assert.match(source, /officialContent:\s*\{[\s\S]*?catalog:\s*\[\],/);
	assert.match(source, /officialContent:\s*\{[\s\S]*?channels:\s*\{\s*\},/);
});

test("official content domain types and constants exist", () => {
	assert.ok(fs.existsSync(officialContentTypesPath), "official content type definitions should exist");
	assert.ok(fs.existsSync(officialContentConstantsPath), "official content constants should exist");

	const typeSource = read(officialContentTypesPath);
	const constantSource = read(officialContentConstantsPath);

	assert.match(typeSource, /OfficialContentCatalogEntry/);
	assert.match(typeSource, /OfficialContentChannelManifest/);
	assert.match(typeSource, /OfficialContentChannelSubscription/);
	assert.match(typeSource, /OfficialContentLegacyGuardState/);
	assert.match(constantSource, /OFFICIAL_CONTENT_ROOT_PATH/);
	assert.match(constantSource, /OFFICIAL_CONTENT_PROVIDER_ID/);
});

test("plugin api and startup flow expose official content service and subscriptions section", () => {
	const settingsSource = read(settingsModulePath);
	const pluginSource = read(pluginTypePath);
	const mainSource = read(mainPath);

	assert.match(settingsSource, /officialContent:\s*\{/);
	assert.match(pluginSource, /officialContentService:/);
	assert.match(pluginSource, /export type FridaySettingsSection = [\s\S]*?"subscriptions"/);
	assert.doesNotMatch(pluginSource, /export type FridaySettingsSection = [\s\S]*?"slash"/);
	assert.match(mainSource, /officialContentService/);
	assert.match(mainSource, /officialContent\.checkOnStartup/);
	assert.match(mainSource, /startupDelayMs/);
	assert.match(mainSource, /runStartupOfficialContentCheck|officialContentService\.runStartupCheck/);
	assert.doesNotMatch(mainSource, /subscribed:\s*true/);
});

test("subscriptions settings UI replaces slash navigation and uses official content service", () => {
	const source = read(settingsPath);
	assert.match(source, /activeSection === "subscriptions"/);
	assert.match(source, /renderSubscriptionsSection\(containerEl\)/);
	assert.match(source, /settings\.section\.subscriptions/);
	assert.doesNotMatch(source, /{ id: "slash", label: this\.host\.t\("settings\.section\.slash"\) }/);
	assert.match(source, /officialContentService\.refreshCatalog\(/);
	assert.match(source, /officialContentService\.applySubscriptions\(/);
	assert.match(source, /officialContent\.checkOnStartup/);
	assert.match(source, /officialContent\.startupDelayMs/);
	assert.match(source, /Official channel|官方频道/);
});

test("official content service exposes refresh, apply, and startup flows against release artifacts", () => {
	assert.ok(fs.existsSync(officialContentServicePath), "OfficialContentService should exist");
	const source = read(officialContentServicePath);
	assert.match(source, /class OfficialContentService/);
	assert.match(source, /refreshCatalog\(\): Promise/);
	assert.match(source, /applySubscriptions\(\): Promise/);
	assert.match(source, /runStartupCheck\(\): Promise<void>/);
	assert.match(source, /release\/official-content\/latest\.json/);
	assert.match(source, /channels\/official\.json|manifestPath/);
});
