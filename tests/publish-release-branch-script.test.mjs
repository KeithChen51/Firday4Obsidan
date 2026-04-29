/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts", "publish-release-branch.mjs");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("publish release branch script shells out to git CLI instead of importing simple-git", () => {
	const source = read(scriptPath);
	assert.doesNotMatch(source, /from "simple-git"/);
	assert.match(source, /spawnSync\("git"/);
	assert.match(source, /\["worktree"/);
	assert.match(source, /\["push"/);
});

test("publish release branch fetches remote branch into a remote-tracking ref", () => {
	const source = read(scriptPath);
	assert.match(source, /\$\{releaseBranch\}:refs\/remotes\/origin\/\$\{releaseBranch\}/);
	assert.match(source, /`origin\/\$\{releaseBranch\}`/);
});

test("publish release branch maps local staging roots onto release branch roots", async () => {
	const mod = await import(pathToFileURL(scriptPath).href);
	assert.deepEqual(
		mod.normalizePublishRoots(["plugin", ".workflow/publish/official=official"]),
		[
			{ source: "plugin", target: "plugin" },
			{ source: ".workflow/publish/official", target: "official" },
		],
	);
	assert.deepEqual(
		mod.normalizePublishRoots([]),
		[
			{ source: "plugin", target: "plugin" },
			{ source: ".workflow/publish/official", target: "official" },
		],
	);
	assert.throws(() => mod.normalizePublishRoots(["../outside=official"]), /Invalid publish root/i);
});
