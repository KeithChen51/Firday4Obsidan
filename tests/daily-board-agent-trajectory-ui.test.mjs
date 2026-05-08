/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const rendererPath = path.join(projectRoot, "src/views/agentTrajectoryRenderer.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const executionOrchestratorPath = path.join(projectRoot, "src/core/execution/ExecutionOrchestrator.ts");
let dailyBoardViewModulePromise;

async function loadRenderer() {
	return jiti.import(rendererPath);
}

async function loadDailyBoardView() {
	if (!dailyBoardViewModulePromise) {
		dailyBoardViewModulePromise = createJiti(import.meta.url, {
			alias: createDailyBoardRuntimeAliases(),
			moduleCache: false,
		}).import(dailyBoardPath);
	}
	return dailyBoardViewModulePromise;
}

test("DailyBoard live process UI is wired to trajectory snapshots instead of runtime execution state", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(source, /LiveTrajectoryStore/);
	assert.match(source, /AgentTrajectorySnapshot/);
	assert.match(source, /renderAgentTrajectoryCard/);
	assert.match(source, /aiRuntimeTrajectoryStore\.refreshElapsed\(\)/);
	assert.match(source, /onAction: \(action\) => this\.handleTrajectoryAction\(snapshot, action\)/);
	assert.match(source, /private handleTrajectoryAction\(\s*snapshot: AgentTrajectorySnapshot,\s*action: AgentTrajectoryAction,/);
	assert.match(source, /private aiRuntimeTrajectoryStore = new LiveTrajectoryStore\(\)/);
	assert.match(source, /private aiRuntimeTrajectorySnapshot: AgentTrajectorySnapshot \| null = null/);
	assert.match(source, /private aiProcessSnapshotsByKey = new Map<string, AgentTrajectorySnapshot>\(\)/);
	assert.doesNotMatch(source, /private aiLastCompletedTrajectorySnapshot: AgentTrajectorySnapshot \| null = null/);
	assert.doesNotMatch(source, /private aiRuntimeExecutionState:/);
	assert.doesNotMatch(source, /private buildRuntimeExecutionState\(/);

	const progressMatch = source.match(/private handleRuntimeProgress\(event: RuntimeProgressEvent\): void \{([\s\S]*?)\n\t\}/);
	assert.ok(progressMatch, "handleRuntimeProgress should exist");
	const progressBlock = progressMatch[1] ?? "";
	assert.match(progressBlock, /aiRuntimeTrajectoryStore\.appendProgress\(event\)/);
	assert.doesNotMatch(progressBlock, /switch \(event\.phase\)/);
	assert.doesNotMatch(progressBlock, /buildRuntimeExecutionState/);
});

test("DailyBoard completed process disclosure is rebuilt from replay summary when available", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(source, /projectReplaySummary/);
	assert.match(source, /readTurnReplaySummary/);
	assert.match(source, /private async buildCompletedTrajectorySnapshot\(/);
	assert.match(source, /private async hydrateCompletedTrajectorySnapshotsForCurrentSession\(/);
	assert.match(source, /private rememberCompletedTrajectorySnapshot\(/);
	assert.match(source, /const summary = await this\.plugin\.agentRuntimeService\.readTurnReplaySummary/);
	assert.match(source, /const replaySnapshot = projectReplaySummary\(summary\)/);
	assert.match(source, /return this\.isSnapshotOwnedByCurrentSession\(replaySnapshot\) \? replaySnapshot : null/);
	assert.match(source, /this\.rememberCompletedTrajectorySnapshot\(completedSnapshot\)/);
});

test("DailyBoard honors timeline default expansion and keeps a manual collapse override", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const isProcessExpandedMatch = source.match(/private isProcessExpanded\([\s\S]*?\n\t\}/);
	assert.ok(isProcessExpandedMatch, "process expansion predicate should exist");
	const isProcessExpandedBlock = isProcessExpandedMatch[0] ?? "";
	const toggleMatch = source.match(/private toggleProcessExpanded\([\s\S]*?\n\t\}/);
	assert.ok(toggleMatch, "process expansion toggle should exist");
	const toggleBlock = toggleMatch[0] ?? "";

	assert.match(source, /private aiProcessCollapsedKeys = new Set<string>\(\)/);
	assert.match(isProcessExpandedBlock, /buildAgentProcessPanelViewModel\(snapshot/);
	assert.match(isProcessExpandedBlock, /view\.timeline\?\.defaultExpanded/);
	assert.match(isProcessExpandedBlock, /aiProcessCollapsedKeys\.has\(key\)/);
	assert.match(toggleBlock, /this\.isProcessExpanded\(snapshot\)/);
	assert.match(toggleBlock, /this\.aiProcessCollapsedKeys\.add\(key\)/);
	assert.doesNotMatch(isProcessExpandedBlock, /return Boolean\(key && this\.aiProcessExpandedKeys\.has\(key\)\);/);
});

test("DailyBoard scopes runtime turns and completed replay to the active conversation session", () => {
	const viewSource = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const orchestratorSource = fs.readFileSync(executionOrchestratorPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(orchestratorSource, /conversationId\?: string/);
	assert.match(orchestratorSource, /conversationId:\s*options\.conversationId/);
	assert.match(viewSource, /conversationId:\s*this\.aiSessionId/);
	assert.match(viewSource, /private isCurrentConversationId\(/);
	assert.match(viewSource, /private isSnapshotOwnedByCurrentSession\(/);
	const snapshotBuilderMatch = viewSource.match(/private async buildCompletedTrajectorySnapshot\([\s\S]*?\n\t\}/);
	assert.ok(snapshotBuilderMatch, "completed snapshot builder should exist");
	const snapshotBuilderBlock = snapshotBuilderMatch[0] ?? "";
	assert.match(snapshotBuilderBlock, /resultIdentity\.conversationId/);
	assert.match(snapshotBuilderBlock, /this\.aiSessionId/);
	assert.doesNotMatch(snapshotBuilderBlock, /this\.plugin\.getActiveSoul\(\)\?\.id/);
});

test("DailyBoard does not attach global completed replay to unrelated restored messages", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const getSnapshotMatch = source.match(/private getCompletedTrajectorySnapshotForMessage\([\s\S]*?\n\t\}/);
	assert.ok(getSnapshotMatch, "message snapshot matcher should exist");
	const getSnapshotBlock = getSnapshotMatch[0] ?? "";
	assert.match(source, /private aiProcessSnapshotsByKey = new Map<string, AgentTrajectorySnapshot>\(\)/);
	assert.match(source, /private aiProcessExpandedKeys = new Set<string>\(\)/);
	assert.match(source, /private getTrajectorySnapshotKey\(/);
	assert.match(source, /message\.uiMeta\?\.turnId/);
	assert.match(getSnapshotBlock, /this\.aiProcessSnapshotsByKey\.get/);
	assert.doesNotMatch(getSnapshotBlock, /index === lastAssistantIndex/);
	assert.doesNotMatch(source, /private aiCompletedReplayExpanded = false/);
	assert.doesNotMatch(getSnapshotBlock, /return this\.aiLastCompletedTrajectorySnapshot/);

	const listMatch = source.match(/private renderAiMessageList\([\s\S]*?\n\t\}/);
	assert.ok(listMatch, "message list renderer should exist");
	const listBlock = listMatch[0] ?? "";
	assert.match(listBlock, /this\.getVisibleAgentTasksForCurrentSession\(\)/);
	assert.doesNotMatch(listBlock, /!this\.aiBusy && this\.aiLastCompletedTrajectorySnapshot && !completedProcessRendered/);
});

test("DailyBoard uses the same document-flow answer renderer for live and restored assistant messages", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const renderMessageMatch = source.match(/private renderAiMessage\([\s\S]*?\n\t\}/);
	assert.ok(renderMessageMatch, "renderAiMessage should exist");
	const renderMessageBlock = renderMessageMatch[0] ?? "";
	assert.match(renderMessageBlock, /if \(!isUser\) \{/);
	assert.match(renderMessageBlock, /renderAgentAnswerFlow/);
	assert.doesNotMatch(renderMessageBlock, /friday-ai-message is-assistant/);
	assert.match(source, /this\.renderAiMessage\(containerEl, message, false, completedSnapshotForMessage\)/);
	assert.match(source, /this\.renderAiMessage\(\s*containerEl,\s*\{\s*role: "assistant"/);
});

test("DailyBoard syncComposerTaskBar renders plan progress only and rerenders from its toggle", async () => {
	const view = await createDailyBoardHarness({
		aiRuntimeTrajectorySnapshot: makeTaskBarSnapshot({
			summary: "当前：读取上下文。刚刚完成：整理计划。接下来：运行测试。",
			items: [
				makeItem({
					id: "summary",
					kind: "reasoning",
					title: "正在做什么",
					summary: "刚刚完成：整理计划。接下来：运行测试。",
					status: "running",
				}),
			],
		}),
	});
	const host = new FakeElement("div");
	view.aiComposerTaskBarHostEl = host;
	const originalSync = view.syncComposerTaskBar;
	let syncCount = 0;
	view.syncComposerTaskBar = function syncComposerTaskBarSpy() {
		syncCount += 1;
		return originalSync.call(this);
	};

	view.syncComposerTaskBar();

	assert.equal(syncCount, 1);
	assert.equal(host.countByClass("friday-composer-task-bar"), 1);
	assert.equal(host.findByClass("friday-composer-task-bar-summary")?.attributes["aria-expanded"], "false");
	assert.match(host.textContent, /正在执行/);
	assert.match(host.textContent, /2\/3/);
	assert.match(host.textContent, /实现 Composer Task Bar/);
	assert.doesNotMatch(host.textContent, /当前：|刚刚完成：|接下来：|正在做什么/);

	host.findByClass("friday-composer-task-bar-summary")?.onclick?.();

	assert.equal(syncCount, 2);
	assert.equal(view.aiComposerTaskBarExpanded, true);
	assert.equal(host.findByClass("friday-composer-task-bar-summary")?.attributes["aria-expanded"], "true");
	assert.equal(host.countByClass("friday-composer-task-bar-item"), 3);
	assert.match(host.textContent, /确认现状/);
	assert.match(host.textContent, /运行验收测试/);
});

test("DailyBoard syncAiLiveChatShell refreshes the saved composer task bar host", async () => {
	const messageListEl = new FakeElement("div");
	const calls = [];
	const view = await createDailyBoardHarness({
		activePage: "chat",
		aiMessageListEl: messageListEl,
		captureAiMessageListScrollState: () => calls.push("capture"),
		renderAiMessageList: () => calls.push("render-messages"),
		restoreAiMessageListScrollState: () => calls.push("restore"),
		syncAiErrorRegion: () => calls.push("error"),
		syncAiQueueHint: () => calls.push("queue"),
		syncAiComposerControls: () => calls.push("composer-controls"),
		syncComposerTaskBar: () => calls.push("task-bar"),
	});

	view.syncAiLiveChatShell();

	assert.deepEqual(calls, [
		"capture",
		"render-messages",
		"restore",
		"error",
		"queue",
		"composer-controls",
		"task-bar",
	]);
});

test("DailyBoard renders the task bar host before the composer input and resets stale host refs", async () => {
	const root = new FakeElement("div");
	const view = await createDailyBoardHarness({
		plugin: makePluginStub(),
		aiSessions: [],
		aiBusy: false,
		aiComposerTaskBarHostEl: new FakeElement("div"),
		aiMessageListEl: new FakeElement("div"),
		aiQueueHintEl: new FakeElement("div"),
		aiErrorEl: new FakeElement("div"),
		aiSendButtonEl: new FakeElement("button"),
		aiModelSelectEl: new FakeElement("select"),
		aiPermissionSelectEl: new FakeElement("select"),
		renderAiMessageList: () => {},
		syncAiErrorRegion: () => {},
		syncAiQueueHint: () => {},
		renderAiOverrideBar: () => {},
		renderEditPlanReviewPanel: () => {},
		buildModelOptions: () => [],
		buildGroupedModelOptions: () => [],
		resolveSelectedModelOptionValue: () => "",
		buildPermissionModeOptions: () => [],
		syncAiComposerControls: () => {},
		restoreAiMessageListScrollState: () => {},
		getComposerSnapshot: () => ({ text: "", doc: { type: "doc", content: [] }, selection: null }),
		buildComposerSuggestions: async () => [],
		switchSoul: () => {},
		startNewAiSession: () => {},
		submitAiPrompt: async () => {},
	});

	view.resetAiChatShellRefs();
	assert.equal(view.aiComposerTaskBarHostEl, null);
	assert.equal(view.aiMessageListEl, null);
	assert.equal(view.aiErrorEl, null);
	assert.equal(view.aiSendButtonEl, null);

	let syncCount = 0;
	view.syncComposerTaskBar = () => {
		syncCount += 1;
	};
	view.renderAiPage(root);

	const composerWrap = root.findByClass("friday-ai-composer-wrap");
	assert.ok(composerWrap, "composer wrapper should render");
	const hostIndex = directChildIndex(composerWrap, "friday-ai-composer-task-bar-host");
	const inputIndex = directChildIndex(composerWrap, "friday-ai-composer");
	assert.ok(hostIndex >= 0, "task bar host should be a direct composer wrapper child");
	assert.ok(inputIndex >= 0, "composer input surface should be a direct composer wrapper child");
	assert.ok(hostIndex < inputIndex, "task bar host should render before the composer input surface");
	assert.equal(view.aiComposerTaskBarHostEl, composerWrap.children[hostIndex]);
	assert.equal(composerWrap.children[inputIndex].countByClass("friday-ai-composer-task-bar-host"), 0);
	assert.equal(syncCount, 1);
});

test("DailyBoard lets users navigate while an agent continues in the background", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const addNavButtonMatch = source.match(/private addNavButton\([\s\S]*?\n\t\}/);
	const switchProjectMatch = source.match(/private async switchActiveProject\([\s\S]*?\n\t\}/);
	const switchSessionMatch = source.match(/private async switchAiSession\([\s\S]*?\n\t\}/);
	assert.ok(addNavButtonMatch, "nav button helper should exist");
	assert.ok(switchProjectMatch, "project switching should exist");
	assert.ok(switchSessionMatch, "AI session switching should exist");

	assert.doesNotMatch(addNavButtonMatch[0], /button\.disabled = this\.aiBusy && page !== this\.activePage/);
	assert.doesNotMatch(switchProjectMatch[0], /\|\| this\.aiBusy/);
	assert.doesNotMatch(switchSessionMatch[0], /\|\| this\.aiBusy/);
	assert.match(source, /private renderBackgroundAgentStatus\(/);
	assert.match(source, /friday-background-agent-status/);
});

test("DailyBoard keeps the completed background agent entry reachable after the live snapshot is cleared", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const backgroundMatch = source.match(/private renderBackgroundAgentStatus\([\s\S]*?\n\t\}/);
	assert.ok(backgroundMatch, "background status renderer should exist");
	const backgroundBlock = backgroundMatch[0] ?? "";

	assert.match(source, /private getCompletedBackgroundAgentStatusSnapshot\(/);
	assert.match(backgroundBlock, /const completedSnapshot = this\.getCompletedBackgroundAgentStatusSnapshot\(\)/);
	assert.match(backgroundBlock, /!this\.aiBusy && !this\.aiRuntimeTrajectorySnapshot && !completedSnapshot && !this\.aiLastError/);
	assert.match(backgroundBlock, /const isRunning = this\.aiBusy \|\| Boolean\(this\.aiRuntimeTrajectorySnapshot\)/);
	assert.match(backgroundBlock, /FRIDAY 任务完成/);
	assert.match(source, /snapshot\.status === "completed"/);
});

test("DailyBoard attaches running trajectory snapshots to historical user messages before completion", async () => {
	const snapshot = makeTaskBarSnapshot();
	const userMessage = { role: "user", content: "请优化过程展示", uiMeta: {} };
	const assistantMessage = { role: "assistant", content: "我理解你的目标。", uiMeta: snapshot.identity };
	const view = await createDailyBoardHarness({
		aiRuntimeTrajectorySnapshot: snapshot,
		aiConversation: [userMessage, assistantMessage],
	});

	view.bindRuntimeSnapshotToLatestUserMessage(snapshot);

	const key = view.getMessageTrajectorySnapshotKey(userMessage);
	assert.ok(key, "historical user message should receive a stable trajectory key");
	assert.equal(view.aiProcessSnapshotsByKey.get(key), snapshot);
	assert.equal(view.isLiveRuntimeSnapshotAttachedToMessage(), true);
	assert.equal(view.getCompletedTrajectorySnapshotForMessage(userMessage, 0, 1), null);
	assert.equal(view.getCompletedTrajectorySnapshotForMessage(userMessage, 1, 0), snapshot);
	assert.equal(view.getCompletedTrajectorySnapshotForMessage(assistantMessage, 1, 1), null);
});

test("DailyBoard rebinds refreshed elapsed snapshots and syncs task bar from the timer", async () => {
	const initialSnapshot = makeTaskBarSnapshot({ time: { durationMs: 1000 } });
	const refreshedSnapshot = makeTaskBarSnapshot({ time: { durationMs: 2000 } });
	const timerCallbacks = [];
	const calls = [];
	const view = await createDailyBoardHarness({
		aiRuntimeTrajectorySnapshot: initialSnapshot,
		aiRuntimeElapsedTimer: null,
		aiRuntimeTrajectoryStore: {
			refreshElapsed: () => refreshedSnapshot,
		},
		bindRuntimeSnapshotToLatestUserMessage: (snapshot) => calls.push(["bind", snapshot]),
		syncComposerTaskBar: () => calls.push(["task-bar"]),
		syncAiLiveChatShell: () => calls.push(["live-shell"]),
	});

	withMockedWindow({
		setTimeout: (callback, delay) => {
			timerCallbacks.push({ callback, delay });
			return timerCallbacks.length;
		},
		clearTimeout: () => {},
	}, () => {
		view.scheduleRuntimeElapsedTimer();
		assert.equal(timerCallbacks.length, 1);
		assert.equal(timerCallbacks[0]?.delay, 1000);
		timerCallbacks[0]?.callback();
	});

	assert.equal(view.aiRuntimeTrajectorySnapshot, refreshedSnapshot);
	assert.deepEqual(calls, [
		["bind", refreshedSnapshot],
		["task-bar"],
		["live-shell"],
	]);
	assert.equal(timerCallbacks.length, 2, "timer should schedule the next elapsed refresh while still running");
});

test("DailyBoard renders completed composer task bar ahead of a stale same-turn live snapshot", async () => {
	const liveSnapshot = makeTaskBarSnapshot({
		status: "running",
		plan: makeTaskBarPlan({ status: "running" }),
		privacy: { redacted: true, source: "live" },
	});
	const completedSnapshot = makeTaskBarSnapshot({
		status: "completed",
		plan: makeTaskBarPlan({
			status: "completed",
			currentTaskId: "task-3",
			tasks: [
				{ id: "task-1", title: "确认现状", status: "completed" },
				{ id: "task-2", title: "实现 Composer Task Bar", status: "completed" },
				{ id: "task-3", title: "运行验收测试", status: "completed" },
			],
		}),
		privacy: { redacted: true, source: "replay" },
	});
	const view = await createDailyBoardHarness({
		aiRuntimeTrajectorySnapshot: liveSnapshot,
	});
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(completedSnapshot), completedSnapshot);

	assert.equal(view.selectComposerTaskBarSnapshot(), completedSnapshot);
	assert.deepEqual(view.getComposerTaskBarView()?.collapsed, {
		statusLabel: "已完成",
		stepLabel: "3/3",
		taskTitle: "运行验收测试",
		elapsed: "12s",
	});
});

test("renderComposerTaskBar renders collapsed and expanded plan task states only", async () => {
	const { renderComposerTaskBar } = await loadRenderer();

	const collapsedRoot = new FakeElement("div");
	renderComposerTaskBar({
		containerEl: collapsedRoot,
		taskBar: {
			collapsed: {
				statusLabel: "正在执行",
				stepLabel: "2/4",
				taskTitle: "实现 Composer Task Bar",
				elapsed: "18s",
			},
			expandedTasks: [
				{ id: "task-1", title: "确认现状", status: "completed", index: 1 },
				{ id: "task-2", title: "实现 Composer Task Bar", status: "in_progress", index: 2 },
				{ id: "task-3", title: "补充验收", status: "pending", index: 3 },
				{ id: "task-4", title: "跳过发布", status: "skipped", index: 4 },
				{ id: "task-5", title: "最终审查", status: "failed", index: 5 },
			],
			actionSlot: null,
		},
		expanded: false,
		onToggle: () => {},
	});

	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar"), 1);
	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar-list"), 0);
	assert.match(collapsedRoot.textContent, /正在执行/);
	assert.match(collapsedRoot.textContent, /2\/4/);
	assert.match(collapsedRoot.textContent, /实现 Composer Task Bar/);
	assert.match(collapsedRoot.textContent, /18s/);
	assert.doesNotMatch(collapsedRoot.textContent, /当前：|刚刚完成：|接下来：|做了什么|正在做什么/);

	const expandedRoot = new FakeElement("div");
	renderComposerTaskBar({
		containerEl: expandedRoot,
		taskBar: {
			collapsed: {
				statusLabel: "正在执行",
				stepLabel: "2/4",
				taskTitle: "实现 Composer Task Bar",
				elapsed: "18s",
			},
			expandedTasks: [
				{ id: "task-1", title: "确认现状", status: "completed", index: 1 },
				{ id: "task-2", title: "实现 Composer Task Bar", status: "in_progress", index: 2 },
				{ id: "task-3", title: "补充验收", status: "pending", index: 3 },
				{ id: "task-4", title: "跳过发布", status: "skipped", index: 4 },
				{ id: "task-5", title: "最终审查", status: "failed", index: 5 },
			],
			actionSlot: null,
		},
		expanded: true,
		onToggle: () => {},
	});

	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-list"), 1);
	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-item"), 5);
	const statusEls = expandedRoot.findAllByClass("friday-composer-task-bar-item-status");
	assert.equal(statusEls.length, 5);
	for (const status of ["completed", "in_progress", "pending", "skipped", "failed"]) {
		assert.equal(statusEls.some((statusEl) => statusEl.classes.has(`is-${status}`)), true);
	}
	assert.match(expandedRoot.textContent, /已完成/);
	assert.match(expandedRoot.textContent, /执行中/);
	assert.match(expandedRoot.textContent, /未开始/);
	assert.match(expandedRoot.textContent, /已跳过/);
	assert.match(expandedRoot.textContent, /未完成\/失败/);
	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-action-slot"), 0);
	assert.doesNotMatch(expandedRoot.textContent, /当前：|刚刚完成：|接下来：|做了什么|正在做什么/);
});

test("renderAgentTrajectoryCard uses lightweight thinking for simple live answers", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Agent is reasoning",
			summary: "Thinking through the answer.",
			items: [
				makeItem({ id: "model", kind: "model", title: "Model step 1", detail: "Thinking.", status: "running" }),
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-header"), 1);
	assert.equal(root.countByClass("avatar"), 1);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.match(root.textContent, /FRIDAY 思考中/);
});

test("renderAgentTrajectoryCard collapsed process panel shows FRIDAY work-process disclosure", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Agent is using a tool",
			summary: "Reading project notes.",
			time: { startedAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:03.000Z", durationMs: 3000 },
			items: [
				makeItem({ id: "tool", kind: "tool", title: "Read Notes/today.md", detail: "Reading project notes.", status: "running", tool: "read", targetPath: "Notes/today.md", step: 2 }),
			],
			actions: [
				{ id: "cancel", label: "Cancel", enabled: true, targetId: "task-1" },
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => calls.push("toggle"),
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process"), 1);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(root.countByClass("avatar"), 1);
	assert.equal(root.countByClass("friday-runtime-card"), 0);
	assert.match(root.textContent, /正在处理 3s/);
	assert.doesNotMatch(root.textContent, />/);
	assert.doesNotMatch(root.textContent, /Read Notes\/today\.md/);
	assert.doesNotMatch(root.textContent, /Reading project notes/);
	assert.doesNotMatch(root.textContent, /Current|Evidence|Task running|Runtime started/i);
	assert.equal(root.countByClass("friday-agent-process-current"), 0);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.equal(root.countByClass("friday-agent-process-action"), 0);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	assert.equal(root.findByClass("friday-agent-process-chevron")?.attributes["data-icon"], "chevron-right");
	root.findByClass("friday-agent-process-toggle")?.onclick?.();
	assert.deepEqual(calls, ["toggle"]);
});

test("renderAgentTrajectoryCard suppresses simple completed answer replay", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Answer finished",
			summary: "Answered directly.",
			items: [
				makeItem({ id: "model", kind: "model", title: "Model response", detail: "Answered directly.", status: "ok" }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered directly.", status: "ok" }),
			],
		}),
		variant: "completed",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.children.length, 0);
});

test("renderAgentTrajectoryCard keeps completed file read replay as expandable work process", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		variant: "completed",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.match(root.textContent, /已处理 4s/);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.doesNotMatch(root.textContent, /Read Notes\/Today\.md|Current|Evidence|Timeline/i);
});

test("renderAgentTrajectoryCard expanded process panel shows visible steps without fixed phase tabs", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "failed",
			headline: "Agent failed",
			summary: "Write failed.",
			failure: { class: "mutation", message: "Permission denied.", retryable: true, recoverable: true },
			items: [
				makeItem({ id: "context", kind: "context", title: "Loaded project rules", status: "ok" }),
				makeItem({ id: "tool", kind: "tool", title: "Read Notes/A.md", detail: "Read note.", status: "ok", tool: "read", targetPath: "Notes/A.md", step: 1 }),
				makeItem({ id: "mutation", kind: "mutation", title: "write Notes/B.md", detail: "Permission denied.", status: "failed", targetPath: "Notes/B.md", step: 2 }),
			],
			mutations: [
				{ id: "m1", event: "apply_failed", operation: "write", targetPath: "Notes/B.md", status: "failed", summary: "Write failed.", reason: "Permission denied." },
			],
			actions: [
				{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-current"), 0);
	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.equal(root.countByClass("friday-agent-process-mutations"), 0);
	assert.equal(root.countByClass("friday-agent-process-recovery"), 0);
	assert.equal(root.countByClass("friday-agent-process-timeline-item") >= 2, true);
	assert.equal(root.countByClass("friday-agent-process-step"), 0);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	assert.match(root.textContent, /读取项目现状/);
	assert.match(root.textContent, /运行遇到问题/);
	assert.match(root.textContent, /Notes\/A\.md/);
	assert.match(root.textContent, /Permission denied/);
});

test("renderAgentTrajectoryCard expanded process panel uses linear timeline DOM contract", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Agent is using tools",
			summary: "Reading project state.",
			time: { startedAt: "2026-05-06T00:00:00.000Z", updatedAt: "2026-05-06T00:00:18.000Z", durationMs: 18000 },
			items: [
				makeItem({ id: "context", kind: "context", title: "Loaded project rules", detail: "Loaded AGENTS.md.", status: "ok" }),
				makeItem({ id: "read", kind: "tool", title: "Read renderer", detail: "Read renderer state.", status: "ok", tool: "read", targetPath: "src/views/agentTrajectoryRenderer.ts" }),
				makeItem({ id: "transport", kind: "transport", title: "Model transport", detail: "Model request retry scheduled after HTTP 504; attempt 3/5; backoff 700ms", status: "running", rawEventType: "retry_scheduled" }),
			],
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-shell"), 1);
	assert.equal(root.countByClass("friday-agent-process-timeline-panel"), 1);
	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.equal(root.countByClass("friday-agent-process-timeline-item"), 3);
	assert.equal(root.countByClass("friday-agent-process-timeline-rail"), 3);
	assert.equal(root.countByClass("friday-agent-process-timeline-marker"), 3);
	assert.equal(root.countByClass("friday-agent-process-timeline-content"), 3);
	assert.match(root.textContent, /正在恢复请求 18s/);
	assert.match(root.textContent, /收到任务/);
	assert.match(root.textContent, /读取项目现状/);
	assert.match(root.textContent, /恢复请求/);
	assert.doesNotMatch(root.textContent, /正在重试|处理连接重试/);
	assert.doesNotMatch(root.textContent, /HTTP 504|700ms|Context|Tools|Review|Finalize/);
	assert.equal(root.countByClass("friday-agent-process-step"), 0);
});

test("renderAgentTrajectoryCard expanded process panel renders a status bar and phase groups", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "FRIDAY 正在处理",
			summary: "正在读取项目文件。",
			time: { startedAt: "2026-05-06T00:00:00.000Z", updatedAt: "2026-05-06T00:00:12.000Z", durationMs: 12000 },
			items: [
				makeItem({ id: "ack", kind: "narration", title: "收到任务", detail: "我会先理解你的需求。", status: "ok", rawEventType: "narration_report", narrationKind: "task_acknowledged" }),
				makeItem({ id: "plan", kind: "narration", title: "整理方案", detail: "先看文件，再更新内容。", status: "ok", rawEventType: "narration_report", narrationKind: "plan_declared" }),
				makeItem({ id: "read", kind: "tool", title: "Read Project/a.md", detail: "读取参考文件。", status: "running", tool: "read", targetPath: "Project/a.md" }),
			],
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-statusbar"), 1);
	assert.equal(root.countByClass("friday-agent-process-phase-groups"), 1);
	assert.equal(root.countByClass("friday-agent-process-phase-group"), 3);
	assert.equal(root.countByClass("friday-agent-process-timeline-item"), 3);
	assert.match(root.textContent, /执行/);
	assert.match(root.textContent, /读取项目现状/);
	assert.match(root.textContent, /12s/);
	assert.match(root.textContent, /收到任务/);
	assert.match(root.textContent, /计划/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
});

test("renderAgentTrajectoryCard renders reasoning visibleSummary without raw reasoning or fixed tabs", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const rawCot = "raw chain of thought must not be visible";

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:08.000Z", durationMs: 8000 },
			items: [
				makeItem({
					id: "reasoning",
					kind: "reasoning",
					title: "FRIDAY 的思路",
					detail: "Checked the request and current workspace.",
					status: "ok",
					rawEventType: "model_response",
					rawReasoning: rawCot,
				}),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answer.", status: "ok" }),
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.match(root.textContent, /已处理 8s/);
	assert.match(root.textContent, /整理方案/);
	assert.match(root.textContent, /Checked the request and current workspace/);
	assert.equal(root.textContent.includes(rawCot), false);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
});

test("renderAgentAnswerFlow renders visible narration in process and keeps final answer separate", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			time: { startedAt: "2026-05-06T00:00:00.000Z", completedAt: "2026-05-06T00:00:12.000Z", durationMs: 12000 },
			items: [
				makeItem({
					id: "narration-ack",
					kind: "narration",
					title: "收到任务",
					detail: "需要把过程叙事放进线性时间线。",
					status: "ok",
					rawEventType: "narration_report",
					narrationKind: "task_acknowledged",
				}),
				makeItem({
					id: "narration-plan",
					kind: "narration",
					title: "整理方案",
					detail: "先确认上下文，再执行修改。",
					status: "ok",
					rawEventType: "narration_report",
					narrationKind: "plan_declared",
				}),
				makeItem({
					id: "narration-stage",
					kind: "narration",
					title: "阶段性汇报",
					detail: "已读取相关文件，接下来实现事件链路。",
					status: "ok",
					rawEventType: "narration_report",
					narrationKind: "stage_report",
				}),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "结论已完成。", status: "ok" }),
			],
		}),
		expanded: true,
		renderContent: (containerEl) => {
			containerEl.createDiv({ cls: "final-answer", text: "结论已完成。" });
		},
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
		onToggle: () => {},
	});

	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.equal(root.countByClass("friday-agent-process-timeline-item"), 4);
	assert.equal(root.countByClass("friday-ai-answer-content"), 1);
	assert.match(root.textContent, /收到任务/);
	assert.match(root.textContent, /整理方案/);
	assert.match(root.textContent, /阶段性汇报/);
	assert.match(root.findByClass("friday-ai-answer-content")?.textContent ?? "", /结论已完成/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b|raw chain of thought/i);
});

