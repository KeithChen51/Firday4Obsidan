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
const runtimeProtocolPath = path.join(projectRoot, "src/core/agent-kernel/RuntimeProtocol.ts");
const projectorPath = path.join(projectRoot, "src/core/trajectory/AgentTrajectoryProjector.ts");
const viewModelPath = path.join(projectRoot, "src/views/agentProcessPanelViewModel.ts");
const mainPath = path.join(projectRoot, "src/main.ts");

function planStateSignature(state) {
	return JSON.stringify({
		status: state?.status,
		currentTaskId: state?.currentTaskId,
		tasks: (state?.tasks ?? []).map((task) => ({
			id: task.id,
			title: task.title,
			status: task.status,
		})),
	});
}

function runtimeEnvelope(payload) {
	return [
		"```friday-runtime",
		JSON.stringify(payload),
		"```",
	].join("\n");
}

function eventIndex(events, type) {
	return events.findIndex((event) => event.type === type);
}

function assertEventAfter(events, laterType, earlierType) {
	const later = eventIndex(events, laterType);
	const earlier = eventIndex(events, earlierType);
	assert.ok(earlier >= 0, `expected ${earlierType} event`);
	assert.ok(later >= 0, `expected ${laterType} event`);
	assert.ok(later > earlier, `${laterType} should be emitted after ${earlierType}`);
}

function assertNoTraceOnlyFinalText(text) {
	assert.doesNotMatch(text, /^Listed \d+ item\(s\)$/);
	assert.doesNotMatch(text, /^grep matched \d+ result\(s\)$/);
	assert.doesNotMatch(text, /^search_text matched \d+ result\(s\)$/);
	assert.doesNotMatch(text, /^Read .+/);
	assert.doesNotMatch(text, /^Exec completed /);
}

function createDeferred() {
	let resolve;
	const promise = new Promise((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

async function flushMicrotasks(count = 8) {
	for (let index = 0; index < count; index += 1) {
		await Promise.resolve();
	}
}

test("RuntimeProtocol normalizes canonical interaction routes and legacy intake routes", async () => {
	const { parseKernelRuntimeEnvelope } = await jiti.import(runtimeProtocolPath);
	const cases = [
		{
			name: "direct_answer",
			intake: { interactionRoute: "direct_answer", statement: "Direct answer." },
			expected: {
				interactionRoute: "direct_answer",
				complexity: "simple",
				route: "answer",
				requiresPlan: false,
				shouldShowProcess: false,
				shouldUseVisiblePlan: false,
			},
		},
		{
			name: "clarify",
			intake: { interactionRoute: "clarify", statement: "Which note should I use?" },
			expected: {
				interactionRoute: "clarify",
				complexity: "unclear",
				route: "clarify",
				requiresPlan: false,
				shouldShowProcess: false,
				shouldUseVisiblePlan: false,
			},
		},
		{
			name: "light_task",
			intake: { interactionRoute: "light_task", statement: "I will check this once." },
			expected: {
				interactionRoute: "light_task",
				complexity: "light",
				route: "answer",
				requiresPlan: false,
				shouldShowProcess: true,
				shouldUseVisiblePlan: false,
			},
		},
		{
			name: "task_with_process",
			intake: { interactionRoute: "task_with_process", statement: "I will handle this with a visible process." },
			expected: {
				interactionRoute: "task_with_process",
				complexity: "complex",
				route: "plan_and_execute",
				requiresPlan: true,
				shouldShowProcess: true,
				shouldUseVisiblePlan: true,
			},
		},
		{
			name: "legacy_light",
			intake: {
				complexity: "light",
				route: "answer",
				statement: "Legacy light task.",
				shouldShowProcess: true,
				shouldUseVisiblePlan: false,
			},
			expected: {
				interactionRoute: "light_task",
				complexity: "light",
				route: "answer",
				requiresPlan: false,
				shouldShowProcess: true,
				shouldUseVisiblePlan: false,
			},
		},
		{
			name: "legacy_process",
			intake: {
				complexity: "complex",
				route: "plan_and_execute",
				statement: "Legacy visible process task.",
			},
			expected: {
				interactionRoute: "task_with_process",
				complexity: "complex",
				route: "plan_and_execute",
				requiresPlan: true,
				shouldShowProcess: true,
				shouldUseVisiblePlan: true,
			},
		},
	];

	for (const testCase of cases) {
		const parsed = parseKernelRuntimeEnvelope(runtimeEnvelope({
			type: "response",
			assistant: `${testCase.name} response`,
			intake: testCase.intake,
		}));
		assert.ok(parsed?.intake, `expected normalized intake for ${testCase.name}`);
		assert.equal(parsed.intake.source, "model", testCase.name);
		for (const [key, value] of Object.entries(testCase.expected)) {
			assert.equal(parsed.intake[key], value, `${testCase.name} ${key}`);
		}
	}
});

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
		allowedTools: ["read"],
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
		"narration",
		"model_request",
		"model_response",
		"turn_completed",
	]);
	for (const event of result.events) {
		assert.equal(event.traceId, "trace-h");
		assert.equal(event.taskId, "task-h");
	}
	assert.equal(result.events.some((event) => event.type === "intake_decision"), false);
	assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false);
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

test("AgentLoopController executes consecutive read-only concurrency-safe native calls concurrently while preserving output order", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const started = [];
	const completions = [];
	const savedCheckpoints = [];
	const modelRequests = [];
	const deferredByPath = new Map([
		["Project/a.md", createDeferred()],
		["Project/b.md", createDeferred()],
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [{ role: "user", content: "Read two files" }],
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
							{ id: "call-a", name: "read", args: { path: "Project/a.md" } },
							{ id: "call-b", name: "read", args: { path: "Project/b.md" } },
						],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "Read both files.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				const target = input.tool.args.path;
				started.push(target);
				await deferredByPath.get(target).promise;
				completions.push(target);
				return {
					trace: {
						runId: `read-${target.endsWith("a.md") ? "a" : "b"}`,
						step: input.step,
						tool: input.tool.name,
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
		checkpoint: {
			async save(checkpoint) {
				savedCheckpoints.push(checkpoint);
			},
		},
	});

	const resultPromise = new AgentKernel(controller).runTurn({
		turnId: "turn-native-parallel-order",
		traceId: "trace-native-parallel-order",
		conversationId: "conversation-native-parallel-order",
		agentId: "agent-native-parallel-order",
		conversation: [],
		userPrompt: "Read two files",
		mode: "ask",
	});

	await flushMicrotasks();
	assert.deepEqual(started, ["Project/a.md", "Project/b.md"]);
	deferredByPath.get("Project/b.md").resolve();
	await flushMicrotasks();
	assert.deepEqual(completions, ["Project/b.md"]);
	deferredByPath.get("Project/a.md").resolve();

	const result = await resultPromise;
	assert.equal(result.status, "completed");
	assert.deepEqual(completions, ["Project/b.md", "Project/a.md"]);
	assert.deepEqual(result.traces.map((trace) => trace.targetPath), ["Project/a.md", "Project/b.md"]);
	assert.equal(modelRequests.length, 2);
	const toolMessages = modelRequests[1].messages.filter((message) => message.role === "tool");
	assert.deepEqual(toolMessages.map((message) => message.toolCallId), ["call-a", "call-b"]);
	assert.deepEqual(toolMessages.map((message) => message.content), ["TOOL_RESULT Project/a.md", "TOOL_RESULT Project/b.md"]);
	const afterToolCheckpoint = savedCheckpoints.find((checkpoint) => checkpoint.boundary === "after_tool_result");
	assert.ok(afterToolCheckpoint);
	assert.deepEqual(afterToolCheckpoint.completedToolCalls.map((tool) => tool.toolCallId), ["call-a", "call-b"]);
	assert.deepEqual(afterToolCheckpoint.traces.map((trace) => trace.targetPath), ["Project/a.md", "Project/b.md"]);
});

