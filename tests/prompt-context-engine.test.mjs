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
		focusPaths: "<projectRoot>",
		currentFilePath: "<projectRoot>/raw/spec.md",
		userPrompt: "Compile the current project wiki",
		fridayMd: "Global rules",
		agentProfile: "Agent profile excerpt",
		extraSystemContext: "Mention context block",
		autoSkillContext: "[SkillInvocation]\\n/compile-wiki",
		wikiKnowledgeContext: "Wiki facts",
		memoryContext: "User memory",
	});
	assert.match(result.prompt, /You are FRIDAY Agent Runtime\./);
	assert.match(result.prompt, /Current agent\.md excerpt:/);
	assert.match(result.prompt, /--- Compact context package ---/);
	assert.match(result.prompt, /memory: \{"action":"add\|replace\|remove","scope":"global\|project"/);
	assert.doesNotMatch(result.prompt, /"type":"subagent"/);
	assert.equal(result.summary.hasWikiContext, true);
	assert.equal(result.summary.hasMemoryContext, true);
	assert.equal(result.summary.hasAutoSkillContext, true);
	assert.ok(result.summary.used <= result.summary.hardLimit);
});

test("prompt path guidance delegates active project normalization to the tool layer", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		activeProjectRoot: "<projectRoot>",
		userPrompt: "Create a test note",
		agentProfile: "agent",
	});

	assert.match(result.prompt, /File tools accept project-relative paths and canonical vault paths\./);
	assert.match(result.prompt, /The tool layer normalizes project-relative paths under the active project when one is selected\./);
	assert.match(result.prompt, /workspace\/test\.md and <projectRoot>\/workspace\/test\.md normalize to the same canonical vault path: <projectRoot>\/workspace\/test\.md\./);
	assert.match(result.prompt, /If a TOOL_RESULT failure includes recovery\.suggestedArgs, use those suggested args on the next attempt/);
	assert.match(result.prompt, /"path":"workspace\/test\.md"/);
	assert.match(result.prompt, /"path":"<projectRoot>\/workspace\/test\.md"/);
	assert.doesNotMatch(result.prompt, /manually prefix/i);
	assert.doesNotMatch(result.prompt, /write\/delete only supports Vault-relative paths/);
	assert.doesNotMatch(result.prompt, /prefer scoping ls\/grep\/search_text\/glob to that root/);
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
				{ tokenId: "note-1", tokenType: "note", channel: "mentioned_notes", target: "<projectRoot>/raw/spec.md" },
				{ tokenId: "folder-1", tokenType: "folder", channel: "folder_structures", target: "<projectRoot>/raw/specs" },
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

test("prompt context engine does not leak raw oversized dynamic context outside the compact package", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const wikiSentinel = "RAW_WIKI_SENTINEL_SHOULD_NOT_LEAK";
	const memorySentinel = "RAW_MEMORY_SENTINEL_SHOULD_NOT_LEAK";
	const mentionSentinel = "RAW_MENTION_SENTINEL_SHOULD_NOT_LEAK";
	const longPrefix = "safe evidence ".repeat(900);
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "Use only compacted context.",
		fridayMd: "Project rules",
		agentProfile: "agent",
		wikiKnowledgeContext: `${longPrefix}${wikiSentinel}`,
		memoryContext: `${longPrefix}${memorySentinel}`,
		mentionContext: {
			resolvedCount: 1,
			tokenTypes: ["note"],
			sourceMap: [
				{ tokenId: "note-1", tokenType: "note", channel: "mentioned_notes", target: "Project/big.md" },
			],
			entries: [
				{
					tokenId: "note-1",
					tokenType: "note",
					channel: "mentioned_notes",
					title: "big.md",
					body: `${longPrefix}${mentionSentinel}`,
				},
			],
		},
		hardLimit: 240,
	});

	assert.match(result.prompt, /--- Compact context package ---/);
	assert.match(result.prompt, /Use only compacted context\./);
	assert.doesNotMatch(result.prompt, new RegExp(wikiSentinel));
	assert.doesNotMatch(result.prompt, new RegExp(memorySentinel));
	assert.doesNotMatch(result.prompt, new RegExp(mentionSentinel));
	assert.ok(result.summary.trimmedChannels.length > 0);
});
