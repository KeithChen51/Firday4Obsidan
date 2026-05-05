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
const reasoningAdapterPath = path.join(projectRoot, "src/core/llm/ReasoningAdapter.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

async function loadAiServiceModule() {
	return jiti.import(aiServicePath);
}

async function loadReasoningAdapterModule() {
	return jiti.import(reasoningAdapterPath);
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

test("AIService does not serialize raw reasoning_content for drop-policy providers", async () => {
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
			reasoningContent: "legacy raw reasoning must not be serialized",
			reasoningArtifact: {
				hasReasoning: true,
				provider: "deepseek",
				model: "deepseek-reasoner",
				rawFormat: "reasoning_content",
				visibleSummary: "Selected the list tool.",
				rawReasoning: "raw deepseek chain of thought",
				continuationPolicy: "drop",
				metadata: { sourceProtocol: "chat_completions" },
			},
			toolCalls: [
				{
					id: "call_123",
					name: "ls",
					args: {},
				},
			],
		},
	]);
	assert.equal("reasoning_content" in messages[0], false);
	assert.equal(JSON.stringify(messages).includes("raw deepseek chain of thought"), false);
});

test("AIService preserves ZenMux and Anthropic signature continuation payloads", async () => {
	const mod = await loadAiServiceModule();
	const { normalizeReasoningArtifact } = await loadReasoningAdapterModule();
	const service = new mod.AIService(() => ({
		mode: "openai",
		apiUrl: "https://gateway.example.com/v1/chat/completions",
		apiKey: "test",
		model: "claude-opus-4-reasoning",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	}));
	const zenmuxReasoning = "raw zenmux reasoning for provider continuation";
	const zenmuxReasoningDetails = [{ type: "reasoning.signature", signature: "sig-zenmux-history" }];
	const anthropicContent = [
		{ type: "thinking", thinking: "private thinking block", signature: "sig-anthropic-history" },
		{ type: "text", text: "Anthropic answer" },
		{ type: "tool_use", id: "toolu_history", name: "ls", input: { path: "workspace" } },
	];

	const messages = service.toOpenAIMessages([
		{
			role: "assistant",
			content: "",
			reasoningArtifact: normalizeReasoningArtifact({
				provider: "zenmux",
				model: "claude-opus-4-reasoning",
				sourceProtocol: "chat_completions",
				message: {
					content: "",
					reasoning: zenmuxReasoning,
					reasoning_details: zenmuxReasoningDetails,
				},
			}),
			toolCalls: [{ id: "call_zenmux", name: "ls", args: {} }],
		},
		{
			role: "assistant",
			content: "Anthropic answer",
			reasoningArtifact: normalizeReasoningArtifact({
				provider: "anthropic",
				model: "claude-4-sonnet",
				sourceProtocol: "anthropic_messages",
				message: {
					content: anthropicContent,
				},
			}),
		},
	]);

	assert.deepEqual(messages[0], {
		role: "assistant",
		content: "",
		tool_calls: [
			{
				id: "call_zenmux",
				type: "function",
				function: {
					name: "ls",
					arguments: "{}",
				},
			},
		],
		reasoning: zenmuxReasoning,
		reasoning_details: zenmuxReasoningDetails,
	});
	assert.deepEqual(messages[1], {
		role: "assistant",
		content: anthropicContent,
	});
	assert.equal(JSON.stringify(messages).includes("visibleSummary"), false);
});

test("AIService serializes ZenMux DeepSeek reasoning as reasoning_content for the next native tool turn", async () => {
	const mod = await loadAiServiceModule();
	const { normalizeReasoningArtifact } = await loadReasoningAdapterModule();
	const service = new mod.AIService(() => ({
		mode: "openai",
		apiUrl: "https://zenmux.ai/api/v1",
		apiKey: "test",
		model: "deepseek/deepseek-v4-pro",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	}));
	const zenmuxReasoning = "provider continuation reasoning for the tool call";

	const messages = service.toOpenAIMessages([
		{
			role: "assistant",
			content: "",
			reasoningArtifact: normalizeReasoningArtifact({
				provider: "zenmux",
				model: "deepseek/deepseek-v4-pro",
				sourceProtocol: "chat_completions",
				message: {
					content: "",
					reasoning: zenmuxReasoning,
				},
			}),
			toolCalls: [{ id: "call_zenmux_reasoning", name: "ls", args: { path: "" } }],
		},
		{
			role: "tool",
			content: "TOOL_RESULT {\"ok\":true}",
			toolCallId: "call_zenmux_reasoning",
			name: "ls",
		},
	]);

	assert.equal(messages[0].reasoning_content, zenmuxReasoning);
	assert.equal("reasoning" in messages[0], false);
	assert.equal("reasoning_details" in messages[0], false);
});

test("native runtime loop preserves structured assistant tool calls instead of synthetic calling text", async () => {
	const source = readRuntimeSource();
	assert.match(
		source,
		/const toolCalls = response\.toolCalls;\s*if \(toolCalls\.length === 0\)/,
	);
	assert.match(source, /for \(const toolCall of toolCalls\)/);
	assert.match(source, /response\.reasoningArtifact/);
	assert.doesNotMatch(source, /toolCalls:\s*\[response\.toolCall\]/);
});
