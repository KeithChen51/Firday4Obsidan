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
						reasoningContent: "need evidence",
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "The file says alpha.",
					toolCalls: [],
					reasoningContent: "done",
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

test("main wires AgentKernel to AgentLoopController by default instead of LegacyAgentRuntimeAdapter", () => {
	const source = fs.readFileSync(mainPath, "utf8");
	assert.match(source, /AgentLoopController/);
	assert.doesNotMatch(source, /new AgentKernel\(\s*new LegacyAgentRuntimeAdapter/);
});
