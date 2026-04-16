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

test("ai service treats group mode without model as unconfigured", () => {
	const source = readAiServiceSource();
	assert.match(source, /config\.mode === "group"/);
	assert.match(source, /config\.model\?\.trim\(\)/);
});
