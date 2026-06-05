import type {
	AgentOptions,
	StreamFn,
	ThinkingLevel as PiAgentThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
	getModel,
	streamSimple,
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { FridaySettings, LlmModeConfig, LlmReasoningSettings } from "../../../types/settings";
import { normalizeLlmSettings, readModeConfig } from "../../llm/LlmSettingsResolver";
import { buildLlmHeaders } from "../../llm/LlmTransportPolicy";

export const FRIDAY_PI_EMPTY_API_KEY = "friday-api-key-not-required";

type FridayPiStreamFn = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => unknown;

export interface BuildFridayPiAgentOptionsInput {
	llm: FridaySettings["llm"];
	systemPrompt?: string;
	sessionId?: string;
	modelOverride?: string;
	streamFn?: FridayPiStreamFn;
}

interface FridayPiEndpoint {
	baseUrl: string;
	api?: Api;
}

const DEFAULT_CUSTOM_CONTEXT_WINDOW = 128_000;
const DEFAULT_CUSTOM_MAX_TOKENS = 8_192;
const DEFAULT_PROVIDER_ID = "openai";

export function buildFridayPiAgentOptions(input: BuildFridayPiAgentOptionsInput): AgentOptions {
	const normalizedLlm = normalizeLlmSettings(input.llm);
	const config = readModeConfig(normalizedLlm, normalizedLlm.mode);
	const modelId = (input.modelOverride?.trim() || config.model).trim();
	const endpoint = normalizeFridayPiEndpoint(config.apiUrl);

	if (!endpoint.baseUrl || !modelId) {
		throw new Error("Real PI SDK runtime needs an API URL and model before it can start.");
	}

	const providerId = resolveProviderId(normalizedLlm.mode, config);
	const model = resolveFridayPiModel({
		providerId,
		modelId,
		endpoint,
		config,
	});
	const thinkingLevel = resolveThinkingLevel(model, config.reasoning);
	const thinkingBudgets = buildThinkingBudgets(config.reasoning);
	const streamFn = buildFridayPiStreamFn(input.streamFn, config);
	const apiKey = config.apiKey.trim() || FRIDAY_PI_EMPTY_API_KEY;

	return {
		initialState: {
			model,
			systemPrompt: input.systemPrompt ?? "",
			thinkingLevel,
		},
		getApiKey: () => apiKey,
		streamFn,
		toolExecution: "parallel",
		...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
		...(thinkingBudgets ? { thinkingBudgets } : {}),
	};
}

function resolveProviderId(mode: FridaySettings["llm"]["mode"], config: LlmModeConfig): string {
	if (mode === "group" && config.opencodeProviderId.trim()) {
		return config.opencodeProviderId.trim();
	}
	return DEFAULT_PROVIDER_ID;
}

function resolveFridayPiModel(input: {
	providerId: string;
	modelId: string;
	endpoint: FridayPiEndpoint;
	config: LlmModeConfig;
}): Model<Api> {
	const catalogModel = readPiCatalogModel(input.providerId, input.modelId);
	if (catalogModel) {
		return {
			...catalogModel,
			api: input.endpoint.api ?? catalogModel.api,
			baseUrl: input.endpoint.baseUrl,
		};
	}
	return {
		id: input.modelId,
		name: input.modelId,
		api: input.endpoint.api ?? "openai-completions",
		provider: input.providerId,
		baseUrl: input.endpoint.baseUrl,
		reasoning: input.config.reasoning.enabled,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: DEFAULT_CUSTOM_CONTEXT_WINDOW,
		maxTokens: normalizePositiveInteger(input.config.maxTokens) ?? DEFAULT_CUSTOM_MAX_TOKENS,
	};
}

function readPiCatalogModel(providerId: string, modelId: string): Model<Api> | undefined {
	try {
		const lookup = getModel as unknown as (provider: string, id: string) => Model<Api> | undefined;
		return lookup(providerId, modelId);
	} catch {
		return undefined;
	}
}

function normalizeFridayPiEndpoint(rawApiUrl: string): FridayPiEndpoint {
	const raw = rawApiUrl.trim();
	if (!raw) {
		return { baseUrl: "" };
	}
	const withoutTrailingSlash = raw.replace(/\/+$/, "");
	const chatBase = withoutTrailingSlash.replace(/\/chat\/completions$/i, "");
	if (chatBase !== withoutTrailingSlash) {
		return { baseUrl: chatBase, api: "openai-completions" };
	}
	const responsesBase = withoutTrailingSlash.replace(/\/responses$/i, "");
	if (responsesBase !== withoutTrailingSlash) {
		return { baseUrl: responsesBase, api: "openai-responses" };
	}
	return { baseUrl: normalizeRootApiUrl(withoutTrailingSlash) };
}

function normalizeRootApiUrl(rawApiUrl: string): string {
	try {
		const url = new URL(rawApiUrl);
		const pathName = url.pathname.replace(/\/+$/, "");
		if (!pathName) {
			url.pathname = "/v1";
			url.search = "";
			url.hash = "";
			return url.toString().replace(/\/+$/, "");
		}
	} catch {
		return rawApiUrl;
	}
	return rawApiUrl;
}

function resolveThinkingLevel(model: Model<Api>, reasoning: LlmReasoningSettings): PiAgentThinkingLevel {
	if (!reasoning.enabled || !model.reasoning) {
		return "off";
	}
	return reasoning.effort || "medium";
}

function buildThinkingBudgets(reasoning: LlmReasoningSettings): AgentOptions["thinkingBudgets"] | undefined {
	if (!reasoning.enabled) {
		return undefined;
	}
	const budget = normalizePositiveInteger(reasoning.thinkingBudget) ?? normalizePositiveInteger(reasoning.maxTokens);
	if (!budget) {
		return undefined;
	}
	const level = reasoning.effort || "medium";
	if (level === "xhigh") {
		return undefined;
	}
	return { [level]: budget };
}

function buildFridayPiStreamFn(streamFn: FridayPiStreamFn | undefined, config: LlmModeConfig): StreamFn {
	const baseStreamFn = streamFn ?? streamSimple;
	const fridayHeaders = buildLlmHeaders(config.apiKey, config.extraHeaders);
	return ((model: Model<Api>, context: Context, options: SimpleStreamOptions = {}) => {
		const nextOptions: SimpleStreamOptions = {
			...options,
			...(config.temperature !== null ? { temperature: config.temperature } : {}),
			...(config.maxTokens !== null ? { maxTokens: config.maxTokens } : {}),
			headers: mergeHeaders(fridayHeaders, options.headers),
		};
		return baseStreamFn(model, context, nextOptions);
	}) as StreamFn;
}

function mergeHeaders(
	baseHeaders: Record<string, string>,
	overrideHeaders: Record<string, string> | undefined,
): Record<string, string> {
	return {
		...baseHeaders,
		...(overrideHeaders ?? {}),
	};
}

function normalizePositiveInteger(value: number | null): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}
