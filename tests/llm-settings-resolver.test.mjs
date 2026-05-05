/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/llm/LlmSettingsResolver.ts");

async function loadResolver() {
	return jiti.import(modulePath);
}

test("llm settings resolver preserves openai config when switching to group mode", async () => {
	const mod = await loadResolver();
	const initial = mod.normalizeLlmSettings({
		mode: "openai",
		apiUrl: "https://api.openai.com/v1",
		apiKey: "openai-key",
		model: "gpt-4o-mini",
		enableStreaming: true,
	});

	const withOpenaiEdit = mod.patchActiveLlmConfig(initial, {
		apiUrl: "https://openai-proxy.example.com/v1",
		apiKey: "openai-key-2",
		model: "gpt-4.1",
	});
	const switched = mod.switchLlmMode(
		mod.patchLlmModeConfig(withOpenaiEdit, "group", {
			apiUrl: "https://gateway.example.com/v1",
			apiKey: "group-key",
			model: "glm-5",
			opencodeProviderId: "aliyun",
		}),
		"group",
	);

	assert.equal(switched.apiUrl, "https://gateway.example.com/v1");
	assert.equal(switched.apiKey, "group-key");
	assert.equal(switched.model, "glm-5");

	const backToOpenai = mod.switchLlmMode(switched, "openai");
	assert.equal(backToOpenai.apiUrl, "https://openai-proxy.example.com/v1");
	assert.equal(backToOpenai.apiKey, "openai-key-2");
	assert.equal(backToOpenai.model, "gpt-4.1");
	assert.equal(backToOpenai.groupConfig.apiUrl, "https://gateway.example.com/v1");
});

test("llm settings resolver keeps mode-specific headers isolated", async () => {
	const mod = await loadResolver();
	const initial = mod.normalizeLlmSettings({
		mode: "group",
		apiUrl: "https://gateway.example.com/v1",
		apiKey: "group-key",
		extraHeaders: { "X-Custom-Header": "tenant-001" },
		model: "glm-5",
		enableStreaming: true,
	});

	const switched = mod.switchLlmMode(
		mod.patchLlmModeConfig(initial, "openai", {
			apiUrl: "https://api.openai.com/v1",
			apiKey: "openai-key",
			extraHeaders: {},
			model: "gpt-4o-mini",
		}),
		"openai",
	);

	assert.deepEqual(switched.extraHeaders, {});
	assert.equal(switched.openaiConfig.apiUrl, "https://api.openai.com/v1");
	assert.deepEqual(switched.groupConfig.extraHeaders, { "X-Custom-Header": "tenant-001" });
});

test("llm settings resolver normalizes reasoning config and maps provider request params", async () => {
	const mod = await loadResolver();

	const normalized = mod.normalizeLlmSettings({
		mode: "openai",
		apiUrl: "https://gateway.example.com/v1",
		apiKey: "key",
		model: "claude-opus-4-reasoning",
		reasoning: {
			enabled: true,
			effort: "medium",
			maxTokens: 2048,
			summary: "auto",
			enableThinking: true,
			thinkingBudget: 4096,
			showRawInDebug: true,
		},
	});

	assert.deepEqual(normalized.reasoning, {
		enabled: true,
		effort: "medium",
		maxTokens: 2048,
		summary: "auto",
		enableThinking: true,
		thinkingBudget: 4096,
		showRawInDebug: true,
	});
	assert.deepEqual(
		mod.resolveReasoningRequestParams(normalized, { provider: "zenmux", sourceProtocol: "chat_completions" }),
		{ reasoning_effort: "medium" },
	);
	assert.deepEqual(
		mod.resolveReasoningRequestParams(normalized, { provider: "openai", sourceProtocol: "responses" }),
		{ reasoning: { effort: "medium", summary: "auto" } },
	);
	assert.deepEqual(
		mod.resolveReasoningRequestParams(normalized, { provider: "bailian", sourceProtocol: "dashscope" }),
		{ enable_thinking: true, thinking_budget: 4096 },
	);
	assert.deepEqual(
		mod.resolveReasoningRequestParams(normalized, { provider: "anthropic", sourceProtocol: "anthropic_messages" }),
		{ thinking: { type: "enabled", budget_tokens: 2048 } },
	);
	assert.deepEqual(
		mod.resolveReasoningRequestParams(normalized, { provider: "unknown", sourceProtocol: "chat_completions" }),
		{},
	);
});
