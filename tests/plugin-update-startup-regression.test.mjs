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
	return fs.readFileSync(filePath, "utf8");
}

test("main constructs plugin update service and stores it on the plugin", () => {
	const source = read(mainPath);
	assert.match(source, /pluginUpdateService!/);
	assert.match(source, /new PluginUpdateService\(/);
});

test("startup update check is gated by enabled flag, git runtime, and credential completeness", () => {
	const source = read(mainPath);
	assert.match(source, /checkOnStartup/);
	assert.match(source, /gitAvailable/);
	assert.match(source, /gitProfileComplete/);
	assert.match(source, /setTimeout/);
});
