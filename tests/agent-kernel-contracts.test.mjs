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

const kernelDir = path.join(projectRoot, "src/core/agent-kernel");
const contractsDir = path.join(kernelDir, "contracts");
const contractsIndexPath = path.join(contractsDir, "index.ts");
const agentTurnPath = path.join(contractsDir, "AgentTurn.ts");
const agentTurnEventPath = path.join(contractsDir, "AgentTurnEvent.ts");
const classifierPath = path.join(kernelDir, "AgentFailureClassifier.ts");

const requiredContractFiles = [
	"AgentTurn.ts",
	"AgentTurnEvent.ts",
	"AgentFailure.ts",
	"index.ts",
];

test("Agent Kernel core has contracts and no forbidden UI or legacy runtime imports", () => {
	for (const fileName of requiredContractFiles) {
		assert.ok(
			fs.existsSync(path.join(contractsDir, fileName)),
			`missing kernel contract file: ${fileName}`,
		);
	}

	const sources = readTypeScriptFiles(kernelDir);
	assert.ok(sources.length > 0, "expected at least one kernel source file");
	for (const sourceFile of sources) {
		const relativePath = path.relative(projectRoot, sourceFile.path);
		assert.doesNotMatch(sourceFile.source, /AgentRuntimeService/, `${relativePath} must not mention AgentRuntimeService`);
		assert.doesNotMatch(sourceFile.source, /DailyBoardView/, `${relativePath} must not mention DailyBoardView`);
		assert.doesNotMatch(sourceFile.source, /\.\.\/\.\.\/views\//, `${relativePath} must not import view modules`);
		assert.doesNotMatch(sourceFile.source, /\.\.\/views\//, `${relativePath} must not import view modules`);
		assert.doesNotMatch(sourceFile.source, /from\s+["']obsidian["']/, `${relativePath} must not import Obsidian UI APIs`);
	}
});

test("Agent Kernel contracts export stable statuses, event types, and failure categories", async () => {
	const contracts = await jiti.import(contractsIndexPath);

	assert.deepEqual(contracts.AGENT_TURN_STATUSES, [
		"completed",
		"waiting_for_approval",
		"waiting_for_user",
		"failed",
		"cancelled",
		"safe_stopped",
	]);
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("turn_started"));
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("loop_control_stop"));
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("max_tool_iterations"));
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("turn_completed"));
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("turn_failed"));
	assert.ok(contracts.AGENT_TURN_EVENT_TYPES.includes("turn_cancelled"));
	assert.deepEqual(contracts.AGENT_FAILURE_CATEGORIES, [
		"model_transport",
		"model_protocol",
		"tool_denied",
		"tool_failed",
		"approval_denied",
		"mutation_conflict",
		"mutation_failed",
		"context_overflow",
		"cancelled",
		"max_iterations",
		"unknown",
	]);
});

test("Agent Kernel turn contracts expose task trace and budget as first-class fields", () => {
	const agentTurnSource = fs.readFileSync(agentTurnPath, "utf8");
	const eventSource = fs.readFileSync(agentTurnEventPath, "utf8");

	assert.match(agentTurnSource, /export interface AgentExecutionBudget/);
	assert.match(agentTurnSource, /token\?:\s*\{[\s\S]*hardLimit\?:\s*number;/);
	assert.match(agentTurnSource, /turn\?:\s*\{[\s\S]*maxDepth\?:\s*number;/);
	assert.match(agentTurnSource, /tool\?:\s*\{[\s\S]*maxIterations\?:\s*number;/);
	assert.match(agentTurnSource, /time\?:\s*\{[\s\S]*timeoutMs\?:\s*number;/);
	assert.match(agentTurnSource, /export interface AgentTurnInput[\s\S]*\n\ttaskId\?:\s*string;/);
	assert.match(agentTurnSource, /export interface AgentTurnInput[\s\S]*\n\ttraceId\?:\s*string;/);
	assert.match(agentTurnSource, /export interface AgentTurnInput[\s\S]*\n\tbudget\?:\s*AgentExecutionBudget;/);
	assert.match(agentTurnSource, /export interface AgentTurnResult[\s\S]*\n\ttaskId\?:\s*string;/);
	assert.match(agentTurnSource, /export interface AgentTurnResult[\s\S]*\n\ttraceId\?:\s*string;/);
	assert.match(agentTurnSource, /export interface AgentTurnResult[\s\S]*\n\tbudget\?:\s*AgentExecutionBudget;/);
	assert.match(eventSource, /taskId\?:\s*string;/);
	assert.match(eventSource, /traceId\?:\s*string;/);
});

test("AgentFailureClassifier maps legacy failure signals into kernel taxonomy", async () => {
	const { AgentFailureClassifier } = await jiti.import(classifierPath);
	const classifier = new AgentFailureClassifier();

	const cancelled = classifier.classify(new DOMException("The turn was aborted.", "AbortError"));
	assert.equal(cancelled.category, "cancelled");
	assert.equal(cancelled.userMessage, "已停止本次任务。");
	assert.doesNotMatch(cancelled.userMessage, /Agent|turn|cancelled|Error/i);
	assert.equal(classifier.classify(new Error("Maximum tool-iteration limit reached.")).category, "max_iterations");
	assert.equal(classifier.classify(new Error("504 Gateway Timeout from model gateway")).category, "model_transport");
	assert.equal(classifier.classify(new Error("Tool denied by policy: exec")).category, "tool_denied");
	assert.equal(
		classifier.classify(null, { pendingMutations: [{ status: "conflicted" }] }).category,
		"mutation_conflict",
	);
	assert.equal(classifier.classify(new Error("something unexpected")).category, "unknown");
});

function readTypeScriptFiles(root) {
	const files = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...readTypeScriptFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push({
				path: fullPath,
				source: fs.readFileSync(fullPath, "utf8"),
			});
		}
	}
	return files;
}
