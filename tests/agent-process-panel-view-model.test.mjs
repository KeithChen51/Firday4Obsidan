/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";
import { assertNoBannedOrdinaryTerms } from "./helpers/ordinarySurfaceContract.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const viewModelPath = path.join(projectRoot, "src/views/agentProcessPanelViewModel.ts");
const projectorPath = path.join(projectRoot, "src/core/trajectory/AgentTrajectoryProjector.ts");

async function loadViewModel() {
	return jiti.import(viewModelPath);
}

async function loadProjector() {
	return jiti.import(projectorPath);
}

function ordinaryProcessText(view) {
	return [
		view.title,
		view.header?.label,
		view.header?.headline,
		view.header?.summary,
		view.status?.label,
		view.recovery?.title,
		view.recovery?.summary,
		...(view.actions ?? []).flatMap((action) => [action.label, action.reason]),
		...(view.visibleSteps ?? []).flatMap((step) => [
			step.title,
			step.summary,
			...step.actions.flatMap((action) => [action.label, action.detail, action.action?.label, action.action?.reason]),
		]),
		...(view.timeline?.items ?? []).flatMap((item) => [
			item.title,
			item.summary,
			item.meta,
			item.detail?.title,
			...(item.detail?.lines ?? []),
			...(item.notes ?? []).map((note) => note.text),
		]),
		...(view.timeline?.actions ?? []).flatMap((action) => [action.label, action.reason]),
		view.timeline?.title,
		view.timeline?.collapsedSummary,
		view.timeline?.statusBar?.phase,
		view.timeline?.statusBar?.action,
	].filter(Boolean).join("\n");
}

test("buildAgentProcessPanelViewModel hides simple live model-only answers from process surfaces", async () => {
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
	assert.equal(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, false);
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

test("buildAgentProcessPanelViewModel hides completed direct-answer and clarify intake routes", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	for (const interactionRoute of ["direct_answer", "clarify"]) {
		const view = buildAgentProcessPanelViewModel(makeSnapshot({
			status: "completed",
			summary: interactionRoute === "clarify" ? "你想整理哪一篇笔记？" : "2+2 等于 4。",
			items: [
				makeItem({
					id: `intake-${interactionRoute}`,
					kind: "intake",
					title: interactionRoute === "clarify" ? "你想整理哪一篇笔记？" : "我会直接回答这个问题。",
					detail: interactionRoute === "clarify" ? "你想整理哪一篇笔记？" : "我会直接回答这个问题。",
					status: "ok",
					rawEventType: "intake_decision",
					intakeInteractionRoute: interactionRoute,
					intakeShouldShowProcess: false,
					intakeShouldUseVisiblePlan: false,
				}),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Done.", status: "ok" }),
			],
		}));

		assert.equal(view.mode, "simple_thinking", interactionRoute);
		assert.equal(view.surface, "hidden", interactionRoute);
		assert.equal(view.shouldRenderProcessPanel, false, interactionRoute);
		assert.equal(view.timeline, null, interactionRoute);
		assert.deepEqual(view.visibleSteps, [], interactionRoute);
	}
});

test("buildAgentProcessPanelViewModel expands running task surfaces and folds completed tasks", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const lightView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		time: {
			startedAt: "2026-05-10T00:00:00.000Z",
			updatedAt: "2026-05-10T00:00:02.000Z",
		},
		items: [
			makeItem({
				id: "intake-light",
				kind: "intake",
				title: "我会快速检查当前笔记。",
				detail: "我会快速检查当前笔记。",
				status: "running",
				rawEventType: "intake_decision",
				intakeInteractionRoute: "light_task",
				intakeShouldShowProcess: true,
				intakeShouldUseVisiblePlan: false,
			}),
		],
	}), { now: new Date("2026-05-10T00:00:03.000Z") });
	const processView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		time: {
			startedAt: "2026-05-10T00:00:00.000Z",
			updatedAt: "2026-05-10T00:00:02.000Z",
		},
		plan: {
			planId: "plan-visible",
			visibility: "visible",
			status: "running",
			currentTaskId: "task-1",
			tasks: [
				{ id: "task-1", title: "整理上下文", status: "in_progress" },
				{ id: "task-2", title: "输出结果", status: "pending" },
			],
		},
		items: [
			makeItem({
				id: "intake-process",
				kind: "intake",
				title: "我会按步骤整理这批内容。",
				detail: "我会按步骤整理这批内容。",
				status: "running",
				rawEventType: "intake_decision",
				intakeInteractionRoute: "task_with_process",
				intakeShouldShowProcess: true,
				intakeShouldUseVisiblePlan: true,
			}),
		],
	}), { now: new Date("2026-05-10T00:00:03.000Z") });

	assert.equal(lightView.surface, "expanded_live_process");
	assert.equal(lightView.timeline?.status, "running");
	assert.equal(lightView.timeline?.defaultExpanded, true);
	assert.equal(lightView.composerTaskBar, null);
	assert.equal(processView.surface, "expanded_live_process");
	assert.equal(processView.timeline?.defaultExpanded, true);
	assert.ok(processView.composerTaskBar);
});

test("buildAgentProcessPanelViewModel keeps completed task_with_process folded after final answer", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		time: {
			startedAt: "2026-05-10T00:00:00.000Z",
			completedAt: "2026-05-10T00:00:07.000Z",
			durationMs: 7000,
		},
		plan: {
			planId: "plan-visible",
			visibility: "visible",
			status: "completed",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "整理上下文", status: "completed" },
				{ id: "task-2", title: "输出结果", status: "completed" },
			],
		},
		items: [
			makeItem({
				id: "intake-process",
				kind: "intake",
				title: "我会按步骤整理这批内容。",
				detail: "我会按步骤整理这批内容。",
				status: "ok",
				rawEventType: "intake_decision",
				intakeInteractionRoute: "task_with_process",
				intakeShouldShowProcess: true,
				intakeShouldUseVisiblePlan: true,
			}),
			makeItem({ id: "tool", kind: "tool", title: "Read Notes/A.md", detail: "Read note.", status: "ok", tool: "read", targetPath: "Notes/A.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Done.", status: "ok" }),
		],
	}));

	assert.equal(view.surface, "collapsed_completed_replay");
	assert.equal(view.timeline?.status, "completed");
	assert.equal(view.timeline?.defaultExpanded, false);
	assert.equal(view.timeline?.canExpand, true);
});

test("projected intake routes drive process panel surfaces", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const { projectRuntimeProgress } = await loadProjector();

	const directSnapshot = projectRuntimeProgress([
		{
			phase: "intake",
			message: "我会直接回答。",
			intake: {
				interactionRoute: "direct_answer",
				complexity: "simple",
				route: "answer",
				statement: "我会直接回答。",
				requiresPlan: false,
				shouldShowProcess: false,
				shouldUseVisiblePlan: false,
				source: "model",
			},
		},
		{ phase: "done", message: "Done." },
	]);
	const lightSnapshot = projectRuntimeProgress([
		{
			phase: "intake",
			message: "我会快速检查一次。",
			intake: {
				interactionRoute: "light_task",
				complexity: "light",
				route: "answer",
				statement: "我会快速检查一次。",
				requiresPlan: false,
				shouldShowProcess: true,
				shouldUseVisiblePlan: false,
				source: "model",
			},
		},
	]);

	assert.equal(buildAgentProcessPanelViewModel(directSnapshot).shouldRenderProcessPanel, false);
	assert.equal(buildAgentProcessPanelViewModel(lightSnapshot).timeline?.defaultExpanded, true);
});

test("projected retry and approval states use human-facing process labels", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const { projectRuntimeProgress } = await loadProjector();

	const retryView = buildAgentProcessPanelViewModel(projectRuntimeProgress([
		{
			phase: "model_retry",
			message: "Model request retry scheduled after HTTP 504; attempt 1/4; backoff 700ms",
			step: 1,
			transport: {
				type: "retry_scheduled",
				requestId: "request-1",
				attempt: 1,
				maxAttempts: 4,
			},
		},
	]));
	const approvalView = buildAgentProcessPanelViewModel(projectRuntimeProgress([
		{
			phase: "tool_approval",
			message: "Tool approval required for exec",
			step: 2,
			tool: "exec",
		},
	]));
	const rendered = JSON.stringify({ retryView, approvalView });

	assert.match(rendered, /恢复请求|确认后继续|确认操作/);
	assert.doesNotMatch(rendered, /Model transport|Tool approval|Approval required|HTTP 504|backoff|allow_once|deny/);
});

