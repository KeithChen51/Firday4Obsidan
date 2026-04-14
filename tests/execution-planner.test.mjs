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

const plannerModulePath = path.join(projectRoot, "src/core/execution/ExecutionPlanner.ts");

async function loadPlannerModule() {
	return jiti.import(plannerModulePath);
}

function createPlanner(mod, suggestSkillsForPrompt = async () => []) {
	return new mod.ExecutionPlanner({ suggestSkillsForPrompt });
}

test("execution planner keeps explicit skill invocations on runtime_with_skill_context", async () => {
	const mod = await loadPlannerModule();
	const planner = createPlanner(mod);
	const decision = await planner.plan({
		type: "runtime",
		invocation: {
			request: { source: "slash_skill", intentType: "skill", targetId: "compile-wiki", prompt: "rebuild docs" },
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		},
		runtimePrompt: "rebuild docs",
		requestedSkillName: "compile-wiki",
	});
	assert.equal(decision.mode, "runtime_with_skill_context");
	assert.equal(decision.requestedSkillName, "compile-wiki");
	assert.equal(decision.skillInvocationMode, "manual");
});

test("execution planner auto-selects a high-confidence skill for generic runtime prompts", async () => {
	const mod = await loadPlannerModule();
	const planner = createPlanner(mod, async () => [
		{
			skill: { command: "json-canvas", name: "JSON Canvas" },
			score: 19,
			reasons: ["命中别名: 构建白板"],
		},
		{
			skill: { command: "obsidian-markdown", name: "Obsidian Markdown" },
			score: 10,
			reasons: ["命中描述关键字: 文档"],
		},
	]);
	const decision = await planner.plan({
		type: "runtime",
		invocation: {
			request: { source: "chat_prompt", intentType: "runtime", prompt: "对胖东来这几个文件构建白板" },
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		},
		runtimePrompt: "对胖东来这几个文件构建白板",
	});
	assert.equal(decision.mode, "runtime_with_skill_context");
	assert.equal(decision.requestedSkillName, "json-canvas");
	assert.equal(decision.skillInvocationMode, "auto");
	assert.match(decision.selectionReason ?? "", /构建白板/);
});

test("execution planner preserves generic runtime mode when auto-skill confidence is low", async () => {
	const mod = await loadPlannerModule();
	const planner = createPlanner(mod, async () => [
		{
			skill: { command: "json-canvas", name: "JSON Canvas" },
			score: 7,
			reasons: ["弱命中"],
		},
	]);
	const decision = await planner.plan({
		type: "runtime",
		invocation: {
			request: { source: "chat_prompt", intentType: "runtime", prompt: "帮我处理一下这些材料" },
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		},
		runtimePrompt: "帮我处理一下这些材料",
	});
	assert.equal(decision.mode, "runtime_prompt");
	assert.equal(decision.requestedSkillName, undefined);
});

test("execution planner preserves slash command allowlists on runtime decisions", async () => {
	const mod = await loadPlannerModule();
	const planner = createPlanner(mod);
	const decision = await planner.plan({
		type: "runtime",
		invocation: {
			request: { source: "slash_command", intentType: "runtime", prompt: "draft release notes" },
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		},
		runtimePrompt: "draft release notes",
		allowedTools: ["read", "write"],
		allowedModels: ["gpt-4.1"],
	});
	assert.equal(decision.mode, "runtime_prompt");
	assert.deepEqual(decision.allowedTools, ["read", "write"]);
	assert.deepEqual(decision.allowedModels, ["gpt-4.1"]);
});

test("execution planner source no longer hardcodes specific skill names", async () => {
	const source = fs.readFileSync(plannerModulePath, "utf8");
	assert.doesNotMatch(source, /compile-wiki/);
	assert.doesNotMatch(source, /lookup-wiki/);
	assert.doesNotMatch(source, /json-canvas/);
	assert.doesNotMatch(source, /obsidian-cli/);
});
