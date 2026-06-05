/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

const RAW_MAX_TOOL_ITERATION_TEXTS = [
	"Tool iteration limit reached; stopped further tool calls for this turn.",
	"Maximum tool-iteration limit reached",
];

function assertNoRawMaxToolIterationText(value) {
	const serialized = typeof value === "string" ? value : JSON.stringify(value ?? {});
	for (const rawText of RAW_MAX_TOOL_ITERATION_TEXTS) {
		assert.equal(serialized.includes(rawText), false, `exposed raw runtime text: ${rawText}`);
	}
}

function assertEventTypesInclude(result, expectedTypes) {
	const actualTypes = result.events.map((event) => event.type);
	for (const expectedType of expectedTypes) {
		assert.ok(
			actualTypes.includes(expectedType),
			`expected event ${expectedType}; actual events: ${actualTypes.join(", ")}`,
		);
	}
}

function assertHarnessShape(result) {
	for (const key of ["assistantText", "traces", "events", "pendingMutations", "files"]) {
		assert.ok(Object.hasOwn(result, key), `missing harness output key: ${key}`);
	}
	assert.ok(Array.isArray(result.traces), "traces must be an array");
	assert.ok(Array.isArray(result.events), "events must be an array");
	assert.ok(Array.isArray(result.pendingMutations), "pendingMutations must be an array");
	assert.equal(typeof result.files, "object");
}

function assertReplayableTurnEvents(result, expectedTypes) {
	assert.ok(Array.isArray(result.turnEvents), "turnEvents must be an array");
	assert.ok(result.turnEventValidation?.ok, result.turnEventValidation?.errors?.join("; ") ?? "invalid event log");
	assert.deepEqual(
		result.turnEvents.map((event) => event.sequence),
		result.turnEvents.map((_event, index) => index + 1),
	);
	const actualTypes = result.turnEvents.map((event) => event.type);
	assert.equal(actualTypes[0], "turn_started");
	for (const expectedType of expectedTypes) {
		assert.ok(
			actualTypes.includes(expectedType),
			`expected turn event ${expectedType}; actual turn events: ${actualTypes.join(", ")}`,
		);
	}
}

function assertPersistedReplay(result, expectedTypes, options = {}) {
	assertReplayableTurnEvents(result, expectedTypes);
	const expectedStatus = options.status ?? "completed";
	assert.equal(result.turnEventSummary.status, expectedStatus);
	assert.equal(result.turnEventSummary.terminalStatus, options.terminalStatus ?? (
		expectedStatus === "failed" ? "turn_failed" : "turn_completed"
	));
}

function countTurnEvents(result, type) {
	return result.turnEvents.filter((event) => event.type === type).length;
}

function findTurnEvent(result, type) {
	return result.turnEvents.find((event) => event.type === type);
}

test("read -> final answer", async () => {
	const result = await runAgentRuntimeScenario({
		name: "read -> final answer",
		files: {
			"Project/workspace/a.md": "alpha",
		},
		settings: {
			agentRuntime: {
				toolCallingMode: "native",
			},
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ assistant: "The file says alpha." },
		],
	});

	assertHarnessShape(result);
	assert.match(result.assistantText, /alpha/);
	assert.deepEqual(result.traces.map((trace) => trace.tool), ["read"]);
	assert.equal(result.traces[0].status, "ok");
	assert.deepEqual(result.files, { "Project/workspace/a.md": "alpha" });
	assertEventTypesInclude(result, [
		"turn_started",
		"model_requested",
		"tool_requested",
		"tool_completed",
		"assistant_final",
	]);
	assertReplayableTurnEvents(result, [
		"turn_started",
		"model_requested",
		"model_completed",
		"tool_requested",
		"tool_policy_checked",
		"tool_completed",
		"assistant_final",
		"turn_completed",
	]);
	assert.equal(result.turnEventSummary.finalAnswerSummary, "The file says alpha.");
	const requested = result.turnEvents.find((event) => event.type === "tool_requested");
	const completed = result.turnEvents.find((event) => event.type === "tool_completed");
	assert.ok(requested.payload.toolCallId);
	assert.equal(completed.payload.toolCallId, requested.payload.toolCallId);
	const compactContext = result.turnEvents.find(
		(event) => event.type === "context_built" && event.payload.contextKey === "compact",
	);
	assert.equal(typeof compactContext?.payload.used, "number");
	assert.equal(typeof compactContext?.payload.softLimit, "number");
	assert.equal(typeof compactContext?.payload.hardLimit, "number");
	assert.ok(Array.isArray(compactContext?.payload.trimmedChannels));
});

