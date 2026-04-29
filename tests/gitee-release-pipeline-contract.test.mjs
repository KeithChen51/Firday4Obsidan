/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const pipelinePath = path.join(projectRoot, ".workflow", "app-release-publish.yml");
const ciPublishScriptPath = path.join(projectRoot, "scripts", "ci-publish-release.sh");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("gitee release pipeline builds from supported source branches and publishes only release trees", () => {
	assert.ok(fs.existsSync(pipelinePath), "app release pipeline should exist");
	const source = read(pipelinePath);
	assert.match(source, /version:\s*['"]1\.0['"]/);
	assert.match(source, /trigger:/);
	assert.match(source, /push:/);
	assert.match(source, /branches:/);
	assert.match(source, /main/);
	assert.match(source, /master/);
	assert.match(source, /build@nodejs/);
	assert.match(source, /npm install --no-audit --no-fund/);
	assert.match(source, /npm run test/);
	assert.match(source, /npm run build/);
	assert.match(source, /plugin\/latest\.json/);
	assert.match(source, /ci-publish-release\.sh/);
	assert.match(source, /release/);

	const ciPublishSource = read(ciPublishScriptPath);
	assert.match(ciPublishSource, /generate-official-content-release\.mjs/);
	assert.match(ciPublishSource, /publish-release-branch\.mjs --branch release plugin \.workflow\/publish\/official=official/);
	assert.doesNotMatch(ciPublishSource, /publish-release-branch\.mjs --branch release plugin official/);
});