test("buildAgentProcessPanelViewModel keeps internal preflight progress out of live process surfaces", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Loading instructions",
		summary: "加载项目规则与 Soul 设定",
		time: {
			startedAt: "2026-05-08T00:00:00.000Z",
			updatedAt: "2026-05-08T00:00:01.000Z",
		},
		items: [
			makeItem({ id: "live:context:instructions", kind: "context", title: "Context: instructions", detail: "加载项目规则与 Soul 设定", status: "running", rawEventType: "context" }),
			makeItem({ id: "live:context:skills", kind: "context", title: "Context: skills", detail: "匹配相关技能与命令约束", status: "running", rawEventType: "context" }),
			makeItem({ id: "live:context:memory", kind: "context", title: "Context: memory", detail: "加载长期记忆与项目偏好", status: "running", rawEventType: "context" }),
			makeItem({ id: "live:context:compact", kind: "context", title: "Context: compact", detail: "压缩上下文并生成提示包", status: "running", rawEventType: "context", targetPath: "Notes/current.md" }),
			makeItem({ id: "live:checkpoint:checkpoint-1:saved", kind: "system", title: "Checkpoint saved", detail: "Context package built before native model request. (context_ready)", status: "ok", rawEventType: "checkpoint_saved" }),
			makeItem({ id: "live:model:1", kind: "model", title: "Model step 1", detail: "模型请求已开始。", status: "running", rawEventType: "model_request" }),
		],
	}), { now: new Date("2026-05-08T00:00:01.000Z") });

	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, false);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.timeline, null);
	assert.equal(view.composerTaskBar, null);
	assert.deepEqual(view.visibleSteps, []);
	assert.deepEqual(view.evidence, []);
});

test("buildAgentProcessPanelViewModel keeps runtime start progress out of live process surfaces", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Starting runtime",
		summary: "Runtime started.",
		time: {
			startedAt: "2026-05-08T00:00:00.000Z",
			updatedAt: "2026-05-08T00:00:01.000Z",
		},
		items: [
			makeItem({ id: "live:start", kind: "system", title: "Runtime started", detail: "Runtime started.", status: "running", rawEventType: "start" }),
			makeItem({ id: "live:context:instructions", kind: "context", title: "Context: instructions", detail: "加载项目规则与 Soul 设定", status: "running", rawEventType: "context" }),
			makeItem({ id: "live:model:1", kind: "model", title: "Model step 1", detail: "Model request started.", status: "running", rawEventType: "model_request" }),
		],
	}), { now: new Date("2026-05-08T00:00:01.000Z") });

	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, false);
	assert.equal(view.timeline, null);
	assert.deepEqual(view.visibleSteps, []);
	assert.deepEqual(view.evidence, []);
});

test("buildAgentProcessPanelViewModel still shows visible target and evidence actions", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const targetView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "visible-context", kind: "context", title: "Loaded current note", detail: "Read current note.", status: "running", rawEventType: "context", targetPath: "Notes/current.md" }),
		],
	}));
	const evidenceView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "visible-evidence", kind: "model", title: "Evidence backed action", detail: "Using retrieved evidence.", status: "running", rawEventType: "model_response", evidenceRef: "event-1" }),
		],
	}));

	assert.equal(targetView.shouldRenderProcessPanel, true);
	assert.equal(targetView.surface, "expanded_live_process");
	assert.deepEqual(targetView.evidence.map((item) => item.label), ["Notes/current.md"]);
	assert.equal(evidenceView.shouldRenderProcessPanel, true);
	assert.equal(evidenceView.surface, "expanded_live_process");
	assert.deepEqual(evidenceView.evidence.map((item) => item.label), ["event-1"]);
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
	assert.equal(view.header.headline, "FRIDAY 已完成工作");
	assert.equal(view.timeline?.title, "FRIDAY 已完成工作 · 7s");
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
	assert.equal(view.timeline.title, "FRIDAY 已完成工作 · 2m 11s");
	assert.equal(view.timeline.defaultExpanded, false);
	assert.equal(view.timeline.canExpand, true);
	assert.deepEqual(view.timeline.items.map((item) => item.kind), ["receipt", "context", "done"]);
	assert.deepEqual(view.timeline.items.map((item) => item.status), ["done", "done", "done"]);
	assert.equal(view.timeline.items.at(-1)?.title, "完成");
});

test("buildAgentProcessPanelViewModel renders simple completed answers as compact thought strip", async () => {
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
	assert.notEqual(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.resultArtifacts.length, 0);
	assert.equal(view.diffSummary, null);
	assert.equal(view.visibleSteps.length, 0);
	assert.ok(view.timeline);
	assert.equal(view.timeline.title, "FRIDAY 已思考");
	assert.equal(view.timeline.canExpand, false);
	assert.equal(view.timeline.defaultExpanded, false);
	assert.deepEqual(view.timeline.items, []);
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

	assert.notEqual(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.visibleSteps.length, 0);
	assert.ok(view.timeline);
	assert.equal(view.timeline.title, "FRIDAY 已思考");
	assert.equal(view.timeline.canExpand, false);
});

test("buildAgentProcessPanelViewModel renders simple completed replay with only generic lifecycle narration as compact thought strip", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "2+2 等于 4。",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-08T00:00:00.000Z", completedAt: "2026-05-08T00:00:04.000Z", durationMs: 4000 },
		items: [
			makeItem({ id: "task-created", kind: "task", title: "Task created", detail: "Task created.", status: "ok", rawEventType: "task_created" }),
			makeItem({ id: "task-running", kind: "task", title: "Task running", detail: "Runtime started.", status: "ok", rawEventType: "task_running" }),
			makeItem({
				id: "receipt",
				kind: "narration",
				title: "收到任务",
				detail: "FRIDAY 已收到任务，开始按当前上下文处理。",
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "task_acknowledged",
				narrationSource: "fallback",
			}),
			makeItem({
				id: "reasoning",
				kind: "reasoning",
				title: "FRIDAY 的思路",
				detail: "received model reasoning",
				status: "ok",
				rawEventType: "model_response",
			}),
			makeItem({
				id: "context-ready",
				kind: "system",
				title: "Checkpoint saved",
				detail: "Context package built before native model request. (context_ready)",
				status: "ok",
				rawEventType: "checkpoint_saved",
			}),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "2+2 等于 4。", status: "ok", rawEventType: "assistant_final" }),
		],
	}));

	assert.equal(view.composerTaskBar, null);
	assert.equal(view.mode, "simple_thinking");
	assert.notEqual(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.equal(view.visibleSteps.length, 0);
	assert.ok(view.timeline);
	assert.equal(view.timeline.title, "FRIDAY 已思考 · 4s");
	assert.equal(view.timeline.canExpand, false);
	assert.equal(view.timeline.defaultExpanded, false);
	assert.deepEqual(view.timeline.items, []);
	assert.doesNotMatch(JSON.stringify(view), /收到任务|FRIDAY 已收到任务|整理方案|已整理当前判断|读取项目现状|已整理上下文/);
});