test("AgentLoopController keeps unsafe native calls serial between read-only runs", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const started = [];
	const deferredByTool = new Map([
		["read:first", createDeferred()],
		["write:middle", createDeferred()],
		["read:last", createDeferred()],
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext() {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [{ role: "user", content: "Read write read" }],
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
						toolCalls: [
							{ id: "call-read-first", name: "read", args: { path: "first" } },
							{ id: "call-write", name: "write", args: { path: "middle", content: "changed" } },
							{ id: "call-read-last", name: "read", args: { path: "last" } },
						],
						finishReason: "tool_calls",
					};
				}
				return { assistantText: "Finished.", toolCalls: [], finishReason: "stop" };
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [
					{ name: "read", description: "Read file", parameters: { type: "object" } },
					{ name: "write", description: "Write file", parameters: { type: "object" } },
				];
			},
			async executeTool(input) {
				const key = `${input.tool.name}:${input.tool.args.path}`;
				started.push(key);
				await deferredByTool.get(key).promise;
				return {
					trace: {
						runId: key,
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: input.tool.args.path,
						approved: true,
						approvalReason: "Approved",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: `${input.tool.name} ${input.tool.args.path}`,
					},
					payload: {
						ok: true,
						tool: input.tool.name,
						status: "ok",
						data: { path: input.tool.args.path },
						trace: { targetPath: input.tool.args.path },
					},
					modelResultText: `TOOL_RESULT ${key}`,
				};
			},
		},
	});

	const resultPromise = new AgentKernel(controller).runTurn({
		turnId: "turn-native-serial-unsafe",
		traceId: "trace-native-serial-unsafe",
		conversationId: "conversation-native-serial-unsafe",
		agentId: "agent-native-serial-unsafe",
		conversation: [],
		userPrompt: "Read write read",
		mode: "ask",
	});

	await flushMicrotasks();
	assert.deepEqual(started, ["read:first"]);
	deferredByTool.get("read:first").resolve();
	await flushMicrotasks();
	assert.deepEqual(started, ["read:first", "write:middle"]);
	deferredByTool.get("write:middle").resolve();
	await flushMicrotasks();
	assert.deepEqual(started, ["read:first", "write:middle", "read:last"]);
	deferredByTool.get("read:last").resolve();

	const result = await resultPromise;
	assert.equal(result.status, "completed");
	assert.deepEqual(result.traces.map((trace) => `${trace.tool}:${trace.targetPath}`), [
		"read:first",
		"write:middle",
		"read:last",
	]);
});

test("AgentLoopController allows productive native tool work beyond the configured maxIterations cap", async () => {
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
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
					contextSummary: { used: 8, softLimit: 100, hardLimit: 120, trimmedChannels: [] },
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools(input) {
				modelRequests.push(input);
				if (input.step <= 3) {
					return {
						assistantText: "",
						toolCalls: [{
							id: `call-${input.step}`,
							name: "read",
							args: { path: `Project/file-${input.step}.md` },
						}],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "Read three distinct files.",
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
				toolRequests.push(input);
				const pathName = input.tool.args.path;
				return {
					trace: {
						runId: `read-ok-${input.step}`,
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: pathName,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: `Read ${pathName}`,
					},
					payload: {
						ok: true,
						tool: "read",
						status: "ok",
						data: { path: pathName, content: `content ${input.step}` },
						trace: { targetPath: pathName },
					},
					modelResultText: `TOOL_RESULT ${JSON.stringify({ ok: true, tool: "read", status: "ok", data: { path: pathName } })}`,
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-native-productive-beyond-cap",
		taskId: "task-native-productive-beyond-cap",
		traceId: "trace-native-productive-beyond-cap",
		conversationId: "conversation-native-productive-beyond-cap",
		agentId: "agent-native-productive-beyond-cap",
		conversation: [],
		userPrompt: "Read multiple files before answering",
		allowedTools: ["read"],
		mode: "ask",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Read three distinct files.");
	assert.deepEqual(toolRequests.map((request) => request.step), [1, 2, 3]);
	assert.deepEqual(modelRequests.map((request) => request.step), [1, 2, 3, 4]);
	assert.equal(result.events.some((event) => event.type === "max_tool_iterations"), false);
	assert.equal(result.events.some((event) => event.type === "loop_control_stop"), false);
});

test("AgentLoopController allows productive prompt-envelope tool work beyond the configured maxIterations cap", async () => {
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
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
					contextSummary: { used: 8, softLimit: 100, hardLimit: 120, trimmedChannels: [] },
				};
			},
		},
		modelDriver: {
			async requestText(input) {
				modelRequests.push(input);
				if (input.step <= 3) {
					return runtimeEnvelope({
						type: "tool_call",
						assistant: `Reading Project/file-${input.step}.md`,
						tool: {
							name: "read",
							args: { path: `Project/file-${input.step}.md` },
						},
					});
				}
				return runtimeEnvelope({
					type: "response",
					assistant: "Prompt loop read three distinct files.",
				});
			},
			async requestWithTools() {
				throw new Error("native path should not be used");
			},
		},
		toolExecution: {
			async listNativeTools() {
				throw new Error("native tools should not be listed");
			},
			async executeTool(input) {
				toolRequests.push(input);
				const pathName = input.tool.args.path;
				return {
					trace: {
						runId: `read-prompt-ok-${input.step}`,
						step: input.step,
						tool: input.tool.name,
						scope: "vault",
						targetPath: pathName,
						approved: true,
						approvalReason: "No approval required",
						persistedRule: false,
						viaRule: false,
						status: "ok",
						ok: true,
						summary: `Read ${pathName}`,
					},
					payload: {
						ok: true,
						tool: "read",
						status: "ok",
						data: { path: pathName, content: `prompt content ${input.step}` },
						trace: { targetPath: pathName },
					},
					modelResultText: `TOOL_RESULT ${JSON.stringify({ ok: true, tool: "read", status: "ok", data: { path: pathName } })}`,
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-prompt-productive-beyond-cap",
		taskId: "task-prompt-productive-beyond-cap",
		traceId: "trace-prompt-productive-beyond-cap",
		conversationId: "conversation-prompt-productive-beyond-cap",
		agentId: "agent-prompt-productive-beyond-cap",
		conversation: [],
		userPrompt: "Read multiple files before answering",
		allowedTools: ["read"],
		mode: "ask",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Prompt loop read three distinct files.");
	assert.deepEqual(toolRequests.map((request) => request.step), [1, 2, 3]);
	assert.deepEqual(modelRequests.map((request) => request.step), [1, 2, 3, 4]);
	assert.equal(result.events.some((event) => event.type === "max_tool_iterations"), false);
	assert.equal(result.events.some((event) => event.type === "loop_control_stop"), false);
});

test("AgentLoopController does not accept prompt trace summaries as final answers", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText(input) {
				if (input.step === 1) {
					return runtimeEnvelope({
						type: "tool_call",
						assistant: "Searching project notes.",
						tool: {
							name: "grep",
							args: { pattern: "alpha", path: "Project" },
						},
					});
				}
				return "grep matched 2 result(s)";
			},
			async requestWithTools() {
				throw new Error("native path should not be used");
			},
		},
		toolExecution: {
			async listNativeTools() {
				throw new Error("native tools should not be listed");
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "grep-prompt-1",
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
						summary: "grep matched 2 result(s)",
					},
					payload: {
						ok: true,
						tool: "grep",
						status: "ok",
						data: {
							matches: [
								{ path: "Project/a.md", line: 1, text: "alpha" },
								{ path: "Project/b.md", line: 2, text: "alpha beta" },
							],
						},
					},
					modelResultText: "TOOL_RESULT {\"ok\":true,\"tool\":\"grep\",\"status\":\"ok\",\"data\":{\"matches\":[{\"path\":\"Project/a.md\"},{\"path\":\"Project/b.md\"}]}}",
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-prompt-trace-summary-final",
		taskId: "task-prompt-trace-summary-final",
		traceId: "trace-prompt-trace-summary-final",
		conversationId: "conversation-prompt-trace-summary-final",
		agentId: "agent-prompt-trace-summary-final",
		conversation: [],
		userPrompt: "Search for alpha before answering",
		allowedTools: ["grep"],
		mode: "ask",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertNoTraceOnlyFinalText(result.assistantText);
	assert.match(result.assistantText, /found 2 text match/i);
	assert.equal(result.traces[0]?.summary, "grep matched 2 result(s)");
});

test("AgentLoopController uses product-facing native fallback when the model returns no final answer", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
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
						toolCalls: [{ id: "call-grep-1", name: "grep", args: { pattern: "alpha", path: "Project" } }],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "",
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "grep", description: "Search text", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "grep-native-1",
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
						summary: "grep matched 2 result(s)",
					},
					payload: {
						ok: true,
						tool: "grep",
						status: "ok",
						data: {
							matches: [
								{ path: "Project/a.md", line: 1, text: "alpha" },
								{ path: "Project/b.md", line: 2, text: "alpha beta" },
							],
						},
					},
					modelResultText: "TOOL_RESULT {\"ok\":true,\"tool\":\"grep\",\"status\":\"ok\",\"data\":{\"matches\":[{\"path\":\"Project/a.md\"},{\"path\":\"Project/b.md\"}]}}",
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-native-no-final-fallback",
		taskId: "task-native-no-final-fallback",
		traceId: "trace-native-no-final-fallback",
		conversationId: "conversation-native-no-final-fallback",
		agentId: "agent-native-no-final-fallback",
		conversation: [],
		userPrompt: "Search for alpha before answering",
		allowedTools: ["grep"],
		mode: "ask",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertNoTraceOnlyFinalText(result.assistantText);
	assert.match(result.assistantText, /found 2 text match/i);
	assert.equal(result.traces[0]?.summary, "grep matched 2 result(s)");
	assert.match(result.parseError ?? "", /without a user-facing final answer/);
});

test("AgentLoopController rewrites native response envelopes that only repeat trace summaries", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
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
						toolCalls: [{ id: "call-ls-1", name: "ls", args: { path: "Project" } }],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: runtimeEnvelope({
						type: "response",
						assistant: "Listed 2 item(s)",
					}),
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "ls", description: "List files", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "ls-native-1",
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
						summary: "Listed 2 item(s)",
					},
					payload: {
						ok: true,
						tool: "ls",
						status: "ok",
						data: { path: "Project", items: ["a.md", "b.md"] },
					},
					modelResultText: "TOOL_RESULT {\"ok\":true,\"tool\":\"ls\",\"status\":\"ok\",\"data\":{\"items\":[\"a.md\",\"b.md\"]}}",
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-native-envelope-trace-summary-final",
		taskId: "task-native-envelope-trace-summary-final",
		traceId: "trace-native-envelope-trace-summary-final",
		conversationId: "conversation-native-envelope-trace-summary-final",
		agentId: "agent-native-envelope-trace-summary-final",
		conversation: [],
		userPrompt: "List Project before answering",
		allowedTools: ["ls"],
		mode: "ask",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertNoTraceOnlyFinalText(result.assistantText);
	assert.match(result.assistantText, /Project contains 2 visible items/i);
	assert.equal(result.traces[0]?.summary, "Listed 2 item(s)");
});

