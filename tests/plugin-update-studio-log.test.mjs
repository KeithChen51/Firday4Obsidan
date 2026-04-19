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

function createMemoryAdapter(initial = {}) {
	const files = new Map(Object.entries(initial));
	const directories = new Set();
	return {
		files,
		directories,
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
			files.delete(target);
			directories.delete(target);
		},
		async rename(from, to) {
			files.set(to, files.get(from));
			files.delete(from);
		},
	};
}

function createGitClient() {
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
			"FETCH_HEAD:CHANGELOG.md": "# Changelog\n\n## 0.2.0\n\n- New release.\n",
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
			return texts.get(`${ref}:${targetPath}`);
		},
		async cleanup() {},
	};
}

test("plugin update service leaves studio publication to bootstrap instead of writing studio files directly", async () => {
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
	assert.doesNotMatch(result.updatedFiles.join("\n"), /F\.R\.I\.D\.A\.Y\/来自制作组/);
	assert.equal(adapter.files.get("F.R.I.D.A.Y/来自制作组/迭代手记.md"), undefined);
});
