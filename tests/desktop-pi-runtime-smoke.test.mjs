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

const smokePath = path.join(projectRoot, "src/desktop/runtime/DesktopRuntimeSmoke.ts");
const adapterPath = path.join(projectRoot, "src/desktop/runtime/DesktopFridayPiRuntimeHostAdapter.ts");
const contextPath = path.join(projectRoot, "src/core/agent-kernel/AgentExecutionContext.ts");

test("Desktop runtime smoke runs FridayPiRuntime through Desktop host ports", async () => {
	const { runDesktopPiRuntimeSmoke } = await jiti.import(smokePath);
	const evidence = await runDesktopPiRuntimeSmoke({
		prompt: "run the desktop PI runtime smoke",
	});

	assert.equal(fs.existsSync(path.join(evidence.projectRoot, "FRIDAY", "project.json")), true);
	assert.equal(evidence.result.status, "completed");
	assert.equal(evidence.result.assistantText, "Desktop PI runtime smoke completed.");
	assert.equal(evidence.disposeCount, 1);

	assert.ok(evidence.progress.some((event) => event.phase === "start"));
	assert.ok(evidence.progress.some((event) => event.phase === "model_response"));
	assert.ok(evidence.progress.some((event) => event.phase === "tool_result"));
	assert.ok(evidence.progress.some((event) => event.phase === "done"));

	assert.ok(evidence.traceEvents.some((event) => event.type === "pi_tool_call"));
	assert.ok(evidence.traceEvents.some((event) => event.type === "pi_tool_result"));
	assert.ok(evidence.traceEvents.some((event) => event.type === "pi_session_disposed"));

	assert.equal(evidence.conversationRecord.id, evidence.conversationId);
	assert.equal(evidence.persistedTurns.some((turn) => turn.role === "user" && turn.content === evidence.prompt), true);
	assert.equal(
		evidence.persistedTurns.some((turn) =>
			turn.role === "assistant" &&
			turn.content === "Desktop PI runtime smoke completed."
		),
		true,
	);
});

test("DesktopFridayPiRuntimeHostAdapter accepts an injected RealPi-compatible session host", async () => {
	const { runDesktopPiRuntimeSmoke, createScriptedDesktopPiSessionHost } = await jiti.import(smokePath);
	const { DesktopFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const scripted = createScriptedDesktopPiSessionHost({
		assistantText: "Injected session host completed.",
		toolResultSummary: "Injected tool trace persisted.",
	});

	const evidence = await runDesktopPiRuntimeSmoke({
		sessionHost: scripted.host,
		prompt: "use injected session host",
	});

	assert.equal(typeof DesktopFridayPiRuntimeHostAdapter, "function");
	assert.equal(evidence.result.assistantText, "Injected session host completed.");
	assert.equal(scripted.state.promptTexts[0], "use injected session host");
	assert.equal(scripted.state.disposeCount, 1);
	assert.ok(evidence.traceEvents.some((event) =>
		event.type === "pi_tool_result" &&
		event.payload?.summary === "Injected tool trace persisted."
	));
});

test("DesktopFridayPiRuntimeHostAdapter deduplicates event and host result tool traces", async () => {
	const { runDesktopPiRuntimeSmoke } = await jiti.import(smokePath);
	const trace = {
		runId: "pi-read-1",
		step: 1,
		tool: "read_file",
		scope: "vault",
		targetPath: "README.md",
		approved: false,
		approvalReason: "",
		persistedRule: false,
		viaRule: false,
		status: "ok",
		ok: true,
		summary: "Read README.md once.",
	};
	const evidence = await runDesktopPiRuntimeSmoke({
		sessionHost: createSessionHostFromScript([
			{ type: "tool_call", runId: trace.runId, step: trace.step, tool: trace.tool, targetPath: trace.targetPath },
			{
				type: "tool_result",
				runId: trace.runId,
				step: trace.step,
				tool: trace.tool,
				scope: trace.scope,
				targetPath: trace.targetPath,
				status: trace.status,
				ok: trace.ok,
				summary: trace.summary,
			},
			{
				type: "host_result",
				result: {
					turnId: "turn-desktop-pi-smoke",
					traceId: "trace-desktop-pi-smoke",
					conversationId: "conversation-desktop-pi-smoke",
					status: "completed",
					assistantText: "Host result answer.",
					events: [],
					traces: [trace],
					rawFinalReply: "Host result answer.",
				},
			},
		]),
	});

	const persistedToolResults = evidence.traceEvents.filter((event) =>
		event.type === "pi_tool_result" &&
		event.payload?.runId === "pi-read-1" &&
		event.payload?.step === 1 &&
		event.payload?.tool === "read_file"
	);
	assert.equal(persistedToolResults.length, 1);
});

test("DesktopFridayPiRuntimeHostAdapter lets host_result win over an earlier generic done terminal write", async () => {
	const { runDesktopPiRuntimeSmoke } = await jiti.import(smokePath);
	const evidence = await runDesktopPiRuntimeSmoke({
		sessionHost: createSessionHostFromScript([
			{ type: "text_delta", text: "partial draft" },
			{ type: "done", summary: "Generic session done before host result." },
			{
				type: "host_result",
				result: {
					turnId: "turn-desktop-pi-smoke",
					traceId: "trace-desktop-pi-smoke",
					conversationId: "conversation-desktop-pi-smoke",
					status: "completed",
					assistantText: "Authoritative host result answer.",
					events: [],
					traces: [],
					rawFinalReply: "Authoritative host result answer.",
				},
			},
		]),
	});

	const assistantTurns = evidence.persistedTurns.filter((turn) => turn.role === "assistant");
	assert.equal(assistantTurns.length, 1);
	assert.equal(assistantTurns[0].content, "Authoritative host result answer.");
});

test("DesktopFridayPiRuntimeHostAdapter fails fast when no desktop project root can be resolved", async () => {
	const { DesktopFridayPiRuntimeHostAdapter } = await jiti.import(adapterPath);
	const { AgentExecutionContext } = await jiti.import(contextPath);
	const context = new AgentExecutionContext({
		turnId: "turn-no-project-root",
		conversationId: "conversation-no-project-root",
		agentId: "agent-no-project-root",
		mode: "ask",
	});
	const input = {
		turnId: context.turnId,
		conversationId: context.conversationId,
		agentId: context.agentId,
		conversation: [],
		userPrompt: "should fail before session creation",
		mode: "ask",
	};
	const adapter = new DesktopFridayPiRuntimeHostAdapter({
		desktopHost: {
			project: {
				async getActiveProject() {
					return null;
				},
			},
			runtimeState: failIfCalled("runtimeState"),
			trace: failIfCalled("trace"),
			tools: failIfCalled("tools"),
		},
		sessionHost: failIfCalled("sessionHost"),
	});

	await assert.rejects(
		() => adapter.createSession(input, context),
		/Desktop PI runtime requires a projectRoot/,
	);
});

function createSessionHostFromScript(script) {
	return {
		createSession() {
			return {
				listeners: new Set(),
				subscribe(listener) {
					this.listeners.add(listener);
					return () => this.listeners.delete(listener);
				},
				async prompt() {
					for (const event of script) {
						for (const listener of [...this.listeners]) {
							listener(event);
						}
					}
				},
				dispose() {
					this.listeners.clear();
				},
			};
		},
	};
}

function failIfCalled(label) {
	return new Proxy({}, {
		get() {
			return () => {
				throw new Error(`${label} should not be called`);
			};
		},
	});
}
