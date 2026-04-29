/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

test("whole-vault runtime normalizes slash project roots to an empty vault search prefix", () => {
	const source = readRuntimeSource();

	assert.match(source, /private normalizeVaultRootSearchPath\(rawPath: string \| undefined\): string/);
	assert.match(source, /return normalized === "\/" \? "" : normalized;/);
	assert.match(source, /return this\.normalizeVaultRootSearchPath\(activeProjectRoot\);/);
	assert.match(source, /path: this\.normalizeVaultRootSearchPath\(activeProjectRoot\)/);
	assert.match(source, /const normalizedTargetPath = this\.normalizeVaultRootSearchPath\(targetPath\);/);
	assert.match(source, /if \(!basePath \|\| basePath === "\/"\) return true;/);
});
