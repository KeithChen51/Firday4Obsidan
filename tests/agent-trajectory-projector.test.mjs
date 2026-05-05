/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const projectorPath = path.join(projectRoot, "src/core/trajectory/AgentTrajectoryProjector.ts");

async function loadProjector() {
	return jiti.import(projectorPath);
}

function makeReplaySummary(overrides = {}) {
	return {
		conversationId: "conversation-1",
		turnId: "turn-replay",
		taskId: "task-replay",
		traceId: "trace-replay",
		totalEvents: 7,
		eventTypes: [],
		status: "completed",
		startedAt: "2026-05-05T00:00:00.000Z",
		updatedAt: "2026-05-05T00:00:08.000Z",
		completedAt: "2026-05-05T00:00:08.000Z",
		durationMs: 8000,
		modelCalls: { requested: 1, completed: 1, failed: 0 },
		transport: { retries: 0, exhausted: 0, lastMessage: "" },
		transportTimeline: [],
		toolEvents: { requested: 1, completed: 1, failed: 0, denied: 0 },
		toolCalls: [
			{ step: 1, tool: "read", toolCallId: "tool-1", status: "ok", targetPath: "Notes/today.md", at: "2026-05-05T00:00:02.000Z" },
		],
		approvals: { requested: 1, resolved: 1, approved: 1, denied: 0 },
		mutations: { planned: 1, applied: 1, rejected: 0, conflicted: 0, applyFailed: 0 },
		mutationTimeline: [
			{
				id: "plan-1",
				event: "planned",
				operation: "edit",
				targetPath: "Notes/today.md",
				status: "pending_review",
				summary: "Update note summary.",
				reason: "",
				at: "2026-05-05T00:00:03.000Z",
			},
			{
				id: "plan-1",
				event: "applied",
				operation: "edit",
				targetPath: "Notes/today.md",
				status: "applied",
				summary: "Applied note update.",
				reason: "Approved by user.",
				at: "2026-05-05T00:00:06.000Z",
			},
		],
		taskTimeline: [
			{ taskId: "task-replay", event: "created", status: "created", summary: "Task created.", reason: "", at: "2026-05-05T00:00:00.000Z" },
			{ taskId: "task-replay", event: "running", status: "running", summary: "Runtime started.", reason: "", at: "2026-05-05T00:00:01.000Z" },
			{ taskId: "task-replay", event: "completed", status: "completed", summary: "Task completed.", reason: "", at: "2026-05-05T00:00:08.000Z" },
		],
		finalAnswerSummary: "Answered from the replay.",
		errors: [],
		terminalStatus: "turn_completed",
		...overrides,
	};
}

test("projectRuntimeProgress maps live context model tool done events into ordered stages and items", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{
			phase: "start",
			depth: 0,
			message: "Runtime started.",
			turnId: "turn-live",
			taskId: "task-live",
			traceId: "trace-live",
			conversationId: "conversation-live",
			at: "2026-05-05T00:00:00.000Z",
		},
		{ phase: "context", depth: 0, contextKey: "instructions", message: "Loaded project rules.", at: "2026-05-05T00:00:01.000Z" },
		{ phase: "model_request", depth: 0, step: 1, message: "Requesting model decision.", at: "2026-05-05T00:00:02.000Z" },
		{ phase: "model_response", depth: 0, step: 1, message: "Model decision received.", at: "2026-05-05T00:00:03.000Z" },
		{ phase: "tool_call", depth: 0, step: 1, tool: "read", targetPath: "Notes/today.md", message: "Reading note.", at: "2026-05-05T00:00:04.000Z" },
		{
			phase: "tool_result",
			depth: 0,
			step: 1,
			tool: "read",
			targetPath: "Notes/today.md",
			status: "ok",
			summary: "Read note summary.",
			message: "Read complete.",
			at: "2026-05-05T00:00:05.000Z",
		},
		{ phase: "done", depth: 0, message: "Runtime finished.", at: "2026-05-05T00:00:06.000Z" },
	]);

	assert.equal(snapshot.status, "completed");
	assert.deepEqual(snapshot.identity, {
		turnId: "turn-live",
		taskId: "task-live",
		traceId: "trace-live",
		conversationId: "conversation-live",
	});
	assert.deepEqual(snapshot.stages.map((stage) => stage.key), ["context", "reasoning", "tools", "review", "finalize"]);
	assert.equal(snapshot.stages.find((stage) => stage.key === "context")?.status, "ok");
	assert.equal(snapshot.stages.find((stage) => stage.key === "reasoning")?.status, "ok");
	assert.equal(snapshot.stages.find((stage) => stage.key === "tools")?.status, "ok");
	assert.equal(snapshot.stages.find((stage) => stage.key === "finalize")?.status, "ok");
	assert.deepEqual(snapshot.items.map((item) => item.kind), ["context", "model", "tool", "final"]);
	assert.deepEqual(snapshot.items.map((item) => item.status), ["ok", "ok", "ok", "ok"]);
	assert.equal(snapshot.items.find((item) => item.kind === "tool")?.tool, "read");
	assert.equal(snapshot.items.find((item) => item.kind === "tool")?.targetPath, "Notes/today.md");
	assert.deepEqual(snapshot.time, {
		startedAt: "2026-05-05T00:00:00.000Z",
		updatedAt: "2026-05-05T00:00:06.000Z",
		completedAt: "2026-05-05T00:00:06.000Z",
		durationMs: 6000,
	});
	assert.equal(snapshot.items.find((item) => item.kind === "tool")?.at, "2026-05-05T00:00:04.000Z");
	assert.equal(snapshot.privacy.source, "live");
});