test("PI-first runtime persists session, wrapper trace, package, and workspace policy metadata", async () => {
	const result = await runAgentRuntimeScenario({
		name: "pi metadata persistence",
		projectRoot: "Project",
		files: {
			"Project/workspace/a.md": "alpha",
		},
		settings: {
			agentRuntime: {
				toolCallingMode: "native",
			},
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ assistant: "The file says alpha." },
		],
	});

	assert.equal(result.piSessionRecords.length, 1);
	assert.equal(result.piSessionRecords[0].status, "completed");
	assert.equal(result.piSessionRecords[0].packageRef.packageId, "friday-pi-local-bridge");
	assert.equal(result.piSessionRecords[0].workspacePolicy.trustBoundary, "project");
	assert.equal(result.piSessionRecords[0].workspacePolicy.activeProject.projectId, "project");
	assert.equal(result.piSessionRecords[0].workspacePolicy.activeProject.slug, "project");
	assert.equal(result.piSessionRecords[0].workspacePolicy.activeProject.name, "Project");
	assert.equal(result.piSessionRecords[0].workspacePolicy.activeProject.vaultRoot, "Project");
	assert.equal(result.piSessionRecords[0].workspacePolicy.activeProject.absoluteRoot.endsWith("Project"), true);
	assert.equal(result.piSessionRecords[0].workspacePolicy.externalAccess, "explicit");
	assert.equal(result.piSessionRecords[0].workspacePolicy.externalWrite, false);
	assert.equal(result.piToolTraceRecords.length, 1);
	assert.equal(result.piToolTraceRecords[0].kind, "pi_tool_trace");
	assert.equal(result.piToolTraceRecords[0].tool, "read");
	assert.equal(result.piToolTraceRecords[0].workspacePolicy.externalWrite, false);
	assert.equal(result.piPackageManifest.packageId, "friday-pi-local-bridge");
	assert.equal(result.piPackageManifest.marketplace, false);
});

test("read -> final answer persists visible process narration for replay without fake plan", async () => {
	const result = await runAgentRuntimeScenario({
		name: "read -> visible narration replay",
		files: {
			"Project/workspace/a.md": "alpha",
		},
		settings: {
			agentRuntime: {
				toolCallingMode: "native",
			},
		},
		modelSteps: [
			{
				assistant: "我理解你的需求是先读取文件，接下来我会调用读取工具。",
				tool: { name: "read", args: { path: "Project/workspace/a.md" } },
			},
			{ assistant: "The file says alpha." },
		],
	});

	assert.equal(result.assistantText.includes("我理解你的需求"), false);
	assert.match(result.assistantText, /alpha/);
	assertPersistedReplay(result, ["narration_report", "tool_completed", "assistant_final", "turn_completed"]);
	assert.deepEqual(result.turnEventSummary.narrationTimeline.map((item) => item.kind), [
		"stage_report",
		"stage_report",
	]);
	assert.equal(result.turnEventSummary.narrationTimeline.some((item) => item.kind === "task_acknowledged"), false);
	assert.equal(result.turnEventSummary.narrationTimeline.some((item) => item.kind === "plan_declared"), false);
	assert.match(result.turnEventSummary.narrationTimeline[0]?.summary ?? "", /我理解你的需求/);
	assert.equal(JSON.stringify(result.turnEventSummary).includes("raw chain of thought"), false);
});

