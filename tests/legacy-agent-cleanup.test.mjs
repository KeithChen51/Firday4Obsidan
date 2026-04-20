/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/LegacyAgentCleanupService.ts");

function readSource() {
	assert.ok(fs.existsSync(sourcePath), "LegacyAgentCleanupService.ts should exist");
	return fs.readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
}

test("legacy cleanup service removes migrated agent runtime data but not the whole Friday root", () => {
	const source = readSource();
	assert.match(source, /cleanupLegacyAgentData\(\): Promise/);
	assert.match(source, /sessions/);
	assert.match(source, /snapshots/);
	assert.match(source, /memory/);
	assert.doesNotMatch(source, /remove\(.*F\.R\.I\.D\.A\.Y/i);
});

test("legacy cleanup service backs up ambiguous knowledge files before deleting them", () => {
	const source = readSource();
	assert.match(source, /project_context\.md/);
	assert.match(source, /decision_log\.md/);
	assert.match(source, /lessons_learned\.md/);
	assert.match(source, /backup/i);
});
