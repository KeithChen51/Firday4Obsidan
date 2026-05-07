/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const viewModelPath = path.join(projectRoot, "src/views/agentProcessPanelViewModel.ts");

async function loadViewModel() {
	return jiti.import(viewModelPath);
}

test("buildAgentProcessPanelViewModel classifies simple live answers as lightweight thinking", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Agent is reasoning",
		summary: "Thinking through the answer.",
		items: [
			makeItem({
				id: "model-1",
				kind: "model",
				title: "Model step 1",
				detail: "Thinking through the answer.",
				status: "running",
			}),
		],
	}));

	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.surface, "inline_thinking");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.header.headline, "FRIDAY 思考中");
	assert.equal(view.visibleSteps.length, 0);
	assert.equal("stages" in view, false);
	assert.equal("stepGroups" in view, false);
	assert.equal(view.evidence.length, 0);
	assert.equal(view.mutations.length, 0);
	assert.equal(view.recovery, null);
});

test("buildAgentProcessPanelViewModel uses live elapsed time for running process headers", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		time: {
			startedAt: "2026-05-05T00:00:00.000Z",
			updatedAt: "2026-05-05T00:00:01.000Z",
		},
		items: [
			makeItem({ id: "tool", kind: "tool", title: "Read Notes/Today.md", status: "running", tool: "read", targetPath: "Notes/Today.md" }),
		],
	}), { now: new Date("2026-05-05T00:00:03.000Z") });

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.durationSeconds, 3);
	assert.equal(view.hasExpandableContent, true);
	assert.equal(view.canExpand, true);
	assert.equal(view.header.headline, "FRIDAY 的工作过程 3s");
	assert.doesNotMatch(view.header.headline, />/);
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["读取上下文"]);
	assert.equal(view.visibleSteps[0]?.status, "running");
	assert.deepEqual(view.visibleSteps[0]?.fileRefs.map((file) => file.path), ["Notes/Today.md"]);
});

test("buildAgentProcessPanelViewModel exposes a running timeline view from the same snapshot data", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Agent is using a tool",
		summary: "Reading project notes.",
		time: {
			startedAt: "2026-05-06T00:00:00.000Z",
			updatedAt: "2026-05-06T00:00:11.000Z",
		},
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded project rules", detail: "Loaded AGENTS.md.", status: "ok", at: "2026-05-06T00:00:01.000Z" }),
			makeItem({ id: "tool", kind: "tool", title: "Read src/views/agentTrajectoryRenderer.ts", detail: "Read renderer state.", status: "running", tool: "read", targetPath: "src/views/agentTrajectoryRenderer.ts", at: "2026-05-06T00:00:10.000Z" }),
		],
	}), { now: new Date("2026-05-06T00:00:11.000Z") });

	assert.ok(view.timeline, "task work should expose timeline view");
	assert.equal(view.timeline.status, "running");
	assert.equal(view.timeline.title, "正在处理 11s");
	assert.equal(view.timeline.defaultExpanded, true);
	assert.equal(view.timeline.canExpand, true);
	assert.deepEqual(view.timeline.items.map((item) => item.kind), ["receipt", "context"]);
	assert.deepEqual(view.timeline.items.map((item) => item.title), ["收到任务", "读取项目现状"]);
	assert.equal(view.timeline.items[1]?.status, "running");
	assert.doesNotMatch(JSON.stringify(view.timeline.items), /Context|Tools|Review|Finalize|Listed \d+ item/);
});

test("buildAgentProcessPanelViewModel uses completed snapshot duration instead of falling back to zero", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		time: {
			startedAt: "2026-05-05T00:00:00.000Z",
			completedAt: "2026-05-05T00:00:07.000Z",
			durationMs: 7000,
		},
		items: [
			makeItem({ id: "tool", kind: "tool", title: "Read Notes/Today.md", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", status: "ok" }),
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.durationSeconds, 7);
	assert.equal(view.canExpand, true);
	assert.equal(view.header.headline, "FRIDAY 的工作过程 7s");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["读取上下文"]);
});

