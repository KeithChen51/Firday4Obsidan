import type { AgentExecutionContext } from "../../core/agent-kernel/AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, RuntimeToolTrace } from "../../core/agent-kernel/contracts";
import { RealPiSdkSessionHostAdapter, type RealPiSdkSessionHostAdapterOptions } from "../../core/agent-kernel/pi/RealPiSdkSessionAdapter";
import type {
	FridayPiPromptOptions,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionListener,
	FridayPiSessionPort,
	FridayPiSessionUnsubscribe,
} from "../../core/agent-kernel/pi/FridayPiRuntimePorts";
import type { DesktopHostAdapter, DesktopPermissionMode, DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { DesktopTraceEvent } from "../contracts/TraceHostPort";

export type DesktopFridayPiRuntimeHost = Pick<
	DesktopHostAdapter,
	"project" | "runtimeState" | "trace" | "tools"
>;

export interface DesktopFridayPiRuntimeHostAdapterOptions {
	desktopHost: DesktopFridayPiRuntimeHost;
	sessionHost?: FridayPiSessionHostPort;
	realPiSdkOptions?: RealPiSdkSessionHostAdapterOptions;
	projectId?: string;
	projectRoot?: string;
	permissionMode?: DesktopPermissionMode;
	clock?: () => Date;
}

export class DesktopFridayPiRuntimeHostAdapter implements FridayPiSessionHostPort {
	private readonly sessionHost: FridayPiSessionHostPort;
	private readonly clock: () => Date;

	constructor(private readonly options: DesktopFridayPiRuntimeHostAdapterOptions) {
		this.sessionHost = options.sessionHost ?? new RealPiSdkSessionHostAdapter(options.realPiSdkOptions);
		this.clock = options.clock ?? (() => new Date());
	}

	async createSession(input: AgentTurnInput, context: AgentExecutionContext): Promise<FridayPiSessionPort> {
		const desktopContext = await this.resolveDesktopContext(input, context);
		await this.options.desktopHost.runtimeState.saveConversation({
			id: desktopContext.conversationId,
			projectId: desktopContext.projectId,
			title: summarizePrompt(input.userPrompt),
			createdAt: context.startedAt,
			updatedAt: this.now(),
		});
		await this.options.desktopHost.trace.appendTraceEvent(desktopContext, {
			type: "pi_session_created",
			at: this.now(),
			summary: "PI session created for desktop host.",
			payload: {
				agentId: context.agentId,
				mode: context.mode,
				permissionMode: desktopContext.permissionMode,
			},
		});

		const session = await this.sessionHost.createSession(input, context);
		return new DesktopFridayPiRuntimeSession({
			session,
			input,
			context,
			desktopContext,
			desktopHost: this.options.desktopHost,
			clock: this.clock,
		});
	}

	private async resolveDesktopContext(
		input: AgentTurnInput,
		context: AgentExecutionContext,
	): Promise<DesktopTurnContext> {
		const activeProject = await this.options.desktopHost.project.getActiveProject().catch(() => null);
		const metadataProjectId = asString(context.metadata.projectId);
		const metadataProjectRoot = asString(context.metadata.projectRoot);
		const projectRoot = this.options.projectRoot ?? activeProject?.root ?? metadataProjectRoot;
		if (!projectRoot) {
			throw new Error(
				"Desktop PI runtime requires a projectRoot from adapter options, active project, or turn metadata.",
			);
		}
		return {
			projectId: this.options.projectId ?? activeProject?.id ?? metadataProjectId ?? "desktop-project",
			conversationId: context.conversationId || input.conversationId,
			turnId: context.turnId || input.turnId || "turn",
			permissionMode: this.options.permissionMode ?? normalizePermissionMode(context.metadata.permissionMode),
			projectRoot,
		};
	}

	private now(): string {
		return this.clock().toISOString();
	}
}

interface DesktopFridayPiRuntimeSessionOptions {
	session: FridayPiSessionPort;
	input: AgentTurnInput;
	context: AgentExecutionContext;
	desktopContext: DesktopTurnContext;
	desktopHost: DesktopFridayPiRuntimeHost;
	clock: () => Date;
}

class DesktopFridayPiRuntimeSession implements FridayPiSessionPort {
	private readonly listeners = new Set<FridayPiSessionListener>();
	private readonly persistedToolTraceKeys = new Set<string>();
	private delegateUnsubscribe?: FridayPiSessionUnsubscribe;
	private persistenceQueue: Promise<void> = Promise.resolve();
	private disposed = false;
	private userPromptPersisted = false;
	private terminalTurnPersisted = false;
	private terminalCandidate?: {
		status: AgentTurnResult["status"];
		content: string;
	};
	private finalAssistantText = "";
	private readonly textDeltas: string[] = [];

	constructor(private readonly options: DesktopFridayPiRuntimeSessionOptions) {}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		this.ensureDelegateSubscription();
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(text: string, options?: FridayPiPromptOptions): Promise<void> {
		this.assertActive();
		if (!this.userPromptPersisted) {
			this.userPromptPersisted = true;
			this.enqueuePersistence(() => this.persistUserPrompt(text));
		}
		this.enqueuePersistence(async () => {
			await this.appendTraceEvent({
				type: "pi_prompt_started",
				at: this.now(),
				summary: "PI prompt started through desktop host.",
				payload: {
					promptLength: text.length,
				},
			});
		});
		await this.options.session.prompt(text, options);
	}

	async steer(text: string, options?: FridayPiPromptOptions): Promise<void> {
		this.assertActive();
		if (!this.options.session.steer) {
			throw new Error("Wrapped PI session does not expose steer().");
		}
		await this.options.session.steer(text, options);
	}

	async followUp(text: string, options?: FridayPiPromptOptions): Promise<void> {
		this.assertActive();
		if (!this.options.session.followUp) {
			throw new Error("Wrapped PI session does not expose followUp().");
		}
		await this.options.session.followUp(text, options);
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		try {
			this.delegateUnsubscribe?.();
		} finally {
			this.listeners.clear();
		}
		this.enqueuePersistence(async () => {
			if (this.terminalCandidate) {
				await this.persistTerminalTurn(this.terminalCandidate.status, this.terminalCandidate.content);
			}
			await this.appendTraceEvent({
				type: "pi_session_disposed",
				at: this.now(),
				summary: "PI session disposed through desktop host.",
				payload: {
					turnId: this.options.desktopContext.turnId,
				},
			});
		});
		await this.options.session.dispose?.();
		await this.flushPersistence();
	}

	private ensureDelegateSubscription(): void {
		if (this.delegateUnsubscribe) {
			return;
		}
		this.delegateUnsubscribe = this.options.session.subscribe((event) => {
			this.handleSessionEvent(event);
			for (const listener of [...this.listeners]) {
				listener(event);
			}
		});
	}

	private handleSessionEvent(event: FridayPiSessionEvent): void {
		switch (event.type) {
			case "text_delta":
				this.textDeltas.push(event.text);
				break;
			case "text_final":
				this.finalAssistantText = event.text;
				break;
			case "tool_call":
				this.enqueuePersistence(() => this.persistToolCall(event));
				break;
			case "tool_result":
				this.enqueuePersistence(() => this.persistToolResult(event));
				break;
			case "host_result":
				this.finalAssistantText = event.result.assistantText;
				this.enqueuePersistence(() => this.persistHostResult(event.result));
				break;
			case "done":
			case "session_end":
				this.terminalCandidate = {
					status: "completed",
					content: this.assistantText(),
				};
				break;
			case "error":
				this.terminalCandidate = {
					status: "failed",
					content: event.message ?? stringifyError(event.error),
				};
				break;
		}
	}

	private async persistUserPrompt(text: string): Promise<void> {
		await this.options.desktopHost.runtimeState.saveTurn(this.options.desktopContext, {
			id: `${this.options.desktopContext.turnId}:user`,
			conversationId: this.options.desktopContext.conversationId,
			role: "user",
			content: text,
			createdAt: this.now(),
		});
	}

	private async persistToolCall(event: Extract<FridayPiSessionEvent, { type: "tool_call" }>): Promise<void> {
		await this.appendTraceEvent({
			type: "pi_tool_call",
			at: this.now(),
			summary: event.summary ?? `PI requested ${event.tool}.`,
			payload: {
				runId: event.runId,
				step: event.step,
				tool: event.tool,
				scope: event.scope,
				targetPath: event.targetPath,
				summary: event.summary,
			},
		});
	}

	private async persistToolResult(event: Extract<FridayPiSessionEvent, { type: "tool_result" }>): Promise<void> {
		const key = toolTraceKey(event.runId, event.step, event.tool);
		if (this.persistedToolTraceKeys.has(key)) {
			return;
		}
		await this.appendTraceEvent({
			type: "pi_tool_result",
			at: this.now(),
			summary: event.summary ?? event.error ?? `${event.tool} completed.`,
			payload: {
				runId: event.runId,
				step: event.step,
				tool: event.tool,
				scope: event.scope,
				targetPath: event.targetPath,
				status: event.status,
				ok: event.ok,
				error: event.error,
				summary: event.summary,
			},
		});
		this.persistedToolTraceKeys.add(key);
	}

	private async persistHostResult(result: AgentTurnResult): Promise<void> {
		for (const trace of result.traces ?? []) {
			await this.persistRuntimeToolTrace(trace);
		}
		this.terminalCandidate = {
			status: result.status,
			content: result.assistantText || result.rawFinalReply || "",
		};
	}

	private async persistRuntimeToolTrace(trace: RuntimeToolTrace): Promise<void> {
		const key = toolTraceKey(trace.runId, trace.step, trace.tool);
		if (this.persistedToolTraceKeys.has(key)) {
			return;
		}
		await this.appendTraceEvent({
			type: "pi_tool_result",
			at: this.now(),
			summary: trace.summary,
			payload: {
				runId: trace.runId,
				step: trace.step,
				tool: trace.tool,
				scope: trace.scope,
				targetPath: trace.targetPath,
				status: trace.status,
				ok: trace.ok,
				error: trace.error,
				summary: trace.summary,
			},
		});
		this.persistedToolTraceKeys.add(key);
	}

	private async persistTerminalTurn(status: AgentTurnResult["status"], content: string): Promise<void> {
		if (this.terminalTurnPersisted) {
			return;
		}
		this.terminalTurnPersisted = true;
		await this.options.desktopHost.runtimeState.saveTurn(this.options.desktopContext, {
			id: `${this.options.desktopContext.turnId}:assistant`,
			conversationId: this.options.desktopContext.conversationId,
			role: "assistant",
			content,
			createdAt: this.now(),
		});
		await this.appendTraceEvent({
			type: "pi_session_finished",
			at: this.now(),
			summary: `PI session ${status}.`,
			payload: {
				status,
				assistantTextLength: content.length,
			},
		});
	}

	private appendTraceEvent(event: DesktopTraceEvent): Promise<DesktopTraceEvent> {
		return this.options.desktopHost.trace.appendTraceEvent(this.options.desktopContext, event);
	}

	private enqueuePersistence(action: () => Promise<void>): void {
		this.persistenceQueue = this.persistenceQueue.then(action, action).catch((error) => {
			console.warn("[Friday] Desktop PI persistence failed.", {
				conversationId: this.options.desktopContext.conversationId,
				turnId: this.options.desktopContext.turnId,
			}, error);
		});
	}

	private async flushPersistence(): Promise<void> {
		await this.persistenceQueue;
	}

	private assistantText(): string {
		return this.finalAssistantText || this.textDeltas.join("");
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error("Desktop PI runtime session has been disposed.");
		}
	}

	private now(): string {
		return this.options.clock().toISOString();
	}
}

function normalizePermissionMode(value: unknown): DesktopPermissionMode {
	if (value === "safe" || value === "standard" || value === "autonomous") {
		return value;
	}
	return "standard";
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function summarizePrompt(prompt: string): string {
	const normalized = prompt.replace(/\s+/g, " ").trim();
	return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}

function toolTraceKey(runId: string | undefined, step: number | undefined, tool: string): string {
	return `${runId ?? ""}:${step ?? ""}:${tool}`;
}

function stringifyError(error: unknown): string {
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
