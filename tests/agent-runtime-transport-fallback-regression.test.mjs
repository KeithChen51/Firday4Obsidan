/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const stateMachinePath = path.join(projectRoot, "src/core/turn-state/TurnStateMachine.ts");
const orchestratorPath = path.join(projectRoot, "src/core/orchestrator/TurnOrchestrator.ts");

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("agent runtime does not fallback to prompt mode for retryable transport failures", () => {
	const source = readRuntimeSource();
	assert.match(source, /isRetryableTransportFailure\(message\)/);
	assert.match(source, /已停止自动切换兼容模式/);
	assert.doesNotMatch(source, /内网网关暂时不可用/);
	assert.match(source, /模型服务或网关暂时不可用/);
});

test("legacy agent runtime forwards model transport telemetry as model_retry progress", () => {
	const source = readRuntimeSource();
	assert.match(source, /reportModelTransportProgress/);
	assert.match(source, /onTransportEvent:\s*\(event\)\s*=>\s*this\.reportModelTransportProgress\(input,\s*depth,\s*step,\s*event\)/);
	assert.match(source, /phase:\s*"model_retry"/);
	assert.match(source, /transport:\s*\{/);

	const stateMachineSource = readSource(stateMachinePath);
	const orchestratorSource = readSource(orchestratorPath);
	assert.match(stateMachineSource, /"STEP_MODEL_RETRY"/);
	assert.match(orchestratorSource, /model_retry:\s*"STEP_MODEL_RETRY"/);
});
