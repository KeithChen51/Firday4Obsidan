/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");

function readViewSource() {
	return fs.readFileSync(viewPath, "utf8").replace(/\r\n?/g, "\n");
}

function extractMethod(source, name, nextName) {
	const match = source.match(new RegExp(`private (?:async )?${name}\\([\\s\\S]*?\\n\\t\\}\\n\\n\\tprivate (?:async )?${nextName}`));
	assert.ok(match, `${name} method should exist`);
	return match[0];
}

test("submitAiPrompt renders a local intake preview before mention and planner startup", () => {
	const source = readViewSource();
	const submitBlock = extractMethod(source, "submitAiPrompt", "compileWikiByButton");
	const listBlock = extractMethod(source, "renderAiMessageList", "shouldRenderAgentTaskPanel");
	const previewBuilderBlock = extractMethod(source, "buildLocalIntakePreview", "streamAssistantText");
	const previewIndex = submitBlock.indexOf("this.aiLocalIntakePreview = this.buildLocalIntakePreview(rawPrompt);");
	const renderIndex = submitBlock.indexOf("this.syncAiLiveChatShell();");
	const mentionIndex = submitBlock.indexOf("const mentionResolution = await this.mentionResolver.resolve");
	const plannerIndex = submitBlock.indexOf("this.plugin.executionPlanner.plan");

	assert.ok(previewIndex >= 0, "submit should create a local-only intake preview");
	assert.ok(renderIndex > previewIndex, "submit should render immediately after creating the preview");
	assert.ok(mentionIndex > renderIndex, "mention resolution must happen after the first preview render");
	assert.ok(plannerIndex > renderIndex, "planner startup must happen after the first preview render");
	assert.match(source, /private buildLocalIntakePreview\(rawPrompt: string\): string/);
	assert.match(listBlock, /content: this\.aiLocalIntakePreview/);
	assert.match(previewBuilderBlock, /FRIDAY 正在响应……/);
	assert.doesNotMatch(previewBuilderBlock, /FRIDAY 正在理解你的请求/);
	assert.doesNotMatch(previewBuilderBlock, /aiRuntimeTrajectoryStore|rememberCompletedTrajectorySnapshot|projectReplaySummary/);
	assert.doesNotMatch(submitBlock, /content: this\.aiLocalIntakePreview/);
});

test("runtime transport-start progress switches the local status to model understanding copy", () => {
	const source = readViewSource();
	const progressBlock = extractMethod(source, "handleRuntimeProgress", "buildRuntimeReply");

	assert.match(progressBlock, /event\.transport\?\.type === "request_started"/);
	assert.match(progressBlock, /ai\.intake\.preview\.modelStarted/);
	assert.doesNotMatch(progressBlock, /event\.phase === "model_request"[\s\S]*ai\.intake\.preview\.modelStarted/);
	assert.match(progressBlock, /ai\.intake\.preview\.retry/);
	assert.match(progressBlock, /ai\.intake\.preview\.modelExhaustedBeforeIntake/);
});

test("runtime intake state resets at the start of each runtime invocation", () => {
	const source = readViewSource();
	const submitBlock = extractMethod(source, "submitAiPrompt", "compileWikiByButton");
	const compileBlock = extractMethod(source, "compileWikiByButton", "compileWikiWithStatus");
	const submitTrajectoryResetIndex = submitBlock.indexOf("this.aiRuntimeTrajectoryStore.reset();");
	const submitSawResetIndex = submitBlock.indexOf("this.aiRuntimeSawIntake = false;", submitTrajectoryResetIndex);
	const submitExecuteIndex = submitBlock.indexOf("this.plugin.executionOrchestrator.execute");
	const compileTrajectoryResetIndex = compileBlock.indexOf("this.aiRuntimeTrajectoryStore.reset();");
	const compileSawResetIndex = compileBlock.indexOf("this.aiRuntimeSawIntake = false;", compileTrajectoryResetIndex);
	const compileExecuteIndex = compileBlock.indexOf("this.plugin.executionOrchestrator.execute");

	assert.ok(submitTrajectoryResetIndex >= 0, "submit should reset runtime trajectory state");
	assert.ok(submitSawResetIndex > submitTrajectoryResetIndex, "submit should reset intake-seen state with runtime state");
	assert.ok(submitSawResetIndex < submitExecuteIndex, "submit should reset intake-seen state before runtime events can arrive");
	assert.ok(compileTrajectoryResetIndex >= 0, "compile should reset runtime trajectory state");
	assert.ok(compileSawResetIndex > compileTrajectoryResetIndex, "compile should reset intake-seen state with runtime state");
	assert.ok(compileSawResetIndex < compileExecuteIndex, "compile should reset intake-seen state before runtime events can arrive");
});

