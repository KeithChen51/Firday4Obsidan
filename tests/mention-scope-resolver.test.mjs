/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/components/mentionScope.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("mention scope resolver prefers boundaryPath and ignores legacy runtime path fields", async () => {
	const mod = await loadModule();
	const prefixes = mod.resolveMentionScopePrefixes(
		{
			boundaryPath: "Projects/alpha",
			projectRootPath: "Legacy/root",
			localPath: "C:\\repo\\alpha",
		},
		[
			"Projects/alpha/raw/a.md",
			"Projects/alpha/wiki/index.md",
			"Legacy/root/raw/old.md",
		],
	);

	assert.deepEqual(prefixes, ["Projects/alpha"]);
});

test("mention scope resolver returns no scope when boundaryPath is absent", async () => {
	const mod = await loadModule();
	const prefixes = mod.resolveMentionScopePrefixes(
		{
			projectRootPath: "Projects/demo",
			localPath: "C:\\repo\\demo",
		},
		[
			"Projects/demo/raw/spec.md",
			"Projects/demo/wiki/index.md",
		],
	);

	assert.deepEqual(prefixes, []);
});