test("grep -> read -> final answer", async () => {
	const result = await runAgentRuntimeScenario({
		name: "grep -> read -> final answer",
		files: {
			"Project/workspace/a.md": "alpha topic",
			"Project/workspace/b.md": "beta topic",
		},
		modelSteps: [
			{ tool: { name: "grep", args: { path: "Project/workspace", pattern: "beta" } } },
			{ tool: { name: "read", args: { path: "Project/workspace/b.md" } } },
			{ assistant: "Found beta topic in Project/workspace/b.md." },
		],
	});

	assert.match(result.assistantText, /beta topic/);
	assert.deepEqual(result.traces.map((trace) => trace.tool), ["grep", "read"]);
	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[1].status, "ok");
	assertEventTypesInclude(result, ["tool_completed", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_completed", "assistant_final", "turn_completed"]);
	assert.equal(countTurnEvents(result, "tool_completed"), 2);
});

test("tool failure -> final answer reports failure", async () => {
	const result = await runAgentRuntimeScenario({
		name: "tool failure -> final answer reports failure",
		files: {},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/missing.md" } } },
			{ assistant: "I could not read Project/workspace/missing.md because it does not exist." },
		],
	});

	assert.match(result.assistantText, /could not read/i);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "read");
	assert.equal(result.traces[0].status, "failed");
	assert.match(result.traces[0].error, /does not exist/i);
	assert.equal(result.modelCalls.prompt, 0);
	assert.ok(!result.events.some((event) => event.type === "fallback"));
	assertEventTypesInclude(result, ["tool_failed", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_failed", "assistant_final", "turn_completed"]);
	assert.equal(result.turnEventSummary.toolEvents.failed, 1);
	const toolFailed = findTurnEvent(result, "tool_failed");
	assert.match(toolFailed.payload.error, /does not exist/i);
	assert.equal(toolFailed.payload.failureClass, "invalid_input");
	assert.equal(toolFailed.payload.recoverable, false);
	assert.equal(toolFailed.payload.retryable, false);
});

test("disabled tool -> denied trace without execution", async () => {
	const result = await runAgentRuntimeScenario({
		name: "disabled tool -> denied trace without execution",
		files: {
			"Project/workspace/a.md": "alpha",
		},
		settings: {
			agentRuntime: {
				disabledTools: ["read"],
			},
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ assistant: "The read tool is disabled, so I did not read the file." },
		],
	});

	assert.match(result.assistantText, /disabled/i);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "read");
	assert.equal(result.traces[0].status, "denied");
	assert.match(result.traces[0].error, /disabled/i);
	assert.deepEqual(result.files, { "Project/workspace/a.md": "alpha" });
	assertEventTypesInclude(result, ["tool_denied", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_denied", "assistant_final", "turn_completed"]);
});

test("gated wiki tool -> denied while wiki feature is disabled", async () => {
	const result = await runAgentRuntimeScenario({
		name: "gated wiki tool -> denied while wiki feature is disabled",
		files: {
			"Project/raw/source.md": "wiki source",
		},
		modelSteps: [
			{ tool: { name: "compile_wiki", args: { rawPaths: ["Project/raw/source.md"] } } },
			{ assistant: "Wiki compilation is not available in this runtime." },
		],
	});

	assert.match(result.assistantText, /not available/i);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "compile_wiki");
	assert.equal(result.traces[0].status, "denied");
	assert.match(result.traces[0].error, /unknown tool|disabled/i);
	assertEventTypesInclude(result, ["tool_denied", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_denied", "assistant_final", "turn_completed"]);
});

test("standard delete creates mutation review -> no file change", async () => {
	const result = await runAgentRuntimeScenario({
		name: "standard delete creates mutation review -> no file change",
		files: {
			"Project/workspace/a.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "delete",
					args: { path: "Project/workspace/a.md" },
				},
			},
			{ assistant: "I prepared the delete for review." },
		],
	});

	assert.match(result.assistantText, /prepared the delete/i);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "delete");
	assert.equal(result.traces[0].status, "ok");
	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "delete");
	assertEventTypesInclude(result, ["mutation_planned", "tool_completed", "assistant_final"]);
	assertPersistedReplay(result, [
		"tool_policy_checked",
		"mutation_planned",
		"tool_completed",
		"assistant_final",
		"turn_completed",
	]);
	assert.equal(result.turnEventSummary.approvals.requested, 0);
	assert.equal(result.turnEventSummary.mutations.planned, 1);
});

