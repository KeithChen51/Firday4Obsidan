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
		modelCalls: { requested: 1, completed: 1, failed: 0 },
		toolEvents: { requested: 1, completed: 1, failed: 0, denied: 0 },
		toolCalls: [
			{ step: 1, tool: "read", toolCallId: "tool-1", status: "ok", targetPath: "Notes/today.md" },
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
			},
			{
				id: "plan-1",
				event: "applied",
				operation: "edit",
				targetPath: "Notes/today.md",
				status: "applied",
				summary: "Applied note update.",
				reason: "Approved by user.",
			},
		],
		taskTimeline: [
			{ taskId: "task-replay", event: "created", status: "created", summary: "Task created.", reason: "" },
			{ taskId: "task-replay", event: "running", status: "running", summary: "Runtime started.", reason: "" },
			{ taskId: "task-replay", event: "completed", status: "completed", summary: "Task completed.", reason: "" },
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
		},
		{ phase: "context", depth: 0, contextKey: "instructions", message: "Loaded project rules." },
		{ phase: "model_request", depth: 0, step: 1, message: "Requesting model decision." },
		{ phase: "model_response", depth: 0, step: 1, message: "Model decision received." },
		{ phase: "tool_call", depth: 0, step: 1, tool: "read", targetPath: "Notes/today.md", message: "Reading note." },
		{
			phase: "tool_result",
			depth: 0,
			step: 1,
			tool: "read",
			targetPath: "Notes/today.md",
			status: "ok",
			summary: "Read note summary.",
			message: "Read complete.",
		},
		{ phase: "done", depth: 0, message: "Runtime finished." },
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
	assert.equal(snapshot.privacy.source, "live");
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
	assert.ok(snapshot.items.some((item) => item.kind === "tool" && item.tool === "read" && item.status === "ok"));
	assert.ok(snapshot.items.some((item) => item.kind === "mutation" && item.actionRef === "plan-1"));
	assert.ok(snapshot.items.some((item) => item.kind === "task" && item.status === "ok"));
	assert.deepEqual(snapshot.mutations.map((mutation) => mutation.event), ["planned", "applied"]);
});

test("projectReplaySummary maps failed cancelled and safe stopped terminal states", async () => {
	const { projectReplaySummary } = await loadProjector();

	assert.equal(projectReplaySummary(makeReplaySummary({ status: "failed", terminalStatus: "turn_failed", errors: ["Model failed."] })).status, "failed");
	assert.equal(projectReplaySummary(makeReplaySummary({ status: "cancelled", terminalStatus: "turn_cancelled", errors: ["User cancelled."] })).status, "cancelled");
	assert.equal(projectReplaySummary(makeReplaySummary({ status: "safe_stopped", terminalStatus: "turn_completed" })).status, "safe_stopped");
});

test("projectReplaySummary prefers task waiting states over open terminal status", async () => {
	const { projectReplaySummary } = await loadProjector();

	const snapshot = projectReplaySummary(makeReplaySummary({
		status: "open",
		terminalStatus: "open",
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