test("buildAgentProcessPanelViewModel reuses timeline items for completed replay", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		time: {
			startedAt: "2026-05-06T00:00:00.000Z",
			completedAt: "2026-05-06T00:02:11.000Z",
			durationMs: 131000,
		},
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded current note", detail: "Read visible context.", status: "ok", at: "2026-05-06T00:00:05.000Z" }),
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md", at: "2026-05-06T00:00:10.000Z" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered from the current note.", status: "ok", at: "2026-05-06T00:02:11.000Z" }),
		],
	}));

	assert.ok(view.timeline, "completed task replay should expose the same timeline contract");
	assert.equal(view.timeline.status, "completed");
	assert.equal(view.timeline.title, "已处理 2m 11s");
	assert.equal(view.timeline.defaultExpanded, false);
	assert.deepEqual(view.timeline.items.map((item) => item.kind), ["receipt", "context", "done"]);
	assert.deepEqual(view.timeline.items.map((item) => item.status), ["done", "done", "done"]);
	assert.equal(view.timeline.items.at(-1)?.title, "完成");
});

test("buildAgentProcessPanelViewModel hides simple completed answers without replay", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Answer finished",
		summary: "Answered directly.",
		items: [
			makeItem({ id: "model", kind: "model", title: "Model response", detail: "Answered directly.", status: "ok" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered directly.", status: "ok" }),
		],
	}));

	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, false);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.resultArtifacts.length, 0);
	assert.equal(view.diffSummary, null);
	assert.equal(view.visibleSteps.length, 0);
	assert.equal(view.timeline, null);
});

test("buildAgentProcessPanelViewModel hides lifecycle-only completed task replay", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "Final answer delivered.",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "task-created", kind: "task", title: "Task created", detail: "Task created.", status: "ok", rawEventType: "task_created" }),
			makeItem({ id: "task-running", kind: "task", title: "Task running", detail: "Runtime started.", status: "ok", rawEventType: "task_running" }),
			makeItem({ id: "task-completed", kind: "task", title: "Task completed", detail: "Final answer delivered.", status: "ok", rawEventType: "task_completed" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Final answer delivered.", status: "ok", rawEventType: "assistant_final" }),
		],
	}));

	assert.equal(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, false);
	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.visibleSteps.length, 0);
});

test("buildAgentProcessPanelViewModel keeps completed file or context reads as collapsed work process", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Answer finished",
		summary: "Answered from the current note.",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:04.000Z", durationMs: 4000 },
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded current note", detail: "Read visible context.", status: "ok" }),
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered from the current note.", status: "ok" }),
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.surface, "collapsed_completed_replay");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.hasExpandableContent, true);
	assert.equal(view.canExpand, true);
	assert.equal(view.durationSeconds, 4);
	assert.equal(view.header.headline, "FRIDAY 的工作过程 4s");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["读取上下文"]);
	assert.deepEqual(view.visibleSteps[0]?.actions.map((action) => action.label), [
		"Loaded current note",
		"Read Notes/Today.md",
	]);
});

test("buildAgentProcessPanelViewModel filters internal lifecycle task wording from visible process facts", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "Updated files.",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "task-running", kind: "task", title: "Task running", detail: "Runtime started for ask mode.", status: "ok", rawEventType: "task_running" }),
			makeItem({ id: "mutation", kind: "mutation", title: "Applied Notes/Updated.md", detail: "Updated file.", status: "ok", targetPath: "Notes/Updated.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Updated files.", status: "ok" }),
		],
		mutations: [
			{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Updated file.", reason: "" },
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.surface, "collapsed_completed_replay");
	assert.equal(view.hasExpandableContent, true);
	assert.equal(view.canExpand, true);
	assert.doesNotMatch(JSON.stringify(view), /Task running|Runtime started for ask mode/);
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["创建/修改文件"]);
});

test("buildAgentProcessPanelViewModel exposes running task focus summary and cancel action", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Agent is using a tool",
		summary: "Reading project notes.",
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded project rules", status: "ok" }),
			makeItem({ id: "tool", kind: "tool", title: "Read Notes/today.md", detail: "Reading project notes.", status: "running", tool: "read", targetPath: "Notes/today.md", step: 2 }),
		],
		actions: [
			{ id: "cancel", label: "Cancel", enabled: true, targetId: "task-1" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.surface, "compact_live_process");
	assert.equal(view.visibleSteps.at(-1)?.title, "读取上下文");
	assert.equal(view.visibleSteps.at(-1)?.status, "running");
	assert.match(view.header.summary, /Reading project notes/);
	assert.equal(view.actions[0]?.id, "cancel");
	assert.equal(view.actions[0]?.enabled, true);
	assert.equal(view.evidence[0]?.label, "Notes/today.md");
});