test("renderAgentTrajectoryCard shows approval actions in collapsed timeline disclosure", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "waiting_for_approval",
			summary: "1 file change pending review.",
			items: [
				makeItem({ id: "write", kind: "tool", title: "Write Notes/A.md", detail: "Prepared edit.", status: "ok", tool: "write", targetPath: "Notes/A.md" }),
				makeItem({ id: "approval", kind: "approval", title: "Approval required", detail: "1 file change pending review.", status: "waiting", tool: "write", targetPath: "Notes/A.md" }),
			],
			mutations: [
				{ id: "m1", event: "planned", operation: "write", targetPath: "Notes/A.md", status: "pending", summary: "Prepared edit.", reason: "" },
			],
			actions: [
				{ id: "apply", label: "应用", enabled: true, targetId: "m1" },
				{ id: "reject", label: "拒绝", enabled: true, targetId: "m1" },
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-timeline-panel"), 0);
	assert.match(root.textContent, /等待确认/);
	assert.match(root.textContent, /需要你确认/);
	assert.match(root.textContent, /查看改动/);
	assert.match(root.textContent, /应用/);
	assert.match(root.textContent, /拒绝/);
	root.findByClass("is-apply")?.onclick?.();
	root.findByClass("is-reject")?.onclick?.();
	assert.deepEqual(calls, ["apply", "reject"]);
});

