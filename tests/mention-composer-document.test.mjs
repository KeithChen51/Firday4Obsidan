/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/editor/mention/MentionComposerDocument.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

async function loadSource(filePath) {
	return fs.promises.readFile(filePath, "utf8");
}

test("mention composer document serializes inline mention nodes into text plus token snapshot", async () => {
	const mod = await loadModule();
	const doc = mod.createMentionComposerDoc([
		{ type: "text", text: "Summarize " },
		{ type: "mention", mention: { id: "active-1", type: "active_note" } },
		{ type: "text", text: " with " },
		{ type: "mention", mention: { id: "note-1", type: "note", path: "Projects/demo/raw/spec.md" } },
		{ type: "text", text: " today" },
	]);
	const snapshot = mod.serializeMentionComposerDoc(doc);

	assert.equal(snapshot.text, "Summarize with today");
	assert.deepEqual(snapshot.tokens, [
		{ id: "active-1", type: "active_note" },
		{ id: "note-1", type: "note", path: "Projects/demo/raw/spec.md" },
	]);
	assert.ok(snapshot.doc);
});

test("mention composer document restores token nodes from saved snapshot", async () => {
	const mod = await loadModule();
	const snapshot = {
		text: "Review this folder",
		tokens: [
			{ id: "folder-1", type: "folder", path: "Projects/demo/raw/specs" },
		],
		doc: null,
	};
	const doc = mod.restoreMentionComposerDoc(snapshot);
	const roundTrip = mod.serializeMentionComposerDoc(doc);

	assert.equal(roundTrip.text, "Review this folder");
	assert.deepEqual(roundTrip.tokens, snapshot.tokens);
});

test("mention node DOM spec includes a dedicated remove control for mouse interaction", async () => {
	const mod = await loadModule();
	const node = mod.createMentionNode({ id: "note-1", type: "note", path: "Projects/demo/raw/spec.md" });
	const domSpec = mod.mentionComposerSchema.nodes.mention.spec.toDOM?.(node);

	assert.ok(Array.isArray(domSpec));
	assert.match(JSON.stringify(domSpec), /friday-inline-mention-token-remove/);
	assert.match(JSON.stringify(domSpec), /data-mention-remove/);
});

test("mention composer view binds container click-to-focus behavior for empty editor surface", async () => {
	const source = await loadSource("C:\\Own Docm\\Coding\\Friday - Ob\\Firday4Obsidan-upload\\src\\views\\components\\MentionComposer.ts");
	assert.match(source, /this\.editorEl\.onclick\s*=\s*\(\)\s*=>\s*\{\s*this\.focus\(\);/);
});