test("low max tool iterations still allows loop-control safe stop", async () => {
	const result = await runAgentRuntimeScenario({
		name: "low max tool iterations still allows loop-control safe stop",
		files: {
			"Project/workspace/a.md": "alpha",
		},
		settings: {
			agentRuntime: {
				maxToolIterations: 1,
			},
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
		],
	});

	assertNoRawMaxToolIterationText(result.assistantText);
	assert.equal(result.traces.length, 3);
	assert.deepEqual(result.traces.map((trace) => trace.tool), ["read", "read", "read"]);
	assert.equal(result.modelCalls.total, 3);
	assertEventTypesInclude(result, ["assistant_final"]);
	assertPersistedReplay(result, ["loop_control_stop", "turn_completed"], { status: "safe_stopped" });
	assert.equal(countTurnEvents(result, "max_tool_iterations"), 0);
	const loopControlEvent = findTurnEvent(result, "loop_control_stop");
	assert.equal(loopControlEvent?.payload.status, "safe_stopped");
	assert.equal(loopControlEvent?.payload.reason, "no_progress");
	assert.equal(loopControlEvent?.payload.repetitionKind, "repeated_unchanged_observation");
	assert.deepEqual(result.turnEventSummary.loopPreventionTimeline.map((item) => item.event), ["loop_control_stop"]);
	assert.deepEqual(result.turnEventSummary.loopPreventionTimeline.map((item) => item.reason), ["no_progress"]);
	assertNoRawMaxToolIterationText(loopControlEvent?.payload);
	const assistantFinalEvent = result.events.find((event) => event.type === "assistant_final");
	assertNoRawMaxToolIterationText(assistantFinalEvent?.payload);
	assertNoRawMaxToolIterationText(result.turnEventSummary.finalAnswerSummary);
});

test("native mode success", async () => {
	const result = await runAgentRuntimeScenario({
		name: "native mode success",
		settings: {
			agentRuntime: {
				toolCallingMode: "native",
			},
		},
		modelSteps: [{ assistant: "Native mode answer." }],
	});

	assert.equal(result.assistantText, "Native mode answer.");
	assert.equal(result.modelCalls.native, 1);
	assert.equal(result.modelCalls.prompt, 0);
	assertEventTypesInclude(result, ["model_requested", "model_completed", "assistant_final"]);
	assertPersistedReplay(result, ["model_requested", "model_completed", "assistant_final", "turn_completed"]);
});

