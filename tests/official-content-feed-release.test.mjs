/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts", "generate-official-content-release.mjs");

function writeFile(filePath, content) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
}

async function loadGenerator() {
	assert.ok(fs.existsSync(scriptPath), "official content release generator should exist");
	return import(pathToFileURL(scriptPath).href);
}

test("official content generator discovers top-level columns and writes independent release artifacts", async () => {
	const mod = await loadGenerator();
	assert.equal(typeof mod.generateOfficialContentRelease, "function");

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-official-content-release-"));
	try {
		writeFile(path.join(tempRoot, "src", "content", "studio", "README.md"), "# README\n");
		writeFile(path.join(tempRoot, "src", "content", "studio", ".keep"), "");
		writeFile(
			path.join(tempRoot, "src", "content", "studio", "Study with F.R.I.D.A.Y", "Guide.md"),
			"# Guide\n",
		);
		writeFile(path.join(tempRoot, "src", "content", "studio", "Start Here.md"), "# Start Here\n");
		writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.0.1\n\n- Added.\n");

		const result = mod.generateOfficialContentRelease({
			projectRoot: tempRoot,
			publishedAt: "2026-04-22T00:00:00.000Z",
		});

		assert.match(result.latestJsonPath.replace(/\\/g, "/"), /release\/official-content\/latest\.json$/);
		assert.ok(
			result.channelManifestPaths.some((item) =>
				/release\/official-content\/channels\/.+\.json$/.test(item.replace(/\\/g, "/"))),
			"channel manifests should be emitted under release/official-content/channels",
		);
		assert.ok(
			result.filePaths.some((item) => /release\/official-content\/files\/.+\.md$/.test(item.replace(/\\/g, "/"))),
			"content blobs should be emitted under release/official-content/files",
		);
		assert.ok(fs.existsSync(result.latestJsonPath), "latest.json should be written");

		const latest = JSON.parse(fs.readFileSync(result.latestJsonPath, "utf8"));
		assert.ok(Array.isArray(latest.providers), "latest feed should expose providers");
		const officialProvider = latest.providers.find((item) => item.rootPath === "F.R.I.D.A.Y");
		assert.ok(officialProvider, "the official provider rooted at F.R.I.D.A.Y should exist");

		const columnPaths = officialProvider.columns.map((item) => item.path).sort();
		assert.deepEqual(columnPaths, ["Changelog.md", "Start Here.md", "Study with F.R.I.D.A.Y"]);
		assert.ok(
			officialProvider.columns.some((item) => item.kind === "directory" && item.path === "Study with F.R.I.D.A.Y"),
			"top-level directories should become directory columns",
		);
		assert.ok(
			officialProvider.columns.some((item) => item.kind === "file" && item.path === "Start Here.md"),
			"top-level markdown files should become file columns",
		);
		assert.ok(
			officialProvider.columns.some((item) => item.kind === "file" && item.path === "Changelog.md"),
			"root CHANGELOG.md should be injected as Changelog.md",
		);
		assert.ok(officialProvider.columns.every((item) => item.id && item.manifestPath));
		assert.doesNotMatch(JSON.stringify(officialProvider), /README\.md/);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});
