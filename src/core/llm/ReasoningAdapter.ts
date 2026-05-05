import type {
	ReasoningArtifact,
	ReasoningContinuationPolicy,
	ReasoningProvider,
	ReasoningRawFormat,
	ReasoningSourceProtocol,
} from "./ReasoningArtifact";

export interface NormalizeReasoningArtifactInput {
	provider?: ReasoningProvider;
	model?: string;
	sourceProtocol?: ReasoningSourceProtocol;
	body?: unknown;
	message?: unknown;
	delta?: unknown;
	responseOutput?: unknown;
}

interface ReasoningCandidate {
	rawFormat: ReasoningRawFormat;
	rawReasoning?: string;
	visibleSummary?: string;
	continuationPayload?: unknown;
	metadata?: ReasoningArtifact["metadata"];
	warnings?: string[];
}

export function normalizeReasoningArtifact(input: NormalizeReasoningArtifactInput): ReasoningArtifact {
	const provider = normalizeProvider(input.provider, input.model);
	const model = input.model?.trim() || "";
	const sourceProtocol = input.sourceProtocol ?? inferSourceProtocol(input);
	const warnings: string[] = [];
	const candidate =
		extractResponsesReasoning(input) ??
		extractAnthropicThinking(input) ??
		extractReasoningDetails(input) ??
		extractReasoningContent(input) ??
		extractReasoningField(input) ??
		extractThinkTags(input);

	if (!candidate) {
		return createEmptyArtifact(provider, model, sourceProtocol);
	}

	const continuationPolicy = resolveContinuationPolicy(provider, candidate);
	const visibleSummary = buildVisibleSummary(candidate, provider);
	const continuationPayload = resolveContinuationPayload(provider, model, candidate, continuationPolicy);
	const metadata: ReasoningArtifact["metadata"] = {
		sourceProtocol,
		...(candidate.metadata ?? {}),
	};
	const mergedWarnings = [...warnings, ...(candidate.warnings ?? [])].filter((item) => item.trim().length > 0);
	if (mergedWarnings.length > 0) {
		metadata.warnings = mergedWarnings;
	}

	return {
		hasReasoning: true,
		provider,
		model,
		rawFormat: candidate.rawFormat,
		visibleSummary,
		...(candidate.rawReasoning ? { rawReasoning: candidate.rawReasoning } : {}),
		continuationPolicy,
		...(continuationPayload !== undefined ? { continuationPayload } : {}),
		metadata,
	};
}

function createEmptyArtifact(
	provider: ReasoningProvider,
	model: string,
	sourceProtocol: ReasoningSourceProtocol,
): ReasoningArtifact {
	return {
		hasReasoning: false,
		provider,
		model,
		rawFormat: "unknown",
		visibleSummary: "",
		continuationPolicy: "drop",
		metadata: { sourceProtocol },
	};
}

function normalizeProvider(provider: ReasoningProvider | undefined, model: string | undefined): ReasoningProvider {
	if (provider) {
		return provider;
	}
	const normalizedModel = model?.toLowerCase() ?? "";
	if (normalizedModel.includes("deepseek")) {
		return "deepseek";
	}
	if (normalizedModel.includes("qwen") || normalizedModel.includes("bailian")) {
		return "bailian";
	}
	if (normalizedModel.includes("claude")) {
		return "anthropic";
	}
	if (normalizedModel.includes("gpt")) {
		return "openai";
	}
	return "unknown";
}

function inferSourceProtocol(input: NormalizeReasoningArtifactInput): ReasoningSourceProtocol {
	if (Array.isArray(input.responseOutput)) {
		return "responses";
	}
	if (input.delta) {
		return "chat_completions";
	}
	return "unknown";
}