test("buildAgentProcessPanelViewModel prioritizes waiting approval state and action reasons", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "waiting_for_approval",
		headline: "Waiting for approval",
		summary: "Approve write.",
		items: [
			makeItem({ id: "approval", kind: "approval", title: "Approval required", detail: "Approve write.", status: "waiting", tool: "write", targetPath: "Notes/today.md" }),
		],
		actions: [
			{ id: "approve", label: "Approve", enabled: false, reason: "Use the approval controls.", targetId: "approval" },
			{ id: "reject", label: "Reject", enabled: false, reason: "Use the approval controls.", targetId: "approval" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.surface, "action_required");
	assert.equal(view.status.key, "waiting_for_approval");
	assert.equal(view.status.tone, "waiting");
	assert.equal(view.visibleSteps.at(-1)?.title, "等待确认文件修改");
	assert.equal(view.visibleSteps.at(-1)?.status, "waiting_for_approval");
	assert.deepEqual(view.visibleSteps.at(-1)?.actions.map((action) => action.label), [
		"查看改动",
		"Approve",
		"Reject",
	]);
	assert.equal(view.actions[0]?.reason, "Use the approval controls.");
});

test("buildAgentProcessPanelViewModel exposes retryable failure recovery", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		headline: "Agent failed",
		summary: "Tool failed.",
		failure: {
			class: "tool",
			message: "grep failed.",
			retryable: true,
			recoverable: true,
		},
		items: [
			makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "grep failed.", status: "failed" }),
		],
		actions: [
			{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
		],
	}));

	assert.equal(view.status.tone, "failed");
	assert.equal(view.surface, "compact_recovery");
	assert.equal(view.recovery?.title, "Recovery available");
	assert.match(view.recovery?.summary ?? "", /grep failed/);
	assert.equal(view.recovery?.retryable, true);
	assert.equal(view.actions[0]?.id, "retry");
	assert.equal(view.visibleSteps.at(-1)?.status, "retryable");
});

test("buildAgentProcessPanelViewModel exposes checkpoint resume recovery before retry", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		headline: "Agent failed",
		summary: "Model service unavailable.",
		failure: {
			class: "model_transport",
			message: "Model service unavailable.",
			retryable: true,
			recoverable: true,
		},
		items: [
			makeItem({
				id: "checkpoint",
				kind: "system",
				title: "Checkpoint saved",
				detail: "Stable tool result checkpoint.",
				status: "ok",
				rawEventType: "checkpoint_saved",
				actionRef: "checkpoint-1",
			}),
			makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "Model service unavailable.", status: "failed" }),
		],
		actions: [
			{ id: "resume", label: "Resume", enabled: true, targetId: "task-1" },
			{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
		],
	}));

	assert.equal(view.surface, "compact_recovery");
	assert.deepEqual(view.actions.map((action) => action.id), ["resume", "retry"]);
	assert.deepEqual(view.visibleSteps.at(-1)?.actions.map((action) => action.action?.id), ["resume", "retry"]);
	assert.match(JSON.stringify(view), /Stable tool result checkpoint/);
});

test("buildAgentProcessPanelViewModel renders transport retry without checkpoint resume claims", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Reconnecting to model",
		summary: "Model request retry scheduled after HTTP 504; attempt 1/4; backoff 700ms",
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "Model transport",
				detail: "Model request retry scheduled after HTTP 504; attempt 1/4; backoff 700ms",
				status: "running",
				rawEventType: "retry_scheduled",
				step: 3,
			}),
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.surface, "compact_live_process");
	assert.equal(view.status.tone, "reconnecting");
	assert.equal(view.visibleSteps.at(-1)?.title, "重新连接模型");
	assert.equal(view.visibleSteps.at(-1)?.status, "running");
	assert.match(view.header.summary, /attempt 1\/4/);
	assert.match(view.header.summary, /700ms/);
	assert.doesNotMatch(JSON.stringify(view), /checkpoint|resume/i);
	assert.ok(view.timeline);
	assert.equal(view.timeline.status, "retrying");
	assert.equal(view.timeline.collapsedSummary, "模型连接不稳定，正在恢复。");
	assert.equal(view.timeline.items.at(-1)?.kind, "retry");
	assert.equal(view.timeline.items.at(-1)?.title, "处理连接重试");
	assert.doesNotMatch(view.timeline.items.at(-1)?.summary ?? "", /HTTP|504|700ms|request/i);
});