test("renderAgentTrajectoryCard renders Batch M.1 transport retry as reconnecting without checkpoint claims", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.ok(root.hasClassInTree("is-retrying"));
	assert.match(root.textContent, /恢复请求/);
	assert.match(root.textContent, /第 1\/5 次/);
	assert.doesNotMatch(root.textContent, /第 1\/4 次重试|模型连接不稳定/);
	assert.doesNotMatch(root.textContent, /正在重试|处理连接重试/);
	assert.doesNotMatch(root.textContent, /HTTP 504|700ms/);
	assert.doesNotMatch(root.textContent, /checkpoint|resume/i);
});

test("renderAgentTrajectoryCard renders pending mutation as the current approval step action row", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "waiting_for_approval",
			summary: "1 file change pending review.",
			items: [
				makeItem({ id: "read", kind: "tool", title: "Read 123/workspace/FRIDAY 介绍.md", status: "ok", tool: "read", targetPath: "123/workspace/FRIDAY 介绍.md" }),
				makeItem({ id: "write", kind: "tool", title: "Write 123/workspace/FRIDAY 设计理念.md", detail: "Wrote draft content.", status: "ok", tool: "write", targetPath: "123/workspace/FRIDAY 设计理念.md" }),
				makeItem({ id: "approval", kind: "approval", title: "Approval required", detail: "1 file change pending review.", status: "waiting", tool: "write", targetPath: "123/workspace/FRIDAY 设计理念.md" }),
			],
			mutations: [
				{ id: "m1", event: "planned", operation: "write", targetPath: "123/workspace/FRIDAY 设计理念.md", status: "pending", summary: "Draft created.", reason: "" },
			],
			actions: [
				{ id: "apply", label: "应用", enabled: true, targetId: "m1" },
				{ id: "reject", label: "拒绝", enabled: true, targetId: "m1" },
			],
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-current"), 0);
	assert.match(root.textContent, /读取项目现状/);
	assert.match(root.textContent, /创建\/修改文件/);
	assert.match(root.textContent, /等待确认/);
	assert.match(root.textContent, /准备修改 1 个文件/);
	assert.match(root.textContent, /查看改动/);
	assert.match(root.textContent, /应用/);
	assert.match(root.textContent, /拒绝/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	root.findByClass("is-apply")?.onclick?.();
	root.findByClass("is-reject")?.onclick?.();
	assert.deepEqual(calls, ["apply", "reject"]);
});

