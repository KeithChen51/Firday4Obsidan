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
const activeFilePolicyPath = path.join(projectRoot, "src/core/context/ActiveFileContext.ts");
const skillServicePath = path.join(projectRoot, "src/services/SkillCommandService.ts");

async function loadPromptContextEngineModule() {
	return jiti.import(modulePath);
}

async function loadActiveFilePolicyModule() {
	return jiti.import(activeFilePolicyPath);
}

async function loadSkillServiceModule() {
	return jiti.import(skillServicePath);
}

function createSkillService(mod) {
	return new mod.SkillCommandService(
		{ canReadExternalPath: () => false },
		() => ({ agentRuntime: { externalSkillPaths: [], disabledSkills: [] } }),
		() => projectRoot,
		() => "zh-CN",
	);
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

test("prompt context engine instructs canonical interaction routes and plan_write without read-only mutations", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		activeProjectRoot: "<projectRoot>",
		userPrompt: "Read-only review only: no modifications. Analyze the parser.",
		agentProfile: "agent",
	});

	assert.match(result.prompt, /"interactionRoute":"direct_answer\|clarify\|light_task\|task_with_process"/);
	assert.match(result.prompt, /direct_answer: no visible process, no visible plan, direct answer only/i);
	assert.match(result.prompt, /clarify: ask one necessary question/i);
	assert.match(result.prompt, /light_task: may show lightweight running status/i);
	assert.match(result.prompt, /task_with_process: use plan_write/i);
	assert.doesNotMatch(result.prompt, /Simple tasks must return only the response schema/i);
	assert.match(result.prompt, /plan_write/);
	assert.match(result.prompt, /"type":"plan_create"/);
	assert.match(result.prompt, /"blocked"/);
	assert.match(result.prompt, /Read-only requests cannot invent mutation tasks/i);
	assert.match(result.prompt, /no modifications|no changes|read-only|只读|不要修改/);
});

test("prompt context engine teaches batched read-only tools without single-tool step limits", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		activeProjectRoot: "<projectRoot>",
		userPrompt: "Investigate these related files before answering.",
		agentProfile: "agent",
	});

	assert.doesNotMatch(result.prompt, /Call at most one tool each step/);
	assert.match(result.prompt, /multiple read-only.*tool calls/i);
	assert.match(result.prompt, /read_many/);
	assert.match(result.prompt, /search_and_read/);
	assert.match(result.prompt, /project_tree/);
	assert.match(result.prompt, /plan_write/);
	assert.match(result.prompt, /complex.*plan_write/i);
	assert.match(result.prompt, /recovery\.suggestedArgs/);
	assert.match(result.prompt, /"type":"tool_call"[\s\S]*"intake"/);
	assert.match(result.prompt, /"name":"plan_write"/);
	assert.match(result.prompt, /"name":"read_many"/);
	assert.match(result.prompt, /"name":"search_and_read"/);
	assert.match(result.prompt, /"name":"project_tree"/);
});

test("prompt context engine demonstrates model-owned task bar steps for workspace canvas tasks", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		activeProjectRoot: "<projectRoot>",
		userPrompt: "读取工作区全部文件，整理成白板展示各文件间的关系",
		agentProfile: "agent",
	});

	assert.match(result.prompt, /读取工作区全部文件/);
	assert.match(result.prompt, /"name":"plan_write"/);
	assert.match(result.prompt, /"title":"Map workspace files"/);
	assert.match(result.prompt, /"title":"Read relevant files"/);
	assert.match(result.prompt, /"title":"Extract file relationships"/);
	assert.match(result.prompt, /"title":"Create the canvas"/);
	assert.match(result.prompt, /"title":"Verify the canvas output"/);
});

test("prompt context engine omits active file lines by default even when an editor file exists elsewhere", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "创建一个新的版本，作为通用版本的简化",
		agentProfile: "agent",
	});

	assert.doesNotMatch(result.prompt, /Current active file/i);
	assert.doesNotMatch(result.prompt, /current_file/i);
	assert.equal(result.summary.activeFileContext?.mode ?? "none", "none");
});

test("prompt context engine includes deictic active file path and reason without injecting file body", async () => {
	const mod = await loadPromptContextEngineModule();
	const engine = new mod.PromptContextEngine();
	const activeBody = "ACTIVE_FILE_BODY_SHOULD_REQUIRE_READ";
	const result = engine.build({
		mode: "auto",
		depth: 0,
		permissionMode: "auto",
		runtimeProfileId: "win_desktop",
		userPrompt: "请总结当前文档",
		agentProfile: "agent",
		activeFileContext: {
			mode: "deictic_reference",
			path: "Projects/demo/raw/active.md",
			includeContent: false,
			reason: "用户明确指代当前文档",
		},
		mentionContext: {
			resolvedCount: 0,
			tokenTypes: [],
			sourceMap: [],
			entries: [],
		},
	});

	assert.match(result.prompt, /Current active file: Projects\/demo\/raw\/active\.md/);
	assert.match(result.prompt, /Active file context reason: 用户明确指代当前文档/);
	assert.match(result.prompt, /Active file content: not included; call read/);
	assert.doesNotMatch(result.prompt, new RegExp(activeBody));
	assert.equal(result.summary.activeFileContext?.mode, "deictic_reference");
	assert.equal(result.summary.activeFileContext?.reason, "用户明确指代当前文档");
});

test("active file policy only binds current file for explicit references", async () => {
	const mod = await loadActiveFilePolicyModule();

	assert.deepEqual(
		mod.resolveActiveFileContextPolicy({
			userPrompt: "创建一个新的版本，作为通用版本的简化",
			activeFilePath: "Projects/demo/raw/active.md",
			hasExplicitActiveNoteMention: false,
		}),
		{ mode: "none", includeContent: false, reason: "未显式绑定当前文件" },
	);

	assert.deepEqual(
		mod.resolveActiveFileContextPolicy({
			userPrompt: "请总结当前文档",
			activeFilePath: "Projects/demo/raw/active.md",
			hasExplicitActiveNoteMention: false,
		}),
		{
			mode: "deictic_reference",
			path: "Projects/demo/raw/active.md",
			includeContent: false,
			reason: "用户明确指代当前文档",
		},
	);
});

test("skill catalog context omits current_file unless active file context is explicit", async () => {
	const mod = await loadSkillServiceModule();
	const service = createSkillService(mod);

	const defaultCatalog = await service.buildSkillCatalogContext();
	assert.doesNotMatch(defaultCatalog, /current_file:/);

	const deicticCatalog = await service.buildSkillCatalogContext({
		activeFileContext: {
			mode: "deictic_reference",
			path: "Projects/demo/raw/active.md",
			includeContent: false,
			reason: "用户明确指代当前文档",
		},
	});
	assert.match(deicticCatalog, /current_file: Projects\/demo\/raw\/active\.md/);
	assert.match(deicticCatalog, /current_file_reason: 用户明确指代当前文档/);
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
