/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "version-bump.mjs");

test("version bump appends the target version even when minAppVersion is reused", () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-version-bump-"));
	fs.writeFileSync(
		path.join(tempRoot, "manifest.json"),
		JSON.stringify(
			{
				id: "friday-obsidian-plugin",
				version: "0.2.5",
				minAppVersion: "1.0.0",
			},
			null,
			"\t",
		),
		"utf8",
	);
	fs.writeFileSync(
		path.join(tempRoot, "versions.json"),
		JSON.stringify(
			{
				"0.2.5": "1.0.0",
			},
			null,
			"\t",
		),
		"utf8",
	);

	const result = spawnSync(process.execPath, [scriptPath], {
		cwd: tempRoot,
		env: {
			...process.env,
			npm_package_version: "0.2.6",
		},
	});
	assert.equal(result.status, 0);

	const manifest = JSON.parse(fs.readFileSync(path.join(tempRoot, "manifest.json"), "utf8"));
	const versions = JSON.parse(fs.readFileSync(path.join(tempRoot, "versions.json"), "utf8"));
	assert.equal(manifest.version, "0.2.6");
	assert.equal(versions["0.2.5"], "1.0.0");
	assert.equal(versions["0.2.6"], "1.0.0");
});