test("prompt mode success", async () => {
	const result = await runAgentRuntimeScenario({
		name: "prompt mode success",
		files: {
			"Project/workspace/a.md": "prompt beta",
		},
		settings: {
			agentRuntime: {
				toolCallingMode: "prompt",
			},
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ assistant: "Prompt mode saw prompt beta." },
		],
	});

	assert.match(result.assistantText, /prompt beta/);
	assert.equal(result.modelCalls.native, 0);
	assert.equal(result.modelCalls.prompt, 2);
	assert.deepEqual(result.traces.map((trace) => trace.tool), ["read"]);
	assertEventTypesInclude(result, ["tool_completed", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_completed", "assistant_final", "turn_completed"]);
});

test("native incompatible -> prompt fallback", async () => {
	const result = await runAgentRuntimeScenario({
		name: "native incompatible -> prompt fallback",
		settings: {
			agentRuntime: {
				toolCallingMode: "auto",
			},
		},
		modelSteps: [
			{ error: "unsupported tool schema" },
			{ assistant: "Prompt fallback completed." },
		],
	});

	assert.equal(result.assistantText, "Prompt fallback completed.");
	assert.equal(result.modelCalls.native, 1);
	assert.equal(result.modelCalls.prompt, 1);
	assertEventTypesInclude(result, ["fallback", "assistant_final"]);
	assertPersistedReplay(result, ["fallback", "parse_error", "assistant_final", "turn_completed"]);
});

test("retryable transport failure -> no prompt fallback", async () => {
	const result = await runAgentRuntimeScenario({
		name: "retryable transport failure -> no prompt fallback",
		settings: {
			agentRuntime: {
				toolCallingMode: "auto",
			},
		},
		modelSteps: [{ error: "504 gateway timeout" }],
	});

	assert.equal(result.status, "failed");
	assert.equal(result.modelCalls.native, 1);
	assert.equal(result.modelCalls.prompt, 0);
	assert.doesNotThrow(() => assertEventTypesInclude(result, ["turn_failed"]));
	assert.ok(
		!result.events.some((event) => event.type === "fallback"),
		"retryable transport errors must not fallback to prompt mode",
	);
	assert.ok(result.turnEventValidation.ok, result.turnEventValidation.errors.join("; "));
	assert.ok(result.turnEvents.some((event) => event.type === "model_failed"));
	assert.equal(result.turnEvents.at(-1)?.type, "turn_failed");
	assert.equal(result.turnEventSummary.status, "failed");
	assert.match(result.failure.message, /504 gateway timeout/);
	const modelFailed = findTurnEvent(result, "model_failed");
	assert.match(modelFailed.payload.error, /504 gateway timeout/);
	assert.equal(modelFailed.payload.failureClass, "transport_unstable");
	assert.equal(modelFailed.payload.recoverable, true);
	assert.equal(modelFailed.payload.retryable, true);
	const turnFailed = findTurnEvent(result, "turn_failed");
	assert.match(turnFailed.payload.error, /504 gateway timeout/);
	assert.equal(turnFailed.payload.failureClass, "transport_unstable");
	assert.equal(turnFailed.payload.recoverable, true);
	assert.equal(turnFailed.payload.retryable, true);
});

test("runtime cancellation -> turn_cancelled replay terminal", async () => {
	const result = await runAgentRuntimeScenario({
		name: "runtime cancellation",
		settings: {
			agentRuntime: {
				toolCallingMode: "native",
			},
		},
		modelSteps: [{ error: "AbortError: user cancelled" }],
	});

	assert.equal(result.status, "failed");
	assert.equal(result.modelCalls.native, 1);
	assert.equal(result.turnEventValidation.ok, true, result.turnEventValidation.errors.join("; "));
	assert.equal(result.turnEvents.at(-1)?.type, "turn_cancelled");
	assert.equal(result.turnEventSummary.status, "cancelled");
	assert.equal(result.turnEventSummary.terminalStatus, "turn_cancelled");
	const cancelled = findTurnEvent(result, "turn_cancelled");
	assert.match(cancelled.payload.error, /user cancelled/i);
	assert.equal(cancelled.payload.failureClass, "cancelled");
	assert.equal(cancelled.payload.recoverable, false);
	assert.equal(cancelled.payload.retryable, false);
});

test("exec stays hidden from normal Obsidian modes", async () => {
	const result = await runAgentRuntimeScenario({
		name: "exec stays hidden from normal Obsidian modes",
		agentMode: "ask",
		settings: {
			agentRuntime: {
				enableExecTool: true,
			},
		},
		modelSteps: [{ assistant: "No debug tools are exposed." }],
	});

	const nativeTools = result.modelRequests[0].tools.map((tool) => tool.name);
	assert.ok(!nativeTools.includes("exec"));
	assert.equal(result.traces.length, 0);
	assertEventTypesInclude(result, ["assistant_final"]);
	assertPersistedReplay(result, ["model_requested", "model_completed", "assistant_final", "turn_completed"]);
});

test("exec debug allowlist -> executes through governed tool path", async () => {
	const result = await runAgentRuntimeScenario({
		name: "exec debug allowlist -> executes through governed tool path",
		agentMode: "debug",
		settings: {
			agentRuntime: {
				enableExecTool: true,
			},
		},
		modelSteps: [
			{ tool: { name: "exec", args: { command: "git", args: ["status"] } } },
			{ assistant: "Debug command completed through the allowlist." },
		],
	});

	const nativeTools = result.modelRequests[0].tools.map((tool) => tool.name);
	assert.ok(nativeTools.includes("exec"));
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "exec");
	assert.equal(result.traces[0].status, "ok");
	assertEventTypesInclude(result, ["tool_completed", "assistant_final"]);
	assertPersistedReplay(result, [
		"tool_policy_checked",
		"tool_approval_requested",
		"tool_approval_resolved",
		"tool_completed",
		"assistant_final",
		"turn_completed",
	]);
});