test("buildAgentProcessPanelViewModel compacts completed preflight-only replay with duration", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "3+3 等于 6。",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-08T00:00:00.000Z", completedAt: "2026-05-08T00:00:03.000Z", durationMs: 3000 },
		items: [
			makeItem({ id: "live:context:instructions", kind: "context", title: "Context: instructions", detail: "加载项目规则与 Soul 设定", status: "ok", rawEventType: "context" }),
			makeItem({ id: "live:context:skills", kind: "context", title: "Context: skills", detail: "匹配相关技能与命令约束", status: "ok", rawEventType: "context" }),
			makeItem({ id: "live:context:memory", kind: "context", title: "Context: memory", detail: "加载长期记忆与项目偏好", status: "ok", rawEventType: "context" }),
			makeItem({ id: "live:context:compact", kind: "context", title: "Context: compact", detail: "压缩上下文并生成提示包", status: "ok", rawEventType: "context" }),
			makeItem({ id: "checkpoint", kind: "system", title: "Checkpoint saved", detail: "Context package built before native model request. (context_ready)", status: "ok", rawEventType: "checkpoint_saved" }),
			makeItem({ id: "model", kind: "model", title: "Model response", detail: "3+3 等于 6。", status: "ok", rawEventType: "model_response" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "3+3 等于 6。", status: "ok", rawEventType: "assistant_final" }),
		],
	}));

	assert.equal(view.composerTaskBar, null);
	assert.equal(view.mode, "simple_thinking");
	assert.notEqual(view.surface, "hidden");
	assert.equal(view.shouldRenderProcessPanel, true);
	assert.equal(view.hasExpandableContent, false);
	assert.equal(view.canExpand, false);
	assert.deepEqual(view.visibleSteps, []);
	assert.ok(view.timeline);
	assert.equal(view.timeline.title, "FRIDAY 已思考 · 3s");
	assert.equal(view.timeline.canExpand, false);
	assert.equal(view.timeline.defaultExpanded, false);
	assert.deepEqual(view.timeline.items, []);
	assert.doesNotMatch(JSON.stringify(view), /加载项目规则|匹配相关技能|加载长期记忆|压缩上下文|context_ready|读取项目现状/);
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
	assert.equal(view.header.headline, "FRIDAY 已完成工作");
	assert.equal(view.timeline?.title, "FRIDAY 已完成工作 · 4s");
	assert.equal(view.timeline?.collapsedSummary, "");
	assert.equal(view.timeline?.defaultExpanded, false);
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["读取上下文"]);
	assert.deepEqual(view.visibleSteps[0]?.actions.map((action) => action.label), [
		"读取项目现状",
		"读取项目现状",
	]);
});

test("buildAgentProcessPanelViewModel pads completed process seconds after one minute", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:01:04.000Z", durationMs: 64000 },
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered from the current note.", status: "ok" }),
		],
	}));

	assert.equal(view.timeline?.title, "FRIDAY 已完成工作 · 1m 04s");
	assert.equal(view.timeline?.collapsedSummary, "");
	assert.equal(view.timeline?.defaultExpanded, false);
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
	assert.equal(view.surface, "expanded_live_process");
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
	assert.equal(view.visibleSteps.at(-1)?.title, "等待确认");
	assert.equal(view.visibleSteps.at(-1)?.status, "waiting_for_approval");
	assert.deepEqual(view.visibleSteps.at(-1)?.actions.map((action) => action.kind), ["event"]);
	assertNoBannedOrdinaryTerms(ordinaryProcessText(view), "waiting approval process view");
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
	assert.equal(view.recovery?.title, "可以恢复");
	assert.match(view.recovery?.summary ?? "", /grep failed/);
	assert.equal(view.recovery?.retryable, true);
	assert.equal(view.actions[0]?.id, "retry");
	assert.equal(view.visibleSteps.at(-1)?.status, "retryable");
});

test("buildAgentProcessPanelViewModel presents user cancellations as stopped work", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "cancelled",
		headline: "Agent failed",
		summary: "Agent turn cancelled.",
		failure: {
			class: "cancelled",
			message: "Error: Task cancelled.",
			retryable: false,
			recoverable: false,
		},
		items: [
			makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "Error: Task cancelled.", status: "cancelled" }),
		],
	}));

	assert.equal(view.status.tone, "cancelled");
	assert.equal(view.status.label, "已停止");
	assert.equal(view.timeline?.status, "cancelled");
	assert.equal(view.timeline?.title, "已停止处理");
	assert.match(ordinaryProcessText(view), /已停止本次任务/);
	assert.doesNotMatch(ordinaryProcessText(view), /运行遇到问题|Error:|Task cancelled|Agent turn cancelled|Run failed/i);
	assertNoBannedOrdinaryTerms(ordinaryProcessText(view), "cancelled process view");
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
	assertNoBannedOrdinaryTerms(ordinaryProcessText(view), "checkpoint recovery process view");
});

test("buildAgentProcessPanelViewModel keeps ordinary process text free of internal runtime terms", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "waiting_for_user",
		headline: "Waiting for user",
		summary: "Before snapshot mismatch for Project/workspace/a.md.",
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
				id: "model",
				kind: "model",
				title: "Model request",
				detail: "model_request started",
				status: "running",
				rawEventType: "model_request",
			}),
			makeItem({
				id: "approval",
				kind: "approval",
				title: "Waiting for approval",
				detail: "1 file change(s) pending review.",
				status: "waiting",
				rawEventType: "tool_approval",
			}),
		],
		actions: [
			{ id: "continue", label: "Continue", enabled: true, targetId: "task-1" },
			{ id: "reject", label: "Reject", enabled: false, reason: "Waiting for approval", targetId: "approval" },
		],
	}));

	assert.equal(view.surface, "action_required");
	assertNoBannedOrdinaryTerms(ordinaryProcessText(view), "ordinary process view");
});

test("buildAgentProcessPanelViewModel does not keep applied mutation reviews waiting", async () => {
	const [{ buildAgentProcessPanelViewModel }, { projectReplaySummary }] = await Promise.all([
		loadViewModel(),
		loadProjector(),
	]);
	const snapshot = projectReplaySummary({
		conversationId: "conversation-1",
		turnId: "turn-1",
		taskId: "task-1",
		traceId: "trace-1",
		totalEvents: 8,
		eventTypes: [],
		status: "completed",
		startedAt: "2026-05-05T00:00:00.000Z",
		updatedAt: "2026-05-05T00:00:08.000Z",
		completedAt: "2026-05-05T00:00:08.000Z",
		durationMs: 8000,
		modelCalls: { requested: 1, completed: 1, failed: 0 },
		intakeTimeline: [],
		planTimeline: [],
		narrationTimeline: [],
		checkpoints: { saved: 0, resumed: 0, rejected: 0, latestBoundary: "" },
		checkpointTimeline: [],
		transport: { retries: 0, exhausted: 0, lastMessage: "" },
		transportTimeline: [],
		toolEvents: { requested: 0, completed: 0, failed: 0, denied: 0 },
		toolCalls: [],
		approvals: { requested: 0, resolved: 0, approved: 0, denied: 0 },
		mutations: { planned: 1, applied: 1, rejected: 0, conflicted: 0, applyFailed: 0 },
		mutationTimeline: [
			{
				id: "plan-1",
				event: "planned",
				operation: "write",
				targetPath: "workspace/FRIDAY 文档关系分析.md",
				status: "pending_review",
				summary: "已准备好文件创建。",
				reason: "",
				at: "2026-05-05T00:00:03.000Z",
			},
			{
				id: "plan-1",
				event: "applied",
				operation: "write",
				targetPath: "workspace/FRIDAY 文档关系分析.md",
				status: "applied",
				summary: "已应用文件创建。",
				reason: "Approved by user.",
				at: "2026-05-05T00:00:06.000Z",
			},
		],
		taskTimeline: [
			{ taskId: "task-1", event: "created", status: "created", summary: "Task created.", reason: "", at: "2026-05-05T00:00:00.000Z" },
			{ taskId: "task-1", event: "waiting_for_approval", status: "waiting_for_approval", summary: "已准备好 1 个待应用的文件修改，确认后才会写入 Obsidian。", reason: "", at: "2026-05-05T00:00:04.000Z" },
			{ taskId: "task-1", event: "completed", status: "completed", summary: "文件修改已应用。", reason: "", at: "2026-05-05T00:00:08.000Z" },
		],
		finalAnswerSummary: "已整理成文档。",
		errors: [],
		terminalStatus: "turn_completed",
	});

	const view = buildAgentProcessPanelViewModel(snapshot);
	const text = ordinaryProcessText(view);

	assert.equal(view.timeline?.status, "completed");
	assert.match(view.timeline?.title ?? "", /已完成工作/);
	assert.doesNotMatch(text, /等待确认|待应用|确认后才会写入/);
	assert.deepEqual(view.timeline?.actions.map((action) => action.id), []);
});

