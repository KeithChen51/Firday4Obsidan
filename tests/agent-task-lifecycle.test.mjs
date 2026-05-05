/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const taskModulePath = path.join(projectRoot, "src/core/tasks/AgentTask.ts");
const taskStoreModulePath = path.join(projectRoot, "src/core/tasks/AgentTaskStore.ts");

async function loadTaskModules() {
	const [taskModule, storeModule] = await Promise.all([
		jiti.import(taskModulePath),
		jiti.import(taskStoreModulePath),
	]);
	return {
		...taskModule,
		...storeModule,
	};
}

test("AgentTask exposes the product lifecycle states and guarded transitions", async () => {
	const {
		AGENT_TASK_STATUSES,
		createAgentTask,
		deriveAgentTaskActions,
		transitionAgentTask,
	} = await loadTaskModules();

	assert.deepEqual(AGENT_TASK_STATUSES, [
		"created",
		"running",
		"waiting_for_approval",
		"waiting_for_user",
		"failed",
		"cancelled",
		"completed",
	]);

	const created = createAgentTask({
		id: "task-1",
		conversationId: "agent",
		turnId: "turn-1",
		agentId: "agent",
		mode: "write",
		title: "Draft a note",
	});
	assert.equal(created.status, "created");
	assert.deepEqual(deriveAgentTaskActions(created), ["cancel"]);

	const running = transitionAgentTask(created, "running", {
		summary: "Reading the current note.",
	});
	assert.equal(running.status, "running");
	assert.deepEqual(deriveAgentTaskActions(running), ["cancel"]);

	const waiting = transitionAgentTask(running, "waiting_for_approval", {
		summary: "Waiting for file mutation review.",
		waitingForApproval: {
			kind: "mutation",
			tool: "write_file",
			targetPath: "Notes/Draft.md",
			summary: "Create a draft note.",
		},
		pendingMutationCount: 1,
		changedFileCount: 1,
	});
	assert.equal(waiting.status, "waiting_for_approval");
	assert.deepEqual(deriveAgentTaskActions(waiting), ["cancel", "apply", "reject"]);

	const completedAfterReview = transitionAgentTask(waiting, "completed", {
		summary: "Pending file changes were applied.",
		pendingMutationCount: 0,
	});
	assert.equal(completedAfterReview.status, "completed");
	assert.equal(completedAfterReview.pendingMutationCount, 0);
	assert.equal(completedAfterReview.changedFileCount, 0);
	assert.deepEqual(deriveAgentTaskActions(completedAfterReview), []);

	const completed = transitionAgentTask(running, "completed", {
		summary: "Final answer delivered.",
	});
	assert.equal(completed.status, "completed");
	assert.deepEqual(deriveAgentTaskActions(completed), []);

	const failedWithCheckpoint = transitionAgentTask(running, "failed", {
		summary: "Model transport failed.",
		failureReason: "504 gateway timeout",
		checkpoint: {
			latestId: "checkpoint-1",
			boundary: "after_tool_result",
			canResume: true,
			reason: "Stable tool result checkpoint.",
			updatedAt: "2026-05-05T00:00:00.000Z",
		},
	});
	assert.equal(failedWithCheckpoint.status, "failed");
	assert.deepEqual(deriveAgentTaskActions(failedWithCheckpoint), ["resume", "retry"]);

	const failedWithoutCheckpoint = transitionAgentTask(running, "failed", {
		summary: "Model transport failed.",
		failureReason: "504 gateway timeout",
	});
	assert.deepEqual(deriveAgentTaskActions(failedWithoutCheckpoint), ["retry"]);

	assert.throws(
		() => transitionAgentTask(completed, "running", { summary: "Restart same task." }),
		/Invalid AgentTask transition/,
	);
});

test("AgentTaskStore persists tasks and supports conversation, turn, retry, cancel, and continue queries", async () => {
	const { AgentTaskStore } = await loadTaskModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-agent-task-store-"));
	const storePath = path.join(root, "agent-tasks.json");
	const store = new AgentTaskStore({ storePath });

	const task = await store.create({
		id: "task-store-1",
		conversationId: "agent",
		turnId: "turn-store-1",
		agentId: "agent",
		mode: "research",
		title: "Find references",
	});
	await store.markRunning(task.id, { summary: "Searching the vault." });
	await store.markWaitingForUser(task.id, {
		summary: "Needs a source preference.",
		waitingForUser: {
			prompt: "Choose a citation style.",
		},
	});
	await store.markFailed(task.id, {
		failureReason: "Model transport failed.",
		checkpoint: {
			latestId: "checkpoint-store",
			boundary: "after_tool_result",
			canResume: true,
			reason: "Stable tool result checkpoint.",
			updatedAt: "2026-05-05T00:00:00.000Z",
		},
	});
	const retry = await store.createRetryTask(task.id, {
		id: "task-store-retry",
		turnId: "turn-store-retry",
	});
	const continuation = await store.createContinuationTask(task.id, {
		id: "task-store-continue",
		turnId: "turn-store-continue",
	});
	await store.cancelTask(continuation.id, { reason: "User cancelled from UI." });

	const reloaded = new AgentTaskStore({ storePath });
	assert.equal((await reloaded.get(task.id))?.status, "failed");
	assert.equal((await reloaded.get(task.id))?.failureReason, "Model transport failed.");
	assert.equal((await reloaded.get(task.id))?.checkpoint?.latestId, "checkpoint-store");
	assert.deepEqual((await reloaded.get(task.id))?.availableActions, ["resume", "retry"]);
	assert.equal((await reloaded.getByTurnId("turn-store-1"))?.id, task.id);
	assert.deepEqual((await reloaded.getByConversationId("agent")).map((item) => item.id), [
		task.id,
		retry.id,
		continuation.id,
	]);
	assert.equal((await reloaded.get(retry.id))?.retryOfTaskId, task.id);
	assert.equal((await reloaded.get(continuation.id))?.continueFromTaskId, task.id);
	assert.equal((await reloaded.get(continuation.id))?.status, "cancelled");
});

