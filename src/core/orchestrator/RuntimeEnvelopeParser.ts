export interface ParsedRuntimeToolCall {
	name: string;
	args?: Record<string, unknown>;
}

export interface ParsedRuntimeMutationPlan {
	id?: string;
	operation?: string;
	targetPath?: string;
	summary?: string;
	status?: string;
	source?: string;
}

export interface ParsedRuntimeEnvelope {
	type?: string;
	assistant?: string;
	tool?: ParsedRuntimeToolCall;
	mutations?: ParsedRuntimeMutationPlan[];
	pendingMutations?: ParsedRuntimeMutationPlan[];
}

export function parseRuntimeEnvelopeText(raw: string, codeFence = "friday-runtime"): ParsedRuntimeEnvelope | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}
	const jsonPayload = extractFencedPayload(trimmed, codeFence);
	const objectText = extractJsonObject(jsonPayload);
	if (!objectText) {
		return null;
	}
	try {
		const parsed = JSON.parse(objectText) as ParsedRuntimeEnvelope;
		return normalizeParsedEnvelope(parsed);
	} catch {
		return parseLooseRuntimeEnvelope(objectText);
	}
}

export function extractRuntimeAssistantText(raw: string, codeFence = "friday-runtime"): string {
	const parsed = parseRuntimeEnvelopeText(raw, codeFence);
	return typeof parsed?.assistant === "string" ? parsed.assistant.trim() : "";
}

function normalizeParsedEnvelope(parsed: ParsedRuntimeEnvelope | null): ParsedRuntimeEnvelope | null {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	return parsed;
}

function extractFencedPayload(raw: string, codeFence: string): string {
	const fencedMatch = raw.match(new RegExp("```" + codeFence + "\\s*([\\s\\S]*?)```", "i"));
	return fencedMatch?.[1]?.trim() ?? raw;
}

function parseLooseRuntimeEnvelope(raw: string): ParsedRuntimeEnvelope | null {
	const type = extractLooseQuotedField(raw, "type")?.trim();
	if (!type) {
		return null;
	}
	const assistant = extractLooseQuotedField(raw, "assistant") ?? undefined;
	if (type === "response") {
		return { type, assistant };
	}
	if (type === "tool_call") {
		const toolObject = extractObjectField(raw, "tool");
		const tool = toolObject ? parseLooseToolObject(toolObject) : undefined;
		return tool?.name ? { type, assistant, tool } : null;
	}
	return assistant ? { type, assistant } : { type };
}

function parseLooseToolObject(raw: string): ParsedRuntimeToolCall | undefined {
	try {
		const parsed = JSON.parse(raw) as ParsedRuntimeToolCall;
		return parsed && typeof parsed.name === "string" ? parsed : undefined;
	} catch {
		const name = extractLooseQuotedField(raw, "name")?.trim() ?? "";
		const argsText = extractObjectField(raw, "args");
		let args: Record<string, unknown> | undefined;
		if (argsText) {
			try {
				const parsedArgs = JSON.parse(argsText) as Record<string, unknown>;
				if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
					args = parsedArgs;
				}
			} catch {
				args = undefined;
			}
		}
		return name ? { name, args } : undefined;
	}
}

function extractLooseQuotedField(raw: string, key: string): string | null {
	const keyIndex = raw.indexOf(`"${key}"`);
	if (keyIndex < 0) {
		return null;
	}
	let index = raw.indexOf(":", keyIndex + key.length + 2);
	if (index < 0) {
		return null;
	}
	index += 1;
	while (index < raw.length && /\s/.test(raw[index]!)) {
		index += 1;
	}
	if (raw[index] !== "\"") {
		return null;
	}
	index += 1;
	let buffer = "";
	while (index < raw.length) {
		const current = raw[index]!;
		if (current === "\\") {
			const decoded = decodeLooseEscape(raw, index);
			buffer += decoded.value;
			index = decoded.nextIndex;
			continue;
		}
		if (current === "\"") {
			const tail = raw.slice(index + 1).trimStart();
			if (tail.startsWith(",") || tail.startsWith("}")) {
				return buffer;
			}
		}
		buffer += current;
		index += 1;
	}
	return buffer || null;
}

function decodeLooseEscape(raw: string, slashIndex: number): { value: string; nextIndex: number } {
	const nextChar = raw[slashIndex + 1];
	if (!nextChar) {
		return { value: "\\", nextIndex: slashIndex + 1 };
	}
	if (nextChar === "n") {
		return { value: "\n", nextIndex: slashIndex + 2 };
	}
	if (nextChar === "r") {
		return { value: "\r", nextIndex: slashIndex + 2 };
	}
	if (nextChar === "t") {
		return { value: "\t", nextIndex: slashIndex + 2 };
	}
	if (nextChar === "\"" || nextChar === "\\" || nextChar === "/") {
		return { value: nextChar, nextIndex: slashIndex + 2 };
	}
	if (nextChar === "u") {
		const hex = raw.slice(slashIndex + 2, slashIndex + 6);
		if (/^[0-9a-fA-F]{4}$/.test(hex)) {
			return {
				value: String.fromCharCode(Number.parseInt(hex, 16)),
				nextIndex: slashIndex + 6,
			};
		}
	}
	return { value: nextChar, nextIndex: slashIndex + 2 };
}

function extractObjectField(raw: string, key: string): string | null {
	const keyIndex = raw.indexOf(`"${key}"`);
	if (keyIndex < 0) {
		return null;
	}
	let index = raw.indexOf(":", keyIndex + key.length + 2);
	if (index < 0) {
		return null;
	}
	index += 1;
	while (index < raw.length && /\s/.test(raw[index]!)) {
		index += 1;
	}
	if (raw[index] !== "{") {
		return null;
	}
	return extractBalancedObject(raw, index);
}

function extractBalancedObject(raw: string, startIndex: number): string | null {
	let depth = 0;
	let inString = false;
	let escaping = false;
	for (let index = startIndex; index < raw.length; index += 1) {
		const current = raw[index]!;
		if (inString) {
			if (escaping) {
				escaping = false;
				continue;
			}
			if (current === "\\") {
				escaping = true;
				continue;
			}
			if (current === "\"") {
				inString = false;
			}
			continue;
		}
		if (current === "\"") {
			inString = true;
			continue;
		}
		if (current === "{") {
			depth += 1;
			continue;
		}
		if (current === "}") {
			depth -= 1;
			if (depth === 0) {
				return raw.slice(startIndex, index + 1);
			}
		}
	}
	return null;
}

function extractJsonObject(raw: string): string | null {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) {
		return null;
	}
	return raw.slice(start, end + 1);
}
