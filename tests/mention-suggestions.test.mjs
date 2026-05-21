/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/mentionSuggestions.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("classifies mention file icon kind from Obsidian file metadata", async () => {
	const mod = await loadModule();

	assert.equal(mod.getMentionFileTypeIcon({ extension: "md" }), "markdown");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "canvas" }), "canvas");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "ts" }), "code");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "TXT" }), "note");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "png" }), "note");
});

test("filters files that can be used as mention context", async () => {
	const mod = await loadModule();
	const files = [
		{ path: "Project/a.md", basename: "a", extension: "md" },
		{ path: "Project/code.ts", basename: "code", extension: "ts" },
		{ path: "Project/whiteboard.canvas", basename: "whiteboard", extension: "canvas" },
		{ path: "Project/image.png", basename: "image", extension: "png" },
	];

	assert.deepEqual(
		files.filter((file) => mod.isMentionableFile(file)).map((file) => file.path),
		["Project/a.md", "Project/code.ts", "Project/whiteboard.canvas"],
	);
});
