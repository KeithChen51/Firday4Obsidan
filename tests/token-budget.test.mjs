/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/TokenBudget.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("approximate token counter treats CJK text as denser than ASCII text", async () => {
	const mod = await loadModule();
	const counter = new mod.ApproximateTokenCounter();

	assert.equal(counter.count("abcdefghijklmnop"), 4);
	assert.equal(counter.count("0123456789012345"), 4);
	assert.equal(counter.count("研究".repeat(8)), 10);
	assert.equal(counter.count("研究".repeat(20)) > counter.count("a".repeat(40)), true);
});

test("token budget reports soft and hard limits plus over-budget flags", async () => {
	const mod = await loadModule();
	const budget = new mod.TokenBudget({ maxTokens: 200 });

	assert.equal(budget.softLimit, 110);
	assert.equal(budget.hardLimit, 140);

	const under = budget.measure("abcd".repeat(40));
	assert.equal(under.used, 40);
	assert.equal(under.overSoft, false);
	assert.equal(under.overHard, false);

	const over = budget.measure("研究".repeat(260));
	assert.equal(over.overSoft, true);
	assert.equal(over.overHard, true);
});