test("malformed model JSON -> parse error event", async () => {
	const result = await runAgentRuntimeScenario({
		name: "malformed model JSON -> parse error event",
		settings: {
			agentRuntime: {
				toolCallingMode: "prompt",
			},
		},
		modelSteps: [{ raw: "```friday-runtime\n{\"type\":\"tool_call\",\"tool\":\n```" }],
	});

	assert.match(result.parseError, /not valid JSON/i);
	assertEventTypesInclude(result, ["parse_error", "assistant_final"]);
	assertPersistedReplay(result, ["parse_error", "assistant_final", "turn_completed"]);
});

test("research mode: grep/search -> read multiple notes -> sourced synthesis", async () => {
	const result = await runAgentRuntimeScenario({
		name: "research mode sourced synthesis",
		agentMode: "research",
		files: {
			"Project/workspace/research-a.md": "Vector databases help semantic retrieval.",
			"Project/workspace/research-b.md": "Graph links help trace note relationships.",
			"Project/workspace/other.md": "Unrelated.",
		},
		modelSteps: [
			{ tool: { name: "search_text", args: { path: "Project/workspace", query: "help" } } },
			{ tool: { name: "read", args: { path: "Project/workspace/research-a.md" } } },
			{ tool: { name: "read", args: { path: "Project/workspace/research-b.md" } } },
			{
				assistant:
					"Synthesis: semantic retrieval and graph links are complementary. Sources: Project/workspace/research-a.md; Project/workspace/research-b.md.",
			},
		],
	});

	assert.match(result.assistantText, /semantic retrieval/);
	assert.match(result.assistantText, /Project\/workspace\/research-a\.md/);
	assert.match(result.assistantText, /Project\/workspace\/research-b\.md/);
	assert.deepEqual(result.traces.map((trace) => trace.tool), ["search_text", "read", "read"]);
	assertEventTypesInclude(result, ["tool_completed", "assistant_final"]);
	assertPersistedReplay(result, ["tool_policy_checked", "tool_completed", "assistant_final", "turn_completed"]);
	assert.deepEqual(
		result.turnEventSummary.toolCalls.map((call) => call.tool),
		["search_text", "read", "read"],
	);
});

