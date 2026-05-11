/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";
import { assertNoBannedOrdinaryTerms } from "./helpers/ordinarySurfaceContract.mjs";

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
	assert.match(source, /return this\.isSnapshotOwnedBySession\(replaySnapshot, normalizedTargetConversationId\) \? replaySnapshot : null/);
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
	assert.doesNotMatch(getSnapshotBlock, /lastAssistantIndex/);
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

test("DailyBoard keeps local intake preview through runtime preflight and clears on visible work", async () => {
	const preflightSnapshot = makeSnapshot({
		status: "running",
		time: { startedAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:01.000Z", durationMs: 1000 },
		items: [
			makeItem({ id: "live:start", kind: "system", title: "Runtime started", detail: "Runtime started.", status: "running", rawEventType: "start" }),
			makeItem({ id: "live:context:instructions", kind: "context", title: "Context: instructions", detail: "加载项目规则与 Soul 设定", status: "running", rawEventType: "context" }),
			makeItem({ id: "live:model:1", kind: "model", title: "Model step 1", detail: "Model request started.", status: "running", rawEventType: "model_request" }),
		],
	});
	const visibleSnapshot = makeSnapshot({
		status: "running",
		time: { startedAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:02.000Z", durationMs: 2000 },
		items: [
			makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Reading note.", status: "running", tool: "read", targetPath: "Notes/Today.md" }),
		],
	});
	const snapshots = [preflightSnapshot, visibleSnapshot];
	const view = await createDailyBoardHarness({
		aiLocalIntakePreview: "FRIDAY 正在理解你的请求",
		aiRuntimeTrajectoryStore: {
			appendProgress: () => snapshots.shift(),
			completeFromProgress: () => visibleSnapshot,
			refreshElapsed: () => null,
		},
		bindRuntimeSnapshotToLatestUserMessage: () => {},
		syncAiRuntimeShell: () => {},
		syncBackgroundAgentStatus: () => {},
	});

	withMockedWindow({ setTimeout: () => 1, clearTimeout: () => {} }, () => {
		view.handleRuntimeProgress({ phase: "start", message: "Runtime started." });
	});
	assert.equal(view.aiLocalIntakePreview, "FRIDAY 正在理解你的请求");

	withMockedWindow({ setTimeout: () => 1, clearTimeout: () => {} }, () => {
		view.handleRuntimeProgress({ phase: "tool_call", message: "Reading note." });
	});
	assert.equal(view.aiLocalIntakePreview, "");
});

test("DailyBoard renders live stage reports as assistant replies outside the process panel", async () => {
	const messageListEl = new FakeElement("div");
	const stageText = "已读取相关文件，接下来整理结论。";
	const view = await createDailyBoardHarness({
		activePage: "chat",
		aiMessageListEl: messageListEl,
		aiRuntimeTrajectoryStore: {
			appendProgress: () => makeSnapshot({
				status: "running",
				headline: "FRIDAY 正在处理",
				summary: "",
				items: [],
			}),
			completeFromProgress: () => makeSnapshot(),
			refreshElapsed: () => null,
		},
		bindRuntimeSnapshotToLatestUserMessage: () => {},
		syncLiveRuntimeProgressProcess: () => false,
		syncAiRuntimeShell: () => {
			messageListEl.empty();
			view.renderAiMessageList(messageListEl);
		},
		syncBackgroundAgentStatus: () => {},
	});
	view.renderAiMessageContent = (containerEl, message) => {
		containerEl.createDiv({ cls: "test-message-body", text: message.content });
	};
	view.resolveUserDisplayName = () => "User";

	withMockedWindow({ setTimeout: () => 1, clearTimeout: () => {} }, () => {
		view.handleRuntimeProgress({
			phase: "narration",
			depth: 0,
			message: stageText,
			narration: {
				kind: "stage_report",
				summary: stageText,
				justDone: "已读取相关文件",
				next: "接下来整理结论",
				source: "model",
			},
		});
	});

	const stageReply = messageListEl
		.findAllByClass("test-message-body")
		.find((item) => item.textContent.includes(stageText));
	assert.ok(stageReply, "stage report should render as a normal assistant reply");
	assert.equal(messageListEl.countByClass("friday-agent-process-timeline-item"), 0);
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

test("DailyBoard completes an in-flight turn into the starting session after switching session and project", async () => {
	const savedSessions = [];
	const syncSnapshots = [];
	let executeOptions;
	let resolveExecute;
	let executeStarted;
	const executeStartedPromise = new Promise((resolve) => {
		executeStarted = resolve;
	});
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-original", taskId: "task-original", traceId: "trace-original", conversationId: "conversation-1" },
		status: "completed",
		headline: "Original task finished",
	});
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-1";
	plugin.settings.projects = [
		{ projectId: "project-1", projectName: "Project One", boundaryPath: "ProjectOne" },
		{ projectId: "project-2", projectName: "Project Two", boundaryPath: "ProjectTwo" },
	];
	plugin.settings.llm = { enableStreaming: true };
	plugin.conversationService = {
		createSessionId: () => "created-session",
		saveSession: async (input) => {
			const saved = {
				...input,
				messages: input.messages.map((message) => ({
					...message,
					...(message.uiMeta ? { uiMeta: { ...message.uiMeta } } : {}),
				})),
			};
			savedSessions.push(saved);
			return {
				sessionId: input.sessionId,
				soulId: input.soulId,
				projectId: input.projectId,
				updatedAt: "2026-05-08T00:00:00.000Z",
				filePath: `${input.sessionId}.jsonl`,
				messages: saved.messages,
			};
		},
	};
	plugin.executionPlanner = {
		plan: async () => ({
			mode: "runtime",
			runtimePrompt: "Original prompt",
			allowedTools: [],
			allowedModels: [],
		}),
	};
	plugin.executionOrchestrator = {
		execute: async (_decision, options) => {
			executeOptions = options;
			executeStarted();
			return new Promise((resolve) => {
				resolveExecute = () => resolve({
					assistantText: "Assistant answer for original session.",
					turnId: "turn-original",
					conversationId: "conversation-1",
					taskId: "task-original",
					task: {
						id: "task-original",
						conversationId: "conversation-1",
						turnId: "turn-original",
						status: "completed",
						title: "Original task",
						summary: "Original task finished.",
						availableActions: [],
						pendingMutationCount: 0,
						changedFileCount: 0,
					},
					traces: [],
				});
			});
		},
	};
	plugin.agentRuntimeService = {
		readTurnReplaySummary: async () => ({ totalEvents: 0 }),
	};
	plugin.skillCommandService = {
		parseSlashCommand: () => ({ type: "none" }),
	};
	plugin.slashCommandService = {
		expand: () => ({ type: "none" }),
	};
	const view = await createDailyBoardHarness({
		plugin,
		aiSessionId: "conversation-1",
		aiConversation: [{ role: "user", content: "Existing original message" }],
		aiRuntimeTrajectoryStore: {
			reset: () => {},
			getCompletedSnapshot: () => completedSnapshot,
			refreshElapsed: () => null,
		},
		aiComposerSnapshot: { doc: null, text: "", tokens: [] },
		aiDraft: "",
		composer: { replaceSnapshot: () => {}, hasFocus: () => false },
		mentionResolver: { resolve: async () => ({ errors: [], entries: [] }) },
		app: {
			workspace: { getActiveFile: () => null },
			vault: {
				getAbstractFileByPath: () => null,
				cachedRead: async () => "",
			},
		},
		syncAiLiveChatShell: () => {
			syncSnapshots.push({
				sessionId: view.aiSessionId,
				streamingPreview: view.aiStreamingPreview,
				messages: view.aiConversation.map((message) => message.content),
			});
		},
		syncBackgroundAgentStatus: () => {},
		flushQueuedAiPrompt: async () => {},
	});

	const originalWindow = globalThis.window;
	globalThis.window = {
		setTimeout: (callback) => {
			callback();
			return 1;
		},
		clearTimeout: () => {},
	};

	try {
		const submitPromise = view.submitAiPrompt({ doc: null, text: "Original prompt", tokens: [] });
		await executeStartedPromise;

		assert.equal(executeOptions.conversationId, "conversation-1");
		assert.deepEqual(executeOptions.conversation.map((message) => message.content), ["Existing original message"]);

		view.aiSessionId = "conversation-2";
		view.aiConversation = [{ role: "user", content: "Other session message" }];
		plugin.settings.activeProjectId = "project-2";
		resolveExecute();
		await submitPromise;
	} finally {
		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = originalWindow;
		}
	}

	assert.equal(savedSessions.length, 1);
	assert.equal(savedSessions[0].sessionId, "conversation-1");
	assert.equal(savedSessions[0].projectId, "project-1");
	assert.deepEqual(savedSessions[0].messages.map((message) => message.content), [
		"Existing original message",
		"Original prompt",
		"Assistant answer for original session.",
	]);
	assert.equal(view.aiSessionId, "conversation-2");
	assert.deepEqual(view.aiConversation.map((message) => message.content), ["Other session message"]);
	assert.equal(view.aiProcessSnapshotsByKey.get(view.getTrajectorySnapshotKey(completedSnapshot)), completedSnapshot);
	assert.equal(
		syncSnapshots.some((snapshot) =>
			snapshot.sessionId === "conversation-2" &&
			snapshot.streamingPreview.includes("Assistant answer for original session.")
		),
		false,
	);
});

test("DailyBoard does not append a final answer to the current UI array after only switching project", async () => {
	const savedSessions = [];
	const syncSnapshots = [];
	let executeOptions;
	let resolveExecute;
	let executeStarted;
	const executeStartedPromise = new Promise((resolve) => {
		executeStarted = resolve;
	});
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-project", taskId: "task-project", traceId: "trace-project", conversationId: "conversation-1" },
		status: "completed",
		headline: "Original project finished",
	});
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-1";
	plugin.settings.projects = [
		{ projectId: "project-1", projectName: "Project One", boundaryPath: "ProjectOne" },
		{ projectId: "project-2", projectName: "Project Two", boundaryPath: "ProjectTwo" },
	];
	plugin.settings.llm = { enableStreaming: true };
	plugin.conversationService = {
		createSessionId: () => "created-session",
		saveSession: async (input) => {
			const saved = {
				...input,
				messages: input.messages.map((message) => ({
					...message,
					...(message.uiMeta ? { uiMeta: { ...message.uiMeta } } : {}),
				})),
			};
			savedSessions.push(saved);
			return {
				sessionId: input.sessionId,
				soulId: input.soulId,
				projectId: input.projectId,
				updatedAt: "2026-05-08T00:00:00.000Z",
				filePath: `${input.sessionId}.jsonl`,
				messages: saved.messages,
			};
		},
	};
	plugin.executionPlanner = {
		plan: async () => ({
			mode: "runtime",
			runtimePrompt: "Original prompt",
			allowedTools: [],
			allowedModels: [],
		}),
	};
	plugin.executionOrchestrator = {
		execute: async (_decision, options) => {
			executeOptions = options;
			executeStarted();
			return new Promise((resolve) => {
				resolveExecute = () => resolve({
					assistantText: "Assistant answer for original project.",
					turnId: "turn-project",
					conversationId: "conversation-1",
					taskId: "task-project",
					task: {
						id: "task-project",
						conversationId: "conversation-1",
						turnId: "turn-project",
						status: "completed",
						title: "Original project task",
						summary: "Original project task finished.",
						availableActions: [],
						pendingMutationCount: 0,
						changedFileCount: 0,
					},
					traces: [],
				});
			});
		},
	};
	plugin.agentRuntimeService = {
		readTurnReplaySummary: async () => ({ totalEvents: 0 }),
	};
	plugin.skillCommandService = {
		parseSlashCommand: () => ({ type: "none" }),
	};
	plugin.slashCommandService = {
		expand: () => ({ type: "none" }),
	};
	const originalConversationArray = [{ role: "user", content: "Existing original message" }];
	const view = await createDailyBoardHarness({
		plugin,
		aiSessionId: "conversation-1",
		aiConversation: originalConversationArray,
		aiRuntimeTrajectoryStore: {
			reset: () => {},
			getCompletedSnapshot: () => completedSnapshot,
			refreshElapsed: () => null,
		},
		aiComposerSnapshot: { doc: null, text: "", tokens: [] },
		aiDraft: "",
		composer: { replaceSnapshot: () => {}, hasFocus: () => false },
		mentionResolver: { resolve: async () => ({ errors: [], entries: [] }) },
		app: {
			workspace: { getActiveFile: () => null },
			vault: {
				getAbstractFileByPath: () => null,
				cachedRead: async () => "",
			},
		},
		syncAiLiveChatShell: () => {
			syncSnapshots.push({
				projectId: plugin.settings.activeProjectId,
				sessionId: view.aiSessionId,
				streamingPreview: view.aiStreamingPreview,
				messages: view.aiConversation.map((message) => message.content),
			});
		},
		syncBackgroundAgentStatus: () => {},
		flushQueuedAiPrompt: async () => {},
	});

	const originalWindow = globalThis.window;
	globalThis.window = {
		setTimeout: (callback) => {
			callback();
			return 1;
		},
		clearTimeout: () => {},
	};

	try {
		const submitPromise = view.submitAiPrompt({ doc: null, text: "Original prompt", tokens: [] });
		await executeStartedPromise;

		assert.equal(executeOptions.conversationId, "conversation-1");
		assert.deepEqual(executeOptions.conversation.map((message) => message.content), ["Existing original message"]);
		assert.equal(view.aiSessionId, "conversation-1");

		plugin.settings.activeProjectId = "project-2";
		resolveExecute();
		await submitPromise;
	} finally {
		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = originalWindow;
		}
	}

	assert.equal(savedSessions.length, 1);
	assert.equal(savedSessions[0].sessionId, "conversation-1");
	assert.equal(savedSessions[0].projectId, "project-1");
	assert.deepEqual(savedSessions[0].messages.map((message) => message.content), [
		"Existing original message",
		"Original prompt",
		"Assistant answer for original project.",
	]);
	assert.equal(view.aiSessionId, "conversation-1");
	assert.equal(plugin.settings.activeProjectId, "project-2");
	assert.equal(
		view.aiConversation.some((message) => message.role === "assistant" && message.content.includes("original project")),
		false,
	);
	assert.equal(
		syncSnapshots.some((snapshot) =>
			snapshot.projectId === "project-2" &&
			snapshot.messages.some((content) => content.includes("Assistant answer for original project."))
		),
		false,
	);
});

