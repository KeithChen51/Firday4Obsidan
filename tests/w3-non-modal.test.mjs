/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const srcRoot = path.join(projectRoot, "src");

function collectTsFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(absolute));
			continue;
		}
		if (entry.isFile() && absolute.endsWith(".ts")) {
			files.push(absolute);
		}
	}
	return files;
}

test("W3 non-modal rule: src has no confirm/prompt/modal main-flow dependencies", async () => {
	const tsFiles = collectTsFiles(srcRoot);
	const violations = [];
	for (const filePath of tsFiles) {
		const content = fs.readFileSync(filePath, "utf8");
		if (/window\.confirm/.test(content) || /window\.prompt/.test(content) || /new\s+\w+Modal\(/.test(content)) {
			violations.push(path.relative(projectRoot, filePath));
		}
	}
	assert.deepEqual(violations, []);
});