test("buildAgentProcessPanelViewModel renders transport retry without checkpoint resume claims", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Reconnecting to model",
		summary: "网络波动，正在恢复请求（第 1/5 次）",
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "Model transport",
				detail: "网络波动，正在恢复请求（第 1/5 次）",
				status: "running",
				rawEventType: "retry_scheduled",
				step: 3,
			}),
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.surface, "expanded_live_process");
	assert.equal(view.status.tone, "reconnecting");
	assert.equal(view.visibleSteps.at(-1)?.title, "恢复请求");
	assert.equal(view.visibleSteps.at(-1)?.status, "running");
	assert.equal(view.header.summary, "网络波动，正在恢复请求（第 1/5 次）");
	assert.doesNotMatch(JSON.stringify(view), /checkpoint|resume/i);
	assert.ok(view.timeline);
	assert.equal(view.timeline.status, "retrying");
	assert.equal(view.timeline.collapsedSummary, "网络波动，正在恢复请求（第 1/5 次）");
	assert.equal(view.timeline.items.at(-1)?.kind, "retry");
	assert.equal(view.timeline.items.at(-1)?.title, "恢复请求");
	assert.equal(view.timeline.items.at(-1)?.summary, "网络波动，正在恢复请求（第 1/5 次）");
});

test("buildAgentProcessPanelViewModel normalizes raw retry transport copy to approved recovery wording", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Reconnecting to model",
		summary: "HTTP 429 gateway backoff; request id req-1; attempt 1/4",
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "Model transport",
				detail: "模型连接不稳定，正在恢复。第 1/4 次重试；HTTP 429 gateway backoff; request id req-1",
				status: "running",
				rawEventType: "retry_started",
			}),
		],
	}));

	assert.equal(view.timeline?.status, "retrying");
	assert.equal(view.header.summary, "网络波动，正在恢复请求（第 1/5 次）");
	assert.equal(view.timeline?.collapsedSummary, "网络波动，正在恢复请求（第 1/5 次）");
	assert.equal(view.timeline?.items.at(-1)?.summary, "网络波动，正在恢复请求（第 1/5 次）");
	assert.doesNotMatch(JSON.stringify(view), /模型连接不稳定|第\s*1\/4\s*次重试|第\s*1\/4\s*次/);
});

test("buildAgentProcessPanelViewModel renders exhausted model requests with approved failure copy", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		headline: "Agent failed",
		summary: "HTTP 504 gateway timeout after attempt 5/5; request exhausted",
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "Request exhausted",
				detail: "HTTP 504 gateway timeout after attempt 5/5; request exhausted",
				status: "failed",
				rawEventType: "request_exhausted",
			}),
		],
	}));

	assert.equal(view.timeline?.status, "failed");
	assert.equal(view.header.summary, "请求多次未成功，请稍后重试。");
	assert.equal(view.timeline?.collapsedSummary, "请求多次未成功，请稍后重试。");
	assert.equal(view.timeline?.items.at(-1)?.summary, "请求多次未成功，请稍后重试。");
	assert.doesNotMatch(JSON.stringify(view), /模型连接不稳定|第\s*5\/5\s*次重试/);
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
	assert.deepEqual(view.timeline?.groups.map((group) => group.title), ["收到任务", "执行"]);
	assert.deepEqual(view.timeline?.groups.map((group) => group.defaultExpanded), [false, false]);
	assert.equal(view.timeline?.groups[1]?.items.length, 1);
});

test("buildAgentProcessPanelViewModel keeps running status bar from repeating the visible Task Bar title", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "FRIDAY 正在处理",
		summary: "正在读取项目文件。",
		time: {
			startedAt: "2026-05-06T00:00:00.000Z",
			updatedAt: "2026-05-06T00:00:12.000Z",
		},
		plan: {
			planId: "plan-current-task",
			visibility: "visible",
			status: "running",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "确认资料范围", status: "completed" },
				{ id: "task-2", title: "整理工作区文档关系", status: "in_progress" },
				{ id: "task-3", title: "输出整理结果", status: "pending" },
			],
		},
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read Project/a.md", detail: "读取参考文件。", status: "running", tool: "read", targetPath: "Project/a.md" }),
		],
	}), { now: new Date("2026-05-06T00:00:12.000Z") });

	assert.ok(view.timeline?.statusBar);
	assert.equal(view.timeline?.statusBar.phase, "执行中");
	assert.equal(view.timeline?.statusBar.action, "过程记录会在展开后更新");
	assert.equal(view.timeline?.statusBar.elapsed, "12s");
	assert.doesNotMatch(view.timeline?.statusBar.action ?? "", /整理工作区文档关系|读取项目现状|FRIDAY 正在理解/);
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
	assert.equal(view.header.headline, "FRIDAY 已完成工作");
	assert.doesNotMatch(view.header.headline, />/);
	assert.equal(view.hasExpandableContent, true);
	assert.equal(view.canExpand, true);
	assert.equal(view.evidence[0]?.label, "Notes/A.md");
	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["创建/修改文件"]);
});

test("buildAgentProcessPanelViewModel labels synthetic mutation steps with product copy", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		items: [],
		mutations: [
			{ id: "m1", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
		],
	}));

	const actionLabels = view.visibleSteps.flatMap((step) => step.actions.map((action) => action.label));
	assert.ok(actionLabels.some((label) => /文件修改/.test(label)));
	assert.doesNotMatch(actionLabels.join("\n"), /\b(edit|write|delete|create|modify|update) Notes\//i);
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
			{ id: "applied-md", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Applied file update: Notes/Updated.md", reason: "" },
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
	assert.doesNotMatch(JSON.stringify(view.diffSummary), /Applied file|file update/);
	assert.match(JSON.stringify(view.diffSummary), /已应用文件修改/);
	assert.ok(view.timeline);
	assert.deepEqual(view.timeline.finalArtifacts.map((artifact) => artifact.path), [
		"Notes/Updated.md",
		"Maps/Project.canvas",
	]);
	assert.equal(JSON.stringify(view.timeline.finalArtifacts).includes("Notes/Pending.md"), false);
});

test("buildAgentProcessPanelViewModel assigns Native Kit file types to artifacts and diff files", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		mutations: [
			{ id: "md", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Updated note.", reason: "" },
			{ id: "canvas", event: "applied", operation: "write", targetPath: "Maps/Project.canvas", status: "applied", summary: "Updated canvas.", reason: "" },
			{ id: "html", event: "applied", operation: "write", targetPath: "docs/design/native-kit-catalog.html", status: "applied", summary: "Updated catalog.", reason: "" },
			{ id: "plain", event: "applied", operation: "write", targetPath: "attachments/readme", status: "applied", summary: "Updated attachment.", reason: "" },
		],
	}));

	assert.deepEqual(view.resultArtifacts.map((artifact) => [artifact.path, artifact.fileType]), [
		["Notes/Updated.md", "markdown"],
		["Maps/Project.canvas", "canvas"],
		["docs/design/native-kit-catalog.html", "code"],
		["attachments/readme", "note"],
	]);
	assert.deepEqual(view.diffSummary?.files.map((file) => [file.path, file.fileType]), [
		["Notes/Updated.md", "markdown"],
		["Maps/Project.canvas", "canvas"],
		["docs/design/native-kit-catalog.html", "code"],
		["attachments/readme", "note"],
	]);
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
	assert.equal(reasoningView.header.headline, "FRIDAY 已完成工作");
	assert.equal(reasoningView.timeline?.title, "FRIDAY 已完成工作 · 6s");
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
		"等待确认",
	]);
	assert.equal(view.visibleSteps[0]?.status, "completed");
	assert.equal(view.visibleSteps[1]?.status, "waiting_for_approval");
	assert.deepEqual(view.visibleSteps[0]?.actions.map((action) => action.label), [
		"读取项目现状",
		"FRIDAY 正在理解你的请求。",
		"Search project",
	]);
	assert.deepEqual(view.visibleSteps[1]?.fileRefs.map((file) => file.path), ["Notes/A.md"]);
	assert.doesNotMatch(JSON.stringify(view.visibleSteps), /Finalize|Future|pending future/i);
	assertNoBannedOrdinaryTerms(ordinaryProcessText(view), "progressive visible process steps");
});

