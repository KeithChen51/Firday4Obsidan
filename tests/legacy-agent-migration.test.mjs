/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/LegacyAgentMigrationService.ts");

function readSource() {
	assert.ok(fs.existsSync(sourcePath), "LegacyAgentMigrationService.ts should exist");
	return fs.readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
}

test("legacy agent migration service imports souls sessions and approvals once", () => {
	const source = readSource();
	assert.match(source, /migrateIfNeeded\(\): Promise/);
	assert.match(source, /SoulStore/);
	assert.match(source, /RuntimeStateStore/);
	assert.match(source, /ConversationService/);
	assert.match(source, /already complete|migration complete|migrated/i);
});

test("legacy agent migration service reads legacy agent profiles before writing new soul state", () => {
	const source = readSource();
	assert.match(source, /settings\.agents/);
	assert.match(source, /activeAgentId/);
	assert.match(source, /createSoul|updateSoul/);
	assert.match(source, /activeSoulId/);
});

test("legacy agent migration service imports legacy global memory into the new user-level path", () => {
	const source = readSource();
	assert.match(source, /GLOBAL_MEMORY_PATH|LEGACY_GLOBAL_MEMORY_PATH|getGlobalMemoryPath/);
	assert.match(source, /readFile|writeFile/);
	assert.match(source, /importLegacyGlobalMemory/);
});
