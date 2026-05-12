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
const RAW_MAX_TOOL_ITERATION_TEXTS = [
	"Tool iteration limit reached; stopped further tool calls for this turn.",
	"Maximum tool-iteration limit reached",
];

function assertNoRawMaxToolIterationText(value) {
	const serialized = typeof value === "string" ? value : JSON.stringify(value ?? {});
	for (const rawText of RAW_MAX_TOOL_ITERATION_TEXTS) {
		assert.equal(serialized.includes(rawText), false, `exposed raw runtime text: ${rawText}`);
	}
}

test("AgentLoopController returns a structured duplicate failure without executing identical failed native calls twice", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const toolExecutions = [];
	const toolResultMessages = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 4,
					messages: [{ role: "user", content: "Read missing file" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				for (const message of input.messages) {
					if (message.role === "tool") {
						toolResultMessages.push(message.content);
					}
				}
				if (input.step === 1) {
					return {
						assistantText: "",
						toolCalls: [{
							id: "call-1",
							name: "read",
							args: { path: "workspace/missing.md", options: { beta: true, alpha: 1 } },
						}],
						finishReason: "tool_calls",
					};
				}
				if (input.step === 2) {
					return {
						assistantText: "",
						toolCalls: [{
							id: "call-2",
							name: "read",
							args: { options: { alpha: 1, beta: true }, path: "workspace/missing.md" },
						}],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "I will use the suggested path next.",
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
				toolExecutions.push(input);
				return {
					trace: {
						runId: "read-failed-1",
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: input.tool.args.path,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "failed",
						failureClass: "invalid_input",
						ok: false,
						summary: "Vault file was not found.",
						error: "Vault file was not found.",
					},
					payload: {
						ok: false,
						tool: "read",
						status: "failed",
						failureClass: "invalid_input",
						error: "Vault file was not found.",
						recovery: {
							recoverable: true,
							retryable: false,
							code: "vault_file_not_found",
							message: "A likely active-project path exists.",
							suggestedArgs: { path: "Project/workspace/missing.md" },
							candidatePaths: ["Project/workspace/missing.md"],
						},
						trace: {
							inputPath: "workspace/missing.md",
							targetPath: "workspace/missing.md",
							projectRoot: "Project",
						},
					},
					modelResultText: 'TOOL_RESULT {"ok":false,"tool":"read","status":"failed","failureClass":"invalid_input"}',
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-duplicate-native",
		traceId: "trace-duplicate-native",
		conversationId: "conversation-duplicate-native",
		agentId: "agent-duplicate-native",
		conversation: [],
		userPrompt: "Read missing file",
		mode: "ask",
	});

	assert.equal(result.status, "completed");
	assert.equal(toolExecutions.length, 1);
	assert.equal(result.traces.length, 2);
	assert.equal(result.traces[1].status, "failed");
	assert.equal(result.traces[1].failureClass, "invalid_input");
	assert.match(result.traces[1].summary, /identical call already failed/i);

	const duplicateResult = JSON.parse(toolResultMessages.at(-1).replace(/^TOOL_RESULT\s+/, ""));
	assert.equal(duplicateResult.ok, false);
	assert.equal(duplicateResult.status, "failed");
	assert.equal(duplicateResult.failureClass, "invalid_input");
	assert.match(duplicateResult.error, /identical call already failed/i);
	assert.equal(duplicateResult.recovery.recoverable, true);
	assert.equal(duplicateResult.recovery.retryable, false);
	assert.equal(duplicateResult.recovery.code, "duplicate_failed_tool_call");
	assert.deepEqual(duplicateResult.recovery.suggestedArgs, { path: "Project/workspace/missing.md" });
	assert.deepEqual(duplicateResult.recovery.candidatePaths, ["Project/workspace/missing.md"]);
});

test("AgentLoopController blocks duplicate failed calls returned as native assistant JSON envelopes", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const modelRequests = [];
	const toolExecutions = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 3,
					messages: [{ role: "user", content: "Read missing file" }],
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
						toolCalls: [{
							id: "call-1",
							name: "read",
							args: { path: "workspace/missing.md", options: { beta: true, alpha: 1 } },
						}],
						finishReason: "tool_calls",
					};
				}
				if (input.step === 3) {
					return {
						assistantText: "I will use the suggested path instead of repeating the failed call.",
						toolCalls: [],
						finishReason: "stop",
					};
				}
				return {
					assistantText: JSON.stringify({
						type: "tool_call",
						tool: {
							name: "read",
							args: { options: { alpha: 1, beta: true }, path: "workspace/missing.md" },
						},
					}),
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
				toolExecutions.push(input);
				return {
					trace: {
						runId: "read-failed-json-1",
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: input.tool.args.path,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "failed",
						failureClass: "invalid_input",
						ok: false,
						summary: "Vault file was not found.",
						error: "Vault file was not found.",
					},
					payload: {
						ok: false,
						tool: "read",
						status: "failed",
						failureClass: "invalid_input",
						error: "Vault file was not found.",
						recovery: {
							recoverable: true,
							retryable: false,
							code: "vault_file_not_found",
							message: "A likely active-project path exists.",
							suggestedArgs: { path: "Project/workspace/missing.md" },
							candidatePaths: ["Project/workspace/missing.md"],
						},
					},
					modelResultText: 'TOOL_RESULT {"ok":false,"tool":"read","status":"failed","failureClass":"invalid_input"}',
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-duplicate-native-json",
		traceId: "trace-duplicate-native-json",
		conversationId: "conversation-duplicate-native-json",
		agentId: "agent-duplicate-native-json",
		conversation: [],
		userPrompt: "Read missing file",
		mode: "ask",
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "I will use the suggested path instead of repeating the failed call.");
	assert.equal(modelRequests.length, 3);
	assert.equal(toolExecutions.length, 1);
	assert.equal(result.traces.length, 2);
	assert.match(result.traces[1].summary, /identical call already failed/i);
	assert.equal(modelRequests[2].messages.at(-2).role, "assistant");
	assert.equal(modelRequests[2].messages.at(-1).role, "user");
	assert.match(modelRequests[2].messages.at(-1).content, /^TOOL_RESULT /);
	assert.match(modelRequests[2].messages.at(-1).content, /duplicate_failed_tool_call/);
});