test("renderAgentTrajectoryCard renders complex completed replay as collapsed process disclosure", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Agent finished",
			summary: "Created a sourced answer.",
			privacy: { redacted: true, source: "replay" },
			time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:05.000Z", durationMs: 5000 },
			items: [
				makeItem({ id: "write", kind: "mutation", title: "edit Notes/A.md", detail: "Updated note.", status: "ok", targetPath: "Notes/A.md", step: 1 }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Created a sourced answer.", status: "ok" }),
			],
			mutations: [
				{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
			],
		}),
		variant: "completed",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process"), 1);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.match(root.textContent, /已处理 5s/);
	assert.doesNotMatch(root.textContent, />/);
	assert.doesNotMatch(root.textContent, /Created a sourced answer/);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-current"), 0);
});

test("renderAgentTrajectoryCard hides lifecycle runtime wording from completed replay", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process"), 1);
	assert.doesNotMatch(root.textContent, /Task running|Runtime started for ask mode/);
});

test("renderAgentTrajectoryCard localizes replay actions and never exposes View replay", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "mutation", kind: "mutation", title: "Applied Notes/Updated.md", status: "ok", targetPath: "Notes/Updated.md" }),
			],
			mutations: [
				{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Updated file.", reason: "" },
			],
			actions: [
				{ id: "view_replay", label: "View replay", enabled: true, targetId: "turn-1" },
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-action"), 0);
	assert.doesNotMatch(root.textContent, /View replay/);
});

