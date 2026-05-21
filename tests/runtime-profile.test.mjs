/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/platform/runtime/RuntimeProfile.ts");

async function loadProfile() {
	return jiti.import(modulePath);
}

test("runtime profile maps windows to supported profile", async () => {
	const mod = await loadProfile();
	const profile = mod.detectRuntimeProfile("win32");
	assert.equal(profile.id, "windows-desktop");
	assert.equal(profile.supported, true);
});

test("runtime profile maps darwin to supported profile", async () => {
	const mod = await loadProfile();
	const profile = mod.detectRuntimeProfile("darwin");
	assert.equal(profile.id, "mac-desktop");
	assert.equal(profile.supported, true);
});

test("runtime profile maps linux to supported profile", async () => {
	const mod = await loadProfile();
	const profile = mod.detectRuntimeProfile("linux");
	assert.equal(profile.id, "linux-desktop");
	assert.equal(profile.supported, true);
});

test("runtime profile maps unknown platform to unsupported profile", async () => {
	const mod = await loadProfile();
	const profile = mod.detectRuntimeProfile("freebsd");
	assert.equal(profile.id, "unsupported");
	assert.equal(profile.supported, false);
});
