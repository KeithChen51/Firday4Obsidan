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

test("AgentLoopController creates intake and plan events for complex implementation turns", async () => {
	const [{ AgentKernel }, { AgentLoopController }] = await Promise.all([
		jiti.import(kernelPath),
		jiti.import(loopPath),
	]);
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
				throw new Error("prompt path should not be used");
			},
			async requestWithTools() {
				return {
					assistantText: "Implemented the optimization.",
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
		budget: { tool: { maxIterations: 1 } },
	});

	assert.equal(result.status, "completed");
	const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
	assert.equal(intakePayload?.complexity, "complex");
	assert.equal(intakePayload?.requiresPlan, true);
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

test("AgentLoopController skips visible intake and plan for simple rewrite turns", async () => {
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
				return "Please send the final report today.";
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
	assert.equal(result.events.some((event) => event.type === "intake_decision"), false);
	assert.equal(result.events.some((event) => event.type.startsWith("plan_")), false);
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
						assistantText: "Completed the scoped investigation.",
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
		const intakePayload = result.events.find((event) => event.type === "intake_decision")?.payload;
		assert.equal(intakePayload?.complexity, "complex", userPrompt);
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
						assistantText: "",
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