test("AgentLoopController rewrites standalone read path summaries even when they differ from the trace text", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
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
						toolCalls: [{ id: "call-read-1", name: "read", args: { path: "Project/a.md" } }],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: runtimeEnvelope({
						type: "response",
						assistant: "Read Project/a.md",
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
				return {
					trace: {
						runId: "read-native-1",
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
						summary: "Read Project/a.md (truncated)",
					},
					payload: {
						ok: true,
						tool: "read",
						status: "ok",
						data: { path: "Project/a.md", content: "alpha beta gamma", truncated: true },
					},
					modelResultText: "TOOL_RESULT {\"ok\":true,\"tool\":\"read\",\"status\":\"ok\",\"data\":{\"path\":\"Project/a.md\",\"truncated\":true}}",
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-native-read-path-summary-final",
		taskId: "task-native-read-path-summary-final",
		traceId: "trace-native-read-path-summary-final",
		conversationId: "conversation-native-read-path-summary-final",
		agentId: "agent-native-read-path-summary-final",
		conversation: [],
		userPrompt: "Read Project/a.md before answering",
		allowedTools: ["read"],
		mode: "ask",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertNoTraceOnlyFinalText(result.assistantText);
	assert.match(result.assistantText, /I read Project\/a\.md/i);
	assert.match(result.assistantText, /alpha beta gamma/);
	assert.equal(result.traces[0]?.summary, "Read Project/a.md (truncated)");
});

test("AgentLoopController continues native assistant JSON tool calls with prompt-style tool feedback", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const assistantToolEnvelope = JSON.stringify({
		type: "tool_call",
		tool: {
			name: "list_files",
			args: { path: "Project" },
		},
	});
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
						{ role: "user", content: input.userPrompt },
					],
					contextSummary: { used: 8, softLimit: 100, hardLimit: 120, trimmedChannels: [] },
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
						assistantText: assistantToolEnvelope,
						toolCalls: [],
						finishReason: "stop",
					};
				}
				return {
					assistantText: "Project contains a.md and b.md.",
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "list_files", description: "List files", parameters: { type: "object" } }];
			},
			async executeTool(input) {
				toolRequests.push(input);
				return {
					trace: {
						runId: "list-files-1",
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
						summary: "Listed 2 item(s)",
					},
					payload: {
						ok: true,
						tool: "list_files",
						status: "ok",
						data: { path: "Project", items: ["a.md", "b.md"] },
					},
					modelResultText: 'TOOL_RESULT {"ok":true,"tool":"list_files","status":"ok","data":{"items":["a.md","b.md"]}}',
				};
			},
		},
	});

	const result = await new AgentKernel(controller).runTurn({
		turnId: "turn-native-json-tool-continuation",
		taskId: "task-native-json-tool-continuation",
		traceId: "trace-native-json-tool-continuation",
		conversationId: "conversation-native-json-tool-continuation",
		agentId: "agent-native-json-tool-continuation",
		conversation: [],
		userPrompt: "List files before answering",
		allowedTools: ["list_files"],
		mode: "ask",
		budget: { tool: { maxIterations: 3 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Project contains a.md and b.md.");
	assert.notEqual(result.assistantText, "Listed 2 item(s)");
	assert.equal(modelRequests.length, 2);
	assert.equal(toolRequests.length, 1);
	assert.deepEqual(toolRequests.map((request) => request.tool), [
		{ name: "list_files", args: { path: "Project" } },
	]);
	const continuationMessages = modelRequests[1].messages;
	assert.equal(continuationMessages.some((message) => message.role === "tool"), false);
	assert.equal(continuationMessages.at(-2).role, "assistant");
	assert.equal(continuationMessages.at(-2).content, assistantToolEnvelope);
	assert.equal(continuationMessages.at(-2).toolCalls, undefined);
	assert.equal(continuationMessages.at(-1).role, "user");
	assert.match(continuationMessages.at(-1).content, /^TOOL_RESULT /);
	assert.match(continuationMessages.at(-1).content, /"list_files"/);
});

test("AgentLoopController emits native model-authored intake and plan only after model_response", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("prompt path should not be used");
			},
			async requestWithTools() {
				return {
					assistantText: runtimeEnvelope({
						type: "response",
						assistant: "I understand the process panel work and have a plan.",
						intake: {
							complexity: "complex",
							route: "plan_and_execute",
							statement: "I understand you want the process panel optimization implemented with regression coverage.",
							requiresPlan: true,
							shouldShowProcess: true,
							shouldUseVisiblePlan: true,
						},
						plan: {
							type: "plan_create",
							visibility: "visible",
							tasks: [
								{ id: "scope", title: "Confirm the process panel scope", status: "in_progress" },
								{ id: "patch", title: "实现 runtime behavior", status: "pending" },
								{ id: "verify", title: "Run focused regression tests", status: "pending" },
							],
						},
					}),
					toolCalls: [],
					finishReason: "stop",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "edit", description: "Edit file", parameters: { type: "object" } }];
			},
			async executeTool() {
				throw new Error("tool should not run in this focused plan test");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-complex-plan",
		taskId: "task-complex-plan",
		traceId: "trace-complex-plan",
		conversationId: "conversation-complex-plan",
		agentId: "agent-complex-plan",
		conversation: [],
		userPrompt: "Implement the process panel optimization and update the regression tests",
		allowedTools: ["edit"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertEventAfter(result.events, "intake_decision", "model_response");
	assertEventAfter(result.events, "plan_create", "model_response");
	const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
	assert.equal(intakePayload?.complexity, "complex");
	assert.equal(intakePayload?.requiresPlan, true);
	assert.equal(intakePayload?.source, "model");
	assert.equal(intakePayload?.statement, "I understand you want the process panel optimization implemented with regression coverage.");
	assert.match(intakePayload?.statement ?? "", /^我理解你希望|^I understand/);
	const planCreatePayload = result.events.find((event) => event.type === "plan_create")?.payload;
	assert.equal(planCreatePayload?.state?.visibility, "task_bar");
	assert.equal(planCreatePayload?.state?.tasks?.[0]?.status, "in_progress");
	assert.equal(planCreatePayload?.state?.tasks?.filter((task) => task.status === "in_progress").length, 1);
	const planTitles = planCreatePayload?.state?.tasks?.map((task) => task.title) ?? [];
	assert.notDeepEqual(planTitles, ["确认当前上下文", "调用必要工具获取证据", "汇总结论和结果"]);
	assert.equal(planTitles.some((title) => /实现|修复|修改|验证|测试/.test(title)), true);
	const planCompletePayload = result.events.find((event) => event.type === "plan_complete")?.payload;
	assert.equal(planCompletePayload?.state?.status, "completed");
});

test("AgentLoopController emits prompt model-authored intake and plan only after model_response", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "I understand the regression and will use the model-authored plan.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand you want the prompt runtime path covered.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "prompt-scope", title: "Confirm prompt runtime scope", status: "in_progress" },
							{ id: "prompt-test", title: "Add prompt regression coverage", status: "pending" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("prompt path test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("prompt path test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-prompt-model-plan",
		taskId: "task-prompt-model-plan",
		traceId: "trace-prompt-model-plan",
		conversationId: "conversation-prompt-model-plan",
		agentId: "agent-prompt-model-plan",
		conversation: [],
		userPrompt: "Debug the prompt runtime plan projection and update the focused tests",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assertEventAfter(result.events, "intake_decision", "model_response");
	assertEventAfter(result.events, "plan_create", "model_response");
	const modelResponseIndex = eventIndex(result.events, "model_response");
	assert.equal(result.events.slice(0, modelResponseIndex).some((event) => event.type === "intake_decision" || event.type === "plan_create"), false);
	assert.equal(result.events.find((event) => event.type === "intake_decision")?.payload?.source, "model");
	assert.deepEqual(
		result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks?.map((task) => task.title),
		["Confirm prompt runtime scope", "Add prompt regression coverage"],
	);
});

test("AgentLoopController emits canonical model-authored interaction routes and gates visible plans by route", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const cases = [
		{
			interactionRoute: "direct_answer",
			userPrompt: "What is 2+2?",
			statement: "I can answer directly.",
			assistant: "4",
			expectedLegacyRoute: "answer",
			expectedComplexity: "simple",
			expectedRequiresPlan: false,
			expectedShowProcess: false,
			expectedVisiblePlan: false,
			plan: undefined,
			shouldEmitPlan: false,
		},
		{
			interactionRoute: "clarify",
			userPrompt: "Update the note",
			statement: "I need to know which note to update.",
			assistant: "Which note should I update?",
			expectedLegacyRoute: "clarify",
			expectedComplexity: "unclear",
			expectedRequiresPlan: false,
			expectedShowProcess: false,
			expectedVisiblePlan: false,
			plan: undefined,
			shouldEmitPlan: false,
		},
		{
			interactionRoute: "light_task",
			userPrompt: "Run npm test once",
			statement: "I will run one lightweight check.",
			assistant: "I ran the requested check.",
			expectedLegacyRoute: "answer",
			expectedComplexity: "light",
			expectedRequiresPlan: false,
			expectedShowProcess: true,
			expectedVisiblePlan: false,
			plan: {
				type: "plan_create",
				visibility: "visible",
				tasks: [
					{ id: "heavy-plan", title: "Do not surface a heavy plan for light work", status: "in_progress" },
				],
			},
			shouldEmitPlan: false,
		},
		{
			interactionRoute: "task_with_process",
			userPrompt: "Rewrite this sentence to be clearer: send report today",
			statement: "I will handle this with a visible process.",
			assistant: "Please send the final report today.",
			expectedLegacyRoute: "plan_and_execute",
			expectedComplexity: "complex",
			expectedRequiresPlan: true,
			expectedShowProcess: true,
			expectedVisiblePlan: true,
			plan: {
				type: "plan_create",
				visibility: "visible",
				tasks: [
					{ id: "rewrite", title: "Rewrite the sentence", status: "in_progress" },
					{ id: "verify", title: "Check the final wording", status: "pending" },
				],
			},
			shouldEmitPlan: true,
		},
	];

	for (const [index, testCase] of cases.entries()) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "prompt",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					return runtimeEnvelope({
						type: "response",
						assistant: testCase.assistant,
						intake: {
							interactionRoute: testCase.interactionRoute,
							statement: testCase.statement,
						},
						...(testCase.plan ? { plan: testCase.plan } : {}),
					});
				},
				async requestWithTools() {
					throw new Error("canonical interaction route test should not use native tools");
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [];
				},
				async executeTool() {
					throw new Error("canonical interaction route test should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-canonical-route-${index}`,
			taskId: `task-canonical-route-${index}`,
			traceId: `trace-canonical-route-${index}`,
			conversationId: `conversation-canonical-route-${index}`,
			agentId: "agent-canonical-route",
			conversation: [],
			userPrompt: testCase.userPrompt,
			allowedTools: ["read"],
			mode: "agent",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", testCase.interactionRoute);
		assertEventAfter(result.events, "intake_decision", "model_response");
		const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
		assert.equal(intakePayload?.source, "model", testCase.interactionRoute);
		assert.equal(intakePayload?.interactionRoute, testCase.interactionRoute, testCase.interactionRoute);
		assert.equal(intakePayload?.route, testCase.expectedLegacyRoute, testCase.interactionRoute);
		assert.equal(intakePayload?.complexity, testCase.expectedComplexity, testCase.interactionRoute);
		assert.equal(intakePayload?.requiresPlan, testCase.expectedRequiresPlan, testCase.interactionRoute);
		assert.equal(intakePayload?.shouldShowProcess, testCase.expectedShowProcess, testCase.interactionRoute);
		assert.equal(intakePayload?.shouldUseVisiblePlan, testCase.expectedVisiblePlan, testCase.interactionRoute);
		assert.equal(result.events.some((event) => event.type === "plan_create"), testCase.shouldEmitPlan, testCase.interactionRoute);
		if (testCase.shouldEmitPlan) {
			assertEventAfter(result.events, "plan_create", "model_response");
		}
	}
});

test("AgentLoopController emits fallback interaction routes only when model intake is missing or invalid", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const cases = [
		{
			name: "missing-direct",
			envelope: {
				type: "response",
				assistant: "Here is the direct answer.",
			},
			expectedRoute: "direct_answer",
			shouldEmitPlan: false,
		},
		{
			name: "invalid-with-visible-plan",
			envelope: {
				type: "response",
				assistant: "I will use the fallback visible process.",
				intake: {
					interactionRoute: "heavy_task",
					statement: "Invalid route should not be trusted.",
				},
				plan: {
					type: "plan_create",
					visibility: "visible",
					tasks: [
						{ id: "fallback-plan", title: "Use the visible fallback plan", status: "in_progress" },
					],
				},
			},
			expectedRoute: "task_with_process",
			shouldEmitPlan: true,
		},
	];

	for (const testCase of cases) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "prompt",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					return runtimeEnvelope(testCase.envelope);
				},
				async requestWithTools() {
					throw new Error("fallback intake test should not use native tools");
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [];
				},
				async executeTool() {
					throw new Error("fallback intake test should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-fallback-${testCase.name}`,
			taskId: `task-fallback-${testCase.name}`,
			traceId: `trace-fallback-${testCase.name}`,
			conversationId: `conversation-fallback-${testCase.name}`,
			agentId: "agent-fallback-intake",
			conversation: [],
			userPrompt: "Handle this with the safest available route",
			mode: "agent",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", testCase.name);
		assertEventAfter(result.events, "intake_decision", "model_response");
		const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
		assert.equal(intakePayload?.source, "fallback", testCase.name);
		assert.equal(intakePayload?.interactionRoute, testCase.expectedRoute, testCase.name);
		assert.notEqual(intakePayload?.statement, "Invalid route should not be trusted.", testCase.name);
		assert.equal(result.events.some((event) => event.type === "plan_create"), testCase.shouldEmitPlan, testCase.name);
	}
});

