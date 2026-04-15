export interface OpencodeModelOption {
	id: string;
	label: string;
}

export interface OpencodeProviderOption {
	id: string;
	name: string;
	baseURL: string;
	apiKey: string;
	headers: Record<string, string>;
	models: OpencodeModelOption[];
}

export interface OpencodeConfigSnapshot {
	sourcePath: string;
	providers: OpencodeProviderOption[];
}

interface RawProviderConfig {
	name?: unknown;
	options?: {
		baseURL?: unknown;
		baseUrl?: unknown;
		apiKey?: unknown;
		headers?: unknown;
	};
	models?: unknown;
}

interface RawOpencodeConfig {
	provider?: Record<string, RawProviderConfig>;
}

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function toHeaderMap(rawHeaders: unknown): Record<string, string> {
	if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
		return {};
	}
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		const headerName = key.trim();
		const headerValue = asTrimmedString(value);
		if (!headerName || !headerValue) {
			continue;
		}
		headers[headerName] = headerValue;
	}
	return headers;
}

function toModelOptions(rawModels: unknown): OpencodeModelOption[] {
	if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) {
		return [];
	}
	const options: OpencodeModelOption[] = [];
	for (const [modelId, modelConfig] of Object.entries(rawModels)) {
		const id = modelId.trim();
		if (!id) {
			continue;
		}
		const label =
			modelConfig && typeof modelConfig === "object"
				? asTrimmedString((modelConfig as { name?: unknown }).name) || id
				: id;
		options.push({ id, label });
	}
	return options;
}

export function parseOpencodeConfig(raw: string, sourcePath = ""): OpencodeConfigSnapshot {
	let parsed: RawOpencodeConfig;
	try {
		parsed = JSON.parse(raw) as RawOpencodeConfig;
	} catch {
		return { sourcePath, providers: [] };
	}

	if (!parsed.provider || typeof parsed.provider !== "object") {
		return { sourcePath, providers: [] };
	}

	const providers: OpencodeProviderOption[] = [];
	for (const [providerId, providerConfig] of Object.entries(parsed.provider)) {
		const id = providerId.trim();
		if (!id || !providerConfig || typeof providerConfig !== "object") {
			continue;
		}
		const options = providerConfig.options ?? {};
		providers.push({
			id,
			name: asTrimmedString(providerConfig.name) || id,
			baseURL: asTrimmedString(options.baseURL) || asTrimmedString(options.baseUrl),
			apiKey: asTrimmedString(options.apiKey),
			headers: toHeaderMap(options.headers),
			models: toModelOptions(providerConfig.models),
		});
	}

	return { sourcePath, providers };
}

export function selectOpencodeProvider(
	snapshot: OpencodeConfigSnapshot | null | undefined,
	providerId: string,
): OpencodeProviderOption | null {
	if (!snapshot || snapshot.providers.length === 0) {
		return null;
	}
	const normalizedId = providerId.trim();
	if (!normalizedId) {
		return snapshot.providers[0] ?? null;
	}
	return snapshot.providers.find((provider) => provider.id === normalizedId) ?? snapshot.providers[0] ?? null;
}
