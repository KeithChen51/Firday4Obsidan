/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const aiServicePath = path.join(projectRoot, "src/services/AIService.ts");

function readAiServiceSource() {
	return fs.readFileSync(aiServicePath, "utf8");
}

async function loadAiServiceWithRequestUrl(handler) {
	const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-ai-service-"));
	const stubPath = path.join(stubRoot, "obsidian-stub.cjs");
	const handlerKey = `__fridayAiServiceRequestUrl_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	globalThis[handlerKey] = handler;
	fs.writeFileSync(
		stubPath,
		`exports.requestUrl = async (options) => globalThis[${JSON.stringify(handlerKey)}](options);\n`,
		"utf8",
	);
	const jiti = createJiti(import.meta.url, {
		alias: { obsidian: stubPath },
		moduleCache: false,
	});
	const mod = await jiti.import(aiServicePath);
	return {
		AIService: mod.AIService,
		cleanup: () => {
			delete globalThis[handlerKey];
			fs.rmSync(stubRoot, { recursive: true, force: true });
		},
	};
}

function createSettings(overrides = {}) {
	return {
		mode: "openai",
		apiUrl: "https://gateway.example.test/v1/chat/completions",
		apiKey: "sk-testsecret123456",
		model: "gpt-4.1",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
		extraHeaders: {
			"X-Api-Key": "header-secret-123456",
		},
		...overrides,
	};
}

test("ai service uses shared llm transport policy for headers and retries", () => {
	const source = readAiServiceSource();
	assert.match(source, /buildLlmHeaders/);
	assert.match(source, /shouldRetryLlmRequest/);
	assert.match(source, /isRetryableLlmFailure/);
	assert.match(source, /await this\.delay\(/);
});

test("ai service does not silently replay stream requests on retryable transport failures", () => {
	const source = readAiServiceSource();
	assert.match(source, /if \(isRetryableLlmFailure\(error\)\)/);
});

test("ai service retry budget allows five retries after the first request", () => {
	const source = readAiServiceSource();
	assert.match(source, /MAX_RETRY_ATTEMPTS = 5/);
	assert.match(source, /return AIService\.MAX_RETRY_ATTEMPTS \+ 1/);
});

test("chatWithTools emits retry scheduled telemetry before retrying a 504", async () => {
	let calls = 0;
	const { AIService, cleanup } = await loadAiServiceWithRequestUrl(async () => {
		calls += 1;
		if (calls === 1) {
			throw new Error("504 Gateway Timeout");
		}
		return {
			json: {
				choices: [
					{
						finish_reason: "stop",
						message: { content: "done", tool_calls: [] },
					},
				],
			},
		};
	});
	try {
		const events = [];
		const service = new AIService(() => createSettings());
		service.delay = async () => {};

		await service.chatWithTools(
			[{ role: "user", content: "Use tools" }],
			[{ name: "read", description: "Read file", parameters: { type: "object" } }],
			{ onTransportEvent: (event) => events.push(event) },
		);

		assert.equal(calls, 2);
		assert.deepEqual(events.map((event) => event.type), [
			"request_started",
			"retry_scheduled",
			"retry_started",
			"request_succeeded",
		]);
		assert.equal(events[1].channel, "chat_with_tools");
		assert.equal(events[1].attempt, 1);
		assert.equal(events[1].maxAttempts, 6);
		assert.equal(events[1].delayMs, 700);
		assert.equal(events[1].httpStatus, 504);
		assert.equal(events[1].retryable, true);
		assert.equal(events[2].attempt, 2);
		assert.equal(events[2].maxAttempts, 6);
	} finally {
		cleanup();
	}
});

test("chat emits exhausted telemetry when retryable failures reach max attempts", async () => {
	let calls = 0;
	const { AIService, cleanup } = await loadAiServiceWithRequestUrl(async () => {
		calls += 1;
		throw new Error("503 temporarily unavailable from https://gateway.example.test/v1/chat/completions");
	});
	try {
		const events = [];
		const service = new AIService(() => createSettings());
		service.delay = async () => {};

		await assert.rejects(
			() => service.chat(
				[{ role: "user", content: "Prompt body must not leak" }],
				{ onTransportEvent: (event) => events.push(event) },
			),
			/503/,
		);

		assert.equal(calls, 6);
		const exhausted = events.at(-1);
		assert.equal(exhausted.type, "request_exhausted");
		assert.equal(exhausted.attempt, 6);
		assert.equal(exhausted.maxAttempts, 6);
		assert.equal(exhausted.httpStatus, 503);
		assert.equal(exhausted.retryable, false);
		const serialized = JSON.stringify(events);
		assert.doesNotMatch(serialized, /gateway\.example\.test/);
		assert.doesNotMatch(serialized, /sk-testsecret/);
		assert.doesNotMatch(serialized, /header-secret/);
		assert.doesNotMatch(serialized, /Prompt body must not leak/);
		assert.doesNotMatch(serialized, /Authorization/i);
	} finally {
		cleanup();
	}
});

test("chat emits request succeeded telemetry after a successful retry", async () => {
	let calls = 0;
	const { AIService, cleanup } = await loadAiServiceWithRequestUrl(async () => {
		calls += 1;
		if (calls === 1) {
			throw new Error("429 rate limited");
		}
		return {
			json: {
				choices: [
					{
						message: { content: "Recovered" },
					},
				],
			},
		};
	});
	try {
		const events = [];
		const service = new AIService(() => createSettings());
		service.delay = async () => {};

		const result = await service.chat(
			[{ role: "user", content: "hello" }],
			{ onTransportEvent: (event) => events.push(event) },
		);

		assert.equal(result, "Recovered");
		assert.equal(calls, 2);
		assert.equal(events.at(-1).type, "request_succeeded");
		assert.equal(events.at(-1).attempt, 2);
		assert.equal(events.at(-1).maxAttempts, 6);
		assert.equal(events.at(-1).retryable, false);
		assert.equal(new Set(events.map((event) => event.requestId)).size, 1);
	} finally {
		cleanup();
	}
});
