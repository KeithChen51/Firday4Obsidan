/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const runtimePath = path.join(projectRoot, "src/core/agent-kernel/pi/FridayPiRuntime.ts");
const adapterPath = path.join(projectRoot, "src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts");
const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

function createInput(overrides = {}) {
	const progress = [];
	return {
		input: {
			turnId: "turn-real-pi",
			taskId: "task-real-pi",
			traceId: "trace-real-pi",
			conversationId: "conversation-real-pi",
			agentId: "agent-real-pi",
			conversation: [],
			userPrompt: "run the real pi sdk adapter",
			mode: "ask",
			onProgress: (event) => progress.push(event),
			...overrides,
		},
		progress,
	};
}

async function createContext(overrides = {}) {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	return new AgentExecutionContext({
		turnId: "turn-real-pi",
		taskId: "task-real-pi",
		traceId: "trace-real-pi",
		conversationId: "conversation-real-pi",
		agentId: "agent-real-pi",
		mode: "ask",
		...overrides,
	});
}

class ScriptedPiAgent {
	constructor(script) {
		this.script = script;
		this.listeners = new Set();
		this.abortCalls = 0;
		this.promptInputs = [];
		this.promptCalls = [];
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(...args) {
		const [input] = args;
		this.promptInputs.push(input);
		this.promptCalls.push(args);
		for (const event of this.script) {
			for (const listener of [...this.listeners]) {
				await listener(event, new AbortController().signal);
			}
		}
	}

	abort() {
		this.abortCalls += 1;
	}
}

test("RealPiSdkSessionHostAdapter maps PI Agent events into FridayPiRuntime results", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input, progress } = createInput();
	const context = await createContext();
	let createdAgent;
	const script = [
		{ type: "agent_start" },
		{ type: "turn_start" },
		{
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "Reading" }] },
			assistantMessageEvent: { type: "text_delta", delta: "Reading" },
		},
		{
			type: "tool_execution_start",
			toolCallId: "pi-tool-1",
			toolName: "read",
			args: { path: "Project/workspace/a.md" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "pi-tool-1",
			toolName: "read",
			result: {
				content: [{ type: "text", text: "alpha" }],
				details: { targetPath: "Project/workspace/a.md" },
			},
			isError: false,
		},
		{
			type: "turn_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "The file says alpha." }],
				stopReason: "stop",
			},
			toolResults: [],
		},
		{
			type: "agent_end",
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "The file says alpha." }] },
			],
		},
	];
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			createAgent: () => {
				createdAgent = new ScriptedPiAgent(script);
				return createdAgent;
			},
		}),
	);

	const result = await runtime.execute(input, context);

	assert.equal(createdAgent.promptInputs[0], input.userPrompt);
	assert.equal(createdAgent.promptCalls[0].length, 1);
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "The file says alpha.");
	assert.equal(result.rawFinalReply, "The file says alpha.");
	assert.equal(createdAgent.abortCalls, 0);
	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].tool, "read");
	assert.equal(result.traces[0].runId, "pi-tool-1");
	assert.equal(result.traces[0].targetPath, "Project/workspace/a.md");
	assert.equal(result.traces[0].ok, true);
	assert.equal(progress.some((event) => event.phase === "tool_call" && event.tool === "read"), true);
	assert.equal(progress.some((event) => event.phase === "tool_result" && event.tool === "read"), true);
});

test("RealPiSdkSessionHostAdapter waits for PI agent_end before completing multi-turn tool runs", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ turnId: "turn-real-pi-multi-turn" });
	const context = await createContext({ turnId: "turn-real-pi-multi-turn" });
	let createdAgent;
	const script = [
		{
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "I need to read the file." }] },
		},
		{
			type: "tool_execution_start",
			toolCallId: "pi-tool-1",
			toolName: "read",
			args: { path: "Project/workspace/a.md" },
		},
		{
			type: "tool_execution_end",
			toolCallId: "pi-tool-1",
			toolName: "read",
			result: {
				content: [{ type: "text", text: "alpha" }],
				details: { targetPath: "Project/workspace/a.md" },
			},
			isError: false,
		},
		{
			type: "turn_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I need to read the file." },
					{ type: "toolCall", id: "pi-tool-1", name: "read", arguments: { path: "Project/workspace/a.md" } },
				],
				stopReason: "toolUse",
			},
			toolResults: [
				{
					role: "toolResult",
					toolCallId: "pi-tool-1",
					toolName: "read",
					content: [{ type: "text", text: "alpha" }],
					isError: false,
				},
			],
		},
		{
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "The final answer is alpha." }] },
		},
		{
			type: "turn_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "The final answer is alpha." }],
				stopReason: "stop",
			},
			toolResults: [],
		},
		{
			type: "agent_end",
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "I need to read the file." }] },
				{ role: "toolResult", toolCallId: "pi-tool-1", toolName: "read", content: [{ type: "text", text: "alpha" }], isError: false },
				{ role: "assistant", content: [{ type: "text", text: "The final answer is alpha." }] },
			],
		},
	];
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			createAgent: () => {
				createdAgent = new ScriptedPiAgent(script);
				return createdAgent;
			},
		}),
	);

	const result = await runtime.execute(input, context);

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "The final answer is alpha.");
	assert.equal(result.rawFinalReply, "The final answer is alpha.");
	assert.equal(result.traces.length, 1);
	assert.equal(createdAgent.abortCalls, 0);
});