test("DailyBoard does not replay an origin project completed snapshot after only switching project", async () => {
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-2";
	plugin.settings.projects = [
		{ projectId: "project-1", projectName: "Project One", boundaryPath: "ProjectOne" },
		{ projectId: "project-2", projectName: "Project Two", boundaryPath: "ProjectTwo" },
	];
	const originSnapshot = makeSnapshot({
		identity: { turnId: "turn-shared", taskId: "task-shared", traceId: "trace-shared", conversationId: "conversation-1" },
		status: "completed",
		headline: "Origin project completed",
		items: [
			makeItem({ id: "origin-final", kind: "final", title: "Final response", detail: "Origin project replay.", status: "ok" }),
		],
	});
	const view = await createDailyBoardHarness({
		plugin,
		aiSessionId: "conversation-1",
		aiConversation: [
			{ role: "user", content: "Current project prompt", uiMeta: { turnId: "turn-shared", taskId: "task-shared", conversationId: "conversation-1" } },
			{ role: "assistant", content: "Current project answer", uiMeta: { turnId: "turn-shared", taskId: "task-shared", conversationId: "conversation-1" } },
		],
		approvalQueue: { list: () => [] },
	});
	view.renderAiMessageContent = (containerEl, message) => {
		containerEl.createDiv({ cls: "test-message-body", text: message.content });
	};
	view.resolveUserDisplayName = () => "User";
	view.rememberCompletedTrajectorySnapshotForSession(originSnapshot, "conversation-1", "project-1");
	const root = new FakeElement("div");

	view.renderAiMessageList(root);

	const assistantRow = root
		.findAllByClass("friday-ai-message-row")
		.find((row) => row.classes.has("is-assistant") && row.textContent.includes("Current project answer"));
	assert.ok(assistantRow, "current project assistant row should render");
	assert.equal(assistantRow.countByClass("friday-agent-process-shell"), 0);
	assert.doesNotMatch(assistantRow.textContent, /Origin project replay/);
});

