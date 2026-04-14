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
	return fs.readFileSync(runtimePath, "utf8");
}

test("agent runtime uses execution gate for runTurn and builtin skill execution", () => {
	const source = readRuntimeSource();
	assert.match(source, /private readonly executionGate:/);
	assert.match(source, /async runTurn[\s\S]*?this\.executionGate\.evaluate\(/);
	assert.match(source, /async runBuiltinSkillCommand[\s\S]*?this\.executionGate\.evaluate\(/);
});
