/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/HistoryCompactor.ts");

async function loadHistoryCompactorModule() {
	return jiti.import(modulePath);
}

test("history compactor keeps the most recent messages for runtime prompts", async () => {
	const mod = await loadHistoryCompactorModule();
	const compactor = new mod.HistoryCompactor();
	const result = compactor.compact([
		{ role: "user", content: "first message" },
		{ role: "assistant", content: "second message" },
		{ role: "user", content: "third message that should stay" },
	], {
		maxMessages: 2,
		maxCharsPerMessage: 12,
	});
	assert.deepEqual(result.messages.map((item) => item.role), ["assistant", "user"]);
	assert.ok(result.messages.every((item) => item.content.length <= 15));
	assert.equal(result.droppedMessages, 1);
});

test("history compactor can build head previews within a total character budget", async () => {
	const mod = await loadHistoryCompactorModule();
	const compactor = new mod.HistoryCompactor();
	const result = compactor.compact([
		{ role: "user", content: "alpha" },
		{ role: "assistant", content: "beta" },
		{ role: "user", content: "gamma" },
	], {
		preserveRecent: false,
		maxMessages: 3,
		maxCharsPerMessage: 10,
		maxTotalChars: 9,
	});
	assert.deepEqual(result.messages.map((item) => item.content), ["alpha", "beta"]);
	assert.equal(result.usedChars, 9);
	assert.equal(result.droppedMessages, 1);
});