test("buildAgentProcessPanelViewModel keeps only the current visible step active during approval waits", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "read-1", kind: "tool", title: "Read project", detail: "Read project files.", status: "running", tool: "read", targetPath: "Project/a.md", step: 1 }),
			makeItem({ id: "write-1", kind: "tool", title: "Write note", detail: "Prepared a note.", status: "running", tool: "write", targetPath: "Project/output.md", step: 2 }),
			makeItem({ id: "read-2", kind: "tool", title: "Read related context", detail: "Checked related context.", status: "running", tool: "read", targetPath: "Project/b.md", step: 3 }),
		],
		mutations: [
			{ id: "pending", event: "planned", operation: "write", targetPath: "Project/output.md", status: "pending", summary: "Prepared a note.", reason: "" },
		],
	}));

	const activeSteps = view.visibleSteps.filter((step) => step.status === "running" || step.status === "waiting_for_approval");
	assert.equal(activeSteps.length, 1);
	assert.equal(activeSteps[0]?.status, "waiting_for_approval");
	assert.deepEqual(view.visibleSteps.slice(0, -1).map((step) => step.status), ["completed", "completed", "completed"]);
	assert.equal(
		view.timeline?.items.filter((item) => item.status === "running" || item.status === "waiting").length,
		1,
	);
});

test("buildAgentProcessPanelViewModel productizes pending mutation review fallback text", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Waiting for review of 1 pending file change(s).",
		summary: "Waiting for review of 1 pending file change(s).",
		items: [
			makeItem({
				id: "mutation-review",
				kind: "mutation",
				title: "Waiting for review of 1 pending file change(s).",
				detail: "Review pending file changes.",
				status: "waiting",
				rawEventType: "mutation_planned",
				targetPath: "Project/workspace/a.md",
			}),
		],
		mutations: [
			{
				id: "m1",
				event: "planned",
				operation: "write",
				targetPath: "Project/workspace/a.md",
				status: "pending",
				summary: "Waiting for review of 1 pending file change(s).",
				reason: "",
			},
		],
	}));

	const text = ordinaryProcessText(view);
	assert.match(text, /确认后才会写入 Obsidian|等待你确认/);
	assertNoBannedOrdinaryTerms(text, "pending mutation review process text");
});

test("buildAgentProcessPanelViewModel keeps stage reports out of structured process steps", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const stageText = "已读取相关文件，接下来实现事件链路。";

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "FRIDAY 正在处理",
		summary: stageText,
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
				detail: stageText,
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
		"读取上下文",
	]);
	assert.deepEqual(view.timeline?.items.map((item) => item.title), [
		"收到任务",
		"读取项目现状",
	]);
	assert.equal(view.timeline?.items[0]?.summary, "需要把过程叙事放进线性时间线。");
	assert.equal(view.timeline?.items[1]?.detail, undefined);
	assert.equal(view.timeline?.items.some((item) => item.kind === "stage_report"), false);
	const contextItem = view.timeline?.items.find((item) => item.kind === "context");
	assert.deepEqual(contextItem?.notes, [
		{ id: "note:narration-stage", text: stageText, tone: "progress" },
	]);
	assert.doesNotMatch(ordinaryProcessText(view), /Read process view model/);
	assert.doesNotMatch(view.timeline?.collapsedSummary ?? "", /已读取相关文件，接下来实现事件链路/);
	assert.doesNotMatch(JSON.stringify(view.timeline), /阶段性汇报|stage_report|narration_report/);
	assert.doesNotMatch(JSON.stringify(view.timeline), /context_ready|Context|Reasoning|Tools|Review|Finalize/);
});

test("buildAgentProcessPanelViewModel compacts thought-only reasoning artifacts without exposing raw reasoning", async () => {
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

	assert.equal(view.mode, "simple_thinking");
	assert.notEqual(view.surface, "hidden");
	assert.equal(view.canExpand, false);
	assert.equal(view.header.headline, "FRIDAY 已思考");
	assert.equal(view.timeline?.title, "FRIDAY 已思考 · 8s");
	assert.equal(view.timeline?.canExpand, false);
	assert.deepEqual(view.visibleSteps, []);
	assert.deepEqual(view.timeline?.items, []);
	assert.doesNotMatch(JSON.stringify(view), /Checked the user goal/);
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

test("buildAgentProcessPanelViewModel hides generic live model reasoning so it does not look like a plan", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		privacy: { redacted: true, source: "live" },
		items: [
			makeItem({
				id: "model-request",
				kind: "model",
				title: "理解请求",
				detail: "FRIDAY 正在理解你的请求。",
				status: "running",
				rawEventType: "model_request",
			}),
			makeItem({
				id: "generic-reasoning",
				kind: "reasoning",
				title: "FRIDAY 的思路",
				detail: "FRIDAY received model reasoning and summarized it safely.",
				status: "ok",
				rawEventType: "model_response",
				reasoningProvider: "zenmux",
			}),
			makeItem({
				id: "tool-project-tree",
				kind: "tool",
				title: "project_tree",
				detail: "project_tree listed 14 entry(s)",
				status: "ok",
				tool: "project_tree",
				targetPath: "workspace",
				rawEventType: "tool_result",
			}),
		],
	}));

	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "context"]);
	assert.doesNotMatch(JSON.stringify(view), /整理方案|计划|received model reasoning|正在理解你的请求/);
});

test("buildAgentProcessPanelViewModel does not invent approval replay steps from lifecycle receipts", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "waiting_for_approval",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({
				id: "reasoning-1",
				kind: "reasoning",
				title: "FRIDAY 的思路",
				detail: "FRIDAY 已整理当前判断。",
				status: "ok",
				rawEventType: "model_response",
				reasoningProvider: "zenmux",
			}),
			makeItem({
				id: "reasoning-2",
				kind: "model",
				title: "完成理解",
				detail: "FRIDAY 已整理当前判断。",
				status: "ok",
				rawEventType: "model_response",
			}),
			makeItem({
				id: "mutation",
				kind: "mutation",
				title: "创建/修改文件",
				detail: "已准备文件改动。",
				status: "waiting",
				targetPath: "123/workspace/UX验收/native-kit-cli-artifact-ui-fix-check.md",
				rawEventType: "mutation_planned",
				actionRef: "m1",
			}),
			makeItem({
				id: "task-waiting",
				kind: "task",
				title: "等待确认",
				detail: "已准备好 1 个待应用的文件修改，确认后才会写入 Obsidian。",
				status: "waiting",
				rawEventType: "task_waiting_for_approval",
				actionRef: "task-1",
			}),
			makeItem({
				id: "checkpoint",
				kind: "system",
				title: "FRIDAY 已保存当前进度",
				detail: "FRIDAY 已保存当前进度。",
				status: "ok",
				rawEventType: "checkpoint_saved",
			}),
		],
		mutations: [
			{
				id: "m1",
				event: "planned",
				operation: "write",
				targetPath: "123/workspace/UX验收/native-kit-cli-artifact-ui-fix-check.md",
				status: "pending",
				summary: "已准备文件改动。",
				reason: "",
			},
		],
	}));

	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["等待确认"]);
	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "approval"]);
	assert.deepEqual(view.timeline?.items.map((item) => item.title), ["收到任务", "等待确认"]);
	const text = ordinaryProcessText(view);
	assert.doesNotMatch(text, /整理方案|FRIDAY 已整理当前判断|FRIDAY 已保存当前进度/);
	assert.equal(countOccurrences(text, "读取项目现状"), 0);
});

