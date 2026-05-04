/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("default plugin wiring routes UI commands through AgentRuntimeFacade and AgentKernel v2", () => {
	const mainSource = read("src/main.ts");
	const orchestratorSource = read("src/core/execution/ExecutionOrchestrator.ts");
	const helperSource = read("tests/helpers/fakeAgentRuntime.mjs");

	assert.match(mainSource, /const agentLoopController: AgentLoopController = this\.agentRuntimeService\.createAgentLoopController\(\);/);
	assert.match(mainSource, /this\.agentRuntimeFacade = new AgentRuntimeFacade\(\s*new AgentKernel\(agentLoopController\)/);
	assert.match(mainSource, /new ExecutionOrchestrator\(\s*this\.skillCommandService,\s*this\.agentRuntimeFacade/);
	assert.match(orchestratorSource, /this\.agentRuntimeFacade\.runTurn\(/);
	assert.doesNotMatch(orchestratorSource, /agentRuntimeService|LegacyAgentRuntimeAdapter/);
	assert.match(helperSource, /new modules\.AgentRuntimeFacade\(\s*new modules\.AgentKernel\(runtime\.createAgentLoopController\(\)\)/);
});

test("kernel v2 default harness path preserves taskId traceId and budget across replay", async () => {
	const budget = {
		token: { softLimit: 2048, hardLimit: 4096 },
		tool: { maxIterations: 2 },
	};
	const result = await runAgentRuntimeScenario({
		name: "kernel v2 default identity path",
		budget,
		modelSteps: [{ assistant: "Kernel v2 default answer." }],
	});

	assert.equal(result.assistantText, "Kernel v2 default answer.");
	assert.ok(result.task?.id, "default path must create a Kernel-owned task");
	assert.ok(result.traceId, "default path must expose the Kernel trace id");
	assert.deepEqual(result.budget, budget);

	const identityEvents = result.turnEvents.filter((event) =>
		["task_created", "task_running", "model_requested", "model_completed", "assistant_final", "turn_completed"].includes(event.type)
	);
	assert.ok(identityEvents.length >= 5, "expected Kernel replay events for the default path");
	for (const event of identityEvents) {
		assert.equal(event.taskId, result.task.id, `${event.type} must stay on the Kernel task`);
		assert.equal(event.payload.traceId, result.traceId, `${event.type} must stay on the Kernel trace`);
	}
});

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}