test("buildAgentProcessPanelViewModel shows recoverable tool errors as a running warning", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Recovering from tool issue",
		summary: "Trying another path.",
		time: {
			startedAt: "2026-05-06T00:00:00.000Z",
			updatedAt: "2026-05-06T00:00:41.000Z",
		},
		items: [
			makeItem({ id: "read-failed", kind: "tool", title: "Read workspace/missing.md", detail: "read failed: file was not found.", status: "failed", tool: "read", targetPath: "workspace/missing.md", step: 1 }),
			makeItem({ id: "ls-running", kind: "tool", title: "List Project", detail: "Trying another path.", status: "running", tool: "ls", targetPath: "Project", step: 2 }),
		],
	}), { now: new Date("2026-05-06T00:00:42.000Z") });

	assert.equal(view.status.tone, "running");
	assert.equal(view.timeline?.status, "recovering");
	assert.equal(view.timeline?.title, "执行遇到问题，正在换一种方式继续 · 42s");
	assert.match(view.timeline?.collapsedSummary ?? "", /正在换一种方式继续/);
	assert.equal(view.recovery, null);
	assert.equal(view.visibleSteps.some((step) => step.status === "failed" || step.status === "retryable"), false);
});

test("buildAgentProcessPanelViewModel groups process details by user-visible phase", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "FRIDAY 正在处理",
		summary: "正在读取项目文件。",
		time: {
			startedAt: "2026-05-06T00:00:00.000Z",
			updatedAt: "2026-05-06T00:00:12.000Z",
		},
		items: [
			makeItem({ id: "ack", kind: "narration", title: "收到任务", detail: "我会先理解你的需求。", status: "ok", rawEventType: "narration_report", narrationKind: "task_acknowledged" }),
			makeItem({ id: "plan", kind: "narration", title: "整理方案", detail: "先看文件，再更新内容。", status: "ok", rawEventType: "narration_report", narrationKind: "plan_declared" }),
			makeItem({ id: "read", kind: "tool", title: "Read Project/a.md", detail: "读取参考文件。", status: "running", tool: "read", targetPath: "Project/a.md" }),
		],
	}), { now: new Date("2026-05-06T00:00:12.000Z") });

	assert.ok(view.timeline);
	assert.ok(view.timeline?.statusBar);
	assert.equal(view.timeline?.statusBar.phase, "执行");
	assert.equal(view.timeline?.statusBar.action, "读取项目现状");
	assert.equal(view.timeline?.statusBar.elapsed, "12s");
	assert.deepEqual(view.timeline?.groups.map((group) => group.title), ["收到任务", "计划", "执行"]);
	assert.deepEqual(view.timeline?.groups.map((group) => group.defaultExpanded), [false, false, true]);
	assert.equal(view.timeline?.groups[2]?.items.length, 1);
});

test("buildAgentProcessPanelViewModel exposes completed replay summary and evidence strip", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "Created a sourced answer.",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", detail: "Updated note.", status: "ok", targetPath: "Notes/A.md", step: 1 }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Created a sourced answer.", status: "ok" }),
		],
		mutations: [
			{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.surface, "collapsed_completed_replay");
	assert.match(view.header.headline, /^FRIDAY 的工作过程 \d+s$/);
	assert.doesNotMatch(view.header.headline, />/);
	assert.equal(view.hasExpandableContent, true);
	assert.equal(view.canExpand, true);
	assert.equal(view.evidence[0]?.label, "Notes/A.md");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["创建/修改文件"]);
});

