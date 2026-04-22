/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");

function readViewSource() {
	return fs.readFileSync(viewPath, "utf8").replace(/\r\n?/g, "\n");
}

test("chat model selector groups models by source and renders only short model names inside each group", () => {
	const source = readViewSource();
	assert.match(source, /private buildGroupedModelOptions\(/);
	assert.match(source, /OpenAI协议/);
	assert.match(source, /集团集采/);
	assert.match(source, /createEl\("optgroup", \{ attr: \{ label: group\.label \} \}\)/);
	assert.match(source, /extractModelOptionShortLabel/);
});