test("DailyBoard shows background status for non-current turn targets and restores them on click", async () => {
	const runningPlugin = makePluginStub();
	runningPlugin.settings.activeProjectId = "project-2";
	runningPlugin.setActiveProject = async (projectId) => {
		runningPlugin.settings.activeProjectId = projectId;
	};
	const runningTarget = {
		sessionId: "conversation-1",
		projectId: "project-1",
		conversation: [{ role: "user", content: "Origin running prompt" }],
	};
	const runningHost = new FakeElement("div");
	let runningRenderCalls = 0;
	const runningView = await createDailyBoardHarness({
		activePage: "chat",
		plugin: runningPlugin,
		aiBusy: true,
		aiSessionId: "conversation-2",
		aiConversation: [{ role: "user", content: "Current chat prompt" }],
		aiActiveTurnTarget: runningTarget,
		aiBackgroundTurnTarget: runningTarget,
		renderBoard: () => {
			runningRenderCalls += 1;
		},
	});

	runningView.renderBackgroundAgentStatus(runningHost);

	const runningButton = runningHost.findByClass("friday-background-agent-status");
	assert.ok(runningButton, "running background status should render on chat when its target is not current");
	assert.equal(runningButton.classes.has("is-running"), true);
	await runningButton.onclick?.();
	assert.equal(runningPlugin.settings.activeProjectId, "project-1");
	assert.equal(runningView.aiSessionId, "conversation-1");
	assert.deepEqual(runningView.aiConversation.map((message) => message.content), ["Origin running prompt"]);
	assert.equal(runningView.activePage, "chat");
	assert.equal(runningRenderCalls, 1);

	const completedPlugin = makePluginStub();
	completedPlugin.settings.activeProjectId = "project-2";
	completedPlugin.setActiveProject = async (projectId) => {
		completedPlugin.settings.activeProjectId = projectId;
	};
	const completedTarget = {
		sessionId: "conversation-1",
		projectId: "project-1",
		conversation: [
			{ role: "user", content: "Origin completed prompt" },
			{ role: "assistant", content: "Origin completed answer" },
		],
	};
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-completed", taskId: "task-completed", traceId: "trace-completed", conversationId: "conversation-1" },
		status: "completed",
		headline: "Origin turn completed",
	});
	const completedHost = new FakeElement("div");
	let completedRenderCalls = 0;
	const completedView = await createDailyBoardHarness({
		activePage: "chat",
		plugin: completedPlugin,
		aiBusy: false,
		aiSessionId: "conversation-2",
		aiConversation: [{ role: "user", content: "Current chat prompt" }],
		aiBackgroundTurnTarget: completedTarget,
		renderBoard: () => {
			completedRenderCalls += 1;
		},
	});
	completedView.rememberCompletedTrajectorySnapshotForSession(completedSnapshot, "conversation-1", "project-1");

	completedView.renderBackgroundAgentStatus(completedHost);

	const completedButton = completedHost.findByClass("friday-background-agent-status");
	assert.ok(completedButton, "completed background status should render on chat when its target is not current");
	assert.equal(completedButton.classes.has("is-completed"), true);
	await completedButton.onclick?.();
	assert.equal(completedPlugin.settings.activeProjectId, "project-1");
	assert.equal(completedView.aiSessionId, "conversation-1");
	assert.deepEqual(completedView.aiConversation.map((message) => message.content), [
		"Origin completed prompt",
		"Origin completed answer",
	]);
	assert.equal(completedView.activePage, "chat");
	assert.equal(completedRenderCalls, 1);
});

test("DailyBoard keeps background turn failures out of the current chat error and binds failed status to its target", async () => {
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-1";
	plugin.settings.projects = [
		{ projectId: "project-1", projectName: "Project One", boundaryPath: "ProjectOne" },
		{ projectId: "project-2", projectName: "Project Two", boundaryPath: "ProjectTwo" },
	];
	plugin.setActiveProject = async (projectId) => {
		plugin.settings.activeProjectId = projectId;
	};
	plugin.conversationService = {
		createSessionId: () => "created-session",
		saveSession: async (input) => ({
			sessionId: input.sessionId,
			soulId: input.soulId,
			projectId: input.projectId,
			updatedAt: "2026-05-08T00:00:00.000Z",
			filePath: `${input.sessionId}.jsonl`,
			messages: input.messages,
		}),
	};
	let rejectExecute;
	let executeStarted;
	const executeStartedPromise = new Promise((resolve) => {
		executeStarted = resolve;
	});
	plugin.executionPlanner = {
		plan: async () => ({
			mode: "runtime",
			runtimePrompt: "Original prompt",
			allowedTools: [],
			allowedModels: [],
		}),
	};
	plugin.executionOrchestrator = {
		execute: async () => {
			executeStarted();
			return new Promise((_resolve, reject) => {
				rejectExecute = () => reject(new Error("background boom"));
			});
		},
	};
	plugin.skillCommandService = { parseSlashCommand: () => ({ type: "none" }) };
	plugin.slashCommandService = { expand: () => ({ type: "none" }) };
	const statusHost = new FakeElement("div");
	const errorHost = new FakeElement("div");
	const view = await createDailyBoardHarness({
		activePage: "chat",
		plugin,
		aiSessionId: "conversation-1",
		aiConversation: [{ role: "user", content: "Origin existing prompt" }],
		aiBackgroundAgentStatusHostEl: statusHost,
		aiErrorEl: errorHost,
		aiRuntimeTrajectoryStore: {
			reset: () => {},
			refreshElapsed: () => null,
		},
		aiComposerSnapshot: { doc: null, text: "", tokens: [] },
		aiDraft: "",
		composer: { replaceSnapshot: () => {}, hasFocus: () => false },
		mentionResolver: { resolve: async () => ({ errors: [], entries: [] }) },
		app: {
			workspace: { getActiveFile: () => null },
			vault: {
				getAbstractFileByPath: () => null,
				cachedRead: async () => "",
			},
		},
		flushQueuedAiPrompt: async () => {},
		renderBoard: () => {},
	});

	const submitPromise = view.submitAiPrompt({ doc: null, text: "Original prompt", tokens: [] });
	await executeStartedPromise;
	view.aiSessionId = "conversation-2";
	view.aiConversation = [{ role: "user", content: "Current project prompt" }];
	plugin.settings.activeProjectId = "project-2";
	rejectExecute();
	await submitPromise;

	assert.equal(view.aiLastError, "");
	view.syncAiErrorRegion();
	assert.equal(errorHost.countByClass("friday-ai-error"), 0);
	view.renderBackgroundAgentStatus(statusHost);
	const failedButton = statusHost.findByClass("friday-background-agent-status");
	assert.ok(failedButton, "failed background status should render for the origin turn");
	assert.equal(failedButton.classes.has("is-failed"), true);
	await failedButton.onclick?.();
	assert.equal(plugin.settings.activeProjectId, "project-1");
	assert.equal(view.aiSessionId, "conversation-1");
	assert.deepEqual(view.aiConversation.map((message) => message.content), [
		"Origin existing prompt",
		"Original prompt",
	]);
});

