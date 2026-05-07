import type { ToolCall } from "../../types/tools";

export interface NormalizedToolInvocation {
	tool: string;
	normalizedArgs: Record<string, unknown>;
	canonicalArgs: string;
	identity: string;
}

export function normalizeToolInvocation(tool: Pick<ToolCall, "name" | "args">): NormalizedToolInvocation {
	const normalizedArgs = normalizeRecord(tool.args ?? {});
	const canonicalArgs = JSON.stringify(normalizedArgs);
	return {
		tool: tool.name,
		normalizedArgs,
		canonicalArgs,
		identity: `${tool.name}:${canonicalArgs}`,
	};
}

function normalizeRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return normalizePlainObject(value as Record<string, unknown>);
}

function normalizeValue(value: unknown): unknown {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map((item) => {
			const normalized = normalizeValue(item);
			return normalized === undefined ? null : normalized;
		});
	}
	if (value && typeof value === "object") {
		return normalizePlainObject(value as Record<string, unknown>);
	}
	return value;
}

function normalizePlainObject(value: Record<string, unknown>): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		const normalized = normalizeValue(value[key]);
		if (normalized !== undefined) {
			output[key] = normalized;
		}
	}
	return output;
}
