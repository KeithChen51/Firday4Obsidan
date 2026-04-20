/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/ConversationService.ts");

function readSource() {
	return fs.readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
}

test("conversation service session metadata includes soulId and projectId", () => {
	const source = readSource();
	assert.match(source, /soulId: string/);
	assert.match(source, /projectId\?: string/);
	assert.match(source, /type: "meta"/);
});

test("conversation service no longer roots session files under agent folders", () => {
	const source = readSource();
	assert.doesNotMatch(source, /getAgentSessionsRoot\(agentId\)/);
	assert.doesNotMatch(source, /agentId: string,\s*sessionId: string,\s*messages:/);
});
