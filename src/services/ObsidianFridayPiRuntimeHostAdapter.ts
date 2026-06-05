import { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
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
	private delegatedContext?: AgentExecutionContext;

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

	async prompt(text: string, options?: FridayPiPromptOptions): Promise<void> {
		if (this.disposed) {
			throw new Error("PI host bridge session has been disposed.");
		}
		if (this.promptStarted) {
			throw new Error("PI host bridge session prompt already started.");
		}
		this.promptStarted = true;
		const startedAt = new Date().toISOString();
		const delegatedContext = this.createDelegatedContext(options);
		this.delegatedContext = delegatedContext;
		try {
			const result = await this.createExecutor().execute(
				text === this.input.userPrompt ? this.input : { ...this.input, userPrompt: text },
				delegatedContext,
			);
			if (this.disposed) {
				return;
			}
			const endedAt = new Date().toISOString();
			this.emit({
				type: "host_result",
				result,
				summary: result.status === "failed" || result.status === "cancelled"
					? "PI host bridge failed."
					: "PI host bridge completed.",
			});
			// Persistence is diagnostic state; it must not delay PI terminal settlement.
			void this.persistHostResult(result, startedAt, endedAt);
		} catch (error) {
			this.emit({
				type: "error",
				error,
				message: this.stringifyError(error) || "PI host bridge failed.",
			});
		}
	}

	private createDelegatedContext(options?: FridayPiPromptOptions): AgentExecutionContext {
		const delegatedContext = new AgentExecutionContext({
			turnId: this.context.turnId,
			taskId: this.context.taskId,
			traceId: this.context.traceId,
			conversationId: this.context.conversationId,
			agentId: this.context.agentId,
			mode: this.context.mode,
			startedAt: this.context.startedAt,
			signal: options?.signal ?? this.context.signal,
			budget: this.context.budget,
			metadata: this.context.metadata,
		});
		for (const event of this.context.snapshotEvents()) {
			delegatedContext.emit({
				type: event.type,
				at: event.at,
				status: event.status,
				taskId: event.taskId,
				payload: event.payload,
				failure: event.failure,
			});
		}
		return delegatedContext;
	}

	private async persistHostResult(result: AgentTurnResult, startedAt: string, endedAt: string): Promise<void> {
		const stateStore = this.options.stateStore;
		if (!stateStore) {
			return;
		}
		const ids = this.resolveResultIds(result);
		try {
			const workspacePolicy = this.resolveWorkspacePolicy();
			const packageRef = await stateStore.writePackageMetadata(LOCAL_BRIDGE_PACKAGE_METADATA);
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
		} catch (error) {
			// PI runtime-layer persistence must not change the user-facing host bridge result.
			this.reportPersistenceFailure(ids, error);
		}
	}

	private reportPersistenceFailure(
		ids: ReturnType<ObsidianFridayPiRuntimeHostSession["resolveResultIds"]>,
		error: unknown,
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
		console.warn("[Friday] PI runtime persistence failed.", metadata, error);
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
		this.delegatedContext?.cancel("PI host bridge session disposed.");
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
