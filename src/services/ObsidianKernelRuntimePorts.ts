import type { ChatMessage } from "./AIService";
import type { RuntimeTurnInput, RuntimeTurnResult } from "./AgentRuntimeService";
import { AIServiceModelDriverAdapter, type AIServiceModelDriver } from "./AIServiceModelDriverAdapter";
import { ToolExecutionAdapter } from "./ToolExecutionAdapter";
import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import { AgentLoopController } from "../core/agent-kernel/AgentLoopController";
import type { AgentTurnInput, AgentTurnResult, AgentTurnStatus } from "../core/agent-kernel/contracts";
import type { RuntimeEnvelope } from "../core/agent-kernel/RuntimeProtocol";
import type { AgentMode } from "../core/tools/ToolRegistry";
import type { RuntimeProgressEvent } from "../core/agent-kernel/contracts";
import type { PromptMentionContext } from "../core/context/PromptContextEngine";
import type { RuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { detectRuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { TurnStateMachine } from "../core/turn-state/TurnStateMachine";
import type { ToolDefinition } from "../types/tools";
import type { ToolGovernor } from "../core/tool-governor/ToolGovernor";
import type { ExecutionGate } from "../core/execution/ExecutionGate";
import type { ResolvedInvocation } from "../core/execution/ResolvedInvocation";

interface ObsidianKernelRuntimeHost {
	aiService: AIServiceModelDriver;
	lastContextSummary: RuntimeTurnResult["contextSummary"] | null;
	activeTurnId: string;
	activeConversationId: string;
	activeTaskId: string | undefined;
	activeTaskAbortController: AbortController | undefined;
	activeTurnSideEvents: unknown[];
	activeTurnStateMachine: TurnStateMachine | null;
	activeRuntimeProfile: RuntimeProfile;
	activeAgentMode: AgentMode;
	taskAbortControllers: Map<string, AbortController>;
	toolGovernor: ToolGovernor;
	executionGate: ExecutionGate;
	getSettings(): {
		agentRuntime: {
			toolCallingMode?: "auto" | "native" | "prompt";
			maxToolIterations?: number;
		};
	};
	buildAllowedToolSet(allowedTools: string[] | undefined): Set<string> | null;
	buildNativeToolDefinitions(settings: ReturnType<ObsidianKernelRuntimeHost["getSettings"]>, allowedTools: Set<string> | null, agentMode: AgentMode): ToolDefinition[];
	resolveAgentMode(input: RuntimeTurnInput): AgentMode;
	executeTool(step: number, input: RuntimeTurnInput, tool: { name: string; args?: Record<string, unknown> }, allowedTools: Set<string> | null): Promise<{
		trace: AgentTurnResult["traces"][number];
		payload: {
			ok: boolean;
			tool: string;
			data?: unknown;
			error?: string;
		};
	}>;
	formatToolResultForModel(payload: { ok: boolean; tool: string; data?: unknown; error?: string }): string;
	extractLoadedSkillSystemContext(payload: { ok: boolean; tool: string; data?: unknown; error?: string }): string;
	recordMutationPlansFromEnvelope(envelope: RuntimeEnvelope): AgentTurnResult["pendingMutations"];
	buildRuntimeHistory(conversation: ChatMessage[]): ChatMessage[];
	buildSystemPrompt(input: RuntimeTurnInput, depth: number): Promise<string>;
	reportProgress(input: RuntimeTurnInput, event: RuntimeProgressEvent): void;
	startAgentTaskForTurn(input: RuntimeTurnInput, turnId: string, conversationId: string): Promise<{ id: string }>;
	assertActiveTaskNotCancelled(): void;
	buildRuntimeTurnInvocation(input: RuntimeTurnInput): ResolvedInvocation;
	finalizeTurnResult(turnId: string, result: RuntimeTurnResult, userPrompt: string): Promise<RuntimeTurnResult>;
	markActiveTaskFailure(message: string): Promise<void>;
	persistTurnEvents(
		turnId: string,
		conversationId: string,
		stepTraces: unknown[],
		options: { failureMessage?: string; taskId?: string },
	): Promise<void>;
	truncateText(text: string, maxLength: number): string;
}

export function createObsidianAgentLoopController(runtime: ObsidianKernelRuntimeHost): AgentLoopController {
	let contextAbortListener: (() => void) | undefined;
	let activeAbortListener: (() => void) | undefined;
	const modelDriver = new AIServiceModelDriverAdapter(runtime.aiService);
	const toolExecution = new ToolExecutionAdapter({
		listNativeTools: async ({ input }) => {
			const runtimeInput = toRuntimeTurnInput(input);
			const settings = runtime.getSettings();
			const allowedToolSet = runtime.buildAllowedToolSet(runtimeInput.allowedTools);
			return runtime.buildNativeToolDefinitions(settings, allowedToolSet, runtime.resolveAgentMode(runtimeInput));
		},
		executeTool: async ({ input, step, tool }) => {
			const runtimeInput = toRuntimeTurnInput(input);
			const allowedToolSet = runtime.buildAllowedToolSet(runtimeInput.allowedTools);
			const result = await runtime.executeTool(step, runtimeInput, {
				name: tool.name,
				args: tool.args,
			}, allowedToolSet);
			return {
				...result,
				modelResultText: runtime.formatToolResultForModel(result.payload),
				loadedSkillContext: runtime.extractLoadedSkillSystemContext(result.payload),
			};
		},
		recordMutationPlans: (envelope) => runtime.recordMutationPlansFromEnvelope(envelope) ?? [],
	});
	return new AgentLoopController({
		contextEngine: {
			buildContext: async (input, context) => {
				const runtimeInput = toRuntimeTurnInput(input);
				const settings = runtime.getSettings();
				const depth = runtimeInput.depth ?? 0;
				const history = runtime.buildRuntimeHistory(runtimeInput.conversation);
				const systemPrompt = await runtime.buildSystemPrompt(runtimeInput, depth);
				const contextSummary = runtime.lastContextSummary ?? undefined;
				if (contextSummary) {
					context.emit({
						type: "context_compacted",
						payload: {
							used: contextSummary.used,
							softLimit: contextSummary.softLimit,
							hardLimit: contextSummary.hardLimit,
							trimmedChannels: [...contextSummary.trimmedChannels],
							overflowChannels: [...(contextSummary.overflowChannels ?? [])],
						},
					});
				}
				return {
					toolCallingMode: settings.agentRuntime.toolCallingMode ?? "auto",
					maxIterations: Math.max(1, settings.agentRuntime.maxToolIterations || 1),
					messages: [
						{ role: "system", content: systemPrompt },
						...history,
						{ role: "user", content: runtimeInput.userPrompt },
					],
					contextSummary,
				};
			},
		},
		modelDriver,
		toolExecution,
		progress: {
			report: (input, event) => runtime.reportProgress(toRuntimeTurnInput(input), event),
		},
		fallbackPolicy: {
			isRetryableTransportFailure: (message) => runtime.toolGovernor.isRetryableTransportFailure(message),
			shouldFallbackToPrompt: (message) => runtime.toolGovernor.shouldFallbackToPrompt(message),
		},
		lifecycle: {
			begin: async (input, context) => {
				const runtimeInput = toRuntimeTurnInput(input);
				runtime.lastContextSummary = null;
				runtime.activeTurnId = context.turnId;
				runtime.activeConversationId = context.conversationId;
				runtime.activeTaskId = undefined;
				runtime.activeTaskAbortController = new AbortController();
				runtime.activeTurnSideEvents = [];
				runtime.activeTurnStateMachine = new TurnStateMachine(context.turnId);
				runtime.activeRuntimeProfile = detectRuntimeProfile();
				runtime.activeAgentMode = runtime.resolveAgentMode(runtimeInput);
				contextAbortListener = () => runtime.activeTaskAbortController?.abort(context.getCancelReason());
				activeAbortListener = () => context.cancel(runtime.activeTaskAbortController?.signal.reason);
				if (context.signal.aborted) {
					runtime.activeTaskAbortController.abort(context.getCancelReason());
				} else {
					context.signal.addEventListener("abort", contextAbortListener, { once: true });
				}
				runtime.activeTaskAbortController.signal.addEventListener("abort", activeAbortListener, { once: true });
				const activeTask = await runtime.startAgentTaskForTurn(runtimeInput, context.turnId, context.conversationId);
				context.setTaskId(activeTask.id);
				if (runtime.activeTaskAbortController) {
					runtime.taskAbortControllers.set(activeTask.id, runtime.activeTaskAbortController);
				}
				runtime.assertActiveTaskNotCancelled();
				runtime.reportProgress(runtimeInput, {
					phase: "start",
					depth: runtimeInput.depth ?? 0,
					message: `Runtime started (mode=${runtime.getSettings().agentRuntime.toolCallingMode ?? "auto"}, depth=${runtimeInput.depth ?? 0}, profile=${runtime.activeRuntimeProfile.id})`,
				});
				const gateDecision = runtime.executionGate.evaluate(runtime.buildRuntimeTurnInvocation(runtimeInput), runtime.activeRuntimeProfile);
				if (!gateDecision.allow) {
					runtime.reportProgress(runtimeInput, {
						phase: "error",
						depth: runtimeInput.depth ?? 0,
						message: `Runtime blocked: ${gateDecision.reason}`,
					});
					return withKernelStatus(await runtime.finalizeTurnResult(
						context.turnId,
						{
							assistantText: gateDecision.reason,
							traces: [],
							rawFinalReply: gateDecision.reason,
							parseError: gateDecision.reason,
						},
						runtimeInput.userPrompt,
					), context);
				}
				return undefined;
			},
			complete: async (input, context, result) => {
				const runtimeInput = toRuntimeTurnInput(input);
				const finalized = await runtime.finalizeTurnResult(context.turnId, result, runtimeInput.userPrompt);
				return withKernelStatus(finalized, context);
			},
			fail: async (input, context, error) => {
				const runtimeInput = toRuntimeTurnInput(input);
				const message = error instanceof Error ? error.message : String(error ?? "");
				runtime.reportProgress(runtimeInput, {
					phase: "error",
					depth: runtimeInput.depth ?? 0,
					message: `Runtime failed: ${runtime.truncateText(message, 220)}`,
				});
				await runtime.markActiveTaskFailure(message);
				await runtime.persistTurnEvents(
					context.turnId,
					context.conversationId,
					runtime.activeTurnStateMachine?.snapshot() ?? [],
					{ failureMessage: message, taskId: runtime.activeTaskId },
				);
			},
			cleanup: async (_input, context) => {
				if (contextAbortListener) {
					context.signal.removeEventListener("abort", contextAbortListener);
				}
				if (activeAbortListener) {
					runtime.activeTaskAbortController?.signal.removeEventListener("abort", activeAbortListener);
				}
				runtime.activeTurnId = "";
				runtime.activeConversationId = "default";
				if (runtime.activeTaskId) {
					runtime.taskAbortControllers.delete(runtime.activeTaskId);
				}
				runtime.activeTaskId = undefined;
				runtime.activeTaskAbortController = undefined;
				runtime.activeTurnSideEvents = [];
				runtime.activeTurnStateMachine = null;
				runtime.activeAgentMode = "ask";
			},
		},
	});
}

function toRuntimeTurnInput(input: AgentTurnInput | undefined): RuntimeTurnInput {
	return {
		turnId: input?.turnId,
		conversationId: input?.conversationId,
		agentId: input?.agentId ?? "default",
		conversation: (input?.conversation ?? []) as ChatMessage[],
		userPrompt: input?.userPrompt ?? "",
		modelOverride: input?.modelOverride,
		depth: input?.depth,
		currentFilePath: input?.currentFilePath,
		extraSystemContext: input?.extraSystemContext,
		mentionContext: input?.mentionContext as PromptMentionContext | undefined,
		allowedTools: input?.allowedTools,
		agentMode: input?.mode ?? "ask",
		onProgress: input?.onProgress,
		signal: input?.signal,
		retryOfTaskId: input?.retryOfTaskId,
		continueFromTaskId: input?.continueFromTaskId,
	};
}

function withKernelStatus(result: RuntimeTurnResult, context: AgentExecutionContext): AgentTurnResult {
	const status = resolveKernelTurnStatus(result);
	return {
		...result,
		turnId: result.turnId ?? context.turnId,
		taskId: result.task?.id ?? context.taskId,
		traceId: context.traceId,
		conversationId: context.conversationId,
		status,
		events: context.snapshotEvents(),
		budget: context.budget,
	};
}

function resolveKernelTurnStatus(result: RuntimeTurnResult): AgentTurnStatus {
	switch (result.task?.status) {
		case "waiting_for_approval":
		case "waiting_for_user":
			return result.task.status;
		default:
			return "completed";
	}
}
