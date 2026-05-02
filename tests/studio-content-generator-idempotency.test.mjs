/* eslint-env node */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts/generate-studio-content.mjs");

test("studio content generator leaves generated.ts untouched when content is unchanged", () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-studio-content-"));
	const studioRoot = path.join(tempRoot, "src", "content", "studio");
	fs.mkdirSync(studioRoot, { recursive: true });
	fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.0.1\n\n- Added.\n", "utf8");
	fs.writeFileSync(path.join(studioRoot, "README.md"), "# Studio\n", "utf8");

	runGenerator(tempRoot);
	const generatedPath = path.join(studioRoot, "generated.ts");
	assert.ok(fs.existsSync(generatedPath));

	const oldTime = new Date("2026-01-01T00:00:00.000Z");
	fs.utimesSync(generatedPath, oldTime, oldTime);
	const before = fs.statSync(generatedPath).mtimeMs;

	runGenerator(tempRoot);

	assert.equal(fs.statSync(generatedPath).mtimeMs, before);
});

function runGenerator(cwd) {
	const result = spawnSync(process.execPath, [scriptPath], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
}
