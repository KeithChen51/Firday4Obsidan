/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/ContextAssembler.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("context assembler preserves system policy and user query before trimming secondary channels", async () => {
	const mod = await loadModule();
	const assembler = new mod.ContextAssembler();
	const result = assembler.assemble({
		userQuery: "Need retrieval help",
		system: "system context",
		policy: "policy context",
		history: "history ".repeat(80),
		attachments: "attachment ".repeat(80),
		secondaryContext: "secondary ".repeat(80),
		hardLimit: 400,
	});

	assert.equal(result.text.includes("system context"), true);
	assert.equal(result.text.includes("policy context"), true);
	assert.equal(result.text.includes("Need retrieval help"), true);
	assert.equal(result.trimmedChannels.includes("secondary_context"), true);
});

test("context assembler reports used soft and hard budget", async () => {
	const mod = await loadModule();
	const assembler = new mod.ContextAssembler();
	const result = assembler.assemble({
		userQuery: "hello",
		system: "system",
		policy: "policy",
		hardLimit: 200,
	});

	assert.equal(result.used > 0, true);
	assert.equal(result.softLimit, 110);
	assert.equal(result.hardLimit, 140);
});
