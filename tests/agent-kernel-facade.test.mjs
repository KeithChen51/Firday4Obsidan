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

const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const orchestratorPath = path.join(projectRoot, "src/core/execution/ExecutionOrchestrator.ts");

test("AgentRuntimeFacade routes turns through AgentKernel before the legacy runtime adapter", async () => {
	const { AgentKernel, AgentRuntimeFacade } = await jiti.import(kernelPath);
	const calls = [];
	const legacyAdapter = {
		async runTurn(input) {
			calls.push(input);
			return {
				assistantText: "kernel routed",
				traces: [],
				rawFinalReply: "kernel routed",
			};
		},
	};

	const facade = new AgentRuntimeFacade(new AgentKernel(legacyAdapter));
	const result = await facade.runTurn({
		agentId: "agent",
		conversation: [],
		userPrompt: "route this turn",
	});

	assert.equal(result.assistantText, "kernel routed");
	assert.deepEqual(calls.map((call) => call.userPrompt), ["route this turn"]);
});

test("ExecutionOrchestrator depends on the runtime facade instead of the legacy runtime service", () => {
	const source = fs.readFileSync(orchestratorPath, "utf8");
	assert.match(source, /AgentRuntimeFacade/);
	assert.doesNotMatch(source, /AgentRuntimeService/);
	assert.doesNotMatch(source, /agentRuntimeService\.runTurn/);
});