test("AgentLoopController does not duplicate initial model-authored intake and plan after native fallback to prompt", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input, _context, options) {
				return {
					toolCallingMode: options.channel === "prompt" ? "prompt" : "auto",
					maxIterations: 2,
					messages: [
						{ role: "system", content: `${options.channel} system prompt` },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "Prompt fallback completed without replaying the initial process.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "This duplicate prompt intake must be ignored.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "duplicate", title: "Duplicate prompt plan must be ignored", status: "in_progress" },
						],
					},
				});
			},
			async requestWithTools() {
				return {
					assistantText: runtimeEnvelope({
						type: "tool_call",
						assistant: "I understand the native path needs an initial plan before tool execution.",
						intake: {
							complexity: "complex",
							route: "plan_and_execute",
							statement: "I understand you want the native plan preserved across fallback.",
							requiresPlan: true,
							shouldShowProcess: true,
							shouldUseVisiblePlan: true,
						},
						plan: {
							type: "plan_create",
							visibility: "visible",
							tasks: [
								{ id: "native-scope", title: "Preserve native-authored intake and plan", status: "in_progress" },
								{ id: "native-finish", title: "Finish through prompt fallback", status: "pending" },
							],
						},
					}),
					toolCalls: [{ id: "native-call-1", name: "read", args: { path: "src/parser.ts" } }],
					finishReason: "tool_calls",
				};
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [{ name: "read", description: "Read file", parameters: { type: "object" } }];
			},
			async executeTool() {
				throw new Error("unsupported tool schema for native mode");
			},
		},
		fallbackPolicy: {
			isRetryableTransportFailure: () => false,
			shouldFallbackToPrompt: (message) => /unsupported tool schema/i.test(message),
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-native-fallback-no-duplicate",
		taskId: "task-native-fallback-no-duplicate",
		traceId: "trace-native-fallback-no-duplicate",
		conversationId: "conversation-native-fallback-no-duplicate",
		agentId: "agent-native-fallback-no-duplicate",
		conversation: [],
		userPrompt: "Fix the native tool fallback behavior and verify the plan replay",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.events.filter((event) => event.type === "intake_decision").length, 1);
	assert.equal(result.events.filter((event) => event.type === "plan_create").length, 1);
	assertEventAfter(result.events, "intake_decision", "model_response");
	assertEventAfter(result.events, "plan_create", "model_response");
	assert.equal(result.events.find((event) => event.type === "intake_decision")?.payload?.statement, "I understand you want the native plan preserved across fallback.");
	assert.deepEqual(
		result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks?.map((task) => task.title),
		["Preserve native-authored intake and plan", "Finish through prompt fallback"],
	);
	assert.equal(result.events.some((event) => event.type === "fallback"), true);
});

