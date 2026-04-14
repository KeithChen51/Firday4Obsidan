/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/utils/projectWorkspacePolicy.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("agent draft writes default to project workspace", async () => {
	const mod = await loadModule();
	const resolved = mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "drafts/plan.md");
	assert.equal(resolved, "F.R.I.D.A.Y/项目/alpha/workspace/drafts/plan.md");
});

test("explicit project system paths stay inside the project root", async () => {
	const mod = await loadModule();
	assert.equal(
		mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "wiki/index.md"),
		"F.R.I.D.A.Y/项目/alpha/wiki/index.md",
	);
	assert.equal(
		mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "workspace/notes.md"),
		"F.R.I.D.A.Y/项目/alpha/workspace/notes.md",
	);
});

test("raw paths are detected as user-curated and blocked for agent writes", async () => {
	const mod = await loadModule();
	const rawPath = mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "raw/facts.md");
	assert.equal(rawPath, "F.R.I.D.A.Y/项目/alpha/raw/facts.md");
	assert.equal(mod.isProjectRawPath("F.R.I.D.A.Y/项目/alpha", rawPath), true);
	assert.equal(mod.isAgentWritableProjectPath("F.R.I.D.A.Y/项目/alpha", rawPath), false);
});
