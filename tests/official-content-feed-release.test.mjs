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

function writeBinaryFile(filePath, content) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
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
			path.join(tempRoot, "src", "content", "studio", "Study with FRIDAY", "Guide.md"),
			"# Guide\n",
		);
		writeFile(path.join(tempRoot, "src", "content", "studio", "教程.md"), "# 教程\n");
		writeFile(path.join(tempRoot, "src", "content", "studio", "周报.md"), "# 周报\n");
		writeFile(path.join(tempRoot, "src", "content", "studio", "Start Here.md"), "# Start Here\n");
		writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n\n## 0.0.1\n\n- Added.\n");

		const result = mod.generateOfficialContentRelease({
			projectRoot: tempRoot,
			publishedAt: "2026-04-22T00:00:00.000Z",
		});

		assert.match(result.latestJsonPath.replace(/\\/g, "/"), /\.workflow\/publish\/official\/latest\.json$/);
		assert.equal(fs.existsSync(path.join(tempRoot, "official")), false, "source root official/ should not be generated");
		assert.ok(
			result.channelManifestPaths.some((item) =>
				/\.workflow\/publish\/official\/channels\/.+\.json$/.test(item.replace(/\\/g, "/"))),
			"channel manifests should be emitted under the local staging tree",
		);
		assert.ok(
			result.filePaths.some((item) => /\.workflow\/publish\/official\/files\/.+\.md$/.test(item.replace(/\\/g, "/"))),
			"content blobs should be emitted under the local staging tree",
		);
		assert.ok(fs.existsSync(result.latestJsonPath), "latest.json should be written");

		const latest = JSON.parse(fs.readFileSync(result.latestJsonPath, "utf8"));
		assert.ok(Array.isArray(latest.providers), "latest feed should expose providers");
		const officialProvider = latest.providers.find((item) => item.rootPath === "F.R.I.D.A.Y");
		assert.ok(officialProvider, "the official provider rooted at F.R.I.D.A.Y should exist");
		assert.equal(officialProvider.manifestPath, "official/channels/official.json");

		const columnPaths = officialProvider.columns.map((item) => item.path).sort();
		assert.deepEqual(columnPaths, ["Changelog.md", "Start Here.md", "Study with FRIDAY", "周报.md", "教程.md"]);
		assert.ok(
			officialProvider.columns.some((item) => item.kind === "directory" && item.path === "Study with FRIDAY"),
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
		const columnIds = officialProvider.columns.map((item) => item.id);
		assert.equal(new Set(columnIds).size, columnIds.length, "column ids should stay unique even for non-ASCII names");
		assert.doesNotMatch(JSON.stringify(officialProvider), /README\.md/);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("official content generator publishes image assets referenced by guide notes", async () => {
	const mod = await loadGenerator();
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-official-content-assets-"));
	try {
		const assetBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		writeFile(path.join(tempRoot, "src", "content", "studio", "README.md"), "# README\n");
		writeFile(path.join(tempRoot, "CHANGELOG.md"), "# Changelog\n");
		writeFile(
			path.join(tempRoot, "src", "content", "studio", "Start Here · 从这里开始", "01 五分钟上手.md"),
			"# 五分钟上手\n\n![工作台总览](assets/00-quick-start/workbench-overview.png)\n",
		);
		writeBinaryFile(
			path.join(
				tempRoot,
				"src",
				"content",
				"studio",
				"Start Here · 从这里开始",
				"assets",
				"00-quick-start",
				"workbench-overview.png",
			),
			assetBytes,
		);

		const result = mod.generateOfficialContentRelease({
			projectRoot: tempRoot,
			publishedAt: "2026-04-24T00:00:00.000Z",
		});
		const channel = JSON.parse(fs.readFileSync(result.channelManifestPaths[0], "utf8"));
		const startHereColumn = channel.columns.find((item) => item.path === "Start Here · 从这里开始");
		assert.ok(startHereColumn, "start-here directory column should exist");

		const imageFile = startHereColumn.files.find((item) =>
			item.path === "Start Here · 从这里开始/assets/00-quick-start/workbench-overview.png");
		assert.ok(imageFile, "image assets under the guide directory should be included");
		assert.equal(imageFile.encoding, "base64");
		assert.equal(imageFile.mediaType, "image/png");
		assert.match(imageFile.blobPath, /^official\/files\/[a-f0-9]+\.b64$/);
		assert.equal(
			fs.readFileSync(path.join(result.outputRootPath, "files", path.basename(imageFile.blobPath)), "utf8"),
			assetBytes.toString("base64"),
		);
		assert.equal(fs.existsSync(path.join(tempRoot, "official")), false, "source root official/ should not be generated");
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});