test("buildAgentProcessPanelViewModel hides saved-progress checkpoints during running approval work", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		privacy: { redacted: true, source: "live" },
		items: [
			makeItem({
				id: "tool-project-tree",
				kind: "tool",
				title: "project_tree",
				detail: "project_tree listed 14 entry(s)",
				status: "ok",
				tool: "project_tree",
				targetPath: "workspace",
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "mutation",
				kind: "mutation",
				title: "创建/修改文件",
				detail: "已准备文件改动。",
				status: "waiting",
				targetPath: "123/workspace/UX验收/native-kit-cli-artifact-ui-fix-check.md",
				rawEventType: "mutation_planned",
				actionRef: "m1",
			}),
			makeItem({
				id: "checkpoint",
				kind: "system",
				title: "FRIDAY 已保存当前进度",
				detail: "FRIDAY 已保存当前进度。",
				status: "ok",
				rawEventType: "checkpoint_saved",
			}),
		],
		mutations: [
			{
				id: "m1",
				event: "planned",
				operation: "write",
				targetPath: "123/workspace/UX验收/native-kit-cli-artifact-ui-fix-check.md",
				status: "pending",
				summary: "已准备文件改动。",
				reason: "",
			},
		],
	}));

	assert.deepEqual(view.visibleSteps.map((step) => step.title), ["读取上下文", "等待确认"]);
	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "context", "approval"]);
	assert.deepEqual(view.timeline?.items.map((item) => item.title), ["收到任务", "读取项目现状", "等待确认"]);
	const text = ordinaryProcessText(view);
	assert.doesNotMatch(text, /FRIDAY 已保存当前进度/);
});

test("buildAgentProcessPanelViewModel keeps live canvas output steps aligned with completed replay", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const canvasPath = "workspace/123.canvas";
	const liveItems = [
		makeItem({
			id: "live:tool:1:use_skill",
			kind: "tool",
			title: "use_skill json-canvas",
			detail: "Loaded json-canvas skill.",
			status: "ok",
			step: 1,
			tool: "use_skill",
			rawEventType: "tool_result",
		}),
		makeItem({
			id: "live:tool:2:canvas_apply:call",
			kind: "tool",
			title: `canvas_apply ${canvasPath}`,
			detail: "Step 2: calling tool canvas_apply",
			status: "ok",
			step: 2,
			tool: "canvas_apply",
			targetPath: canvasPath,
			rawEventType: "tool_result",
		}),
		makeItem({
			id: "live:tool:3:validate_canvas:call",
			kind: "tool",
			title: `validate_canvas ${canvasPath}`,
			detail: "Step 3: calling tool validate_canvas",
			status: "running",
			step: 3,
			tool: "validate_canvas",
			targetPath: canvasPath,
			rawEventType: "tool_call",
		}),
	];
	const completedItems = liveItems.map((item) => ({
		...item,
		id: item.id.replace("live:", "replay:"),
		status: "ok",
	}));

	const liveView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		privacy: { redacted: true, source: "live" },
		items: liveItems,
	}));
	const completedView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		items: completedItems,
		mutations: [
			{
				id: "mutation-canvas",
				event: "applied",
				operation: "create",
				targetPath: canvasPath,
				status: "applied",
				summary: "Created canvas output.",
				reason: "",
			},
		],
	}));

	const liveKinds = liveView.timeline?.items.map((item) => item.kind) ?? [];
	const completedKinds = completedView.timeline?.items
		.map((item) => item.kind)
		.filter((kind) => kind !== "done") ?? [];
	assert.deepEqual(liveKinds, ["receipt", "context", "file_change"]);
	assert.deepEqual(liveKinds, completedKinds);
	assert.equal(liveView.timeline?.items.filter((item) => item.kind === "file_change").length, 1);
	assert.deepEqual(
		liveView.timeline?.items.find((item) => item.kind === "file_change")?.toolCalls?.map((call) => call.name),
		["canvas_apply", "validate_canvas"],
	);
});

test("buildAgentProcessPanelViewModel attaches output stage reports to the matching file-change step", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const canvasPath = "workspace/native-kit-live-parity-789.canvas";

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({
				id: "stage-apply",
				kind: "narration",
				title: "Stage report",
				detail: `canvas_apply completed ${canvasPath}`,
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "stage_report",
			}),
			makeItem({
				id: "stage-validate",
				kind: "narration",
				title: "Stage report",
				detail: "validate_canvas passed 0 issue(s)",
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "stage_report",
			}),
			makeItem({
				id: "tool-skill",
				kind: "tool",
				title: "use_skill json-canvas",
				detail: "Loaded json-canvas skill.",
				status: "ok",
				step: 1,
				tool: "use_skill",
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "tool-apply",
				kind: "tool",
				title: `canvas_apply ${canvasPath}`,
				detail: `canvas_apply ${canvasPath}`,
				status: "ok",
				step: 2,
				tool: "canvas_apply",
				targetPath: canvasPath,
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "tool-validate",
				kind: "tool",
				title: `validate_canvas ${canvasPath}`,
				detail: `validate_canvas ${canvasPath}`,
				status: "ok",
				step: 3,
				tool: "validate_canvas",
				targetPath: canvasPath,
				rawEventType: "tool_result",
			}),
		],
		mutations: [
			{
				id: "mutation-canvas",
				event: "applied",
				operation: "create",
				targetPath: canvasPath,
				status: "applied",
				summary: "Created canvas output.",
				reason: "",
			},
		],
	}));

	const contextNotes = view.timeline?.items
		.find((item) => item.kind === "context")
		?.notes?.map((note) => note.text).join(" ") ?? "";
	const fileChangeNotes = view.timeline?.items
		.find((item) => item.kind === "file_change")
		?.notes?.map((note) => note.text).join(" ") ?? "";
	assert.doesNotMatch(contextNotes, /canvas_apply|validate_canvas/);
	assert.match(fileChangeNotes, /canvas_apply completed/);
	assert.match(fileChangeNotes, /validate_canvas passed/);
});

test("buildAgentProcessPanelViewModel productizes repeated context tool results without runtime plumbing", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({
				id: "tree",
				kind: "tool",
				title: "project_tree",
				detail: "project_tree listed 13 entry(s)",
				status: "ok",
				tool: "project_tree",
				targetPath: "workspace",
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "read-many",
				kind: "tool",
				title: "Read 8 file(s)",
				detail: "Read 8 file(s)",
				status: "ok",
				tool: "read_many",
				targetPath: "src/views",
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "tool-ok",
				kind: "tool",
				title: "Tool ok.",
				detail: "Tool ok.",
				status: "ok",
				tool: "read",
				targetPath: "src/views/agentProcessPanelViewModel.ts",
				rawEventType: "tool_result",
			}),
			makeItem({
				id: "plumbing",
				kind: "system",
				title: "Native tool result appended to model messages.",
				detail: "Native tool result appended to model messages.",
				status: "ok",
				rawEventType: "tool_result_appended",
			}),
			makeItem({
				id: "stage",
				kind: "narration",
				title: "阶段性汇报",
				detail: "checkpoint debug model messages",
				status: "running",
				rawEventType: "narration_report",
				narrationKind: "stage_report",
				narrationJustDone: "Read 8 file(s)",
				narrationNext: "Native tool result appended to model messages.",
				narrationSource: "model",
			}),
		],
	}));

	assert.ok(view.timeline);
	assert.deepEqual(view.timeline.items.map((item) => item.kind), ["receipt", "context"]);
	const contextItem = view.timeline.items.find((item) => item.kind === "context");
	assert.ok(contextItem);
	assert.equal(contextItem.title, "读取项目现状");
	assert.equal(contextItem.summary, "已查看项目结构和相关文件。");
	assert.equal(contextItem.meta, undefined);
	assert.equal(contextItem.detail, undefined);
	assert.ok(contextItem.notes?.length >= 1, "every visible process item should provide a user-facing narration note");
	assert.doesNotMatch(contextItem.notes.map((note) => note.text).join(" "), /Tool ok\.|Native tool result appended|project_tree listed|Read 8 file\(s\)|model messages|checkpoint|debug/i);
	assert.deepEqual(contextItem.toolCalls, [
		{ name: "project_tree", detail: "workspace" },
		{ name: "read_many", detail: "src/views" },
		{ name: "read", detail: "src/views/agentProcessPanelViewModel.ts" },
	]);
	assert.doesNotMatch(JSON.stringify(contextItem.toolCalls), /Tool ok\.|Native tool result appended|project_tree listed|Read 8 file\(s\)|model messages|checkpoint|debug/i);
	assert.doesNotMatch(ordinaryProcessText(view), /Tool ok\.|Native tool result appended|project_tree listed|Read 8 file\(s\)|model messages|checkpoint|debug|已运行\s*\d+\s*条命令/i);
});

