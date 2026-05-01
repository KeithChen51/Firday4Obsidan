/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const contextAssemblerPath = path.join(projectRoot, "src/core/context/ContextAssembler.ts");
const tokenBudgetPath = path.join(projectRoot, "src/core/context/TokenBudget.ts");

async function loadModules() {
	const [contextModule, tokenModule] = await Promise.all([
		jiti.import(contextAssemblerPath),
		jiti.import(tokenBudgetPath),
	]);
	return { contextModule, tokenModule };
}

test("context assembler reports token usage instead of raw character length", async () => {
	const { contextModule, tokenModule } = await loadModules();
	const assembler = new contextModule.ContextAssembler();
	const counter = new tokenModule.ApproximateTokenCounter();

	const result = assembler.assemble({
		userQuery: "研究".repeat(60),
		system: "system",
		policy: "policy",
		hardLimit: 180,
	});

	assert.equal(result.used, counter.count(result.text));
	assert.notEqual(result.used, result.text.length);
	assert.equal(result.used <= result.hardLimit, true);
	assert.equal(result.softLimit, 99);
	assert.equal(result.hardLimit, 125);
});

test("context assembler trims oversized tool context without dropping the user query", async () => {
	const { contextModule, tokenModule } = await loadModules();
	const assembler = new contextModule.ContextAssembler();
	const counter = new tokenModule.ApproximateTokenCounter();

	const result = assembler.assemble({
		userQuery: "Summarize the tool evidence.",
		system: "system context",
		attachments: `TOOL_RESULT ${"evidence ".repeat(500)}`,
		history: "prior turn ".repeat(160),
		hardLimit: 150,
	});

	assert.equal(result.text.includes("Summarize the tool evidence."), true);
	assert.equal(result.trimmedChannels.includes("attachments"), true);
	assert.equal(result.used, counter.count(result.text));
	assert.equal(result.used <= result.hardLimit, true);
});

test("context assembler preserves the latest user query when protected channels overflow", async () => {
	const { contextModule } = await loadModules();
	const assembler = new contextModule.ContextAssembler();
	const userQuery = "What changed in the current note?";

	const result = assembler.assemble({
		userQuery,
		system: `system ${"policy ".repeat(900)}`,
		policy: `runtime ${"rules ".repeat(900)}`,
		attachments: "tool evidence ".repeat(200),
		hardLimit: 120,
	});

	assert.equal(result.text.includes(userQuery), true);
	assert.equal(result.used <= result.hardLimit, true);
	assert.ok(result.overflowChannels.includes("system"));
	assert.ok(result.overflowChannels.includes("policy"));
});
