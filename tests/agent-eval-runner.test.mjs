/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const evalPath = path.join(projectRoot, "tests/evals/agent-scenarios.json");
const requiredScenarioIds = [
	"read-one-file-cites-evidence",
	"grep-then-read-match",
	"file-missing-clear-failure",
	"project-relative-read-resolves-workspace-path",
	"bare-filename-resolves-unique-active-project-file",
	"ambiguous-bare-filename-returns-candidates",
	"raw-write-denied-with-workspace-suggestion",
	"repeated-invalid-path-does-not-loop",
	"write-request-creates-mutation-plan",
	"reject-mutation-keeps-file-unchanged",
	"edit-conflict-becomes-conflicted",
	"delete-creates-single-mutation-review",
	"organize-mode-plans-links-and-tags",
	"review-mode-detects-structure-issues",
	"debug-profile-allows-exec",
	"normal-mode-hides-exec",
	"retryable-transport-no-prompt-fallback",
	"oversized-context-triggers-compaction",
	"dirty-tool-history-is-repaired-before-model-request",
	"tool-iteration-limit-safe-stop",
];
const supportedExpectKeys = new Set([
	"assistantIncludes",
	"assistantExcludes",
	"status",
	"terminalStatus",
	"finalFiles",
	"pendingMutationCount",
	"pendingMutationOperations",
	"storedMutationStatuses",
	"approvalRequestCount",
	"traceTools",
	"traceStatuses",
	"traceTargetPaths",
	"modelCalls",
	"nativeToolsInclude",
	"nativeToolsExclude",
	"turnEventsInclude",
	"recoveryTimelineIncludes",
	"loopPreventionTimelineIncludes",
	"modelRequestExcludes",
	"modelRequestMaxApproxTokens",
	"toolBoundaryViolationCount",
	"contextTrimmed",
	"safeStopped",
]);

async function loadEvalScenarios() {
	const raw = await fs.readFile(evalPath, "utf8");
	const data = JSON.parse(raw);
	assert.equal(data.version, 1);
	assert.equal(Array.isArray(data.scenarios), true);
	assert.equal(data.scenarios.length >= 14, true);
	return data.scenarios;
}

const scenarios = await loadEvalScenarios();

test("agent eval scenario catalog covers required Claude-grade tool-layer paths", () => {
	const ids = new Set(scenarios.map((scenario) => scenario.id));
	assert.equal(ids.size, scenarios.length, "scenario ids must be unique");
	for (const requiredId of requiredScenarioIds) {
		assert.ok(ids.has(requiredId), `missing required scenario id: ${requiredId}`);
	}
	for (const scenario of scenarios) {
		for (const key of Object.keys(scenario.expect ?? {})) {
			assert.ok(supportedExpectKeys.has(key), `unsupported expect key ${key} in ${scenario.id}`);
		}
	}
});

for (const scenario of scenarios) {
	test(`agent eval: ${scenario.id}`, async () => {
		const result = await runAgentRuntimeScenario(expandScenarioFixture(scenario));
		assertScenario(result, scenario.expect ?? {});
	});
}

function expandScenarioFixture(scenario) {
	return expandRepeats(JSON.parse(JSON.stringify(scenario)));
}

function expandRepeats(value) {
	if (Array.isArray(value)) {
		return value.map(expandRepeats);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value.concat)) {
		return value.concat.map(expandRepeats).join("");
	}
	if (typeof value.repeatText === "string" && Number.isInteger(value.repeatCount)) {
		return value.repeatText.repeat(value.repeatCount);
	}
	for (const [key, nested] of Object.entries(value)) {
		value[key] = expandRepeats(nested);
	}
	return value;
}

