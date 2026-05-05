/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
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

async function loadRenderer() {
	return jiti.import(rendererPath);
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
	assert.match(root.textContent, /FRIDAY 的工作过程 3s/);
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
	assert.match(root.textContent, /FRIDAY 的工作过程 4s/);
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
	assert.equal(root.countByClass("friday-agent-process-recovery"), 1);
	assert.equal(root.countByClass("friday-agent-process-step"), 2);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	assert.match(root.textContent, /读取上下文/);
	assert.match(root.textContent, /运行遇到问题/);
	assert.match(root.textContent, /Notes\/A\.md/);
	assert.match(root.textContent, /Permission denied/);
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
	assert.match(root.textContent, /FRIDAY 的思路 8s/);
	assert.match(root.textContent, /Checked the request and current workspace/);
	assert.equal(root.textContent.includes(rawCot), false);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
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

	assert.ok(root.hasClassInTree("is-reconnecting"));
	assert.match(root.textContent, /attempt 1\/4/);
	assert.match(root.textContent, /700ms/);
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
	assert.match(root.textContent, /读取上下文/);
	assert.match(root.textContent, /创建\/修改文件/);
	assert.match(root.textContent, /等待确认文件修改/);
	assert.match(root.textContent, /1 个文件改动待审核/);
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
	assert.match(root.textContent, /FRIDAY 的工作过程 5s/);
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
	assert.ok(directChildIndex(flow, "friday-agent-process-header") >= 0, "process header should be a direct flow child");
	assert.ok(directChildIndex(flow, "friday-ai-answer-content") >= 0, "answer body should be a direct flow child");
	assert.ok(directChildIndex(flow, "friday-agent-artifacts") >= 0, "artifacts should be a direct flow child");
	assert.ok(
		directChildIndex(flow, "friday-agent-process-header") < directChildIndex(flow, "friday-ai-answer-content"),
		"process disclosure belongs before the answer body",
	);
	assert.ok(
		directChildIndex(flow, "friday-agent-artifacts") > directChildIndex(flow, "friday-ai-answer-content"),
		"artifacts belong after the answer body",
	);
	assert.equal(flow.children.slice(directChildIndex(flow, "friday-ai-answer-content") + 1).some((child) => child.hasClassInTree("friday-agent-process-header")), false);
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
	assert.ok(directChildIndex(flow, "friday-agent-process-header") < directChildIndex(flow, "friday-agent-process-panel"));
	assert.ok(directChildIndex(flow, "friday-agent-process-panel") < directChildIndex(flow, "friday-ai-answer-content"));
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

	assert.match(root.textContent, /FRIDAY 的工作过程 4s/);
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
	assert.match(root.textContent, /读取上下文/);
	assert.match(root.textContent, /Read Notes\/Today\.md/);
	assert.doesNotMatch(root.textContent, /\bContext\b|\bReasoning\b|\bTools\b|\bReview\b|\bFinalize\b/);
	assert.ok(
		directChildIndex(root.findByClass("friday-ai-answer-flow"), "friday-agent-process-panel") <
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

test("DailyBoard embeds completed replay in the matching assistant answer row", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(source, /renderAgentAnswerFlow/);
	assert.match(source, /const lastAssistantIndex = this\.findLastAssistantMessageIndex\(\)/);
	assert.match(source, /const completedSnapshotForMessage = this\.getCompletedTrajectorySnapshotForMessage\(message, index, lastAssistantIndex\)/);
	assert.match(source, /this\.renderAiMessage\(containerEl, message, false, completedSnapshotForMessage\)/);
	assert.doesNotMatch(source, /renderCompletedRuntimeDisclosure/);
	const renderMessageIndex = source.indexOf("this.renderAiMessage(containerEl, message, false, completedSnapshotForMessage)");
	assert.ok(renderMessageIndex >= 0, "answer should render in the message loop");
	assert.match(source, /private isProcessExpanded\(snapshot: AgentTrajectorySnapshot \| null\): boolean/);
	assert.match(source, /private toggleProcessExpanded\(snapshot: AgentTrajectorySnapshot \| null\): void/);
	assert.doesNotMatch(source, /private aiCompletedReplayExpanded = false/);
	assert.match(source, /private async openAgentArtifactInWorkspace\(pathValue: string\): Promise<void>/);
	assert.match(source, /this\.app\.vault\.getAbstractFileByPath\(pathValue\)/);
	assert.match(source, /this\.app\.workspace\.getLeaf\(false\)\.openFile\(file\)/);
	assert.doesNotMatch(source, /showItemInFolder|shell\.openPath|openExternal/);
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