test("AgentLoopController does not upgrade malformed internal plan_create into a visible plan", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "Finished the read-only review.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand this needs a private note, not a visible plan.",
						requiresPlan: false,
						shouldShowProcess: true,
						shouldUseVisiblePlan: false,
					},
					plan: {
						type: "plan_create",
						visibility: "internal",
						tasks: "malformed-private-plan",
					},
				});
			},
			async requestWithTools() {
				throw new Error("prompt malformed internal plan test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("prompt malformed internal plan test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-malformed-internal-plan-create",
		taskId: "task-malformed-internal-plan-create",
		traceId: "trace-malformed-internal-plan-create",
		conversationId: "conversation-malformed-internal-plan-create",
		agentId: "agent-malformed-internal-plan-create",
		conversation: [],
		userPrompt: "Analyze this implementation and give me a read-only summary",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	const visiblePlanEvents = result.events.filter((event) =>
		event.type === "plan_create" &&
		["task_bar", "visible"].includes(event.payload?.state?.visibility)
	);
	assert.equal(visiblePlanEvents.length, 0);
});

test("AgentLoopController safely falls back when visible plan_create has malformed tasks", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "I will proceed with a safe fallback plan.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand you want the malformed visible plan handled safely.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						reason: "The model selected a visible plan but malformed the task list.",
						tasks: "not-an-array",
					},
				});
			},
			async requestWithTools() {
				throw new Error("prompt malformed visible plan test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("prompt malformed visible plan test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-malformed-visible-plan-create",
		taskId: "task-malformed-visible-plan-create",
		traceId: "trace-malformed-visible-plan-create",
		conversationId: "conversation-malformed-visible-plan-create",
		agentId: "agent-malformed-visible-plan-create",
		conversation: [],
		userPrompt: "Implement the parser fix and verify it",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	const planCreate = result.events.find((event) => event.type === "plan_create");
	assert.ok(planCreate, "visible malformed plan_create should produce a safe fallback plan");
	assertEventAfter(result.events, "plan_create", "model_response");
	assert.equal(planCreate.payload?.state?.visibility, "task_bar");
	assert.ok((planCreate.payload?.state?.tasks?.length ?? 0) > 0);
	assert.equal(planCreate.payload?.fallback, true);
});

