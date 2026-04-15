/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/context/PromptContextEngine.ts");

async function loadPromptContextEngineModule() {
	return jiti.import(modulePath);
}

test("prompt context engine builds runtime prompt envelope with context summary flags", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 1,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		focusPaths: "Projects/demo",
		currentFilePath: "Projects/demo/raw/spec.md",
		userPrompt: "Compile the current project wiki",
		fridayMd: "Global rules",
		agentProfile: "Agent profile excerpt",
		extraSystemContext: "Mention context block",
		autoSkillContext: "[SkillInvocation]\\n/compile-wiki",
		wikiKnowledgeContext: "Wiki facts",
		memoryContext: "User memory",
	});
	assert.match(result.prompt, /You are F\.R\.I\.D\.A\.Y Agent Runtime\./);
	assert.match(result.prompt, /Current agent\.md excerpt:/);
	assert.match(result.prompt, /--- Compact context package ---/);
	assert.equal(result.summary.hasWikiContext, true);
	assert.equal(result.summary.hasMemoryContext, true);
	assert.equal(result.summary.hasAutoSkillContext, true);
	assert.ok(result.summary.used <= result.summary.hardLimit);
});

test("prompt context engine reports trimmed channels when envelope exceeds hard limit", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const longText = "x".repeat(1200);
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "Need context",
		agentProfile: "agent",
		wikiKnowledgeContext: longText,
		memoryContext: longText,
		autoSkillContext: longText,
		hardLimit: 240,
	});
	assert.ok(result.summary.trimmedChannels.length > 0);
	assert.ok(result.summary.used <= result.summary.hardLimit);
});

test("prompt context engine includes structured mention context in prompt and summary", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "Compare these references",
		agentProfile: "agent",
		mentionContext: {
			resolvedCount: 2,
			tokenTypes: ["folder", "note"],
			sourceMap: [
				{ tokenId: "note-1", tokenType: "note", channel: "mentioned_notes", target: "Projects/demo/raw/spec.md" },
				{ tokenId: "folder-1", tokenType: "folder", channel: "folder_structures", target: "Projects/demo/raw/specs" },
			],
			entries: [
				{
					tokenId: "note-1",
					tokenType: "note",
					channel: "mentioned_notes",
					title: "spec.md",
					body: "# Spec\nimportant details",
				},
				{
					tokenId: "folder-1",
					tokenType: "folder",
					channel: "folder_structures",
					title: "specs",
					body: "overview.md\napi.md",
				},
			],
		},
	});

	assert.equal(result.summary.hasMentionContext, true);
	assert.equal(result.summary.mentionResolvedCount, 2);
	assert.deepEqual(result.summary.mentionTokenTypes, ["folder", "note"]);
	assert.match(result.prompt, /Mention context/);
	assert.match(result.prompt, /spec\.md/);
	assert.match(result.prompt, /folder_structures/);
});
