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

test("gitignore ignores local publish trees on the source branch", () => {
	assert.equal(checkIgnore("main.js").ignored, true, "root build output should stay ignored");
	assert.equal(checkIgnore("plugin/latest.json").ignored, true, "plugin feed should stay local-only on source branch");
	assert.equal(checkIgnore("plugin/artifacts/main.js").ignored, true, "plugin artifacts should stay local-only on source branch");
	assert.equal(checkIgnore("official/latest.json").ignored, true, "official feed should stay local-only on source branch");
	assert.equal(checkIgnore("channel/latest.json").ignored, true, "community channel feed should stay local-only on source branch");
	assert.equal(checkIgnore("release/latest.json").ignored, false, "legacy bridge feed should stay trackable");
	assert.equal(checkIgnore("release/friday-obsidian-plugin/main.js").ignored, false, "legacy bridge main.js should stay trackable");
	assert.equal(checkIgnore("release/friday-obsidian-plugin.zip").ignored, true, "legacy release zip should stay ignored as generated binary");
	assert.equal(checkIgnore("data.json.bak-20260408-145810").ignored, true, "local data backup should be ignored");
});