test("buildAgentProcessPanelViewModel exposes result artifacts and excludes pending or read-only files", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "Updated files.",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Reference.md", status: "ok", tool: "read", targetPath: "Notes/Reference.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Updated files.", status: "ok" }),
		],
		mutations: [
			{ id: "pending", event: "planned", operation: "edit", targetPath: "Notes/Pending.md", status: "pending", summary: "Pending edit.", reason: "" },
			{ id: "applied-md", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Updated note.", reason: "" },
			{ id: "applied-canvas", event: "applied", operation: "write", targetPath: "Maps/Project.canvas", status: "applied", summary: "Updated canvas.", reason: "" },
		],
	}));

	assert.deepEqual(view.resultArtifacts.map((artifact) => artifact.path), [
		"Notes/Updated.md",
		"Maps/Project.canvas",
	]);
	assert.deepEqual(view.resultArtifacts.map((artifact) => artifact.metadata), [
		"文档 · MD",
		"画布 · Canvas",
	]);
	assert.equal(view.diffSummary?.changedFiles, 2);
	assert.match(view.diffSummary?.summary ?? "", /2 个文件已修改/);
	assert.doesNotMatch(JSON.stringify(view.resultArtifacts), /Pending|Reference/);
	assert.ok(view.timeline);
	assert.deepEqual(view.timeline.finalArtifacts.map((artifact) => artifact.path), [
		"Notes/Updated.md",
		"Maps/Project.canvas",
	]);
	assert.equal(JSON.stringify(view.timeline.finalArtifacts).includes("Notes/Pending.md"), false);
});

test("buildAgentProcessPanelViewModel uses approved FRIDAY process labels with duration", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const taskView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded AGENTS", status: "ok", at: "2026-05-04T00:00:00.000Z" }),
			makeItem({ id: "tool", kind: "tool", title: "Read plan", status: "running", targetPath: "docs/plan.md", at: "2026-05-04T00:00:06.000Z" }),
		],
	}));

	assert.equal(taskView.durationSeconds, 6);
	assert.equal(taskView.header.headline, "FRIDAY 的工作过程 6s");
	assert.doesNotMatch(taskView.header.headline, />/);

	const reasoningView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded project rules", status: "ok", at: "2026-05-04T00:00:00.000Z" }),
			makeItem({ id: "model", kind: "model", title: "Reasoned over context", status: "ok", at: "2026-05-04T00:00:04.000Z" }),
			makeItem({ id: "final", kind: "final", title: "Final response", status: "ok", at: "2026-05-04T00:00:06.000Z" }),
		],
	}));

	assert.equal(reasoningView.durationSeconds, 6);
	assert.equal(reasoningView.mode, "completed_replay");
	assert.equal(reasoningView.surface, "collapsed_completed_replay");
	assert.equal(reasoningView.shouldRenderProcessPanel, true);
	assert.equal(reasoningView.hasExpandableContent, true);
	assert.equal(reasoningView.canExpand, true);
	assert.equal(reasoningView.header.headline, "FRIDAY 的思路 6s");
});

test("buildAgentProcessPanelViewModel exposes mutation conflict and apply failure strips", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		mutations: [
			{ id: "m1", event: "conflicted", operation: "edit", targetPath: "Notes/A.md", status: "conflicted", summary: "External edit found.", reason: "File changed." },
			{ id: "m2", event: "apply_failed", operation: "write", targetPath: "Notes/B.md", status: "failed", summary: "Write failed.", reason: "Permission denied." },
		],
		items: [
			makeItem({ id: "mutation-1", kind: "mutation", title: "edit Notes/A.md", detail: "External edit found.", status: "failed", targetPath: "Notes/A.md" }),
		],
	}));

	assert.equal(view.mutations.length, 2);
	assert.deepEqual(view.mutations.map((item) => item.event), ["conflicted", "apply_failed"]);
	assert.equal(view.mutations[0]?.tone, "failed");
	assert.equal(view.recovery?.title, "文件改动需要处理");
	assert.ok(view.visibleSteps.some((step) => step.status === "retryable" || step.status === "failed"));
});

