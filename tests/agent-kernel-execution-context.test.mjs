/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

test("AgentExecutionContext captures stable turn identity and metadata", async () => {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	const context = new AgentExecutionContext({
		turnId: "turn-1",
		conversationId: "conversation-1",
		agentId: "agent-1",
		mode: "ask",
		taskId: "task-1",
		traceId: "trace-1",
		budget: {
			token: { used: 12, softLimit: 100, hardLimit: 120 },
			turn: { depth: 1, maxDepth: 4 },
			tool: { usedIterations: 0, maxIterations: 6 },
			time: { timeoutMs: 30_000 },
		},
		metadata: { source: "test" },
	});

	assert.equal(context.turnId, "turn-1");
	assert.equal(context.conversationId, "conversation-1");
	assert.equal(context.agentId, "agent-1");
	assert.equal(context.mode, "ask");
	assert.equal(context.taskId, "task-1");
	assert.equal(context.traceId, "trace-1");
	assert.deepEqual(context.budget, {
		token: { used: 12, softLimit: 100, hardLimit: 120 },
		turn: { depth: 1, maxDepth: 4 },
		tool: { usedIterations: 0, maxIterations: 6 },
		time: { timeoutMs: 30_000 },
	});
	assert.equal(context.metadata.source, "test");
	assert.ok(context.startedAt);
	assert.equal(context.signal.aborted, false);
});

test("AgentExecutionContext defaults trace id and can attach task id when legacy runtime creates one later", async () => {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	const context = new AgentExecutionContext({
		turnId: "turn-with-task-later",
		conversationId: "conversation-task",
		agentId: "agent-task",
		mode: "ask",
	});

	assert.equal(context.traceId, "turn-with-task-later");
	assert.equal(context.taskId, undefined);

	context.setTaskId("task-created-later");
	assert.equal(context.taskId, "task-created-later");

	const emitted = context.emit({
		type: "task_updated",
		payload: { status: "running" },
	});
	assert.equal(emitted.taskId, "task-created-later");
	assert.equal(emitted.traceId, "turn-with-task-later");
});

test("AgentExecutionContext emits normalized events and returns immutable snapshots", async () => {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	const context = new AgentExecutionContext({
		turnId: "turn-events",
		conversationId: "conversation-events",
		agentId: "agent-events",
		mode: "research",
	});

	const emitted = context.emit({
		type: "model_request",
		payload: { model: "scripted" },
	});

	assert.equal(emitted.type, "model_request");
	assert.equal(emitted.turnId, "turn-events");
	assert.equal(emitted.conversationId, "conversation-events");
	assert.equal(emitted.agentId, "agent-events");
	assert.ok(emitted.at);

	const snapshot = context.snapshotEvents();
	assert.deepEqual(snapshot.map((event) => event.type), ["model_request"]);
	snapshot.push({ type: "turn_completed", turnId: "external", at: new Date().toISOString() });
	assert.deepEqual(context.snapshotEvents().map((event) => event.type), ["model_request"]);
});

test("AgentExecutionContext owns cancellation without static shared state", async () => {
	const { AgentExecutionContext } = await jiti.import(contextPath);
	const external = new AbortController();
	const context = new AgentExecutionContext({
		turnId: "turn-cancel",
		conversationId: "conversation-cancel",
		agentId: "agent-cancel",
		mode: "write",
		signal: external.signal,
	});

	assert.equal(context.isCancelled(), false);
	external.abort("external stop");
	assert.equal(context.isCancelled(), true);
	assert.equal(context.signal.aborted, true);

	const independent = new AgentExecutionContext({
		turnId: "turn-independent",
		conversationId: "conversation-independent",
		agentId: "agent-independent",
		mode: "write",
	});
	assert.equal(independent.isCancelled(), false);
	independent.cancel("manual stop");
	assert.equal(independent.isCancelled(), true);
	assert.equal(context.turnId, "turn-cancel");
});
