/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const sourcePath = path.join(projectRoot, "src/services/SoulStore.ts");

function readSource() {
	assert.ok(fs.existsSync(sourcePath), "SoulStore.ts should exist");
	return fs.readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
}

test("soul store persists soul definitions under dedicated local-state files", () => {
	const source = readSource();
	assert.match(source, /registry\.json/);
	assert.match(source, /state\.json/);
	assert.match(source, /definitions\//);
	assert.doesNotMatch(source, /F\.R\.I\.D\.A\.Y\/Agents/);
});

test("soul store exposes core definition and activation operations", () => {
	const source = readSource();
	assert.match(source, /listSouls\(\): Promise</);
	assert.match(source, /getSoul\(id: string\): Promise</);
	assert.match(source, /createSoul\(/);
	assert.match(source, /setActiveSoul\(id: string\): Promise<void>/);
});