test("runtime task state and persisted turn event refs agree for completed turns", async () => {
	const result = await runAgentRuntimeScenario({
		name: "task lifecycle completed turn",
		modelSteps: [
			{ final: "The note says FRIDAY should keep task state visible." },
		],
	});

	assert.equal(result.task?.status, "completed");
	assert.equal(result.task?.turnId, result.turnId);
	assert.equal(result.task?.conversationId, "agent");
	assert.ok(result.tasks.some((task) => task.id === result.task.id));
	assert.ok(result.turnEvents.length > 0, "turn event log should be persisted");
	assert.ok(result.turnEvents.every((event) => event.taskId === result.task.id));
});

test("runtime records failed and cancelled task terminal states", async () => {
	const failed = await runAgentRuntimeScenario({
		name: "task lifecycle failed turn",
		modelSteps: [
			{ error: "Synthetic transport failure" },
		],
	});
	assert.equal(failed.task?.status, "failed");
	assert.match(failed.task?.failureReason ?? "", /Synthetic transport failure/);
	assert.ok(failed.turnEvents.some((event) => event.type === "turn_failed"));

	const cancelled = await runAgentRuntimeScenario({
		name: "task lifecycle cancelled turn",
		modelSteps: [
			{ error: "User aborted the task" },
		],
	});
	assert.equal(cancelled.task?.status, "cancelled");
	assert.match(cancelled.task?.failureReason ?? "", /User aborted the task/);
	assert.ok(cancelled.turnEvents.some((event) => event.type === "turn_cancelled"));
});

test("runtime cancellation aborts a delayed model turn before late auto-approved writes", async () => {
	const result = await runAgentRuntimeScenario({
		name: "cancel prevents late write",
		files: {
			"Project/workspace/a.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "auto",
				fileMutationMode: "autoApproved",
			},
		},
		modelSteps: [
			{
				delayMs: 25,
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "late write", mode: "update" },
				},
			},
		],
		cancelOnProgress: { phase: "model_request" },
	});

	assert.equal(result.status, "failed");
	assert.equal(result.task?.status, "cancelled");
	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.storedMutations.length, 0);
	assert.ok(result.turnEvents.some((event) => event.type === "turn_cancelled"));
	assert.equal(result.turnEventSummary.status, "cancelled");
	assert.deepEqual(result.turnEventSummary.taskTimeline.map((item) => item.status), [
		"created",
		"running",
		"cancelled",
	]);
});

test("runtime retry re-executes a failed task from stored input", async () => {
	const result = await runAgentRuntimeScenario({
		name: "retry failed task",
		userPrompt: "Read retry target",
		files: {
			"Project/retry.md": "retry source",
		},
		modelSteps: [
			{ error: "Synthetic transport failure" },
			{ tool: { name: "read", args: { path: "Project/retry.md" } } },
			{ assistant: "Recovered from retry with retry source." },
		],
		afterTurnActions: ["retryFirstTask"],
	});

	assert.equal(result.task?.status, "failed");
	assert.equal(result.taskActionResults.length, 1);
	const retry = result.taskActionResults[0];
	assert.equal(retry.type, "retryFirstTask");
	assert.equal(retry.result.task.status, "completed");
	assert.equal(retry.result.task.retryOfTaskId, result.task.id);
	assert.match(retry.result.assistantText, /Recovered from retry/);
	assert.ok(retry.result.traces.some((trace) => trace.tool === "read" && trace.status === "ok"));
	assert.ok(result.tasks.some((task) => task.id === retry.result.task.id && task.retryOfTaskId === result.task.id));
});

