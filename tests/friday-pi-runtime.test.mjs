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

test("FridayPiRuntime waits for delayed terminal PI events after prompt resolves", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { input, progress } = createInput({ userPrompt: "stream after prompt resolves" });
	const context = await createContext();
	const calls = [];
	let listener;
	let subscribed = false;

	const runtime = new FridayPiRuntime({
		createSession() {
			return {
				subscribe(next) {
					calls.push("subscribe");
					listener = next;
					subscribed = true;
					return () => {
						calls.push("unsubscribe");
						subscribed = false;
					};
				},
				async prompt() {
					calls.push("prompt");
					setTimeout(() => {
						if (!subscribed) {
							calls.push("late-event-dropped");
							return;
						}
						calls.push("emit-final");
						listener({ type: "text_final", text: "Delayed from PI." });
						calls.push("emit-done");
						listener({ type: "done", summary: "Delayed PI done" });
					}, 5);
				},
				dispose() {
					calls.push("dispose");
				},
			};
		},
	});

	const result = await runtime.execute(input, context);

	assert.equal(result.status, "completed");
	assert.equal(result.assistantText, "Delayed from PI.");
	assert.deepEqual(progress.map((event) => event.phase), ["start", "model_response", "done"]);
	assert.deepEqual(calls, ["subscribe", "prompt", "emit-final", "emit-done", "unsubscribe", "dispose"]);
});

test("FridayPiRuntime records PI activity into durable context events", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { input } = createInput();
	const context = await createContext();

	const session = {
		listener: undefined,
		subscribe(listener) {
			session.listener = listener;
			return () => {};
		},
		async prompt() {
			session.listener({ type: "text_delta", text: "Durable " });
			session.listener({ type: "tool_call", step: 1, tool: "read_file", targetPath: "Daily.md", summary: "Reading Daily.md" });
			session.listener({
				type: "tool_result",
				runId: "durable-run",
				step: 1,
				tool: "read_file",
				scope: "vault",
				targetPath: "Daily.md",
				status: "ok",
				ok: true,
				summary: "Read Daily.md",
			});
			session.listener({ type: "text_final", text: "Durable PI response." });
			session.listener({ type: "done", summary: "Durable done" });
		},
	};
	const durableRuntime = new FridayPiRuntime({ createSession: () => session });

	const result = await durableRuntime.execute(input, context);
	const eventTypes = result.events.map((event) => event.type);

	assert.equal(result.assistantText, "Durable PI response.");
	assert.deepEqual(eventTypes, ["model_response", "tool_call", "tool_result", "model_response", "turn_completed"]);
	assert.equal(result.events[0].payload.text, "Durable ");
	assert.equal(result.events[1].payload.tool, "read_file");
	assert.equal(result.events[2].payload.tool, "read_file");
	assert.equal(result.events[2].payload.status, "ok");
	assert.equal(result.events[4].payload.summary, "Durable done");
});

test("FridayPiRuntime returns failed and cleans up on direct PI error events", async () => {
	const { FridayPiRuntime } = await jiti.import(runtimePath);
	const { input, progress } = createInput({ userPrompt: "emit PI error" });
	const context = await createContext();
	const calls = [];

	const runtime = new FridayPiRuntime({
		createSession() {
			return {
				subscribe(listener) {
					calls.push("subscribe");
					this.listener = listener;
					return () => calls.push("unsubscribe");
				},
				async prompt() {
					calls.push("prompt");
					this.listener({ type: "error", message: "PI emitted an error" });
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
	assert.match(result.failure.technicalMessage, /PI emitted an error/);
	assert.equal(progress.at(-1).phase, "error");
	assert.deepEqual(result.events.map((event) => event.type), ["turn_failed"]);
	assert.equal(result.events[0].payload.message, "PI emitted an error");
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
