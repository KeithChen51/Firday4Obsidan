/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/platform/git/GitRuntimeProbe.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("git runtime probe reports available with parsed version", async () => {
	const mod = await loadModule();
	const status = await mod.probeGitRuntime(async () => "git version 2.47.1");
	assert.deepEqual(status, {
		available: true,
		version: "2.47.1",
		error: "",
	});
});

test("git runtime probe reports unavailable when version command fails", async () => {
	const mod = await loadModule();
	const status = await mod.probeGitRuntime(async () => {
		throw new Error("git not found");
	});
	assert.equal(status.available, false);
	assert.equal(status.version, "");
	assert.match(status.error, /git not found/i);
});
