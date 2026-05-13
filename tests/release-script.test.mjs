/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const scriptPath = path.join(projectRoot, "scripts/release.mjs");

async function loadReleaseScript() {
	return import(pathToFileURL(scriptPath).href);
}

test("package.json exposes npm run release", () => {
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	assert.equal(pkg.scripts.release, "node scripts/release.mjs");
});

test("release script builds plugin namespaced feed and a legacy bridge publish tree for the bridge version", async () => {
	const { syncReleaseArtifacts } = await loadReleaseScript();
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-release-bridge-"));
	const manifest = {
		id: "friday-obsidian-plugin",
		name: "F.R.I.D.A.Y",
		version: "0.2.0",
		minAppVersion: "1.0.0",
		description: "demo",
		author: "demo",
		isDesktopOnly: true,
	};
	const changelog = [
		"# Changelog",
		"",
		"## 0.2.0",
		"发布日期：2026-04-15",
		"",
		"- Added user-facing plugin update history sync.",
		"- Exported release notes into the release feed.",
		"",
		"## 0.1.0",
		"",
		"- Initial release.",
		"",
	].join("\n");

	fs.writeFileSync(path.join(tempRoot, "main.js"), "console.log('release');\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "styles.css"), ".demo { color: red; }\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "manifest.json"), JSON.stringify(manifest, null, "\t"), "utf8");
	fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), changelog, "utf8");

	const zipCalls = [];
	syncReleaseArtifacts({
		projectRoot: tempRoot,
		publishedAt: "2026-04-16T00:00:00+08:00",
		legacyBridgeVersion: "0.2.0",
		zipWriter: (sourceDir, zipPath) => {
			zipCalls.push({ sourceDir, zipPath });
			fs.writeFileSync(zipPath, "zip-placeholder", "utf8");
		},
	});

	const namespacedLatestJsonPath = path.join(tempRoot, "plugin", "latest.json");
	const namespacedManifestPath = path.join(tempRoot, "plugin", "artifacts", "manifest.json");
	const namespacedMainPath = path.join(tempRoot, "plugin", "artifacts", "main.js");
	const namespacedStylesPath = path.join(tempRoot, "plugin", "artifacts", "styles.css");
	const namespacedChangelogPath = path.join(tempRoot, "plugin", "artifacts", "CHANGELOG.md");
	const namespacedZipPath = path.join(tempRoot, "plugin", "friday-obsidian-plugin.zip");

	const legacyLatestJsonPath = path.join(tempRoot, "release", "latest.json");
	const legacyManifestPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "manifest.json");
	const legacyMainPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "main.js");
	const legacyStylesPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "styles.css");
	const legacyChangelogPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "CHANGELOG.md");

	assert.ok(fs.existsSync(namespacedLatestJsonPath));
	assert.ok(fs.existsSync(namespacedManifestPath));
	assert.ok(fs.existsSync(namespacedMainPath));
	assert.ok(fs.existsSync(namespacedStylesPath));
	assert.equal(fs.existsSync(namespacedChangelogPath), false);
	assert.ok(fs.existsSync(namespacedZipPath));

	assert.ok(fs.existsSync(legacyLatestJsonPath));
	assert.ok(fs.existsSync(legacyManifestPath));
	assert.ok(fs.existsSync(legacyMainPath));
	assert.ok(fs.existsSync(legacyStylesPath));
	assert.ok(fs.existsSync(legacyChangelogPath));
	assert.equal(zipCalls.length, 1);

	const namespacedLatest = JSON.parse(fs.readFileSync(namespacedLatestJsonPath, "utf8"));
	assert.deepEqual(namespacedLatest, {
		schemaVersion: 1,
		pluginId: "friday-obsidian-plugin",
		version: "0.2.0",
		minAppVersion: "1.0.0",
		branch: "release",
		publishedAt: "2026-04-16T00:00:00+08:00",
		releaseNotes: "- Added user-facing plugin update history sync.\n- Exported release notes into the release feed.",
		files: {
			"main.js": "plugin/artifacts/main.js",
			"manifest.json": "plugin/artifacts/manifest.json",
			"styles.css": "plugin/artifacts/styles.css",
		},
	});

	const legacyLatest = JSON.parse(fs.readFileSync(legacyLatestJsonPath, "utf8"));
	assert.deepEqual(legacyLatest, {
		schemaVersion: 1,
		pluginId: "friday-obsidian-plugin",
		version: "0.2.0",
		minAppVersion: "1.0.0",
		branch: "master",
		publishedAt: "2026-04-16T00:00:00+08:00",
		releaseNotes: "- Added user-facing plugin update history sync.\n- Exported release notes into the release feed.",
		files: {
			"main.js": "release/friday-obsidian-plugin/main.js",
			"manifest.json": "release/friday-obsidian-plugin/manifest.json",
			"styles.css": "release/friday-obsidian-plugin/styles.css",
		},
	});
});

