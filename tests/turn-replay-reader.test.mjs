/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const logPath = path.join(projectRoot, "src/core/runtime/TurnEventLog.ts");
const readerPath = path.join(projectRoot, "src/core/runtime/TurnReplayReader.ts");

async function loadModules() {
	const [logModule, readerModule] = await Promise.all([
		jiti.import(logPath),
		jiti.import(readerPath),
	]);
	return {
		TurnEventLog: logModule.TurnEventLog,
		TurnReplayReader: readerModule.TurnReplayReader,
	};
}

function resolveTurnPath(root) {
	return ({ conversationId, turnId }) =>
		path.join(root, "runtime", "conversations", conversationId, "turns", `${turnId}.jsonl`);
}

test("TurnReplayReader reads a turn, validates order, and returns a summary", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-1" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "model_requested", payload: { step: 1 } },
		{ type: "model_completed", payload: { step: 1 } },
		{ type: "tool_requested", payload: { step: 1, tool: "read", toolCallId: "tool-1" } },
		{ type: "tool_policy_checked", payload: { step: 1, tool: "read", decision: "allow" } },
		{ type: "tool_completed", payload: { step: 1, tool: "read", toolCallId: "tool-1", status: "ok" } },
		{ type: "assistant_final", payload: { summary: "Answered from the note." } },
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const events = await reader.readTurn(ref);
	const validation = reader.validateOrder(events);
	const summary = reader.summarize(events);

	assert.equal(validation.ok, true);
	assert.deepEqual(validation.errors, []);
	assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
	assert.equal(summary.conversationId, "agent");
	assert.equal(summary.turnId, "turn-1");
	assert.equal(summary.totalEvents, 8);
	assert.equal(summary.status, "completed");
	assert.equal(summary.modelCalls.requested, 1);
	assert.equal(summary.modelCalls.completed, 1);
	assert.equal(summary.modelCalls.failed, 0);
	assert.equal(summary.toolEvents.completed, 1);
	assert.equal(summary.toolEvents.failed, 0);
	assert.equal(summary.toolEvents.denied, 0);
	assert.equal(summary.approvals.requested, 0);
	assert.equal(summary.approvals.resolved, 0);
	assert.equal(summary.mutations.planned, 0);
	assert.equal(summary.finalAnswerSummary, "Answered from the note.");
	assert.equal(summary.terminalStatus, "turn_completed");
	assert.equal(summary.startedAt, events[0].at);
	assert.equal(summary.updatedAt, events[7].at);
	assert.equal(summary.completedAt, events[7].at);
	assert.ok(summary.durationMs >= 0);
	assert.deepEqual(summary.toolCalls, [
		{ step: 1, tool: "read", toolCallId: "tool-1", status: "ok", targetPath: "", at: events[3].at },
	]);
	assert.deepEqual(summary.eventTypes, [
		"turn_started",
		"model_requested",
		"model_completed",
		"tool_requested",
		"tool_policy_checked",
		"tool_completed",
		"assistant_final",
		"turn_completed",
	]);
});

test("TurnReplayReader summarizes safe reasoning metadata and does not persist raw CoT", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-reasoning-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-reasoning" };
	const rawCot = "raw chain of thought that ordinary replay must not store";

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "model_requested", payload: { step: 1 } },
		{
			type: "model_completed",
			payload: {
				step: 1,
				hasReasoning: true,
				reasoningProvider: "deepseek",
				reasoningRawFormat: "reasoning_content",
				reasoningContinuationPolicy: "drop",
				reasoningVisibleSummary: "Checked the current workspace before answering.",
				reasoningWarnings: ["raw reasoning dropped from replay"],
				rawReasoning: rawCot,
				reasoningContent: rawCot,
			},
		},
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const events = await reader.readTurn(ref);
	assert.equal(JSON.stringify(events).includes(rawCot), false);
	const summary = reader.summarize(events);

	assert.deepEqual(summary.reasoningTimeline, [
		{
			step: 1,
			provider: "deepseek",
			rawFormat: "reasoning_content",
			continuationPolicy: "drop",
			visibleSummary: "Checked the current workspace before answering.",
			warnings: ["raw reasoning dropped from replay"],
			at: events[2].at,
		},
	]);
	assert.equal(JSON.stringify(summary).includes(rawCot), false);
});

