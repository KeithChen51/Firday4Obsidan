/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const auditStorePath = path.join(projectRoot, "src/platform/tools/ToolRunAuditStore.ts");
const stepTracePath = path.join(projectRoot, "src/core/turn-state/TurnStateMachine.ts");
const orchestratorPath = path.join(projectRoot, "src/core/orchestrator/TurnOrchestrator.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("tool run audit records persist approval metadata for execution-plane replay", async () => {
	const source = readSource(auditStorePath);
	assert.match(source, /approved:\s*boolean/);
	assert.match(source, /approvalReason:\s*string/);
	assert.match(source, /persistedRule:\s*boolean/);
	assert.match(source, /viaRule:\s*boolean/);
});

test("step trace events retain progress metadata beyond the plain message", async () => {
	const source = readSource(stepTracePath);
	assert.match(source, /contextKey\?:/);
	assert.match(source, /targetPath\?:/);
	assert.match(source, /status\?:/);
	assert.match(source, /summary\?:/);
});

test("turn orchestrator forwards runtime progress metadata into trace events", async () => {
	const source = readSource(orchestratorPath);
	assert.match(source, /contextKey:\s*event\.contextKey/);
	assert.match(source, /targetPath:\s*event\.targetPath/);
	assert.match(source, /status:\s*event\.status/);
	assert.match(source, /summary:\s*event\.summary/);
});

test("agent runtime forwards approval metadata into persisted tool audit records", async () => {
	const source = readSource(runtimePath);
	const match = source.match(/private async persistToolRun\([\s\S]*?await this\.toolRunAuditStore\.append\(\{([\s\S]*?)\}\);/);
	assert.ok(match, "persistToolRun append block should exist");
	const block = match[1] ?? "";
	assert.match(block, /approved:\s*trace\.approved/);
	assert.match(block, /approvalReason:\s*trace\.approvalReason/);
	assert.match(block, /persistedRule:\s*trace\.persistedRule/);
	assert.match(block, /viaRule:\s*trace\.viaRule/);
});
