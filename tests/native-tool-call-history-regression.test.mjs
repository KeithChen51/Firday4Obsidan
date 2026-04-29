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

test("AIService extracts every native tool call from one assistant message", async () => {
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

	assert.equal(typeof service.extractToolCalls, "function");
	const toolCalls = service.extractToolCalls({
		choices: [
			{
				message: {
					tool_calls: [
						{
							id: "call_ls",
							type: "function",
							function: {
								name: "ls",
								arguments: "{\"path\":\"workspace\"}",
							},
						},
						{
							id: "call_grep",
							type: "function",
							function: {
								name: "grep",
								arguments: "{\"pattern\":\"TODO\",\"path\":\"workspace\"}",
							},
						},
					],
				},
			},
		],
	});

	assert.deepEqual(toolCalls, [
		{
			id: "call_ls",
			name: "ls",
			args: { path: "workspace" },
		},
		{
			id: "call_grep",
			name: "grep",
			args: { pattern: "TODO", path: "workspace" },
		},
	]);
});

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

test("AIService preserves reasoning content when serializing assistant tool call history", async () => {
	const mod = await loadAiServiceModule();
	const service = new mod.AIService(() => ({
		mode: "openai",
		apiUrl: "https://example.com/v1/chat/completions",
		apiKey: "test",
		model: "deepseek/deepseek-v4-pro-free",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	}));
	const messages = service.toOpenAIMessages([
		{
			role: "assistant",
			content: "",
			reasoningContent: "The model selected ls because the user asked about workspace contents.",
			toolCalls: [
				{
					id: "call_123",
					name: "ls",
					args: {},
				},
			],
		},
	]);
	assert.equal(
		messages[0].reasoning_content,
		"The model selected ls because the user asked about workspace contents.",
	);
});

test("native runtime loop preserves structured assistant tool calls instead of synthetic calling text", async () => {
	const source = readRuntimeSource();
	assert.match(
		source,
		/const toolCalls = response\.toolCalls;\s*if \(toolCalls\.length === 0\)/,
	);
	assert.match(source, /for \(const toolCall of toolCalls\)/);
	assert.match(source, /toolCalls,\s*reasoningContent:\s*response\.reasoningContent/);
	assert.doesNotMatch(source, /toolCalls:\s*\[response\.toolCall\]/);
});
