import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, RuntimeToolTrace } from "../core/agent-kernel/contracts";
import type {
	FridayPiPromptOptions,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionListener,
	FridayPiSessionPort,
	FridayPiSessionUnsubscribe,
} from "../core/agent-kernel/pi/FridayPiRuntimePorts";
import type {
	FridayPiPackageMetadataInput,
	FridayPiPackageMetadataRef,
	FridayPiRuntimeStatePersistence,
	FridayPiToolTraceRecord,
	FridayPiWorkspacePolicyMetadata,
} from "./FridayPiRuntimeStateStore";

export type FridayPiWorkspacePolicyMetadataProvider = () => FridayPiWorkspacePolicyMetadata;

export interface PersistedFridayPiSessionHostAdapterOptions {
	stateStore?: FridayPiRuntimeStatePersistence;
	workspacePolicyProvider?: FridayPiWorkspacePolicyMetadataProvider;
	packageMetadata?: FridayPiPackageMetadataInput;
	warningLabel?: string;
}

export const FRIDAY_PI_REAL_SDK_PACKAGE_METADATA: FridayPiPackageMetadataInput = {
	packageId: "friday-pi-real-sdk",
	name: "@earendil-works/pi-agent-core",
	version: "0.78.1",
	kind: "runtime_sdk",
	bridge: "real-pi-sdk",
	marketplace: false,
};

const DEFAULT_PACKAGE_METADATA = FRIDAY_PI_REAL_SDK_PACKAGE_METADATA;
const DEFAULT_WARNING_LABEL = "[Friday] PI runtime persistence failed.";
const MAX_ASSISTANT_SUMMARY_CHARS = 500;

export class PersistedFridayPiSessionHostAdapter implements FridayPiSessionHostPort {
	constructor(
		private readonly host: FridayPiSessionHostPort,
		private readonly options: PersistedFridayPiSessionHostAdapterOptions = {},
	) {}

	async createSession(input: AgentTurnInput, context: AgentExecutionContext): Promise<FridayPiSessionPort> {
		const session = await this.host.createSession(input, context);
		return new PersistedFridayPiSession(session, input, context, this.options);
	}
}

class PersistedFridayPiSession implements FridayPiSessionPort {
	private promptStartedAt?: string;
	private persistedHostResult = false;

	constructor(
		private readonly session: FridayPiSessionPort,
		private readonly input: AgentTurnInput,
		private readonly context: AgentExecutionContext,
		private readonly options: PersistedFridayPiSessionHostAdapterOptions,
	) {}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		return this.session.subscribe((event) => {
			try {
				listener(event);
			} finally {
				this.afterSessionEvent(event);
			}
		});
	}

	async prompt(text: string, options?: FridayPiPromptOptions): Promise<void> {
		this.promptStartedAt = this.promptStartedAt ?? new Date().toISOString();
		return this.session.prompt(text, options);
	}

	async steer(text: string, options?: FridayPiPromptOptions): Promise<void> {
		if (!this.session.steer) {
			throw new Error("Wrapped PI session does not expose steer().");
		}
		return this.session.steer(text, options);
	}

	async followUp(text: string, options?: FridayPiPromptOptions): Promise<void> {
		if (!this.session.followUp) {
			throw new Error("Wrapped PI session does not expose followUp().");
		}
		return this.session.followUp(text, options);
	}

	async dispose(): Promise<void> {
		await this.session.dispose?.();
	}

	private afterSessionEvent(event: FridayPiSessionEvent): void {
		if (event.type !== "host_result" || this.persistedHostResult) {
			return;
		}
		this.persistedHostResult = true;
		void persistFridayPiHostResult({
			input: this.input,
			context: this.context,
			result: event.result,
			startedAt: this.promptStartedAt ?? this.context.startedAt,
			endedAt: new Date().toISOString(),
			options: this.options,
		});
	}
}