test("AgentLoopController downgrades mutation-shaped plan tasks for explicit read-only requests", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "I will keep this review read-only.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand you want a read-only review with no changes.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "edit", title: "Edit src/parser.ts to fix the issue", status: "in_progress" },
							{ id: "summarize", title: "Summarize findings without modifying files", status: "pending" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("read-only plan downgrade test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("read-only plan downgrade test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-read-only-plan-downgrade",
		taskId: "task-read-only-plan-downgrade",
		traceId: "trace-read-only-plan-downgrade",
		conversationId: "conversation-read-only-plan-downgrade",
		agentId: "agent-read-only-plan-downgrade",
		conversation: [],
		userPrompt: "Read-only review only: no modifications, no changes. Analyze src/parser.ts.",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	const tasks = result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks ?? [];
	assert.equal(tasks.some((task) => /^Edit\b/i.test(task.title) && task.status !== "blocked"), false);
	assert.equal(tasks.find((task) => task.id === "edit")?.status, "blocked");
	assert.match(tasks.find((task) => task.id === "edit")?.title ?? "", /Read-only/);
});

test("AgentLoopController preserves read-only blocked mutation plan tasks through finalization", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "I will keep this read-only and report findings only.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand this is read-only with no modifications.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "edit", title: "Edit src/parser.ts to fix the issue", status: "in_progress" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("read-only blocked finalization test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("read-only blocked finalization test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-read-only-blocked-finalization",
		taskId: "task-read-only-blocked-finalization",
		traceId: "trace-read-only-blocked-finalization",
		conversationId: "conversation-read-only-blocked-finalization",
		agentId: "agent-read-only-blocked-finalization",
		conversation: [],
		userPrompt: "Read-only review only: no modifications, no changes. Analyze src/parser.ts.",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	const planEvents = result.events.filter((event) => event.type.startsWith("plan_"));
	const statusByEvent = planEvents.map((event) => [
		event.type,
		event.payload?.state?.tasks?.find((task) => task.id === "edit")?.status,
	]);
	assert.equal(result.status, "completed");
	assert.equal(result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks?.[0]?.status, "blocked");
	assert.equal(statusByEvent.some(([, status]) => status === "completed"), false, JSON.stringify(statusByEvent));
	assert.equal(result.events.find((event) => event.type === "plan_complete")?.payload?.state?.tasks?.[0]?.status, "blocked");
});

test("AgentLoopController preserves read-only blocked mutation plan tasks through plan_revise status changes", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText(input) {
				if (input.step === 1) {
					return runtimeEnvelope({
						type: "tool_call",
						assistant: "I will keep this read-only and inspect evidence first.",
						intake: {
							complexity: "complex",
							route: "plan_and_execute",
							statement: "I understand this is read-only with no modifications.",
							requiresPlan: true,
							shouldShowProcess: true,
							shouldUseVisiblePlan: true,
						},
						plan: {
							type: "plan_create",
							visibility: "visible",
							tasks: [
								{ id: "edit", title: "Edit src/parser.ts to fix the issue", status: "in_progress" },
							],
						},
						tool: { name: "read", args: { path: "src/parser.ts" } },
					});
				}
				return runtimeEnvelope({
					type: "response",
					assistant: "I kept the work read-only and found no safe mutation to apply.",
					plan: {
						type: "plan_revise",
						reason: "The model attempted to mark the blocked mutation as complete.",
						changes: [
							{ type: "status", taskId: "edit", status: "completed" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("read-only blocked plan_revise test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "read-only-blocked-revise",
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
						summary: "Read parser evidence",
					},
					payload: { ok: true, tool: "read", data: { path: "src/parser.ts", content: "parser" } },
					modelResultText: "TOOL_RESULT parser evidence",
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-read-only-blocked-plan-revise",
		taskId: "task-read-only-blocked-plan-revise",
		traceId: "trace-read-only-blocked-plan-revise",
		conversationId: "conversation-read-only-blocked-plan-revise",
		agentId: "agent-read-only-blocked-plan-revise",
		conversation: [],
		userPrompt: "Read-only review only: no modifications, no changes. Analyze src/parser.ts.",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	const planEvents = result.events.filter((event) => event.type.startsWith("plan_"));
	const statusByEvent = planEvents.map((event) => [
		event.type,
		event.payload?.state?.tasks?.find((task) => task.id === "edit")?.status,
	]);
	assert.equal(result.status, "completed");
	assert.equal(result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks?.[0]?.status, "blocked");
	assert.equal(result.events.find((event) => event.type === "plan_revise")?.payload?.state?.tasks?.[0]?.status, "blocked");
	assert.equal(result.events.find((event) => event.type === "plan_complete")?.payload?.state?.tasks?.[0]?.status, "blocked");
	assert.equal(statusByEvent.some(([, status]) => status === "completed"), false, JSON.stringify(statusByEvent));
});

test("AgentLoopController does not treat address-the-PR-comments requests as read-only", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "I will address the PR comments.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand you want the PR comments addressed.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "address", title: "Edit files to address PR comments", status: "in_progress" },
							{ id: "verify", title: "Run focused tests", status: "pending" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("PR comments plan test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("PR comments plan test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-address-pr-comments",
		taskId: "task-address-pr-comments",
		traceId: "trace-address-pr-comments",
		conversationId: "conversation-address-pr-comments",
		agentId: "agent-address-pr-comments",
		conversation: [],
		userPrompt: "Review the PR comments and address them",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	const tasks = result.events.find((event) => event.type === "plan_create")?.payload?.state?.tasks ?? [];
	assert.equal(tasks.find((task) => task.id === "address")?.title, "Edit files to address PR comments");
	assert.equal(tasks.find((task) => task.id === "address")?.status, "in_progress");
});

test("AgentLoopController does not suppress a valid model-authored task_with_process for a simple-looking prompt", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return runtimeEnvelope({
					type: "response",
					assistant: "Please send the final report today.",
					intake: {
						complexity: "complex",
						route: "plan_and_execute",
						statement: "I understand the model chose a visible process for this rewrite.",
						requiresPlan: true,
						shouldShowProcess: true,
						shouldUseVisiblePlan: true,
					},
					plan: {
						type: "plan_create",
						visibility: "visible",
						tasks: [
							{ id: "simple-plan", title: "Apply the model-authored rewrite process", status: "in_progress" },
						],
					},
				});
			},
			async requestWithTools() {
				throw new Error("simple rewrite should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("simple rewrite should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-simple-rewrite",
		taskId: "task-simple-rewrite",
		traceId: "trace-simple-rewrite",
		conversationId: "conversation-simple-rewrite",
		agentId: "agent-simple-rewrite",
		conversation: [],
		userPrompt: "Rewrite this sentence to be clearer: send report today",
		mode: "ask",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Please send the final report today.");
	const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
	assert.equal(intakePayload?.source, "model");
	assert.equal(intakePayload?.interactionRoute, "task_with_process");
	assert.equal(result.events.some((event) => event.type === "plan_create"), true);
	assert.equal(result.events.some((event) => event.type === "narration"), false);
});

test("AgentLoopController treats one-step run verify review and read requests as light work without visible plans", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const prompts = [
		"Run npm test once",
		"Verify the current build result",
		"Review the current summary",
		"Read the current note",
	];

	for (const [index, userPrompt] of prompts.entries()) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "native",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					throw new Error("native light-work test should not use prompt mode");
				},
				async requestWithTools() {
					return {
						assistantText: "Checked the requested item.",
						toolCalls: [],
						finishReason: "stop",
					};
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [{ name: "read", description: "Read", parameters: { type: "object" } }];
				},
				async executeTool() {
					throw new Error("light-work classification test should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-light-${index}`,
			taskId: `task-light-${index}`,
			traceId: `trace-light-${index}`,
			conversationId: `conversation-light-${index}`,
			agentId: "agent-light",
			conversation: [],
			userPrompt,
			allowedTools: ["read"],
			mode: "agent",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", userPrompt);
		assert.equal(result.events.some((event) => event.type === "intake_decision"), false, userPrompt);
		assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false, userPrompt);
	}
});

test("AgentLoopController emits model-authored light_task intake while suppressing heavy visible plans", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const prompts = [
		"Run npm test once",
		"只运行一次测试并告诉我结果",
	];

	for (const [index, userPrompt] of prompts.entries()) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "prompt",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					return runtimeEnvelope({
						type: "response",
						assistant: "Ran the requested one-step check.",
						intake: {
							interactionRoute: "light_task",
							statement: "This lightweight model-authored intake should stay visible without a heavy plan.",
						},
						plan: {
							type: "plan_create",
							visibility: "visible",
							tasks: [
								{ id: "run-once", title: "Run the test command once", status: "in_progress" },
								{ id: "report", title: "Report the result", status: "pending" },
							],
						},
					});
				},
				async requestWithTools() {
					throw new Error("light task prompt path should not use native tools");
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [];
				},
				async executeTool() {
					throw new Error("light task process suppression test should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-light-visible-plan-suppressed-${index}`,
			taskId: `task-light-visible-plan-suppressed-${index}`,
			traceId: `trace-light-visible-plan-suppressed-${index}`,
			conversationId: `conversation-light-visible-plan-suppressed-${index}`,
			agentId: "agent-light-visible-plan-suppressed",
			conversation: [],
			userPrompt,
			allowedTools: ["read"],
			mode: "agent",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", userPrompt);
		const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
		assert.equal(intakePayload?.source, "model", userPrompt);
		assert.equal(intakePayload?.interactionRoute, "light_task", userPrompt);
		assert.equal(intakePayload?.shouldShowProcess, true, userPrompt);
		assert.equal(intakePayload?.shouldUseVisiblePlan, false, userPrompt);
		assert.equal(result.events.some((event) => event.type === "plan_create"), false, userPrompt);
		assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false, userPrompt);
	}
});

test("AgentLoopController keeps explicit debug and analysis scopes complex enough for visible plans", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const prompts = [
		"Debug the parser failure",
		"Analyze the release risk across the plugin",
	];

	for (const [index, userPrompt] of prompts.entries()) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "native",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					throw new Error("complex classification test should not use prompt mode");
				},
				async requestWithTools() {
					return {
						assistantText: runtimeEnvelope({
							type: "response",
							assistant: "Completed the scoped investigation.",
							intake: {
								complexity: "complex",
								route: "plan_and_execute",
								statement: `I understand the scoped work: ${userPrompt}.`,
								requiresPlan: true,
								shouldShowProcess: true,
								shouldUseVisiblePlan: true,
							},
							plan: {
								type: "plan_create",
								visibility: "visible",
								tasks: [
									{ id: `scope-${index}-1`, title: "Confirm evidence", status: "in_progress" },
									{ id: `scope-${index}-2`, title: "Report findings", status: "pending" },
								],
							},
						}),
						toolCalls: [],
						finishReason: "stop",
					};
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [{ name: "read", description: "Read", parameters: { type: "object" } }];
				},
				async executeTool() {
					throw new Error("complex classification test should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-complex-scope-${index}`,
			taskId: `task-complex-scope-${index}`,
			traceId: `trace-complex-scope-${index}`,
			conversationId: `conversation-complex-scope-${index}`,
			agentId: "agent-complex-scope",
			conversation: [],
			userPrompt,
			allowedTools: ["read"],
			mode: "agent",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", userPrompt);
		assertEventAfter(result.events, "intake_decision", "model_response");
		assertEventAfter(result.events, "plan_create", "model_response");
		const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
		assert.equal(intakePayload?.complexity, "complex", userPrompt);
		assert.equal(intakePayload?.source, "model", userPrompt);
		assert.equal(result.events.some((event) => event.type === "plan_create"), true, userPrompt);
	}
});

test("AgentLoopController emits living plan updates as complex tool work advances", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const progressEvents = [];
	const controller = new AgentLoopController({
		progress: {
			report(_input, event) {
				progressEvents.push(event);
			},
		},
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
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
						assistantText: runtimeEnvelope({
							type: "tool_call",
							assistant: "I understand this parser fix needs a short plan before reading evidence.",
							intake: {
								complexity: "complex",
								route: "plan_and_execute",
								statement: "I understand you want the parser bug fixed with regression coverage.",
								requiresPlan: true,
								shouldShowProcess: true,
								shouldUseVisiblePlan: true,
							},
							plan: {
								type: "plan_create",
								visibility: "visible",
								tasks: [
									{ id: "evidence", title: "Read parser evidence", status: "in_progress" },
									{ id: "fix", title: "Patch parser behavior", status: "pending" },
									{ id: "verify", title: "Run focused parser test", status: "pending" },
								],
							},
						}),
						toolCalls: [{ id: "call-1", name: "read", args: { path: "src/parser.ts" } }],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: "Fixed the parser path.",
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
						runId: "read-parser",
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
						summary: "Read src/parser.ts",
					},
					payload: { ok: true, tool: "read", data: { path: "src/parser.ts", content: "parser" } },
					modelResultText: "TOOL_RESULT parser",
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-living-plan",
		taskId: "task-living-plan",
		traceId: "trace-living-plan",
		conversationId: "conversation-living-plan",
		agentId: "agent-living-plan",
		conversation: [],
		userPrompt: "Fix the parser bug and update the regression test",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	assertEventAfter(result.events, "intake_decision", "model_response");
	assertEventAfter(result.events, "plan_create", "model_response");
	const planEvents = result.events.filter((event) => event.type.startsWith("plan_"));
	assert.deepEqual(planEvents.map((event) => event.type), [
		"plan_create",
		"plan_update",
		"plan_update",
		"plan_complete",
	]);
	for (const event of planEvents) {
		const runningTasks = event.payload?.state?.tasks?.filter((task) => task.status === "in_progress") ?? [];
		assert.ok(runningTasks.length <= 1, `${event.type} has more than one in-progress task`);
	}
	const updates = planEvents.filter((event) => event.type === "plan_update").map((event) => event.payload);
	assert.deepEqual(updates[0]?.state?.tasks?.map((task) => task.status), ["completed", "in_progress", "pending"]);
	assert.deepEqual(updates[1]?.state?.tasks?.map((task) => task.status), ["completed", "completed", "in_progress"]);
	let previousPlanSignature = planStateSignature(planEvents[0]?.payload?.state);
	for (const update of updates) {
		const signature = planStateSignature(update?.state);
		assert.notEqual(signature, previousPlanSignature, "plan_update must change meaningful plan state");
		previousPlanSignature = signature;
	}
	const [{ projectRuntimeProgress }, { buildAgentProcessPanelViewModel }] = await Promise.all([
		jiti.import(projectorPath),
		jiti.import(viewModelPath),
	]);
	const snapshot = projectRuntimeProgress(progressEvents);
	const view = buildAgentProcessPanelViewModel(snapshot);
	assert.ok(view.composerTaskBar, "plan state should still drive the composer task bar");
	assert.equal(view.timeline?.items.some((item) => item.kind === "plan"), false);
	const planTitles = planEvents[0]?.payload?.state?.tasks?.map((task) => task.title) ?? [];
	assert.equal(JSON.stringify(view.timeline ?? {}).includes(`${planTitles[0]}\\n2. ${planTitles[1]}`), false);
	const completePayload = planEvents.at(-1)?.payload;
	assert.equal(completePayload?.state?.status, "completed");
	assert.deepEqual(completePayload?.state?.tasks?.map((task) => task.status), ["completed", "completed", "completed"]);
});

test("AgentLoopController applies runtime plan_revise instructions from prompt envelopes", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText(input) {
				if (input.step === 1) {
					return runtimeEnvelope({
						type: "tool_call",
						assistant: "I understand the parser bug needs evidence before revising the plan.",
						intake: {
							complexity: "complex",
							route: "plan_and_execute",
							statement: "I understand you want the parser bug fixed with regression coverage.",
							requiresPlan: true,
							shouldShowProcess: true,
							shouldUseVisiblePlan: true,
						},
						plan: {
							type: "plan_create",
							visibility: "visible",
							tasks: [
								{ id: "plan-turn-plan-revise-1", title: "Read parser evidence", status: "in_progress" },
								{ id: "plan-turn-plan-revise-2", title: "Patch parser behavior", status: "pending" },
								{ id: "plan-turn-plan-revise-3", title: "Run parser regression", status: "pending" },
							],
						},
						tool: { name: "read", args: { path: "src/parser.ts" } },
					});
				}
				return runtimeEnvelope({
						type: "response",
						assistant: "Adjusted the plan and finished.",
						plan: {
							type: "plan_revise",
							reason: "Parser scope changed after the first check.",
							changes: [
								{ type: "rename", taskId: "plan-turn-plan-revise-1", title: "Confirm parser scope" },
								{ type: "add", taskId: "plan-turn-plan-revise-4", title: "Run focused replay", status: "pending" },
							],
						},
					});
			},
			async requestWithTools() {
				throw new Error("prompt plan revise test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool(input) {
				return {
					trace: {
						runId: "read-plan-revise",
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
						summary: "Read parser evidence",
					},
					payload: { ok: true, tool: "read", data: { path: "src/parser.ts", content: "parser" } },
					modelResultText: "TOOL_RESULT parser evidence",
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-plan-revise",
		taskId: "task-plan-revise",
		traceId: "trace-plan-revise",
		conversationId: "conversation-plan-revise",
		agentId: "agent-plan-revise",
		conversation: [],
		userPrompt: "Fix the parser bug and update the regression test",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	assert.equal(result.status, "completed");
	const reviseEvent = result.events.find((event) => event.type === "plan_revise");
	assert.ok(reviseEvent, "runtime envelope should emit plan_revise");
	assert.equal(reviseEvent.payload?.reason, "Parser scope changed after the first check.");
	assert.equal(reviseEvent.payload?.changes?.length, 2);
	assert.equal(reviseEvent.payload?.state?.tasks?.[0]?.title, "Confirm parser scope");
	assert.equal(reviseEvent.payload?.state?.tasks?.some((task) => task.id === "plan-turn-plan-revise-4"), true);
	assert.equal(result.events.filter((event) => event.type === "plan_complete").length, 1);
});

test("AgentLoopController ignores malformed runtime plan_revise changes without failing the turn", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return [
					"```friday-runtime",
					JSON.stringify({
						type: "response",
						assistant: "Finished without applying the malformed revision.",
						plan: {
							type: "plan_revise",
							reason: "Malformed model revision should be ignored.",
							changes: "not-an-array",
						},
					}),
					"```",
				].join("\n");
			},
			async requestWithTools() {
				throw new Error("prompt malformed plan revise test should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("prompt malformed plan revise test should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-malformed-plan-revise",
		taskId: "task-malformed-plan-revise",
		traceId: "trace-malformed-plan-revise",
		conversationId: "conversation-malformed-plan-revise",
		agentId: "agent-malformed-plan-revise",
		conversation: [],
		userPrompt: "Fix the parser bug and update the regression test",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Finished without applying the malformed revision.");
	assert.equal(result.events.some((event) => event.type === "turn_failed"), false);
	const reviseEvent = result.events.find((event) => event.type === "plan_revise");
	assert.equal(Array.isArray(reviseEvent?.payload?.changes), false);
});

test("AgentLoopController applies runtime plan_skip instructions without completing the skipped plan", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 2,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				throw new Error("native plan skip test should not use prompt mode");
			},
			async requestWithTools(input) {
				if (input.step === 1) {
					return {
						assistantText: runtimeEnvelope({
							type: "tool_call",
							assistant: "I understand this may need a plan, then I will check evidence.",
							intake: {
								complexity: "complex",
								route: "plan_and_execute",
								statement: "I understand you want the parser bug checked before deciding whether to proceed.",
								requiresPlan: true,
								shouldShowProcess: true,
								shouldUseVisiblePlan: true,
							},
							plan: {
								type: "plan_create",
								visibility: "visible",
								tasks: [
									{ id: "skip-check", title: "Check whether the plan is still needed", status: "in_progress" },
									{ id: "skip-followup", title: "Continue only if evidence requires it", status: "pending" },
								],
							},
						}),
						toolCalls: [{ id: "call-skip-1", name: "read", args: { path: "src/parser.ts" } }],
						finishReason: "tool_calls",
					};
				}
				return {
					assistantText: runtimeEnvelope({
							type: "response",
							assistant: "This no longer needs a visible plan.",
							plan: {
								type: "plan_skip",
								reason: "The task resolved as a direct answer.",
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
				return {
					trace: {
						runId: "read-plan-skip",
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
						summary: "Read parser evidence",
					},
					payload: { ok: true, tool: "read", data: { path: "src/parser.ts", content: "parser" } },
					modelResultText: "TOOL_RESULT parser evidence",
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-plan-skip",
		taskId: "task-plan-skip",
		traceId: "trace-plan-skip",
		conversationId: "conversation-plan-skip",
		agentId: "agent-plan-skip",
		conversation: [],
		userPrompt: "Fix the parser bug and update the regression test",
		allowedTools: ["read"],
		mode: "agent",
		budget: { tool: { maxIterations: 2 } },
	});

	const planEvents = result.events.filter((event) => event.type.startsWith("plan_"));
	assert.ok(planEvents.some((event) => event.type === "plan_skip"), "runtime envelope should emit plan_skip");
	assert.equal(planEvents.at(-1)?.type, "plan_skip");
	assert.equal(planEvents.at(-1)?.payload?.reason, "The task resolved as a direct answer.");
	assert.equal(planEvents.at(-1)?.payload?.state?.status, "skipped");
});

test("AgentLoopController does not create intake plan events for simple answer turns", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return "北京时间是 10 点。";
			},
			async requestWithTools() {
				throw new Error("simple answer should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("simple answer should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-simple-answer",
		taskId: "task-simple-answer",
		traceId: "trace-simple-answer",
		conversationId: "conversation-simple-answer",
		agentId: "agent-simple-answer",
		conversation: [],
		userPrompt: "现在几点？",
		mode: "ask",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "北京时间是 10 点。");
	assert.equal(result.events.some((event) => event.type === "intake_decision"), false);
	assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false);
	assert.equal(result.events.some((event) => event.type === "narration"), false);
});

test("AgentLoopController keeps explicit no-analysis direct-answer prompts simple", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const prompts = [
		"Don't analyze, just give the final conclusion",
		"不要分析，直接给出最终结论",
	];

	for (const [index, userPrompt] of prompts.entries()) {
		const controller = new AgentLoopController({
			contextEngine: {
				async buildContext(input) {
					return {
						toolCallingMode: "prompt",
						maxIterations: 1,
						messages: [
							{ role: "system", content: "system prompt" },
							{ role: "user", content: input.userPrompt },
						],
					};
				},
			},
			modelDriver: {
				async requestText() {
					return "The final conclusion is ready.";
				},
				async requestWithTools() {
					throw new Error("direct no-analysis answer should not use native tools");
				},
			},
			toolExecution: {
				async listNativeTools() {
					return [];
				},
				async executeTool() {
					throw new Error("direct no-analysis answer should not execute tools");
				},
			},
		});
		const kernel = new AgentKernel(controller);

		const result = await kernel.runTurn({
			turnId: `turn-simple-no-analysis-${index}`,
			taskId: `task-simple-no-analysis-${index}`,
			traceId: `trace-simple-no-analysis-${index}`,
			conversationId: `conversation-simple-no-analysis-${index}`,
			agentId: "agent-simple-no-analysis",
			conversation: [],
			userPrompt,
			mode: "ask",
			budget: { tool: { maxIterations: 1 } },
		});

		assert.equal(result.status, "completed", userPrompt);
		assert.equal(result.assistantText, "The final conclusion is ready.", userPrompt);
		assert.equal(result.events.some((event) => event.type === "intake_decision"), false, userPrompt);
		assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false, userPrompt);
		assert.equal(result.events.some((event) => event.type === "narration"), false, userPrompt);
	}
});

test("AgentLoopController keeps direct Chinese one-sentence answers simple even when negating file and plan work", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "prompt",
					maxIterations: 1,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
					],
				};
			},
		},
		modelDriver: {
			async requestText() {
				return "4";
			},
			async requestWithTools() {
				throw new Error("direct answer should not use native tools");
			},
		},
		toolExecution: {
			async listNativeTools() {
				return [];
			},
			async executeTool() {
				throw new Error("direct answer should not execute tools");
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-simple-chinese-direct",
		taskId: "task-simple-chinese-direct",
		traceId: "trace-simple-chinese-direct",
		conversationId: "conversation-simple-chinese-direct",
		agentId: "agent-simple-chinese-direct",
		conversation: [],
		userPrompt: "一句话回答：2+2 等于几？不要读取文件，不要制定计划。",
		mode: "ask",
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "4");
	assert.equal(result.events.some((event) => event.type === "intake_decision"), false);
	assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false);
	assert.equal(result.events.some((event) => event.type === "narration"), false);
});

