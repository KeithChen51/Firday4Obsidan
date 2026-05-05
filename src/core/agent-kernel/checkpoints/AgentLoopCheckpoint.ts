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
	return {
		...checkpoint,
		modelOverride: checkpoint.modelOverride ? sanitizeText(checkpoint.modelOverride, 160) : undefined,
		mode: sanitizeText(checkpoint.mode, 80),
		allowedTools: checkpoint.allowedTools?.map((tool) => sanitizeText(tool, 80)),
		modelMessages: checkpoint.modelMessages.map(sanitizeCheckpointMessage),
		traces: checkpoint.traces.map((trace) => sanitizeRecord(trace) as unknown as RuntimeToolTrace),
		pendingMutations: checkpoint.pendingMutations.map((mutation) => sanitizeRecord(mutation) as unknown as RuntimeMutationPlan),
		completedToolCalls: checkpoint.completedToolCalls.map((tool) => sanitizeRecord(tool) as unknown as AgentCheckpointToolResultRef),
		safety: {
			canAutoResume: Boolean(checkpoint.safety.canAutoResume),
			reason: sanitizeText(checkpoint.safety.reason, 240),
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

function sanitizeCheckpointMessage(message: AgentCheckpointMessage): AgentCheckpointMessage {
	const sanitized = sanitizeRecord(message) as unknown as AgentCheckpointMessage;
	if (message.reasoningArtifact) {
		const artifact = sanitizeReasoningArtifactForCheckpoint(message.reasoningArtifact);
		if (artifact) {
			sanitized.reasoningArtifact = artifact;
		} else {
			delete sanitized.reasoningArtifact;
		}
	}
	delete (sanitized as unknown as Record<string, unknown>).endpoint;
	delete (sanitized as unknown as Record<string, unknown>).requestHeaders;
	return sanitized;
}

function sanitizeReasoningArtifactForCheckpoint(artifact: ReasoningArtifact): ReasoningArtifact | undefined {
	if (!artifact.hasReasoning) {
		return {
			hasReasoning: false,
			provider: artifact.provider,
			model: sanitizeText(artifact.model, 160),
			rawFormat: artifact.rawFormat,
			visibleSummary: "",
			continuationPolicy: "drop",
			metadata: sanitizeRecord(artifact.metadata) as ReasoningArtifact["metadata"],
		};
	}
	const continuationPayload = sanitizeContinuationPayload(artifact);
	const dropsProviderReasoning =
		continuationPayload === undefined &&
		(
			artifact.provider === "deepseek" ||
			artifact.provider === "bailian" ||
			artifact.provider === "dashscope" ||
			artifact.rawFormat === "reasoning_content"
		);
	return {
		hasReasoning: true,
		provider: artifact.provider,
		model: sanitizeText(artifact.model, 160),
		rawFormat: dropsProviderReasoning ? "unknown" : artifact.rawFormat,
		visibleSummary: sanitizeText(artifact.visibleSummary, 240),
		continuationPolicy: continuationPayload === undefined ? "drop" : artifact.continuationPolicy,
		...(continuationPayload !== undefined ? { continuationPayload } : {}),
		metadata: {
			...(sanitizeRecord(artifact.metadata) as ReasoningArtifact["metadata"]),
			redacted: true,
		},
	};
}

function sanitizeContinuationPayload(artifact: ReasoningArtifact): unknown {
	if (
		artifact.continuationPolicy === "drop" ||
		artifact.continuationPolicy === "provider_managed" ||
		artifact.provider === "deepseek" ||
		artifact.provider === "bailian" ||
		artifact.provider === "dashscope" ||
		artifact.rawFormat === "reasoning_content"
	) {
		return undefined;
	}
	const payload = artifact.continuationPayload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return undefined;
	}
	const sanitized = sanitizeRecord(payload, { preserveReasoningDetails: true, preserveAnthropicSignatures: true });
	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeRecord(
	value: object,
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean } = {},
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
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean },
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
	options: { preserveReasoningDetails?: boolean; preserveAnthropicSignatures?: boolean },
): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (options.preserveReasoningDetails && normalized === "reasoningdetails") {
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
		.replace(/https?:\/\/[^\s)]+\/api\/[^\s)]+/gi, "[redacted-api-url]")
		.replace(/\b(cookie|set-cookie)\s*[:=]\s*[^;\s]+/gi, "$1=[redacted]")
		.replace(/\b[A-Za-z0-9_]*(?:secret|token|password|apikey|api_key)[A-Za-z0-9_-]*\s*[:=]\s*\S+/gi, "[redacted]");
	if (redacted.length <= maxLength) {
		return redacted;
	}
	return `${redacted.slice(0, Math.max(0, maxLength - 3))}...`;
}
