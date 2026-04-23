/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const packageJsonPath = path.join(projectRoot, "package.json");

function commandIndex(script, command) {
	const index = script.indexOf(command);
	assert.notEqual(index, -1, `Expected package test script to include: ${command}`);
	return index;
}

test("package test script builds main.js before generating plugin release feed in clean CI", () => {
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	const script = pkg.scripts.test;
	const typecheckIndex = commandIndex(script, "tsc -noEmit -skipLibCheck");
	const bundleIndex = commandIndex(script, "node esbuild.config.mjs production");
	const releaseIndex = commandIndex(script, "npm run generate:plugin-release");

	assert.ok(typecheckIndex < bundleIndex, "test script should typecheck before bundling");
	assert.ok(bundleIndex < releaseIndex, "test script should create main.js before release feed generation");
});