function assertScenario(result, expect) {
	for (const expected of expect.assistantIncludes ?? []) {
		assert.match(result.assistantText, new RegExp(escapeRegExp(expected), "i"));
	}
	for (const unexpected of expect.assistantExcludes ?? []) {
		assert.doesNotMatch(result.assistantText, new RegExp(escapeRegExp(unexpected), "i"));
	}
	if (expect.status) {
		assert.equal(result.turnEventSummary.status, expect.status);
	}
	if (expect.terminalStatus) {
		assert.equal(result.turnEventSummary.terminalStatus, expect.terminalStatus);
	}
	if (expect.finalFiles) {
		assert.deepEqual(result.files, expect.finalFiles);
	}
	if (Number.isInteger(expect.pendingMutationCount)) {
		assert.equal(result.pendingMutations.length, expect.pendingMutationCount);
	}
	if (Array.isArray(expect.pendingMutationOperations)) {
		assert.deepEqual(result.pendingMutations.map((mutation) => mutation.operation), expect.pendingMutationOperations);
	}
	if (Array.isArray(expect.storedMutationStatuses)) {
		assert.deepEqual(result.storedMutations.map((mutation) => mutation.status), expect.storedMutationStatuses);
	}
	if (Number.isInteger(expect.approvalRequestCount)) {
		assert.equal(result.approvalRequests.length, expect.approvalRequestCount);
	}
	if (Array.isArray(expect.traceTools)) {
		assert.deepEqual(result.traces.map((trace) => trace.tool), expect.traceTools);
	}
	if (Array.isArray(expect.traceStatuses)) {
		assert.deepEqual(result.traces.map((trace) => trace.status), expect.traceStatuses);
	}
	if (Array.isArray(expect.traceTargetPaths)) {
		assert.deepEqual(result.traces.map((trace) => trace.targetPath ?? ""), expect.traceTargetPaths);
	}
	if (expect.modelCalls) {
		for (const [key, value] of Object.entries(expect.modelCalls)) {
			assert.equal(result.modelCalls[key], value);
		}
	}
	if (Array.isArray(expect.nativeToolsInclude)) {
		const nativeTools = result.modelRequests.find((request) => request.channel === "native")?.tools.map((tool) => tool.name) ?? [];
		for (const toolName of expect.nativeToolsInclude) {
			assert.ok(nativeTools.includes(toolName), `expected native tools to include ${toolName}`);
		}
	}
	if (Array.isArray(expect.nativeToolsExclude)) {
		const nativeTools = result.modelRequests.find((request) => request.channel === "native")?.tools.map((tool) => tool.name) ?? [];
		for (const toolName of expect.nativeToolsExclude) {
			assert.ok(!nativeTools.includes(toolName), `expected native tools to exclude ${toolName}`);
		}
	}
	if (Array.isArray(expect.turnEventsInclude)) {
		const eventTypes = result.turnEvents.map((event) => event.type);
		for (const type of expect.turnEventsInclude) {
			assert.ok(eventTypes.includes(type), `expected replay to include ${type}`);
		}
	}
	if (Array.isArray(expect.recoveryTimelineIncludes)) {
		assertTimelineIncludes(
			result.turnEventSummary.recoveryTimeline ?? [],
			expect.recoveryTimelineIncludes,
			"recoveryTimeline",
		);
	}
	if (Array.isArray(expect.loopPreventionTimelineIncludes)) {
		assertTimelineIncludes(
			result.turnEventSummary.loopPreventionTimeline ?? [],
			expect.loopPreventionTimelineIncludes,
			"loopPreventionTimeline",
		);
	}
	if (Array.isArray(expect.modelRequestExcludes)) {
		assert.ok(
			result.modelRequests.every((request) => typeof request.sanitizedText === "string"),
			"expected model request sanitizedText diagnostics",
		);
		const text = result.modelRequests.map((request) => request.sanitizedText).join("\n");
		for (const unexpected of expect.modelRequestExcludes) {
			assert.doesNotMatch(text, new RegExp(escapeRegExp(unexpected), "i"));
		}
	}
	if (Number.isInteger(expect.modelRequestMaxApproxTokens)) {
		for (const request of result.modelRequests) {
			assert.equal(typeof request.approximateTokens, "number", "expected approximate token diagnostics");
			assert.ok(
				request.approximateTokens <= expect.modelRequestMaxApproxTokens,
				`expected request to stay under ${expect.modelRequestMaxApproxTokens} approximate tokens, got ${request.approximateTokens}`,
			);
		}
	}
	if (Number.isInteger(expect.toolBoundaryViolationCount)) {
		const count = result.modelRequests.reduce(
			(sum, request) => sum + (request.toolBoundaryViolations?.length ?? 0),
			0,
		);
		assert.equal(count, expect.toolBoundaryViolationCount);
	}
	if (expect.contextTrimmed) {
		const contextEvent = result.turnEvents.find((event) =>
			event.type === "context_built" &&
			Array.isArray(event.payload?.trimmedChannels)
		);
		assert.ok(contextEvent, "expected context_built event");
		assert.ok((contextEvent.payload?.trimmedChannels ?? []).length > 0, "expected trimmed context channels");
	}
	if (expect.safeStopped) {
		assert.equal(result.turnEventSummary.status, "safe_stopped");
		assert.ok(result.turnEvents.some((event) => event.type === "max_tool_iterations"));
	}
}

function assertTimelineIncludes(actualItems, expectedItems, label) {
	for (const expected of expectedItems) {
		assert.ok(
			actualItems.some((actual) => matchesPartial(actual, expected)),
			`expected ${label} to include ${JSON.stringify(expected)}, got ${JSON.stringify(actualItems)}`,
		);
	}
}

function matchesPartial(actual, expected) {
	if (Array.isArray(expected)) {
		return isDeepStrictEqual(actual, expected);
	}
	if (!expected || typeof expected !== "object") {
		return isDeepStrictEqual(actual, expected);
	}
	if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
		return false;
	}
	return Object.entries(expected).every(([key, value]) => matchesPartial(actual[key], value));
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
