/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/execution/InvocationResolver.ts");

async function loadResolverModule() {
	return jiti.import(modulePath);
}

function createResolver(overrides = {}) {
	return new overrides.mod.InvocationResolver({
		parseSkillSlashCommand: overrides.parseSkillSlashCommand ?? ((rawPrompt) => ({ type: "none", rawPrompt })),
		expandSlashCommand: overrides.expandSlashCommand ?? (() => ({ type: "none" })),
		isCompileIntent: overrides.isCompileIntent ?? (() => false),
	});
}

test("invocation resolver returns skill catalog for /skills", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({ mod, parseSkillSlashCommand: () => ({ type: "list" }) });
	const result = resolver.resolveChatPrompt("/skills");
	assert.equal(result.type, "catalog");
});

test("invocation resolver returns invalid result for malformed skill command", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({ mod, parseSkillSlashCommand: () => ({ type: "invalid", error: "bad input" }) });
	const result = resolver.resolveChatPrompt("/skill");
	assert.deepEqual(result, { type: "invalid", error: "bad input" });
});

test("invocation resolver resolves explicit skill slash to runtime invocation with skill context", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({
		mod,
		parseSkillSlashCommand: () => ({ type: "use", skillName: "compile-wiki", taskPrompt: "rebuild docs" }),
	});
	const result = resolver.resolveChatPrompt("/skill compile-wiki rebuild docs");
	assert.equal(result.type, "runtime");
	assert.equal(result.requestedSkillName, "compile-wiki");
	assert.equal(result.runtimePrompt, "rebuild docs");
	assert.equal(result.invocation.request.source, "slash_skill");
});

test("invocation resolver resolves custom slash command to runtime invocation", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({
		mod,
		expandSlashCommand: () => ({
			type: "expanded",
			command: { name: "draft-pr" },
			prompt: "draft the release note",
			allowedTools: ["read", "write"],
			allowedModels: [],
		}),
	});
	const result = resolver.resolveChatPrompt("/draft-pr");
	assert.equal(result.type, "runtime");
	assert.equal(result.runtimePrompt, "draft the release note");
	assert.deepEqual(result.allowedTools, ["read", "write"]);
	assert.equal(result.invocation.request.source, "slash_command");
});

test("invocation resolver upgrades compile intent to compile-wiki skill context request", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({
		mod,
		isCompileIntent: () => true,
	});
	const result = resolver.resolveChatPrompt("请编译当前项目 wiki");
	assert.equal(result.type, "runtime");
	assert.equal(result.requestedSkillName, "compile-wiki");
	assert.equal(result.invocation.request.source, "auto_skill_match");
});

test("invocation resolver keeps plain prompts on generic runtime path", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({ mod });
	const result = resolver.resolveChatPrompt("summarize current project");
	assert.equal(result.type, "runtime");
	assert.equal(result.requestedSkillName, undefined);
	assert.equal(result.runtimePrompt, "summarize current project");
	assert.equal(result.invocation.request.source, "chat_prompt");
});

test("invocation resolver maps project conflict proposal to resolve-conflict skill context request", async () => {
	const mod = await loadResolverModule();
	const resolver = createResolver({ mod });
	const result = resolver.resolveProjectConflictProposal("demo", "src/main.ts");
	assert.equal(result.type, "runtime");
	assert.equal(result.requestedSkillName, "resolve-conflict");
	assert.equal(result.runtimePrompt, "src/main.ts");
	assert.equal(result.invocation.request.source, "project_action");
	assert.equal(result.invocation.request.projectSlug, "demo");
});