async function persistFridayPiHostResult(input: {
	input: AgentTurnInput;
	context: AgentExecutionContext;
	result: AgentTurnResult;
	startedAt: string;
	endedAt: string;
	options: PersistedFridayPiSessionHostAdapterOptions;
}): Promise<void> {
	const stateStore = input.options.stateStore;
	if (!stateStore) {
		return;
	}
	const ids = resolveResultIds(input.input, input.context, input.result);
	try {
		const workspacePolicy = resolveWorkspacePolicy(input.options);
		const packageRef = await stateStore.writePackageMetadata(input.options.packageMetadata ?? DEFAULT_PACKAGE_METADATA);
		await stateStore.appendSessionTurnRecord({
			sessionId: ids.sessionId,
			conversationId: ids.conversationId,
			turnId: ids.turnId,
			taskId: ids.taskId,
			traceId: ids.traceId,
			status: input.result.status ?? "completed",
			startedAt: input.startedAt,
			endedAt: input.endedAt,
			assistantSummary: safeSummary(input.result.assistantText || input.result.rawFinalReply || ""),
			assistantTextLength: (input.result.assistantText ?? "").length,
			rawFinalReplyLength: (input.result.rawFinalReply ?? "").length,
			packageRef,
			workspacePolicy,
		});
		await stateStore.appendToolTraceRecords(
			(input.result.traces ?? []).map((trace) => toPiToolTraceRecord(trace, ids, packageRef, workspacePolicy)),
		);
	} catch (error) {
		reportPersistenceFailure(ids, error, input.options.warningLabel);
	}
}

function resolveResultIds(
	input: AgentTurnInput,
	context: AgentExecutionContext,
	result: AgentTurnResult,
): {
	sessionId: string;
	conversationId: string;
	turnId: string;
	taskId?: string;
	traceId?: string;
} {
	const conversationId = result.conversationId || context.conversationId || input.conversationId;
	return {
		sessionId: conversationId,
		conversationId,
		turnId: result.turnId || context.turnId || input.turnId || "turn",
		taskId: result.taskId ?? result.task?.id ?? context.taskId ?? input.taskId,
		traceId: result.traceId ?? context.traceId ?? input.traceId,
	};
}

function toPiToolTraceRecord(
	trace: RuntimeToolTrace,
	ids: ReturnType<typeof resolveResultIds>,
	packageRef: FridayPiPackageMetadataRef,
	workspacePolicy: FridayPiWorkspacePolicyMetadata,
): FridayPiToolTraceRecord {
	return {
		kind: "pi_tool_trace",
		sessionId: ids.sessionId,
		conversationId: ids.conversationId,
		turnId: ids.turnId,
		taskId: ids.taskId,
		traceId: ids.traceId,
		packageRef,
		workspacePolicy,
		runId: trace.runId,
		step: trace.step,
		tool: trace.tool,
		scope: trace.scope,
		targetPath: trace.targetPath,
		approved: trace.approved,
		approvalReason: trace.approvalReason,
		persistedRule: trace.persistedRule,
		viaRule: trace.viaRule,
		status: trace.status,
		failureClass: trace.failureClass,
		ok: trace.ok,
		summary: trace.summary,
		error: trace.error,
	};
}

function resolveWorkspacePolicy(options: PersistedFridayPiSessionHostAdapterOptions): FridayPiWorkspacePolicyMetadata {
	return options.workspacePolicyProvider?.() ?? {
		trustBoundary: "vault",
		vault: { root: "/" },
		externalAccess: "explicit",
		externalWrite: false,
	};
}

function reportPersistenceFailure(
	ids: ReturnType<typeof resolveResultIds>,
	error: unknown,
	warningLabel = DEFAULT_WARNING_LABEL,
): void {
	const metadata: Record<string, string> = {
		turnId: ids.turnId,
		conversationId: ids.conversationId,
	};
	if (ids.taskId) {
		metadata.taskId = ids.taskId;
	}
	if (ids.traceId) {
		metadata.traceId = ids.traceId;
	}
	console.warn(warningLabel, metadata, error);
}

function safeSummary(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= MAX_ASSISTANT_SUMMARY_CHARS) {
		return normalized;
	}
	return `${normalized.slice(0, MAX_ASSISTANT_SUMMARY_CHARS)}...`;
}