test("buildAgentProcessPanelViewModel keeps HTML command-count chip for visible tool calls", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		items: [
			makeItem({
				id: "read-catalog",
				kind: "tool",
				title: "read_file",
				detail: "docs/design/native-kit-catalog.html",
				status: "ok",
				tool: "read_file",
				targetPath: "docs/design/native-kit-catalog.html",
				rawEventType: "tool_result",
			}),
		],
	}));

	const toolItem = view.timeline?.items.find((item) => item.toolCall);
	assert.ok(toolItem, "a visible tool call should be exposed to the Native Kit renderer");
	assert.deepEqual(toolItem.toolCall, {
		name: "read_file",
		detail: "docs/design/native-kit-catalog.html",
	});
	assert.deepEqual(toolItem.toolCalls, [
		{
			name: "read_file",
			detail: "docs/design/native-kit-catalog.html",
		},
	]);
	assert.equal(toolItem.meta, "已运行 1 条命令");
	assert.doesNotMatch(ordinaryProcessText(view), /Tool ok\.|Native tool result appended|project_tree listed|model messages|checkpoint|debug/i);
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
		"等待确认",
	]);
	assert.equal(view.visibleSteps[1]?.summary, "Wrote draft content.");
	assert.equal(view.visibleSteps[2]?.summary, "已准备好 1 个待应用的文件修改，确认后才会写入 Obsidian。");
	assert.deepEqual(view.visibleSteps[2]?.actions.map((action) => action.kind), ["event"]);
	assert.ok(view.timeline);
	assert.equal(view.timeline.status, "waiting");
	assert.equal(view.timeline.title, "等待确认");
	assert.match(view.timeline.collapsedSummary ?? "", /已准备好 1 个待应用的文件修改|确认后才会写入 Obsidian/);
	assert.deepEqual(view.timeline.actions.map((action) => action.id), []);
	assert.equal(view.timeline.items.at(-1)?.actionRefs, undefined);
	assert.equal(view.timeline.items.at(-1)?.kind, "approval");
	assert.equal(view.timeline.items.at(-1)?.status, "waiting");
	assert.doesNotMatch(JSON.stringify(view.timeline.items), /1 file change pending review|Pending file changes|Applied file/);
});

test("buildAgentProcessPanelViewModel exposes composer task bar from plan state without process narration", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		time: {
			startedAt: "2026-05-07T00:00:00.000Z",
			updatedAt: "2026-05-07T00:00:09.000Z",
		},
		plan: {
			planId: "plan-1",
			visibility: "task_bar",
			status: "running",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "确认现状", status: "completed" },
				{ id: "task-2", title: "实现 Composer Task Bar", status: "in_progress" },
				{ id: "task-3", title: "运行验收测试", status: "pending" },
			],
		},
		items: [
			makeItem({
				id: "intake",
				kind: "intake",
				title: "我理解你希望优化工作过程展示。",
				detail: "我理解你希望优化工作过程展示。",
				status: "ok",
			}),
		],
	}), { now: new Date("2026-05-07T00:00:12.000Z") });

	assert.ok(view.composerTaskBar, "planned running task should expose composer task bar");
	assert.equal(view.durationSeconds, 12);
	assert.equal(view.timeline?.statusBar?.elapsed, "12s");
	assert.deepEqual(view.composerTaskBar.collapsed, {
		statusLabel: "正在执行",
		stepLabel: "2/3",
		taskTitle: "实现 Composer Task Bar",
		elapsed: "12s",
	});
	assert.equal(view.composerTaskBar.expandedTasks.length, 3);
	assert.equal(view.composerTaskBar.actionSlot, null);
	assert.doesNotMatch(JSON.stringify(view.composerTaskBar), /当前：|刚刚完成：|接下来：|做了什么|正在做什么/);
});

test("buildAgentProcessPanelViewModel exposes completed composer task bar from visible plan replay", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		time: {
			startedAt: "2026-05-07T00:00:00.000Z",
			completedAt: "2026-05-07T00:00:12.000Z",
			durationMs: 12000,
		},
		plan: {
			planId: "plan-visible-completed",
			visibility: "visible",
			status: "completed",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "Patch runtime protocol", status: "completed" },
				{ id: "task-2", title: "Run replay tests", status: "completed" },
			],
		},
		items: [
			makeItem({ id: "final", kind: "final", title: "Final response", status: "ok" }),
		],
	}));

	assert.ok(view.composerTaskBar, "completed visible plan replay should drive the composer task bar");
	assert.equal(view.composerTaskBar.collapsed.stepLabel, "2/2");
	assert.equal(view.composerTaskBar.collapsed.taskTitle, "Run replay tests");
	assert.equal(view.composerTaskBar.collapsed.elapsed, "12s");
});

test("buildAgentProcessPanelViewModel keeps a prematurely completed live plan active", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		plan: {
			planId: "plan-premature-completed",
			visibility: "visible",
			status: "completed",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "Read workspace context", status: "completed" },
				{ id: "task-2", title: "Answer from results", status: "completed" },
			],
		},
	}));

	assert.ok(view.composerTaskBar, "live visible plan should still drive the composer task bar");
	assert.equal(view.composerTaskBar.collapsed.statusLabel, "正在执行");
	assert.equal(view.composerTaskBar.collapsed.stepLabel, "2/2");
	assert.equal(view.composerTaskBar.collapsed.taskTitle, "Answer from results");
	assert.deepEqual(view.composerTaskBar.expandedTasks.map((task) => task.status), [
		"completed",
		"in_progress",
	]);
});

test("buildAgentProcessPanelViewModel keeps visible plan narration out of the process timeline", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		plan: {
			planId: "plan-task-bar-only",
			visibility: "visible",
			status: "running",
			currentTaskId: "task-1",
			tasks: [
				{ id: "task-1", title: "Read workspace context", status: "in_progress" },
				{ id: "task-2", title: "Answer from results", status: "pending" },
			],
		},
		items: [
			makeItem({
				id: "intake",
				kind: "intake",
				title: "I will inspect the workspace.",
				detail: "I will inspect the workspace.",
				status: "ok",
				rawEventType: "intake_decision",
				intakeInteractionRoute: "task_with_process",
				intakeShouldShowProcess: true,
				intakeShouldUseVisiblePlan: true,
			}),
			makeItem({
				id: "plan-narration",
				kind: "narration",
				title: "Model plan",
				detail: "Read workspace context; answer from results.",
				status: "ok",
				narrationKind: "plan_declared",
				rawEventType: "narration_report",
			}),
			makeItem({
				id: "generic-reasoning",
				kind: "reasoning",
				title: "FRIDAY reasoning",
				detail: "received model reasoning",
				status: "ok",
				rawEventType: "model_response",
			}),
			makeItem({
				id: "tool-project-tree",
				kind: "tool",
				title: "project_tree",
				detail: "project_tree listed 14 entries.",
				status: "ok",
				tool: "project_tree",
				targetPath: "workspace",
				rawEventType: "tool_result",
			}),
		],
	}));

	assert.ok(view.composerTaskBar, "visible plan should stay in the Task Bar");
	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "context"]);
	assert.equal(view.timeline?.groups.some((group) => group.id === "plan"), false);
	assert.doesNotMatch(JSON.stringify(view.timeline), /Read workspace context; answer from results|received model reasoning/);
});

test("buildAgentProcessPanelViewModel preserves blocked task state in composer task bar", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		plan: {
			planId: "plan-blocked",
			visibility: "visible",
			status: "running",
			currentTaskId: "task-2",
			tasks: [
				{ id: "task-1", title: "Read context", status: "completed" },
				{ id: "task-2", title: "Wait for dependency", status: "blocked" },
				{ id: "task-3", title: "Finish changes", status: "pending" },
			],
		},
	}));

	assert.ok(view.composerTaskBar, "visible plan should expose composer task bar");
	assert.equal(view.composerTaskBar.collapsed.taskTitle, "Wait for dependency");
	assert.deepEqual(view.composerTaskBar.expandedTasks.map((task) => task.status), [
		"completed",
		"blocked",
		"pending",
	]);
});

