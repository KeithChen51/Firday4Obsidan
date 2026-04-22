/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/AgentService.ts");
const conversationPath = path.join(projectRoot, "src/services/ConversationService.ts");
const actionPath = path.join(projectRoot, "src/services/AgentActionService.ts");

function readSource() {
	return fs.readFileSync(sourcePath, "utf8");
}

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("agent service bootstrap no longer publishes official content under F.R.I.D.A.Y root", async () => {
	const source = readSource();
	assert.doesNotMatch(source, /PRIMARY_PATHS/);
	assert.doesNotMatch(source, /STUDIO_CONTENT_SNAPSHOT/);
	assert.doesNotMatch(source, /getStudioRoot\(/);
	assert.doesNotMatch(source, /reconcileStudioSnapshot\(/);
	assert.doesNotMatch(source, /removeObsoleteStudioPaths\(/);
	assert.doesNotMatch(source, /writeStudioSnapshotEntries\(/);
	assert.match(source, /writeManagedTextFile\(/);
	assert.doesNotMatch(source, /LEGACY_STUDIO_ROOT/);
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

test("agent service is no longer the canonical runtime root once soul migration lands", async () => {
	const source = readSource();
	assert.doesNotMatch(source, /getAgentsRoot\(/);
	assert.doesNotMatch(source, /getAgentSessionsRoot\(/);
	assert.doesNotMatch(source, /getAgentToolApprovalPath\(/);
});

test("agent service only rehydrates legacy agent scaffolding when an Agents root already exists", async () => {
	const source = readSource().replace(/\r\n?/g, "\n");
	assert.match(source, /hasLegacyAgentsRoot\(\): boolean/);
	assert.match(source, /if \(this\.hasLegacyAgentsRoot\(\)\) \{/);
	assert.doesNotMatch(source, /async bootstrap\(\): Promise<boolean> \{\n\t\tawait this\.removeLegacyStudioRoots\(\);\n\t\tawait this\.ensureBaseFolders\(\);/);
});

test("runtime hot paths no longer depend on agent service for live session or snapshot storage", async () => {
	const conversationSource = read(conversationPath);
	const actionSource = read(actionPath);
	assert.doesNotMatch(conversationSource, /import \{ AgentService \} from "\.\/AgentService"/);
	assert.doesNotMatch(conversationSource, /getLegacyAgentSessionsRoot/);
	assert.doesNotMatch(actionSource, /import \{ AgentService \} from "\.\/AgentService"/);
	assert.doesNotMatch(actionSource, /getAgentSnapshotsRoot/);
});

test("agent service tolerates startup file-create races when managed files already exist on disk", async () => {
	const source = readSource();
	const start = source.indexOf("private async writeManagedTextFile(filePath: string, content: string): Promise<void> {");
	assert.ok(start >= 0, "writeManagedTextFile block should exist");
	const block = source.slice(start, start + 1600);
	assert.match(block, /try\s*\{[\s\S]*await this\.vault\.create\(normalized, content\);/);
	assert.match(block, /this\.isAlreadyExistsError\(error\)/);
	assert.match(block, /getLoadedFileByPathRelaxed\(normalized\)/);
	assert.match(block, /adapter\.write\(normalized, content\)/);
});
