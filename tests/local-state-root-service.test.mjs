/* eslint-env node */
import assert from "node:assert/strict";
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

test("local state root service resolves a user-scoped friday root under AppData on Windows", async () => {
	const mod = await loadModule();
	const service = new mod.LocalStateRootService("C:/Vaults/Demo", "friday-obsidian-plugin");
	assert.match(service.getUserRoot(), /AppData\\Roaming\\friday$/);
});