test("release script skips the legacy bridge tree after the bridge version", async () => {
	const { syncReleaseArtifacts } = await loadReleaseScript();
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-release-post-bridge-"));
	const manifest = {
		id: "friday-obsidian-plugin",
		name: "F.R.I.D.A.Y",
		version: "0.2.1",
		minAppVersion: "1.0.0",
		description: "demo",
		author: "demo",
		isDesktopOnly: true,
	};

	fs.writeFileSync(path.join(tempRoot, "main.js"), "console.log('release');\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "styles.css"), ".demo { color: red; }\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "manifest.json"), JSON.stringify(manifest, null, "\t"), "utf8");
	fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.2.1\n\n- Next.\n", "utf8");

	syncReleaseArtifacts({
		projectRoot: tempRoot,
		publishedAt: "2026-04-17T00:00:00+08:00",
		legacyBridgeVersion: "0.2.0",
		zipWriter: (sourceDir, zipPath) => {
			fs.writeFileSync(zipPath, "zip-placeholder", "utf8");
		},
	});

	assert.ok(fs.existsSync(path.join(tempRoot, "plugin", "latest.json")));
	assert.equal(fs.existsSync(path.join(tempRoot, "release", "latest.json")), false);
	assert.equal(fs.existsSync(path.join(tempRoot, "release", "friday-obsidian-plugin", "main.js")), false);
});

test("release script preserves existing publishedAt when release feed content is unchanged", async () => {
	const { syncReleaseArtifacts } = await loadReleaseScript();
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-release-idempotent-"));
	const manifest = {
		id: "friday-obsidian-plugin",
		name: "F.R.I.D.A.Y",
		version: "0.2.0",
		minAppVersion: "1.0.0",
		description: "demo",
		author: "demo",
		isDesktopOnly: true,
	};

	fs.writeFileSync(path.join(tempRoot, "main.js"), "console.log('release');\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "styles.css"), ".demo { color: red; }\n", "utf8");
	fs.writeFileSync(path.join(tempRoot, "manifest.json"), JSON.stringify(manifest, null, "\t"), "utf8");
	fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.2.0\n\n- Stable release notes.\n", "utf8");

	const writeZip = (sourceDir, zipPath) => {
		fs.writeFileSync(zipPath, "zip-placeholder", "utf8");
	};

	syncReleaseArtifacts({
		projectRoot: tempRoot,
		publishedAt: "2026-04-18T00:00:00.000Z",
		legacyBridgeVersion: "0.2.0",
		zipWriter: writeZip,
	});
	syncReleaseArtifacts({
		projectRoot: tempRoot,
		publishedAt: "2026-04-19T00:00:00.000Z",
		legacyBridgeVersion: "0.2.0",
		zipWriter: writeZip,
	});

	const namespacedLatest = JSON.parse(fs.readFileSync(path.join(tempRoot, "plugin", "latest.json"), "utf8"));
	const legacyLatest = JSON.parse(fs.readFileSync(path.join(tempRoot, "release", "latest.json"), "utf8"));

	assert.equal(namespacedLatest.publishedAt, "2026-04-18T00:00:00.000Z");
	assert.equal(legacyLatest.publishedAt, "2026-04-18T00:00:00.000Z");

	fs.writeFileSync(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.2.0\n\n- Changed release notes.\n", "utf8");
	syncReleaseArtifacts({
		projectRoot: tempRoot,
		publishedAt: "2026-04-20T00:00:00.000Z",
		legacyBridgeVersion: "0.2.0",
		zipWriter: writeZip,
	});

	const changedNamespacedLatest = JSON.parse(fs.readFileSync(path.join(tempRoot, "plugin", "latest.json"), "utf8"));
	const changedLegacyLatest = JSON.parse(fs.readFileSync(path.join(tempRoot, "release", "latest.json"), "utf8"));

	assert.equal(changedNamespacedLatest.publishedAt, "2026-04-20T00:00:00.000Z");
	assert.equal(changedNamespacedLatest.releaseNotes, "- Changed release notes.");
	assert.equal(changedLegacyLatest.publishedAt, "2026-04-20T00:00:00.000Z");
	assert.equal(changedLegacyLatest.releaseNotes, "- Changed release notes.");
});
