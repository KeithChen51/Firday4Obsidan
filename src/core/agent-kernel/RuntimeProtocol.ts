import { parseRuntimeEnvelopeText } from "../orchestrator/RuntimeEnvelopeParser";
import type { RuntimeMutationPlan } from "./contracts";

export interface RuntimeToolCallEnvelope {
	name: string;
	args?: Record<string, unknown>;
}

export interface RuntimeEnvelope {
	type?: string;
	assistant?: string;
	tool?: RuntimeToolCallEnvelope;
	mutations?: RuntimeMutationPlan[];
	pendingMutations?: RuntimeMutationPlan[];
}

export const MAX_TOOL_ITERATION_SAFE_SUMMARY = "工具调用次数过多，FRIDAY 已安全停止本轮操作。";
export const MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT = `${MAX_TOOL_ITERATION_SAFE_SUMMARY}请缩小任务范围后再试。`;
export const RAW_MAX_TOOL_ITERATION_TEXTS = [
	"Tool iteration limit reached; stopped further tool calls for this turn.",
	"Maximum tool-iteration limit reached",
] as const;
export const MAX_TOOL_ITERATION_MESSAGE = MAX_TOOL_ITERATION_SAFE_SUMMARY;

export function containsRawMaxToolIterationText(text: string): boolean {
	return RAW_MAX_TOOL_ITERATION_TEXTS.some((rawText) => text.includes(rawText));
}

export function parseKernelRuntimeEnvelope(raw: string): RuntimeEnvelope | null {
	return parseRuntimeEnvelopeText(raw, "friday-runtime") as RuntimeEnvelope | null;
}

export function isResponseEnvelope(envelope: RuntimeEnvelope): boolean {
	return envelope.type === "response" || (!envelope.type && !envelope.tool);
}

export function hasMutationPlans(envelope: RuntimeEnvelope): boolean {
	return envelope.type === "mutation_plan" ||
		Array.isArray(envelope.mutations) ||
		Array.isArray(envelope.pendingMutations);
}

export function extractMutationPlans(envelope: RuntimeEnvelope): RuntimeMutationPlan[] {
	if (Array.isArray(envelope.mutations)) {
		return envelope.mutations;
	}
	if (Array.isArray(envelope.pendingMutations)) {
		return envelope.pendingMutations;
	}
	return [];
}
