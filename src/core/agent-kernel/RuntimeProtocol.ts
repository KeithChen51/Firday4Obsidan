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

export const MAX_TOOL_ITERATION_MESSAGE = "Maximum tool-iteration limit reached. Stopped further tool calls.";

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
