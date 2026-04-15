/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/platform/obsidian/SecureStorage.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createMemoryStorage() {
	const values = new Map();
	return {
		getItem(key) {
			return values.has(key) ? values.get(key) : null;
		},
		setItem(key, value) {
			values.set(key, String(value));
		},
		removeItem(key) {
			values.delete(key);
		},
	};
}

test("secure storage saves, reads, and clears per-project git credentials", async () => {
	const mod = await loadModule();
	const storage = new mod.SecureStorage("friday-test", createMemoryStorage());

	assert.equal(await storage.getProjectGitCredential("alpha"), null);
	await storage.setProjectGitCredential("alpha", { username: "alice", token: "token-1" });
	assert.deepEqual(await storage.getProjectGitCredential("alpha"), {
		username: "alice",
		token: "token-1",
	});

	await storage.setProjectGitCredential("alpha", null);
	assert.equal(await storage.getProjectGitCredential("alpha"), null);
});
