/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const checkpointPath = path.join(projectRoot, "src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts");
const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const loopPath = path.join(projectRoot, "src/core/agent-kernel/AgentLoopController.ts");

function makeCheckpoint(overrides = {}) {
	return {
		schemaVersion: 1,
		id: overrides.id ?? "checkpoint-safe",
		turnId: "turn-original",
		taskId: "task-original",
		traceId: "trace-original",
		conversationId: "conversation-safe",
		agentId: "agent-safe",
		boundary: overrides.boundary ?? "after_tool_result",
		channel: "native",
		step: 1,
		nextStep: 2,
		createdAt: overrides.createdAt ?? "2026-05-05T00:00:00.000Z",
		mode: "ask",
		allowedTools: overrides.allowedTools ?? ["read"],
		modelMessages: [
			{ role: "user", content: "Read Project/a.md" },
			{ role: "tool", content: "TOOL_RESULT alpha", toolCallId: "tool-1", name: "read" },
		],
		traces: [{
			runId: "read-1",
			step: 1,
			tool: "read",
			scope: "vault",
			targetPath: "Project/a.md",
			approved: true,
			approvalReason: "No approval required",
			persistedRule: false,
			viaRule: false,
			status: "ok",
			ok: true,
			summary: "Read Project/a.md",
		}],
		pendingMutations: overrides.pendingMutations ?? [],
		completedToolCalls: overrides.completedToolCalls ?? [{ toolCallId: "tool-1", tool: "read", status: "ok", step: 1, targetPath: "Project/a.md" }],
		safety: overrides.safety ?? { canAutoResume: true, reason: "stable tool result" },
		privacy: { redacted: true, localOnly: true },
		...overrides,
	};
}

test("validateCheckpointForResume rejects stale incompatible and non-idempotent checkpoints", async () => {
	const { validateCheckpointForResume } = await jiti.import(checkpointPath);
	const base = {
		now: new Date("2026-05-05T00:00:00.000Z"),
		conversationId: "conversation-safe",
		agentId: "agent-safe",
		taskId: "task-original",
		allowedTools: ["read"],
	};

	assert.deepEqual(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({ createdAt: "2026-05-03T23:59:59.000Z" }),
		}),
		{ ok: false, reason: "Checkpoint is expired." },
	);
	assert.match(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({ schemaVersion: 2 }),
		}).reason,
		/schema version/i,
	);
	assert.deepEqual(
		validateCheckpointForResume({
			...base,
			allowedTools: ["grep"],
			checkpoint: makeCheckpoint({ allowedTools: ["read"] }),
		}),
		{ ok: false, reason: "Checkpoint tool set is no longer allowed." },
	);
	assert.match(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({
				boundary: "waiting_for_approval",
				safety: { canAutoResume: false, reason: "Approval is still pending." },
			}),
		}).reason,
		/Approval is still pending/,
	);
	assert.match(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({
				boundary: "during_mutation_apply",
				safety: { canAutoResume: false, reason: "Mutation apply was in progress." },
			}),
		}).reason,
		/Mutation apply was in progress/,
	);
	assert.match(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({
				pendingMutations: [{ id: "plan-1", status: "pending_review", targetPath: "Project/a.md" }],
			}),
		}).reason,
		/pending mutation/i,
	);
	assert.match(
		validateCheckpointForResume({
			...base,
			checkpoint: makeCheckpoint({
				completedToolCalls: [{ toolCallId: "tool-1", tool: "read", status: "failed", step: 1, targetPath: "Project/a.md" }],
			}),
		}).reason,
		/tool result/i,
	);
});

