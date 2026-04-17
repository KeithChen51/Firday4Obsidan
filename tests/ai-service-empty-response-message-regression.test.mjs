/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const aiServicePath = path.join(projectRoot, "src/services/AIService.ts");

async function loadAiServiceModule() {
	return jiti.import(aiServicePath);
}

test("AIService explains empty LLM message content in Chinese", async () => {
	const mod = await loadAiServiceModule();
	const service = new mod.AIService(() => ({
		mode: "openai",
		apiUrl: "https://example.com/v1/chat/completions",
		apiKey: "test",
		extraHeaders: {},
		opencodeProviderId: "",
		model: "gpt-4.1",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	}));

	assert.throws(
		() => service.extractMessageContent({}),
		/没有可用的文本内容/,
	);
});
