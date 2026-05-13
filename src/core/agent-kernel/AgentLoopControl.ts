import type { ToolCall } from "../../types/tools";
import { normalizeToolInvocation, type NormalizedToolInvocation } from "../tools/ToolInvocationNormalizer";
import type { ToolResultRecovery, ToolResultStatus } from "../tools/ToolResultContract";
import type { ToolExecutionResult } from "./ToolExecutionPort";

export const AGENT_LOOP_DECISION_KINDS = ["continue", "final", "safe_stop"] as const;
export type AgentLoopDecisionKind = typeof AGENT_LOOP_DECISION_KINDS[number];

export const AGENT_LOOP_STOP_REASONS = [
	"no_progress",
	"repetition",
	"budget_exhausted",
	"permission_wait",
	"cancelled",
	"emergency_fuse",
] as const;
export type AgentLoopStopReason = typeof AGENT_LOOP_STOP_REASONS[number];

export type AgentLoopDecision =
	| { kind: "continue" }
	| { kind: "final"; assistantText: string }
	| { kind: "safe_stop"; reason: AgentLoopStopReason; summary?: string };

export type AgentLoopRepetitionKind =
	| "repeated_failed_invocation"
	| "repeated_unchanged_observation"
	| "ignored_recovery_suggestion";

export interface ToolInvocationFingerprint {
	tool: string;
	normalizedArgs: Record<string, unknown>;
	canonicalArgs: string;
	invocationIdentity: string;
	resolvedTarget?: string;
	status?: ToolResultStatus;
	resultDigest?: string;
	resultIdentity?: string;
}

export interface AgentLoopControlRecord {
	invocation: NormalizedToolInvocation;
	fingerprint: ToolInvocationFingerprint;
	result: ToolExecutionResult;
}

export interface AgentLoopRepetition {
	kind: AgentLoopRepetitionKind;
	stopReason: AgentLoopStopReason;
	fingerprint: ToolInvocationFingerprint;
	previous: AgentLoopControlRecord;
	recovery?: ToolResultRecovery;
}

export interface AgentLoopDecisionOptions {
	assistantText?: string;
	reason?: AgentLoopStopReason;
	summary?: string;
}

export function createAgentLoopDecision(
	kind: AgentLoopDecisionKind,
	options: AgentLoopDecisionOptions = {},
): AgentLoopDecision {
	if (kind === "final") {
		return { kind, assistantText: options.assistantText ?? "" };
	}
	if (kind === "safe_stop") {
		return {
			kind,
			reason: options.reason ?? "emergency_fuse",
			...(options.summary ? { summary: options.summary } : {}),
		};
	}
	return { kind: "continue" };
}

export function createToolInvocationFingerprint(
	tool: Pick<ToolCall, "name" | "args">,
	result?: ToolExecutionResult,
): ToolInvocationFingerprint {
	const invocation = normalizeToolInvocation(tool);
	const status = result ? resolveResultStatus(result) : undefined;
	const resolvedTarget = result ? resolveResultTarget(result) : undefined;
	const resultDigest = result ? createResultDigest(result) : undefined;
	const resultIdentity = result
		? `${invocation.identity}|target=${resolvedTarget ?? ""}|status=${status ?? ""}|digest=${resultDigest ?? ""}`
		: undefined;
	return {
		tool: invocation.tool,
		normalizedArgs: invocation.normalizedArgs,
		canonicalArgs: invocation.canonicalArgs,
		invocationIdentity: invocation.identity,
		...(resolvedTarget ? { resolvedTarget } : {}),
		...(status ? { status } : {}),
		...(resultDigest ? { resultDigest } : {}),
		...(resultIdentity ? { resultIdentity } : {}),
	};
}

export class AgentLoopControlTracker {
	private readonly failedInvocations = new Map<string, AgentLoopControlRecord>();
	private readonly successfulObservations = new Map<string, AgentLoopControlRecord>();

	beforeInvocation(tool: Pick<ToolCall, "name" | "args">): AgentLoopRepetition | undefined {
		const fingerprint = createToolInvocationFingerprint(tool);
		const previous = this.failedInvocations.get(fingerprint.invocationIdentity);
		if (!previous) {
			return undefined;
		}
		const recovery = cloneRecovery(previous.result.payload.recovery);
		return {
			kind: hasRecoverySuggestion(recovery) ? "ignored_recovery_suggestion" : "repeated_failed_invocation",
			stopReason: "repetition",
			fingerprint,
			previous,
			...(recovery ? { recovery } : {}),
		};
	}