test("TurnReplayReader restores user-visible narration timeline without raw reasoning", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-narration-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-narration" };
	const rawCot = "raw hidden model thinking must not be replayed";

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{
			type: "narration_report",
			payload: {
				kind: "task_acknowledged",
				summary: "收到任务，正在确认目标。",
				understanding: "需要把过程叙事放进线性时间线。",
				source: "fallback",
				rawReasoning: rawCot,
			},
		},
		{
			type: "narration_report",
			payload: {
				kind: "plan_declared",
				summary: "先确认上下文，再执行修改。",
				plan: ["读取相关代码", "补测试", "实现事件链路"],
				source: "fallback",
			},
		},
		{
			type: "narration_report",
			payload: {
				kind: "stage_report",
				summary: "已读取相关文件，接下来实现事件链路。",
				justDone: "已读取相关文件",
				next: "接下来实现事件链路",
				source: "model",
				status: "running",
			},
		},
		{ type: "assistant_final", payload: { summary: "完成。" } },
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const events = await reader.readTurn(ref);
	assert.equal(JSON.stringify(events).includes(rawCot), false);
	const summary = reader.summarize(events);

	assert.deepEqual(summary.narrationTimeline.map((item) => item.kind), [
		"task_acknowledged",
		"plan_declared",
		"stage_report",
	]);
	assert.deepEqual(summary.narrationTimeline[0], {
		kind: "task_acknowledged",
		summary: "收到任务，正在确认目标。",
		understanding: "需要把过程叙事放进线性时间线。",
		source: "fallback",
		at: events[1].at,
	});
	assert.deepEqual(summary.narrationTimeline[1].plan, ["读取相关代码", "补测试", "实现事件链路"]);
	assert.equal(summary.narrationTimeline[2].justDone, "已读取相关文件");
	assert.equal(summary.narrationTimeline[2].next, "接下来实现事件链路");
	assert.equal(JSON.stringify(summary).includes(rawCot), false);
});

test("TurnReplayReader restores intake decisions and plan state timeline", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-plan-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-plan" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{
			type: "intake_decision",
			payload: {
				complexity: "complex",
				route: "plan_and_execute",
				statement: "我理解你希望优化 FRIDAY 的过程展示。",
				requiresPlan: true,
				source: "fallback",
			},
		},
		{
			type: "plan_create",
			payload: {
				type: "plan_create",
				state: {
					planId: "plan-turn-plan",
					visibility: "task_bar",
					status: "running",
					currentTaskId: "plan-turn-plan-1",
					tasks: [
						{ id: "plan-turn-plan-1", title: "确认现状", status: "in_progress" },
						{ id: "plan-turn-plan-2", title: "实现展示", status: "pending" },
					],
				},
			},
		},
		{
			type: "plan_complete",
			payload: {
				type: "plan_complete",
				state: {
					planId: "plan-turn-plan",
					visibility: "task_bar",
					status: "completed",
					currentTaskId: "plan-turn-plan-2",
					tasks: [
						{ id: "plan-turn-plan-1", title: "确认现状", status: "completed" },
						{ id: "plan-turn-plan-2", title: "实现展示", status: "completed" },
					],
				},
			},
		},
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const events = await reader.readTurn(ref);
	const summary = reader.summarize(events);

	assert.deepEqual(summary.intakeTimeline.map((item) => item.statement), [
		"我理解你希望优化 FRIDAY 的过程展示。",
	]);
	assert.equal(summary.intakeTimeline[0]?.interactionRoute, "task_with_process");
	assert.equal(summary.intakeTimeline[0]?.requiresPlan, true);
	assert.deepEqual(summary.planTimeline.map((item) => item.type), ["plan_create", "plan_complete"]);
	assert.equal(summary.planTimeline.at(-1)?.state.status, "completed");
	assert.deepEqual(summary.planTimeline.at(-1)?.state.tasks.map((task) => [task.title, task.status]), [
		["确认现状", "completed"],
		["实现展示", "completed"],
	]);
});

