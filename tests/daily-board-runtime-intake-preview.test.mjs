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
	assert.doesNotMatch(previewBuilderBlock, /aiRuntimeTrajectoryStore|rememberCompletedTrajectorySnapshot|projectReplaySummary/);
	assert.doesNotMatch(submitBlock, /content: this\.aiLocalIntakePreview/);
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
