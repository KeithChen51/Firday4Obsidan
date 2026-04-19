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

test("release script builds latest feed and release folder from current artifacts", async () => {
	const { syncReleaseArtifacts } = await loadReleaseScript();
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-release-"));
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
		zipWriter: (sourceDir, zipPath) => {
			zipCalls.push({ sourceDir, zipPath });
			fs.writeFileSync(zipPath, "zip-placeholder", "utf8");
		},
	});

	const latestJsonPath = path.join(tempRoot, "release", "latest.json");
	const releaseManifestPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "manifest.json");
	const releaseMainPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "main.js");
	const releaseStylesPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "styles.css");
	const releaseChangelogPath = path.join(tempRoot, "release", "friday-obsidian-plugin", "CHANGELOG.md");
	const zipPath = path.join(tempRoot, "release", "friday-obsidian-plugin.zip");

	assert.ok(fs.existsSync(latestJsonPath));
	assert.ok(fs.existsSync(releaseManifestPath));
	assert.ok(fs.existsSync(releaseMainPath));
	assert.ok(fs.existsSync(releaseStylesPath));
	assert.ok(fs.existsSync(releaseChangelogPath));
	assert.ok(fs.existsSync(zipPath));
	assert.equal(zipCalls.length, 1);

	const latest = JSON.parse(fs.readFileSync(latestJsonPath, "utf8"));
	assert.deepEqual(latest, {
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

	assert.deepEqual(
		JSON.parse(fs.readFileSync(releaseManifestPath, "utf8")),
		manifest,
	);
	assert.equal(fs.readFileSync(releaseMainPath, "utf8"), "console.log('release');\n");
	assert.equal(fs.readFileSync(releaseStylesPath, "utf8"), ".demo { color: red; }\n");
	assert.equal(fs.readFileSync(releaseChangelogPath, "utf8"), changelog);
});
