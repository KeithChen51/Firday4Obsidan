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

const runtimePath = path.join(projectRoot, "src/core/agent-kernel/pi/FridayPiRuntime.ts");
const portsPath = path.join(projectRoot, "src/core/agent-kernel/pi/FridayPiRuntimePorts.ts");
const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

function createInput(overrides = {}) {
	const progress = [];
	return {
		input: {
			turnId: "turn-pi",
			taskId: "task-pi",
			traceId: "trace-pi",
			conversationId: "conversation-pi",
			agentId: "agent-pi",
			conversation: [],
			userPrompt: "run the PI-shaped turn",
			mode: "write",
			metadata: { source: "test" },
			onProgress: (event) => progress.push(event),
			...overrides,
		},
		progress,
	};
}

async function createContext(overrides = {}) {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	return new AgentExecutionContext({
		turnId: "turn-pi",
		taskId: "task-pi",
		traceId: "trace-pi",
		conversationId: "conversation-pi",
		agentId: "agent-pi",
		mode: "write",
		metadata: { context: "test" },
		...overrides,
	});
}

test("FridayPiRuntime subscribes before prompt and maps PI events into a kernel turn result", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { input, progress } = createInput();
	const context = await createContext();
	const calls = [];
	let listener;

	const session = {
		subscribe(next) {
			calls.push("subscribe");
			listener = next;
			return () => calls.push("unsubscribe");
		},
		async prompt(text, options) {
			calls.push("prompt");
			assert.equal(text, input.userPrompt);
			assert.equal(options.signal, context.signal);
			assert.equal(options.metadata.turnId, context.turnId);
			assert.equal(options.metadata.taskId, context.taskId);
			listener({ type: "text_delta", text: "Hello " });
			listener({ type: "tool_call", step: 1, tool: "read_file", targetPath: "Daily.md", summary: "Reading Daily.md" });
			listener({
				type: "tool_result",
				runId: "run-tool-1",
				step: 1,
				tool: "read_file",
				scope: "vault",
				targetPath: "Daily.md",
				approved: true,
				approvalReason: "pre-approved",
				persistedRule: false,
				viaRule: false,
				status: "ok",
				ok: true,
				summary: "Read Daily.md",
			});
			listener({ type: "text_final", text: "Hello from PI." });
			listener({ type: "done", summary: "PI session finished" });
		},
		async dispose() {
			calls.push("dispose");
		},
	};

	const runtime = new FridayPiRuntime({
		createSession(factoryInput, factoryContext) {
			assert.equal(factoryInput, input);
			assert.equal(factoryContext, context);
			return session;
		},
	});

	const result = await runtime.execute(input, context);

	assert.deepEqual(calls, ["subscribe", "prompt", "unsubscribe", "dispose"]);
	assert.equal(result.status, "completed");
	assert.equal(result.turnId, context.turnId);
	assert.equal(result.taskId, context.taskId);
	assert.equal(result.traceId, context.traceId);
	assert.equal(result.conversationId, input.conversationId);
	assert.equal(result.assistantText, "Hello from PI.");
	assert.equal(result.rawFinalReply, "Hello from PI.");
	assert.deepEqual(result.traces, [
		{
			runId: "run-tool-1",
			step: 1,
			tool: "read_file",
			scope: "vault",
			targetPath: "Daily.md",
			approved: true,
			approvalReason: "pre-approved",
			persistedRule: false,
			viaRule: false,
			status: "ok",
			ok: true,
			summary: "Read Daily.md",
		},
	]);
	assert.deepEqual(progress.map((event) => event.phase), ["start", "model_response", "tool_call", "tool_result", "model_response", "done"]);
	for (const event of progress) {
		assert.equal(event.turnId, context.turnId);
		assert.equal(event.taskId, context.taskId);
		assert.equal(event.traceId, context.traceId);
		assert.equal(event.conversationId, context.conversationId);
		assert.equal(event.agentId, context.agentId);
	}
});

test("FridayPiRuntime returns failed on prompt errors and still cleans up the session", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { input, progress } = createInput({ userPrompt: "fail the PI turn" });
	const context = await createContext();
	const calls = [];

	const runtime = new FridayPiRuntime({
		createSession() {
			return {
				subscribe(listener) {
					calls.push("subscribe");
					listener({ type: "text_delta", text: "partial " });
					return () => calls.push("unsubscribe");
				},
				async prompt() {
					calls.push("prompt");
					throw new Error("PI prompt failed");
				},
				dispose() {
					calls.push("dispose");
				},
			};
		},
	});

	const result = await runtime.execute(input, context);

	assert.deepEqual(calls, ["subscribe", "prompt", "unsubscribe", "dispose"]);
	assert.equal(result.status, "failed");
	assert.equal(result.assistantText, "partial ");
	assert.equal(result.rawFinalReply, "partial ");
	assert.equal(result.failure.category, "unknown");
	assert.match(result.failure.technicalMessage, /PI prompt failed/);
	assert.equal(progress.at(-1).phase, "error");
	assert.match(progress.at(-1).message, /PI prompt failed/);
});

test("Friday PI runtime ports stay local and do not import the real PI SDK yet", () => {
	const ports = fs.readFileSync(portsPath, "utf8");
	const runtime = fs.readFileSync(runtimePath, "utf8");

	assert.doesNotMatch(`${ports}\n${runtime}`, /@earendil-works\/pi-/);
	assert.match(ports, /FridayPiSessionPort/);
	assert.match(ports, /subscribe\(\s*listener/);
	assert.match(ports, /prompt\(\s*text/);
	assert.match(ports, /createSession/);
	assert.match(ports, /steer\?/);
	assert.match(ports, /followUp\?/);
	assert.match(ports, /dispose\?/);
});
