/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const optionsPath = path.join(projectRoot, "src/core/agent-kernel/pi/FridayPiAgentOptions.ts");
const settingsPath = path.join(projectRoot, "src/types/settings.ts");

async function createLlmConfig(patch) {
	const { DEFAULT_SETTINGS } = await jiti.import(settingsPath);
	return {
		...DEFAULT_SETTINGS.llm,
		...patch,
		openaiConfig: {
			...DEFAULT_SETTINGS.llm.openaiConfig,
			...(patch.openaiConfig ?? {}),
		},
		groupConfig: {
			...DEFAULT_SETTINGS.llm.groupConfig,
			...(patch.groupConfig ?? {}),
		},
	};
}

test("Friday PI agent options map active OpenAI settings into a PI catalog model", async () => {
	const { buildFridayPiAgentOptions } = await jiti.import(optionsPath);
	const observedCalls = [];
	const llm = await createLlmConfig({
		mode: "openai",
		openaiConfig: {
			apiUrl: "https://proxy.example.com/v1",
			apiKey: "sk-openai",
			extraHeaders: { "X-Friday-Tenant": "workspace-1" },
			model: "gpt-5.1",
			temperature: 0.2,
			maxTokens: 4096,
			reasoning: {
				enabled: true,
				effort: "medium",
				maxTokens: null,
				summary: "auto",
				enableThinking: false,
				thinkingBudget: 2048,
				showRawInDebug: false,
			},
		},
	});

	const agentOptions = buildFridayPiAgentOptions({
		llm,
		systemPrompt: "FRIDAY system prompt",
		sessionId: "conversation-1",
		streamFn: (model, context, options) => {
			observedCalls.push({ model, context, options });
			return "stream-result";
		},
	});

	assert.equal(agentOptions.initialState.systemPrompt, "FRIDAY system prompt");
	assert.equal(agentOptions.initialState.model.id, "gpt-5.1");
	assert.equal(agentOptions.initialState.model.api, "openai-responses");
	assert.equal(agentOptions.initialState.model.provider, "openai");
	assert.equal(agentOptions.initialState.model.baseUrl, "https://proxy.example.com/v1");
	assert.equal(agentOptions.initialState.thinkingLevel, "medium");
	assert.deepEqual(agentOptions.thinkingBudgets, { medium: 2048 });
	assert.equal(agentOptions.sessionId, "conversation-1");
	assert.equal(await agentOptions.getApiKey("openai"), "sk-openai");

	const streamResult = agentOptions.streamFn(agentOptions.initialState.model, { systemPrompt: "", messages: [], tools: [] }, {});
	assert.equal(streamResult, "stream-result");
	assert.equal(observedCalls.length, 1);
	assert.equal(observedCalls[0].options.temperature, 0.2);
	assert.equal(observedCalls[0].options.maxTokens, 4096);
	assert.equal(observedCalls[0].options.headers.Authorization, "Bearer sk-openai");
	assert.equal(observedCalls[0].options.headers["X-Friday-Tenant"], "workspace-1");
});

test("Friday PI agent options normalize full chat completion endpoints for custom gateways", async () => {
	const { buildFridayPiAgentOptions, FRIDAY_PI_EMPTY_API_KEY } = await jiti.import(optionsPath);
	const llm = await createLlmConfig({
		mode: "group",
		groupConfig: {
			apiUrl: "https://gateway.example.com/openai/v1/chat/completions",
			apiKey: "",
			extraHeaders: { Authorization: "Bearer gateway-token" },
			opencodeProviderId: "",
			model: "custom-agent-model",
			temperature: null,
			maxTokens: null,
		},
	});

	const agentOptions = buildFridayPiAgentOptions({ llm });

	assert.equal(agentOptions.initialState.model.id, "custom-agent-model");
	assert.equal(agentOptions.initialState.model.api, "openai-completions");
	assert.equal(agentOptions.initialState.model.provider, "openai");
	assert.equal(agentOptions.initialState.model.baseUrl, "https://gateway.example.com/openai/v1");
	assert.equal(agentOptions.initialState.thinkingLevel, "off");
	assert.equal(await agentOptions.getApiKey("openai"), FRIDAY_PI_EMPTY_API_KEY);

	const observedCalls = [];
	const withStream = buildFridayPiAgentOptions({
		llm,
		streamFn: (model, context, options) => {
			observedCalls.push(options);
			return "stream-result";
		},
	});
	withStream.streamFn(withStream.initialState.model, { systemPrompt: "", messages: [], tools: [] }, {});
	assert.equal(observedCalls[0].headers.Authorization, "Bearer gateway-token");
});

test("Friday PI agent options reuse a PI provider catalog model when the group provider is known", async () => {
	const { buildFridayPiAgentOptions } = await jiti.import(optionsPath);
	const llm = await createLlmConfig({
		mode: "group",
		groupConfig: {
			apiUrl: "https://opencode.ai/zen/v1",
			apiKey: "opencode-key",
			opencodeProviderId: "opencode",
			model: "big-pickle",
		},
	});

	const agentOptions = buildFridayPiAgentOptions({ llm });

	assert.equal(agentOptions.initialState.model.id, "big-pickle");
	assert.equal(agentOptions.initialState.model.provider, "opencode");
	assert.equal(agentOptions.initialState.model.api, "openai-completions");
	assert.equal(agentOptions.initialState.model.baseUrl, "https://opencode.ai/zen/v1");
	assert.equal(await agentOptions.getApiKey("opencode"), "opencode-key");
});

test("Friday PI agent options fail early when active LLM settings cannot run PI", async () => {
	const { buildFridayPiAgentOptions } = await jiti.import(optionsPath);
	const llm = await createLlmConfig({
		mode: "openai",
		openaiConfig: {
			apiUrl: "",
			model: "",
		},
	});

	assert.throws(
		() => buildFridayPiAgentOptions({ llm }),
		/Real PI SDK runtime needs an API URL and model/,
	);
});
