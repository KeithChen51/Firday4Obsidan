/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const storePath = path.join(projectRoot, "src/services/RuntimeStateStore.ts");

function createLocalStateRootService(root) {
	return {
		async ensureBaseLayout() {
			await fs.mkdir(root, { recursive: true });
		},
		resolveVault(...segments) {
			return path.join(root, ...segments);
		},
	};
}

test("RuntimeStateStore exposes PI runtime path helpers under the runtime root", async () => {
	const { RuntimeStateStore } = await jiti.import(storePath);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-pi-state-"));
	const store = new RuntimeStateStore(createLocalStateRootService(root));

	assert.equal(store.getPiRuntimeRoot(), path.join(root, "runtime", "pi"));
	assert.equal(store.getPiSessionsRoot(), path.join(root, "runtime", "pi", "sessions"));
	assert.equal(store.getPiPackagesRoot(), path.join(root, "runtime", "pi", "packages"));
	assert.equal(store.getPiToolTracesPath(), path.join(root, "runtime", "pi", "tool-traces.jsonl"));
	assert.equal(store.getPiSessionStatePath("session/with:special\\chars"), path.join(root, "runtime", "pi", "sessions", "session_with_special_chars.jsonl"));
	assert.equal(store.getPiPackageManifestPath("local/bridge"), path.join(root, "runtime", "pi", "packages", "local_bridge", "manifest.json"));
});

test("RuntimeStateStore ensureBaseLayout creates PI runtime session and package directories", async () => {
	const { RuntimeStateStore } = await jiti.import(storePath);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-pi-layout-"));
	const store = new RuntimeStateStore(createLocalStateRootService(root));

	await store.ensureBaseLayout();

	const piRuntime = await fs.stat(store.getPiRuntimeRoot());
	const piSessions = await fs.stat(store.getPiSessionsRoot());
	const piPackages = await fs.stat(store.getPiPackagesRoot());

	assert.equal(piRuntime.isDirectory(), true);
	assert.equal(piSessions.isDirectory(), true);
	assert.equal(piPackages.isDirectory(), true);
});

test("RuntimeStateStore PI path helpers keep unsafe ids inside the PI roots", async () => {
	const { RuntimeStateStore } = await jiti.import(storePath);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-pi-safe-path-"));
	const store = new RuntimeStateStore(createLocalStateRootService(root));

	assert.equal(path.dirname(store.getPiSessionStatePath("../unsafe-session")), store.getPiSessionsRoot());
	assert.equal(path.basename(store.getPiSessionStatePath("..")), "default.jsonl");
	assert.equal(path.dirname(path.dirname(store.getPiPackageManifestPath("../unsafe-package"))), store.getPiPackagesRoot());
	assert.equal(store.getPiPackageManifestPath(".."), path.join(store.getPiPackagesRoot(), "default", "manifest.json"));
});