test("DailyBoard refreshes a chat-page non-current background status after it completes", async () => {
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-2";
	const target = {
		sessionId: "conversation-1",
		projectId: "project-1",
		conversation: [{ role: "user", content: "Origin prompt" }],
	};
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-background", taskId: "task-background", traceId: "trace-background", conversationId: "conversation-1" },
		status: "completed",
		headline: "Background completed",
	});
	const statusHost = new FakeElement("div");
	const view = await createDailyBoardHarness({
		activePage: "chat",
		plugin,
		aiBusy: true,
		aiSessionId: "conversation-2",
		aiConversation: [{ role: "user", content: "Current prompt" }],
		aiActiveTurnTarget: target,
		aiBackgroundTurnTarget: target,
		aiBackgroundAgentStatusHostEl: statusHost,
	});
	view.renderBackgroundAgentStatus(statusHost);
	assert.equal(statusHost.findByClass("friday-background-agent-status")?.classes.has("is-running"), true);

	view.aiBusy = false;
	view.aiActiveTurnTarget = null;
	view.aiRuntimeTrajectorySnapshot = null;
	view.rememberCompletedTrajectorySnapshotForSession(completedSnapshot, "conversation-1", "project-1");
	view.syncBackgroundAgentStatus();

	assert.equal(statusHost.findByClass("friday-background-agent-status")?.classes.has("is-running"), false);
	assert.equal(statusHost.findByClass("friday-background-agent-status")?.classes.has("is-completed"), true);
});

test("DailyBoard opens background targets through session hydration and clears stale derived state", async () => {
	const plugin = makePluginStub();
	plugin.settings.activeProjectId = "project-2";
	plugin.setActiveProject = async (projectId) => {
		plugin.settings.activeProjectId = projectId;
	};
	let renderCalls = 0;
	let hydrateTaskCalls = 0;
	let hydrateSnapshotCalls = 0;
	let clearedToolPolicyCalls = 0;
	let clearedApprovalRuleCalls = 0;
	plugin.agentRuntimeService.clearAllSessionToolPolicyOverrides = () => {
		clearedToolPolicyCalls += 1;
	};
	plugin.toolApprovalService.clearSessionRules = () => {
		clearedApprovalRuleCalls += 1;
	};
	const persistedMessages = [
		{ role: "user", content: "Hydrated persisted prompt" },
		{ role: "assistant", content: "Hydrated persisted answer" },
	];
	const view = await createDailyBoardHarness({
		plugin,
		aiSessionId: "conversation-2",
		aiConversation: [{ role: "user", content: "Current prompt" }],
		aiSessions: [
			{
				sessionId: "conversation-1",
				soulId: "soul-1",
				projectId: "project-1",
				updatedAt: "2026-05-08T00:00:00.000Z",
				filePath: "conversation-1.jsonl",
				messages: persistedMessages,
			},
		],
		aiLastError: "stale error",
		aiLocalIntakePreview: "stale intake",
		aiStreamingPreview: "stale stream",
		aiStreamingTrajectorySnapshot: makeSnapshot(),
		aiRuntimeTrajectorySnapshot: makeTaskBarSnapshot(),
		aiQueuedPrompts: [{ doc: null, text: "queued", tokens: [] }],
		aiAgentTasks: [{ id: "stale-task", conversationId: "conversation-2", status: "running", title: "Stale", summary: "", availableActions: [], pendingMutationCount: 0, changedFileCount: 0 }],
		renderBoard: () => {
			renderCalls += 1;
		},
	});
	view.hydrateAgentTasksForCurrentSession = async () => {
		hydrateTaskCalls += 1;
		view.aiAgentTasks = [];
	};
	view.hydrateCompletedTrajectorySnapshotsForCurrentSession = async () => {
		hydrateSnapshotCalls += 1;
	};

	await view.openBackgroundAgentStatusTarget({
		sessionId: "conversation-1",
		projectId: "project-1",
		conversation: [{ role: "user", content: "Stale target prompt" }],
	});

	assert.equal(plugin.settings.activeProjectId, "project-1");
	assert.equal(view.aiSessionId, "conversation-1");
	assert.deepEqual(view.aiConversation.map((message) => message.content), [
		"Hydrated persisted prompt",
		"Hydrated persisted answer",
	]);
	assert.equal(view.aiLastError, "");
	assert.equal(view.aiLocalIntakePreview, "");
	assert.equal(view.aiStreamingPreview, "");
	assert.equal(view.aiStreamingTrajectorySnapshot, null);
	assert.equal(view.aiRuntimeTrajectorySnapshot, null);
	assert.deepEqual(view.aiQueuedPrompts, []);
	assert.equal(hydrateTaskCalls, 1);
	assert.equal(hydrateSnapshotCalls, 1);
	assert.equal(clearedToolPolicyCalls, 1);
	assert.equal(clearedApprovalRuleCalls, 1);
	assert.equal(renderCalls, 1);
});

test("DailyBoard does not claim task-only snapshots for non-current sessions without proof", async () => {
	const view = await createDailyBoardHarness({
		aiSessionId: "conversation-1",
		aiAgentTasks: [{ id: "task-only", conversationId: "conversation-1", status: "running", title: "Task", summary: "", availableActions: [], pendingMutationCount: 0, changedFileCount: 0 }],
		aiSessions: [
			{
				sessionId: "conversation-2",
				soulId: "soul-1",
				projectId: "project-2",
				updatedAt: "2026-05-08T00:00:00.000Z",
				filePath: "conversation-2.jsonl",
				messages: [{ role: "assistant", content: "Other answer", uiMeta: { turnId: "turn-other", taskId: "task-other" } }],
			},
		],
	});
	const taskOnlySnapshot = makeSnapshot({
		identity: { turnId: "turn-only", taskId: "task-only", traceId: "trace-only" },
	});

	assert.equal(view.isSnapshotOwnedBySession(taskOnlySnapshot, "conversation-2"), false);
});

