/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const aiServicePath = path.join(projectRoot, "src/services/AIService.ts");

function readAiServiceSource() {
	return fs.readFileSync(aiServicePath, "utf8");
}

test("ai service uses shared llm transport policy for headers and retries", () => {
	const source = readAiServiceSource();
	assert.match(source, /buildLlmHeaders/);
	assert.match(source, /shouldRetryLlmRequest/);
	assert.match(source, /await this\.delay\(/);
});