test("buildAgentProcessPanelViewModel builds progressive visible steps from actual events only", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "ctx", kind: "context", title: "Loaded memory", detail: "Memory context.", status: "ok", rawEventType: "memory" }),
			makeItem({ id: "model", kind: "model", title: "Model step 1", detail: "Deciding next step.", status: "ok", step: 1 }),
			makeItem({ id: "tool", kind: "tool", title: "Search project", detail: "Found matches.", status: "ok", tool: "search", targetPath: "Notes", step: 1 }),
			makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", detail: "Prepared edit.", status: "waiting", targetPath: "Notes/A.md", step: 2 }),
		],
		mutations: [
			{ id: "m1", event: "planned", operation: "edit", targetPath: "Notes/A.md", status: "pending", summary: "Prepared edit.", reason: "" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal("stages" in view, false);
	assert.equal("stepGroups" in view, false);
	assert.deepEqual(view.visibleSteps.map((step) => step.title), [
		"读取上下文",
		"等待确认文件修改",
	]);
	assert.equal(view.visibleSteps[0]?.status, "completed");
	assert.equal(view.visibleSteps[1]?.status, "waiting_for_approval");
	assert.deepEqual(view.visibleSteps[0]?.actions.map((action) => action.label), [
		"Loaded memory",
		"Model step 1",
		"Search project",
	]);
	assert.deepEqual(view.visibleSteps[1]?.fileRefs.map((file) => file.path), ["Notes/A.md"]);
	assert.doesNotMatch(JSON.stringify(view.visibleSteps), /Finalize|Future|pending future/i);
});

test("buildAgentProcessPanelViewModel shows acknowledged task, plan, and stage reports as real timeline steps", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "FRIDAY 正在处理",
		summary: "已读取相关文件，接下来实现事件链路。",
		items: [
			makeItem({
				id: "narration-ack",
				kind: "narration",
				title: "收到任务",
				detail: "需要把过程叙事放进线性时间线。",
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "task_acknowledged",
				narrationSource: "fallback",
			}),
			makeItem({
				id: "narration-plan",
				kind: "narration",
				title: "整理方案",
				detail: "先确认上下文，再执行修改。",
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "plan_declared",
				narrationPlan: ["读取相关代码", "补测试", "实现事件链路"],
				narrationSource: "fallback",
			}),
			makeItem({
				id: "narration-stage",
				kind: "narration",
				title: "阶段性汇报",
				detail: "已读取相关文件，接下来实现事件链路。",
				status: "running",
				rawEventType: "narration_report",
				narrationKind: "stage_report",
				narrationJustDone: "已读取相关文件",
				narrationNext: "接下来实现事件链路",
				narrationSource: "model",
			}),
			makeItem({
				id: "read",
				kind: "tool",
				title: "Read src/views/agentProcessPanelViewModel.ts",
				detail: "Read process view model.",
				status: "ok",
				tool: "read",
				targetPath: "src/views/agentProcessPanelViewModel.ts",
			}),
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), [
		"收到任务",
		"整理方案",
		"阶段性汇报",
		"读取上下文",
	]);
	assert.deepEqual(view.timeline?.items.map((item) => item.title), [
		"收到任务",
		"整理方案",
		"阶段性汇报",
		"读取项目现状",
	]);
	assert.equal(view.timeline?.items[0]?.summary, "需要把过程叙事放进线性时间线。");
	assert.equal(view.timeline?.items[1]?.detail?.lines[0], "读取相关代码");
	assert.equal(view.timeline?.items[2]?.summary, "已读取相关文件，接下来实现事件链路。");
	assert.doesNotMatch(JSON.stringify(view.timeline), /context_ready|Context|Reasoning|Tools|Review|Finalize/);
});

test("buildAgentProcessPanelViewModel renders reasoning artifacts as visible summary only", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const rawCot = "raw chain of thought must never render";

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:08.000Z", durationMs: 8000 },
		summary: "Final answer.",
		items: [
			makeItem({
				id: "reasoning",
				kind: "reasoning",
				title: "FRIDAY 的思路",
				detail: "Checked the user goal and available context.",
				status: "ok",
				rawEventType: "model_response",
				reasoningProvider: "deepseek",
				reasoningRawFormat: "reasoning_content",
				rawReasoning: rawCot,
			}),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Final answer.", status: "ok" }),
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.surface, "collapsed_completed_replay");
	assert.equal(view.canExpand, true);
	assert.equal(view.header.headline, "FRIDAY 的思路 8s");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["FRIDAY 的思路"]);
	assert.deepEqual(view.visibleSteps[0]?.actions.map((action) => action.label), ["FRIDAY 的思路"]);
	assert.match(view.visibleSteps[0]?.summary ?? "", /Checked the user goal/);
	assert.equal(JSON.stringify(view).includes(rawCot), false);
	assert.doesNotMatch(JSON.stringify(view), /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
});

