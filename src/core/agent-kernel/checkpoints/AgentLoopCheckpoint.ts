import type { ReasoningArtifact } from "../../llm/ReasoningArtifact";
import type { AgentChatMessage, RuntimeMutationPlan, RuntimeToolTrace } from "../contracts";

export const AGENT_LOOP_CHECKPOINT_SCHEMA_VERSION = 1;

export type AgentLoopStableCheckpointBoundary =
	| "context_ready"
	| "after_tool_result"
	| "after_model_response_without_tool";

export type AgentLoopUnsafeCheckpointBoundary =
	| "during_model_request"
	| "after_model_response_before_tool_execution"
	| "during_tool_execution"
	| "during_mutation_apply"
	| "waiting_for_approval"
	| "waiting_for_user";

export type AgentLoopCheckpointBoundary =
	| AgentLoopStableCheckpointBoundary
	| AgentLoopUnsafeCheckpointBoundary;

export interface AgentCheckpointMessage extends Omit<AgentChatMessage, "reasoningArtifact"> {
	reasoningArtifact?: ReasoningArtifact;
}

export interface AgentCheckpointToolResultRef {
	toolCallId?: string;
	tool: string;
	status: RuntimeToolTrace["status"];
	step: number;
	targetPath?: string;
}

export interface AgentLoopCheckpoint {
	schemaVersion: 1;
	id: string;
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId: string;
	agentId: string;
	boundary: AgentLoopCheckpointBoundary;
	channel: "prompt" | "native";
	step: number;
	nextStep: number;
	maxIterations?: number;
	createdAt: string;
	modelOverride?: string;
	mode: string;
	allowedTools?: string[];
	modelMessages: AgentCheckpointMessage[];
	traces: RuntimeToolTrace[];
	pendingMutations: RuntimeMutationPlan[];
	completedToolCalls: AgentCheckpointToolResultRef[];
	lastEventSequence?: number;
	safety: {
		canAutoResume: boolean;
		reason: string;
	};
	privacy: {
		redacted: boolean;
		localOnly: true;
	};
	consumed?: {
		result: "resumed" | "rejected" | "expired";
		reason: string;
		at: string;
	};
}

export interface CheckpointResumeValidationInput {
	checkpoint: AgentLoopCheckpoint | null | undefined;
	now?: Date;
	ttlMs?: number;
	conversationId?: string;
	taskId?: string;
	agentId?: string;
	allowedTools?: string[];
}

export interface CheckpointResumeValidation {
	ok: boolean;
	reason: string;
}

const STABLE_AUTO_RESUME_BOUNDARIES = new Set<AgentLoopCheckpointBoundary>([
	"context_ready",
	"after_tool_result",
]);

export function createAgentLoopCheckpointId(turnId: string, boundary: AgentLoopCheckpointBoundary, step: number): string {
	const random = Math.random().toString(16).slice(2, 8);
	return `checkpoint-${turnId}-${boundary}-${step}-${Date.now()}-${random}`;
}

export function sanitizeAgentLoopCheckpoint(checkpoint: AgentLoopCheckpoint): AgentLoopCheckpoint {
	const messageResults = checkpoint.modelMessages.map(sanitizeCheckpointMessage);
	const hasUnsafeContinuation = messageResults.some((result) => result.unsafeContinuation);
	const safetyReason = hasUnsafeContinuation
		? "Checkpoint requires provider continuation payload that cannot be safely persisted."
		: checkpoint.safety.reason;
	return {
		...checkpoint,
		modelOverride: checkpoint.modelOverride ? sanitizeText(checkpoint.modelOverride, 160) : undefined,
		mode: sanitizeText(checkpoint.mode, 80),
		allowedTools: checkpoint.allowedTools?.map((tool) => sanitizeText(tool, 80)),
		modelMessages: messageResults.map((result) => result.message),
		traces: checkpoint.traces.map((trace) => sanitizeRecord(trace) as unknown as RuntimeToolTrace),
		pendingMutations: checkpoint.pendingMutations.map((mutation) => sanitizeRecord(mutation) as unknown as RuntimeMutationPlan),
		completedToolCalls: checkpoint.completedToolCalls.map((tool) => sanitizeRecord(tool) as unknown as AgentCheckpointToolResultRef),
		safety: {
			canAutoResume: Boolean(checkpoint.safety.canAutoResume) && !hasUnsafeContinuation,
			reason: sanitizeText(safetyReason, 240),
		},
		privacy: {
			redacted: true,
			localOnly: true,
		},
		...(checkpoint.consumed ? {
			consumed: {
				result: checkpoint.consumed.result,
				reason: sanitizeText(checkpoint.consumed.reason, 240),
				at: checkpoint.consumed.at,
			},
		} : {}),
	};
}

