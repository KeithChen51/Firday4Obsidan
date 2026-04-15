/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/mention/MentionResolver.ts");

async function loadMentionResolverModule() {
	return jiti.import(modulePath);
}

test("mention resolver resolves active note, note, and folder tokens into structured channels", async () => {
	const mod = await loadMentionResolverModule();
	const resolver = new mod.MentionResolver();
	const files = new Map([
		["Projects/demo/raw/active.md", "# Active\ncurrent note body"],
		["Projects/demo/raw/spec.md", "# Spec\nimportant details"],
	]);
	const result = await resolver.resolve({
		document: {
			text: "Compare the current note with the spec folder.",
			tokens: [
				{ id: "active-1", type: "active_note" },
				{ id: "note-1", type: "note", path: "Projects/demo/raw/spec.md" },
				{ id: "folder-1", type: "folder", path: "Projects/demo/raw/specs" },
			],
		},
		currentFilePath: "Projects/demo/raw/active.md",
		activeProjectRoot: "Projects/demo",
		readFile: async (pathValue) => files.get(pathValue) ?? null,
		listFolderEntries: async (pathValue) => {
			assert.equal(pathValue, "Projects/demo/raw/specs");
			return [
				"Projects/demo/raw/specs/overview.md",
				"Projects/demo/raw/specs/api.md",
			];
		},
	});

	assert.equal(result.text, "Compare the current note with the spec folder.");
	assert.equal(result.errors.length, 0);
	assert.equal(result.channels.mentioned_notes.length, 2);
	assert.equal(result.channels.folder_structures.length, 1);
	assert.deepEqual(
		result.summary.tokenTypes,
		["active_note", "folder", "note"],
	);
	assert.equal(result.summary.resolvedCount, 3);
	assert.match(result.channels.folder_structures[0].summary, /overview\.md/);
	assert.match(result.channels.folder_structures[0].summary, /api\.md/);
});

test("mention resolver reports a structured error when active note token has no active file", async () => {
	const mod = await loadMentionResolverModule();
	const resolver = new mod.MentionResolver();
	const result = await resolver.resolve({
		document: {
			text: "Use the active note.",
			tokens: [{ id: "active-1", type: "active_note" }],
		},
		currentFilePath: "",
		activeProjectRoot: "Projects/demo",
		readFile: async () => null,
		listFolderEntries: async () => [],
	});

	assert.equal(result.channels.mentioned_notes.length, 0);
	assert.equal(result.errors.length, 1);
	assert.equal(result.errors[0].tokenId, "active-1");
	assert.equal(result.errors[0].code, "MENTION_RESOLUTION_FAILED");
	assert.match(result.errors[0].message, /active note/i);
});

test("legacy mention parser extracts note tokens from @[path] syntax for transition compatibility", async () => {
	const mod = await loadMentionResolverModule();
	const parsed = mod.parseLegacyMentionMarkup("Summarize @[Projects/demo/raw/spec.md] and @[Projects/demo/raw/plan.md]");

	assert.equal(parsed.text, "Summarize and");
	assert.deepEqual(
		parsed.tokens.map((token) => ({ type: token.type, path: token.path })),
		[
			{ type: "note", path: "Projects/demo/raw/spec.md" },
			{ type: "note", path: "Projects/demo/raw/plan.md" },
		],
	);
});