function resolveContinuationPolicy(
	provider: ReasoningProvider,
	candidate: ReasoningCandidate,
): ReasoningContinuationPolicy {
	if (provider === "deepseek" || provider === "bailian" || provider === "dashscope" || provider === "unknown") {
		return "drop";
	}
	if (candidate.rawFormat === "responses_reasoning") {
		return "provider_managed";
	}
	if (provider === "anthropic" && (
		candidate.rawFormat === "anthropic_thinking" ||
		candidate.rawFormat === "redacted_thinking"
	)) {
		return "preserve_raw";
	}
	if (provider === "zenmux" && candidate.rawFormat === "reasoning_details") {
		return "preserve_signature_only";
	}
	if (provider === "zenmux" && candidate.rawFormat === "reasoning") {
		return "preserve_raw";
	}
	return "drop";
}

function resolveContinuationPayload(
	provider: ReasoningProvider,
	model: string,
	candidate: ReasoningCandidate,
	continuationPolicy: ReasoningContinuationPolicy,
): unknown {
	if (continuationPolicy === "drop") {
		return undefined;
	}
	if (candidate.continuationPayload !== undefined) {
		return candidate.continuationPayload;
	}
	if (
		provider === "zenmux" &&
		candidate.rawFormat === "reasoning" &&
		candidate.rawReasoning?.trim() &&
		model.toLowerCase().includes("deepseek")
	) {
		return { reasoning_content: candidate.rawReasoning };
	}
	return undefined;
}

function extractResponsesReasoning(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	const output = Array.isArray(input.responseOutput)
		? input.responseOutput
		: getArray(toRecord(input.body), "output");
	const reasoningItems = output
		.map(toRecord)
		.filter((item) => getText(item, "type") === "reasoning");
	if (reasoningItems.length === 0) {
		return null;
	}
	const summary = reasoningItems
		.map(extractReasoningSummary)
		.filter((item) => item.length > 0)
		.join("\n")
		.trim();
	const encrypted = reasoningItems.some((item) =>
		getText(item, "encrypted_content").length > 0 ||
		getText(item, "encryptedContent").length > 0
	);
	const continuationItems = reasoningItems.filter((item) =>
		getText(item, "encrypted_content").length > 0 ||
		getText(item, "encryptedContent").length > 0
	);
	return {
		rawFormat: "responses_reasoning",
		visibleSummary: summary,
		continuationPayload: continuationItems.length > 0 ? { output: continuationItems } : undefined,
		metadata: {
			encrypted,
			sourceProtocol: "responses",
		},
	};
}

function extractAnthropicThinking(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	const records = collectRecords(input);
	for (const record of records) {
		const content = getArray(record, "content");
		if (content.length === 0) {
			continue;
		}
		const blocks = content
			.map(toRecord)
			.filter((item) => {
				const type = getText(item, "type");
				return type === "thinking" || type === "redacted_thinking";
			});
		if (blocks.length === 0) {
			continue;
		}
		const hasRedacted = blocks.some((item) => getText(item, "type") === "redacted_thinking");
		const rawReasoning = blocks
			.map((item) => getText(item, "thinking") || getText(item, "text"))
			.filter((item) => item.length > 0)
			.join("\n");
		return {
			rawFormat: hasRedacted ? "redacted_thinking" : "anthropic_thinking",
			...(rawReasoning ? { rawReasoning } : {}),
			continuationPayload: { content },
			metadata: {
				redacted: hasRedacted,
				sourceProtocol: "anthropic_messages",
			},
		};
	}
	return null;
}

function extractReasoningDetails(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	for (const record of collectRecords(input)) {
		const details = getUnknown(record, "reasoning_details");
		if (details === undefined) {
			continue;
		}
		const reasoning = getText(record, "reasoning");
		return {
			rawFormat: "reasoning_details",
			...(reasoning ? { rawReasoning: reasoning } : {}),
			continuationPayload: {
				...(reasoning ? { reasoning } : {}),
				reasoning_details: details,
			},
			metadata: { sourceProtocol: "chat_completions" },
		};
	}
	return null;
}

function extractReasoningContent(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	for (const record of collectRecords(input)) {
		const reasoningContent = getText(record, "reasoning_content");
		if (!reasoningContent) {
			continue;
		}
		return {
			rawFormat: "reasoning_content",
			rawReasoning: reasoningContent,
			metadata: {
				streamed: Boolean(input.delta) || hasDeltaReasoning(input.body),
			},
		};
	}
	return null;
}

