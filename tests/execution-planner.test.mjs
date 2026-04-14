/* eslint-env node */
import assert from "node:assert/strict";
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

test("execution planner converts skill-backed runtime resolution into runtime_with_skill_context decision", async () => {
	const mod = await loadPlannerModule();
	const planner = new mod.ExecutionPlanner();
	const decision = planner.plan({
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
	assert.equal(decision.runtimePrompt, "rebuild docs");
});

test("execution planner preserves slash command allowlists on runtime decisions", async () => {
	const mod = await loadPlannerModule();
	const planner = new mod.ExecutionPlanner();
	const decision = planner.plan({
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