test("renderAgentAnswerFlow renders assistant answer as document flow with result artifacts", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");
	const opened = [];

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Agent finished",
			items: [
				makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/Updated.md", status: "ok", targetPath: "Notes/Updated.md" }),
			],
			mutations: [
				{ id: "md", event: "applied", operation: "edit", targetPath: "Notes/Updated.md", status: "applied", summary: "Updated note.", reason: "" },
				{ id: "canvas", event: "applied", operation: "write", targetPath: "Maps/Project.canvas", status: "applied", summary: "Updated canvas.", reason: "" },
				{ id: "pending", event: "planned", operation: "edit", targetPath: "Notes/Pending.md", status: "pending", summary: "Pending edit.", reason: "" },
			],
		}),
		isStreaming: false,
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
		onOpenArtifact: (pathValue) => opened.push(pathValue),
	});

	assert.equal(root.countByClass("friday-ai-message"), 0);
	assert.equal(root.countByClass("friday-ai-message-row"), 1);
	assert.equal(root.countByClass("friday-ai-answer-flow"), 1);
	assert.equal(root.countByClass("friday-ai-answer-content"), 1);
	assert.equal(root.countByClass("avatar"), 1);
	assert.equal(root.countByClass("friday-wordmark"), 0);
	assert.equal(root.countByClass("friday-agent-process-header"), 1);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	assert.match(root.textContent, /Final answer body/);
	assert.doesNotMatch(root.textContent, /FRIDAY\s+Final answer body/);
	assert.match(root.textContent, /本次改动/);
	assert.match(root.textContent, /文档 · MD/);
	assert.match(root.textContent, /画布 · Canvas/);
	assert.doesNotMatch(root.textContent, /Pending/);
	const buttons = root.findAllByClass("friday-agent-artifact-open");
	assert.equal(buttons.length, 2);
	buttons[0]?.onclick?.();
	buttons[1]?.onclick?.();
	assert.deepEqual(opened, ["Notes/Updated.md", "Maps/Project.canvas"]);
});

