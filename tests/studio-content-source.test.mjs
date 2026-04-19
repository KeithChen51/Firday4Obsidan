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

async function loadModule() {
	return jiti.import(modulePath);
}

test("studio content generator exposes shipped markdown files for runtime sync", async () => {
	const mod = await loadModule();
	const entries = mod.STUDIO_CONTENT_SNAPSHOT;
	assert.ok(Array.isArray(entries));

	const summary = entries.map((entry) => `${entry.kind}:${entry.relativePath}`);
	assert.deepEqual(summary, [
		"file:README.md",
		"directory:从这里开始 · Start Here",
		"file:从这里开始 · Start Here/从这里开始.md",
		"file:迭代手记.md",
		"directory:幕后笔记 · Behind the Build",
		"directory:幕后笔记 · Behind the Build/Study with F.R.I.D.A.Y",
		"file:幕后笔记 · Behind the Build/四个Obsidian内置Skills的修订笔记.md",
	]);

	const changelog = entries.find((entry) => entry.relativePath === "迭代手记.md");
	assert.ok(changelog);
	assert.equal(changelog.kind, "file");
	assert.match(changelog.content, /^# 迭代手记 · Changelog/m);

	const note = entries.find((entry) => entry.relativePath === "幕后笔记 · Behind the Build/四个Obsidian内置Skills的修订笔记.md");
	assert.ok(note);
	assert.match(note.content, /author: Keith Lim/);
	assert.match(note.content, /四个 Obsidian 内置 Skills 的修订笔记/);
});
