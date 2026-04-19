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
const builtinPackModulePath = path.join(projectRoot, "src/skills/packs/builtin/index.ts");
const builtinPackRoot = path.join(projectRoot, "src/skills/packs/builtin");
const builtinReviewNotesModulePath = path.join(projectRoot, "src/skills/packs/builtin/reviewNotes.ts");

function loadBuiltinPack() {
	return jiti.import(builtinPackModulePath);
}

function loadBuiltinReviewNotes() {
	return jiti.import(builtinReviewNotesModulePath);
}

test("builtin skill pack exports eight builtin skills", async () => {
	const mod = await loadBuiltinPack();
	assert.equal(Array.isArray(mod.BUILTIN_SKILL_DEFINITIONS), true);
	assert.equal(mod.BUILTIN_SKILL_DEFINITIONS.length, 8);
});

test("builtin skill pack contains required commands", async () => {
	const mod = await loadBuiltinPack();
	const commands = mod.BUILTIN_SKILL_DEFINITIONS.map((item) => item.command).sort();
	assert.deepEqual(
		commands,
		[
			"compile-wiki",
			"lookup-wiki",
			"maintain-memory",
			"resolve-conflict",
			"obsidian-cli",
			"obsidian-markdown",
			"json-canvas",
			"obsidian-bases",
		].sort(),
	);
});

test("builtin skill paths use builtin virtual path format", async () => {
	const mod = await loadBuiltinPack();
	for (const entry of mod.BUILTIN_SKILL_DEFINITIONS) {
		assert.equal(entry.filePath, `builtin://${entry.command}/SKILL.md`);
	}
});

test("builtin skill resolver supports aliases", async () => {
	const mod = await loadBuiltinPack();
	const resolved = mod.resolveBuiltinSkill("lookup");
	assert.equal(resolved?.command, "lookup-wiki");
});

test("new builtin skills resolve common aliases", async () => {
	const mod = await loadBuiltinPack();
	assert.equal(mod.resolveBuiltinSkill("canvas")?.command, "json-canvas");
	assert.equal(mod.resolveBuiltinSkill("bases")?.command, "obsidian-bases");
	assert.equal(mod.resolveBuiltinSkill("obsidian-note")?.command, "obsidian-markdown");
});

test("builtin skill markdown loader returns embedded markdown", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("resolve-conflict");
	assert.equal(typeof markdown, "string");
	assert.equal(markdown.includes("# Skill: resolve-conflict"), true);
});

test("builtin skill pack loads markdown from per-skill SKILL.md source files", async () => {
	const mod = await loadBuiltinPack();
	for (const entry of mod.BUILTIN_SKILL_DEFINITIONS) {
		const skillSourcePath = path.join(builtinPackRoot, entry.command, "SKILL.md");
		assert.equal(fs.existsSync(skillSourcePath), true, `${entry.command} is missing SKILL.md source`);
		const sourceMarkdown = fs.readFileSync(skillSourcePath, "utf8");
		assert.equal(mod.getBuiltinSkillMarkdown(entry.command), sourceMarkdown);
	}
});

test("obsidian cli builtin skill documents Windows CLI preflight and avoids stale silent flag guidance", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("obsidian-cli");
	assert.equal(markdown.includes("where obsidian"), true);
	assert.equal(markdown.includes("Obsidian.com"), true);
	assert.equal(markdown.includes("obsidian version"), true);
	assert.equal(markdown.includes("silent"), false);
});

test("obsidian markdown builtin skill prefers preserving existing note style", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("obsidian-markdown");
	assert.equal(markdown.includes("Prefer the existing internal link style"), true);
	assert.equal(markdown.includes("Markdown-style internal links"), true);
	assert.equal(markdown.includes("Do not mass-convert internal Markdown links to wikilinks unless the user explicitly asks"), true);
	assert.equal(markdown.includes("Use normal Markdown links only for external URLs."), false);
	assert.equal(mod.resolveBuiltinSkill("markdown"), null);
	assert.equal(mod.resolveBuiltinSkill("frontmatter"), null);
	assert.equal(mod.resolveBuiltinSkill("wikilink")?.command, "obsidian-markdown");
});

test("json canvas builtin skill follows the JSON Canvas spec instead of inventing fixed id formats", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("json-canvas");
	assert.equal(markdown.includes("unique strings"), true);
	assert.equal(markdown.includes("Preserve existing IDs when editing an existing canvas"), true);
	assert.equal(markdown.includes("z-index"), true);
	assert.equal(markdown.includes("16-character lowercase hex"), false);
});

test("obsidian bases builtin skill covers embedded bases and safe editing workflow", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("obsidian-bases");
	assert.equal(markdown.includes("embedded `base` code blocks"), true);
	assert.equal(markdown.includes("Parse the YAML first"), true);
	assert.equal(markdown.includes("Preserve unrelated sections"), true);
	assert.equal(markdown.includes("formula.X"), true);
});

test("builtin review notes describe the changed obsidian skills with original problem and fix sections", async () => {
	const mod = await loadBuiltinReviewNotes();
	const notes = mod.BUILTIN_SKILL_REVIEW_NOTES;
	assert.equal(Array.isArray(notes), true);
	const commands = notes.map((item) => item.command).sort();
	assert.deepEqual(commands, [
		"json-canvas",
		"obsidian-bases",
		"obsidian-cli",
		"obsidian-markdown",
	].sort());
	for (const note of notes) {
		assert.equal(typeof note.original, "string");
		assert.equal(note.original.length > 0, true);
		assert.equal(Array.isArray(note.issues), true);
		assert.equal(note.issues.length > 0, true);
		assert.equal(Array.isArray(note.changes), true);
		assert.equal(note.changes.length > 0, true);
		assert.equal(note.version, "0.2.5");
	}
});
