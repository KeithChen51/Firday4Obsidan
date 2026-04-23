/* eslint-env node */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/services/LocalStateRootService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createSampleVaultPath() {
	return process.platform === "win32" ? "C:/Vaults/Demo" : "/Vaults/Demo";
}

function getExpectedUserRoot() {
	if (process.platform === "win32") {
		return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "friday");
	}
	if (process.platform === "darwin") {
		return path.join(homedir(), "Library", "Application Support", "friday");
	}
	return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "friday");
}

test("local state root service resolves a user-scoped friday root for the current platform", async () => {
	const mod = await loadModule();
	const service = new mod.LocalStateRootService(createSampleVaultPath(), "friday-obsidian-plugin");
	assert.equal(service.getUserRoot(), getExpectedUserRoot());
});

test("local state root service resolves vault-scoped runtime state under the vault .obsidian folder", async () => {
	const mod = await loadModule();
	const vaultPath = createSampleVaultPath();
	const service = new mod.LocalStateRootService(vaultPath, "friday-obsidian-plugin");
	assert.equal(
		service.getVaultRoot(),
		path.join(vaultPath, ".obsidian", "friday-state", "friday-obsidian-plugin"),
	);
	assert.equal(
		service.getLegacyVaultRoot(),
		path.join(path.dirname(vaultPath), ".friday-local-state", path.basename(vaultPath), "friday-obsidian-plugin"),
	);
});
