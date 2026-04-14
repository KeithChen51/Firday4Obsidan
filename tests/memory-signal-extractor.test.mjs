/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/memory/MemorySignalExtractor.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("memory signal extractor detects durable preference instructions", async () => {
	const mod = await loadModule();
	const signals = mod.extractMemorySignals("以后不要使用 emoji，回复尽量简短");
	assert.equal(signals.length, 1);
	assert.equal(signals[0].scope, "global");
});

test("memory signal extractor ignores ephemeral prompts", async () => {
	const mod = await loadModule();
	const signals = mod.extractMemorySignals("Summarize this file");
	assert.equal(signals.length, 0);
});
