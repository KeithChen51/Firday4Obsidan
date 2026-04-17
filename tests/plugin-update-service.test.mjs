/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/services/PluginUpdateService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createMemoryAdapter(initial = {}, options = {}) {
	const files = new Map(Object.entries(initial));
	const directories = new Set(options.directories ?? []);
	const removed = [];
	const removedDirectories = [];
	return {
		files,
		directories,
		removed,
		removedDirectories,
		async exists(target) {
			return files.has(target) || directories.has(target);
		},
		async mkdir(target) {
			directories.add(target);
		},
		async read(target) {
			if (!files.has(target)) throw new Error(`ENOENT: ${target}`);
			return files.get(target);
		},
		async write(target, value) {
			files.set(target, value);
		},
		async remove(target) {
			if (directories.has(target)) {
				const error = new Error(`EPERM: operation not permitted, unlink '${target}'`);
				error.code = "EPERM";
				throw error;
			}
			removed.push(target);
			files.delete(target);
		},
		async rmdir(target, recursive = false) {
			removedDirectories.push({ target, recursive });
			directories.delete(target);
		},
		async rename(from, to) {
			if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
			files.set(to, files.get(from));
			files.delete(from);
		},
	};
}

function createGitClient(overrides = {}) {
	const texts = new Map(
		Object.entries({
			"FETCH_HEAD:release/latest.json": JSON.stringify({
				schemaVersion: 1,
				pluginId: "friday-obsidian-plugin",
				version: "0.2.0",
				minAppVersion: "1.0.0",
				branch: "master",
				files: {
					"main.js": "release/friday-obsidian-plugin/main.js",
					"manifest.json": "release/friday-obsidian-plugin/manifest.json",
					"styles.css": "release/friday-obsidian-plugin/styles.css",
				},
			}),
			"FETCH_HEAD:release/friday-obsidian-plugin/main.js": "console.log('new build');",
			"FETCH_HEAD:release/friday-obsidian-plugin/manifest.json": JSON.stringify({
				id: "friday-obsidian-plugin",
				version: "0.2.0",
				minAppVersion: "1.0.0",
			}),
			"FETCH_HEAD:release/friday-obsidian-plugin/styles.css": ".demo { color: red; }",
		}),
	);
	return {
		async ensureWorkspace() {},
		async lsRemote() {
			return "abc123\tHEAD\nabc123\trefs/heads/master";
		},
		async fetch() {},
		async readText(ref, targetPath) {
			const key = `${ref}:${targetPath}`;
			if (!texts.has(key)) throw new Error(`missing text: ${key}`);
			return texts.get(key);
		},
		async cleanup() {},
		...overrides,
	};
}

test("plugin update service reports unavailable when local git is missing", async () => {
	const mod = await loadModule();
	const service = new mod.PluginUpdateService({
		pluginId: "friday-obsidian-plugin",
		currentVersion: "0.1.0",
		adapter: createMemoryAdapter(),
		gitClientFactory: async () => createGitClient(),
		getGitRuntimeStatus: async () => ({ available: false, version: "", error: "git not found" }),
		getUserCredential: async () => ({ username: "alice", token: "token" }),
		getUserGitEmail: () => "alice@example.com",
		supportsMinAppVersion: () => true,
	});

	const availability = await service.getAvailability();
	assert.equal(availability.available, false);
	assert.equal(availability.reason, "git_unavailable");
});

test("plugin update service reports unavailable when git profile is incomplete", async () => {
	const mod = await loadModule();
	const service = new mod.PluginUpdateService({
		pluginId: "friday-obsidian-plugin",
		currentVersion: "0.1.0",
		adapter: createMemoryAdapter(),
		gitClientFactory: async () => createGitClient(),
		getGitRuntimeStatus: async () => ({ available: true, version: "2.47.1", error: "" }),
		getUserCredential: async () => ({ username: "alice", token: "token" }),
		getUserGitEmail: () => "",
		supportsMinAppVersion: () => true,
	});

	const availability = await service.getAvailability();
	assert.equal(availability.available, false);
	assert.equal(availability.reason, "git_profile_incomplete");
});

