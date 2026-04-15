/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/llm/OpencodeConfigResolver.ts");

async function loadResolver() {
	return jiti.import(modulePath);
}

const SAMPLE_CONFIG = JSON.stringify(
	{
		$schema: "https://opencode.ai/config.json",
		provider: {
			aliyun: {
				npm: "@ai-sdk/openai-compatible",
				name: "汽车售后服务事业部",
				options: {
					baseURL: "https://gateway.example.com/v1",
					apiKey: "secret-token",
					headers: {
						"X-Custom-Header": "tenant-001",
					},
				},
				models: {
					"glm-4.7": { name: "GLM-4.7" },
					"qwen3-max-2026-01-23": { name: "Qwen3-Max" },
				},
			},
		},
	},
	null,
	2,
);

test("opencode resolver extracts provider connection details and models", async () => {
	const mod = await loadResolver();
	const snapshot = mod.parseOpencodeConfig(SAMPLE_CONFIG, "C:/Users/test/.config/opencode/opencode.json");
	assert.equal(snapshot.sourcePath, "C:/Users/test/.config/opencode/opencode.json");
	assert.equal(snapshot.providers.length, 1);

	const provider = snapshot.providers[0];
	assert.equal(provider.id, "aliyun");
	assert.equal(provider.name, "汽车售后服务事业部");
	assert.equal(provider.baseURL, "https://gateway.example.com/v1");
	assert.equal(provider.apiKey, "secret-token");
	assert.deepEqual(provider.headers, { "X-Custom-Header": "tenant-001" });
	assert.deepEqual(
		provider.models.map((item) => ({ id: item.id, label: item.label })),
		[
			{ id: "glm-4.7", label: "GLM-4.7" },
			{ id: "qwen3-max-2026-01-23", label: "Qwen3-Max" },
		],
	);
});

test("opencode resolver can pick the active provider by id", async () => {
	const mod = await loadResolver();
	const snapshot = mod.parseOpencodeConfig(SAMPLE_CONFIG, "opencode.json");
	const provider = mod.selectOpencodeProvider(snapshot, "aliyun");
	assert.equal(provider?.id, "aliyun");
	assert.equal(mod.selectOpencodeProvider(snapshot, "missing"), snapshot.providers[0]);
});