test("DailyBoard shows a new busy background task as running before a live snapshot exists", async () => {
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-completed", taskId: "task-completed", traceId: "trace-completed", conversationId: "conversation-1" },
		status: "completed",
		headline: "Previous task finished",
	});
	const statusHost = new FakeElement("div");
	const view = await createDailyBoardHarness({
		activePage: "sync",
		aiBusy: true,
		aiRuntimeTrajectorySnapshot: null,
		aiBackgroundAgentStatusHostEl: statusHost,
	});
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(completedSnapshot), completedSnapshot);

	view.renderBackgroundAgentStatus(statusHost);

	const statusEl = statusHost.findByClass("friday-background-agent-status");
	assert.ok(statusEl, "background status should render outside chat");
	assert.equal(statusEl.classes.has("is-running"), true);
	assert.equal(statusEl.classes.has("is-completed"), false);
	assert.match(statusHost.textContent, /FRIDAY 正在运行/);
	assert.doesNotMatch(statusHost.textContent, /FRIDAY 任务完成/);
});

test("DailyBoard keeps completed, failed, and chat-hidden background status behavior", async () => {
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-completed", taskId: "task-completed", traceId: "trace-completed", conversationId: "conversation-1" },
		status: "completed",
		headline: "Previous task finished",
	});
	const completedHost = new FakeElement("div");
	const completedView = await createDailyBoardHarness({
		activePage: "sync",
		aiBusy: false,
		aiRuntimeTrajectorySnapshot: null,
		aiBackgroundAgentStatusHostEl: completedHost,
	});
	completedView.aiProcessSnapshotsByKey.set(completedView.getTrajectorySnapshotKey(completedSnapshot), completedSnapshot);

	completedView.renderBackgroundAgentStatus(completedHost);

	assert.equal(completedHost.findByClass("friday-background-agent-status")?.classes.has("is-completed"), true);
	assert.match(completedHost.textContent, /FRIDAY 任务完成/);

	const failedHost = new FakeElement("div");
	const failedView = await createDailyBoardHarness({
		activePage: "tools",
		aiBusy: false,
		aiLastError: "Runtime failed",
		aiBackgroundAgentStatusHostEl: failedHost,
	});

	failedView.renderBackgroundAgentStatus(failedHost);

	assert.equal(failedHost.findByClass("friday-background-agent-status")?.classes.has("is-failed"), true);
	assert.match(failedHost.textContent, /FRIDAY 运行异常/);

	const chatHost = new FakeElement("div");
	const chatView = await createDailyBoardHarness({
		activePage: "chat",
		aiBusy: true,
		aiRuntimeTrajectorySnapshot: makeTaskBarSnapshot(),
		aiBackgroundAgentStatusHostEl: chatHost,
	});

	chatView.renderBackgroundAgentStatus(chatHost);

	assert.equal(chatHost.countByClass("friday-background-agent-status"), 0);
});

test("DailyBoard syncs non-chat runtime progress without rebuilding the page", async () => {
	const runningSnapshot = makeTaskBarSnapshot({
		identity: { turnId: "turn-running", taskId: "task-running", traceId: "trace-running", conversationId: "conversation-1" },
		status: "running",
		headline: "Agent running",
	});
	const completedSnapshot = makeSnapshot({
		identity: { turnId: "turn-running", taskId: "task-running", traceId: "trace-running", conversationId: "conversation-1" },
		status: "completed",
		headline: "Agent finished",
	});
	const statusHost = new FakeElement("div");
	let renderBoardCalls = 0;
	let liveChatShellCalls = 0;
	let backgroundSyncCalls = 0;
	const plugin = makePluginStub();
	plugin.agentRuntimeService = {
		getAgentTask: async () => ({
			id: "task-running",
			conversationId: "conversation-1",
			turnId: "turn-running",
			status: "running",
			title: "Runtime task",
			summary: "Runtime task is running.",
			availableActions: [],
			pendingMutationCount: 0,
			changedFileCount: 0,
		}),
	};
	const view = await createDailyBoardHarness({
		activePage: "sync",
		aiBusy: true,
		aiRuntimeTrajectorySnapshot: runningSnapshot,
		aiBackgroundAgentStatusHostEl: statusHost,
		plugin,
		aiRuntimeTrajectoryStore: {
			appendProgress: (event) => event.phase === "done" ? completedSnapshot : runningSnapshot,
			completeFromProgress: () => completedSnapshot,
			refreshElapsed: () => null,
		},
		renderBoard: () => {
			renderBoardCalls += 1;
		},
		syncAiLiveChatShell: () => {
			liveChatShellCalls += 1;
		},
	});
	const originalBackgroundSync = view.syncBackgroundAgentStatus;
	view.syncBackgroundAgentStatus = function syncBackgroundAgentStatusSpy() {
		backgroundSyncCalls += 1;
		return originalBackgroundSync.call(this);
	};
	view.renderBackgroundAgentStatus(statusHost);

	assert.match(statusHost.textContent, /FRIDAY 正在运行/);

	withMockedWindow({ setTimeout: () => 1, clearTimeout: () => {} }, () => {
		view.handleRuntimeProgress({
			phase: "tool_call",
			message: "Reading context",
			taskId: "task-running",
			turnId: "turn-running",
			traceId: "trace-running",
			conversationId: "conversation-1",
		});
	});
	await Promise.resolve();

	assert.equal(renderBoardCalls, 0);
	assert.equal(liveChatShellCalls, 0);
	assert.equal(backgroundSyncCalls >= 1, true);
	assert.match(statusHost.textContent, /FRIDAY 正在运行/);

	withMockedWindow({ setTimeout: () => 1, clearTimeout: () => {} }, () => {
		view.handleRuntimeProgress({
			phase: "done",
			message: "Done",
			taskId: "task-running",
			turnId: "turn-running",
			traceId: "trace-running",
			conversationId: "conversation-1",
		});
	});
	await Promise.resolve();

	assert.equal(renderBoardCalls, 0);
	assert.equal(liveChatShellCalls, 0);
	assert.match(statusHost.textContent, /FRIDAY 正在运行/);

	view.aiBusy = false;
	view.syncBackgroundAgentStatus();

	assert.equal(renderBoardCalls, 0);
	assert.equal(liveChatShellCalls, 0);
	assert.doesNotMatch(statusHost.textContent, /FRIDAY 正在运行/);
	assert.match(statusHost.textContent, /FRIDAY 任务完成/);
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
	assert.equal(view.getCompletedTrajectorySnapshotForMessage(userMessage), snapshot);
	assert.equal(view.getCompletedTrajectorySnapshotForMessage(assistantMessage), null);
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

test("DailyBoard syncs completed composer task bar from visible replay plan snapshots", async () => {
	const visibleSnapshot = makeTaskBarSnapshot({
		identity: { turnId: "turn-visible", taskId: "task-visible", traceId: "trace-visible", conversationId: "conversation-1" },
		status: "completed",
		plan: makeTaskBarPlan({
			visibility: "visible",
			status: "completed",
			currentTaskId: "visible-2",
			tasks: [
				{ id: "visible-1", title: "Collect replay context", status: "completed" },
				{ id: "visible-2", title: "Run visible replay tests", status: "completed" },
			],
		}),
		privacy: { redacted: true, source: "replay" },
	});
	const internalSnapshot = makeTaskBarSnapshot({
		identity: { turnId: "turn-internal", taskId: "task-internal", traceId: "trace-internal", conversationId: "conversation-1" },
		status: "completed",
		plan: makeTaskBarPlan({
			visibility: "internal",
			status: "completed",
			currentTaskId: "internal-1",
			tasks: [
				{ id: "internal-1", title: "Internal replay plan", status: "completed" },
			],
		}),
		privacy: { redacted: true, source: "replay" },
	});
	const view = await createDailyBoardHarness();
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(visibleSnapshot), visibleSnapshot);
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(internalSnapshot), internalSnapshot);
	const host = new FakeElement("div");
	view.aiComposerTaskBarHostEl = host;

	assert.equal(view.selectComposerTaskBarSnapshot(), visibleSnapshot);
	assert.equal(view.getComposerTaskBarView()?.collapsed.taskTitle, "Run visible replay tests");

	view.syncComposerTaskBar();

	assert.equal(host.countByClass("friday-composer-task-bar"), 1);
	assert.match(host.textContent, /2\/2/);
	assert.match(host.textContent, /Run visible replay tests/);
	assert.doesNotMatch(host.textContent, /Internal replay plan/);
});

