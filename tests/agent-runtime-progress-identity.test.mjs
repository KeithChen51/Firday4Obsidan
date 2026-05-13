/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8").replace(/\r\n?/g, "\n");
}

test("runtime progress events carry active turn identity so task retries start a clean live process", () => {
	const source = readRuntimeSource();
	const match = source.match(/private reportProgress\(input: RuntimeTurnInput, event: RuntimeProgressEvent\): void \{([\s\S]*?)\n\t\}/);
	assert.ok(match, "reportProgress should exist");
	const block = match[1] ?? "";

	assert.match(block, /turnId:\s*this\.activeTurnId/);
	assert.match(block, /conversationId:\s*this\.activeConversationId/);
	assert.match(block, /traceId:\s*this\.activeTraceId/);
	assert.match(block, /taskId:\s*this\.activeTaskId/);
	assert.match(block, /input\.onProgress\?\.\(eventWithIdentity\)/);
	assert.match(block, /appendProgress\(this\.activeTurnStateMachine,\s*eventWithIdentity\)/);
});
