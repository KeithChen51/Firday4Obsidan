/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const stateMachineModulePath = path.join(projectRoot, "src/core/turn-state/TurnStateMachine.ts");
const orchestratorModulePath = path.join(projectRoot, "src/core/orchestrator/TurnOrchestrator.ts");

async function loadModules() {
	const state = await jiti.import(stateMachineModulePath);
	const orchestrator = await jiti.import(orchestratorModulePath);
	return { state, orchestrator };
}

test("turn state machine records STEP events in order", async () => {
	const { state } = await loadModules();
	const machine = new state.TurnStateMachine("turn-test-1");
	machine.append({ stepName: "STEP_START", depth: 0, message: "start" });
	machine.append({ stepName: "STEP_DONE", depth: 0, message: "done" });
	const traces = machine.snapshot();
	assert.equal(traces.length, 2);
	assert.equal(traces[0].index, 1);
	assert.equal(traces[1].stepName, "STEP_DONE");
});

test("turn orchestrator maps runtime phases to STEP events", async () => {
	const { state, orchestrator } = await loadModules();
	const machine = new state.TurnStateMachine("turn-test-2");
	const runner = new orchestrator.TurnOrchestrator();
	runner.appendProgress(machine, {
		phase: "tool_call",
		depth: 0,
		step: 1,
		tool: "read",
		message: "calling read",
	});
	const traces = machine.snapshot();
	assert.equal(traces.length, 1);
	assert.equal(traces[0].stepName, "STEP_TOOL_CALL");
	assert.equal(traces[0].tool, "read");
});
