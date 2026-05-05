/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const adapterPath = path.join(projectRoot, "src/core/llm/ReasoningAdapter.ts");

async function loadAdapter() {
	return jiti.import(adapterPath);
}

test("ReasoningAdapter normalizes DeepSeek reasoning_content and drops continuation", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();
	const rawReasoning = "raw deepseek chain of thought that must not be sent back";

	const artifact = normalizeReasoningArtifact({
		provider: "deepseek",
		model: "deepseek-reasoner",
		sourceProtocol: "chat_completions",
		body: {
			choices: [
				{
					message: {
						content: "final answer",
						reasoning_content: rawReasoning,
					},
				},
			],
		},
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "deepseek");
	assert.equal(artifact.rawFormat, "reasoning_content");
	assert.equal(artifact.continuationPolicy, "drop");
	assert.equal(artifact.continuationPayload, undefined);
	assert.equal(artifact.rawReasoning, rawReasoning);
	assert.ok(artifact.visibleSummary.length > 0);
	assert.notEqual(artifact.visibleSummary, rawReasoning);
});

test("ReasoningAdapter keeps ZenMux reasoning_details signature for continuation", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();
	const rawReasoning = "raw zenmux reasoning must not be rendered";
	const reasoningDetails = [
		{
			type: "reasoning.signature",
			signature: "sig-zenmux-1",
			index: 0,
		},
	];

	const artifact = normalizeReasoningArtifact({
		provider: "zenmux",
		model: "claude-opus-4-reasoning",
		sourceProtocol: "chat_completions",
		message: {
			content: "I will inspect the workspace.",
			reasoning: rawReasoning,
			reasoning_details: reasoningDetails,
		},
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "zenmux");
	assert.equal(artifact.rawFormat, "reasoning_details");
	assert.equal(artifact.continuationPolicy, "preserve_signature_only");
	assert.deepEqual(artifact.continuationPayload, {
		reasoning: rawReasoning,
		reasoning_details: reasoningDetails,
	});
	assert.doesNotMatch(artifact.visibleSummary, /raw zenmux reasoning/);
});

test("ReasoningAdapter normalizes Bailian streaming reasoning delta and drops continuation", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();

	const artifact = normalizeReasoningArtifact({
		provider: "bailian",
		model: "qwen3-max",
		sourceProtocol: "dashscope",
		delta: {
			reasoning_content: "bailian streaming thought chunk",
		},
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "bailian");
	assert.equal(artifact.rawFormat, "reasoning_content");
	assert.equal(artifact.continuationPolicy, "drop");
	assert.equal(artifact.metadata.streamed, true);
});

test("ReasoningAdapter preserves Anthropic thinking signature continuation", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();
	const content = [
		{
			type: "thinking",
			thinking: "anthropic private thinking block",
			signature: "sig-anthropic-1",
		},
		{
			type: "text",
			text: "answer",
		},
		{
			type: "tool_use",
			id: "toolu_1",
			name: "read_file",
			input: { path: "workspace/FRIDAY.md" },
		},
	];

	const artifact = normalizeReasoningArtifact({
		provider: "anthropic",
		model: "claude-4-sonnet",
		sourceProtocol: "anthropic_messages",
		message: {
			content,
		},
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "anthropic");
	assert.equal(artifact.rawFormat, "anthropic_thinking");
	assert.equal(artifact.continuationPolicy, "preserve_raw");
	assert.deepEqual(artifact.continuationPayload, { content });
	assert.doesNotMatch(artifact.visibleSummary, /anthropic private thinking block/);
});

test("ReasoningAdapter uses OpenAI Responses reasoning summary without raw CoT", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();

	const artifact = normalizeReasoningArtifact({
		provider: "openai",
		model: "gpt-5.1",
		sourceProtocol: "responses",
		responseOutput: [
			{
				type: "reasoning",
				summary: [
					{
						type: "summary_text",
						text: "Checked the request, then selected the smallest implementation path.",
					},
				],
				encrypted_content: "encrypted-state",
			},
		],
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "openai");
	assert.equal(artifact.rawFormat, "responses_reasoning");
	assert.equal(artifact.continuationPolicy, "provider_managed");
	assert.equal(artifact.visibleSummary, "Checked the request, then selected the smallest implementation path.");
	assert.equal(artifact.rawReasoning, undefined);
	assert.equal(artifact.metadata.encrypted, true);
});

test("ReasoningAdapter handles unknown providers without throwing and defaults to drop", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();

	const artifact = normalizeReasoningArtifact({
		provider: "unknown",
		model: "local-reasoner",
		message: {
			content: "<think>private local reasoning</think>Final answer.",
		},
	});

	assert.equal(artifact.hasReasoning, true);
	assert.equal(artifact.provider, "unknown");
	assert.equal(artifact.rawFormat, "think_tags");
	assert.equal(artifact.continuationPolicy, "drop");
	assert.equal(artifact.continuationPayload, undefined);
	assert.doesNotMatch(artifact.visibleSummary, /private local reasoning/);
});

test("ReasoningAdapter returns an empty artifact for non-reasoning responses", async () => {
	const { normalizeReasoningArtifact } = await loadAdapter();

	const artifact = normalizeReasoningArtifact({
		provider: "openai",
		model: "gpt-4o-mini",
		message: {
			content: "plain answer",
		},
	});

	assert.equal(artifact.hasReasoning, false);
	assert.equal(artifact.provider, "openai");
	assert.equal(artifact.rawFormat, "unknown");
	assert.equal(artifact.visibleSummary, "");
	assert.equal(artifact.continuationPolicy, "drop");
});