test("DailyBoard clears stale completed composer task bar for a later simple no-plan answer", async () => {
	const completedPlanSnapshot = makeTaskBarSnapshot({
		identity: { turnId: "turn-plan", taskId: "task-plan", traceId: "trace-plan", conversationId: "conversation-1" },
		status: "completed",
		plan: makeTaskBarPlan({
			visibility: "visible",
			status: "completed",
			currentTaskId: "task-3",
			tasks: [
				{ id: "task-1", title: "确认旧复杂任务", status: "completed" },
				{ id: "task-2", title: "执行旧复杂任务", status: "completed" },
				{ id: "task-3", title: "整理结论和建议", status: "completed" },
			],
		}),
		privacy: { redacted: true, source: "replay" },
	});
	const simpleSnapshot = makeSnapshot({
		identity: { turnId: "turn-simple", taskId: "task-simple", traceId: "trace-simple", conversationId: "conversation-1" },
		status: "completed",
		headline: "Answer finished",
		summary: "2+2 等于 4。",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "model", kind: "model", title: "Model response", detail: "2+2 等于 4。", status: "ok" }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "2+2 等于 4。", status: "ok" }),
		],
	});
	const view = await createDailyBoardHarness({
		aiConversation: [
			{ role: "user", content: "旧复杂任务", uiMeta: completedPlanSnapshot.identity },
			{ role: "assistant", content: "旧复杂任务完成。", uiMeta: completedPlanSnapshot.identity },
		],
		approvalQueue: { list: () => [] },
	});
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(completedPlanSnapshot), completedPlanSnapshot);
	const host = new FakeElement("div");
	view.aiComposerTaskBarHostEl = host;

	view.aiLocalIntakePreview = "FRIDAY 正在理解你的请求";
	view.syncComposerTaskBar();

	assert.equal(host.countByClass("friday-composer-task-bar"), 0);

	view.aiLocalIntakePreview = "";
	view.aiConversation.push(
		{ role: "user", content: "一句话回答：2+2 等于几？不要读取文件，不要制定计划。", uiMeta: simpleSnapshot.identity },
		{ role: "assistant", content: "2+2 等于 4。", uiMeta: simpleSnapshot.identity },
	);
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(simpleSnapshot), simpleSnapshot);
	view.syncComposerTaskBar();

	assert.equal(view.selectComposerTaskBarSnapshot(), null);
	assert.equal(host.countByClass("friday-composer-task-bar"), 0);
	assert.doesNotMatch(host.textContent, /整理结论和建议/);

	const root = new FakeElement("div");
	view.renderAiMessageContent = (containerEl, message) => {
		containerEl.createDiv({ cls: "test-message-body", text: message.content });
	};
	view.resolveUserDisplayName = () => "User";
	view.renderAiMessageList(root);

	const assistantRows = root
		.findAllByClass("friday-ai-message-row")
		.filter((row) => row.classes.has("is-assistant"));
	const latestAssistantRow = assistantRows.at(-1);
	assert.ok(latestAssistantRow, "latest simple assistant answer should render");
	assert.match(latestAssistantRow.textContent, /FRIDAY 已思考/);
	assert.match(latestAssistantRow.textContent, /2\+2 等于 4。/);
	assert.equal(latestAssistantRow.countByClass("friday-composer-task-bar"), 0);
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
				{ id: "task-6", title: "等待外部确认", status: "blocked", index: 6 },
			],
			actionSlot: null,
		},
		expanded: false,
		onToggle: () => {},
	});

	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar"), 1);
	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar-list"), 0);
	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar-item-marker"), 0);
	assert.equal(collapsedRoot.countByClass("friday-composer-task-bar-item-progress"), 0);
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
				{ id: "task-6", title: "等待外部确认", status: "blocked", index: 6 },
			],
			actionSlot: null,
		},
		expanded: true,
		onToggle: () => {},
	});

	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-list"), 1);
	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-item"), 6);
	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-item-index"), 0);
	const markerEls = expandedRoot.findAllByClass("friday-composer-task-bar-item-marker");
	assert.equal(markerEls.length, 6);
	for (const status of ["completed", "in_progress", "pending", "skipped", "failed", "blocked"]) {
		assert.equal(markerEls.some((markerEl) => markerEl.classes.has(`is-${status}`)), true);
	}
	const progressEls = expandedRoot.findAllByClass("friday-composer-task-bar-item-progress");
	assert.equal(progressEls.length, 6);
	assert.deepEqual(progressEls.map((progressEl) => progressEl.textContent), ["1/6", "2/6", "3/6", "4/6", "5/6", "6/6"]);
	const statusEls = expandedRoot.findAllByClass("friday-composer-task-bar-item-status");
	assert.equal(statusEls.length, 6);
	for (const status of ["completed", "in_progress", "pending", "skipped", "failed", "blocked"]) {
		assert.equal(statusEls.some((statusEl) => statusEl.classes.has(`is-${status}`)), true);
	}
	assert.match(expandedRoot.textContent, /已完成/);
	assert.match(expandedRoot.textContent, /执行中/);
	assert.match(expandedRoot.textContent, /未开始/);
	assert.match(expandedRoot.textContent, /已跳过/);
	assert.match(expandedRoot.textContent, /未完成\/失败/);
	assert.match(expandedRoot.textContent, /受阻/);
	assert.equal(expandedRoot.countByClass("friday-composer-task-bar-action-slot"), 0);
	assert.doesNotMatch(expandedRoot.textContent, /当前：|刚刚完成：|接下来：|做了什么|正在做什么/);
});

test("renderAgentTrajectoryCard hides simple live model-only snapshots", async () => {
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

	assert.equal(root.countByClass("friday-agent-process-shell"), 0);
	assert.equal(root.countByClass("friday-agent-process-header"), 0);
	assert.equal(root.countByClass("friday-composer-task-bar"), 0);
	assert.equal(root.countByClass("avatar"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.equal(root.textContent, "");
});

test("renderAgentAnswerFlow does not keep a process panel for completed direct-answer routes", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			summary: "2+2 等于 4。",
			items: [
				makeItem({
					id: "intake-direct",
					kind: "intake",
					title: "我会直接回答。",
					detail: "我会直接回答。",
					status: "ok",
					rawEventType: "intake_decision",
					intakeInteractionRoute: "direct_answer",
					intakeShouldShowProcess: false,
					intakeShouldUseVisiblePlan: false,
				}),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "2+2 等于 4。", status: "ok" }),
			],
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "2+2 等于 4。" }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-shell"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-ai-answer-content"), 1);
	assert.match(root.textContent, /2\+2 等于 4。/);
	assert.doesNotMatch(root.textContent, /我会直接回答|FRIDAY 已思考|过程|正在处理/);
});

