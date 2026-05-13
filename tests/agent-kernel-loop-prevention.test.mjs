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
const stateAdapterPath = path.join(projectRoot, "src/services/ObsidianAgentStateAdapter.ts");
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

test("AgentLoopController suppresses identical failed read-only calls within the same native batch", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const toolExecutions = [];
	const modelRequests = [];
	const savedCheckpoints = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 3,
					messages: [{ role: "user", content: "Read missing file twice" }],
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
						toolCalls: [
							{
								id: "call-a",
								name: "read",
								args: { path: "workspace/missing.md", options: { beta: true, alpha: 1 } },
							},
							{
								id: "call-b",
								name: "read",
								args: { options: { alpha: 1, beta: true }, path: "workspace/missing.md" },
							},
						],
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
				toolExecutions.push(input.tool.id);
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
		checkpoint: {
			async save(checkpoint) {
				savedCheckpoints.push(checkpoint);
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-same-batch-duplicate-native",
		traceId: "trace-same-batch-duplicate-native",
		conversationId: "conversation-same-batch-duplicate-native",
		agentId: "agent-same-batch-duplicate-native",
		conversation: [],
		userPrompt: "Read missing file twice",
		mode: "ask",
	});

	assert.equal(result.status, "completed");
	assert.deepEqual(toolExecutions, ["call-a"]);
	assert.equal(result.traces.length, 2);
	assert.deepEqual(result.traces.map((trace) => trace.runId), ["read-failed-1", "read-failed-1-duplicate-1"]);
	assert.match(result.traces[1].summary, /identical call already failed/i);
	const toolMessages = modelRequests[1].messages.filter((message) => message.role === "tool");
	assert.deepEqual(toolMessages.map((message) => message.toolCallId), ["call-a", "call-b"]);
	assert.match(toolMessages[1].content, /duplicate_failed_tool_call/);
	const duplicateResult = JSON.parse(toolMessages[1].content.replace(/^TOOL_RESULT\s+/, ""));
	assert.equal(duplicateResult.recovery.code, "duplicate_failed_tool_call");
	assert.deepEqual(duplicateResult.recovery.suggestedArgs, { path: "Project/workspace/missing.md" });
	assert.deepEqual(duplicateResult.recovery.candidatePaths, ["Project/workspace/missing.md"]);
	const afterToolCheckpoint = savedCheckpoints.find((checkpoint) => checkpoint.boundary === "after_tool_result");
	assert.ok(afterToolCheckpoint);
	assert.deepEqual(afterToolCheckpoint.completedToolCalls.map((tool) => tool.toolCallId), ["call-a", "call-b"]);
	assert.deepEqual(afterToolCheckpoint.traces.map((trace) => trace.runId), ["read-failed-1", "read-failed-1-duplicate-1"]);
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

test("AgentLoopController safe-stops repeated unchanged successful native observation calls", async () => {
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
					messages: [{ role: "user", content: "List twice" }],
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
						toolCalls: [{ id: `call-${input.step}`, name: "ls", args: { path: "Project" } }],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "Listed twice.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "ls", description: "List files", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				toolExecutions.push(input);
				return {
					trace: {
						runId: `ls-ok-${input.step}`,
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
						summary: "Listed Project",
					},
					payload: {
						ok: true,
						tool: "ls",
						status: "ok",
						data: { path: "Project", entries: ["a.md", "b.md"] },
						trace: { targetPath: "Project" },
					},
					modelResultText: 'TOOL_RESULT {"ok":true,"tool":"ls","status":"ok","data":{"entries":["a.md","b.md"]}}',
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
		userPrompt: "List twice",
		mode: "ask",
	});

	assert.equal(result.status, "safe_stopped");
	assert.equal(toolExecutions.length, 2);
	assert.deepEqual(result.traces.map((trace) => trace.status), ["ok", "ok"]);
	const loopControlStop = result.events.find((event) => event.type === "loop_control_stop");
	assert.ok(loopControlStop);
	assert.equal(loopControlStop.payload.reason, "no_progress");
	assert.equal(loopControlStop.payload.repetitionKind, "repeated_unchanged_observation");
	assert.equal(loopControlStop.payload.tool, "ls");
	assert.equal(loopControlStop.payload.step, 2);
	assert.equal(loopControlStop.payload.previousStep, 1);
	assert.equal(result.events.some((event) => event.type === "max_tool_iterations"), false);
	const terminal = result.events.at(-1);
	assert.equal(terminal.type, "turn_completed");
	assert.equal(terminal.status, "safe_stopped");
});

