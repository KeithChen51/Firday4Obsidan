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

async function loadAiServiceModule() {
	return jiti.import(aiServicePath);
}

function readAiServiceSource() {
	return fs.readFileSync(aiServicePath, "utf8");
}

function createService() {
	return {
		mode: "openai",
		apiUrl: "https://example.com/v1/chat/completions",
		apiKey: "test",
		extraHeaders: {},
		opencodeProviderId: "",
		model: "xiaomi/mimo-v2.5",
		temperature: null,
		maxTokens: null,
		enableStreaming: false,
	};
}

test("connection probe accepts reasoning-only successful chat completion as connected", async () => {
	const mod = await loadAiServiceModule();
	const service = new mod.AIService(createService);

	const probeText = service.extractConnectionProbeText({
		choices: [
			{
				finish_reason: "length",
				message: {
					role: "assistant",
					content: "",
					reasoning: "The model spent the tiny probe budget on reasoning.",
				},
			},
		],
		usage: {
			completion_tokens: 16,
			completion_tokens_details: {
				reasoning_tokens: 15,
			},
		},
	});

	assert.equal(probeText, "");
});

test("connection probe uses an English prompt with a larger token budget", () => {
	const source = readAiServiceSource();
	const checkConnectionBlock = source.match(/async checkConnection\([^)]*\): Promise<string> \{([\s\S]*?)\n\t\}/);
	assert.ok(checkConnectionBlock, "checkConnection method should exist");
	const body = checkConnectionBlock[1] ?? "";
	assert.match(body, /Reply exactly OK\./);
	assert.match(body, /maxTokens:\s*256/);
	assert.doesNotMatch(body, /maxTokens:\s*16/);
});
