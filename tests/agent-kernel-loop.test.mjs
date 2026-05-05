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

const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const loopPath = path.join(projectRoot, "src/core/agent-kernel/AgentLoopController.ts");
const mainPath = path.join(projectRoot, "src/main.ts");

test("AgentKernel executes a native model/tool loop through AgentLoopController", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const modelRequests = [];
	const toolRequests = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 3,
					messages: [
						{ role: "system", content: "system prompt" },
						...input.conversation.filter((message) => message.role !== "tool"),
						{ role: "user", content: input.userPrompt },
					],
					contextSummary: { used: 10, softLimit: 100, hardLimit: 120, trimmedChannels: [] },
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				modelRequests.push(input);
				if (modelRequests.length === 1) {
					return {
						assistantText: "",
						toolCalls: [{ id: "call-1", name: "read", args: { path: "Project/a.md" } }],
						reasoningArtifact: {
							hasReasoning: true,
							provider: "deepseek",
							model: "deepseek-reasoner",
							rawFormat: "reasoning_content",
							visibleSummary: "Decided to read Project/a.md before answering.",
							rawReasoning: "raw chain of thought should not enter kernel events",
							continuationPolicy: "drop",
							metadata: { sourceProtocol: "chat_completions" },
						},
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "The file says alpha.",
					toolCalls: [],
					reasoningArtifact: {
						hasReasoning: true,
						provider: "openai",
						model: "gpt-5.1",
						rawFormat: "responses_reasoning",
						visibleSummary: "Summarized the tool result.",
						continuationPolicy: "provider_managed",
						metadata: { sourceProtocol: "responses" },
					},
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				toolRequests.push(input);
				return {
					trace: {
						runId: "read-1",
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: input.tool.args.path,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: "Read Project/a.md",
					},
					payload: { ok: true, tool: "read", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: 'TOOL_RESULT {"ok":true,"tool":"read","data":{"content":"alpha"}}',
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-h",
		taskId: "task-h",
		traceId: "trace-h",
		conversationId: "conversation-h",
		agentId: "agent-h",
		conversation: [
			{ role: "assistant", content: "prior answer" },
			{ role: "tool", content: "orphan result", toolCallId: "orphan" },
		],
		userPrompt: "Read the file",
		mode: "ask",
		budget: { tool: { maxIterations: 3 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "The file says alpha.");
	assert.deepEqual(toolRequests.map((request) => request.tool.name), ["read"]);
	assert.equal(modelRequests.length, 2);
	assert.equal(modelRequests[0].messages.some((message) => message.role === "tool"), false);
	assert.equal(modelRequests[0].traceId, "trace-h");
	assert.equal(modelRequests[0].taskId, "task-h");
	assert.equal(modelRequests[0].budget.tool.maxIterations, 3);
	const eventTypes = result.events.map((event) => event.type);
	assert.deepEqual(eventTypes, [
		"turn_started",
		"model_request",
		"model_response",
		"tool_call",
		"tool_result",
		"model_request",
		"model_response",
		"turn_completed",
	]);
	for (const event of result.events) {
		assert.equal(event.traceId, "trace-h");
		assert.equal(event.taskId, "task-h");
	}
	const modelResponsePayloads = result.events
		.filter((event) => event.type === "model_response")
		.map((event) => event.payload);
	assert.deepEqual(modelResponsePayloads.map((payload) => payload.reasoningVisibleSummary), [
		"Decided to read Project/a.md before answering.",
		"Summarized the tool result.",
	]);
	assert.deepEqual(modelResponsePayloads.map((payload) => payload.reasoningProvider), ["deepseek", "openai"]);
	assert.equal(JSON.stringify(modelResponsePayloads).includes("raw chain of thought"), false);
	assert.equal(modelResponsePayloads.some((payload) => "hasReasoningContent" in payload), false);
});

test("AgentLoopController saves context and tool-result checkpoints without raw reasoning", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const savedCheckpoints = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt with endpoint https://zenmux.ai/api/v1 and Authorization: Bearer keep-out" },
						{ role: "user", content: "Read the file" },
					],
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
						toolCalls: [{ id: "call-1", name: "read", args: { path: "Project/a.md" } }],
						reasoningArtifact: {
							hasReasoning: true,
							provider: "deepseek",
							model: "deepseek-reasoner",
							rawFormat: "reasoning_content",
							visibleSummary: "safe reasoning summary",
							rawReasoning: "raw chain of thought must not persist",
							continuationPolicy: "drop",
							metadata: { sourceProtocol: "chat_completions" },
						},
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "Done",
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "read-1",
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: input.tool.args.path,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: "Read Project/a.md",
					},
					payload: { ok: true, tool: "read", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: "TOOL_RESULT alpha",
				};
			},
		},
		checkpoint: {
			async save(checkpoint) {
				savedCheckpoints.push(checkpoint);
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-checkpoint-save",
		taskId: "task-checkpoint-save",
		traceId: "trace-checkpoint-save",
		conversationId: "conversation-checkpoint-save",
		agentId: "agent-checkpoint-save",
		conversation: [],
		userPrompt: "Read the file",
		mode: "ask",
	});

	assert.equal(result.status, "completed");
	assert.deepEqual(savedCheckpoints.map((checkpoint) => checkpoint.boundary), ["context_ready", "after_tool_result"]);
	assert.equal(savedCheckpoints[0].nextStep, 1);
	assert.equal(savedCheckpoints[1].nextStep, 2);
	assert.equal(savedCheckpoints[1].completedToolCalls[0].toolCallId, "call-1");
	const serialized = JSON.stringify(savedCheckpoints);
	assert.equal(serialized.includes("raw chain of thought"), false);
	assert.equal(serialized.includes("reasoning_content"), false);
	assert.equal(serialized.includes("https://zenmux.ai/api/v1"), false);
	assert.equal(serialized.includes("Bearer keep-out"), false);
});

