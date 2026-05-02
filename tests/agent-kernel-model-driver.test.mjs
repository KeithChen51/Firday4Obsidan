/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const adapterPath = path.join(projectRoot, "src/services/AIServiceModelDriverAdapter.ts");

test("AIServiceModelDriverAdapter forwards text requests with model override and abort signal", async () => {
	const { AIServiceModelDriverAdapter } = await jiti.import(adapterPath);
	const calls = [];
	const signal = new AbortController().signal;
	const adapter = new AIServiceModelDriverAdapter({
		async chat(messages, options) {
			calls.push({ messages, options });
			return "plain answer";
		},
		async chatWithTools() {
			throw new Error("native path should not run");
		},
	});

	const result = await adapter.requestText({
		messages: [{ role: "user", content: "hello" }],
		modelOverride: "model-a",
		signal,
	});

	assert.equal(result.assistantText, "plain answer");
	assert.deepEqual(result.toolCalls, []);
	assert.equal(calls[0].options.modelOverride, "model-a");
	assert.equal(calls[0].options.signal, signal);
});

test("AIServiceModelDriverAdapter preserves reasoning content and native tool calls", async () => {
	const { AIServiceModelDriverAdapter } = await jiti.import(adapterPath);
	const signal = new AbortController().signal;
	const adapter = new AIServiceModelDriverAdapter({
		async chat() {
			throw new Error("prompt path should not run");
		},
		async chatWithTools(messages, tools, options) {
			return {
				assistantText: "thinking",
				toolCalls: [{ id: "call-1", name: "read", args: { path: "a.md" } }],
				reasoningContent: "reasoning kept",
				finishReason: "tool_calls",
				seen: { messages, tools, options },
			};
		},
	});

	const result = await adapter.requestWithTools({
		messages: [{ role: "user", content: "hello" }],
		tools: [{ name: "read", description: "Read", parameters: { type: "object" } }],
		modelOverride: "model-b",
		signal,
	});

	assert.equal(result.assistantText, "thinking");
	assert.equal(result.reasoningContent, "reasoning kept");
	assert.deepEqual(result.toolCalls, [{ id: "call-1", name: "read", args: { path: "a.md" } }]);
	assert.equal(result.finishReason, "tool_calls");
});
