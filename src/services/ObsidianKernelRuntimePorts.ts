import type { ChatMessage } from "./AIService";
import type { RuntimeTurnInput, RuntimeTurnResult } from "./AgentRuntimeService";
import { AIServiceModelDriverAdapter, type AIServiceModelDriver } from "./AIServiceModelDriverAdapter";
import { ToolExecutionAdapter } from "./ToolExecutionAdapter";
import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import { AgentLoopController } from "../core/agent-kernel/AgentLoopController";
import type { AgentTurnInput, AgentTurnResult, AgentTurnStatus } from "../core/agent-kernel/contracts";
import type { AgentMode } from "../core/tools/ToolRegistry";
import type { RuntimeProgressEvent } from "../core/agent-kernel/contracts";
import type { PromptMentionContext } from "../core/context/PromptContextEngine";
import type { RuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { detectRuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { TurnStateMachine } from "../core/turn-state/TurnStateMachine";
import type { ToolCall, ToolDefinition } from "../types/tools";
import type { ToolGovernor } from "../core/tool-governor/ToolGovernor";
import type { ExecutionGate } from "../core/execution/ExecutionGate";
import type { ResolvedInvocation } from "../core/execution/ResolvedInvocation";
import type { ObsidianAgentStateAdapter } from "./ObsidianAgentStateAdapter";
import type { TurnEventInput } from "../core/runtime/TurnEventLog";
import type { ToolResultPayload } from "../core/tools/ToolResultContract";

interface ObsidianKernelRuntimeHost {
	aiService: AIServiceModelDriver;
	lastContextSummary: RuntimeTurnResult["contextSummary"] | null;
	activeTurnId: string;
	activeConversationId: string;
	activeTaskId: string | undefined;
	activeTraceId: string;
	activeTaskAbortController: AbortController | undefined;
	activeTurnSideEvents: unknown[];
	activeTurnStateMachine: TurnStateMachine | null;
	activeRuntimeProfile: RuntimeProfile;
	activeAgentMode: AgentMode;
	kernelStateOwnsTaskLifecycle: boolean;
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
	executeTool(step: number, input: RuntimeTurnInput, tool: ToolCall, allowedTools: Set<string> | null): Promise<{
		trace: AgentTurnResult["traces"][number];
		payload: ToolResultPayload;
	}>;
	formatToolResultForModel(payload: ToolResultPayload): string;
	extractLoadedSkillSystemContext(payload: ToolResultPayload): string;
	buildRuntimeHistory(conversation: ChatMessage[]): ChatMessage[];
	buildSystemPrompt(input: RuntimeTurnInput, depth: number): Promise<string>;
	reportProgress(input: RuntimeTurnInput, event: RuntimeProgressEvent): void;
	assertActiveTaskNotCancelled(): void;
	buildRuntimeTurnInvocation(input: RuntimeTurnInput): ResolvedInvocation;
	truncateText(text: string, maxLength: number): string;
	getAgentStateAdapter(): ObsidianAgentStateAdapter;
}

export function createObsidianAgentLoopController(runtime: ObsidianKernelRuntimeHost): AgentLoopController {
	let contextAbortListener: (() => void) | undefined;
	let activeAbortListener: (() => void) | undefined;
	let activeContext: AgentExecutionContext | undefined;
	const stateAdapter = runtime.getAgentStateAdapter();
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
			if (activeContext && shouldTrackHumanApproval(tool.name)) {
				await stateAdapter.taskManager.requestApproval(activeContext, {
					kind: "tool",
					tool: tool.name,
					summary: `Approve ${tool.name}.`,
				});
			}
			const result = await runtime.executeTool(step, runtimeInput, {
				id: tool.id,
				name: tool.name,
				args: tool.args,
			}, allowedToolSet);
			if (activeContext && shouldTrackHumanApproval(tool.name)) {
				await stateAdapter.taskManager.resolveApproval(activeContext, {
					tool: tool.name,
					approved: result.trace.status !== "denied",
					reason: result.trace.approvalReason,
				});
			}
			return {
				...result,
				modelResultText: runtime.formatToolResultForModel(result.payload),
				loadedSkillContext: runtime.extractLoadedSkillSystemContext(result.payload),
			};
		},
		recordMutationPlans: (envelope, source, context) =>
			context ? stateAdapter.recordMutationPlansFromEnvelope(envelope, source, context) : [],
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
			report: (input, event) => {
				runtime.reportProgress(toRuntimeTurnInput(input), activeContext?.taskId && !event.taskId
					? { ...event, taskId: activeContext.taskId }
					: event);
			},
		},
		fallbackPolicy: {
			isRetryableTransportFailure: (message) => runtime.toolGovernor.isRetryableTransportFailure(message),
			shouldFallbackToPrompt: (message) => runtime.toolGovernor.shouldFallbackToPrompt(message),
		},
		checkpoint: {
			save: (checkpoint) => stateAdapter.saveCheckpoint(checkpoint),
			getResumeCheckpoint: (input, context) => stateAdapter.getResumeCheckpoint(input, context),
			markConsumed: (checkpointId, result, reason) =>
				stateAdapter.markCheckpointConsumed(checkpointId, result, reason),
		},
		lifecycle: {
			begin: async (input, context) => {
				const runtimeInput = toRuntimeTurnInput(input);
				activeContext = context;
				runtime.lastContextSummary = null;
				runtime.activeTurnId = context.turnId;
				runtime.activeConversationId = context.conversationId;
				runtime.activeTraceId = context.traceId;
				runtime.activeTaskId = undefined;
				runtime.activeTaskAbortController = new AbortController();
				runtime.activeTurnSideEvents = [];
				runtime.activeTurnStateMachine = new TurnStateMachine(context.turnId);
				runtime.activeRuntimeProfile = detectRuntimeProfile();
				runtime.activeAgentMode = runtime.resolveAgentMode(runtimeInput);
				runtime.kernelStateOwnsTaskLifecycle = true;
				contextAbortListener = () => runtime.activeTaskAbortController?.abort(context.getCancelReason());
				activeAbortListener = () => context.cancel(runtime.activeTaskAbortController?.signal.reason);
				if (context.signal.aborted) {
					runtime.activeTaskAbortController.abort(context.getCancelReason());
				} else {
					context.signal.addEventListener("abort", contextAbortListener, { once: true });
				}
				runtime.activeTaskAbortController.signal.addEventListener("abort", activeAbortListener, { once: true });
				const activeTask = await stateAdapter.beginTurn(input, context);
				context.setTaskId(activeTask.id);
				// Compatibility bridge for legacy Obsidian tool IO helpers; task transitions are kernel-owned above.
				runtime.activeTaskId = activeTask.id;
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
					return withKernelStatus(await stateAdapter.completeTurn(input, context, {
							assistantText: gateDecision.reason,
							traces: [],
							rawFinalReply: gateDecision.reason,
							parseError: gateDecision.reason,
							turnId: context.turnId,
							taskId: context.taskId,
							traceId: context.traceId,
							conversationId: context.conversationId,
							status: "failed",
							events: context.snapshotEvents(),
							budget: context.budget,
						}, {
							stepTraces: runtime.activeTurnStateMachine?.snapshot() ?? [],
							sideEvents: filterKernelCompatibleSideEvents(runtime.activeTurnSideEvents),
							runtimeProfile: runtime.activeRuntimeProfile,
							contextSummary: runtime.lastContextSummary ?? undefined,
						}), context);
				}
				return undefined;
			},
			complete: async (input, context, result) => {
				const finalized = await stateAdapter.completeTurn(input, context, result, {
					stepTraces: runtime.activeTurnStateMachine?.snapshot() ?? [],
					sideEvents: filterKernelCompatibleSideEvents(runtime.activeTurnSideEvents),
					runtimeProfile: runtime.activeRuntimeProfile,
					contextSummary: runtime.lastContextSummary ?? undefined,
				});
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
				await stateAdapter.failTurn(error, context, {
					stepTraces: runtime.activeTurnStateMachine?.snapshot() ?? [],
					sideEvents: filterKernelCompatibleSideEvents(runtime.activeTurnSideEvents),
				});
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
				runtime.activeTraceId = "";
				if (runtime.activeTaskId) {
					runtime.taskAbortControllers.delete(runtime.activeTaskId);
				}
				runtime.activeTaskId = undefined;
				runtime.activeTaskAbortController = undefined;
				runtime.activeTurnSideEvents = [];
				runtime.activeTurnStateMachine = null;
				runtime.activeAgentMode = "ask";
				runtime.kernelStateOwnsTaskLifecycle = false;
				activeContext = undefined;
			},
		},
	});
}

function shouldTrackHumanApproval(toolName: string): boolean {
	return !["use_skill", "ls", "read", "grep", "search_text", "glob"].includes(toolName.trim().toLowerCase());
}

function filterKernelCompatibleSideEvents(events: unknown[]): TurnEventInput[] {
	return events.filter((event): event is TurnEventInput => {
		if (!event || typeof event !== "object") {
			return false;
		}
		const type = (event as { type?: unknown }).type;
		return typeof type === "string" && type.startsWith("mutation_");
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
		resumeFromCheckpointId: input?.resumeFromCheckpointId,
		metadata: input?.metadata,
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
	if (
		result.status === "failed" ||
		result.status === "cancelled" ||
		result.status === "waiting_for_approval" ||
		result.status === "waiting_for_user" ||
		result.status === "safe_stopped"
	) {
		return result.status;
	}
	switch (result.task?.status) {
		case "waiting_for_approval":
		case "waiting_for_user":
			return result.task.status;
		default:
			return "completed";
	}
}
