/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/workbench/ProjectEditorService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("project editor service builds default project root path from slug", async () => {
	const mod = await loadModule();
	const root = mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "alpha");
	assert.equal(root, "F.R.I.D.A.Y/项目/alpha");
});

test("project editor service rejects invalid slug", async () => {
	const mod = await loadModule();
	assert.throws(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				slug: "Bad Slug",
				projectRootPath: "F.R.I.D.A.Y/项目/bad",
				localPath: "",
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service no longer requires git credential fields in project draft", async () => {
	const mod = await loadModule();
	assert.doesNotThrow(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				slug: "alpha",
				projectRootPath: "F.R.I.D.A.Y/项目/alpha",
				localPath: "",
				gitRemote: "https://example.com/repo.git",
				autoSync: false,
			},
			new Set(),
		);
	});
});
