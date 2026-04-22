/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/RuntimeStateStore.ts");

function readSource() {
	assert.ok(fs.existsSync(sourcePath), "RuntimeStateStore.ts should exist");
	return fs.readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
}

test("runtime state store exposes dedicated souls sessions and approvals areas", () => {
	const source = readSource();
	assert.match(source, /souls/);
	assert.match(source, /sessions/);
	assert.match(source, /approvals/);
	assert.doesNotMatch(source, /F\.R\.I\.D\.A\.Y\/Agents/);
	assert.match(source, /resolveVault/);
});

test("runtime state store owns path helpers for runtime-only state", () => {
	const source = readSource();
	assert.match(source, /getSessionsRoot\(/);
	assert.match(source, /getApprovalsRoot\(/);
	assert.match(source, /getSnapshotsRoot\(/);
});