export function validateCheckpointForResume(input: CheckpointResumeValidationInput): CheckpointResumeValidation {
	const checkpoint = input.checkpoint;
	if (!checkpoint) {
		return { ok: false, reason: "No checkpoint is available." };
	}
	if (checkpoint.schemaVersion !== AGENT_LOOP_CHECKPOINT_SCHEMA_VERSION) {
		return { ok: false, reason: "Checkpoint schema version is not supported." };
	}
	if (checkpoint.consumed) {
		return { ok: false, reason: `Checkpoint was already ${checkpoint.consumed.result}.` };
	}
	if (!checkpoint.safety.canAutoResume) {
		return { ok: false, reason: checkpoint.safety.reason || "Checkpoint is not marked safe for auto resume." };
	}
	if (!STABLE_AUTO_RESUME_BOUNDARIES.has(checkpoint.boundary)) {
		return { ok: false, reason: `Checkpoint boundary ${checkpoint.boundary} is not safe for auto resume.` };
	}
	if (checkpoint.pendingMutations.length > 0) {
		return { ok: false, reason: "Checkpoint has pending mutations and cannot be resumed idempotently." };
	}
	if (checkpoint.boundary === "after_tool_result") {
		if (checkpoint.completedToolCalls.length === 0) {
			return { ok: false, reason: "Checkpoint tool result is incomplete." };
		}
		if (checkpoint.completedToolCalls.some((tool) => tool.status !== "ok")) {
			return { ok: false, reason: "Checkpoint tool result was not successful." };
		}
	}
	if (isCheckpointExpired(checkpoint, input.now, input.ttlMs)) {
		return { ok: false, reason: "Checkpoint is expired." };
	}
	if (input.conversationId && checkpoint.conversationId !== input.conversationId) {
		return { ok: false, reason: "Checkpoint conversation does not match this turn." };
	}
	if (input.agentId && checkpoint.agentId !== input.agentId) {
		return { ok: false, reason: "Checkpoint agent does not match this turn." };
	}
	if (input.taskId && checkpoint.taskId && checkpoint.taskId !== input.taskId) {
		return { ok: false, reason: "Checkpoint task does not match this turn." };
	}
	if (!allowedToolSetContains(input.allowedTools, checkpoint.allowedTools)) {
		return { ok: false, reason: "Checkpoint tool set is no longer allowed." };
	}
	return { ok: true, reason: "Checkpoint is safe to resume." };
}

export function isCheckpointExpired(
	checkpoint: Pick<AgentLoopCheckpoint, "createdAt">,
	now: Date = new Date(),
	ttlMs = 24 * 60 * 60 * 1000,
): boolean {
	const createdMs = Date.parse(checkpoint.createdAt);
	if (!Number.isFinite(createdMs)) {
		return true;
	}
	return now.getTime() - createdMs > ttlMs;
}

function allowedToolSetContains(current: string[] | undefined, required: string[] | undefined): boolean {
	if (!required || required.length === 0 || !current) {
		return true;
	}
	const currentSet = new Set(current.map((tool) => tool.trim()).filter(Boolean));
	return required.every((tool) => currentSet.has(tool));
}

interface SanitizedCheckpointMessage {
	message: AgentCheckpointMessage;
	unsafeContinuation: boolean;
}

interface SanitizedReasoningArtifact {
	artifact?: ReasoningArtifact;
	unsafeContinuation: boolean;
}

interface SanitizedContinuationPayload {
	payload?: unknown;
	unsafe: boolean;
}

function sanitizeCheckpointMessage(message: AgentCheckpointMessage): SanitizedCheckpointMessage {
	const sanitized = sanitizeRecord(message) as unknown as AgentCheckpointMessage;
	let unsafeContinuation = false;
	if (message.reasoningArtifact) {
		const result = sanitizeReasoningArtifactForCheckpoint(message.reasoningArtifact);
		unsafeContinuation = result.unsafeContinuation;
		if (result.artifact) {
			sanitized.reasoningArtifact = result.artifact;
		} else {
			delete sanitized.reasoningArtifact;
		}
	}
	delete (sanitized as unknown as Record<string, unknown>).endpoint;
	delete (sanitized as unknown as Record<string, unknown>).requestHeaders;
	return { message: sanitized, unsafeContinuation };
}

function sanitizeReasoningArtifactForCheckpoint(artifact: ReasoningArtifact): SanitizedReasoningArtifact {
	if (!artifact.hasReasoning) {
		return {
			unsafeContinuation: false,
			artifact: {
				hasReasoning: false,
				provider: artifact.provider,
				model: sanitizeText(artifact.model, 160),
				rawFormat: artifact.rawFormat,
				visibleSummary: "",
				continuationPolicy: "drop",
				metadata: sanitizeRecord(artifact.metadata) as ReasoningArtifact["metadata"],
			},
		};
	}
	const continuation = sanitizeContinuationPayload(artifact);
	const dropsProviderReasoning =
		continuation.payload === undefined &&
		(
			artifact.provider === "deepseek" ||
			artifact.provider === "bailian" ||
			artifact.provider === "dashscope" ||
			artifact.rawFormat === "reasoning_content"
		);
	return {
		unsafeContinuation: continuation.unsafe,
		artifact: {
			hasReasoning: true,
			provider: artifact.provider,
			model: sanitizeText(artifact.model, 160),
			rawFormat: dropsProviderReasoning ? "unknown" : artifact.rawFormat,
			visibleSummary: sanitizeText(artifact.visibleSummary, 240),
			continuationPolicy: continuation.payload === undefined ? "drop" : artifact.continuationPolicy,
			...(continuation.payload !== undefined ? { continuationPayload: continuation.payload } : {}),
			metadata: {
				...(sanitizeRecord(artifact.metadata) as ReasoningArtifact["metadata"]),
				redacted: true,
			},
		},
	};
}

