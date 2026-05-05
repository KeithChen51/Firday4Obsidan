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