test("runtime resume continues a retryable failed task from checkpoint without rebuilding tool work", async () => {
	const result = await runAgentRuntimeScenario({
		name: "checkpoint resume failed task",
		userPrompt: "Read checkpoint target",
		files: {
			"Project/checkpoint.md": "checkpoint source",
		},
		modelSteps: [
			{ tool: { id: "call-checkpoint-read", name: "read", args: { path: "Project/checkpoint.md" } } },
			{ error: "504 gateway timeout" },
			{ assistant: "Recovered from checkpoint with checkpoint source." },
		],
		afterTurnActions: ["resumeFirstTask"],
	});

	assert.equal(result.task?.status, "failed");
	assert.ok(result.task?.availableActions.includes("resume"));
	assert.equal(result.task?.checkpoint?.canResume, true);
	const resume = result.taskActionResults[0];
	assert.equal(resume.type, "resumeFirstTask");
	assert.equal(resume.result.task.status, "completed");
	assert.equal(resume.result.task.retryOfTaskId, result.task.id);
	assert.match(resume.result.assistantText, /Recovered from checkpoint/);
	assert.equal(resume.result.traces.length, 1);
	assert.equal(resume.result.traces[0].tool, "read");
	assert.match(resume.result.modelRequests.at(-1).sanitizedText, /TOOL_RESULT/);
	assert.match(resume.result.modelRequests.at(-1).sanitizedText, /checkpoint source/);
});

test("runtime tool approval transitions task through waiting_for_approval and back to running", async () => {
	const result = await runAgentRuntimeScenario({
		name: "tool approval task state",
		agentMode: "debug",
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				enableExecTool: true,
			},
		},
		approvals: ["allow"],
		modelSteps: [
			{
				tool: {
					name: "exec",
					args: { command: "git", args: ["status"] },
				},
			},
			{ assistant: "Updated after approval." },
		],
	});

	assert.equal(result.approvalRequests.length, 1);
	assert.equal(result.task?.status, "completed");
	assert.deepEqual(
		result.turnEventSummary.taskTimeline.map((item) => item.status),
		["created", "running", "waiting_for_approval", "running", "completed"],
	);
	const waitEvent = result.turnEventSummary.taskTimeline.find((item) => item.status === "waiting_for_approval");
	assert.match(waitEvent?.summary ?? "", /exec/);
});

test("runtime retry does not re-apply an already applied mutation plan", async () => {
	const result = await runAgentRuntimeScenario({
		name: "retry after applied mutation",
		userPrompt: "Write the approved note once",
		files: {
			"Project/workspace/retry-mutation.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		approvals: ["allow"],
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/retry-mutation.md", content: "applied once", mode: "update" },
				},
			},
			{ assistant: "Prepared the reviewed write." },
			{ assistant: "Retry completed without touching the already applied mutation." },
		],
		afterTurnActions: [
			"acceptFirstEditPlan",
			"retryFirstTask",
		],
	});

	const retry = result.taskActionResults.find((item) => item.type === "retryFirstTask");
	assert.ok(retry, "retry action result should be returned");
	assert.equal(result.task?.status, "completed");
	assert.equal(retry.result.task.status, "completed");
	assert.equal(result.files["Project/workspace/retry-mutation.md"], "applied once");
	assert.equal(result.storedMutations.length, 1);
	assert.equal(result.storedMutations[0].status, "applied");
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(retry.result.traces.length, 0);
});

test("runtime continue resumes a waiting task with user input", async () => {
	const result = await runAgentRuntimeScenario({
		name: "continue waiting task",
		files: {
			"Project/workspace/a.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "auto",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Prepared the update for review." },
			{ assistant: "Continuing after conflict with your instruction." },
		],
		afterTurnActions: [
			{ type: "modifyFile", path: "Project/workspace/a.md", content: "external change" },
			"acceptFirstEditPlan",
			{ type: "continueFirstTask", userPrompt: "Keep my external change and summarize the conflict." },
		],
	});

	const continuation = result.taskActionResults.find((item) => item.type === "continueFirstTask");
	assert.ok(continuation, "continue action result should be returned");
	assert.equal(result.task?.status, "waiting_for_user");
	assert.equal(continuation.result.task.status, "completed");
	assert.equal(continuation.result.task.continueFromTaskId, result.task.id);
	assert.match(continuation.result.modelRequests.at(-1).sanitizedText, /Keep my external change/);
	assert.match(continuation.result.assistantText, /Continuing after conflict/);
});

test("AgentTask redacts secret-like title, summary, and failure text before persistence", async () => {
	const { AgentTaskStore } = await loadTaskModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-agent-task-redaction-"));
	const storePath = path.join(root, "agent-tasks.json");
	const store = new AgentTaskStore({ storePath });
	const task = await store.create({
		id: "task-secret",
		conversationId: "agent",
		title: "Use Authorization: Bearer sk-secret1234567890 and token=abc123456789",
		summary: "api_key: sk-secret1234567890",
	});
	await store.markFailed(task.id, {
		summary: "Failed with Bearer sk-secret1234567890",
		failureReason: "Header Authorization: Bearer sk-secret1234567890",
	});

	const raw = await fs.readFile(storePath, "utf8");
	assert.doesNotMatch(raw, /sk-secret1234567890/);
	assert.doesNotMatch(raw, /abc123456789/);
	const reloaded = new AgentTaskStore({ storePath });
	const saved = await reloaded.get(task.id);
	assert.match(saved.title, /\[redacted\]/i);
	assert.match(saved.summary, /\[redacted\]/i);
	assert.match(saved.failureReason, /\[redacted\]/i);
});
