/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const manifestModulePath = path.join(projectRoot, "src/platform/tools/ToolManifestCatalog.ts");
const resolverModulePath = path.join(projectRoot, "src/core/tool-governor/CapabilityResolver.ts");

async function loadModules() {
	const manifest = await jiti.import(manifestModulePath);
	const resolver = await jiti.import(resolverModulePath);
	return { manifest, resolver };
}

test("tool manifest catalog resolves known tool", async () => {
	const { manifest } = await loadModules();
	const item = manifest.findToolManifest("read");
	assert.equal(item?.capability, "filesystem.read");
});

test("tool manifest catalog includes search_text as read-only retrieval tool", async () => {
	const { manifest } = await loadModules();
	const item = manifest.findToolManifest("search_text");
	assert.equal(item?.capability, "filesystem.search_text");
	assert.equal(item?.readOnly, true);
	assert.equal(item?.concurrencySafe, true);
	assert.equal(item?.mutatesVault, false);
	assert.equal(item?.mutatesExternal, false);
	assert.equal(item?.resultKind, "search_results");
	assert.ok(item?.outputBudget > 0);
});

test("tool manifest catalog exposes memory and no longer exposes subagent", async () => {
	const { manifest } = await loadModules();
	const memory = manifest.findToolManifest("memory");
	const subagent = manifest.findToolManifest("subagent");
	assert.equal(memory?.capability, "memory.write");
	assert.equal(memory?.readOnly, false);
	assert.equal(memory?.concurrencySafe, false);
	assert.equal(memory?.mutatesVault, true);
	assert.equal(subagent, null);
});

test("capability resolver returns mapped handler", async () => {
	const { resolver } = await loadModules();
	const map = new resolver.CapabilityResolver({
		read: async () => "ok",
	});
	const handler = map.resolve("read");
	assert.equal(typeof handler, "function");
	const result = await handler({}, "agent-1");
	assert.equal(result, "ok");
});
