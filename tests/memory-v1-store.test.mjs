/* eslint-env node */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/memory/MemoryStoreV1.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function getExpectedGlobalMemoryPath() {
	if (process.platform === "win32") {
		return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "friday", "memory", "global.md");
	}
	if (process.platform === "darwin") {
		return path.join(homedir(), "Library", "Application Support", "friday", "memory", "global.md");
	}
	return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "friday", "memory", "global.md");
}

test("memory v1 exposes canonical global and project memory paths", async () => {
	const mod = await loadModule();
	assert.equal(mod.GLOBAL_MEMORY_PATH, getExpectedGlobalMemoryPath());
	assert.equal(mod.getProjectMemoryPath("Projects/demo"), "Projects/demo/.friday/memory/project.md");
});

test("memory v1 formats each durable fact as a single markdown record", async () => {
	const mod = await loadModule();
	assert.equal(mod.formatMemoryRecord("用户偏好简洁回答"), "- [fact] 用户偏好简洁回答");
});

test("memory v1 rejects writes that exceed the configured hard limit", async () => {
	const mod = await loadModule();
	const store = new mod.MemoryStoreV1({
		globalLimit: 20,
		projectLimit: 60,
		matchResolver: async () => [],
		fileAdapter: {
			read: async () => "# Memory\n",
			write: async () => {},
			exists: async () => true,
			ensureParent: async () => {},
		},
	});
	const result = await store.write({
		action: "add",
		scope: "global",
		content: "这是一个会超过容量上限的超长 durable fact，用于锁定拒绝写入行为",
	});
	assert.equal(result.ok, false);
	assert.equal(result.code, "capacity_exceeded");
	assert.match(result.reason, /global/i);
});

test("memory v1 requires a unique match for replace and remove", async () => {
	const mod = await loadModule();
	const store = new mod.MemoryStoreV1({
		globalLimit: 200,
		projectLimit: 200,
		matchResolver: async () => ["- [fact] 第一条", "- [fact] 第二条"],
		fileAdapter: {
			read: async () => "",
			write: async () => {},
			exists: async () => true,
			ensureParent: async () => {},
		},
	});
	const result = await store.write({
		action: "replace",
		scope: "global",
		oldText: "第",
		content: "替换后的内容",
	});
	assert.equal(result.ok, false);
	assert.equal(result.code, "ambiguous_match");
});
