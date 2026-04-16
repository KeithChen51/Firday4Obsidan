/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/llm/AgentModelCatalog.ts");

async function loadCatalog() {
	return jiti.import(modulePath);
}

test("agent model catalog includes both openai and group models when both sources are configured", async () => {
	const mod = await loadCatalog();
	const options = mod.buildAgentModelOptions(
		{
			openaiConfig: { apiUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
			groupConfig: { apiUrl: "https://gateway.example.com/v1" },
		},
		[
			{ id: "glm-5", label: "GLM-5" },
			{ id: "qwen3-max", label: "Qwen3-Max" },
		],
	);

	assert.deepEqual(
		options.map((item) => ({ value: item.value, label: item.label })),
		[
			{ value: "openai::gpt-4.1", label: "OpenAI · gpt-4.1" },
			{ value: "group::glm-5", label: "集团集采 · GLM-5" },
			{ value: "group::qwen3-max", label: "集团集采 · Qwen3-Max" },
		],
	);
});

test("agent model catalog only includes group models when openai default model is missing", async () => {
	const mod = await loadCatalog();
	const options = mod.buildAgentModelOptions(
		{
			openaiConfig: { apiUrl: "https://api.openai.com/v1", model: "" },
			groupConfig: { apiUrl: "https://gateway.example.com/v1" },
		},
		[{ id: "glm-5", label: "GLM-5" }],
	);

	assert.deepEqual(
		options.map((item) => item.value),
		["group::glm-5"],
	);
});