test("renderAgentTrajectoryCard adds expanded and collapsed process state classes", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const collapsedRoot = new FakeElement("div");
	const expandedRoot = new FakeElement("div");
	const snapshot = makeSnapshot({
		status: "running",
		items: [
			makeItem({
				id: "intake-process",
				kind: "intake",
				title: "我会按步骤整理。",
				detail: "我会按步骤整理。",
				status: "running",
				rawEventType: "intake_decision",
				intakeInteractionRoute: "task_with_process",
				intakeShouldShowProcess: true,
				intakeShouldUseVisiblePlan: true,
			}),
			makeItem({
				id: "read-note",
				kind: "tool",
				title: "Read Notes/A.md",
				detail: "Read the note before preparing the answer.",
				status: "running",
				tool: "read",
				targetPath: "Notes/A.md",
			}),
		],
	});

	renderAgentTrajectoryCard({
		containerEl: collapsedRoot,
		snapshot,
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});
	renderAgentTrajectoryCard({
		containerEl: expandedRoot,
		snapshot,
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(collapsedRoot.findByClass("friday-agent-process-shell")?.classes.has("is-collapsed"), true);
	assert.equal(collapsedRoot.findByClass("friday-agent-process-shell")?.classes.has("is-expanded"), false);
	assert.equal(expandedRoot.findByClass("friday-agent-process-shell")?.classes.has("is-expanded"), true);
	assert.equal(expandedRoot.findByClass("friday-agent-process-shell")?.classes.has("is-collapsed"), false);
	assert.equal(expandedRoot.countByClass("friday-agent-process-timeline-detail"), 1);
	assert.equal(expandedRoot.findByClass("friday-agent-process-timeline-detail")?.attributes.open, undefined);
});

test("renderAgentTrajectoryCard hides live preflight-only context snapshots", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Loading instructions",
			summary: "加载项目规则与 Soul 设定",
			time: { startedAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:01.000Z", durationMs: 1000 },
			items: [
				makeItem({ id: "live:context:instructions", kind: "context", title: "Context: instructions", detail: "加载项目规则与 Soul 设定", status: "running", rawEventType: "context" }),
				makeItem({ id: "live:context:skills", kind: "context", title: "Context: skills", detail: "匹配相关技能与命令约束", status: "running", rawEventType: "context" }),
				makeItem({ id: "live:context:memory", kind: "context", title: "Context: memory", detail: "加载长期记忆与项目偏好", status: "running", rawEventType: "context" }),
				makeItem({ id: "live:context:compact", kind: "context", title: "Context: compact", detail: "压缩上下文并生成提示包", status: "running", rawEventType: "context" }),
				makeItem({ id: "checkpoint", kind: "system", title: "Checkpoint saved", detail: "Context package built before native model request. (context_ready)", status: "ok", rawEventType: "checkpoint_saved" }),
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-shell"), 0);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 0);
	assert.equal(root.textContent, "");
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

test("renderAgentTrajectoryCard expanded ordinary process hides internal runtime terms", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "waiting_for_approval",
			headline: "Waiting for approval",
			summary: "Before snapshot mismatch for Project/workspace/a.md.",
			time: { startedAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:03.000Z", durationMs: 3000 },
			items: [
				makeItem({ id: "checkpoint", kind: "system", title: "Checkpoint saved", detail: "Context package built before native model request. (context_ready)", status: "ok", rawEventType: "checkpoint_saved" }),
				makeItem({ id: "model", kind: "model", title: "Model request", detail: "model_request started", status: "running", rawEventType: "model_request" }),
				makeItem({ id: "approval", kind: "approval", title: "Waiting for approval", detail: "1 file change(s) pending review.", status: "waiting", rawEventType: "tool_approval" }),
			],
			actions: [
				{ id: "cancel", label: "Cancel", enabled: true, targetId: "task-1" },
				{ id: "view_replay", label: "View replay", enabled: true, targetId: "turn-1" },
			],
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		onAction: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assertNoBannedOrdinaryTerms(root.textContent, "expanded process DOM text");
});

test("renderAgentTrajectoryCard renders simple completed answer replay as compact thought strip", async () => {
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

	assert.equal(root.countByClass("friday-agent-process-shell"), 1);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.match(root.textContent, /FRIDAY 已思考/);
	assert.equal(root.countByClass("friday-agent-process-toggle"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
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
	assert.match(root.textContent, /FRIDAY 已完成工作/);
	assert.doesNotMatch(root.textContent, /已处理 4s/);
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
	assert.match(root.textContent, /FRIDAY 已完成工作/);
	assert.doesNotMatch(root.textContent, /已处理 8s/);
	assert.match(root.textContent, /整理方案/);
	assert.match(root.textContent, /Checked the request and current workspace/);
	assert.equal(root.textContent.includes(rawCot), false);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
});

test("renderAgentAnswerFlow keeps stage reports out of the structured process panel", async () => {
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
	assert.equal(root.countByClass("friday-agent-process-timeline-item"), 3);
	assert.equal(root.countByClass("friday-ai-answer-content"), 1);
	assert.match(root.textContent, /收到任务/);
	assert.match(root.textContent, /整理方案/);
	assert.doesNotMatch(root.textContent, /阶段性汇报/);
	assert.doesNotMatch(root.textContent, /已读取相关文件，接下来实现事件链路。/);
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
	assert.match(root.textContent, /已准备好 1 个待应用的文件修改|确认后才会写入 Obsidian/);
	assert.equal(root.countByClass("friday-agent-process-action"), 0);
	assert.equal(root.findByClass("is-apply"), null);
	assert.equal(root.findByClass("is-reject"), null);
	assert.deepEqual(calls, []);
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
	assert.match(root.textContent, /已准备好 1 个待应用的文件修改|确认后才会写入 Obsidian/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	assert.doesNotMatch(root.textContent, /1 file change pending review|Pending file changes|Applied file/);
	assert.equal(root.countByClass("friday-agent-process-action"), 0);
	assert.equal(root.findByClass("is-apply"), null);
	assert.equal(root.findByClass("is-reject"), null);
	assert.deepEqual(calls, []);
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
	assert.match(root.textContent, /FRIDAY 已完成工作/);
	assert.doesNotMatch(root.textContent, /已处理 5s/);
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

test("renderAgentAnswerFlow places process disclosure before answer body and keeps artifacts below the answer", async () => {
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
		"process disclosure should render before answer body",
	);
	assert.ok(
		directChildIndex(flow, "friday-agent-artifacts") > directChildIndex(flow, "friday-ai-answer-content"),
		"artifacts belong after the answer body",
	);
	assert.ok(
		directChildIndex(flow, "friday-agent-artifacts") > directChildIndex(flow, "friday-agent-process-shell"),
		"result artifacts should remain below the process disclosure in the final answer flow",
	);
	assert.equal(flow.findByClass("friday-agent-process-timeline")?.countByClass("friday-agent-artifact-card") ?? 0, 0);
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

test("renderAgentAnswerFlow inserts expanded process panel above the answer body", async () => {
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

test("renderAgentAnswerFlow uses compact thought strip without toggle for simple completed answers", async () => {
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
	assert.match(root.textContent, /FRIDAY 已思考/);
	assert.doesNotMatch(root.textContent, /FRIDAY 的思路/);
	assert.doesNotMatch(root.textContent, /FRIDAY 的工作过程/);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(root.countByClass("friday-agent-process-toggle"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	const flow = root.findByClass("friday-ai-answer-flow");
	assert.ok(flow, "answer flow should render");
	assert.ok(directChildIndex(flow, "friday-agent-process-shell") < directChildIndex(flow, "friday-ai-answer-content"));
});

test("renderAgentAnswerFlow compacts simple completed replay with generic lifecycle narration", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "2+2 等于 4。" }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /FRIDAY/);
	assert.match(root.textContent, /FRIDAY 已思考 · 4s/);
	assert.match(root.textContent, /2\+2 等于 4。/);
	assert.equal(root.countByClass("friday-agent-process-shell"), 1);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(root.countByClass("friday-agent-process-toggle"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-composer-task-bar"), 0);
	assert.doesNotMatch(root.textContent, /已处理 4s|完成：本次工作已结束|收到任务|FRIDAY 已收到任务|整理方案|执行|已整理上下文/);
});

test("renderAgentAnswerFlow compacts completed preflight-only replay with elapsed thinking strip", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		expanded: true,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "3+3 等于 6。" }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /FRIDAY 已思考 · 3s/);
	assert.match(root.textContent, /3\+3 等于 6。/);
	assert.equal(root.countByClass("friday-agent-process-toggle"), 0);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-composer-task-bar"), 0);
	assert.doesNotMatch(root.textContent, /加载项目规则|匹配相关技能|加载长期记忆|压缩上下文|context_ready|读取项目现状/);
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

	assert.match(root.textContent, /FRIDAY 已完成工作 · 4s/);
	assert.doesNotMatch(root.textContent, /已处理 4s/);
	assert.doesNotMatch(root.textContent, /完成：本次工作已结束/);
	assert.equal(root.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.doesNotMatch(root.textContent, /Read Notes\/Today\.md|Evidence|Timeline/i);
});

test("renderAgentAnswerFlow pads completed process elapsed seconds after one minute", async () => {
	const { renderAgentAnswerFlow } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentAnswerFlow({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Answer finished",
			summary: "Answered from the current note.",
			privacy: { redacted: true, source: "replay" },
			time: { startedAt: "2026-05-05T00:00:00.000Z", completedAt: "2026-05-05T00:01:04.000Z", durationMs: 64000 },
			items: [
				makeItem({ id: "read", kind: "tool", title: "Read Notes/Today.md", detail: "Read current note.", status: "ok", tool: "read", targetPath: "Notes/Today.md" }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Answered from the current note.", status: "ok" }),
			],
		}),
		expanded: false,
		onToggle: () => {},
		renderContent: (containerEl) => containerEl.createDiv({ cls: "answer-body", text: "Current note answer." }),
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /FRIDAY 已完成工作 · 1m 04s/);
	assert.doesNotMatch(root.textContent, /1m 4s|完成：本次工作已结束/);
	assert.equal(root.countByClass("friday-agent-process-panel"), 0);
	assert.equal(root.countByClass("friday-composer-task-bar"), 0);
});

test("renderAgentAnswerFlow expands completed workspace read process above the answer", async () => {
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
				makeItem({ id: "read", kind: "tool", title: "Read Notes/A.md", detail: "Reading note.", status: "running", tool: "read", targetPath: "Notes/A.md" }),
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

test("DailyBoard embeds completed replay in every matching assistant answer row", async () => {
	const oldCompletedSnapshot = makeSnapshot({
		identity: { turnId: "turn-old", taskId: "task-old", traceId: "trace-old", conversationId: "conversation-1" },
		status: "completed",
		headline: "Older task completed",
		summary: "Older answer replay.",
		privacy: { redacted: true, source: "replay" },
		time: { startedAt: "2026-05-06T00:00:00.000Z", completedAt: "2026-05-06T00:00:08.000Z", durationMs: 8000 },
		items: [
			makeItem({ id: "old-read", kind: "tool", title: "Read Notes/Old.md", detail: "Read old note.", status: "ok", tool: "read", targetPath: "Notes/Old.md" }),
			makeItem({ id: "old-final", kind: "final", title: "Final response", detail: "Older answer replay.", status: "ok" }),
		],
	});
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
	view.aiProcessSnapshotsByKey.set(view.getTrajectorySnapshotKey(oldCompletedSnapshot), oldCompletedSnapshot);
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
	assert.equal(previousAssistantRow.countByClass("friday-agent-process-shell"), 1);
	assert.equal(matchingAssistantRow.countByClass("friday-agent-process-shell"), 1);
	assert.equal(matchingAssistantRow.countByClass("friday-agent-process-disclosure"), 1);
	assert.equal(matchingAssistantRow.countByClass("friday-ai-answer-content"), 1);

	const matchingFlow = matchingAssistantRow.findByClass("friday-ai-answer-flow");
	assert.ok(matchingFlow, "matching assistant answer should use answer flow");
	const processIndex = directChildIndex(matchingFlow, "friday-agent-process-shell");
	const answerIndex = directChildIndex(matchingFlow, "friday-ai-answer-content");
	assert.ok(processIndex >= 0, "process disclosure should be a direct child of the matching answer flow");
	assert.ok(answerIndex >= 0, "answer content should be a direct child of the matching answer flow");
	assert.ok(processIndex < answerIndex, "process disclosure should render above answer content in the matching row");
	assert.equal(root.children.some((child) => child.classes.has("friday-agent-process-shell")), false);
});

test("DailyBoard keeps approval task cards out of the chat flow", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");
	const shouldRenderMatch = source.match(/private shouldRenderAgentTaskPanel\([\s\S]*?\n\t\}/);
	const messageListMatch = source.match(/private renderAiMessageList\([\s\S]*?\n\t\}\n\n\tprivate shouldRenderAgentTaskPanel/);
	assert.ok(shouldRenderMatch, "task panel visibility predicate should exist");
	assert.ok(messageListMatch, "message list renderer should exist");
	const shouldRenderBlock = shouldRenderMatch[0] ?? "";
	const messageListBlock = messageListMatch[0] ?? "";

	assert.match(source, /private shouldRenderAgentTaskPanel\(task: AgentTaskViewState\): boolean/);
	assert.match(shouldRenderBlock, /task\.waitingForUser/);
	assert.doesNotMatch(shouldRenderBlock, /task\.waitingForApproval/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "waiting_for_approval"/);
	assert.doesNotMatch(shouldRenderBlock, /task\.pendingMutationCount > 0/);
	assert.doesNotMatch(shouldRenderBlock, /task\.changedFileCount > 0/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "failed"/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "cancelled"/);
	assert.doesNotMatch(shouldRenderBlock, /task\.status === "completed"/);
	assert.match(shouldRenderBlock, /task\.status === "waiting_for_user"/);
	assert.match(source, /private getVisibleAgentTasksForCurrentSession\(\)/);
	assert.doesNotMatch(messageListBlock, /renderApprovalMessage/);
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

	assert.equal(root.countByClass("friday-agent-process-action"), 1);
	assert.equal(root.findByClass("is-retry")?.disabled, false);
	assert.equal(root.findByClass("is-apply"), null);
	root.findByClass("is-retry")?.onclick?.();
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
		aiRuntimeTrajectoryStore: { reset: () => {}, refreshElapsed: () => null },
		aiRuntimeProgressTaskIds: new Set(),
		aiRuntimeLastRenderAt: 0,
		aiForceScrollToBottomOnce: false,
		aiProcessSnapshotsByKey: new Map(),
		aiProcessSnapshotProjectIds: new WeakMap(),
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
		aiSessionSelection: new Set(),
		aiBusy: false,
		aiBackgroundTurnFailure: null,
		aiQueuedPrompts: [],
		aiLastError: "",
		approvalQueue: { list: () => [] },
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
		agentRuntimeService: {
			clearAllSessionToolPolicyOverrides: () => {},
			listAgentTasksByConversationId: async () => [],
		},
		toolApprovalService: { clearSessionRules: () => {} },
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