test("AgentLoopController puts model-authored progress narration into the process timeline instead of the final answer", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
	const controller = new AgentLoopController({
		contextEngine: {
			async buildContext(input) {
				return {
					toolCallingMode: "native",
					maxIterations: 3,
					messages: [
						{ role: "system", content: "system prompt" },
						{ role: "user", content: input.userPrompt },
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
						assistantText: "我理解你的需求是先读取项目文件，接下来我会调用读取工具。",
						toolCalls: [{ id: "call-1", name: "read", args: { path: "Project/a.md" } }],
						finishReason: "tool_calls",
					};
				}
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
						summary: "已读取 Project/a.md。",
					},
					payload: { ok: true, tool: "read", data: { path: "Project/a.md", content: "alpha" } },
					modelResultText: "TOOL_RESULT alpha",
				};
			},
		},
	});
	const kernel = new AgentKernel(controller);

	const result = await kernel.runTurn({
		turnId: "turn-narration-progress",
		traceId: "trace-narration-progress",
		conversationId: "conversation-narration-progress",
		agentId: "agent-narration-progress",
		conversation: [],
		userPrompt: "读取 Project/a.md 并告诉我内容",
		mode: "ask",
	});

	assert.equal(result.assistantText, "The file says alpha.");
	assert.equal(result.assistantText.includes("我理解你的需求"), false);
	const narrationPayloads = result.events
		.filter((event) => event.type === "narration")
		.map((event) => event.payload);
	assert.deepEqual(narrationPayloads.map((payload) => payload.kind), [
		"stage_report",
		"stage_report",
	]);
	assert.match(narrationPayloads[0]?.summary ?? "", /我理解你的需求/);
	assert.equal(JSON.stringify(narrationPayloads).includes("raw chain of thought"), false);
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
					maxAttempts: 6,
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
	assert.equal(retryProgress.transport.maxAttempts, 6);
	assert.equal(retryProgress.transport.delayMs, 700);
	assert.equal(retryProgress.transport.httpStatus, 504);
	assert.equal(retryProgress.transport.retryable, true);
	assert.equal(retryProgress.message, "网络波动，正在恢复请求（第 1/5 次）");
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