test("AgentLoopController treats a native batch with repeated observations and new evidence as progress", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const modelRequests = [];
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 4,
					messages: [{ role: "user", content: "List project and read new files" }],
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
						toolCalls: [
							{ id: "call-ls-1", name: "ls", args: { path: "Project" } },
							{ id: "call-read-a", name: "read", args: { path: "Project/a.md" } },
						],
						finishReason: "tool_calls",
					};
				}
				if (input.step === 2) {
					return {
						assistantText: "",
						toolCalls: [
							{ id: "call-ls-2", name: "ls", args: { path: "Project" } },
							{ id: "call-read-b", name: "read", args: { path: "Project/b.md" } },
						],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "Collected the new evidence.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [
					{ name: "ls", description: "List files", parameters: { type: "object" } },
					{ name: "read", description: "Read file", parameters: { type: "object" } },
				];
			},
			async executeTool(input) {
				if (input.tool.name === "ls") {
					return {
						trace: {
							runId: `ls-${input.step}`,
							step: input.step,
							tool: "ls",
							scope: "vault",
							targetPath: "Project",
							approved: true,
							approvalReason: "No approval required",
							persistedRule: false,
							viaRule: false,
							status: "ok",
							ok: true,
							summary: "Listed Project",
						},
						payload: {
							ok: true,
							tool: "ls",
							status: "ok",
							data: { path: "Project", entries: ["a.md", "b.md"] },
							trace: { targetPath: "Project" },
						},
						modelResultText: 'TOOL_RESULT {"ok":true,"tool":"ls","data":{"entries":["a.md","b.md"]}}',
					};
				}
				const target = input.tool.args.path;
				return {
					trace: {
						runId: `read-${target.endsWith("a.md") ? "a" : "b"}`,
						step: input.step,
						tool: "read",
						scope: "vault",
						targetPath: target,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: `Read ${target}`,
					},
					payload: {
						ok: true,
						tool: "read",
						status: "ok",
						data: { path: target, content: target.endsWith("a.md") ? "alpha" : "beta" },
						trace: { targetPath: target },
					},
					modelResultText: `TOOL_RESULT ${target}`,
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-batch-repeat-with-progress",
		traceId: "trace-batch-repeat-with-progress",
		conversationId: "conversation-batch-repeat-with-progress",
		agentId: "agent-batch-repeat-with-progress",
		conversation: [],
		userPrompt: "List project and read new files",
		mode: "ask",
		metadata: { suppressVisibleNarration: true },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Collected the new evidence.");
	assert.equal(modelRequests.length, 3);
	assert.deepEqual(result.traces.map((trace) => `${trace.tool}:${trace.targetPath}`), [
		"ls:Project",
		"read:Project/a.md",
		"ls:Project",
		"read:Project/b.md",
	]);
	assert.equal(result.events.some((event) => event.type === "loop_control_stop"), false);
});

test("AgentLoopController emits max_tool_iterations only when the emergency fuse is exhausted", async () => {
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
					maxIterations: 1,
					messages: [{ role: "user", content: "Keep running diagnostics" }],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				return {
					assistantText: "Running diagnostic.",
					toolCalls: [{ id: `call-${input.step}`, name: "exec", args: { command: "diagnose" } }],
					finishReason: "tool_calls",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "exec", description: "Run command", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				toolExecutions.push(input);
				return {
					trace: {
						runId: `exec-ok-${input.step}`,
						step: input.step,
						tool: input.tool.name,
						scope: "external",
						targetPath: input.tool.args.command,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: `Ran diagnostic ${input.step}`,
					},
					payload: { ok: true, tool: "exec", status: "ok", data: { run: input.step } },
					modelResultText: `TOOL_RESULT ${JSON.stringify({ ok: true, tool: "exec", status: "ok", data: { run: input.step } })}`,
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
		userPrompt: "Keep running diagnostics",
		mode: "ask",
	});

	assert.equal(result.status, "safe_stopped");
	assert.ok(toolExecutions.length > 1);
	assertNoRawMaxToolIterationText(result.assistantText);
	assert.equal(result.events.some((event) => event.type === "loop_control_stop"), false);
	const maxIterationEvent = result.events.find((event) => event.type === "max_tool_iterations");
	assert.ok(maxIterationEvent);
	assert.equal(maxIterationEvent.payload?.reason, "emergency_fuse");
	assert.equal(maxIterationEvent.payload?.configuredMaxIterations, 1);
	assert.ok(maxIterationEvent.payload?.maxIterations >= 50);
	assertNoRawMaxToolIterationText(maxIterationEvent.payload?.summary);
	const terminal = result.events.at(-1);
	assert.equal(terminal.type, "turn_completed");
	assert.equal(terminal.status, "safe_stopped");
});

test("ObsidianAgentStateAdapter does not synthesize max_tool_iterations for loop-control safe stops", async () => {
	const { ObsidianAgentStateAdapter } = await jiti.import(stateAdapterPath);
	const adapter = new ObsidianAgentStateAdapter({
		taskStore: {},
		checkpointStore: {},
		eventLog: {},
		mutationStore: {},
		workbenchStateStore: {},
		async runTurn() {
			throw new Error("runTurn should not be called");
		},
	});
	const result = {
		turnId: "turn-loop-control",
		traceId: "trace-loop-control",
		conversationId: "conversation-loop-control",
		status: "safe_stopped",
		assistantText: "Loop control stopped this turn.",
		rawFinalReply: "",
		traces: [],
		events: [{
			type: "loop_control_stop",
			turnId: "turn-loop-control",
			traceId: "trace-loop-control",
			conversationId: "conversation-loop-control",
			agentId: "agent-loop-control",
			at: "2026-05-12T00:00:00.000Z",
			status: "safe_stopped",
			payload: { status: "safe_stopped", reason: "no_progress" },
		}],
	};

	const diagnostics = adapter.buildDiagnosticReplayEvents(result);
	assert.equal(diagnostics.some((event) => event.type === "max_tool_iterations"), false);
	const terminal = adapter.buildTerminalReplayEvent("safe_stopped", result);
	assert.equal(terminal.payload.status, "safe_stopped");
});