test("TurnReplayReader restores visible/internal plan revise and skip payloads", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-plan-protocol-"));
	const resolvePath = resolveTurnPath(root);
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });
	const ref = { conversationId: "agent", turnId: "turn-plan-protocol" };

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{
			type: "plan_create",
			payload: {
				type: "plan_create",
				reason: "Complex task.",
				state: {
					planId: "plan-protocol",
					visibility: "visible",
					status: "running",
					currentTaskId: "plan-protocol-1",
					tasks: [
						{ id: "plan-protocol-1", title: "Gather evidence", status: "in_progress" },
						{ id: "plan-protocol-2", title: "Patch runtime", status: "pending" },
					],
				},
			},
		},
		{
			type: "plan_revise",
			payload: {
				type: "plan_revise",
				reason: "Scope changed.",
				changes: [
					{ type: "rename", taskId: "plan-protocol-1", title: "Confirm evidence" },
					{ type: "status", taskId: "plan-protocol-2", status: "blocked" },
				],
				state: {
					planId: "plan-protocol",
					visibility: "visible",
					status: "running",
					currentTaskId: "plan-protocol-1",
					tasks: [
						{ id: "plan-protocol-1", title: "Confirm evidence", status: "in_progress" },
						{ id: "plan-protocol-2", title: "Patch runtime", status: "blocked" },
					],
				},
			},
		},
		{
			type: "plan_skip",
			payload: {
				type: "plan_skip",
				reason: "Resolved without a visible plan.",
				state: {
					planId: "plan-protocol",
					visibility: "internal",
					status: "skipped",
					currentTaskId: "plan-protocol-1",
					tasks: [
						{ id: "plan-protocol-1", title: "Confirm evidence", status: "skipped" },
						{ id: "plan-protocol-2", title: "Patch runtime", status: "blocked" },
					],
				},
			},
		},
		{ type: "turn_completed", payload: { status: "completed" } },
	]);

	const summary = reader.summarize(await reader.readTurn(ref));

	assert.deepEqual(summary.planTimeline.map((item) => item.type), ["plan_create", "plan_revise", "plan_skip"]);
	assert.equal(summary.planTimeline[0]?.state.visibility, "visible");
	assert.equal(summary.planTimeline[1]?.reason, "Scope changed.");
	assert.deepEqual(summary.planTimeline[1]?.changes, [
		{ type: "rename", taskId: "plan-protocol-1", title: "Confirm evidence" },
		{ type: "status", taskId: "plan-protocol-2", status: "blocked" },
	]);
	assert.equal(summary.planTimeline[1]?.state.tasks[1]?.status, "blocked");
	assert.equal(summary.planTimeline[2]?.reason, "Resolved without a visible plan.");
	assert.equal(summary.planTimeline[2]?.state.visibility, "internal");
	assert.equal(summary.planTimeline[2]?.state.status, "skipped");
});

test("TurnReplayReader reports sequence gaps and late events after a terminal event", async () => {
	const { TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const reader = new TurnReplayReader({ resolveTurnPath: resolveTurnPath(root) });

	const validation = reader.validateOrder([
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 3,
			type: "turn_completed",
			at: "2026-04-30T00:00:01.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-bad",
			sequence: 4,
			type: "tool_requested",
			at: "2026-04-30T00:00:02.000Z",
			payload: { tool: "read" },
		},
	]);

	assert.equal(validation.ok, false);
	assert.ok(validation.errors.some((error) => error.includes("sequence 2")));
	assert.ok(validation.errors.some((error) => error.includes("terminal event")));
});

