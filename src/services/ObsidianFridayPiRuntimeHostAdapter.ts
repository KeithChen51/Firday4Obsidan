import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import type { RuntimeTurnExecutorPort } from "../core/agent-kernel/AgentKernelPorts";
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
	FridayPiPackageMetadataRef,
	FridayPiRuntimeStatePersistence,
	FridayPiToolTraceRecord,
	FridayPiWorkspacePolicyMetadata,
} from "./FridayPiRuntimeStateStore";

export type ObsidianFridayPiRuntimeExecutorFactory = () => RuntimeTurnExecutorPort;

export type FridayPiWorkspacePolicyMetadataProvider = () => FridayPiWorkspacePolicyMetadata;

export interface ObsidianFridayPiRuntimeHostAdapterOptions {
	stateStore?: FridayPiRuntimeStatePersistence;
	workspacePolicyProvider?: FridayPiWorkspacePolicyMetadataProvider;
}

const LOCAL_BRIDGE_PACKAGE_METADATA = {
	packageId: "friday-pi-local-bridge",
	name: "FRIDAY PI local bridge",
	version: "0.1.0",
	kind: "local_bridge",
	bridge: "obsidian-host",
	marketplace: false,
};

const MAX_ASSISTANT_SUMMARY_CHARS = 500;

export class ObsidianFridayPiRuntimeHostAdapter implements FridayPiSessionHostPort {
	constructor(
		private readonly createExecutor: ObsidianFridayPiRuntimeExecutorFactory,
		private readonly options: ObsidianFridayPiRuntimeHostAdapterOptions = {},
	) {}

	createSession(input: AgentTurnInput, context: AgentExecutionContext): FridayPiSessionPort {
		return new ObsidianFridayPiRuntimeHostSession(this.createExecutor, input, context, this.options);
	}
}

class ObsidianFridayPiRuntimeHostSession implements FridayPiSessionPort {
	private readonly listeners = new Set<FridayPiSessionListener>();
	private promptStarted = false;
	private disposed = false;

	constructor(
		private readonly createExecutor: ObsidianFridayPiRuntimeExecutorFactory,
		private readonly input: AgentTurnInput,
		private readonly context: AgentExecutionContext,
		private readonly options: ObsidianFridayPiRuntimeHostAdapterOptions,
	) {}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(text: string, _options?: FridayPiPromptOptions): Promise<void> {
		if (this.disposed) {
			throw new Error("PI host bridge session has been disposed.");
		}
		if (this.promptStarted) {
			throw new Error("PI host bridge session prompt already started.");
		}
		this.promptStarted = true;
		const startedAt = new Date().toISOString();
		try {
			const result = await this.createExecutor().execute(
				text === this.input.userPrompt ? this.input : { ...this.input, userPrompt: text },
				this.context,
			);
			const endedAt = new Date().toISOString();
			await this.persistHostResult(result, startedAt, endedAt);
			this.emit({
				type: "host_result",
				result,
				summary: result.status === "failed" || result.status === "cancelled"
					? "PI host bridge failed."
					: "PI host bridge completed.",
			});
		} catch (error) {
			this.emit({
				type: "error",
				error,
				message: this.stringifyError(error) || "PI host bridge failed.",
			});
		}
	}

	private async persistHostResult(result: AgentTurnResult, startedAt: string, endedAt: string): Promise<void> {
		const stateStore = this.options.stateStore;
		if (!stateStore) {
			return;
		}
		try {
			const workspacePolicy = this.resolveWorkspacePolicy();
			const packageRef = await stateStore.writePackageMetadata(LOCAL_BRIDGE_PACKAGE_METADATA);
			const ids = this.resolveResultIds(result);
			await stateStore.appendSessionTurnRecord({
				sessionId: ids.sessionId,
				conversationId: ids.conversationId,
				turnId: ids.turnId,
				taskId: ids.taskId,
				traceId: ids.traceId,
				status: result.status ?? "completed",
				startedAt,
				endedAt,
				assistantSummary: this.safeSummary(result.assistantText || result.rawFinalReply || ""),
				assistantTextLength: (result.assistantText ?? "").length,
				rawFinalReplyLength: (result.rawFinalReply ?? "").length,
				packageRef,
				workspacePolicy,
			});
			await stateStore.appendToolTraceRecords(
				(result.traces ?? []).map((trace) => this.toPiToolTraceRecord(trace, ids, packageRef, workspacePolicy)),
			);
		} catch {
			// PI runtime-layer persistence must not change the user-facing host bridge result.
		}
	}

	private resolveResultIds(result: AgentTurnResult): {
		sessionId: string;
		conversationId: string;
		turnId: string;
		taskId?: string;
		traceId?: string;
	} {
		const conversationId = result.conversationId || this.context.conversationId || this.input.conversationId;
		return {
			sessionId: conversationId,
			conversationId,
			turnId: result.turnId || this.context.turnId || this.input.turnId || "turn",
			taskId: result.taskId ?? result.task?.id ?? this.context.taskId ?? this.input.taskId,
			traceId: result.traceId ?? this.context.traceId ?? this.input.traceId,
		};
	}

	private toPiToolTraceRecord(
		trace: RuntimeToolTrace,
		ids: ReturnType<ObsidianFridayPiRuntimeHostSession["resolveResultIds"]>,
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

	private resolveWorkspacePolicy(): FridayPiWorkspacePolicyMetadata {
		return this.options.workspacePolicyProvider?.() ?? {
			trustBoundary: "vault",
			vault: { root: "/" },
			externalAccess: "explicit",
			externalWrite: false,
		};
	}

	private safeSummary(text: string): string {
		const normalized = text.replace(/\s+/g, " ").trim();
		if (normalized.length <= MAX_ASSISTANT_SUMMARY_CHARS) {
			return normalized;
		}
		return `${normalized.slice(0, MAX_ASSISTANT_SUMMARY_CHARS)}...`;
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}

	private emit(event: FridayPiSessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}

	private stringifyError(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === "string") {
			return error;
		}
		if (error && typeof error === "object" && "message" in error) {
			return String((error as { message?: unknown }).message ?? "");
		}
		return error === undefined || error === null ? "" : String(error);
	}
}
