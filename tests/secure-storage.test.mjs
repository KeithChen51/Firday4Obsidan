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
		values,
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

test("secure storage saves, reads, and clears user git credentials", async () => {
	const mod = await loadModule();
	const storage = new mod.SecureStorage("friday-test", createMemoryStorage());

	assert.equal(await storage.getUserGitCredential(), null);
	await storage.setUserGitCredential({ username: "alice", token: "token-1" });
	assert.deepEqual(await storage.getUserGitCredential(), {
		username: "alice",
		token: "token-1",
	});

	await storage.setUserGitCredential(null);
	assert.equal(await storage.getUserGitCredential(), null);
});

test("secure storage encrypts payloads when electron safeStorage is available", async () => {
	const mod = await loadModule();
	const backing = createMemoryStorage();
	const storage = new mod.SecureStorage("friday-test", backing, {
		isEncryptionAvailable() {
			return true;
		},
		encryptString(value) {
			return Buffer.from(`enc:${value}`, "utf8");
		},
		decryptString(value) {
			return value.toString("utf8").replace(/^enc:/, "");
		},
	});

	await storage.setProjectGitCredential("alpha", { username: "alice", token: "token-1" });

	const persisted = backing.values.get("friday-test:project-git-credential:alpha");
	assert.ok(typeof persisted === "string" && persisted.includes("\"mode\":\"secure\""));
	assert.deepEqual(await storage.getProjectGitCredential("alpha"), {
		username: "alice",
		token: "token-1",
	});
	assert.equal(storage.getMode(), "secure");
});

test("secure storage exposes plaintext-local fallback mode when secure backend is unavailable", async () => {
	const mod = await loadModule();
	const storage = new mod.SecureStorage("friday-test", createMemoryStorage(), null);
	assert.equal(storage.getMode(), "plaintext_local");
});
