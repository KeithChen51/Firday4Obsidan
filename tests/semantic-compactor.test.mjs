/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/SemanticCompactor.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("semantic compactor trims oversized channel content deterministically", async () => {
	const mod = await loadModule();
	const compactor = new mod.SemanticCompactor();
	const result = compactor.compact("abcdefghij".repeat(20), 32);
	assert.equal(result.length <= 32, true);
	assert.equal(result.endsWith("..."), true);
});