test("renderAgentAnswerFlow places process disclosure before answer body and artifacts after it", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", status: "ok", targetPath: "Notes/A.md" }),
			],
			mutations: [
				{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
			],
		}),
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	const flow = root.findByClass("friday-ai-answer-flow");
	assert.ok(flow, "answer flow should render");
	assert.ok(directChildIndex(flow, "friday-agent-process-shell") >= 0, "process shell should be a direct flow child");
	assert.ok(directChildIndex(flow, "friday-ai-answer-content") >= 0, "answer body should be a direct flow child");
	assert.ok(directChildIndex(flow, "friday-agent-artifacts") >= 0, "artifacts should be a direct flow child");
	assert.ok(
		directChildIndex(flow, "friday-agent-process-shell") < directChildIndex(flow, "friday-ai-answer-content"),
		"process disclosure belongs before the answer body",
	);
	assert.ok(
		directChildIndex(flow, "friday-agent-artifacts") > directChildIndex(flow, "friday-ai-answer-content"),
		"artifacts belong after the answer body",
	);
	assert.equal(flow.findByClass("friday-agent-process-timeline")?.countByClass("friday-agent-artifact-card") ?? 0, 0);
	assert.equal(flow.children.slice(directChildIndex(flow, "friday-ai-answer-content") + 1).some((child) => child.hasClassInTree("friday-agent-process-header")), false);
});

test("renderAgentAnswerFlow opens markdown and canvas artifacts from the result area", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");
	const opened = [];

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "mutation-md", kind: "mutation", title: "edit Notes/A.md", status: "ok", targetPath: "Notes/A.md" }),
				makeItem({ id: "mutation-canvas", kind: "mutation", title: "write Maps/A.canvas", status: "ok", targetPath: "Maps/A.canvas" }),
			],
			mutations: [
				{ id: "applied-md", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
				{ id: "applied-canvas", event: "applied", operation: "write", targetPath: "Maps/A.canvas", status: "applied", summary: "Updated canvas.", reason: "" },
			],
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
		onOpenArtifact: (pathValue) => opened.push(pathValue),
	});

	const artifacts = root.findByClass("friday-agent-artifacts");
	assert.ok(artifacts, "artifact result area should render");
	assert.equal(artifacts.countByClass("friday-agent-artifact-card"), 2);
	assert.equal(root.findByClass("friday-agent-process-timeline")?.countByClass("friday-agent-artifact-card") ?? 0, 0);
	for (const button of artifacts.findAllByClass("friday-agent-artifact-open")) {
		button.onclick?.();
	}
	assert.deepEqual(opened, ["Notes/A.md", "Maps/A.canvas"]);
});

test("renderAgentAnswerFlow inserts expanded process panel between header and answer body", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "tool", kind: "tool", title: "Search project", status: "ok", tool: "search", targetPath: "Notes", step: 1 }),
				makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", status: "ok", targetPath: "Notes/A.md", step: 2 }),
			],
			mutations: [
				{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
			],
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	const flow = root.findByClass("friday-ai-answer-flow");
	assert.ok(flow, "answer flow should render");
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "true");
	assert.equal(root.findByClass("friday-agent-process-chevron")?.attributes["data-icon"], "chevron-up");
	const shell = flow.findByClass("friday-agent-process-shell");
	assert.ok(shell, "process shell should contain header and panel");
	assert.ok(directChildIndex(shell, "friday-agent-process-header") < directChildIndex(shell, "friday-agent-process-panel"));
	assert.ok(directChildIndex(flow, "friday-agent-process-shell") < directChildIndex(flow, "friday-ai-answer-content"));
});

test("renderAgentAnswerFlow toggles process disclosure from the title row and chevron button", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");
	let expanded = false;
	let toggleCount = 0;
	const render = () => {
		root.empty();
		renderAgentAnswerFlow({
			containerEl: root,
			snapshot: makeSnapshot({
				status: "completed",
				privacy: { redacted: true, source: "replay" },
				items: [
					makeItem({ id: "tool", kind: "tool", title: "Search project", status: "ok", tool: "search", targetPath: "Notes" }),
					makeItem({ id: "final", kind: "final", title: "Final response", status: "ok" }),
				],
			}),
			expanded,
			onToggle: () => {
				toggleCount += 1;
				expanded = !expanded;
				render();
			},
			renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
			renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
		});
	};

	render();
	const header = root.findByClass("friday-agent-process-disclosure");
	assert.ok(header?.classes.has("is-clickable"));
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	header?.onclick?.();
	assert.equal(toggleCount, 1);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "true");
	assert.equal(root.findByClass("friday-agent-process-chevron")?.attributes["data-icon"], "chevron-up");
	assert.equal(root.countByClass("friday-agent-process-panel"), 1);
	root.findByClass("friday-agent-process-toggle")?.onclick?.({ stopPropagation: () => {} });
	assert.equal(toggleCount, 2);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
});

test("renderAgentAnswerFlow uses identity header without process disclosure for simple completed answers", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Answer finished",
			summary: "你好。",
			items: [
				makeItem({ id: "model", kind: "model", title: "Model response", detail: "你好。", status: "ok" }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "你好。", status: "ok" }),
			],
		}),
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "你好。" }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /FRIDAY/);
	assert.doesNotMatch(root.textContent, /FRIDAY 的思路/);
	assert.doesNotMatch(root.textContent, /FRIDAY 的工作过程/);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 0);
	assert.equal(root.countByClass("friday-agent-process-toggle"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
});

