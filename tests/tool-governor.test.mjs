/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/tool-governor/ToolGovernor.ts");

async function loadGovernor() {
	return jiti.import(modulePath);
}

test("tool governor classifies invalid input failures", async () => {
	const mod = await loadGovernor();
	const governor = new mod.ToolGovernor();
	assert.equal(governor.classifyFailure("missing required argument: path"), "invalid_input");
});

test("tool governor classifies dependency failures", async () => {
	const mod = await loadGovernor();
	const governor = new mod.ToolGovernor();
	assert.equal(governor.classifyFailure("No permission to read external path"), "dependency_unavailable");
});

test("tool governor detects native fallback candidates", async () => {
	const mod = await loadGovernor();
	const governor = new mod.ToolGovernor();
	assert.equal(governor.shouldFallbackToPrompt("400 unsupported tool schema"), true);
	assert.equal(governor.shouldFallbackToPrompt("normal runtime error"), false);
});
