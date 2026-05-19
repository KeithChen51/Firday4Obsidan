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

test("package test script verifies generated sources without publishing release artifacts", () => {
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	const script = pkg.scripts.test;
	assert.equal(pkg.scripts["normalize:shell-line-endings"], "node scripts/normalize-shell-line-endings.mjs");
	assert.equal(pkg.scripts.pretest, "npm run normalize:shell-line-endings");
	assert.equal(pkg.scripts.prebuild, "npm run normalize:shell-line-endings");

	const builtinIndex = commandIndex(script, "node scripts/generate-builtin-skill-markdown.mjs");
	const studioIndex = commandIndex(script, "node scripts/generate-studio-content.mjs");
	const typecheckIndex = commandIndex(script, "tsc -noEmit -skipLibCheck");
	const bundleIndex = commandIndex(script, "node esbuild.config.mjs production");
	const nodeTestIndex = commandIndex(script, "node --test tests/*.mjs");

	assert.equal(script.includes("generate:plugin-release"), false, "npm test must not update release feeds or publishedAt");
	assert.ok(builtinIndex < studioIndex, "test script should generate builtin skill markdown before studio content");
	assert.ok(studioIndex < typecheckIndex, "test script should verify generated studio content before typechecking");
	assert.ok(typecheckIndex < bundleIndex, "test script should typecheck before bundling");
	assert.ok(bundleIndex < nodeTestIndex, "test script should build before running node tests");
});