test("projectRuntimeProgress turns reasoning metadata into a progressive reasoning item", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{
			phase: "model_response",
			depth: 0,
			step: 1,
			message: "Model response received.",
			reasoningVisibleSummary: "Checked the user goal and current workspace.",
			reasoningProvider: "deepseek",
			reasoningRawFormat: "reasoning_content",
			reasoningContinuationPolicy: "drop",
			at: "2026-05-05T00:00:01.000Z",
		},
	]);

	const reasoningItem = snapshot.items.find((item) => item.kind === "reasoning");
	assert.ok(reasoningItem, "reasoning metadata should create a trajectory item");
	assert.equal(reasoningItem?.detail, "Checked the user goal and current workspace.");
	assert.equal(reasoningItem?.reasoningProvider, "deepseek");
	assert.equal(reasoningItem?.reasoningRawFormat, "reasoning_content");
	assert.equal(reasoningItem?.reasoningContinuationPolicy, "drop");
	assert.equal(JSON.stringify(snapshot).includes("raw chain of thought"), false);
});

test("projectRuntimeProgress marks failed tool results and exposes a retryable failure summary", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-failed" },
		{ phase: "model_request", depth: 0, step: 1, message: "Requesting model decision." },
		{ phase: "tool_call", depth: 0, step: 1, tool: "grep", targetPath: "Notes", message: "Searching notes." },
		{
			phase: "tool_result",
			depth: 0,
			step: 1,
			tool: "grep",
			targetPath: "Notes",
			status: "failed",
			summary: "grep failed: timeout while reading private prompt SECRET=abc.",
			message: "grep failed.",
		},
		{ phase: "error", depth: 0, message: "Runtime failed: grep failed." },
	]);

	assert.equal(snapshot.status, "failed");
	const toolItem = snapshot.items.find((item) => item.kind === "tool");
	assert.equal(toolItem?.status, "failed");
	assert.equal(toolItem?.detail.includes("SECRET=abc"), false);
	assert.equal(snapshot.failure?.class, "tool");
	assert.equal(snapshot.failure?.retryable, true);
	assert.match(snapshot.failure?.message ?? "", /grep failed/i);
});

test("projectRuntimeProgress turns approval progress into a waiting approval snapshot", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-approval", taskId: "task-approval" },
		{ phase: "model_request", depth: 0, step: 1, message: "Requesting model decision." },
		{ phase: "tool_approval", depth: 0, step: 1, tool: "write", targetPath: "Notes/today.md", message: "Approve write." },
	]);

	assert.equal(snapshot.status, "waiting_for_approval");
	assert.equal(snapshot.stages.find((stage) => stage.key === "review")?.status, "waiting");
	const approval = snapshot.items.find((item) => item.kind === "approval");
	assert.equal(approval?.status, "waiting");
	assert.equal(approval?.tool, "write");
	assert.equal(approval?.targetPath, "Notes/today.md");
});

test("projectRuntimeProgress projects model retry progress into a running transport item", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-transport-live", taskId: "task-transport-live" },
		{ phase: "model_request", depth: 0, step: 1, message: "Requesting model decision." },
		{
			phase: "model_retry",
			depth: 0,
			step: 1,
			message: "Model request retry scheduled after HTTP 504 (attempt 1/4, retrying in 700ms)",
			transport: {
				type: "retry_scheduled",
				requestId: "llm-live-1",
				attempt: 1,
				maxAttempts: 4,
				delayMs: 700,
				httpStatus: 504,
				retryable: true,
				channel: "chat_with_tools",
				endpointIndex: 0,
				endpointCount: 1,
			},
		},
	]);

	assert.equal(snapshot.status, "running");
	assert.equal(snapshot.headline, "Reconnecting to model");
	assert.match(snapshot.summary, /attempt 1\/4/);
	const transportItem = snapshot.items.find((item) => item.kind === "transport");
	assert.equal(transportItem?.status, "running");
	assert.equal(transportItem?.step, 1);
	assert.equal(transportItem?.rawEventType, "retry_scheduled");
	assert.match(transportItem?.detail ?? "", /700ms/);
});

