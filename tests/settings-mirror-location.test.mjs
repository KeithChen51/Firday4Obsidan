/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

test("settings mirror service writes under the existing hidden friday-state root without adding a config folder", () => {
	const source = read("src/services/SettingsMirrorService.ts");
	assert.match(source, /settings\.mirror\.yaml/);
	assert.match(source, /resolveVault\("settings\.mirror\.yaml"\)/);
	assert.doesNotMatch(source, /resolveVault\("config"/);
});

test("plugin saves settings through SettingsMirrorService instead of DataService visible mirrors", () => {
	const mainSource = read("src/main.ts");
	const dataServiceSource = read("src/services/DataService.ts");

	assert.match(mainSource, /settingsMirrorService/);
	assert.match(mainSource, /\.write\(this\.settings\)/);
	assert.doesNotMatch(mainSource, /dataService\.writeConfigMirror/);
	assert.doesNotMatch(dataServiceSource, /async writeConfigMirror/);
	assert.doesNotMatch(dataServiceSource, /resolveConfigMirrorPath/);
});
