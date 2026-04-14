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

const aiServicePath = path.join(projectRoot, "src/services/AIService.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

async function loadAiServiceModule() {
	return jiti.import(aiServicePath);
}

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

test("AIService serializes assistant tool call history into OpenAI tool_calls messages", async () => {
	const mod = await loadAiServiceModule();
	const service = new mod.AIService(() => ({
		mode: "openai",
		apiUrl: "https://example.com/v1/chat/completions",
		apiKey: "test",
		model: "gpt-4.1",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	}));
	const messages = service.toOpenAIMessages([
		{
			role: "assistant",
			content: "",
			toolCalls: [
				{
					id: "call_123",
					name: "ls",
					args: { path: "workspace" },
				},
			],
		},
		{
			role: "tool",
			content: "TOOL_RESULT {\"ok\":true}",
			toolCallId: "call_123",
			name: "ls",
		},
	]);
	assert.deepEqual(messages[0], {
		role: "assistant",
		content: "",
		tool_calls: [
			{
				id: "call_123",
				type: "function",
				function: {
					name: "ls",
					arguments: "{\"path\":\"workspace\"}",
				},
			},
		],
	});
});

test("native runtime loop preserves structured assistant tool calls instead of synthetic calling text", async () => {
	const source = readRuntimeSource();
	const nativePush = source.match(/modelMessages\.push\(\{\s*role:\s*"assistant",([\s\S]*?)\}\);\s*modelMessages\.push\(\{\s*role:\s*"tool"/);
	assert.ok(nativePush, "native tool follow-up assistant message block should exist");
	assert.match(nativePush[1] ?? "", /toolCalls:\s*\[response\.toolCall\]/);
	assert.match(nativePush[1] ?? "", /content:\s*response\.assistantText\?\.trim\(\)\s*\|\|\s*""/);
});