test("buildAgentProcessPanelViewModel shows task bar only for visible plan visibility", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();
	const basePlan = {
		planId: "plan-visibility",
		status: "running",
		currentTaskId: "task-1",
		tasks: [
			{ id: "task-1", title: "Patch runtime protocol", status: "in_progress" },
			{ id: "task-2", title: "Run replay tests", status: "pending" },
		],
	};

	const visibleView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		plan: {
			...basePlan,
			visibility: "visible",
		},
	}));
	const internalView = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		plan: {
			...basePlan,
			visibility: "internal",
		},
	}));

	assert.ok(visibleView.composerTaskBar, "visible plan should drive the composer task bar");
	assert.equal(visibleView.composerTaskBar.collapsed.stepLabel, "1/2");
	assert.equal(internalView.composerTaskBar, null);
});

test("buildAgentProcessPanelViewModel renders intake as the first receipt instead of an internal action", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const statement = "我理解你希望修复 Intake 可见性。";
	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: statement,
		summary: statement,
		items: [
			makeItem({
				id: "live:intake:1",
				kind: "intake",
				title: statement,
				detail: statement,
				status: "running",
				rawEventType: "intake_decision",
			}),
		],
	}));

	assert.equal(view.visibleSteps[0]?.title, statement);
	assert.equal(view.visibleSteps[0]?.summary, statement);
	assert.equal(view.timeline?.items[0]?.kind, "receipt");
	assert.equal(view.timeline?.items[0]?.title, statement);
	assert.equal(view.timeline?.items[0]?.summary, "");
	assert.notEqual(view.timeline?.items[0]?.title, "执行操作");
	assert.doesNotMatch(JSON.stringify(view.timeline), /执行操作/);
});

test("buildAgentProcessPanelViewModel keeps intake and task acknowledgement as one natural statement", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const statement = "I understand you want the intake area to show one natural statement.";
	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: statement,
		summary: statement,
		items: [
			makeItem({
				id: "live:intake:1",
				kind: "intake",
				title: statement,
				detail: statement,
				status: "ok",
				rawEventType: "intake_decision",
			}),
			makeItem({
				id: "live:narration:ack:2",
				kind: "narration",
				title: "Received task",
				detail: "Received task. I will avoid repeating this acknowledgement.",
				status: "ok",
				rawEventType: "narration_report",
				narrationKind: "task_acknowledged",
			}),
		],
	}));

	assert.deepEqual(view.visibleSteps.map((step) => step.title), [statement]);
	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt"]);
	assert.equal(view.timeline?.items[0]?.title, statement);
	assert.equal(view.timeline?.items[0]?.summary, "");
	assert.equal(view.timeline?.items[0]?.detail, undefined);
	assert.equal(countOccurrences(JSON.stringify(view.timeline?.groups ?? []), statement), 1);
	assert.doesNotMatch(JSON.stringify(view.timeline?.groups ?? []), /Received task|Understood task|Task understanding/);
});

test("buildAgentProcessPanelViewModel keeps generic plan_create out of the process timeline while task bar uses plan state", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const statement = "我理解你希望修复过程区首屏展示。";
	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: statement,
		summary: statement,
		plan: {
			planId: "plan-1",
			visibility: "task_bar",
			status: "running",
			currentTaskId: "plan-1-1",
			tasks: [
				{ id: "plan-1-1", title: "确认 intake 展示", status: "in_progress" },
				{ id: "plan-1-2", title: "聚合重复 context", status: "pending" },
				{ id: "plan-1-3", title: "运行回归测试", status: "pending" },
			],
		},
		items: [
			makeItem({ id: "live:intake:1", kind: "intake", title: statement, detail: statement, status: "running", rawEventType: "intake_decision" }),
			makeItem({
				id: "live:plan:plan_create:2",
				kind: "plan",
				title: "整理计划",
				detail: "1. 确认 intake 展示\n2. 聚合重复 context\n3. 运行回归测试",
				status: "running",
				rawEventType: "plan_create",
			}),
		],
	}));

	assert.ok(view.composerTaskBar);
	assert.deepEqual(view.composerTaskBar.expandedTasks.map((task) => task.title), [
		"确认 intake 展示",
		"聚合重复 context",
		"运行回归测试",
	]);
	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt"]);
	assert.doesNotMatch(JSON.stringify(view.timeline), /整理计划|确认 intake 展示\n2\. 聚合重复 context|运行回归测试/);
});

test("buildAgentProcessPanelViewModel compacts repeated context timeline items without crossing stage boundaries", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "ctx-1", kind: "context", title: "Loaded project rules", detail: "Read AGENTS.md.", status: "ok" }),
			makeItem({ id: "stage-1", kind: "narration", narrationKind: "stage_report", title: "阶段性汇报", detail: "已读取项目规则。", status: "ok" }),
			makeItem({ id: "ctx-2", kind: "context", title: "Loaded project rules", detail: "Read package.json.", status: "ok" }),
			makeItem({ id: "ctx-3", kind: "tool", title: "read src/main.ts", detail: "Read src/main.ts.", status: "ok", tool: "read", targetPath: "src/main.ts" }),
			makeItem({ id: "write-1", kind: "tool", title: "edit src/main.ts", detail: "Updated src/main.ts.", status: "ok", tool: "edit", targetPath: "src/main.ts" }),
			makeItem({ id: "ctx-4", kind: "context", title: "Loaded project rules", detail: "Read tsconfig.json.", status: "ok" }),
		],
	}));

	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "context", "file_change", "context"]);
	const contexts = view.timeline?.items.filter((item) => item.kind === "context") ?? [];
	assert.equal(contexts.length, 2);
	const lastContext = view.timeline?.items.at(-1);
	assert.equal(lastContext?.kind, "context", "file changes should stop context compaction");
	assert.doesNotMatch(lastContext?.summary ?? "", /4 批|4 batch/);
});

test("buildAgentProcessPanelViewModel treats approval failure and file changes as context compaction barriers", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "ctx-1", kind: "context", title: "Loaded project rules", detail: "Read AGENTS.md.", status: "ok" }),
			makeItem({ id: "approval-1", kind: "approval", title: "Approval required", detail: "Approve write.", status: "waiting", tool: "write", targetPath: "Notes/today.md" }),
			makeItem({ id: "ctx-2", kind: "context", title: "Loaded current note", detail: "Read Notes/today.md.", status: "ok" }),
			makeItem({ id: "failure-1", kind: "failure", title: "Run failed", detail: "grep failed.", status: "failed" }),
			makeItem({ id: "ctx-3", kind: "context", title: "Loaded retry context", detail: "Read retry notes.", status: "ok" }),
			makeItem({ id: "write-1", kind: "tool", title: "edit Notes/today.md", detail: "Updated Notes/today.md.", status: "ok", tool: "edit", targetPath: "Notes/today.md" }),
			makeItem({ id: "ctx-4", kind: "context", title: "Loaded final context", detail: "Read final notes.", status: "ok" }),
		],
	}));

	assert.deepEqual(view.timeline?.items.map((item) => item.kind), ["receipt", "context", "approval", "context", "blocked", "context", "file_change", "context"]);
	const contexts = view.timeline?.items.filter((item) => item.kind === "context") ?? [];
	assert.equal(contexts.length, 4);
	for (const item of contexts) {
		assert.doesNotMatch(item.summary ?? "", /批|batch/, `${item.id} should not merge across a non-context item`);
	}
});

test("buildAgentProcessPanelViewModel uses approved recovery copy for request retries", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		time: {
			startedAt: "2026-05-07T00:00:00.000Z",
			updatedAt: "2026-05-07T00:00:18.000Z",
		},
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "正在恢复请求",
				detail: "网络波动，正在恢复请求（第 3/5 次）",
				status: "running",
				rawEventType: "retry_scheduled",
			}),
		],
	}));

	assert.equal(view.timeline?.status, "retrying");
	assert.equal(view.timeline?.collapsedSummary, "网络波动，正在恢复请求（第 3/5 次）");
	assert.equal(view.timeline?.items.at(-1)?.title, "恢复请求");
	assert.equal(view.timeline?.items.at(-1)?.summary, "网络波动，正在恢复请求（第 3/5 次）");
	assert.doesNotMatch(JSON.stringify(view), /重连|重新连接|Reconnecting|连接重试|模型连接不稳定/);
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

function countOccurrences(value, needle) {
	return value.split(needle).length - 1;
}
