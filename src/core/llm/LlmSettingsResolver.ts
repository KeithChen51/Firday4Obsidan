import type { FridaySettings, LlmModeConfig, LlmReasoningSettings } from "../../types/settings";
import type { ReasoningProvider, ReasoningSourceProtocol } from "./ReasoningArtifact";

type LlmSettings = FridaySettings["llm"];
type LlmMode = LlmSettings["mode"];
type PartialModeConfig = Partial<LlmModeConfig>;

function createDefaultModeConfig(): LlmModeConfig {
	return {
		apiUrl: "",
		apiKey: "",
		extraHeaders: {},
		opencodeProviderId: "",
		model: "",
		temperature: null,
		maxTokens: null,
		enableStreaming: true,
		reasoning: createDefaultReasoningSettings(),
	};
}

function createDefaultReasoningSettings(): LlmReasoningSettings {
	return {
		enabled: false,
		effort: "",
		maxTokens: null,
		summary: "auto",
		enableThinking: false,
		thinkingBudget: null,
		showRawInDebug: false,
	};
}

function normalizeHeaders(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		const headerName = key.trim();
		const headerValue = typeof value === "string" ? value.trim() : "";
		if (!headerName || !headerValue) {
			continue;
		}
		headers[headerName] = headerValue;
	}
	return headers;
}

function normalizeNullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNullablePositiveInt(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function normalizeReasoningSettings(input?: Partial<LlmReasoningSettings> | null): LlmReasoningSettings {
	const defaults = createDefaultReasoningSettings();
	const effort = input?.effort;
	const summary = input?.summary;
	return {
		enabled: typeof input?.enabled === "boolean" ? input.enabled : defaults.enabled,
		effort: effort === "minimal" || effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh"
			? effort
			: defaults.effort,
		maxTokens: normalizeNullablePositiveInt(input?.maxTokens),
		summary: summary === "auto" || summary === "concise" || summary === "detailed" || summary === "none"
			? summary
			: defaults.summary,
		enableThinking: typeof input?.enableThinking === "boolean" ? input.enableThinking : defaults.enableThinking,
		thinkingBudget: normalizeNullablePositiveInt(input?.thinkingBudget),
		showRawInDebug: typeof input?.showRawInDebug === "boolean" ? input.showRawInDebug : defaults.showRawInDebug,
	};
}

function normalizeModeConfig(input?: PartialModeConfig | null): LlmModeConfig {
	const defaults = createDefaultModeConfig();
	return {
		apiUrl: typeof input?.apiUrl === "string" ? input.apiUrl.trim() : defaults.apiUrl,
		apiKey: typeof input?.apiKey === "string" ? input.apiKey.trim() : defaults.apiKey,
		extraHeaders: normalizeHeaders(input?.extraHeaders),
		opencodeProviderId:
			typeof input?.opencodeProviderId === "string" ? input.opencodeProviderId.trim() : defaults.opencodeProviderId,
		model: typeof input?.model === "string" ? input.model.trim() : defaults.model,
		temperature: normalizeNullableNumber(input?.temperature),
		maxTokens: normalizeNullableNumber(input?.maxTokens),
		enableStreaming: typeof input?.enableStreaming === "boolean" ? input.enableStreaming : defaults.enableStreaming,
		reasoning: normalizeReasoningSettings(input?.reasoning),
	};
}

function hasMeaningfulModeConfig(input?: PartialModeConfig | null): boolean {
	if (!input) {
		return false;
	}
	return Boolean(
		input.apiUrl ||
		input.apiKey ||
		input.model ||
		input.opencodeProviderId ||
		(input.extraHeaders && Object.keys(input.extraHeaders).length > 0) ||
		typeof input.temperature === "number" ||
		typeof input.maxTokens === "number" ||
		typeof input.enableStreaming === "boolean" ||
		Boolean(input.reasoning),
	);
}

function getModeKey(mode: LlmMode): "openaiConfig" | "groupConfig" {
	return mode === "group" ? "groupConfig" : "openaiConfig";
}

function toCurrentRootConfig(input?: Partial<LlmSettings> | null): PartialModeConfig {
	return {
		apiUrl: input?.apiUrl,
		apiKey: input?.apiKey,
		extraHeaders: input?.extraHeaders,
		opencodeProviderId: input?.opencodeProviderId,
		model: input?.model,
		temperature: input?.temperature,
		maxTokens: input?.maxTokens,
		enableStreaming: input?.enableStreaming,
		reasoning: input?.reasoning,
	};
}

export function normalizeLlmSettings(input?: Partial<LlmSettings> | null): LlmSettings {
	const mode: LlmMode = input?.mode === "group" ? "group" : "openai";
	let openaiConfig = normalizeModeConfig(input?.openaiConfig);
	let groupConfig = normalizeModeConfig(input?.groupConfig);
	const currentRootConfig = normalizeModeConfig(toCurrentRootConfig(input));

	if (!hasMeaningfulModeConfig(input?.openaiConfig) && mode === "openai") {
		openaiConfig = currentRootConfig;
	}
	if (!hasMeaningfulModeConfig(input?.groupConfig) && mode === "group") {
		groupConfig = currentRootConfig;
	}

	const activeConfig = mode === "group" ? groupConfig : openaiConfig;
	return {
		mode,
		...activeConfig,
		openaiConfig,
		groupConfig,
	};
}

export function readModeConfig(settings: LlmSettings, mode: LlmMode): LlmModeConfig {
	return normalizeModeConfig(settings[getModeKey(mode)]);
}

export function patchLlmModeConfig(
	settings: LlmSettings,
	mode: LlmMode,
	patch: PartialModeConfig,
): LlmSettings {
	const normalized = normalizeLlmSettings(settings);
	const key = getModeKey(mode);
	const nextConfig = normalizeModeConfig({
		...normalized[key],
		...patch,
	});
	const nextSettings: LlmSettings = {
		...normalized,
		[key]: nextConfig,
	};
	if (normalized.mode === mode) {
		return {
			...nextSettings,
			...nextConfig,
		};
	}
	return nextSettings;
}

export function patchActiveLlmConfig(settings: LlmSettings, patch: PartialModeConfig): LlmSettings {
	return patchLlmModeConfig(settings, settings.mode, patch);
}

export function switchLlmMode(settings: LlmSettings, mode: LlmMode): LlmSettings {
	const normalized = normalizeLlmSettings(settings);
	const nextConfig = readModeConfig(normalized, mode);
	return {
		...normalized,
		mode,
		...nextConfig,
	};
}

export function resolveReasoningRequestParams(
	settings: Pick<LlmModeConfig, "reasoning">,
	options: { provider: ReasoningProvider; sourceProtocol?: ReasoningSourceProtocol },
): Record<string, unknown> {
	const reasoning = normalizeReasoningSettings(settings.reasoning);
	if (!reasoning.enabled) {
		return {};
	}
	const effort = reasoning.effort || undefined;
	const summary = reasoning.summary && reasoning.summary !== "none" ? reasoning.summary : undefined;
	if (options.provider === "zenmux") {
		if (options.sourceProtocol === "responses") {
			return { reasoning: compactRecord({ effort, summary }) };
		}
		return effort ? { reasoning_effort: effort } : { reasoning: { enabled: true } };
	}
	if (options.provider === "openai" && options.sourceProtocol === "responses") {
		return { reasoning: compactRecord({ effort, summary }) };
	}
	if (options.provider === "bailian" || options.provider === "dashscope") {
		return compactRecord({
			enable_thinking: reasoning.enableThinking || reasoning.enabled,
			thinking_budget: reasoning.thinkingBudget ?? undefined,
		});
	}
	if (options.provider === "anthropic") {
		return {
			thinking: compactRecord({
				type: "enabled",
				budget_tokens: reasoning.maxTokens ?? reasoning.thinkingBudget ?? undefined,
			}),
		};
	}
	return {};
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined && value !== null && value !== "") {
			output[key] = value;
		}
	}
	return output;
}