test("AgentLoopController does not block identical successful native calls", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const toolExecutions = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 4,
					messages: [{ role: "user", content: "Read twice" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				if (input.step <= 2) {
					return {
						assistantText: "",
						toolCalls: [{ id: `call-${input.step}`, name: "read", args: { path: "Project/a.md" } }],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "Read twice.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				toolExecutions.push(input);
				return {
					trace: {
						runId: `read-ok-${input.step}`,
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
					payload: { ok: true, tool: "read", status: "ok", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: 'TOOL_RESULT {"ok":true,"tool":"read","status":"ok"}',
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-success-repeat",
		traceId: "trace-success-repeat",
		conversationId: "conversation-success-repeat",
		agentId: "agent-success-repeat",
		conversation: [],
		userPrompt: "Read twice",
		mode: "ask",
	});

	assert.equal(result.status, "completed");
	assert.equal(toolExecutions.length, 2);
	assert.deepEqual(result.traces.map((trace) => trace.status), ["ok", "ok"]);
});

test("AgentLoopController emits max_tool_iterations and safe_stopped without raw limit text", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 1,
					messages: [{ role: "user", content: "Keep reading" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				return {
					assistantText: "Reading file.",
					toolCalls: [{ id: `call-${input.step}`, name: "read", args: { path: "Project/a.md" } }],
					finishReason: "tool_calls",
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
						runId: `read-ok-${input.step}`,
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
					payload: { ok: true, tool: "read", status: "ok", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: 'TOOL_RESULT {"ok":true,"tool":"read","status":"ok"}',
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-max-iterations",
		traceId: "trace-max-iterations",
		conversationId: "conversation-max-iterations",
		agentId: "agent-max-iterations",
		conversation: [],
		userPrompt: "Keep reading",
		mode: "ask",
	});

	assert.equal(result.status, "safe_stopped");
	assertNoRawMaxToolIterationText(result.assistantText);
	const maxIterationEvent = result.events.find((event) => event.type === "max_tool_iterations");
	assert.ok(maxIterationEvent);
	assertNoRawMaxToolIterationText(maxIterationEvent.payload?.summary);
	const terminal = result.events.at(-1);
	assert.equal(terminal.type, "turn_completed");
	assert.equal(terminal.status, "safe_stopped");
});
