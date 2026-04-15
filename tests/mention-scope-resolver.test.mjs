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

test("mention scope resolver falls back to localPath basename when projectRootPath has no matching vault files", async () => {
	const mod = await loadModule();
	const prefixes = mod.resolveMentionScopePrefixes(
		{
			projectRootPath: "F.R.I.D.A.Y/项目/1",
			localPath: "C:\\Own Docm\\Coding\\Friday - Ob\\Friday-beta-evm\\00_02_哲学",
		},
		[
			"00_02_哲学/raw/a.md",
			"00_02_哲学/wiki/index.md",
		],
	);

	assert.deepEqual(prefixes, ["00_02_哲学"]);
});

test("mention scope resolver keeps projectRootPath when it already matches vault paths", async () => {
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

	assert.deepEqual(prefixes, ["Projects/demo"]);
});