function sanitizeContinuationPayload(artifact: ReasoningArtifact): SanitizedContinuationPayload {
	if (
		artifact.continuationPolicy === "drop" ||
		artifact.continuationPolicy === "provider_managed"
	) {
		return { unsafe: false };
	}
	if (
		artifact.provider === "deepseek" ||
		artifact.provider === "bailian" ||
		artifact.provider === "dashscope"
	) {
		return { unsafe: true };
	}
	const payload = artifact.continuationPayload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { unsafe: true };
	}
	if (artifact.rawFormat === "reasoning_content") {
		return { unsafe: true };
	}
	if (artifact.provider === "anthropic" || artifact.rawFormat === "anthropic_thinking") {
		if (containsRawContinuationReasoning(payload)) {
			return { unsafe: true };
		}
		const sanitized = sanitizeRecord(payload, {
			preserveAnthropicSignatures: true,
			preserveAnthropicText: true,
		});
		return Object.keys(sanitized).length > 0 ? { payload: sanitized, unsafe: false } : { unsafe: true };
	}
	const sanitized = sanitizeRecord(payload, { preserveReasoningDetails: true, preserveAnthropicSignatures: true });
	if (Object.keys(sanitized).length === 0) {
		return { unsafe: true };
	}
	return { payload: sanitized, unsafe: false };
}

function sanitizeRecord(
	value: object,
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean; preserveAnthropicText?: boolean } = {},
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (isDroppedKey(key, options)) {
			continue;
		}
		const sanitized = sanitizeUnknown(child, key, options);
		if (sanitized !== undefined) {
			output[key] = sanitized;
		}
	}
	return output;
}

function sanitizeUnknown(
	value: unknown,
	key: string,
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean; preserveAnthropicText?: boolean },
): unknown {
	if (isDroppedKey(key, options)) {
		return undefined;
	}
	if (typeof value === "string") {
		return sanitizeText(value, 12_000);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeUnknown(item, key, options))
			.filter((item) => item !== undefined);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	return sanitizeRecord(value as Record<string, unknown>, options);
}

function isDroppedKey(
	key: string,
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean; preserveAnthropicText?: boolean },
): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (options.preserveReasoningDetails && normalized === "reasoningdetails") {
		return false;
	}
	if (options.preserveAnthropicText && normalized === "text") {
		return false;
	}
	if (options.preserveAnthropicSignatures && (
		normalized === "signature" ||
		normalized === "thinkingsignature" ||
		normalized === "redactedthinking"
	)) {
		return false;
	}
	return [
		"authorization",
		"apikey",
		"xapikey",
		"token",
		"accesstoken",
		"refreshtoken",
		"password",
		"secret",
		"cookie",
		"setcookie",
		"headers",
		"requestheaders",
		"endpoint",
		"apiurl",
		"baseurl",
		"rawreasoning",
		"reasoningcontent",
		"chainofthought",
		"cot",
		"thinking",
		"text",
		"reasoning",
	].includes(normalized);
}

function sanitizeText(value: string, maxLength: number): string {
	const redacted = value
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/https?:\/\/[^\s)"'<>]+/gi, (url) => isLikelyEndpointUrl(url) ? "[redacted-endpoint-url]" : url)
		.replace(/\b(cookie|set-cookie)\s*[:=]\s*[^;\s]+/gi, "$1=[redacted]")
		.replace(/\b[A-Za-z0-9_]*(?:secret|token|password|apikey|api_key)[A-Za-z0-9_-]*\s*[:=]\s*\S+/gi, "[redacted]");
	if (redacted.length <= maxLength) {
		return redacted;
	}
	return `${redacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function containsRawContinuationReasoning(value: unknown, key = ""): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
	if ([
		"rawreasoning",
		"reasoningcontent",
		"chainofthought",
		"cot",
		"reasoning",
		"thinking",
	].includes(normalized)) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some((item) => containsRawContinuationReasoning(item));
	}
	if (!value || typeof value !== "object") {
		return false;
	}
	return Object.entries(value as Record<string, unknown>).some(([childKey, child]) =>
		containsRawContinuationReasoning(child, childKey)
	);
}

function isLikelyEndpointUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		const host = parsed.hostname.toLowerCase();
		const pathname = parsed.pathname.toLowerCase();
		return host.includes("api.") ||
			host.includes("gateway") ||
			host.includes("dashscope") ||
			host.includes("deepseek") ||
			host.includes("openai") ||
			host.includes("anthropic") ||
			host.includes("zenmux") ||
			host.includes("bailian") ||
			pathname.includes("/api/") ||
			pathname.includes("/v1") ||
			pathname.includes("/chat/completions") ||
			pathname.includes("/responses") ||
			pathname.includes("/messages") ||
			pathname.includes("/compatible-mode");
	} catch {
		return false;
	}
}