test("AgentLoopController ignores checkpoint save failures", async () => {
	const { AgentLoopController } = await jiti.import(loopPath);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 1,
					messages: [{ role: "user", content: "test" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools() {
				return {
					assistantText: "Recovered",
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
			async save() {
				throw new Error("disk full");
			},
		},
	});

	const result = await controller.execute({
		turnId: "turn-checkpoint-save-failure",
		taskId: "task-checkpoint-save-failure",
		traceId: "trace-checkpoint-save-failure",
		conversationId: "conversation-h",
		agentId: "agent-h",
		conversation: [],
		userPrompt: "recover",
		mode: "ask",
	}, {
		turnId: "turn-checkpoint-save-failure",
		taskId: "task-checkpoint-save-failure",
		traceId: "trace-checkpoint-save-failure",
		conversationId: "conversation-h",
		agentId: "agent-h",
		mode: "ask",
		budget: {},
		emit() {},
		snapshotEvents() { return []; },
		get signal() { return undefined; },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Recovered");
});

test("AgentLoopController keeps retryable native transport failures out of prompt fallback", async () => {
	const { AgentLoopController } = await jiti.import(loopPath);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "auto",
					maxIterations: 2,
					messages: [{ role: "user", content: "test" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt fallback must not run");
			},
			async requestWithTools() {
				throw new Error("504 gateway timeout");
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
		fallbackPolicy: {
			isRetryableTransportFailure: (message) => /504|timeout/i.test(message),
			shouldFallbackToPrompt: () => true,
		},
	});

	await assert.rejects(
		() => controller.execute({
			turnId: "turn-h-failure",
			conversationId: "conversation-h",
			agentId: "agent-h",
			conversation: [],
			userPrompt: "fail",
			mode: "ask",
		}, {
			turnId: "turn-h-failure",
			traceId: "trace-h-failure",
			conversationId: "conversation-h",
			agentId: "agent-h",
			mode: "ask",
			budget: {},
			emit() {},
			snapshotEvents() { return []; },
			get signal() { return undefined; },
		}),
		/504 gateway timeout/,
	);
});

test("AgentLoopController forwards model driver transport telemetry as model_retry progress", async () => {
	const { AgentLoopController } = await jiti.import(loopPath);
	const progressEvents = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 1,
					messages: [{ role: "user", content: "test" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				input.onTransportEvent({
					type: "retry_scheduled",
					requestId: "llm-kernel-1",
					channel: "chat_with_tools",
					endpointIndex: 0,
					endpointCount: 1,
					attempt: 1,
					maxAttempts: 4,
					delayMs: 700,
					httpStatus: 504,
					retryable: true,
					message: "504 Gateway Timeout",
				});
				return {
					assistantText: "Recovered",
					toolCalls: [],
					reasoningContent: "",
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
		progress: {
			report(_input, event) {
				progressEvents.push(event);
			},
		},
	});

	const result = await controller.execute({
		turnId: "turn-transport-progress",
		taskId: "task-transport-progress",
		traceId: "trace-transport-progress",
		conversationId: "conversation-h",
		agentId: "agent-h",
		conversation: [],
		userPrompt: "recover",
		mode: "ask",
	}, {
		turnId: "turn-transport-progress",
		taskId: "task-transport-progress",
		traceId: "trace-transport-progress",
		conversationId: "conversation-h",
		agentId: "agent-h",
		mode: "ask",
		budget: {},
		emit() {},
		snapshotEvents() { return []; },
		get signal() { return undefined; },
	});

	const retryProgress = progressEvents.find((event) => event.phase === "model_retry");
	assert.equal(result.status, "completed");
	assert.ok(retryProgress, "expected model_retry progress");
	assert.equal(retryProgress.depth, 0);
	assert.equal(retryProgress.step, 1);
	assert.equal(retryProgress.transport.type, "retry_scheduled");
	assert.equal(retryProgress.transport.requestId, "llm-kernel-1");
	assert.equal(retryProgress.transport.attempt, 1);
	assert.equal(retryProgress.transport.maxAttempts, 4);
	assert.equal(retryProgress.transport.delayMs, 700);
	assert.equal(retryProgress.transport.httpStatus, 504);
	assert.equal(retryProgress.transport.retryable, true);
	assert.match(retryProgress.message, /attempt 1\/4/);
	assert.equal(progressEvents.some((event) => event.phase === "error"), false);
});

test("AgentLoopController keeps retryable transport telemetry failures out of prompt fallback", async () => {
	const { AgentLoopController } = await jiti.import(loopPath);
	const progressEvents = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "auto",
					maxIterations: 1,
					messages: [{ role: "user", content: "test" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt fallback must not run");
			},
			async requestWithTools(input) {
				input.onTransportEvent({
					type: "request_exhausted",
					requestId: "llm-kernel-2",
					channel: "chat_with_tools",
					endpointIndex: 0,
					endpointCount: 1,
					attempt: 4,
					maxAttempts: 4,
					httpStatus: 504,
					retryable: false,
					message: "504 Gateway Timeout",
				});
				throw new Error("504 gateway timeout");
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
				progressEvents.push(event);
			},
		},
		fallbackPolicy: {
			isRetryableTransportFailure: (message) => /504|timeout/i.test(message),
			shouldFallbackToPrompt: () => true,
		},
	});

	await assert.rejects(
		() => controller.execute({
			turnId: "turn-transport-failure",
			conversationId: "conversation-h",
			agentId: "agent-h",
			conversation: [],
			userPrompt: "fail",
			mode: "ask",
		}, {
			turnId: "turn-transport-failure",
			traceId: "trace-transport-failure",
			conversationId: "conversation-h",
			agentId: "agent-h",
			mode: "ask",
			budget: {},
			emit() {},
			snapshotEvents() { return []; },
			get signal() { return undefined; },
		}),
		/504 gateway timeout/,
	);

	const retryProgress = progressEvents.find((event) => event.phase === "model_retry");
	assert.ok(retryProgress, "expected model_retry progress before failure");
	assert.equal(retryProgress.transport.type, "request_exhausted");
	assert.equal(retryProgress.transport.retryable, false);
});

test("main wires AgentKernel to AgentLoopController by default instead of LegacyAgentRuntimeAdapter", () => {
	const source = fs.readFileSync(mainPath, "utf8");
	assert.match(source, /AgentLoopController/);
	assert.doesNotMatch(source, /new AgentKernel\(\s*new LegacyAgentRuntimeAdapter/);
});