test("renderAgentAnswerFlow keeps simple workspace read completed process collapsed", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Current note answer." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /已处理 4s/);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.doesNotMatch(root.textContent, /Read Notes\/Today\.md|Evidence|Timeline/i);
});

test("renderAgentAnswerFlow expands completed workspace read process between header and answer", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Current note answer." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-panel"), 1);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.match(root.textContent, /读取项目现状/);
	assert.match(root.textContent, /Notes\/Today\.md/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	assert.ok(
		directChildIndex(root.findByClass("friday-ai-answer-flow"), "friday-agent-process-shell") <
			directChildIndex(root.findByClass("friday-ai-answer-flow"), "friday-ai-answer-content"),
	);
});

test("renderAgentAnswerFlow does not expose process summary text under the disclosure title", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");
	const hiddenSummary = "Internal file-read recap should stay inside structured process details.";

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			summary: hiddenSummary,
			privacy: { redacted: true, source: "replay" },
			time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:00:06.000Z", durationMs: 6000 },
			items: [
				makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read the current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered from the note.", status: "ok" }),
			],
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-panel"), 1);
	assert.equal(root.countByClass("friday-agent-process-summary"), 0);
	assert.equal(root.textContent.includes(hiddenSummary), false);
});

test("renderAgentTrajectoryCard and completed answer flow reuse the same process header class", async () => {
	const { renderAgentTrajectoryCard, renderAgentAnswerFlow } = await loadRenderer();
	const liveRoot = new FakeElement("div");
	const completedRoot = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: liveRoot,
		snapshot: makeSnapshot({
			status: "running",
			items: [
				makeItem({ id: "model", kind: "model", title: "Model step 1", detail: "Thinking.", status: "running" }),
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});
	renderAgentAnswerFlow({
		containerEl: completedRoot,
		snapshot: makeSnapshot({
			status: "completed",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", status: "ok", targetPath: "Notes/A.md" }),
			],
			mutations: [
				{ id: "applied", event: "applied", operation: "edit", targetPath: "Notes/A.md", status: "applied", summary: "Updated note.", reason: "" },
			],
		}),
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Final answer body." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(liveRoot.countByClass("friday-agent-process-header"), 1);
	assert.equal(completedRoot.countByClass("friday-agent-process-header"), 1);
});

test("DailyBoard embeds completed replay in the matching assistant answer row", async () => {
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-current", taskId: "task-current", traceId: "trace-current", conversationId: "conversation-1" },
		status: "completed",
		headline: "Agent finished",
		summary: "Updated the note.",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-07T00:00:00.000Z", completedAt: "2026-05-07T00:00:12.000Z", durationMs: 12000 },
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Updated the note.", status: "ok" }),
		],
	});
	const view = await createDailyBoardHarness({
		aiConversation: [
			{ role: "user", content: "Older prompt", uiMeta: { turnId: "turn-old", taskId: "task-old", conversationId: "conversation-1" } },
			{ role: "assistant", content: "Older answer", uiMeta: { turnId: "turn-old", taskId: "task-old", conversationId: "conversation-1" } },
			{ role: "user", content: "Update the note", uiMeta: { turnId: "turn-current", taskId: "task-current", conversationId: "conversation-1" } },
			{ role: "assistant", content: "Matched assistant answer", uiMeta: completedSnapshot.identity },
		],
		approvalQueue: { list: () => [] },
	});
	view.renderAiMessageContent = (containerEl, message) => {
		containerEl.createDiv({ cls: "test-message-body", text: message.content });
	};
	view.resolveUserDisplayName = () => "User";
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(completedSnapshot), completedSnapshot);
	const root = new FakeElement("div");

	view.renderAiMessageList(root);

	const assistantRows = root
		.findAllByClass("friday-ai-message-row")
		.filter((row) => row.classes.has("is-assistant"));
	const previousAssistantRow = assistantRows.find((row) => row.textContent.includes("Older answer"));
	const matchingAssistantRow = assistantRows.find((row) => row.textContent.includes("Matched assistant answer"));

	assert.ok(previousAssistantRow, "previous assistant answer should render");
	assert.ok(matchingAssistantRow, "matching assistant answer should render");
	assert.equal(previousAssistantRow.countByClass("friday-agent-process-shell"), 0);
	assert.equal(matchingAssistantRow.countByClass("friday-agent-process-shell"), 1);
	assert.equal(matchingAssistantRow.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(matchingAssistantRow.countByClass("friday-ai-answer-content"), 1);

	const matchingFlow = matchingAssistantRow.findByClass("friday-ai-answer-flow");
	assert.ok(matchingFlow, "matching assistant answer should use answer flow");
	const processIndex = directChildIndex(matchingFlow, "friday-agent-process-shell");
	const answerIndex = directChildIndex(matchingFlow, "friday-ai-answer-content");
	assert.ok(processIndex >= 0, "process disclosure should be a direct child of the matching answer flow");
	assert.ok(answerIndex >= 0, "answer content should be a direct child of the matching answer flow");
	assert.ok(processIndex < answerIndex, "process disclosure should render before answer content in the matching row");
	assert.equal(root.children.some((child) => child.classes.has("friday-agent-process-shell")), false);
});

test("DailyBoard suppresses lifecycle-only completed task cards", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const shouldRenderMatch = source.match(/private shouldRenderAgentTaskPanel\([\s\S]*?\n\t\}/);
	assert.ok(shouldRenderMatch, "task panel visibility predicate should exist");
	const shouldRenderBlock = shouldRenderMatch[0] ?? "";

	assert.match(source, /private shouldRenderAgentTaskPanel\(task: AgentTaskViewState\): boolean/);
	assert.match(shouldRenderBlock, /task\.waitingForApproval/);
	assert.match(shouldRenderBlock, /task\.waitingForUser/);
	assert.doesNotMatch(shouldRenderBlock, /task\.pendingMutationCount > 0/);
	assert.doesNotMatch(shouldRenderBlock, /task\.changedFileCount > 0/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "failed"/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "cancelled"/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "completed"/);
	assert.match(shouldRenderBlock, /task\.status === "waiting_for_approval"/);
	assert.match(shouldRenderBlock, /task\.status === "waiting_for_user"/);
	assert.match(source, /private getVisibleAgentTasksForCurrentSession\(\)/);
});

test("renderAgentTrajectoryCard renders trajectory actions without deciding availability", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "failed",
			failure: { class: "tool", message: "grep failed.", retryable: true, recoverable: true },
			items: [
				makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "grep failed.", status: "failed" }),
			],
			actions: [
				{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
				{ id: "apply", label: "Apply", enabled: false, reason: "No pending mutation.", targetId: "plan-1" },
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-action"), 2);
	assert.equal(root.findByClass("is-retry")?.disabled, false);
	assert.equal(root.findByClass("is-apply")?.disabled, true);
	assert.equal(root.findByClass("is-apply")?.attributes.title, "No pending mutation.");
	root.findByClass("is-retry")?.onclick?.();
	root.findByClass("is-apply")?.onclick?.();
	assert.deepEqual(calls, ["retry"]);
});

test("renderAgentTrajectoryCard renders nothing for an empty snapshot", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: null,
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.children.length, 0);
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

function translate(_key, fallback, params = {}) {
	let text = fallback ?? "";
	for (const [key, value] of Object.entries(params)) {
		text = text.replace(`{${key}}`, String(value));
	}
	return text;
}

function directChildIndex(element, className) {
	return element.children.findIndex((child) => child.classes.has(className));
}

