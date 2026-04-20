/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/main.ts");

function readSource() {
	return fs.readFileSync(sourcePath, "utf8");
}

test("plugin startup reloads once when friday root exists on disk but is missing from the vault index", async () => {
	const source = readSource();
	assert.match(source, /const triggeredRootIndexRecovery = await this\.recoverMissingFridayRootIndex\(\);/);
	assert.match(source, /if \(triggeredRootIndexRecovery\) \{\s*return;\s*\}/);
	assert.match(source, /private async recoverMissingFridayRootIndex\(\): Promise<boolean> \{/);
	assert.match(source, /adapter\.exists\(fridayRoot, false\)/);
	assert.match(source, /window\.localStorage\.setItem\(storageKey, String\(Date\.now\(\)\)\)/);
	assert.match(source, /window\.setTimeout\(\(\) => \{\s*this\.reloadObsidianApp\(\);/);
});

test("plugin root-index recovery clears stale throttles once the friday root is visible again", async () => {
	const source = readSource();
	const match = source.match(/private async recoverMissingFridayRootIndex\(\): Promise<boolean> \{([\s\S]*?)\n\t\}\n\n\tprivate getEffectiveLlmSettings/);
	assert.ok(match, "recoverMissingFridayRootIndex block should exist");
	const block = match[1] ?? "";
	assert.match(block, /const indexedRoot = this\.app\.vault\.getAbstractFileByPath\(fridayRoot\);/);
	assert.match(block, /if \(indexedRoot\) \{/);
	assert.match(block, /window\.localStorage\.removeItem\(storageKey\);/);
	assert.match(block, /ROOT_INDEX_RECOVERY_WINDOW_MS/);
});

test("plugin startup wires the legacy agent migration flow before the board becomes interactive", async () => {
	const source = readSource();
	assert.match(source, /LegacyAgentMigrationService/);
	assert.match(source, /await this\.legacyAgentMigrationService\.migrateIfNeeded\(\);/);
});
