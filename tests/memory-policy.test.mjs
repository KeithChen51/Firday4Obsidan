/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/memory/MemoryPolicy.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("memory policy allows durable sourced knowledge", async () => {
	const mod = await loadModule();
	const decision = mod.decideMemoryWrite({
		confidence: 0.92,
		ephemeral: false,
		sourceRef: "turn-1",
	});

	assert.equal(decision.allow, true);
});

test("memory policy rejects ephemeral or unsourced content", async () => {
	const mod = await loadModule();
	const decision = mod.decideMemoryWrite({
		confidence: 0.92,
		ephemeral: true,
		sourceRef: "",
	});

	assert.equal(decision.allow, false);
});