test("runtime preflight progress keeps the local intake preview until visible process exists", () => {
	const source = readViewSource();
	const progressBlock = extractMethod(source, "handleRuntimeProgress", "buildRuntimeReply");
	const streamBlock = extractMethod(source, "streamAssistantText", "sleep");
	const appendProgressIndex = progressBlock.indexOf("const nextSnapshot = this.aiRuntimeTrajectoryStore.appendProgress(event);");
	const viewModelIndex = progressBlock.indexOf("const nextView = buildAgentProcessPanelViewModel(nextSnapshot);");
	const conditionalClearIndex = progressBlock.indexOf("if (nextView.shouldRenderProcessPanel) {");
	const clearInsideConditionalIndex = progressBlock.indexOf("this.aiLocalIntakePreview = \"\";", conditionalClearIndex);
	const streamClearIndex = streamBlock.indexOf("this.aiLocalIntakePreview = \"\";");
	const streamPreviewIndex = streamBlock.indexOf("this.aiStreamingPreview = \"\";");

	assert.ok(appendProgressIndex >= 0, "runtime progress should append the event into a next snapshot");
	assert.ok(viewModelIndex > appendProgressIndex, "runtime progress should inspect the next snapshot view model");
	assert.ok(conditionalClearIndex > viewModelIndex, "runtime progress should only clear after checking visible process state");
	assert.ok(clearInsideConditionalIndex > conditionalClearIndex, "runtime progress should clear the local preview inside the visible-process branch");
	assert.ok(streamClearIndex >= 0, "final streaming should clear the local preview");
	assert.ok(streamClearIndex < streamPreviewIndex, "final streaming should clear before streaming content renders");
});