	recordResult(
		tool: Pick<ToolCall, "name" | "args">,
		result: ToolExecutionResult,
	): AgentLoopRepetition | undefined {
		const invocation = normalizeToolInvocation(tool);
		const fingerprint = createToolInvocationFingerprint(tool, result);
		const record: AgentLoopControlRecord = { invocation, fingerprint, result };
		if (isFailedResult(result)) {
			this.failedInvocations.set(fingerprint.invocationIdentity, record);
			return undefined;
		}
		if (!isSuccessfulObservation(tool, result) || !fingerprint.resultIdentity) {
			return undefined;
		}
		const previous = this.successfulObservations.get(fingerprint.resultIdentity);
		if (previous) {
			return {
				kind: "repeated_unchanged_observation",
				stopReason: "no_progress",
				fingerprint,
				previous,
			};
		}
		this.successfulObservations.set(fingerprint.resultIdentity, record);
		return undefined;
	}
}

function resolveResultStatus(result: ToolExecutionResult): ToolResultStatus {
	return result.payload.status ?? result.trace.status;
}

function resolveResultTarget(result: ToolExecutionResult): string | undefined {
	const payloadTrace = result.payload.trace;
	return firstNonEmptyString(
		payloadTrace?.resolvedPath,
		payloadTrace?.targetPath,
		result.trace.targetPath,
		payloadTrace?.displayPath,
		payloadTrace?.inputPath,
	);
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function createResultDigest(result: ToolExecutionResult): string {
	const digestInput = {
		ok: result.payload.ok || result.trace.ok,
		status: resolveResultStatus(result),
		failureClass: result.payload.failureClass ?? result.trace.failureClass,
		data: result.payload.data,
		error: result.payload.error ?? result.trace.error,
	};
	return `fnv1a32:${hashFnv1a32(stableStringify(digestInput))}`;
}

function hashFnv1a32(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (`00000000${hash.toString(16)}`).slice(-8);
}

function stableStringify(value: unknown): string {
	return JSON.stringify(normalizeForFingerprint(value, new WeakSet<object>()));
}

function normalizeForFingerprint(value: unknown, seen: WeakSet<object>): unknown {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	if (seen.has(value)) {
		return "[Circular]";
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const items = value.map((item) => {
			const normalized = normalizeForFingerprint(item, seen);
			return normalized === undefined ? null : normalized;
		});
		seen.delete(value);
		return items;
	}
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		const normalized = normalizeForFingerprint((value as Record<string, unknown>)[key], seen);
		if (normalized !== undefined) {
			output[key] = normalized;
		}
	}
	seen.delete(value);
	return output;
}

function isFailedResult(result: ToolExecutionResult): boolean {
	const status = resolveResultStatus(result);
	return status === "failed" && !(result.payload.ok || result.trace.ok);
}

function isSuccessfulObservation(tool: Pick<ToolCall, "name" | "args">, result: ToolExecutionResult): boolean {
	const status = resolveResultStatus(result);
	if (status !== "ok" || !(result.payload.ok || result.trace.ok)) {
		return false;
	}
	return isObservationTool(tool.name);
}

function isObservationTool(toolName: string): boolean {
	const normalized = toolName.trim().toLowerCase();
	return ["read", "read_many", "ls", "grep", "search_text", "search_and_read", "glob", "project_tree", "list", "search"].includes(normalized);
}

function hasRecoverySuggestion(recovery: ToolResultRecovery | undefined): boolean {
	if (!recovery) {
		return false;
	}
	return Boolean(
		(recovery.suggestedArgs && Object.keys(recovery.suggestedArgs).length > 0) ||
		(recovery.candidatePaths && recovery.candidatePaths.length > 0),
	);
}

function cloneRecovery(recovery: ToolResultRecovery | undefined): ToolResultRecovery | undefined {
	if (!recovery) {
		return undefined;
	}
	return {
		...recovery,
		...(recovery.suggestedArgs ? { suggestedArgs: cloneRecord(recovery.suggestedArgs) } : {}),
		...(recovery.candidatePaths ? { candidatePaths: [...recovery.candidatePaths] } : {}),
	};
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
	const normalized = normalizeForFingerprint(value, new WeakSet<object>());
	if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
		return {};
	}
	return normalized as Record<string, unknown>;
}
