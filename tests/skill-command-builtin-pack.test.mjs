/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const builtinPackModulePath = path.join(projectRoot, "src/skills/packs/builtin/index.ts");

function loadBuiltinPack() {
	return jiti.import(builtinPackModulePath);
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
	assert.equal(mod.resolveBuiltinSkill("markdown")?.command, "obsidian-markdown");
	assert.equal(mod.resolveBuiltinSkill("bases")?.command, "obsidian-bases");
});

test("builtin skill markdown loader returns embedded markdown", async () => {
	const mod = await loadBuiltinPack();
	const markdown = mod.getBuiltinSkillMarkdown("resolve-conflict");
	assert.equal(typeof markdown, "string");
	assert.equal(markdown.includes("# Skill: resolve-conflict"), true);
});