function createDailyBoardRuntimeAliases() {
	const obsidianStubPath = path.join(os.tmpdir(), "friday-daily-board-obsidian-stub.cjs");
	const mentionComposerStubPath = path.join(os.tmpdir(), "friday-daily-board-mention-composer-stub.cjs");
	fs.writeFileSync(obsidianStubPath, `
class ItemView { constructor() {} }
class Menu {
	addItem(callback) {
		const item = {
			setTitle() { return item; },
			setIcon() { return item; },
			onClick() { return item; },
		};
		callback(item);
		return this;
	}
	showAtMouseEvent() {}
}
class Notice { constructor() {} }
class TFile {}
class TFolder {}
class ToggleComponent {
	constructor(containerEl) { this.containerEl = containerEl; }
	setValue() { return this; }
	onChange() { return this; }
}
class WorkspaceLeaf {}
const MarkdownRenderer = { renderMarkdown: async () => {} };
function setIcon(element, icon) {
	if (element) {
		element.attributes = { ...(element.attributes || {}), "data-icon": icon };
	}
}
module.exports = { ItemView, MarkdownRenderer, Menu, Notice, TFile, TFolder, ToggleComponent, WorkspaceLeaf, setIcon };
`);
	fs.writeFileSync(mentionComposerStubPath, `
class MentionComposer {
	constructor(options) {
		this.options = options;
		this.snapshot = options.initialSnapshot || { text: "", doc: { type: "doc", content: [] }, selection: null };
		options.parent.createDiv({ cls: "friday-mention-composer-stub" });
	}
	destroy() {}
	focus() {}
	hasFocus() { return false; }
	getSnapshot() { return this.snapshot; }
	insertText() {}
	openAtPicker() {}
}
module.exports = { MentionComposer };
`);
	return {
		obsidian: obsidianStubPath,
		"./components/MentionComposer": mentionComposerStubPath,
	};
}

async function createDailyBoardHarness(overrides = {}) {
	const { DailyBoardView } = await loadDailyBoardView();
	const view = Object.create(DailyBoardView.prototype);
	Object.assign(view, {
		activePage: "chat",
		aiSessionId: "conversation-1",
		aiRuntimeTrajectorySnapshot: null,
		aiRuntimeElapsedTimer: null,
		aiRuntimeTrajectoryStore: { refreshElapsed: () => null },
		aiRuntimeProgressTaskIds: new Set(),
		aiRuntimeLastRenderAt: 0,
		aiForceScrollToBottomOnce: false,
		aiProcessSnapshotsByKey: new Map(),
		aiProcessExpandedKeys: new Set(),
		aiProcessCollapsedKeys: new Set(),
		aiComposerTaskBarExpanded: false,
		aiComposerTaskBarHostEl: null,
		aiMessageListEl: null,
		aiQueueHintEl: null,
		aiErrorEl: null,
		aiSendButtonEl: null,
		aiModelSelectEl: null,
		aiPermissionSelectEl: null,
		aiConversation: [],
		aiAgentTasks: [],
		aiSessions: [],
		aiBusy: false,
		aiQueuedPrompts: [],
		aiLastError: "",
		plugin: makePluginStub(),
		...overrides,
	});
	return view;
}

function makePluginStub() {
	return {
		aiService: { isConfigured: () => true },
		getActiveSoul: () => ({ id: "soul-1", name: "FRIDAY" }),
		listSouls: () => [{ id: "soul-1", name: "FRIDAY" }],
		soulStore: {
			getSoulSync: () => ({ id: "soul-1", name: "FRIDAY" }),
			updateSoul: async () => {},
		},
		settings: {
			activeSoulId: "soul-1",
			agentRuntime: { toolPermissionMode: "manual", fileMutationMode: "review" },
			projects: [{ id: "project-1", name: "Project" }],
			llm: {},
		},
		t: (key) => key,
		saveSettings: async () => {},
		workbenchStateStore: { getEditPlans: () => [] },
	};
}

function makeTaskBarPlan(overrides = {}) {
	const tasks = overrides.tasks ?? [
		{ id: "task-1", title: "确认现状", status: "completed" },
		{ id: "task-2", title: "实现 Composer Task Bar", status: "in_progress" },
		{ id: "task-3", title: "运行验收测试", status: "pending" },
	];
	return {
		visibility: "task_bar",
		status: "running",
		currentTaskId: "task-2",
		tasks,
		...overrides,
	};
}

function makeTaskBarSnapshot(overrides = {}) {
	const baseIdentity = { turnId: "turn-1", taskId: "task-1", traceId: "trace-1", conversationId: "conversation-1" };
	return makeSnapshot({
		status: "running",
		headline: "正在执行计划",
		summary: "正在推进计划。",
		time: { startedAt: "2026-05-07T00:00:00.000Z", updatedAt: "2026-05-07T00:00:12.000Z", durationMs: 12000 },
		plan: makeTaskBarPlan(),
		items: [
			makeItem({ id: "task", kind: "plan", title: "实现 Composer Task Bar", detail: "推进计划。", status: "running" }),
		],
		...overrides,
		identity: { ...baseIdentity, ...(overrides.identity ?? {}) },
		plan: overrides.plan ?? makeTaskBarPlan(),
	});
}

function withMockedWindow(windowStub, callback) {
	const originalWindow = globalThis.window;
	globalThis.window = windowStub;
	try {
		return callback();
	} finally {
		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = originalWindow;
		}
	}
}

class FakeElement {
	constructor(tagName, options = {}) {
		this.tagName = tagName;
		this.children = [];
		this.classes = new Set();
		this.attributes = {};
		this.text = "";
		this.onclick = undefined;
		this.disabled = false;
		this.type = "";
		this.isConnected = true;
		if (typeof options.cls === "string") {
			this.addClasses(options.cls);
		}
		if (typeof options.text === "string") {
			this.text = options.text;
		}
		if (options.attr) {
			this.attributes = { ...options.attr };
		}
	}

	createDiv(options = {}) {
		return this.createChild("div", normalizeOptions(options));
	}

	createEl(tagName, options = {}) {
		return this.createChild(tagName, normalizeOptions(options));
	}

	createSpan(options = {}) {
		return this.createChild("span", normalizeOptions(options));
	}

	addClass(className) {
		this.addClasses(className);
	}

	empty() {
		this.children = [];
		this.text = "";
	}

	setText(text) {
		this.text = text;
	}

	setAttribute(name, value) {
		this.attributes[name] = String(value);
	}

	get textContent() {
		return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
	}

	countByClass(className) {
		return (this.classes.has(className) ? 1 : 0) +
			this.children.reduce((sum, child) => sum + child.countByClass(className), 0);
	}

	hasClassInTree(className) {
		return this.classes.has(className) || this.children.some((child) => child.hasClassInTree(className));
	}

	findByClass(className) {
		if (this.classes.has(className)) {
			return this;
		}
		for (const child of this.children) {
			const found = child.findByClass(className);
			if (found) {
				return found;
			}
		}
		return null;
	}

	findAllByClass(className) {
		return [
			...(this.classes.has(className) ? [this] : []),
			...this.children.flatMap((child) => child.findAllByClass(className)),
		];
	}

	createChild(tagName, options) {
		const child = new FakeElement(tagName, options);
		this.children.push(child);
		return child;
	}

	addClasses(className) {
		for (const item of className.split(/\s+/).filter(Boolean)) {
			this.classes.add(item);
		}
	}
}

function normalizeOptions(options) {
	if (typeof options === "string") {
		return { cls: options };
	}
	return options ?? {};
}
