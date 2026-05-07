/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const loopPath = path.join(projectRoot, "src/core/agent-kernel/AgentLoopController.ts");

function makeCheckpoint(overrides = {}) {
	return {
		schemaVersion: 1,
		id: overrides.id ?? "checkpoint-1",
		turnId: overrides.turnId ?? "turn-original",
		taskId: overrides.taskId ?? "task-original",
		traceId: overrides.traceId ?? "trace-original",
		conversationId: overrides.conversationId ?? "conversation-checkpoint",
		agentId: overrides.agentId ?? "agent-checkpoint",
		boundary: overrides.boundary ?? "after_tool_result",
		channel: overrides.channel ?? "native",
		step: overrides.step ?? 1,
		nextStep: overrides.nextStep ?? 2,
		createdAt: overrides.createdAt ?? new Date().toISOString(),
		modelOverride: "deepseek/deepseek-v4-pro",
		mode: "ask",
		allowedTools: ["read"],
		modelMessages: overrides.modelMessages ?? [
			{ role: "system", content: "system prompt" },
			{ role: "user", content: "Read Project/a.md" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "call-1", name: "read", args: { path: "Project/a.md" } }],
			},
			{ role: "tool", content: "TOOL_RESULT alpha", toolCallId: "call-1", name: "read" },
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
		pendingMutations: [],
		completedToolCalls: [{ toolCallId: "call-1", tool: "read", status: "ok", step: 1, targetPath: "Project/a.md" }],
		safety: overrides.safety ?? { canAutoResume: true, reason: "stable tool result" },
		privacy: { redacted: true, localOnly: true },
		...overrides,
	};
}

test("AgentLoopController resumes from after_tool_result checkpoint without re-running completed tools", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const checkpoint = makeCheckpoint();
	let contextBuilds = 0;
	let toolRuns = 0;
	const modelRequests = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				contextBuilds += 1;
				return {
					toolCallingMode: "native",
					maxIterations: 3,
					messages: [
						{ role: "system", content: "fresh system prompt" },
						{ role: "user", content: "Read Project/a.md" },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				modelRequests.push(input);
				if (input.step === 1) {
					return {
						assistantText: "",
						toolCalls: [{ id: "call-1", name: "read", args: { path: "Project/a.md" } }],
						finishReason: "tool_calls",
					};
				}
				assert.equal(input.messages.some((message) => message.role === "tool" && message.content.includes("alpha")), true);
				return {
					assistantText: "The file says alpha.",
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool() {
				toolRuns += 1;
				return {
					trace: checkpoint.traces[0],
					payload: { ok: true, tool: "read", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: "TOOL_RESULT alpha",
				};
			},
		},
		checkpoint: {
			async save() {},
			async getResumeCheckpoint(input) {
				return input.metadata?.resumeFromCheckpointId === checkpoint.id ? checkpoint : null;
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-resume",
		taskId: "task-resume",
		traceId: "trace-resume",
		conversationId: "conversation-checkpoint",
		agentId: "agent-checkpoint",
		conversation: [],
		userPrompt: "Read Project/a.md",
		mode: "ask",
		allowedTools: ["read"],
		retryOfTaskId: "task-original",
		metadata: { resumeFromCheckpointId: checkpoint.id },
		budget: { tool: { maxIterations: 3 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "The file says alpha.");
	assert.equal(contextBuilds, 0);
	assert.equal(toolRuns, 0);
	assert.equal(modelRequests.length, 1);
	assert.equal(modelRequests[0].step, 2);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].runId, "read-1");
});

test("AgentLoopController rejects unsafe checkpoint boundaries and falls back to original retry", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const checkpoint = makeCheckpoint({
		id: "checkpoint-unsafe",
		boundary: "during_tool_execution",
		safety: { canAutoResume: false, reason: "Tool execution was in flight." },
	});
	let contextBuilds = 0;
	const consumed = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				contextBuilds += 1;
				return {
					toolCallingMode: "native",
					maxIterations: 1,
					messages: [{ role: "user", content: "Retry from the beginning" }],
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
				return {
					assistantText: "Fresh retry answer.",
					toolCalls: [],
					finishReason: "stop",
				};
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
		turnId: "turn-unsafe",
		taskId: "task-unsafe",
		traceId: "trace-unsafe",
		conversationId: "conversation-checkpoint",
		agentId: "agent-checkpoint",
		conversation: [],
		userPrompt: "Retry from the beginning",
		mode: "ask",
		allowedTools: ["read"],
		retryOfTaskId: "task-original",
		metadata: { resumeFromCheckpointId: checkpoint.id },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Fresh retry answer.");
	assert.equal(contextBuilds, 1);
	assert.deepEqual(consumed, [{
		checkpointId: "checkpoint-unsafe",
		result: "rejected",
		reason: "Tool execution was in flight.",
	}]);
});

test("AgentLoopController repairs dirty native checkpoint messages before the next model request", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const checkpoint = makeCheckpoint({
		id: "checkpoint-dirty-native-history",
		modelMessages: [
			{ role: "system", content: "system prompt" },
			{ role: "user", content: "Read project-relative notes" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "call-ok", name: "read", args: { path: "notes/source.md" } }],
			},
			{ role: "tool", content: "TOOL_RESULT clean", toolCallId: "call-ok", name: "read" },
			{ role: "tool", content: "TOOL_RESULT duplicate", toolCallId: "call-ok", name: "read" },
			{ role: "tool", content: "TOOL_RESULT orphan", toolCallId: "call-orphan", name: "read" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "call-dangling", name: "grep", args: { pattern: "todo" } }],
			},
			{ role: "user", content: "continue" },
		],
	});
	let observedMessages = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				throw new Error("checkpoint resume should not rebuild context");
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				observedMessages = input.messages;
				return {
					assistantText: "Recovered from clean tool history.",
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool() {
				throw new Error("completed checkpoint tool should not be re-run");
			},
		},
		checkpoint: {
			async save() {},
			async getResumeCheckpoint() {
				return checkpoint;
			},
			async markConsumed() {},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-dirty-resume",
		taskId: "task-dirty-resume",
		traceId: "trace-dirty-resume",
		conversationId: "conversation-checkpoint",
		agentId: "agent-checkpoint",
		conversation: [],
		userPrompt: "continue",
		mode: "ask",
		allowedTools: ["read", "grep"],
		retryOfTaskId: "task-original",
		metadata: { resumeFromCheckpointId: checkpoint.id },
	});

	assert.equal(result.assistantText, "Recovered from clean tool history.");
	assert.equal(observedMessages.filter((message) => message.role === "tool").length, 1);
	assert.equal(observedMessages.some((message) => message.role === "tool" && message.toolCallId === "call-orphan"), false);
	assert.equal(
		observedMessages.some((message) =>
			Array.isArray(message.toolCalls) && message.toolCalls.some((toolCall) => toolCall.id === "call-dangling")
		),
		false,
	);
});
