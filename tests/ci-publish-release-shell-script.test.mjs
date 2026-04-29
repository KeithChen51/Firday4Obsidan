/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts", "ci-publish-release.sh");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("ci publish helper hides tokenized remote setup behind a shell script", () => {
	assert.ok(fs.existsSync(scriptPath), "ci publish helper script should exist");
	const source = read(scriptPath);
	assert.match(source, /PUBLISH_TOKEN/);
	assert.match(source, /set \+x/);
	assert.match(source, /Missing PUBLISH_TOKEN/);
	assert.match(source, /resolve-publish-remote\.mjs/);
	assert.match(source, /git remote set-url origin/);
	assert.match(source, /git config user\.name/);
	assert.match(source, /git config user\.email/);
	assert.doesNotMatch(source, /Friday-test\.git/);
	assert.match(source, /node scripts\/generate-official-content-release\.mjs/);
	assert.match(source, /node scripts\/publish-release-branch\.mjs --branch release plugin \.workflow\/publish\/official=official/);
	assert.doesNotMatch(source, /publish-release-branch\.mjs --branch release plugin official/);
});
