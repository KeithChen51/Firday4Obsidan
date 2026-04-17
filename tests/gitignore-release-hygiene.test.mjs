/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function checkIgnore(relativePath) {
	const result = spawnSync("git", ["-C", projectRoot, "check-ignore", "--no-index", relativePath], {
		encoding: "utf8",
	});
	return {
		ignored: result.status === 0,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
}

test("gitignore keeps release feed tracked while ignoring local-only artifacts", () => {
	assert.equal(checkIgnore("main.js").ignored, true, "root build output should stay ignored");
	assert.equal(checkIgnore("release/friday-obsidian-plugin/main.js").ignored, false, "release main.js must stay trackable");
	assert.equal(checkIgnore("release/latest.json").ignored, false, "release feed must stay trackable");
	assert.equal(checkIgnore("release/friday-obsidian-plugin.zip").ignored, true, "release zip should be ignored as a generated binary");
	assert.equal(checkIgnore("data.json.bak-20260408-145810").ignored, true, "local data backup should be ignored");
});
