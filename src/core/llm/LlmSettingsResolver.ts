import type { FridaySettings, LlmModeConfig } from "../../types/settings";

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
		typeof input.enableStreaming === "boolean",
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
