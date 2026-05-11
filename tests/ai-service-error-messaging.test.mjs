/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/services/AIService.ts");

async function loadAIService() {
	return jiti.import(modulePath);
}

test("ai service labels gateway timeout as transient network failure", async () => {
	const mod = await loadAIService();
	const service = new mod.AIService(() => ({
		mode: "group",
		apiUrl: "https://example.com/v1",
		apiKey: "secret",
		model: "glm-5",
		extraHeaders: {},
	}));
	const error = service.normalizeError(
		"504 Gateway Timeout",
		"https://example.com/v1/chat/completions",
		["https://example.com/v1/chat/completions"],
	);
	assert.match(error.message, /网关超时/);
	assert.match(error.message, /不是协议不兼容/);
});

test("ai service explains response schema incompatibility clearly", async () => {
	const mod = await loadAIService();
	const service = new mod.AIService(() => ({
		mode: "group",
		apiUrl: "https://example.com/v1",
		apiKey: "secret",
		model: "glm-5",
		extraHeaders: {},
	}));
	const error = service.normalizeError(
		"LLM response has no usable message content.",
		"https://example.com/v1/chat/completions",
		["https://example.com/v1/chat/completions"],
	);
	assert.match(error.message, /返回体字段/);
	assert.match(error.message, /不兼容/);
});

test("ai service does not append raw gateway exceptions to user-facing 5xx errors", async () => {
	const mod = await loadAIService();
	const service = new mod.AIService(() => ({
		mode: "group",
		apiUrl: "https://example.com/v1",
		apiKey: "secret",
		model: "glm-5",
		extraHeaders: {},
	}));
	const error = service.normalizeError(
		"Error: Request failed, status 503",
		"https://example.com/v1/chat/completions",
		["https://example.com/v1/chat/completions"],
	);

	assert.match(error.message, /模型服务或网关暂时不可用/);
	assert.doesNotMatch(error.message, /原始错误|Request failed/);
});