test("AgentLoopController rejects unsafe checkpoint resumes and records a distinct checkpoint rejection event", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const checkpoint = makeCheckpoint({
		id: "checkpoint-pending-mutation",
		pendingMutations: [{ id: "plan-1", status: "pending_review", targetPath: "Project/a.md" }],
	});
	const consumed = [];
	const progress = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 1,
					messages: [{ role: "user", content: "Retry safely" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				assert.equal(input.step, 1);
				assert.equal(input.messages.some((message) => message.role === "tool"), false);
				return { assistantText: "Fresh retry after unsafe checkpoint.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool() {
				throw new Error("tool should not run");
			},
		},
		progress: {
			report(_input, event) {
				progress.push(event);
			},
		},
		checkpoint: {
			async save() {},
			async getResumeCheckpoint() {
				return checkpoint;
			},
			async markConsumed(checkpointId, result, reason) {
				consumed.push({ checkpointId, result, reason });
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-safety",
		taskId: "task-safety",
		traceId: "trace-safety",
		conversationId: "conversation-safe",
		agentId: "agent-safe",
		conversation: [],
		userPrompt: "Retry safely",
		mode: "ask",
		allowedTools: ["read"],
		retryOfTaskId: "task-original",
		metadata: { resumeFromCheckpointId: checkpoint.id },
	});

	assert.equal(result.assistantText, "Fresh retry after unsafe checkpoint.");
	assert.deepEqual(result.events.map((event) => event.type).filter((type) => type.startsWith("checkpoint_")), [
		"checkpoint_resume_rejected",
		"checkpoint_saved",
	]);
	assert.deepEqual(consumed, [{
		checkpointId: "checkpoint-pending-mutation",
		result: "rejected",
		reason: "Checkpoint has pending mutations and cannot be resumed idempotently.",
	}]);
	assert.ok(progress.some((event) =>
		event.phase === "checkpoint" &&
		event.checkpoint?.type === "resume_rejected" &&
		/pending mutations/i.test(event.message)
	));
	assert.equal(progress.some((event) => event.phase === "model_retry" && /checkpoint/i.test(event.message)), false);
});

test("AgentLoopController checkpoints recoverable failed tool results but marks them unsafe for auto resume", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const saved = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [{ role: "user", content: "Read a project-relative file" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				if (input.step === 1) {
					return {
						assistantText: "",
						toolCalls: [{ id: "call-missing", name: "read", args: { path: "notes/missing.md" } }],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "I could not read that path.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool({ step, tool }) {
				return {
					trace: {
						runId: "read-missing-1",
						step,
						tool: tool.name,
						scope: "vault",
						targetPath: "Project/notes/missing.md",
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "failed",
						ok: false,
						failureClass: "path_resolution",
						summary: "Path not found; use the project-relative candidate.",
						error: "Path not found",
					},
					payload: {
						ok: false,
						tool: "read",
						status: "failed",
						failureClass: "path_resolution",
						error: "Path not found",
						recovery: {
							recoverable: true,
							retryable: true,
							code: "path_recovery_available",
							candidatePaths: ["Project/notes/missing.md"],
							suggestedArgs: { path: "Project/notes/missing.md" },
						},
					},
					modelResultText: "TOOL_RESULT {\"ok\":false,\"recovery\":{\"candidatePaths\":[\"Project/notes/missing.md\"]}}",
				};
			},
		},
		checkpoint: {
			async save(checkpoint) {
				saved.push(checkpoint);
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-failed-tool-checkpoint",
		taskId: "task-failed-tool-checkpoint",
		traceId: "trace-failed-tool-checkpoint",
		conversationId: "conversation-safe",
		agentId: "agent-safe",
		conversation: [],
		userPrompt: "Read a project-relative file",
		mode: "ask",
		allowedTools: ["read"],
	});

	const failedToolResult = result.events.find((event) =>
		event.type === "tool_result" && event.payload?.toolCallId === "call-missing"
	);
	assert.ok(failedToolResult, "expected failed tool result event");
	assert.deepEqual(failedToolResult.payload?.recovery, {
		recoverable: true,
		retryable: true,
		code: "path_recovery_available",
		candidatePaths: ["Project/notes/missing.md"],
		suggestedArgs: { path: "Project/notes/missing.md" },
	});
	assert.deepEqual(failedToolResult.payload?.candidatePaths, ["Project/notes/missing.md"]);
	assert.deepEqual(failedToolResult.payload?.suggestedArgs, { path: "Project/notes/missing.md" });

	const toolCheckpoint = saved.find((checkpoint) => checkpoint.boundary === "after_tool_result");
	assert.ok(toolCheckpoint, "expected failed tool result checkpoint");
	assert.equal(toolCheckpoint.safety.canAutoResume, false);
	assert.match(toolCheckpoint.safety.reason, /tool result/i);
	assert.deepEqual(toolCheckpoint.completedToolCalls, [{
		toolCallId: "call-missing",
		tool: "read",
		status: "failed",
		step: 1,
		targetPath: "Project/notes/missing.md",
	}]);
	assert.equal(
		toolCheckpoint.modelMessages.some((message) =>
			message.role === "tool" && message.content.includes("Project/notes/missing.md")
		),
		true,
	);
});