test("runtime elapsed refresh updates the live process in place without rebuilding the message list", () => {
	const source = readViewSource();
	const refreshBlock = extractMethod(source, "syncLiveRuntimeElapsedProcess", "scheduleRuntimeElapsedTimer");
	const timerBlock = extractMethod(source, "scheduleRuntimeElapsedTimer", "clearRuntimeElapsedTimer");

	assert.match(timerBlock, /this\.syncLiveRuntimeElapsedProcess\(\)/);
	assert.doesNotMatch(timerBlock, /syncAiLiveChatShell\(\)/);
	assert.doesNotMatch(timerBlock, /renderAiMessageList\(/);
	assert.match(refreshBlock, /querySelector\("\.friday-agent-process-shell\.is-live"\)/);
	assert.match(refreshBlock, /friday-agent-process-headline/);
	assert.match(refreshBlock, /friday-agent-process-statusbar-elapsed/);
	assert.doesNotMatch(refreshBlock, /containerEl\.empty\(\)|renderAiMessageList\(/);
});

test("runtime progress refreshes an existing live process without rebuilding the message list", () => {
	const source = readViewSource();
	const shellSyncBlock = extractMethod(source, "syncElementFromTemplate", "syncLiveRuntimeProgressProcess");
	const childSyncBlock = extractMethod(source, "syncChildNodesFromTemplate", "canSyncNodeFromTemplate");
	const progressRefreshBlock = extractMethod(source, "syncLiveRuntimeProgressProcess", "syncLiveRuntimeElapsedProcess");
	const progressBlock = extractMethod(source, "handleRuntimeProgress", "buildRuntimeReply");
	const progressInPlaceIndex = progressBlock.indexOf("this.syncLiveRuntimeProgressProcess()");
	const progressFallbackIndex = progressBlock.indexOf("this.syncAiRuntimeShell()", progressInPlaceIndex);

	assert.match(shellSyncBlock, /syncChildNodesFromTemplate/);
	assert.doesNotMatch(shellSyncBlock, /replaceChildren|containerEl\.empty\(\)|renderAiMessageList\(/);
	assert.match(childSyncBlock, /appendChild\(templateNode\)/);
	assert.match(childSyncBlock, /replaceWith\(templateNode\)/);
	assert.doesNotMatch(childSyncBlock, /replaceChildren|containerEl\.empty\(\)|renderAiMessageList\(/);
	assert.match(progressRefreshBlock, /querySelector\("\.friday-agent-process-shell\.is-live"\)/);
	assert.match(progressRefreshBlock, /document\.createElement\("div"\)/);
	assert.doesNotMatch(progressRefreshBlock, /containerEl\.empty\(\)|renderAiMessageList\(/);
	assert.ok(progressInPlaceIndex >= 0, "runtime progress should attempt in-place live process refresh");
	assert.ok(progressFallbackIndex > progressInPlaceIndex, "runtime progress should only rebuild after in-place refresh cannot handle the update");
	assert.match(progressBlock, /!terminalProgress && nextView\.shouldRenderProcessPanel && this\.syncLiveRuntimeProgressProcess\(\)/);
});

test("runtime progress syncs the composer decision panel when file review arrives", () => {
	const source = readViewSource();
	const liveShellBlock = extractMethod(source, "syncAiLiveChatShell", "syncAiRuntimeShell");
	const progressRefreshBlock = extractMethod(source, "syncLiveRuntimeProgressProcess", "syncLiveRuntimeElapsedProcess");
	const composerSyncBlock = extractMethod(source, "syncComposerDecisionPanel", "syncAiComposerControls");

	assert.match(source, /private aiComposerBodyEl: HTMLElement \| null = null/);
	assert.match(liveShellBlock, /this\.syncComposerDecisionPanel\(\)/);
	assert.match(progressRefreshBlock, /this\.syncComposerDecisionPanel\(\)/);
	assert.match(composerSyncBlock, /this\.getPendingEditPlans\(\)/);
	assert.match(composerSyncBlock, /this\.approvalQueue\.list\(\)/);
	assert.match(composerSyncBlock, /this\.renderComposerDecisionPanel\(this\.aiComposerBodyEl/);
	assert.match(composerSyncBlock, /this\.renderComposerInput\(this\.aiComposerBodyEl\)/);
	assert.match(composerSyncBlock, /this\.composer\?\.destroy\(\)/);
	assert.doesNotMatch(composerSyncBlock, /syncAiLiveChatShell\(|renderAiMessageList\(|renderBoard\(/);
});

test("streaming answer updates existing content without rebuilding the process shell", () => {
	const source = readViewSource();
	const streamContentBlock = extractMethod(source, "syncAiStreamingPreviewContent", "syncElementFromTemplate");
	const streamBlock = extractMethod(source, "streamAssistantText", "sleep");
	const streamingUpdateIndex = streamBlock.indexOf("this.syncAiStreamingPreviewContent()");
	const streamingFallbackIndex = streamBlock.indexOf("this.syncAiLiveChatShell()", streamingUpdateIndex);

	assert.match(streamContentBlock, /querySelector\("\.friday-ai-answer-content\.is-streaming"\)/);
	assert.match(streamContentBlock, /this\.renderAiMessageContent/);
	assert.doesNotMatch(streamContentBlock, /renderAiMessageList\(|friday-agent-process-shell/);
	assert.ok(streamingUpdateIndex >= 0, "streaming should attempt content-only updates first");
	assert.ok(streamingFallbackIndex > streamingUpdateIndex, "streaming should only rebuild when no streaming content exists yet");
});

test("runtime fallback reply does not expose internal diagnostics as assistant text", () => {
	const source = readViewSource();
	const replyBlock = extractMethod(source, "buildRuntimeReply", "buildSkillCatalogReply");

	assert.doesNotMatch(replyBlock, /Runtime profile|Step traces|Context budget|Context sources|工具执行记录/);
	assert.doesNotMatch(replyBlock, /trace\.tool|result\.runtimeProfile|result\.stepTraces|result\.contextSummary/);
	assert.match(replyBlock, /ai\.runtime\.fallback/);
});

test("assistant message rendering sanitizes legacy file mutation notices", () => {
	const source = readViewSource();
	const normalizeBlock = extractMethod(source, "normalizeDisplayedAssistantMessageContent", "renderAiMessageContent");
	const renderContentBlock = extractMethod(source, "renderAiMessageContent", "isCurrentConversationId");

	assert.match(renderContentBlock, /message\.role === "assistant"/);
	assert.match(renderContentBlock, /normalizeDisplayedAssistantMessageContent/);
	assert.match(normalizeBlock, /Pending file changes/);
	assert.match(normalizeBlock, /确认后才会写入 Obsidian/);
	assert.match(normalizeBlock, /Applied file/);
	assert.doesNotMatch(renderContentBlock, /MarkdownRenderer\.renderMarkdown\(message\.content/);
});

test("rememberCompletedTrajectorySnapshot forces completed process strips collapsed", () => {
	const source = readViewSource();
	const rememberBlock = extractMethod(source, "rememberCompletedTrajectorySnapshot", "isProcessExpanded");

	assert.match(rememberBlock, /this\.aiProcessSnapshotsByKey\.set\(key, snapshot\)/);
	assert.match(rememberBlock, /this\.aiProcessExpandedKeys\.delete\(key\)/);
	assert.match(rememberBlock, /this\.aiProcessCollapsedKeys\.add\(key\)/);
});

test("streaming final answer renders with the completed snapshot process strip", () => {
	const source = readViewSource();
	const listBlock = extractMethod(source, "renderAiMessageList", "shouldRenderAgentTaskPanel");
	const submitBlock = extractMethod(source, "submitAiPrompt", "compileWikiByButton");
	const completedIndex = submitBlock.indexOf("const completedSnapshot = runtimeResult");
	const rememberIndex = submitBlock.indexOf("this.rememberCompletedTrajectorySnapshotForSession(completedSnapshot, turnTarget.sessionId, turnTarget.projectId);");
	const streamSnapshotIndex = submitBlock.indexOf("this.aiStreamingTrajectorySnapshot = completedSnapshot;");
	const streamIndex = submitBlock.indexOf("await this.streamAssistantText(normalizedAssistantText);");

	assert.match(source, /private aiStreamingTrajectorySnapshot: AgentTrajectorySnapshot \| null = null/);
	assert.match(listBlock, /content: this\.aiStreamingPreview/);
	assert.match(listBlock, /this\.aiStreamingTrajectorySnapshot/);
	assert.ok(completedIndex >= 0, "submit should build the completed snapshot before final streaming");
	assert.ok(rememberIndex > completedIndex, "submit should remember the completed snapshot before streaming");
	assert.ok(streamSnapshotIndex > rememberIndex, "submit should bind the completed snapshot to streaming preview");
	assert.ok(streamIndex > streamSnapshotIndex, "submit should stream final text after snapshot binding");
});