test("plugin update service detects an available update from the release feed", async () => {
	const mod = await loadModule();
	const service = new mod.PluginUpdateService({
		pluginId: "friday-obsidian-plugin",
		currentVersion: "0.1.0",
		adapter: createMemoryAdapter(),
		gitClientFactory: async () => createGitClient(),
		getGitRuntimeStatus: async () => ({ available: true, version: "2.47.1", error: "" }),
		getUserCredential: async () => ({ username: "alice", token: "token" }),
		getUserGitEmail: () => "alice@example.com",
		supportsMinAppVersion: () => true,
	});

	const result = await service.checkForUpdate();
	assert.equal(result.hasUpdate, true);
	assert.equal(result.latestVersion, "0.2.0");
	assert.ok(result.release);
});

test("plugin update service applies update files into the live plugin directory", async () => {
	const mod = await loadModule();
	const adapter = createMemoryAdapter({
		".obsidian/plugins/friday-obsidian-plugin/main.js": "console.log('old build');",
		".obsidian/plugins/friday-obsidian-plugin/manifest.json": JSON.stringify({
			id: "friday-obsidian-plugin",
			version: "0.1.0",
			minAppVersion: "1.0.0",
		}),
		".obsidian/plugins/friday-obsidian-plugin/styles.css": ".demo { color: blue; }",
	});
	const service = new mod.PluginUpdateService({
		pluginId: "friday-obsidian-plugin",
		currentVersion: "0.1.0",
		adapter,
		gitClientFactory: async () => createGitClient(),
		getGitRuntimeStatus: async () => ({ available: true, version: "2.47.1", error: "" }),
		getUserCredential: async () => ({ username: "alice", token: "token" }),
		getUserGitEmail: () => "alice@example.com",
		supportsMinAppVersion: () => true,
	});

	const result = await service.applyUpdate();
	assert.equal(result.success, true);
	assert.equal(adapter.files.get(".obsidian/plugins/friday-obsidian-plugin/main.js"), "console.log('new build');");
	assert.match(adapter.files.get(".obsidian/plugins/friday-obsidian-plugin/manifest.json"), /0\.2\.0/);
});

test("plugin update service removes staged update directories with rmdir on filesystem adapters", async () => {
	const mod = await loadModule();
	const adapter = createMemoryAdapter(
		{
			".obsidian/plugins/friday-obsidian-plugin/main.js": "console.log('old build');",
			".obsidian/plugins/friday-obsidian-plugin/manifest.json": JSON.stringify({
				id: "friday-obsidian-plugin",
				version: "0.1.0",
				minAppVersion: "1.0.0",
			}),
			".obsidian/plugins/friday-obsidian-plugin/styles.css": ".demo { color: blue; }",
		},
		{
			directories: [
				".obsidian/plugins/friday-obsidian-plugin/.update",
				".obsidian/plugins/friday-obsidian-plugin/.update/0.2.0",
			],
		},
	);
	const service = new mod.PluginUpdateService({
		pluginId: "friday-obsidian-plugin",
		currentVersion: "0.1.0",
		adapter,
		gitClientFactory: async () => createGitClient(),
		getGitRuntimeStatus: async () => ({ available: true, version: "2.47.1", error: "" }),
		getUserCredential: async () => ({ username: "alice", token: "token" }),
		getUserGitEmail: () => "alice@example.com",
		supportsMinAppVersion: () => true,
	});

	const result = await service.applyUpdate();
	assert.equal(result.success, true);
	assert.deepEqual(adapter.removedDirectories, [
		{ target: ".obsidian/plugins/friday-obsidian-plugin/.update/0.2.0", recursive: false },
	]);
});