test("TurnReplayReader summarizes failed cancelled safe-stopped approval and mutation events", async () => {
	const { TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-"));
	const reader = new TurnReplayReader({ resolveTurnPath: resolveTurnPath(root) });

	const failed = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 2,
			type: "model_failed",
			at: "2026-04-30T00:00:01.000Z",
			payload: {
				error: "504 gateway timeout",
				failureClass: "transport_unstable",
				recoverable: true,
				retryable: true,
			},
		},
		{
			conversationId: "agent",
			turnId: "turn-failed",
			sequence: 3,
			type: "turn_failed",
			at: "2026-04-30T00:00:02.000Z",
			payload: {
				error: "504 gateway timeout",
				failureClass: "transport_unstable",
				recoverable: true,
				retryable: true,
			},
		},
	]);
	assert.equal(failed.status, "failed");
	assert.equal(failed.modelCalls.failed, 1);
	assert.deepEqual(failed.errors, ["504 gateway timeout", "504 gateway timeout"]);

	const rich = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 2,
			type: "tool_approval_requested",
			at: "2026-04-30T00:00:01.000Z",
			payload: { step: 1, tool: "write" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 3,
			type: "tool_approval_resolved",
			at: "2026-04-30T00:00:02.000Z",
			payload: { step: 1, tool: "write", approved: true },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 4,
			type: "mutation_planned",
			at: "2026-04-30T00:00:03.000Z",
			payload: { id: "plan-1", targetPath: "a.md" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 5,
			type: "mutation_applied",
			at: "2026-04-30T00:00:04.000Z",
			payload: { id: "plan-1", targetPath: "a.md" },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 6,
			type: "mutation_conflicted",
			at: "2026-04-30T00:00:04.500Z",
			payload: { id: "plan-2", targetPath: "b.md", reason: "Before snapshot changed." },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 7,
			type: "mutation_apply_failed",
			at: "2026-04-30T00:00:04.700Z",
			payload: { id: "plan-3", operation: "write", targetPath: "c.md", error: "Disk write failed." },
		},
		{
			conversationId: "agent",
			turnId: "turn-rich",
			sequence: 8,
			type: "turn_completed",
			at: "2026-04-30T00:00:05.000Z",
			payload: { status: "safe_stopped" },
		},
	]);
	assert.equal(rich.status, "safe_stopped");
	assert.equal(rich.approvals.requested, 1);
	assert.equal(rich.approvals.resolved, 1);
	assert.equal(rich.mutations.planned, 1);
	assert.equal(rich.mutations.applied, 1);
	assert.equal(rich.mutations.conflicted, 1);
	assert.equal(rich.mutations.applyFailed, 1);
	assert.deepEqual(rich.mutationTimeline, [
		{ id: "plan-1", event: "planned", operation: "", targetPath: "a.md", status: "", summary: "", reason: "", at: "2026-04-30T00:00:03.000Z" },
		{ id: "plan-1", event: "applied", operation: "", targetPath: "a.md", status: "", summary: "", reason: "", at: "2026-04-30T00:00:04.000Z" },
		{ id: "plan-2", event: "conflicted", operation: "", targetPath: "b.md", status: "", summary: "", reason: "Before snapshot changed.", at: "2026-04-30T00:00:04.500Z" },
		{ id: "plan-3", event: "apply_failed", operation: "write", targetPath: "c.md", status: "", summary: "", reason: "Disk write failed.", at: "2026-04-30T00:00:04.700Z" },
	]);
	assert.equal(rich.durationMs, 5000);

	const cancelled = reader.summarize([
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 2,
			type: "turn_cancelled",
			at: "2026-04-30T00:00:01.000Z",
			payload: { summary: "User cancelled." },
		},
	]);
	assert.equal(cancelled.status, "cancelled");
	assert.equal(reader.validateOrder([
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 1,
			type: "turn_started",
			at: "2026-04-30T00:00:00.000Z",
			payload: {},
		},
		{
			conversationId: "agent",
			turnId: "turn-cancelled",
			sequence: 2,
			type: "turn_cancelled",
			at: "2026-04-30T00:00:01.000Z",
			payload: { summary: "User cancelled." },
		},
	]).ok, true);
});

test("TurnReplayReader summarizes task lifecycle timeline", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-task-"));
	const resolvePath = resolveTurnPath(root);
	const ref = { conversationId: "agent", turnId: "turn-task", taskId: "task-1" };
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { summary: "Runtime started" } },
		{ type: "task_created", payload: { taskId: "task-1", status: "created", summary: "Task created." } },
		{ type: "task_running", payload: { taskId: "task-1", status: "running", summary: "Runtime started." } },
		{ type: "task_waiting_for_approval", payload: { taskId: "task-1", status: "waiting_for_approval", summary: "Review changes." } },
		{ type: "task_cancelled", payload: { taskId: "task-1", status: "cancelled", summary: "User cancelled." } },
		{ type: "turn_cancelled", payload: { summary: "User cancelled." } },
	]);

	const summary = await reader.readSummary(ref);
	assert.equal(summary.status, "cancelled");
	const taskTimelineWithoutAt = summary.taskTimeline.map((entry) => {
		const { at, ...item } = entry;
		assert.ok(at, "task timeline should preserve event timestamps");
		return item;
	});
	assert.deepEqual(taskTimelineWithoutAt, [
		{ taskId: "task-1", event: "created", status: "created", summary: "Task created.", reason: "" },
		{ taskId: "task-1", event: "running", status: "running", summary: "Runtime started.", reason: "" },
		{ taskId: "task-1", event: "waiting_for_approval", status: "waiting_for_approval", summary: "Review changes.", reason: "" },
		{ taskId: "task-1", event: "cancelled", status: "cancelled", summary: "User cancelled.", reason: "" },
	]);
});