test("projectReplaySummary projects tool mutation and task timelines into a completed snapshot", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary());

	assert.equal(snapshot.status, "completed");
	assert.deepEqual(snapshot.identity, {
		turnId: "turn-replay",
		taskId: "task-replay",
		traceId: "trace-replay",
		conversationId: "conversation-1",
	});
	assert.equal(snapshot.summary, "Answered from the replay.");
	assert.equal(snapshot.privacy.source, "replay");
	assert.deepEqual(snapshot.time, {
		startedAt: "2026-05-05T00:00:00.000Z",
		updatedAt: "2026-05-05T00:00:08.000Z",
		completedAt: "2026-05-05T00:00:08.000Z",
		durationMs: 8000,
	});
	assert.ok(snapshot.items.some((item) => item.kind === "tool" && item.tool === "read" && item.status === "ok"));
	assert.ok(snapshot.items.some((item) => item.kind === "mutation" && item.actionRef === "plan-1"));
	assert.ok(snapshot.items.some((item) => item.kind === "task" && item.status === "ok"));
	assert.deepEqual(snapshot.mutations.map((mutation) => mutation.event), ["planned", "applied"]);
});

test("projectReplaySummary restores reasoning timeline from safe replay metadata", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary({
		reasoningTimeline: [
			{
				step: 1,
				provider: "openai",
				rawFormat: "responses_reasoning",
				continuationPolicy: "provider_managed",
				visibleSummary: "Used the provider reasoning summary.",
				warnings: [],
				at: "2026-05-05T00:00:02.000Z",
			},
		],
	}));

	const reasoningItem = snapshot.items.find((item) => item.kind === "reasoning");
	assert.ok(reasoningItem, "replay reasoning metadata should restore a timeline item");
	assert.equal(reasoningItem?.status, "ok");
	assert.equal(reasoningItem?.detail, "Used the provider reasoning summary.");
	assert.equal(reasoningItem?.reasoningProvider, "openai");
	assert.equal(JSON.stringify(snapshot).includes("raw CoT"), false);
});

test("projectReplaySummary surfaces mutation conflict and apply failure directly", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary({
		mutations: { planned: 2, applied: 0, rejected: 0, conflicted: 1, applyFailed: 1 },
		mutationTimeline: [
			{
				id: "plan-apply-failed",
				event: "planned",
				operation: "edit",
				targetPath: "Notes/apply.md",
				status: "pending_review",
				summary: "Prepare apply failure case.",
				reason: "",
			},
			{
				id: "plan-apply-failed",
				event: "apply_failed",
				operation: "edit",
				targetPath: "Notes/apply.md",
				status: "apply_failed",
				summary: "Could not apply patch.",
				reason: "File changed before apply.",
			},
			{
				id: "plan-conflict",
				event: "planned",
				operation: "write",
				targetPath: "Notes/conflict.md",
				status: "pending_review",
				summary: "Prepare conflict case.",
				reason: "",
			},
			{
				id: "plan-conflict",
				event: "conflicted",
				operation: "write",
				targetPath: "Notes/conflict.md",
				status: "conflicted",
				summary: "Detected conflicting write.",
				reason: "External edit won.",
			},
		],
	}));

	assert.equal(snapshot.status, "failed");
	assert.equal(snapshot.failure?.class, "mutation");
	assert.equal(snapshot.failure?.retryable, true);
	assert.deepEqual(snapshot.actions.map((action) => [action.id, action.targetId]), [["retry", "task-replay"]]);
	assert.deepEqual(snapshot.mutations.map((mutation) => [mutation.id, mutation.event, mutation.status]), [
		["plan-apply-failed", "planned", "pending_review"],
		["plan-apply-failed", "apply_failed", "apply_failed"],
		["plan-conflict", "planned", "pending_review"],
		["plan-conflict", "conflicted", "conflicted"],
	]);
	assert.ok(snapshot.items.some((item) =>
		item.kind === "mutation" &&
		item.actionRef === "plan-apply-failed" &&
		item.status === "failed" &&
		item.rawEventType === "mutation_apply_failed" &&
		item.detail === "Could not apply patch."
	));
	assert.ok(snapshot.items.some((item) =>
		item.kind === "mutation" &&
		item.actionRef === "plan-conflict" &&
		item.status === "failed" &&
		item.rawEventType === "mutation_conflicted" &&
		item.detail === "Detected conflicting write."
	));
});