test("organize mode: propose link/tag/frontmatter changes as pending mutation plans", async () => {
	const result = await runAgentRuntimeScenario({
		name: "organize mode mutation planning",
		agentMode: "organize",
		files: {
			"Project/workspace/a.md": "# A\n\nRelated idea.",
		},
		modelSteps: [
			{
				assistant: "I prepared organization changes for review.",
				pendingMutations: [
					{
						id: "plan-frontmatter",
						operation: "frontmatter_update",
						targetPath: "Project/workspace/a.md",
						summary: "Add status and topic frontmatter.",
						status: "pending",
					},
					{
						id: "plan-link",
						operation: "link_suggest",
						targetPath: "Project/workspace/a.md",
						summary: "Suggest a link to [[Related idea]].",
						status: "pending",
					},
				],
			},
		],
	});

	assert.match(result.assistantText, /prepared organization changes/i);
	assert.equal(result.pendingMutations.length, 2);
	assert.deepEqual(
		result.pendingMutations.map((plan) => plan.operation),
		["frontmatter_update", "link_suggest"],
	);
	assert.deepEqual(
		result.pendingMutations.map((plan) => plan.source),
		["model_envelope", "model_envelope"],
	);
	assert.deepEqual(result.files, { "Project/workspace/a.md": "# A\n\nRelated idea." });
	assertEventTypesInclude(result, ["mutation_planned", "assistant_final"]);
	assertPersistedReplay(result, ["mutation_planned", "assistant_final", "turn_completed"]);
	assert.equal(result.turnEventSummary.mutations.planned, 2);
	assert.deepEqual(
		result.turnEvents
			.filter((event) => event.type === "mutation_planned")
			.map((event) => event.payload.operation),
		["frontmatter_update", "link_suggest"],
	);
	assert.deepEqual(
		result.turnEvents
			.filter((event) => event.type === "mutation_planned")
			.map((event) => event.payload.source),
		["model_envelope", "model_envelope"],
	);
});

test("model mutation envelope persists plans through Kernel mutation ownership with task trace", async () => {
	const result = await runAgentRuntimeScenario({
		name: "kernel-owned model mutation planning",
		files: {
			"Project/workspace/a.md": "original",
		},
		modelSteps: [
			{
				assistant: "Prepared a reviewed update.",
				pendingMutations: [
					{
						id: "model-write-plan",
						operation: "write",
						targetPath: "Project/workspace/a.md",
						summary: "Replace the file content.",
						status: "pending",
						before: "original",
						after: "changed",
						changeType: "update",
					},
				],
			},
		],
	});

	assert.ok(result.pendingMutations.some((plan) => plan.id === "model-write-plan"));
	assert.equal(result.storedMutations.length, 1);
	assert.equal(result.storedMutations[0].id, "model-write-plan");
	assert.equal(result.storedMutations[0].operation, "write");
	assert.equal(result.storedMutations[0].targetPath, "Project/workspace/a.md");
	assert.equal(result.storedMutations[0].taskId, result.task.id);
	assert.equal(result.storedMutations[0].traceId, result.traceId);
	assert.equal(result.files["Project/workspace/a.md"], "original");
	assert.equal(result.task.status, "waiting_for_approval");
	const planned = findTurnEvent(result, "mutation_planned");
	assert.equal(planned.payload.id, "model-write-plan");
	assert.equal(planned.payload.taskId, result.task.id);
	assert.equal(planned.payload.traceId, result.traceId);
	assert.equal(result.turnEventSummary.mutations.planned, 1);
});

test("mutation review accept and reject events are persisted to replay logs", async () => {
	const accepted = await runAgentRuntimeScenario({
		name: "mutation accept replay",
		files: {
			"Project/workspace/a.md": "original",
		},
		afterTurnActions: ["acceptFirstEditPlan"],
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Prepared and applied a reviewed update." },
		],
	});

	assertPersistedReplay(accepted, [
		"mutation_planned",
		"mutation_applied",
		"assistant_final",
		"turn_completed",
	]);
	assert.equal(accepted.turnEventSummary.mutations.planned, 1);
	assert.equal(accepted.turnEventSummary.mutations.applied, 1);

	const rejected = await runAgentRuntimeScenario({
		name: "mutation reject replay",
		files: {
			"Project/workspace/a.md": "original",
		},
		afterTurnActions: ["rejectFirstEditPlan"],
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Prepared an update for rejection." },
		],
	});

	assertPersistedReplay(rejected, [
		"mutation_planned",
		"mutation_rejected",
		"assistant_final",
		"turn_completed",
	]);
	assert.equal(rejected.turnEventSummary.mutations.rejected, 1);
	assert.deepEqual(rejected.files, { "Project/workspace/a.md": "original" });
});