test("RealPiSdkSessionHostAdapter correlates PI tool start and end events without SDK ids", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input, progress } = createInput({ turnId: "turn-real-pi-no-tool-id" });
	const context = await createContext({ turnId: "turn-real-pi-no-tool-id" });
	const script = [
		{
			type: "tool_execution_start",
			toolName: "read",
			args: { path: "Project/workspace/no-id.md" },
		},
		{
			type: "tool_execution_end",
			toolName: "read",
			result: {
				content: [{ type: "text", text: "beta" }],
				details: { targetPath: "Project/workspace/no-id.md" },
			},
			isError: false,
		},
		{
			type: "turn_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Read beta." }],
				stopReason: "stop",
			},
			toolResults: [],
		},
		{
			type: "agent_end",
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "Read beta." }] },
			],
		},
	];
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			createAgent: () => new ScriptedPiAgent(script),
		}),
	);

	const result = await runtime.execute(input, context);
	assert.equal(progress.some((event) => event.phase === "tool_call" && event.tool === "read"), true);
	const toolCallEvent = result.events.find((event) => event.type === "tool_call");

	assert.equal(result.traces.length, 1);
	assert.equal(result.traces[0].step, 1);
	assert.equal(result.traces[0].targetPath, "Project/workspace/no-id.md");
	assert.equal(result.traces[0].runId, toolCallEvent.payload.runId);
});

test("RealPiSdkSessionHostAdapter dispose does not wait for a hanging PI abort", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ turnId: "turn-real-pi-hanging-abort" });
	const context = await createContext({ turnId: "turn-real-pi-hanging-abort" });
	const never = new Promise(() => {});
	class HangingAbortPiAgent extends ScriptedPiAgent {
		async prompt(inputText) {
			this.promptInputs.push(inputText);
			await never;
		}

		abort() {
			this.abortCalls += 1;
			return never;
		}
	}
	let createdAgent;
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			createAgent: () => {
				createdAgent = new HangingAbortPiAgent([]);
				return createdAgent;
			},
		}),
		undefined,
		{ terminalEventTimeoutMs: 5, cancelledPromptGraceMs: 0 },
	);

	const result = await Promise.race([
		runtime.execute(input, context),
		new Promise((resolve) => setTimeout(() => resolve("hung"), 75)),
	]);

	assert.notEqual(result, "hung");
	assert.equal(result.status, "failed");
	assert.equal(createdAgent.abortCalls, 1);
});

test("RealPiSdkSessionHostAdapter can create agents through the dynamic SDK import factory", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ turnId: "turn-real-pi-dynamic-import" });
	const context = await createContext({ turnId: "turn-real-pi-dynamic-import" });
	const imports = [];
	const constructedOptions = [];
	class ImportedPiAgent extends ScriptedPiAgent {
		constructor(options) {
			constructedOptions.push(options);
			super([
				{
					type: "turn_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Imported PI agent ran." }],
						stopReason: "stop",
					},
					toolResults: [],
				},
				{
					type: "agent_end",
					messages: [
						{ role: "assistant", content: [{ type: "text", text: "Imported PI agent ran." }] },
					],
				},
			]);
		}
	}
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			agentOptions: { initialState: { systemPrompt: "test" } },
			importModule: async (specifier) => {
				imports.push(specifier);
				return { Agent: ImportedPiAgent };
			},
		}),
	);

	const result = await runtime.execute(input, context);

	assert.deepEqual(imports, ["@earendil-works/pi-agent-core"]);
	assert.deepEqual(constructedOptions, [{ initialState: { systemPrompt: "test" } }]);
	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Imported PI agent ran.");
});

test("RealPiSdkSessionHostAdapter aborts the PI Agent when the runtime disposes the session", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { input } = createInput({ turnId: "turn-real-pi-timeout" });
	const context = await createContext({ turnId: "turn-real-pi-timeout" });
	let createdAgent;
	let resolvePrompt;
	const promptNeverFinishes = new Promise((resolve) => {
		resolvePrompt = resolve;
	});
	class HangingPiAgent extends ScriptedPiAgent {
		async prompt(inputText) {
			this.promptInputs.push(inputText);
			await promptNeverFinishes;
		}
	}
	const runtime = new FridayPiRuntime(
		new RealPiSdkSessionHostAdapter({
			createAgent: () => {
				createdAgent = new HangingPiAgent([]);
				return createdAgent;
			},
		}),
		undefined,
		{ terminalEventTimeoutMs: 5, cancelledPromptGraceMs: 0 },
	);

	const result = await runtime.execute(input, context);
	resolvePrompt();

	assert.equal(result.status, "failed");
	assert.equal(createdAgent.abortCalls, 1);
});

test("RealPiSdkSessionHostAdapter runs with the bundled PI SDK dependency by default", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { RealPiSdkSessionHostAdapter } = await jiti.import(adapterPath);
	const { registerFauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
	const faux = registerFauxProvider({ tokensPerSecond: 0, tokenSize: { min: 1000, max: 1000 } });
	faux.setResponses([fauxAssistantMessage("Bundled PI SDK dependency ran.")]);
	const { input } = createInput({ turnId: "turn-real-pi-bundled-sdk" });
	const context = await createContext({ turnId: "turn-real-pi-bundled-sdk" });

	try {
		const runtime = new FridayPiRuntime(
			new RealPiSdkSessionHostAdapter({
				agentOptions: {
					initialState: {
						model: faux.models[0],
						systemPrompt: "Bundled dependency smoke.",
					},
				},
			}),
			undefined,
			{ terminalEventTimeoutMs: 5000, cancelledPromptGraceMs: 0 },
		);

		const result = await runtime.execute(input, context);

		assert.equal(result.status, "completed");
		assert.equal(result.assistantText, "Bundled PI SDK dependency ran.");
		assert.equal(faux.getPendingResponseCount(), 0);
	} finally {
		faux.unregister();
	}
});
