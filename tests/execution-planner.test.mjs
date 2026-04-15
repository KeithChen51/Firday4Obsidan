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

function createPlanner(mod) {
	return new mod.ExecutionPlanner();
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

test("execution planner keeps generic runtime prompts on runtime_prompt and defers skill choice to the model loop", async () => {
	const mod = await loadPlannerModule();
	const planner = createPlanner(mod);
	const decision = await planner.plan({
		type: "runtime",
		invocation: {
			request: { source: "chat_prompt", intentType: "runtime", prompt: "提灯的结构是什么样的，做一个白板" },
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		},
		runtimePrompt: "提灯的结构是什么样的，做一个白板",
	});
	assert.equal(decision.mode, "runtime_prompt");
	assert.equal(decision.requestedSkillName, undefined);
	assert.equal(decision.skillInvocationMode, undefined);
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

test("execution planner source no longer auto-selects skills via local suggestion scoring", async () => {
	const source = fs.readFileSync(plannerModulePath, "utf8");
	assert.doesNotMatch(source, /suggestSkillsForPrompt/);
	assert.doesNotMatch(source, /selectAutoSkill/);
});
