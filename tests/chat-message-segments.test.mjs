/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/chatMessageSegments.ts");
const composerPath = path.join(projectRoot, "src/core/editor/mention/MentionComposerDocument.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

async function createSnapshot(parts) {
	const composer = await jiti.import(composerPath);
	return composer.serializeMentionComposerDoc(composer.createMentionComposerDoc(parts));
}

function createMentionResolution(entries = []) {
	return {
		text: "",
		entries,
		errors: [],
		summary: {
			resolvedCount: entries.length,
			errorCount: 0,
			tokenTypes: entries.map((entry) => entry.tokenType),
			sourceMap: [],
		},
		channels: {
			mentioned_notes: entries.filter((entry) => entry.channel === "mentioned_notes"),
			folder_structures: entries.filter((entry) => entry.channel === "folder_structures"),
		},
	};
}

function buildOptions(overrides = {}) {
	return {
		mentionResolution: createMentionResolution(),
		resolution: { type: "none" },
		formatSkillDisplayName: (command) => `Skill label: ${command}`,
		formatMentionBadgeLabel: (entry) => `Entry label: ${entry.title}`,
		...overrides,
	};
}

test("normalizes adjacent text message segments", async () => {
	const mod = await loadModule();

	assert.deepEqual(
		mod.normalizeUserMessageSegments([
			{ type: "text", text: "Hello" },
			{ type: "text", text: " world" },
			{ type: "text", text: "" },
			{ type: "token", token: { kind: "context", label: "@ Spec", tokenType: "note", target: "spec.md" } },
			{ type: "text", text: "!" },
		]),
		[
			{ type: "text", text: "Hello world" },
			{ type: "token", token: { kind: "context", label: "@ Spec", tokenType: "note", target: "spec.md" } },
			{ type: "text", text: "!" },
		],
	);
});

test("turns skill tokens into skill UI tokens with caller-provided labels", async () => {
	const mod = await loadModule();
	const snapshot = await createSnapshot([
		{ type: "text", text: "Run " },
		{ type: "mention", mention: { id: "skill-1", type: "skill", path: "compile-wiki" } },
	]);

	const segments = mod.buildUserMessageSegments(buildOptions({ snapshot }));

	assert.deepEqual(segments, [
		{ type: "text", text: "Run " },
		{
			type: "token",
			token: {
				kind: "skill",
				label: "Skill label: compile-wiki",
				tokenType: "skill",
				target: "compile-wiki",
			},
		},
	]);
	assert.doesNotMatch(JSON.stringify(segments), /Skill \//);
});

test("uses mention resolution entries before token fallback labels for context tokens", async () => {
	const mod = await loadModule();
	const snapshot = await createSnapshot([
		{ type: "text", text: "Read " },
		{ type: "mention", mention: { id: "note-1", type: "note", path: "Project/spec.md" } },
	]);
	const entry = {
		tokenId: "note-1",
		tokenType: "note",
		channel: "mentioned_notes",
		target: "Project/spec.md",
		title: "Resolved spec",
		body: "# Spec",
		summary: "Spec summary",
	};

	const segments = mod.buildUserMessageSegments(buildOptions({
		snapshot,
		mentionResolution: createMentionResolution([entry]),
	}));

	assert.deepEqual(segments.at(-1), {
		type: "token",
		token: {
			kind: "context",
			label: "Entry label: Resolved spec",
			tokenType: "note",
			target: "Project/spec.md",
		},
	});
});

test("falls back to mention token labels when no resolution entry exists", async () => {
	const mod = await loadModule();
	const snapshot = await createSnapshot([
		{ type: "mention", mention: { id: "missing-1", type: "folder", path: "Project/Plans" } },
	]);

	const segments = mod.buildUserMessageSegments(buildOptions({ snapshot }));

	assert.deepEqual(segments, [
		{
			type: "token",
			token: {
				kind: "context",
				label: "@ Plans/",
				tokenType: "folder",
				target: "Project/Plans",
			},
		},
	]);
});

test("uses requested skill name when skill token path is missing without old slash copy", async () => {
	const mod = await loadModule();
	const snapshot = await createSnapshot([
		{ type: "mention", mention: { id: "skill-1", type: "skill" } },
	]);

	const segments = mod.buildUserMessageSegments(buildOptions({
		snapshot,
		resolution: { type: "skill", requestedSkillName: "review" },
		formatSkillDisplayName: (command) => `Friendly ${command}`,
	}));

	assert.equal(segments[0].token.label, "Friendly review");
	assert.equal(segments[0].token.target, "review");
	assert.doesNotMatch(segments[0].token.label, /Skill \//);
});
