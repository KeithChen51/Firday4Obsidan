/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/AgentService.ts");

function readSource() {
	return fs.readFileSync(sourcePath, "utf8");
}

test("agent service bootstrap provisions the studio structure under F.R.I.D.A.Y root", async () => {
	const source = readSource();
	assert.match(source, /PRIMARY_PATHS/);
	assert.match(source, /STUDIO_CONTENT_SNAPSHOT/);
	assert.match(source, /getStudioRoot\(/);
	assert.match(source, /reconcileStudioSnapshot\(/);
	assert.match(source, /removeObsoleteStudioPaths\(/);
	assert.match(source, /writeStudioSnapshotEntries\(/);
	assert.match(source, /writeManagedTextFile\(/);
	assert.match(source, /LEGACY_STUDIO_ROOT/);
	assert.doesNotMatch(source, /getStudioNotesRoot\(/);
	assert.doesNotMatch(source, /getStudioStudyNotesRoot\(/);
	assert.doesNotMatch(source, /getStudioReadmePath\(/);
	assert.doesNotMatch(source, /getStudioStartHerePath\(/);
	assert.doesNotMatch(source, /getStudioLogPath\(/);
});

test("agent service no longer provisions legacy agent memory files", async () => {
	const source = readSource();
	assert.doesNotMatch(source, /getAgentMemoryRoot\(agent\.id\)\/facts\.md/);
	assert.doesNotMatch(source, /getAgentMemoryRoot\(agent\.id\)\/preferences\.md/);
});
