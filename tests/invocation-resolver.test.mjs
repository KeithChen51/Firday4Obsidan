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
		routeRuntimeEvent: overrides.routeRuntimeEvent ?? ((event) => ({
			type: "runtime",
			invocation: {
				request: {
					source: event.source,
					intentType: "event",
					targetId: event.type,
					prompt: event.prompt,
					projectSlug: event.projectSlug,
					payload: event.payload,
				},
				resolvedType: "runtime",
				resolvedId: "agent-runtime-turn",
				requiresRuntime: true,
				requiredCapabilities: [],
			},
			runtimePrompt: event.prompt ?? "",
			requestedSkillName: "compile-wiki",
		})),
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

test("invocation resolver upgrades compile intent into a routed runtime event", async () => {
	const mod = await loadResolverModule();
	let receivedEvent = null;
	const resolver = createResolver({
		mod,
		isCompileIntent: () => true,
		routeRuntimeEvent: (event) => {
			receivedEvent = event;
			return {
				type: "runtime",
				invocation: {
					request: {
						source: event.source,
						intentType: "event",
						targetId: event.type,
						prompt: event.prompt,
					},
					resolvedType: "runtime",
					resolvedId: "agent-runtime-turn",
					requiresRuntime: true,
					requiredCapabilities: [],
				},
				runtimePrompt: event.prompt ?? "",
				requestedSkillName: "compile-wiki",
			};
		},
	});
	const prompt = "Compile the current project wiki";
	const result = resolver.resolveChatPrompt(prompt);
	assert.equal(result.type, "runtime");
	assert.equal(result.requestedSkillName, "compile-wiki");
	assert.equal(result.invocation.request.source, "auto_skill_match");
	assert.deepEqual(receivedEvent, {
		type: "knowledge.compile_requested",
		source: "auto_skill_match",
		prompt,
	});
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