test("projectReplaySummary maps failed cancelled and safe stopped terminal states", async () => {
	const { projectReplaySummary } = await loadProjector();

	assert.equal(projectReplaySummary(makeReplaySummary({ status: "failed", terminalStatus: "turn_failed", errors: ["Model failed."] })).status, "failed");
	assert.equal(projectReplaySummary(makeReplaySummary({ status: "cancelled", terminalStatus: "turn_cancelled", errors: ["User cancelled."] })).status, "cancelled");
	assert.equal(projectReplaySummary(makeReplaySummary({ status: "safe_stopped", terminalStatus: "turn_completed" })).status, "safe_stopped");
});

test("projectReplaySummary projects exhausted transport replay as retryable model transport failure", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary({
		status: "failed",
		terminalStatus: "turn_failed",
		modelCalls: { requested: 1, completed: 0, failed: 1 },
		transport: {
			retries: 1,
			exhausted: 1,
			lastStatus: 504,
			lastMessage: "Retries exhausted",
		},
		transportTimeline: [
			{
				type: "request_exhausted",
				step: 1,
				attempt: 4,
				maxAttempts: 4,
				httpStatus: 504,
				message: "Retries exhausted",
			},
		],
		errors: ["504 Gateway Timeout"],
	}));

	assert.equal(snapshot.status, "failed");
	assert.equal(snapshot.failure?.class, "model_transport");
	assert.equal(snapshot.failure?.retryable, true);
	assert.equal(snapshot.failure?.recoverable, true);
	const transportItem = snapshot.items.find((item) => item.kind === "transport");
	assert.equal(transportItem?.status, "failed");
	assert.equal(transportItem?.rawEventType, "request_exhausted");
	assert.match(transportItem?.detail ?? "", /attempt 4\/4/);
});

test("projectReplaySummary prefers task waiting states over open terminal status", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary({
		status: "open",
		terminalStatus: "open",
		transport: { retries: 1, exhausted: 0, lastStatus: 504, lastMessage: "Retry scheduled" },
		transportTimeline: [
			{
				type: "retry_scheduled",
				step: 1,
				attempt: 1,
				maxAttempts: 4,
				delayMs: 700,
				httpStatus: 504,
				message: "Retry scheduled",
			},
		],
		taskTimeline: [
			{ taskId: "task-replay", event: "running", status: "running", summary: "Runtime started.", reason: "" },
			{
				taskId: "task-replay",
				event: "waiting_for_user",
				status: "waiting_for_user",
				summary: "Need more detail.",
				reason: "Clarification required.",
			},
		],
	}));

	assert.equal(snapshot.status, "waiting_for_user");
	assert.equal(snapshot.failure, undefined);
	assert.ok(snapshot.items.some((item) => item.kind === "task" && item.status === "waiting"));
	assert.ok(snapshot.items.some((item) => item.kind === "transport" && item.status === "running"));
});

test("projector derives trajectory actions from running failed approval mutation and replay states", async () => {
	const { projectRuntimeProgress, projectReplaySummary } = await loadProjector();

	const running = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-running" },
	]);
	assert.deepEqual(running.actions.map((action) => [action.id, action.enabled]), [["cancel", true]]);

	const failed = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-failed-action" },
		{ phase: "error", depth: 0, message: "Runtime failed." },
	]);
	assert.ok(failed.actions.some((action) => action.id === "retry" && action.enabled));

	const approval = projectRuntimeProgress([
		{ phase: "start", depth: 0, message: "Runtime started.", turnId: "turn-approval-action" },
		{ phase: "tool_approval", depth: 0, step: 1, tool: "write", targetPath: "Notes/today.md", message: "Approve write." },
	]);
	assert.deepEqual(approval.actions.map((action) => action.id), ["approve", "reject"]);
	assert.ok(approval.actions.every((action) => !action.enabled && action.reason));

	const mutation = projectReplaySummary(makeReplaySummary({
		status: "open",
		terminalStatus: "open",
		mutationTimeline: [
			{
				id: "plan-pending",
				event: "planned",
				operation: "edit",
				targetPath: "Notes/today.md",
				status: "pending_review",
				summary: "Review note update.",
				reason: "",
			},
		],
	}));
	assert.deepEqual(mutation.actions.map((action) => [action.id, action.targetId]), [
		["cancel", "task-replay"],
		["apply", "plan-pending"],
		["reject", "plan-pending"],
	]);

	const completed = projectReplaySummary(makeReplaySummary());
	assert.deepEqual(completed.actions.map((action) => action.id), ["view_replay"]);
});
