/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/content/studio/generated.ts");
const pathsModulePath = path.join(projectRoot, "src/constants/paths.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

async function loadPathsModule() {
	return jiti.import(pathsModulePath);
}

test("studio content generator exposes shipped markdown files for runtime sync", async () => {
	const mod = await loadModule();
	const entries = mod.STUDIO_CONTENT_SNAPSHOT;
	assert.ok(Array.isArray(entries));

	const summary = entries.map((entry) => `${entry.kind}:${entry.relativePath}`);
	for (const requiredPath of [
		"file:README.md",
		"directory:从这里开始 · Start Here",
		"file:从这里开始 · Start Here/从这里开始.md",
		"file:Changelog.md",
		"directory:Study with F.R.I.D.A.Y",
		"file:Study with F.R.I.D.A.Y/四个Obsidian内置Skills的修订笔记.md",
	]) {
		assert.ok(summary.includes(requiredPath), `missing ${requiredPath}`);
	}
	assert.ok(!summary.includes("file:迭代手记 · Changelog.md"));
	assert.ok(!summary.includes("directory:幕后笔记 · Behind the Build"));
	assert.ok(!summary.includes("directory:Study with F.R.I.D.A.Y/Study with F.R.I.D.A.Y"));

	const changelog = entries.find((entry) => entry.relativePath === "Changelog.md");
	assert.ok(changelog);
	assert.equal(changelog.kind, "file");
	assert.match(changelog.content, /^# Changelog/m);

	const note = entries.find((entry) => entry.relativePath === "Study with F.R.I.D.A.Y/四个Obsidian内置Skills的修订笔记.md");
	assert.ok(note);
	assert.match(note.content, /author: Keith Lim/);
	assert.match(note.content, /四个 Obsidian 内置 Skills 的修订笔记/);
});

test("studio path presets keep the published names and legacy aliases in sync", async () => {
	const mod = await loadPathsModule();
	assert.equal(mod.PRIMARY_PATHS.studioNotes, "Study with F.R.I.D.A.Y");
	assert.equal(mod.PRIMARY_PATHS.studioLogFile, "Changelog.md");
	assert.equal(mod.PREVIOUS_PRIMARY_PATHS.studioNotes, "幕后笔记 · Behind the Build");
	assert.equal(mod.PREVIOUS_PRIMARY_PATHS.studioLogFile, "迭代手记 · Changelog.md");
});
