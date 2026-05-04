/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const viewsRoot = path.join(projectRoot, "src/views");

test("DailyBoard does not own runtime phase to process UI mapping", () => {
	const source = readSource(dailyBoardPath);

	assert.doesNotMatch(source, /private buildRuntimeExecutionState\(/);
	assert.doesNotMatch(source, /RuntimeExecutionState/);
	assert.doesNotMatch(source, /case "model_request"/);
	assert.doesNotMatch(source, /case "tool_call"/);
	assert.match(source, /LiveTrajectoryStore/);
	assert.match(source, /AgentTrajectorySnapshot/);
	assert.match(source, /renderAgentTrajectoryCard/);
});

test("views do not reintroduce the old DailyBoard runtime execution mapper", () => {
	for (const filePath of listTypeScriptFiles(viewsRoot)) {
		const source = readSource(filePath);
		assert.doesNotMatch(source, /buildRuntimeExecutionState|RuntimeExecutionState/);
		assert.doesNotMatch(source, /case "tool_call"|case "model_request"/);
	}
});

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function listTypeScriptFiles(root) {
	const output = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			output.push(...listTypeScriptFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			output.push(entryPath);
		}
	}
	return output;
}