function extractReasoningField(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	for (const record of collectRecords(input)) {
		const reasoning = getText(record, "reasoning");
		if (!reasoning) {
			continue;
		}
		return {
			rawFormat: "reasoning",
			rawReasoning: reasoning,
			metadata: { sourceProtocol: "chat_completions" },
		};
	}
	return null;
}

function extractThinkTags(input: NormalizeReasoningArtifactInput): ReasoningCandidate | null {
	for (const record of collectRecords(input)) {
		const content = getText(record, "content") || getText(record, "thinking") || getText(record, "analysis");
		if (!content) {
			continue;
		}
		const match = content.match(/<think>([\s\S]*?)<\/think>/i);
		if (!match?.[1]?.trim()) {
			continue;
		}
		return {
			rawFormat: "think_tags",
			rawReasoning: match[1].trim(),
			warnings: ["Parsed non-standard think tags; raw continuation was dropped."],
		};
	}
	return null;
}

function collectRecords(input: NormalizeReasoningArtifactInput): Record<string, unknown>[] {
	const records: Record<string, unknown>[] = [];
	pushRecord(records, input.message);
	pushRecord(records, input.delta);
	const body = toRecord(input.body);
	pushRecord(records, body);
	for (const choice of getArray(body, "choices")) {
		const choiceRecord = toRecord(choice);
		pushRecord(records, getUnknown(choiceRecord, "message"));
		pushRecord(records, getUnknown(choiceRecord, "delta"));
	}
	const output = toRecord(getUnknown(body, "output"));
	for (const choice of getArray(output, "choices")) {
		const choiceRecord = toRecord(choice);
		pushRecord(records, getUnknown(choiceRecord, "message"));
		pushRecord(records, getUnknown(choiceRecord, "delta"));
	}
	return records;
}

function pushRecord(records: Record<string, unknown>[], value: unknown): void {
	const record = toRecord(value);
	if (Object.keys(record).length > 0) {
		records.push(record);
	}
}

function extractReasoningSummary(item: Record<string, unknown>): string {
	const summary = getUnknown(item, "summary");
	if (typeof summary === "string") {
		return safeVisibleText(summary, 320);
	}
	if (!Array.isArray(summary)) {
		return "";
	}
	return summary
		.map(toRecord)
		.map((entry) => getText(entry, "text") || getText(entry, "summary_text"))
		.filter((entry) => entry.length > 0)
		.map((entry) => safeVisibleText(entry, 320))
		.join("\n")
		.trim();
}

function buildVisibleSummary(candidate: ReasoningCandidate, provider: ReasoningProvider): string {
	if (candidate.visibleSummary?.trim()) {
		return safeVisibleText(candidate.visibleSummary, 240);
	}
	switch (candidate.rawFormat) {
		case "responses_reasoning":
			return "The model provided a reasoning summary.";
		case "reasoning_details":
			return provider === "zenmux"
				? "FRIDAY preserved provider reasoning signatures for the next tool turn."
				: "FRIDAY preserved provider reasoning metadata.";
		case "anthropic_thinking":
			return "FRIDAY preserved signed thinking blocks for continuation.";
		case "redacted_thinking":
			return "FRIDAY preserved redacted thinking metadata for continuation.";
		case "reasoning_content":
		case "reasoning":
		case "think_tags":
			return "FRIDAY received model reasoning and summarized it safely.";
		case "unknown":
		default:
			return "FRIDAY received model reasoning metadata.";
	}
}

function safeVisibleText(value: string, maxLength: number): string {
	const text = value
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength).trimEnd()}...`;
}

function hasDeltaReasoning(body: unknown): boolean {
	const bodyRecord = toRecord(body);
	return getArray(bodyRecord, "choices").some((choice) => {
		const delta = toRecord(getUnknown(toRecord(choice), "delta"));
		return getText(delta, "reasoning_content").length > 0;
	});
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function getUnknown(record: Record<string, unknown>, key: string): unknown {
	return record[key];
}

function getText(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}

function getArray(record: Record<string, unknown>, key: string): unknown[] {
	const value = record[key];
	return Array.isArray(value) ? value : [];
}