test("TurnReplayReader preserves trace and agent identity from replay payloads", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-identity-"));
	const resolvePath = resolveTurnPath(root);
	const ref = { conversationId: "agent", turnId: "turn-identity", taskId: "task-identity" };
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });

	await log.appendMany(ref, [
		{ type: "turn_started", payload: { traceId: "trace-identity", agentId: "soul-1" } },
		{ type: "model_requested", payload: { step: 1, traceId: "trace-identity" } },
		{ type: "turn_completed", payload: { status: "completed", traceId: "trace-identity" } },
	]);

	const summary = await reader.readSummary(ref);
	assert.equal(summary.traceId, "trace-identity");
	assert.equal(summary.agentId, "soul-1");
});

test("TurnEventLog redacts headers and TurnReplayReader summarizes recovery and safe stops", async () => {
	const { TurnEventLog, TurnReplayReader } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-replay-hygiene-"));
	const resolvePath = resolveTurnPath(root);
	const ref = { conversationId: "agent", turnId: "turn-hygiene", taskId: "task-hygiene" };
	const log = new TurnEventLog({ resolveTurnPath: resolvePath });
	const reader = new TurnReplayReader({ resolveTurnPath: resolvePath });

	await log.appendMany(ref, [
		{
			type: "turn_started",
			payload: {
				traceId: "trace-hygiene",
				headers: { cookie: "session=secret-cookie", "x-extra": "header-value" },
				requestHeaders: { authorization: "Bearer secret-token-value" },
			},
		},
		{ type: "tool_requested", payload: { step: 1, tool: "read", toolCallId: "read-1" } },
		{
			type: "tool_failed",
			payload: {
				step: 1,
				tool: "read",
				toolCallId: "read-1",
				targetPath: "Project/notes/missing.md",
				failureClass: "path_resolution",
				recovery: {
					recoverable: true,
					retryable: true,
					code: "path_recovery_available",
					message: "Use the project-relative candidate path.",
					candidatePaths: ["Project/notes/missing.md"],
					suggestedArgs: { path: "Project/notes/missing.md" },
				},
			},
		},
		{
			type: "tool_failed",
			payload: {
				step: 2,
				tool: "read",
				toolCallId: "read-duplicate",
				failureClass: "duplicate_failed_tool_call",
				recovery: {
					recoverable: true,
					retryable: false,
					code: "duplicate_failed_tool_call",
					message: "Change the tool arguments before retrying.",
				},
			},
		},
		{
			type: "max_tool_iterations",
			payload: {
				channel: "native",
				maxIterations: 2,
				status: "safe_stopped",
				summary: "Stopped after repeated failed calls.",
			},
		},
		{ type: "turn_completed", payload: { status: "safe_stopped", summary: "Stopped safely." } },
	]);

	const events = await reader.readTurn(ref);
	const serializedEvents = JSON.stringify(events);
	assert.equal(serializedEvents.includes("secret-cookie"), false);
	assert.equal(serializedEvents.includes("header-value"), false);
	assert.equal(serializedEvents.includes("secret-token-value"), false);

	const summary = reader.summarize(events);
	assert.equal(summary.status, "safe_stopped");
	assert.deepEqual(summary.recoveryTimeline, [{
		event: "tool_failed",
		step: 1,
		tool: "read",
		toolCallId: "read-1",
		targetPath: "Project/notes/missing.md",
		failureClass: "path_resolution",
		recoverable: true,
		retryable: true,
		code: "path_recovery_available",
		message: "Use the project-relative candidate path.",
		candidatePaths: ["Project/notes/missing.md"],
		suggestedArgs: { path: "Project/notes/missing.md" },
		at: events[2].at,
	}]);
	assert.deepEqual(summary.loopPreventionTimeline, [
		{
			event: "duplicate_failed_tool_call",
			step: 2,
			tool: "read",
			toolCallId: "read-duplicate",
			status: "",
			summary: "Change the tool arguments before retrying.",
			at: events[3].at,
		},
		{
			event: "max_tool_iterations",
			step: 0,
			tool: "",
			toolCallId: "",
			status: "safe_stopped",
			summary: "Stopped after repeated failed calls.",
			at: events[4].at,
		},
	]);
});
