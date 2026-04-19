/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/settings/projectGroupId.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("project group id normalization preserves Chinese names instead of collapsing to an empty id", async () => {
	const mod = await loadModule();
	assert.equal(mod.normalizeProjectGroupIdCandidate("中文项目组"), "中文项目组");
	assert.equal(mod.normalizeProjectGroupIdCandidate("中文 项目组"), "中文-项目组");
});

test("project group id normalization still sanitizes latin names and punctuation", async () => {
	const mod = await loadModule();
	assert.equal(mod.normalizeProjectGroupIdCandidate("  Team Alpha  "), "team-alpha");
	assert.equal(mod.normalizeProjectGroupIdCandidate("研发/Infra 组"), "研发-infra-组");
	assert.equal(mod.normalizeProjectGroupIdCandidate("___"), "");
});