test("buildAgentProcessPanelViewModel keeps technical detail from repeating the visible summary", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({
				id: "reasoning",
				kind: "reasoning",
				title: "FRIDAY reasoning",
				detail: "Checked the request and selected the document update path.",
				status: "ok",
				rawEventType: "model_response",
			}),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Done.", status: "ok" }),
		],
	}));

	const reasoningItem = view.timeline?.items.find((item) => item.kind === "reasoning");
	assert.ok(reasoningItem, "reasoning timeline item should exist");
	assert.equal(reasoningItem.summary, "Checked the request and selected the document update path.");
	assert.equal(reasoningItem.detail, undefined);
});

test("buildAgentProcessPanelViewModel hides context checkpoint implementation wording", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({
				id: "checkpoint",
				kind: "system",
				title: "Checkpoint saved",
				detail: "Context package built before native model request. (context_ready)",
				status: "ok",
				rawEventType: "checkpoint_saved",
			}),
			makeItem({
				id: "tool",
				kind: "tool",
				title: "Read project",
				detail: "Listed 4 item(s)",
				status: "running",
				tool: "ls",
				targetPath: "Project",
			}),
		],
	}));

	assert.ok(view.timeline);
	assert.doesNotMatch(JSON.stringify(view.timeline.items), /Context package built|context_ready|native model request/);
});

test("buildAgentProcessPanelViewModel creates file write steps before approval steps", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "waiting_for_approval",
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read 123/workspace/FRIDAY 介绍.md", status: "ok", tool: "read", targetPath: "123/workspace/FRIDAY 介绍.md", at: "2026-05-05T00:00:01.000Z" }),
			makeItem({ id: "write", kind: "tool", title: "Write 123/workspace/FRIDAY 设计理念.md", detail: "Wrote draft content.", status: "ok", tool: "write", targetPath: "123/workspace/FRIDAY 设计理念.md", at: "2026-05-05T00:00:03.000Z" }),
			makeItem({ id: "approval", kind: "approval", title: "Approval required", detail: "1 file change pending review.", status: "waiting", tool: "write", targetPath: "123/workspace/FRIDAY 设计理念.md", at: "2026-05-05T00:00:04.000Z" }),
		],
		mutations: [
			{ id: "m1", event: "planned", operation: "write", targetPath: "123/workspace/FRIDAY 设计理念.md", status: "pending", summary: "Draft created.", reason: "" },
		],
	}));

	assert.deepEqual(view.visibleSteps.map((step) => step.title), [
		"读取上下文",
		"创建/修改文件",
		"等待确认文件修改",
	]);
	assert.equal(view.visibleSteps[1]?.summary, "Wrote draft content.");
	assert.equal(view.visibleSteps[2]?.summary, "1 个文件改动待审核");
	assert.deepEqual(view.visibleSteps[2]?.actions.map((action) => action.label), ["查看改动", "应用", "拒绝"]);
	assert.ok(view.timeline);
	assert.equal(view.timeline.status, "waiting");
	assert.equal(view.timeline.title, "等待确认");
	assert.match(view.timeline.collapsedSummary ?? "", /需要你确认/);
	assert.deepEqual(view.timeline.actions.map((action) => action.id), ["view_changes", "apply", "reject"]);
	assert.equal(view.timeline.items.at(-1)?.kind, "approval");
	assert.equal(view.timeline.items.at(-1)?.status, "waiting");
});

function makeSnapshot(overrides = {}) {
	return {
		identity: { turnId: "turn-1", taskId: "task-1", traceId: "trace-1", conversationId: "conversation-1" },
		status: "completed",
		headline: "Agent finished",
		summary: "Done.",
		stages: ["context", "reasoning", "tools", "review", "finalize"].map((key) => ({
			key,
			label: key,
			status: "pending",
			itemIds: [],
		})),
		items: [],
		actions: [],
		mutations: [],
		privacy: { redacted: true, source: "live" },
		...overrides,
	};
}

function makeItem(overrides = {}) {
	return {
		id: overrides.id ?? "item",
		kind: overrides.kind ?? "tool",
		title: overrides.title ?? "Item",
		detail: overrides.detail ?? "",
		status: overrides.status ?? "ok",
		...overrides,
	};
}
