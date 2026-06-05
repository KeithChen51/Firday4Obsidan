import type { ToolCall } from "../../types/tools";
import { ToolBoundaryFilter, type ToolBoundaryMessage, type ToolBoundaryRepair } from "../context/ToolBoundaryFilter";
import { formatForModel, formatToolResultChannels, summarizeForUserFallback } from "../tools/ToolResultFormatter";
import type { ToolResultPayload, ToolResultRecovery } from "../tools/ToolResultContract";
import type { LlmTransportEvent } from "../llm/LlmTransportTelemetry";
import type { ReasoningArtifact } from "../llm/ReasoningArtifact";
import type { AgentExecutionContext } from "./AgentExecutionContext";
import { AgentFailureClassifier } from "./AgentFailureClassifier";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "./AgentKernelPorts";
import { AgentLoopControlTracker, createToolInvocationFingerprint, type AgentLoopRepetition } from "./AgentLoopControl";
import type { AgentLoopCheckpointPort, AgentLoopFallbackPolicy, AgentLoopLifecyclePort, AgentLoopProgressPort } from "./AgentLoopTypes";
import type { ContextEnginePort, ContextPackage } from "./ContextEnginePort";
import type { ModelDriverPort } from "./ModelDriverPort";
import type { ToolExecutionPort, ToolExecutionResult } from "./ToolExecutionPort";
import { ToolRegistry } from "../tools/ToolRegistry";
import {
	createAgentLoopCheckpointId,
	sanitizeAgentLoopCheckpoint,
	validateCheckpointForResume,
	type AgentLoopCheckpoint,
	type AgentCheckpointToolResultRef,
	type AgentLoopCheckpointBoundary,
} from "./checkpoints/AgentLoopCheckpoint";
import {
	hasMutationPlans,
	isResponseEnvelope,
	LOOP_CONTROL_SAFE_ASSISTANT_TEXT,
	LOOP_CONTROL_SAFE_SUMMARY,
	MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT,
	MAX_TOOL_ITERATION_SAFE_SUMMARY,
	parseKernelRuntimeEnvelope,
	type RuntimeEnvelope,
} from "./RuntimeProtocol";
import type {
	AgentChatMessage,
	AgentNarrationPayload,
	AgentTurnEvent,
	AgentTurnInput,
	AgentTurnResult,
	RuntimeMutationPlan,
	RuntimeProgressEvent,
	RuntimeToolTrace,
} from "./contracts";
import {
	completePlanTask,
	completePlanState,
	createPlanState,
	getIntakeRouteDefaults,
	inferInteractionRouteFromLegacy,
	normalizePlanState,
	revisePlanState,
	skipPlanState,
	type IntakeDecision,
	type IntakeComplexity,
	type IntakeInteractionRoute,
	type PlanRevisionChange,
	type PlanState,
	type RuntimePlanCreateInstruction,
	type RuntimePlanInstruction,
	type RuntimePlanReviseInstruction,
	type RuntimePlanSkipInstruction,
	type RuntimePlanTaskInstruction,
} from "./PlanState";

export interface AgentLoopControllerOptions {
	contextEngine: ContextEnginePort;
	modelDriver: ModelDriverPort;
	toolExecution: ToolExecutionPort;
	progress?: AgentLoopProgressPort;
	lifecycle?: AgentLoopLifecyclePort;
	checkpoint?: AgentLoopCheckpointPort;
	fallbackPolicy?: AgentLoopFallbackPolicy;
	failureClassifier?: AgentFailureClassifierPort;
}

interface AgentLoopInitialState {
	startStep?: number;
	traces?: RuntimeToolTrace[];
}

interface ActivePlanState {
	current: PlanState | null;
	contextReady: boolean;
	executionStarted: boolean;
	finalStarted: boolean;
	intakeEmitted: boolean;
	lastEmittedPlanSignature?: string;
	missingModelPlanReminderEmitted?: boolean;
	finalPlanSyncRequested?: boolean;
	source?: "model" | "runtime" | "fallback" | "legacy";
}

type NativeNoToolResultResolution =
	| { kind: "terminal"; result: AgentTurnResult }
	| { kind: "continue"; lastToolPayload: ToolExecutionResult["payload"]; lastToolUserFallback?: string; loopRepetition?: AgentLoopRepetition };

type LoopToolExecutionResult = ToolExecutionResult & {
	loopRepetition?: AgentLoopRepetition;
};

interface NativeToolBatchExecution {
	toolCall: ToolCall;
	executed: LoopToolExecutionResult;
}

interface MissingModelTaskBarSuppression {
	reminder: string;
	shouldDeferToolExecution: boolean;
}

const MIN_EMERGENCY_FUSE_ITERATIONS = 50;
const MAX_EMERGENCY_FUSE_ITERATIONS = 500;
const EMERGENCY_FUSE_MULTIPLIER = 10;

export class AgentLoopController implements RuntimeTurnExecutorPort {
	private readonly failureClassifier: AgentFailureClassifierPort;
	private readonly toolBoundaryFilter = new ToolBoundaryFilter();

	constructor(private readonly options: AgentLoopControllerOptions) {
		this.failureClassifier = options.failureClassifier ?? new AgentFailureClassifier();
	}

	async execute(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult> {
		try {
			const blockedResult = await this.options.lifecycle?.begin?.(input, context);
			if (blockedResult) {
				return blockedResult;
			}
			const result = await this.runConfiguredLoop(input, context);
			const completed = await this.options.lifecycle?.complete?.(input, context, result) ?? result;
			this.emitTerminalProgress(input, completed);
			return completed;
		} catch (error) {
			const failed = await this.options.lifecycle?.fail?.(input, context, error);
			if (failed) {
				return failed;
			}
			throw error;
		} finally {
			await this.options.lifecycle?.cleanup?.(input, context);
		}
	}

	private async runConfiguredLoop(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult> {
		const resumeCheckpoint = await this.resolveResumeCheckpoint(input, context);
		if (resumeCheckpoint) {
			const result = await this.runFromCheckpoint(input, context, resumeCheckpoint);
			this.emitCheckpointResumeCompleted(input, context, resumeCheckpoint);
			return result;
		}
		const activePlan: ActivePlanState = {
			current: null,
			contextReady: false,
			executionStarted: false,
			finalStarted: false,
			intakeEmitted: false,
		};
		const contextPackage = await this.options.contextEngine.buildContext(input, context, { channel: "native" });
		this.emitPlanContextReady(input, context, activePlan);
		if (contextPackage.toolCallingMode === "prompt") {
			await this.saveCheckpoint(input, context, {
				boundary: "context_ready",
				channel: "prompt",
				step: 0,
				nextStep: 1,
				maxIterations: contextPackage.maxIterations,
				modelMessages: contextPackage.messages,
				traces: [],
				safetyReason: "Context package built before prompt model request.",
			});
			const result = await this.runPromptLoop(input, context, contextPackage, {}, activePlan);
			this.emitPlanFinalizing(input, context, activePlan);
			this.emitPlanCompleted(input, context, activePlan);
			return result;
		}
		if (contextPackage.toolCallingMode === "native") {
			await this.saveCheckpoint(input, context, {
				boundary: "context_ready",
				channel: "native",
				step: 0,
				nextStep: 1,
				maxIterations: contextPackage.maxIterations,
				modelMessages: contextPackage.messages,
				traces: [],
				safetyReason: "Context package built before native model request.",
			});
			const result = await this.runNativeLoop(input, context, contextPackage, {}, activePlan);
			this.emitPlanFinalizing(input, context, activePlan);
			this.emitPlanCompleted(input, context, activePlan);
			return result;
		}
		try {
			await this.saveCheckpoint(input, context, {
				boundary: "context_ready",
				channel: "native",
				step: 0,
				nextStep: 1,
				maxIterations: contextPackage.maxIterations,
				modelMessages: contextPackage.messages,
				traces: [],
				safetyReason: "Context package built before native model request.",
			});
			const result = await this.runNativeLoop(input, context, contextPackage, {}, activePlan);
			this.emitPlanFinalizing(input, context, activePlan);
			this.emitPlanCompleted(input, context, activePlan);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			if (this.isRetryableTransportFailure(message)) {
				throw new Error(
					`模型服务或网关暂时不可用，已停止自动切换兼容模式，避免从当前步骤重新请求一次模型并产生额外消耗。${message}`,
				);
			}
			if (!this.shouldFallbackToPrompt(message)) {
				throw error;
			}
			this.emitFallback(input, context, message);
			const promptContext = await this.options.contextEngine.buildContext(input, context, { channel: "prompt" });
			await this.saveCheckpoint(input, context, {
				boundary: "context_ready",
				channel: "prompt",
				step: 0,
				nextStep: 1,
				maxIterations: promptContext.maxIterations,
				modelMessages: promptContext.messages,
				traces: [],
				safetyReason: "Prompt fallback context package built before model request.",
			});
			const result = await this.runPromptLoop(input, context, promptContext, {}, activePlan);
			this.emitPlanFinalizing(input, context, activePlan);
			this.emitPlanCompleted(input, context, activePlan);
			return {
				...result,
				parseError: result.parseError
					? `Native tool calling fallback: ${message}\n${result.parseError}`
					: `Native tool calling fallback: ${message}`,
			};
		}
	}

	private async runPromptLoop(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		contextPackage: ContextPackage,
		initialState: AgentLoopInitialState = {},
		activePlan?: ActivePlanState,
	): Promise<AgentTurnResult> {
		const startStep = initialState.startStep ?? 1;
		const maxIterations = Math.max(startStep, this.resolveMaxIterations(contextPackage, context));
		const emergencyFuseStep = this.resolveEmergencyFuseStep(startStep, maxIterations);
		const traces: RuntimeToolTrace[] = initialState.traces?.map((trace) => ({ ...trace })) ?? [];
		const modelMessages = [...contextPackage.messages];
		const loopControl = new AgentLoopControlTracker();
		const noProgressFinalizationReminders = new Set<string>();
		let finalReply = "";
		let lastToolUserFallback = "";
		let step = startStep;
		while (step <= emergencyFuseStep) {
			this.emitModelRequest(input, context, step, "prompt", modelMessages);
			const rawResponse = await this.options.modelDriver.requestText({
				messages: cloneMessages(modelMessages),
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: context.signal,
				step,
				taskId: context.taskId,
				traceId: context.traceId,
				budget: context.budget,
				onTransportEvent: (event) => this.emitModelTransport(input, context, step, event),
			});
			const response = normalizeTextModelResponse(rawResponse);
			finalReply = response.assistantText.trim();
			this.emitModelResponse(input, context, step, "prompt", response.assistantText, response.reasoningArtifact);

			const parsed = parseKernelRuntimeEnvelope(finalReply);
			if (!parsed) {
				const finalText = this.resolveFinalAssistantText(finalReply, traces, lastToolUserFallback, finalReply);
				return this.makeResult(input, context, {
					assistantText: finalText.assistantText,
					traces,
					rawFinalReply: finalReply,
					parseError: finalText.replacedTraceSummary
						? "Model returned a trace-only tool summary. Generated a product-facing fallback reply from tool results."
						: "Runtime response is not valid JSON; returned as plain text.",
					contextSummary: contextPackage.contextSummary,
				});
			}
			this.applyRuntimeEnvelopeProcess(input, context, parsed, activePlan);
			const terminal = await this.resolveTerminalEnvelope(input, context, parsed, finalReply, traces, contextPackage, lastToolUserFallback);
			if (terminal) {
				return terminal;
			}
			const tool = parsed.tool;
			if (parsed.type === "tool_call" || tool) {
				const modelNarration = this.extractModelNarration(parsed.assistant ?? "");
				if (modelNarration) {
					this.emitPlanExecutionStarted(input, context, activePlan);
					this.emitStageReport(input, context, {
						step,
						summary: modelNarration,
						justDone: modelNarration,
						next: "接下来会调用需要的工具获取证据。",
						source: "model",
						status: "running",
					});
				}
				if (!tool?.name) {
					return this.makeResult(input, context, {
						assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
						traces,
						rawFinalReply: finalReply,
						parseError: "tool.name is missing",
						contextSummary: contextPackage.contextSummary,
					});
				}
				const suppression = this.maybeSuppressMissingModelTaskBar(input, context, activePlan, [{
					name: tool.name,
					args: tool.args ?? {},
				}]);
				if (suppression.shouldDeferToolExecution) {
					modelMessages.push({
						role: "assistant",
						content: finalReply,
						...(response.reasoningArtifact?.hasReasoning ? { reasoningArtifact: response.reasoningArtifact } : {}),
					});
					if (suppression.reminder) {
						modelMessages.push({ role: "system", content: suppression.reminder });
					}
					await this.saveCheckpoint(input, context, {
						boundary: "after_model_response_before_tool_execution",
						channel: "prompt",
						step,
						nextStep: step + 1,
						maxIterations,
						modelMessages,
						traces,
						safetyReason: "Prompt tool execution deferred so the model can call plan_write first.",
					});
					step += 1;
					continue;
				}
				this.emitPlanExecutionStarted(input, context, activePlan);
				const executed = await this.executeTool(input, context, step, {
					name: tool.name,
					args: tool.args ?? {},
				}, loopControl, activePlan);
				traces.push(executed.trace);
				lastToolUserFallback = executed.userFallback?.trim() || lastToolUserFallback;
				modelMessages.push({
					role: "assistant",
					content: finalReply,
					...(response.reasoningArtifact?.hasReasoning ? { reasoningArtifact: response.reasoningArtifact } : {}),
				});
				modelMessages.push({ role: "user", content: executed.modelResultText });
				if (suppression.reminder) {
					modelMessages.push({ role: "system", content: suppression.reminder });
				}
				if (executed.loadedSkillContext) {
					modelMessages.push({ role: "system", content: executed.loadedSkillContext });
				}
				await this.saveCheckpoint(input, context, {
					boundary: "after_tool_result",
					channel: "prompt",
					step,
					nextStep: step + 1,
					maxIterations,
					modelMessages,
					traces,
					completedToolCalls: [{
						toolCallId: executed.trace.runId,
						tool: executed.trace.tool,
						status: executed.trace.status,
						step: executed.trace.step,
						targetPath: executed.trace.targetPath,
					}],
					safetyReason: "Prompt tool result appended to model messages.",
				});
				if (await this.deferRepeatedObservationForFinalAnswer(
					input,
					context,
					"prompt",
					step,
					maxIterations,
					modelMessages,
					traces,
					executed.loopRepetition,
					noProgressFinalizationReminders,
				)) {
					step += 1;
					continue;
				}
				const loopControlStop = this.buildLoopControlStopResult(
					input,
					context,
					"prompt",
					step,
					executed.loopRepetition,
					finalReply,
					traces,
					contextPackage,
				);
				if (loopControlStop) {
					return loopControlStop;
				}
				step += 1;
				continue;
			}
			return this.makeResult(input, context, {
				assistantText: finalReply,
				traces,
				rawFinalReply: finalReply,
				parseError: "Unknown runtime envelope type.",
				contextSummary: contextPackage.contextSummary,
			});
		}
		return this.buildMaxToolIterationResult(
			input,
			context,
			"prompt",
			emergencyFuseStep,
			finalReply,
			traces,
			contextPackage,
			maxIterations,
		);
	}

	private async runNativeLoop(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		contextPackage: ContextPackage,
		initialState: AgentLoopInitialState = {},
		activePlan?: ActivePlanState,
	): Promise<AgentTurnResult> {
		const startStep = initialState.startStep ?? 1;
		const maxIterations = Math.max(startStep, this.resolveMaxIterations(contextPackage, context));
		const emergencyFuseStep = this.resolveEmergencyFuseStep(startStep, maxIterations);
		const traces: RuntimeToolTrace[] = initialState.traces?.map((trace) => ({ ...trace })) ?? [];
		const modelMessages = [...contextPackage.messages];
		const loopControl = new AgentLoopControlTracker();
		const noProgressFinalizationReminders = new Set<string>();
		const tools = await this.options.toolExecution.listNativeTools({ input, context, allowedTools: input.allowedTools });
		if (tools.length === 0) {
			return this.makeResult(input, context, {
				assistantText: "No tool is allowed for this command.",
				traces,
				rawFinalReply: "",
				contextSummary: contextPackage.contextSummary,
			});
		}

		let finalReply = "";
		let lastToolPayload: ToolExecutionResult["payload"] | null = null;
		let lastToolUserFallback = "";
		let step = startStep;
		while (step <= emergencyFuseStep) {
			const repairs = this.repairNativeModelMessages(modelMessages);
			if (repairs.length > 0) {
				this.reportNativeMessageRepairs(input, step, repairs);
			}
			this.emitModelRequest(input, context, step, "native", modelMessages);
			const response = await this.options.modelDriver.requestWithTools({
				messages: cloneMessages(modelMessages),
				tools,
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: context.signal,
				step,
				taskId: context.taskId,
				traceId: context.traceId,
				budget: context.budget,
				onTransportEvent: (event) => this.emitModelTransport(input, context, step, event),
			});
			const assistantStepText = response.assistantText?.trim() || "";
			const modelNarration = response.toolCalls.length > 0
				? this.extractModelNarration(assistantStepText)
				: "";
			if (modelNarration) {
				this.emitPlanExecutionStarted(input, context, activePlan);
				this.emitStageReport(input, context, {
					step,
					summary: modelNarration,
					justDone: modelNarration,
					next: "接下来会调用需要的工具获取证据。",
					source: "model",
					status: "running",
				});
			}
			if (assistantStepText && !modelNarration) {
				finalReply = assistantStepText;
			}
			this.emitModelResponse(input, context, step, "native", response.assistantText, response.reasoningArtifact);
			const nativeEnvelope = assistantStepText ? parseKernelRuntimeEnvelope(assistantStepText) : null;
			if (nativeEnvelope && response.toolCalls.length > 0) {
				this.applyRuntimeEnvelopeProcess(input, context, nativeEnvelope, activePlan);
			}

			if (response.toolCalls.length === 0) {
				const resolution = await this.resolveNativeNoToolResult(
					input,
					context,
					contextPackage,
					traces,
					modelMessages,
					step,
					maxIterations,
					assistantStepText,
					finalReply,
					lastToolPayload,
					lastToolUserFallback,
					loopControl,
					activePlan,
					response.reasoningArtifact,
				);
				if (resolution.kind === "continue") {
					lastToolPayload = resolution.lastToolPayload;
					lastToolUserFallback = resolution.lastToolUserFallback?.trim() || lastToolUserFallback;
					if (await this.deferRepeatedObservationForFinalAnswer(
						input,
						context,
						"native",
						step,
						maxIterations,
						modelMessages,
						traces,
						resolution.loopRepetition,
						noProgressFinalizationReminders,
					)) {
						step += 1;
						continue;
					}
					const loopControlStop = this.buildLoopControlStopResult(
						input,
						context,
						"native",
						step,
						resolution.loopRepetition,
						finalReply,
						traces,
						contextPackage,
					);
					if (loopControlStop) {
						return loopControlStop;
					}
					step += 1;
					continue;
				}
				return resolution.result;
			}

			const toolResultMessages: AgentChatMessage[] = [];
			const loadedSkillContexts: string[] = [];
			const completedToolCalls: AgentCheckpointToolResultRef[] = [];
			const suppression = this.maybeSuppressMissingModelTaskBar(input, context, activePlan, response.toolCalls);
			if (suppression.shouldDeferToolExecution) {
				if (assistantStepText) {
					modelMessages.push({
						role: "assistant",
						content: assistantStepText,
						...(response.reasoningArtifact?.hasReasoning ? { reasoningArtifact: response.reasoningArtifact } : {}),
					});
				}
				if (suppression.reminder) {
					modelMessages.push({ role: "system", content: suppression.reminder });
				}
				await this.saveCheckpoint(input, context, {
					boundary: "after_model_response_before_tool_execution",
					channel: "native",
					step,
					nextStep: step + 1,
					maxIterations,
					modelMessages,
					traces,
					safetyReason: "Native tool execution deferred so the model can call plan_write first.",
				});
				step += 1;
				continue;
			}
			this.emitPlanExecutionStarted(input, context, activePlan);
			const batchExecutions = await this.executeNativeToolBatch(input, context, step, response.toolCalls, loopControl, activePlan);
			const repeatedUnchanged = batchExecutions
				.map((item) => item.executed.loopRepetition)
				.filter((repetition): repetition is AgentLoopRepetition =>
					repetition?.kind === "repeated_unchanged_observation");
			const loopRepetition = repeatedUnchanged.length === batchExecutions.length
				? repeatedUnchanged[0]
				: undefined;
			for (const { toolCall, executed } of batchExecutions) {
				traces.push(executed.trace);
				lastToolPayload = executed.payload;
				lastToolUserFallback = executed.userFallback?.trim() || lastToolUserFallback;
				completedToolCalls.push({
					toolCallId: toolCall.id ?? executed.trace.runId,
					tool: executed.trace.tool,
					status: executed.trace.status,
					step: executed.trace.step,
					targetPath: executed.trace.targetPath,
				});
				toolResultMessages.push({
					role: "tool",
					content: executed.modelResultText,
					toolCallId: toolCall.id,
					name: toolCall.name,
				});
				if (executed.loadedSkillContext) {
					loadedSkillContexts.push(executed.loadedSkillContext);
				}
			}
			modelMessages.push({
				role: "assistant",
				content: response.assistantText?.trim() || "",
				toolCalls: response.toolCalls,
				...(response.reasoningArtifact?.hasReasoning ? { reasoningArtifact: response.reasoningArtifact } : {}),
			});
			modelMessages.push(...toolResultMessages);
			if (suppression.reminder) {
				modelMessages.push({ role: "system", content: suppression.reminder });
			}
			for (const loadedSkillContext of loadedSkillContexts) {
				modelMessages.push({ role: "system", content: loadedSkillContext });
			}
			await this.saveCheckpoint(input, context, {
				boundary: "after_tool_result",
				channel: "native",
				step,
				nextStep: step + 1,
				maxIterations,
				modelMessages,
				traces,
				completedToolCalls,
				safetyReason: "Native tool result appended to model messages.",
			});
			if (await this.deferRepeatedObservationForFinalAnswer(
				input,
				context,
				"native",
				step,
				maxIterations,
				modelMessages,
				traces,
				loopRepetition,
				noProgressFinalizationReminders,
			)) {
				step += 1;
				continue;
			}
			const loopControlStop = this.buildLoopControlStopResult(
				input,
				context,
				"native",
				step,
				loopRepetition,
				finalReply,
				traces,
				contextPackage,
			);
			if (loopControlStop) {
				return loopControlStop;
			}
			step += 1;
		}
		return this.buildMaxToolIterationResult(
			input,
			context,
			"native",
			emergencyFuseStep,
			finalReply,
			traces,
			contextPackage,
			maxIterations,
		);
	}

	private async resolveNativeNoToolResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		contextPackage: ContextPackage,
		traces: RuntimeToolTrace[],
		modelMessages: AgentChatMessage[],
		step: number,
		maxIterations: number,
		assistantStepText: string,
		finalReply: string,
		lastToolPayload: ToolExecutionResult["payload"] | null,
		lastToolUserFallback: string,
		loopControl: AgentLoopControlTracker | undefined,
		activePlan: ActivePlanState | undefined,
		reasoningArtifact?: ReasoningArtifact,
	): Promise<NativeNoToolResultResolution> {
		const fallbackAssistant = this.buildFallbackAssistantFromToolPayload(lastToolPayload, lastToolUserFallback);
		if (!assistantStepText || this.isIntermediateAssistantText(assistantStepText)) {
			const planSync = this.resolveModelPlanSyncBeforeFinal(
				input,
				context,
				modelMessages,
				step,
				assistantStepText,
				reasoningArtifact,
				activePlan,
				lastToolPayload,
				lastToolUserFallback,
				traces,
				contextPackage,
			);
			if (planSync) {
				return planSync;
			}
			const finalText = this.resolveFinalAssistantText("", traces, fallbackAssistant, "(Model returned no usable content)");
			return {
				kind: "terminal",
				result: this.makeResult(input, context, {
					assistantText: finalText.assistantText,
					traces,
					rawFinalReply: finalReply,
					parseError: "Native tool call completed without a user-facing final answer. Generated a fallback reply from tool results.",
					contextSummary: contextPackage.contextSummary,
				}),
			};
		}
		const parsed = parseKernelRuntimeEnvelope(assistantStepText);
		if (parsed) {
			this.applyRuntimeEnvelopeProcess(input, context, parsed, activePlan);
			const planSync = this.resolveModelPlanSyncBeforeFinal(
				input,
				context,
				modelMessages,
				step,
				assistantStepText,
				reasoningArtifact,
				activePlan,
				lastToolPayload,
				lastToolUserFallback,
				traces,
				contextPackage,
			);
			if (planSync && !parsed.tool) {
				return planSync;
			}
			const terminal = await this.resolveTerminalEnvelope(input, context, parsed, assistantStepText, traces, contextPackage, fallbackAssistant);
			if (terminal) {
				return { kind: "terminal", result: terminal };
			}
			const tool = parsed.tool;
			if (parsed.type === "tool_call" || tool) {
				if (!tool?.name) {
					return {
						kind: "terminal",
						result: this.makeResult(input, context, {
							assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
							traces,
							rawFinalReply: assistantStepText || finalReply,
							parseError: "tool.name is missing",
							contextSummary: contextPackage.contextSummary,
						}),
					};
				}
				const suppression = this.maybeSuppressMissingModelTaskBar(input, context, activePlan, [{
					name: tool.name,
					args: tool.args ?? {},
				}]);
				if (suppression.shouldDeferToolExecution) {
					modelMessages.push({
						role: "assistant",
						content: assistantStepText,
						...(reasoningArtifact?.hasReasoning ? { reasoningArtifact } : {}),
					});
					if (suppression.reminder) {
						modelMessages.push({ role: "system", content: suppression.reminder });
					}
					await this.saveCheckpoint(input, context, {
						boundary: "after_model_response_before_tool_execution",
						channel: "native",
						step,
						nextStep: step + 1,
						maxIterations,
						modelMessages,
						traces,
						safetyReason: "Native assistant text-envelope tool execution deferred so the model can call plan_write first.",
					});
					return {
						kind: "continue",
						lastToolPayload: {
							ok: true,
							tool: "plan_write",
							status: "ok",
							data: { planReminderEmitted: true },
						},
						...(lastToolUserFallback ? { lastToolUserFallback } : {}),
					};
				}
				this.emitPlanExecutionStarted(input, context, activePlan);
				const executed = await this.executeTool(input, context, step, {
					name: tool.name,
					args: tool.args ?? {},
				}, loopControl, activePlan);
				traces.push(executed.trace);
				lastToolUserFallback = executed.userFallback?.trim() || lastToolUserFallback;
				modelMessages.push({
					role: "assistant",
					content: assistantStepText,
					...(reasoningArtifact?.hasReasoning ? { reasoningArtifact } : {}),
				});
				modelMessages.push({ role: "user", content: executed.modelResultText });
				if (suppression.reminder) {
					modelMessages.push({ role: "system", content: suppression.reminder });
				}
				if (executed.loadedSkillContext) {
					modelMessages.push({ role: "system", content: executed.loadedSkillContext });
				}
				await this.saveCheckpoint(input, context, {
					boundary: "after_tool_result",
					channel: "native",
					step,
					nextStep: step + 1,
					maxIterations,
					modelMessages,
					traces,
					completedToolCalls: [{
						toolCallId: executed.trace.runId,
						tool: executed.trace.tool,
						status: executed.trace.status,
						step: executed.trace.step,
						targetPath: executed.trace.targetPath,
					}],
					safetyReason: "Native assistant text-envelope tool result appended as prompt-style TOOL_RESULT feedback.",
				});
				return {
					kind: "continue",
					lastToolPayload: executed.payload,
					lastToolUserFallback,
					...(executed.loopRepetition ? { loopRepetition: executed.loopRepetition } : {}),
				};
			}
		}
		const planSync = this.resolveModelPlanSyncBeforeFinal(
			input,
			context,
			modelMessages,
			step,
			assistantStepText,
			reasoningArtifact,
			activePlan,
			lastToolPayload,
			lastToolUserFallback,
			traces,
			contextPackage,
		);
		if (planSync) {
			return planSync;
		}
		const finalText = this.resolveFinalAssistantText(assistantStepText, traces, fallbackAssistant, assistantStepText || "(Model returned no usable content)");
		return {
			kind: "terminal",
			result: this.makeResult(input, context, {
				assistantText: finalText.assistantText,
				traces,
				rawFinalReply: finalReply,
				...(finalText.replacedTraceSummary
					? { parseError: "Model returned a trace-only tool summary. Generated a product-facing fallback reply from tool results." }
					: {}),
				contextSummary: contextPackage.contextSummary,
			}),
		};
	}

	private async resolveTerminalEnvelope(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		envelope: RuntimeEnvelope,
		rawFinalReply: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
		lastToolUserFallback = "",
	): Promise<AgentTurnResult | null> {
		if (isResponseEnvelope(envelope) || (!envelope.tool && hasMutationPlans(envelope))) {
			const pendingMutations = await this.recordMutationPlans(envelope, context);
			const assistantCandidate = (envelope.assistant ?? rawFinalReply).trim();
			const finalText = this.resolveFinalAssistantText(
				assistantCandidate,
				traces,
				lastToolUserFallback,
				"(Model returned no usable content)",
			);
			return this.makeResult(input, context, {
				assistantText: finalText.assistantText,
				traces,
				rawFinalReply,
				...(finalText.replacedTraceSummary
					? { parseError: "Model returned a trace-only tool summary. Generated a product-facing fallback reply from tool results." }
					: {}),
				pendingMutations,
				contextSummary: contextPackage.contextSummary,
			});
		}
		return null;
	}

	private resolveModelPlanSyncBeforeFinal(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		modelMessages: AgentChatMessage[],
		step: number,
		assistantStepText: string,
		reasoningArtifact: ReasoningArtifact | undefined,
		activePlan: ActivePlanState | undefined,
		lastToolPayload: ToolExecutionResult["payload"] | null,
		lastToolUserFallback: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
	): NativeNoToolResultResolution | null {
		if (!this.requiresModelPlanSync(activePlan)) {
			return null;
		}
		if (activePlan?.finalPlanSyncRequested) {
			context.emit({
				type: "loop_control_stop",
				status: "safe_stopped",
				payload: {
					channel: "native",
					step,
					reason: "pending_model_plan_sync",
					stopReason: "pending_model_plan_sync",
					status: "safe_stopped",
					summary: "Model final answer arrived before plan_write synchronized the visible Task Bar.",
				},
			});
			this.report(input, {
				phase: "plan",
				depth: input.depth ?? 0,
				step,
				summary: "Stopped because model did not synchronize the visible Task Bar before final answer.",
				message: "Stopped because model did not synchronize the visible Task Bar before final answer.",
			});
			return {
				kind: "terminal",
				result: this.makeResult(input, context, {
					status: "safe_stopped",
					assistantText: "FRIDAY 暂停了这次处理：模型还没有用 plan_write 同步任务进度，避免把未完成的 Task Bar 伪装成已完成。可以稍后重试。",
					traces,
					rawFinalReply: assistantStepText,
					parseError: "Model final answer arrived while a model-authored visible plan still had non-terminal tasks.",
					contextSummary: contextPackage.contextSummary,
				}),
			};
		}
		if (!activePlan) {
			return null;
		}
		activePlan.finalPlanSyncRequested = true;
		if (assistantStepText.trim()) {
			modelMessages.push({
				role: "assistant",
				content: assistantStepText,
				...(reasoningArtifact?.hasReasoning ? { reasoningArtifact } : {}),
			});
		}
		modelMessages.push({
			role: "system",
			content: [
				"SYSTEM REMINDER: Before finalizing, synchronize the visible Task Bar by calling plan_write.",
				"Mark completed work as completed, leave remaining work pending/blocked/failed/skipped, then provide the final answer after the plan_write tool result.",
			].join("\n"),
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			step,
			summary: "Requested model plan synchronization before final answer.",
			message: "Requested model plan synchronization before final answer.",
		});
		return {
			kind: "continue",
			lastToolPayload: lastToolPayload ?? {
				ok: true,
				tool: "plan_write",
				status: "ok",
				data: { planSyncRequested: true },
			},
			...(lastToolUserFallback ? { lastToolUserFallback } : {}),
		};
	}

	private requiresModelPlanSync(activePlan: ActivePlanState | undefined): boolean {
		if (activePlan?.source !== "model" || !activePlan.current) {
			return false;
		}
		const visibility = activePlan.current.visibility;
		if (visibility !== "task_bar" && visibility !== "visible") {
			return false;
		}
		return !this.isTerminalPlanState(activePlan.current);
	}

	private async executeNativeToolBatch(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		toolCalls: ToolCall[],
		loopControl: AgentLoopControlTracker,
		activePlan?: ActivePlanState,
	): Promise<NativeToolBatchExecution[]> {
		const executions: NativeToolBatchExecution[] = [];
		for (const toolCall of toolCalls) {
			if (!toolCall || !this.isPlanWriteTool(toolCall.name)) {
				continue;
			}
			const executed = await this.executeTool(input, context, step, this.normalizeNativeToolCall(toolCall), loopControl, activePlan);
			executions.push({ toolCall, executed });
		}
		const workToolCalls = toolCalls.filter((toolCall) => !this.isPlanWriteTool(toolCall?.name ?? ""));
		let index = 0;
		while (index < workToolCalls.length) {
			const toolCall = workToolCalls[index];
			if (!toolCall) {
				index += 1;
				continue;
			}
			if (!this.isReadOnlyConcurrencySafeTool(toolCall.name)) {
				const executed = await this.executeTool(input, context, step, this.normalizeNativeToolCall(toolCall), loopControl, activePlan);
				executions.push({ toolCall, executed });
				index += 1;
				continue;
			}
			const run: ToolCall[] = [];
			while (index < workToolCalls.length) {
				const candidate = workToolCalls[index];
				if (!candidate || !this.isReadOnlyConcurrencySafeTool(candidate.name)) {
					break;
				}
				run.push(candidate);
				index += 1;
			}
			executions.push(...await this.executeReadOnlyConcurrencySafeRun(input, context, step, run, loopControl, activePlan));
		}
		return executions;
	}

	private async executeReadOnlyConcurrencySafeRun(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		toolCalls: ToolCall[],
		loopControl: AgentLoopControlTracker,
		activePlan?: ActivePlanState,
	): Promise<NativeToolBatchExecution[]> {
		const normalizedCalls = toolCalls.map((toolCall) => this.normalizeNativeToolCall(toolCall));
		const firstIndexByIdentity = new Map<string, number>();
		const primaryIndexes: number[] = [];
		for (let index = 0; index < normalizedCalls.length; index += 1) {
			const toolCall = normalizedCalls[index];
			if (!toolCall) {
				continue;
			}
			const identity = createToolInvocationFingerprint(toolCall).invocationIdentity;
			if (firstIndexByIdentity.has(identity)) {
				continue;
			}
			firstIndexByIdentity.set(identity, index);
			primaryIndexes.push(index);
		}

		const executions: Array<NativeToolBatchExecution | undefined> = new Array(toolCalls.length);
		const primaryExecutions = await Promise.all(primaryIndexes.map(async (index) => {
			const toolCall = toolCalls[index];
			const normalized = normalizedCalls[index];
			if (!toolCall || !normalized) {
				return null;
			}
			return {
				index,
				execution: {
					toolCall,
					executed: await this.executeTool(input, context, step, normalized, loopControl, activePlan),
				},
			};
		}));
		for (const item of primaryExecutions) {
			if (item) {
				executions[item.index] = item.execution;
			}
		}
		for (let index = 0; index < normalizedCalls.length; index += 1) {
			if (executions[index]) {
				continue;
			}
			const toolCall = toolCalls[index];
			const normalized = normalizedCalls[index];
			if (!toolCall || !normalized) {
				continue;
			}
			executions[index] = {
				toolCall,
				executed: await this.executeTool(input, context, step, normalized, loopControl, activePlan),
			};
		}
		return executions.filter((item): item is NativeToolBatchExecution => Boolean(item));
	}

	private normalizeNativeToolCall(toolCall: ToolCall): ToolCall {
		return {
			id: toolCall.id,
			name: toolCall.name,
			args: toolCall.args ?? {},
		};
	}

	private isReadOnlyConcurrencySafeTool(toolName: string): boolean {
		const contract = ToolRegistry.getInstance().get(toolName);
		return Boolean(contract?.readOnly && contract.concurrencySafe);
	}

	private isPlanWriteTool(toolName: string): boolean {
		return toolName.trim().toLowerCase() === "plan_write";
	}

	private executePlanWriteTool(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		tool: ToolCall,
		activePlan?: ActivePlanState,
	): ToolExecutionResult {
		const normalized = this.normalizePlanWriteArgs(tool.args ?? {});
		if (normalized.tasks.length === 0) {
			const message = "plan_write requires a non-empty tasks array with concrete task titles.";
			const payload: ToolResultPayload = {
				ok: false,
				tool: "plan_write",
				status: "failed",
				failureClass: "invalid_input",
				error: message,
				recovery: {
					recoverable: true,
					retryable: false,
					code: "invalid_plan_write",
					message,
					suggestedArgs: {
						visibility: "task_bar",
						tasks: [
							{ id: "step-1", title: "Define the next concrete step", status: "in_progress" },
						],
					},
				},
			};
			return {
				trace: {
					runId: tool.id ?? `plan_write-${step}`,
					step,
					tool: "plan_write",
					scope: "any",
					targetPath: "task_bar",
					approved: true,
					approvalReason: "Harness planning tool",
					persistedRule: false,
					viaRule: false,
					status: "failed",
					failureClass: "invalid_input",
					ok: false,
					summary: message,
					error: message,
				},
				payload,
				modelResultText: formatForModel(payload),
				userFallback: "",
			};
		}

		const existing = activePlan?.current ?? null;
		const planId = existing?.planId ?? `plan-${context.turnId}`;
		const visibility = normalized.visibility === "visible" ? "task_bar" : normalized.visibility;
		let nextPlan = createPlanState({
			planId,
			visibility,
			tasks: normalized.tasks,
		});
		if (existing?.createdAt) {
			nextPlan = normalizePlanState({ ...nextPlan, createdAt: existing.createdAt });
		}
		const eventType: "plan_create" | "plan_update" | "plan_revise" = !existing
			? "plan_create"
			: this.planTaskStructureSignature(existing) === this.planTaskStructureSignature(nextPlan)
				? "plan_update"
				: "plan_revise";
		if (activePlan) {
			activePlan.current = nextPlan;
			activePlan.source = "model";
			activePlan.lastEmittedPlanSignature = this.planStateMeaningfulSignature(nextPlan);
		}
		const visible = nextPlan.visibility === "task_bar" || nextPlan.visibility === "visible";
		if (eventType === "plan_create" && visible) {
			context.emit({
				type: "task_bar_created",
				payload: {
					source: "model",
					reason: normalized.reason || "model_plan_write",
					taskCount: nextPlan.tasks.length,
				},
			});
		}
		const planPayload = {
			type: eventType,
			state: nextPlan,
			source: "model",
			...(normalized.reason ? { reason: normalized.reason } : {}),
		};
		context.emit({
			type: eventType,
			payload: planPayload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			step,
			plan: planPayload,
			summary: normalized.reason || `Plan ${eventType.replace("plan_", "")}.`,
			message: normalized.reason || `Plan ${eventType.replace("plan_", "")}.`,
		});
		const payload: ToolResultPayload = {
			ok: true,
			tool: "plan_write",
			status: "ok",
			data: {
				planId: nextPlan.planId,
				eventType,
				taskCount: nextPlan.tasks.length,
				currentTaskId: nextPlan.currentTaskId,
			},
		};
		return {
			trace: {
				runId: tool.id ?? `plan_write-${step}`,
				step,
				tool: "plan_write",
				scope: "any",
				targetPath: "task_bar",
				approved: true,
				approvalReason: "Harness planning tool",
				persistedRule: false,
				viaRule: false,
				status: "ok",
				ok: true,
				summary: `${eventType} wrote ${nextPlan.tasks.length} task(s)`,
			},
			payload,
			modelResultText: formatForModel(payload),
			userFallback: "",
		};
	}

	private normalizePlanWriteArgs(args: Record<string, unknown>): {
		visibility: PlanState["visibility"];
		reason?: string;
		tasks: RuntimePlanTaskInstruction[];
	} {
		const rawVisibility = typeof args.visibility === "string" ? args.visibility : "";
		const visibility: PlanState["visibility"] =
			rawVisibility === "hidden" || rawVisibility === "internal" || rawVisibility === "visible" || rawVisibility === "task_bar"
				? rawVisibility
				: "task_bar";
		const reason = typeof args.reason === "string" && args.reason.trim()
			? args.reason.trim()
			: undefined;
		const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
		const tasks = rawTasks
			.map((task, index): RuntimePlanTaskInstruction | null => {
				if (typeof task === "string") {
					const title = task.trim();
					return title ? { id: `step-${index + 1}`, title, status: index === 0 ? "in_progress" : "pending" } : null;
				}
				if (!task || typeof task !== "object" || Array.isArray(task)) {
					return null;
				}
				const record = task as Record<string, unknown>;
				const title = typeof record.title === "string" ? record.title.trim() : "";
				if (!title) {
					return null;
				}
				const id = typeof record.id === "string" && record.id.trim()
					? record.id.trim()
					: `step-${index + 1}`;
				const status = this.isPlanTaskStatus(record.status) ? record.status : index === 0 ? "in_progress" : "pending";
				const summary = typeof record.summary === "string" && record.summary.trim()
					? record.summary.trim()
					: undefined;
				return {
					id,
					title,
					status,
					...(summary ? { summary } : {}),
				};
			})
			.filter((task): task is RuntimePlanTaskInstruction => Boolean(task));
		return {
			visibility,
			...(reason ? { reason } : {}),
			tasks,
		};
	}

	private planTaskStructureSignature(planState: PlanState): string {
		return JSON.stringify(planState.tasks.map((task) => ({
			id: task.id,
			title: task.title,
		})));
	}

	private async executeTool(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		tool: ToolCall,
		loopControl?: AgentLoopControlTracker,
		activePlan?: ActivePlanState,
	): Promise<LoopToolExecutionResult> {
		context.emit({
			type: "tool_call",
			payload: { step, tool: tool.name, args: tool.args ?? {}, toolCallId: tool.id },
		});
		this.report(input, {
			phase: "tool_call",
			depth: input.depth ?? 0,
			step,
			tool: tool.name,
			message: `Step ${step}: calling tool ${tool.name}`,
		});
		const repetition = this.isPlanWriteTool(tool.name) ? undefined : loopControl?.beforeInvocation(tool);
		const rawResult = repetition
			? this.buildDuplicateFailedToolResult(step, tool, repetition)
			: this.isPlanWriteTool(tool.name)
				? this.executePlanWriteTool(input, context, step, tool, activePlan)
				: await this.options.toolExecution.executeTool({ input, context, step, tool });
		const result = this.withToolResultChannels(rawResult);
		let loopRepetition: AgentLoopRepetition | undefined;
		if (!repetition && !this.isPlanWriteTool(tool.name)) {
			loopRepetition = loopControl?.recordResult(tool, result);
		}
		const recovery = result.payload.recovery;
		const recoverable = recovery?.recoverable ?? result.trace.failureClass === "transport_unstable";
		const retryable = recovery?.retryable ?? result.trace.failureClass === "transport_unstable";
		context.emit({
			type: "tool_result",
			payload: {
				step,
				tool: tool.name,
				toolCallId: tool.id ?? result.trace.runId,
				status: result.payload.status ?? result.trace.status,
				summary: result.trace.summary,
				targetPath: result.payload.trace?.targetPath ?? result.trace.targetPath,
				error: result.payload.error ?? result.trace.error,
				failureClass: result.payload.failureClass ?? result.trace.failureClass,
				recoverable,
				retryable,
				...(recovery ? { recovery } : {}),
				...(recovery?.candidatePaths ? { candidatePaths: recovery.candidatePaths } : {}),
				...(recovery?.suggestedArgs ? { suggestedArgs: recovery.suggestedArgs } : {}),
			},
		});
		this.report(input, {
			phase: "tool_result",
			depth: input.depth ?? 0,
			step,
			tool: tool.name,
			targetPath: result.trace.targetPath,
			status: result.trace.status,
			summary: result.trace.summary,
			message: `Step ${step}: tool ${tool.name} finished - ${result.trace.summary}`,
		});
		if (tool.name !== "plan_write" && this.shouldEmitToolStageNarration(input)) {
			this.emitToolStageReport(input, context, result.trace);
		}
		return loopRepetition ? { ...result, loopRepetition } : result;
	}

	private async deferRepeatedObservationForFinalAnswer(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		channel: "native" | "prompt",
		step: number,
		maxIterations: number,
		modelMessages: AgentChatMessage[],
		traces: RuntimeToolTrace[],
		repetition: AgentLoopRepetition | undefined,
		reminderKeys: Set<string>,
	): Promise<boolean> {
		if (!repetition || repetition.kind !== "repeated_unchanged_observation") {
			return false;
		}
		const reminderKey = repetition.fingerprint.resultIdentity ?? repetition.fingerprint.invocationIdentity;
		if (reminderKeys.has(reminderKey)) {
			return false;
		}
		reminderKeys.add(reminderKey);
		modelMessages.push({
			role: "system",
			content: this.buildRepeatedObservationFinalizationReminder(repetition),
		});
		await this.saveCheckpoint(input, context, {
			boundary: "after_tool_result",
			channel,
			step,
			nextStep: step + 1,
			maxIterations,
			modelMessages,
			traces,
			safetyReason: "Repeated unchanged observation detected; hidden finalization reminder appended before loop-control safe stop.",
		});
		return true;
	}

	private buildRepeatedObservationFinalizationReminder(repetition: AgentLoopRepetition): string {
		const tool = repetition.fingerprint.tool;
		const previousStep = repetition.previous.result.trace.step;
		return [
			`You already received unchanged results from the same read-only observation tool (${tool}) at step ${previousStep}.`,
			"Do not call that same observation tool and target again in this turn.",
			"Use the evidence already present in the TOOL_RESULT messages to write the final answer for the user now.",
			"If the evidence is insufficient, explain what is missing and ask for a narrower scope instead of repeating the same tool call.",
		].join(" ");
	}

	private withToolResultChannels(result: ToolExecutionResult): ToolExecutionResult {
		const channels = formatToolResultChannels(result.payload);
		return {
			...result,
			modelResultText: result.modelResultText?.trim() ? result.modelResultText : channels.modelContent,
			userFallback: result.userFallback?.trim() || channels.userFallback,
			trace: {
				...result.trace,
				summary: result.trace.summary?.trim() || channels.traceSummary,
			},
		};
	}

	private buildDuplicateFailedToolResult(
		step: number,
		tool: ToolCall,
		repetition: AgentLoopRepetition,
	): ToolExecutionResult {
		const previousPayload = repetition.previous.result.payload;
		const failureClass = previousPayload.failureClass ?? repetition.previous.result.trace.failureClass ?? "invalid_input";
		const message = `Identical call already failed earlier in this turn for ${tool.name}. Use recovery.suggestedArgs/candidatePaths if present, or change the tool arguments before retrying.`;
		const recovery = this.buildDuplicateRecovery(previousPayload.recovery, message);
		const payload: ToolResultPayload = {
			ok: false,
			tool: tool.name,
			status: "failed",
			failureClass,
			error: message,
			recovery,
			...(previousPayload.trace ? { trace: { ...previousPayload.trace } } : {}),
		};
		const previousTrace = repetition.previous.result.trace;
		const trace: RuntimeToolTrace = {
			...previousTrace,
			runId: `${previousTrace.runId || tool.name}-duplicate-${step}`,
			step,
			tool: tool.name,
			targetPath: previousTrace.targetPath,
			status: "failed",
			failureClass,
			ok: false,
			summary: message,
			error: message,
		};
		return {
			trace,
			payload,
			modelResultText: formatForModel(payload),
			userFallback: summarizeForUserFallback(payload),
		};
	}

	private buildDuplicateRecovery(
		previousRecovery: ToolResultRecovery | undefined,
		message: string,
	): ToolResultRecovery {
		return {
			...(previousRecovery ?? {}),
			recoverable: true,
			retryable: false,
			code: "duplicate_failed_tool_call",
			message,
			...(previousRecovery?.suggestedArgs ? { suggestedArgs: { ...previousRecovery.suggestedArgs } } : {}),
			...(previousRecovery?.candidatePaths ? { candidatePaths: [...previousRecovery.candidatePaths] } : {}),
		};
	}

	private buildLoopControlStopResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		channel: "native" | "prompt",
		step: number,
		repetition: AgentLoopRepetition | undefined,
		finalReply: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
	): AgentTurnResult | null {
		if (!repetition || repetition.kind !== "repeated_unchanged_observation") {
			return null;
		}
		const previousStep = repetition.previous.result.trace.step;
		context.emit({
			type: "loop_control_stop",
			status: "safe_stopped",
			payload: {
				channel,
				step,
				previousStep,
				tool: repetition.fingerprint.tool,
				reason: repetition.stopReason,
				stopReason: repetition.stopReason,
				repetitionKind: repetition.kind,
				status: "safe_stopped",
				summary: LOOP_CONTROL_SAFE_SUMMARY,
				invocationIdentity: repetition.fingerprint.invocationIdentity,
				...(repetition.fingerprint.resultIdentity ? { resultIdentity: repetition.fingerprint.resultIdentity } : {}),
			},
		});
		this.report(input, {
			phase: "done",
			depth: input.depth ?? 0,
			step,
			tool: repetition.fingerprint.tool,
			message: LOOP_CONTROL_SAFE_SUMMARY,
		});
		return this.makeResult(input, context, {
			status: "safe_stopped",
			assistantText: LOOP_CONTROL_SAFE_ASSISTANT_TEXT,
			traces,
			rawFinalReply: finalReply,
			contextSummary: contextPackage.contextSummary,
		});
	}

	private buildMaxToolIterationResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		channel: "native" | "prompt",
		maxIterations: number,
		finalReply: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
		configuredMaxIterations?: number,
	): AgentTurnResult {
		context.emit({
			type: "max_tool_iterations",
			status: "safe_stopped",
			payload: {
				channel,
				maxIterations,
				...(configuredMaxIterations === undefined ? {} : { configuredMaxIterations }),
				reason: "emergency_fuse",
				toolTraces: traces.length,
				status: "safe_stopped",
				summary: MAX_TOOL_ITERATION_SAFE_SUMMARY,
			},
		});
		this.report(input, {
			phase: "done",
			depth: input.depth ?? 0,
			message: MAX_TOOL_ITERATION_SAFE_SUMMARY,
		});
		return this.makeResult(input, context, {
			status: "safe_stopped",
			assistantText: MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT,
			traces,
			rawFinalReply: finalReply,
			contextSummary: contextPackage.contextSummary,
		});
	}

	private makeResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		result: Omit<AgentTurnResult, "turnId" | "traceId" | "taskId" | "conversationId" | "status" | "events" | "budget"> &
			Partial<Pick<AgentTurnResult, "status" | "events" | "budget" | "traceId" | "taskId" | "conversationId">>,
	): AgentTurnResult {
		return {
			turnId: context.turnId,
			taskId: context.taskId,
			traceId: context.traceId,
			conversationId: input.conversationId,
			status: result.status ?? "completed",
			events: result.events ?? context.snapshotEvents(),
			budget: result.budget ?? context.budget,
			...result,
		};
	}

	private emitTerminalProgress(input: AgentTurnInput, result: AgentTurnResult): void {
		if ((result.status ?? "completed") !== "completed") {
			return;
		}
		const message = result.assistantText?.trim() || "Done.";
		this.report(input, {
			phase: "done",
			depth: input.depth ?? 0,
			message,
			summary: message,
		});
	}

	private emitModelRequest(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		channel: "native" | "prompt",
		messages: AgentChatMessage[],
	): void {
		context.emit({
			type: "model_request",
			payload: { step, channel, messageCount: messages.length },
		});
		this.report(input, {
			phase: "model_request",
			depth: input.depth ?? 0,
			step,
			message: `Step ${step}: requesting model decision (${channel === "native" ? "native tools" : "prompt runtime"})`,
		});
	}

	private emitModelResponse(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		channel: "native" | "prompt",
		assistantText: string,
		reasoningArtifact?: ReasoningArtifact,
	): void {
		const reasoningMetadata = buildSafeReasoningMetadata(reasoningArtifact);
		context.emit({
			type: "model_response",
			payload: {
				step,
				channel,
				hasAssistantText: Boolean(assistantText?.trim()),
				...reasoningMetadata,
			},
		});
		this.report(input, {
			phase: "model_response",
			depth: input.depth ?? 0,
			step,
			...reasoningMetadata,
			message: `Step ${step}: model response received`,
		});
	}

	private emitModelTransport(
		input: AgentTurnInput,
		_context: AgentExecutionContext,
		step: number,
		event: LlmTransportEvent,
	): void {
		this.report(input, {
			phase: "model_retry",
			depth: input.depth ?? 0,
			step,
			transport: {
				type: event.type,
				requestId: event.requestId,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				...(event.delayMs !== undefined ? { delayMs: event.delayMs } : {}),
				...(event.httpStatus !== undefined ? { httpStatus: event.httpStatus } : {}),
				retryable: event.retryable,
				channel: event.channel,
				endpointIndex: event.endpointIndex,
				endpointCount: event.endpointCount,
			},
			message: this.formatTransportProgressMessage(event),
		});
	}

	private emitTaskAcknowledged(input: AgentTurnInput, context: AgentExecutionContext): void {
		const understanding = this.buildTaskUnderstanding(input.userPrompt);
		this.emitNarration(input, context, {
			kind: "task_acknowledged",
			summary: "收到任务，正在确认目标。",
			understanding,
			source: "fallback",
			status: "completed",
		});
	}

	private emitIntakeDecision(input: AgentTurnInput, context: AgentExecutionContext, intake: IntakeDecision): void {
		const payload: Record<string, unknown> = {
			complexity: intake.complexity,
			route: intake.route,
			interactionRoute: intake.interactionRoute,
			statement: intake.statement,
			requiresPlan: intake.requiresPlan,
			shouldShowProcess: intake.shouldShowProcess,
			shouldUseVisiblePlan: intake.shouldUseVisiblePlan,
			source: intake.source,
		};
		context.emit({
			type: "intake_decision",
			payload,
		});
		this.report(input, {
			phase: "intake",
			depth: input.depth ?? 0,
			intake,
			summary: intake.statement,
			message: intake.statement,
		});
	}

	private emitPlanCreated(input: AgentTurnInput, context: AgentExecutionContext): PlanState {
		const planState = createPlanState({
			planId: `plan-${context.turnId}`,
			tasks: this.buildInitialPlan(input),
		});
		const payload = {
			type: "plan_create" as const,
			state: planState,
		};
		context.emit({
			type: "plan_create",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: payload,
			summary: "Plan created.",
			message: "Plan created.",
		});
		return planState;
	}

	private maybeCreateRuntimeTaskBarForNativeToolWork(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState | undefined,
		toolCalls: ToolCall[],
	): void {
		if (!activePlan || input.metadata?.suppressVisibleNarration === true || activePlan.current || toolCalls.length === 0) {
			return;
		}
		const reason = this.resolveRuntimeTaskBarTrigger(input, toolCalls);
		if (!reason) {
			return;
		}
		const intake = this.buildIntakeDecision(input);
		if (!activePlan.intakeEmitted && intake.interactionRoute === "task_with_process") {
			this.emitIntakeDecision(input, context, intake);
			activePlan.intakeEmitted = true;
		}
		const planState = createPlanState({
			planId: `plan-${context.turnId}`,
			visibility: "task_bar",
			tasks: this.buildInitialPlan(input),
		});
		activePlan.current = planState;
		activePlan.source = "runtime";
		activePlan.lastEmittedPlanSignature = this.planStateMeaningfulSignature(planState);
		context.emit({
			type: "task_bar_created",
			payload: {
				source: "runtime",
				reason,
				toolCount: toolCalls.length,
				tools: toolCalls.map((toolCall) => toolCall.name),
			},
		});
		const payload = {
			type: "plan_create" as const,
			state: planState,
			source: "runtime",
			reason,
		};
		context.emit({
			type: "plan_create",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: payload,
			summary: "Runtime task bar created.",
			message: "Runtime task bar created.",
		});
	}

	private maybeSuppressMissingModelTaskBar(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState | undefined,
		toolCalls: ToolCall[],
	): MissingModelTaskBarSuppression {
		if (
			!activePlan ||
			input.metadata?.suppressVisibleNarration === true ||
			activePlan.current ||
			toolCalls.length === 0 ||
			toolCalls.some((toolCall) => this.isPlanWriteTool(toolCall.name))
		) {
			return { reminder: "", shouldDeferToolExecution: false };
		}
		const trigger = this.resolveRuntimeTaskBarTrigger(input, toolCalls);
		if (!trigger) {
			return { reminder: "", shouldDeferToolExecution: false };
		}
		context.emit({
			type: "task_bar_suppressed",
			payload: {
				source: "runtime",
				reason: "missing_model_plan",
				trigger,
				toolCount: toolCalls.length,
				tools: toolCalls.map((toolCall) => toolCall.name),
			},
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			summary: "Task bar suppressed because the model did not provide plan_write.",
			message: "Task bar suppressed because the model did not provide plan_write.",
		});
		if (activePlan.missingModelPlanReminderEmitted) {
			return { reminder: "", shouldDeferToolExecution: false };
		}
		activePlan.missingModelPlanReminderEmitted = true;
		const shouldDeferToolExecution = (
			trigger === "complex_tool_work" ||
			trigger === "verification_tool_work"
		) && toolCalls.length > 1;
		return {
			shouldDeferToolExecution,
			reminder: [
				"SYSTEM REMINDER: This looks like multi-step work, but no visible Task Bar plan exists.",
				"Before continuing the user-facing workflow, call plan_write with 3-6 concrete steps and current statuses.",
				"If a visible Task Bar is truly unnecessary, continue without inventing one.",
			].join("\n"),
		};
	}

	private resolveRuntimeTaskBarTrigger(input: AgentTurnInput, toolCalls: ToolCall[]): string {
		if (toolCalls.some((toolCall) => this.isMutationNativeToolCall(toolCall))) {
			return "mutation_tool_batch";
		}
		if (this.hasVerificationTaskSignal(input.userPrompt)) {
			return "verification_tool_work";
		}
		if (this.classifyIntakeComplexity(input) === "complex") {
			return "complex_tool_work";
		}
		if (toolCalls.length > 1) {
			return "multi_tool_batch";
		}
		return "";
	}

	private isMutationNativeToolCall(toolCall: ToolCall): boolean {
		const contract = ToolRegistry.getInstance().get(toolCall.name);
		if (!contract) {
			return false;
		}
		return !contract.readOnly || contract.mutatesVault || contract.mutatesExternal;
	}

	private emitPlanCompleted(input: AgentTurnInput, context: AgentExecutionContext, activePlan: ActivePlanState | undefined): void {
		const planState = activePlan?.current;
		if (!planState || activePlan?.source === "model") {
			return;
		}
		if (planState.status === "skipped" || planState.status === "failed") {
			return;
		}
		const completed = completePlanState(planState);
		const payload = {
			type: "plan_complete" as const,
			state: completed,
			...(activePlan?.source ? { source: activePlan.source } : {}),
		};
		context.emit({
			type: "plan_complete",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: this.asTaskBarPlanProgress(payload),
			summary: "Plan completed.",
			message: "Plan completed.",
		});
	}

	private emitPlanContextReady(input: AgentTurnInput, context: AgentExecutionContext, activePlan?: ActivePlanState): void {
		if (!activePlan?.current || activePlan.contextReady || this.isTerminalPlanState(activePlan.current)) {
			return;
		}
		const taskId = activePlan.current.currentTaskId;
		if (!taskId) {
			return;
		}
		activePlan.contextReady = true;
		activePlan.current = completePlanTask(activePlan.current, taskId, {
			reason: "上下文已准备好。",
		});
		this.emitPlanUpdated(input, context, activePlan.current, taskId, "上下文已准备好。", activePlan);
	}

	private emitPlanExecutionStarted(input: AgentTurnInput, context: AgentExecutionContext, activePlan?: ActivePlanState): void {
		if (!activePlan?.current || activePlan.executionStarted || this.isTerminalPlanState(activePlan.current)) {
			return;
		}
		activePlan.executionStarted = true;
		const taskId = activePlan.current.currentTaskId;
		this.emitPlanUpdated(input, context, activePlan.current, taskId, "正在执行计划项。", activePlan);
	}

	private advancePlanAfterToolResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState | undefined,
		trace: RuntimeToolTrace,
	): void {
		if (!activePlan?.current || this.isTerminalPlanState(activePlan.current) || trace.status !== "ok") {
			return;
		}
		const taskId = activePlan.current.currentTaskId;
		if (!taskId) {
			return;
		}
		const message = this.describeToolProgress(trace);
		activePlan.current = completePlanTask(activePlan.current, taskId, {
			reason: message,
		});
		this.emitPlanUpdated(input, context, activePlan.current, taskId, message, activePlan);
	}

	private emitPlanFinalizing(input: AgentTurnInput, context: AgentExecutionContext, activePlan?: ActivePlanState): void {
		if (!activePlan?.current || activePlan.source === "model" || activePlan.finalStarted || this.isTerminalPlanState(activePlan.current)) {
			return;
		}
		const taskId = activePlan.current.currentTaskId;
		if (!taskId) {
			return;
		}
		activePlan.finalStarted = true;
		activePlan.current = this.markPlanTaskRunning(activePlan.current, taskId, "正在整理最终回答。");
		this.emitPlanUpdated(input, context, activePlan.current, taskId, "正在整理最终回答。", activePlan);
	}

	private markPlanTaskRunning(planState: PlanState, taskId: string, summary: string): PlanState {
		const now = new Date().toISOString();
		const target = planState.tasks.find((task) => task.id === taskId);
		if (!target || target.status === "blocked") {
			return planState;
		}
		return {
			...planState,
			status: "running",
			currentTaskId: taskId,
			updatedAt: now,
			completedAt: undefined,
			tasks: planState.tasks.map((task) => {
				if (task.id === taskId) {
					return {
						...task,
						status: "in_progress",
						summary,
						startedAt: task.startedAt ?? now,
						completedAt: undefined,
					};
				}
				if (task.status === "in_progress") {
					return { ...task, status: "pending", completedAt: undefined };
				}
				return task;
			}),
		};
	}

	private applyRuntimePlanInstruction(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		instruction: RuntimePlanInstruction | undefined,
		activePlan?: ActivePlanState,
	): void {
		if (!instruction || !activePlan) {
			return;
		}
		if (instruction.type === "plan_create") {
			this.emitPlanCreatedFromInstruction(input, context, activePlan, instruction);
			return;
		}
		if (!activePlan.current) {
			return;
		}
		if (instruction.type === "plan_revise") {
			this.emitPlanRevised(input, context, activePlan, instruction);
			return;
		}
		if (instruction.type === "plan_skip") {
			this.emitPlanSkipped(input, context, activePlan, instruction);
		}
	}

	private emitPlanCreatedFromInstruction(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState,
		instruction: RuntimePlanCreateInstruction,
	): void {
		if (activePlan.current) {
			return;
		}
		const visibility = this.normalizeRuntimePlanCreateVisibility(instruction);
		const visible = visibility === "task_bar" || visibility === "visible";
		if (!visible && instruction.tasksMalformed) {
			return;
		}
		const taskInput = this.buildRuntimePlanCreateTasks(input, instruction, visible);
		if (taskInput.length === 0) {
			return;
		}
		const planState = createPlanState({
			planId: `plan-${context.turnId}`,
			visibility,
			tasks: taskInput,
		});
		activePlan.current = planState;
		activePlan.source = "legacy";
		activePlan.lastEmittedPlanSignature = this.planStateMeaningfulSignature(planState);
		const payload = {
			type: "plan_create" as const,
			state: planState,
			source: "legacy",
			...(instruction.reason ? { reason: instruction.reason } : {}),
			...(instruction.tasksMalformed && visible ? { fallback: true } : {}),
		};
		context.emit({
			type: "plan_create",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: payload,
			summary: instruction.reason ?? "Plan created.",
			message: instruction.reason ?? "Plan created.",
		});
	}

	private normalizeRuntimePlanCreateVisibility(instruction: RuntimePlanCreateInstruction): PlanState["visibility"] {
		if (instruction.visibility === "visible") {
			return "task_bar";
		}
		return instruction.visibility ?? "task_bar";
	}

	private buildRuntimePlanCreateTasks(
		input: AgentTurnInput,
		instruction: RuntimePlanCreateInstruction,
		visible: boolean,
	): RuntimePlanTaskInstruction[] {
		const modelTasks = instruction.tasks ?? [];
		const tasks = modelTasks.length > 0
			? modelTasks
			: visible && instruction.tasksMalformed
				? this.buildSafePlanCreateFallbackTasks(instruction)
				: [];
		if (!this.isExplicitReadOnlyRequest(input.userPrompt)) {
			return tasks;
		}
		return tasks.map((task) => this.downgradeReadOnlyMutationTask(task));
	}

	private buildSafePlanCreateFallbackTasks(instruction: RuntimePlanCreateInstruction): RuntimePlanTaskInstruction[] {
		const reason = instruction.reason?.trim();
		return [
			{
				id: "fallback-1",
				title: reason ? `Validate model plan fallback: ${reason.slice(0, 80)}` : "Validate model plan fallback",
				status: "in_progress",
			},
			{ id: "fallback-2", title: "Proceed with the safest next step", status: "pending" },
			{ id: "fallback-3", title: "Summarize outcome and risks", status: "pending" },
		];
	}

	private downgradeReadOnlyMutationTask(task: RuntimePlanTaskInstruction): RuntimePlanTaskInstruction {
		if (!this.isMutationShapedPlanTask(task.title)) {
			return task;
		}
		return {
			...task,
			title: task.title.startsWith("Read-only") ? task.title : `Read-only review instead of: ${task.title}`,
			status: "blocked",
			summary: task.summary ?? "Blocked because the user explicitly requested no modifications.",
		};
	}

	private emitPlanRevised(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState,
		instruction: RuntimePlanReviseInstruction,
	): void {
		if (!activePlan.current || this.isTerminalPlanState(activePlan.current)) {
			return;
		}
		const changes = this.normalizeRuntimePlanRevisionChanges(instruction.changes);
		const tasks = this.normalizeRuntimePlanTasks(instruction.tasks);
		const next = revisePlanState(activePlan.current, {
			...(tasks.length > 0 ? { tasks } : {}),
			...(changes.length > 0 ? { changes } : {}),
			reason: instruction.reason,
		});
		activePlan.current = next;
		activePlan.lastEmittedPlanSignature = this.planStateMeaningfulSignature(next);
		const payload = {
			type: "plan_revise" as const,
			state: next,
			...(activePlan.source ? { source: activePlan.source } : {}),
			...(instruction.reason ? { reason: instruction.reason } : {}),
			...(changes.length > 0 ? { changes } : {}),
		};
		context.emit({
			type: "plan_revise",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: payload,
			summary: instruction.reason ?? "Plan revised.",
			message: instruction.reason ?? "Plan revised.",
		});
	}

	private emitPlanSkipped(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		activePlan: ActivePlanState,
		instruction: RuntimePlanSkipInstruction,
	): void {
		if (!activePlan.current || activePlan.current.status === "skipped") {
			return;
		}
		const skipped = skipPlanState(activePlan.current, {
			reason: instruction.reason,
		});
		activePlan.current = skipped;
		activePlan.finalStarted = true;
		activePlan.lastEmittedPlanSignature = this.planStateMeaningfulSignature(skipped);
		const payload = {
			type: "plan_skip" as const,
			state: skipped,
			...(activePlan.source ? { source: activePlan.source } : {}),
			...(instruction.reason ? { reason: instruction.reason } : {}),
		};
		context.emit({
			type: "plan_skip",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: payload,
			summary: instruction.reason ?? "Plan skipped.",
			message: instruction.reason ?? "Plan skipped.",
		});
	}

	private emitPlanUpdated(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		planState: PlanState,
		taskId: string | undefined,
		message: string,
		activePlan?: ActivePlanState,
	): void {
		const nextSignature = this.planStateMeaningfulSignature(planState);
		if (activePlan?.lastEmittedPlanSignature === nextSignature) {
			return;
		}
		if (activePlan) {
			activePlan.lastEmittedPlanSignature = nextSignature;
		}
		const payload = {
			type: "plan_update" as const,
			state: planState,
			...(activePlan?.source ? { source: activePlan.source } : {}),
			...(taskId ? { taskId } : {}),
			message,
		};
		context.emit({
			type: "plan_update",
			payload,
		});
		this.report(input, {
			phase: "plan",
			depth: input.depth ?? 0,
			plan: this.asTaskBarPlanProgress(payload),
			summary: message,
			message,
		});
	}

	private applyRuntimeEnvelopeProcess(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		envelope: RuntimeEnvelope,
		activePlan?: ActivePlanState,
	): void {
		if (!activePlan || input.metadata?.suppressVisibleNarration === true) {
			return;
		}
		const intake = envelope.intake ?? (!activePlan.intakeEmitted ? this.buildFallbackIntakeDecision(input, envelope) : undefined);
		if (envelope.intake && !activePlan.intakeEmitted) {
			this.emitIntakeDecision(input, context, {
				...intake!,
				source: envelope.intake.source,
			});
			activePlan.intakeEmitted = true;
		}
		if (!envelope.intake && intake && !activePlan.intakeEmitted) {
			this.emitIntakeDecision(input, context, intake);
			activePlan.intakeEmitted = true;
		}
		if (this.shouldSuppressModelAuthoredProcess(input, envelope, intake)) {
			return;
		}
		this.applyRuntimePlanInstruction(input, context, envelope.plan, activePlan);
	}

	private planStateMeaningfulSignature(planState: PlanState): string {
		return JSON.stringify({
			status: planState.status,
			currentTaskId: planState.currentTaskId,
			tasks: planState.tasks.map((task) => ({
				id: task.id,
				title: task.title,
				status: task.status,
				summary: task.summary ?? "",
			})),
		});
	}

	private isTerminalPlanState(planState: PlanState): boolean {
		return planState.status === "completed" || planState.status === "skipped" || planState.status === "failed";
	}

	private normalizeRuntimePlanRevisionChanges(changes: unknown): PlanRevisionChange[] {
		if (!Array.isArray(changes)) {
			return [];
		}
		return changes
			.filter((change): change is PlanRevisionChange => Boolean(change && typeof change === "object"))
			.map((change) => ({
				type: change.type,
				...(typeof change.taskId === "string" && change.taskId.trim() ? { taskId: change.taskId.trim() } : {}),
				...(typeof change.title === "string" && change.title.trim() ? { title: change.title.trim() } : {}),
				...(this.isPlanTaskStatus(change.status) ? { status: change.status } : {}),
			}))
			.filter((change) =>
				change.type === "add" ||
				change.type === "remove" ||
				change.type === "rename" ||
				change.type === "reorder" ||
				change.type === "status"
			);
	}

	private normalizeRuntimePlanTasks(tasks: unknown): Array<{ id?: string; title: string }> {
		if (!Array.isArray(tasks)) {
			return [];
		}
		return tasks
			.filter((task): task is { id?: unknown; title?: unknown } => Boolean(task && typeof task === "object" && !Array.isArray(task)))
			.map((task) => {
				const title = typeof task.title === "string" ? task.title.trim() : "";
				if (!title) {
					return null;
				}
				const id = typeof task.id === "string" && task.id.trim() ? task.id.trim() : undefined;
				return {
					...(id ? { id } : {}),
					title,
				};
			})
			.filter((task): task is { id?: string; title: string } => Boolean(task));
	}

	private isPlanTaskStatus(status: unknown): status is PlanState["tasks"][number]["status"] {
		return status === "pending" ||
			status === "in_progress" ||
			status === "completed" ||
			status === "skipped" ||
			status === "failed" ||
			status === "blocked";
	}

	private asTaskBarPlanProgress(plan: {
		type: "plan_update" | "plan_complete";
		state: PlanState;
		taskId?: string;
		message?: string;
	}) {
		return {
			...plan,
			type: "plan_create" as const,
		};
	}

	private emitStageReport(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		report: {
			step?: number;
			summary: string;
			justDone?: string;
			next?: string;
			source: AgentNarrationPayload["source"];
			status?: AgentNarrationPayload["status"];
		},
	): void {
		this.emitNarration(input, context, {
			kind: "stage_report",
			summary: report.summary,
			source: report.source,
			status: report.status ?? "running",
			...(report.justDone ? { justDone: report.justDone } : {}),
			...(report.next ? { next: report.next } : {}),
		}, report.step);
	}

	private emitToolStageReport(input: AgentTurnInput, context: AgentExecutionContext, trace: RuntimeToolTrace): void {
		const justDone = this.describeToolProgress(trace);
		const next = trace.status === "ok"
			? "接下来会根据工具结果继续推进。"
			: "接下来会说明问题并选择可恢复的下一步。";
		this.emitStageReport(input, context, {
			step: trace.step,
			summary: `${justDone}${next ? ` ${next}` : ""}`.trim(),
			justDone,
			next,
			source: "fallback",
			status: trace.status === "ok" ? "completed" : "failed",
		});
	}

	private emitNarration(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		narration: AgentNarrationPayload,
		step?: number,
	): void {
		const payload = {
			...narration,
			...(step !== undefined ? { step } : {}),
		};
		context.emit({
			type: "narration",
			payload,
		});
		this.report(input, {
			phase: "narration",
			depth: input.depth ?? 0,
			...(step !== undefined ? { step } : {}),
			narration,
			summary: narration.summary,
			message: narration.summary,
		});
	}

	private emitFallback(input: AgentTurnInput, context: AgentExecutionContext, message: string): void {
		context.emit({
			type: "fallback" as AgentTurnEvent["type"],
			payload: { from: "native", to: "prompt", reason: message },
		});
		this.report(input, {
			phase: "fallback",
			depth: input.depth ?? 0,
			message: `Native tool calling incompatible, fallback to prompt mode (replays current step once): ${message.slice(0, 180)}`,
		});
	}

	private formatTransportProgressMessage(event: LlmTransportEvent): string {
		const recoveryAttempt = `网络波动，正在恢复请求（第 ${event.attempt}/${Math.max(1, event.maxAttempts - 1)} 次）`;
		switch (event.type) {
			case "retry_scheduled":
				return recoveryAttempt;
			case "retry_started":
				return recoveryAttempt;
			case "request_exhausted":
				return "请求多次未成功，请稍后重试。";
			case "request_failed":
				return "本次模型请求未成功。";
			case "request_succeeded":
				return "模型请求已完成。";
			case "request_started":
			default:
				return "模型请求已开始。";
		}
	}

	private shouldEmitVisibleNarration(input: AgentTurnInput, intake = this.buildIntakeDecision(input)): boolean {
		if (input.metadata?.suppressVisibleNarration === true) {
			return false;
		}
		const prompt = input.userPrompt.trim();
		if (!prompt) {
			return false;
		}
		return intake.shouldShowProcess && intake.shouldUseVisiblePlan;
	}

	private shouldSuppressModelAuthoredProcess(
		input: AgentTurnInput,
		envelope?: RuntimeEnvelope,
		intake?: IntakeDecision,
	): boolean {
		if (input.metadata?.suppressVisibleNarration === true) {
			return true;
		}
		const effectiveIntake = intake ?? envelope?.intake;
		if (effectiveIntake && !this.shouldEmitVisibleNarration(input, effectiveIntake)) {
			return true;
		}
		return envelope?.plan?.type === "plan_create" && (
			envelope.plan.visibility === "hidden" ||
			envelope.plan.visibility === "internal"
		);
	}

	private shouldEmitToolStageNarration(input: AgentTurnInput): boolean {
		if (input.metadata?.suppressVisibleNarration === true) {
			return false;
		}
		const prompt = input.userPrompt.trim();
		if (!prompt) {
			return false;
		}
		if ((input.allowedTools?.length ?? 0) > 0) {
			return true;
		}
		return /(read|write|edit|delete|create|file|project|workspace|grep|search|run|test|读取|读|写|创建|修改|删除|文件|项目|工作区|搜索|查找|运行|测试|实现|修复)/i.test(prompt);
	}

	private buildIntakeDecision(input: AgentTurnInput): IntakeDecision {
		const complexity = this.classifyIntakeComplexity(input);
		const interactionRoute = inferInteractionRouteFromLegacy({ complexity });
		const defaults = getIntakeRouteDefaults(interactionRoute);
		return {
			complexity: defaults.complexity,
			route: defaults.route,
			interactionRoute,
			statement: this.buildTaskUnderstanding(input.userPrompt),
			requiresPlan: defaults.requiresPlan,
			shouldShowProcess: defaults.shouldShowProcess,
			shouldUseVisiblePlan: defaults.shouldUseVisiblePlan,
			source: "runtime",
		};
	}

	private buildFallbackIntakeDecision(input: AgentTurnInput, envelope: RuntimeEnvelope): IntakeDecision {
		const interactionRoute = this.resolveFallbackInteractionRoute(envelope);
		const defaults = getIntakeRouteDefaults(interactionRoute);
		return {
			...defaults,
			interactionRoute,
			statement: this.buildTaskUnderstanding(input.userPrompt),
			source: "fallback",
		};
	}

	private resolveFallbackInteractionRoute(envelope: RuntimeEnvelope): IntakeInteractionRoute {
		if (this.hasVisiblePlanCreate(envelope)) {
			return "task_with_process";
		}
		if (envelope.type === "tool_call" || envelope.tool || hasMutationPlans(envelope)) {
			return "light_task";
		}
		if (typeof envelope.assistant === "string" && envelope.assistant.trim()) {
			return "direct_answer";
		}
		return "clarify";
	}

	private hasVisiblePlanCreate(envelope: RuntimeEnvelope): boolean {
		return envelope.plan?.type === "plan_create" && (
			envelope.plan.visibility === "visible" ||
			envelope.plan.visibility === "task_bar" ||
			envelope.plan.visibility === undefined
		);
	}

	private classifyIntakeComplexity(input: AgentTurnInput): IntakeComplexity {
		const prompt = input.userPrompt.trim();
		if (!prompt) {
			return "unclear";
		}
		if (this.isSimpleAnswerLikePrompt(prompt) && !this.hasMutationTool(input)) {
			return "simple";
		}
		const operativePrompt = this.removeNegatedTaskSignals(prompt);
		if (this.hasComplexTaskSignal(operativePrompt) || this.hasMutationTool(input)) {
			return "complex";
		}
		if ((input.allowedTools?.length ?? 0) > 0 || this.hasLightTaskSignal(operativePrompt) || this.hasOneStepLightTaskSignal(operativePrompt)) {
			return "light";
		}
		return "simple";
	}

	private hasMutationTool(input: AgentTurnInput): boolean {
		return (input.allowedTools ?? []).some((tool) => /(edit|write|delete|create|patch|apply|rename|move)/i.test(tool));
	}

	private hasVerificationTaskSignal(prompt: string): boolean {
		return /\b(test|verify|build|lint|check|ci|regression)\b/i.test(prompt) ||
			/(娴嬭瘯|楠岃瘉|鏋勫缓|妫€鏌鍥炲綊)/u.test(prompt);
	}

	private isSimpleAnswerLikePrompt(prompt: string): boolean {
		const normalized = prompt.trim();
		if (/^(一句话回答|直接回答|简短回答|简要回答|只回答|用一句话回答|一句话说清楚)[:：\s]/u.test(normalized)) {
			return true;
		}
		if (/^(answer directly|direct answer|answer in one sentence|one-sentence answer|brief answer|briefly answer|respond briefly|keep it brief)\b/i.test(normalized)) {
			return true;
		}
		if (/^(rewrite|rephrase|polish|translate|summari[sz]e|explain|what|when|where|who|why|how)\b/i.test(normalized)) {
			return true;
		}
		if (/^(改写|润色|翻译|总结|解释|说明|什么|谁|何时|哪里|为什么|怎么|现在几点)/.test(normalized)) {
			return true;
		}
		return normalized.length <= 120 && /(\?|？)(?:$|[\s。.!！])/u.test(normalized);
	}

	private hasComplexTaskSignal(prompt: string): boolean {
		if (this.isSimpleAnswerLikePrompt(prompt)) {
			return false;
		}
		if (this.hasMultiStepTaskSignal(prompt)) {
			return true;
		}
		if (/\baddress\s+(?:them|it|pr\s+comments?|review\s+comments?|comments?|feedback)\b/i.test(prompt)) {
			return true;
		}
		if (/(implement|optimi[sz]e|refactor|debug|fix|plan|analy[sz]e|research|investigate|architect|design|root cause|bug|failure|failing|regression)/i.test(prompt)) {
			return true;
		}
		if (this.hasOneStepLightTaskSignal(prompt)) {
			return false;
		}
		return /(implement|optimi[sz]e|refactor|debug|fix|review|audit|plan|analy[sz]e|research|investigate|build|create|update|delete|write|test|verify|实现|优化|重构|调试|修复|审阅|检查|验收|方案|计划|分析|研究|排查|创建|更新|删除|写|测试|验证)/i.test(prompt);
	}

	private hasLightTaskSignal(prompt: string): boolean {
		return /(read|open|list|grep|search|find|run|读取|读|打开|列出|搜索|查找|运行|文件|项目|工作区)/i.test(prompt);
	}

	private hasOneStepLightTaskSignal(prompt: string): boolean {
		return /\b(read|open|list|grep|search|find|run|check|test|verify|review|audit|write|update)\b/i.test(prompt) ||
			/(?:只|仅|只需|仅需)(?:[^。！？!?；;,.，、]{0,12})(?:运行|跑|执行)(?:[^。！？!?；;,.，、]{0,8})(?:一次|一遍)(?:[^。！？!?；;,.，、]{0,12})(?:测试|检查|命令)/u.test(prompt);
	}

	private hasMultiStepTaskSignal(prompt: string): boolean {
		return /\b(first|then|next|finally|after that|step by step)\b/i.test(prompt) ||
			/\b(and|,)\s+(then\s+)?(implement|debug|fix|refactor|analy[sz]e|research|investigate|update|write|run|test|verify|review|check|read|build|create)\b/i.test(prompt);
	}

	private removeNegatedTaskSignals(prompt: string): string {
		return prompt
			.replace(/(?:不要|别|不用|无需|不需要|请勿|禁止|不要再|不要去)(?:[^。！？!?；;,.，、]{0,24})(?:读取|读|查看|打开|搜索|查找|制定计划|计划|规划|写计划|列计划|创建计划|文件|工具)/giu, " ")
			.replace(/(?:\u4e0d\u8981|\u4e0d\u7528|\u65e0\u9700|\u4e0d\u9700\u8981|\u522b|\u522b\u53bb|\u7981\u6b62)(?:[^\u3002\uff01\uff1f?!.;,\uff0c\u3001]{0,24})(?:\u8bfb\u53d6|\u67e5\u770b|\u6253\u5f00|\u641c\u7d22|\u67e5\u627e|\u5236\u5b9a\u8ba1\u5212|\u8ba1\u5212|\u89c4\u5212|\u5199\u8ba1\u5212|\u5217\u8ba1\u5212|\u521b\u5efa\u8ba1\u5212|\u6587\u4ef6|\u5de5\u5177|\u5206\u6790|\u5ba1\u9605|\u6d4b\u8bd5|\u68c0\u67e5|\u9a8c\u8bc1|\u8bc4\u5ba1|\u6392\u67e5)/giu, " ")
			.replace(/(?:do not|don't|don\u2019t|dont|without|no need to|do not need to|never)\s+(?:\w+\s+){0,8}?(?:read|open|search|grep|inspect|plan|make a plan|create a plan|use tools?|touch files?|access files?|analy[sz]e|review|audit|test|verify|investigate|debug)/giu, " ");
	}

	private buildTaskUnderstanding(userPrompt: string): string {
		const goal = this.removeNegatedTaskSignals(userPrompt).trim().replace(/\s+/g, " ");
		const friendly = this.buildFriendlyTaskUnderstanding(goal);
		if (friendly) {
			return friendly;
		}
		if (/(read|读取|读|文件|file)/i.test(goal)) {
			return "需要先读取文件或相关内容，再基于结果回答。";
		}
		if (/(write|edit|create|修改|创建|写|产物|文档)/i.test(goal)) {
			return "需要准备文件修改，并在最终回答中总结修改点。";
		}
		if (/(test|run|测试|运行|验证)/i.test(goal)) {
			return "需要执行验证并汇报关键结果。";
		}
		return goal ? `需要处理：${goal.slice(0, 120)}` : "需要结合当前上下文处理这个请求。";
	}

	private buildFriendlyTaskUnderstanding(goal: string): string {
		if (/(read|读取|file|文件)/i.test(goal)) {
			return "我理解你希望读取文件并基于结果回答。";
		}
		if (/(write|edit|create|修改|创建|文档|产物)/i.test(goal)) {
			return "我理解你希望我准备文件修改，并在最后说明改动结果。";
		}
		if (/(test|run|验证|测试|运行)/i.test(goal)) {
			return "我理解你希望我运行验证并汇报关键结果。";
		}
		return goal ? `我理解你希望我处理：${goal.slice(0, 120)}` : "我理解你希望我结合当前上下文处理这个请求。";
	}

	private buildInitialPlan(input: AgentTurnInput): string[] {
		return this.buildFriendlyInitialPlan(input);
	}

	private buildFriendlyInitialPlan(input: AgentTurnInput): string[] {
		const goal = this.removeNegatedTaskSignals(input.userPrompt).trim();
		if (/(fix|debug|bug|failure|failing|修复|调试|故障|失败|报错|排查)/i.test(goal)) {
			return ["定位问题根因", "实现并验证修复", "汇总改动和风险"];
		}
		if (/(implement|build|create|feature|实现|开发|构建|创建|功能)/i.test(goal)) {
			return ["确定实现范围", "完成代码改动", "运行验证并汇总"];
		}
		if (/(optimi[sz]e|refactor|performance|优化|重构|性能)/i.test(goal)) {
			return ["确认优化目标", "调整实现结构", "验证影响并汇总"];
		}
		if (/(review|audit|check|验收|审阅|检查|评审)/i.test(goal)) {
			return ["梳理检查范围", "逐项审查证据", "汇总发现和风险"];
		}
		if (/(analy[sz]e|research|investigate|分析|研究|排查)/i.test(goal)) {
			return ["收集相关证据", "分析关键结论", "整理结论和建议"];
		}
		if (/(test|verify|run|测试|验证|运行)/i.test(goal)) {
			return ["确定验证范围", "运行相关检查", "汇报验证结果"];
		}
		if (/(read|open|grep|search|find|读取|打开|搜索|查找|文件)/i.test(goal)) {
			return ["读取相关内容", "基于结果回答"];
		}
		return ["处理核心请求", "给出结果"];
	}

	private shouldUseToolPlan(userPrompt: string): boolean {
		return this.hasComplexTaskSignal(userPrompt);
	}

	private isExplicitReadOnlyRequest(prompt: string): boolean {
		return /\b(read-only|readonly|no modifications?|no changes?|do not modify|don't modify|don\u2019t modify|do not change|don't change|don\u2019t change|without modifying|without changing)\b/i.test(prompt) ||
			/(只读|不要修改|不要改动|不修改|不改动|无需修改|不要做修改|不要更改|不做更改)/u.test(prompt);
	}

	private isMutationShapedPlanTask(title: string): boolean {
		if (/\b(without|no)\s+(?:modifying|changing|editing|writing|deleting)\b/i.test(title)) {
			return false;
		}
		return /\b(edit|modify|update|change|write|delete|create|patch|apply|rename|move|fix|address)\b/i.test(title) ||
			/(编辑|修改|更新|改动|写入|删除|创建|修复|应用|重命名|移动)/u.test(title);
	}

	private extractModelNarration(text: string): string {
		const cleaned = text.trim().replace(/^```[\s\S]*?```$/g, "").trim();
		if (!cleaned || cleaned.length > 320) {
			return "";
		}
		if (this.isIntermediateAssistantText(cleaned)) {
			return "";
		}
		if (/^(我理解|我会|接下来|下一步|先|已经|已|I understand|I will|I'll|Next|Plan:)/i.test(cleaned)) {
			return cleaned;
		}
		if (/接下来我会|我理解你的需求|准备先|先读取|先查看|will call|will use/i.test(cleaned)) {
			return cleaned;
		}
		return "";
	}

	private describeToolProgress(trace: RuntimeToolTrace): string {
		const target = trace.targetPath?.trim();
		const tool = trace.tool.trim().toLowerCase();
		if (trace.status !== "ok") {
			return trace.summary || `${trace.tool} 未完成。`;
		}
		if (tool === "read") {
			return target ? `已读取 ${target}。` : "已读取相关内容。";
		}
		if (tool === "ls" || tool === "glob") {
			return target ? `已查看 ${target}。` : "已查看当前范围。";
		}
		if (tool === "grep" || tool === "search_text") {
			return target ? `已在 ${target} 中检索。` : "已完成检索。";
		}
		if (tool === "write" || tool === "edit") {
			return target ? `已准备 ${target} 的文件改动。` : "已准备文件改动。";
		}
		return trace.summary || `已完成 ${trace.tool}。`;
	}

	private async recordMutationPlans(envelope: RuntimeEnvelope, context: AgentExecutionContext): Promise<RuntimeMutationPlan[]> {
		return await this.options.toolExecution.recordMutationPlans?.(envelope, "model_envelope", context) ?? [];
	}

	private async resolveResumeCheckpoint(
		input: AgentTurnInput,
		context: AgentExecutionContext,
	): Promise<AgentLoopCheckpoint | null> {
		const resumeFromCheckpointId = input.resumeFromCheckpointId?.trim() ||
			(typeof input.metadata?.resumeFromCheckpointId === "string" ? input.metadata.resumeFromCheckpointId.trim() : "");
		if (!resumeFromCheckpointId || !this.options.checkpoint?.getResumeCheckpoint) {
			return null;
		}
		let checkpoint: AgentLoopCheckpoint | null = null;
		try {
			checkpoint = await this.options.checkpoint.getResumeCheckpoint(input, context);
		} catch {
			return null;
		}
		if (!checkpoint) {
			return null;
		}
		const validation = validateCheckpointForResume({
			checkpoint,
			conversationId: context.conversationId,
			agentId: context.agentId,
			taskId: input.retryOfTaskId || input.taskId || context.taskId,
			allowedTools: input.allowedTools,
		});
		if (!validation.ok) {
			await this.markCheckpointConsumed(checkpoint.id, "rejected", validation.reason);
			context.emit({
				type: "checkpoint_resume_rejected",
				payload: this.buildCheckpointEventPayload(checkpoint, validation.reason),
			});
			this.report(input, {
				phase: "checkpoint",
				depth: input.depth ?? 0,
				step: checkpoint.nextStep,
				checkpoint: {
					type: "resume_rejected",
					checkpointId: checkpoint.id,
					boundary: checkpoint.boundary,
					reason: validation.reason,
				},
				message: `Checkpoint resume rejected: ${validation.reason}`,
			});
			return null;
		}
		await this.markCheckpointConsumed(checkpoint.id, "resumed", "Checkpoint resume started.");
		context.emit({
			type: "checkpoint_resume_started",
			payload: this.buildCheckpointEventPayload(checkpoint, "Checkpoint resume started."),
		});
		this.report(input, {
			phase: "checkpoint",
			depth: input.depth ?? 0,
			step: checkpoint.nextStep,
			checkpoint: {
				type: "resume_started",
				checkpointId: checkpoint.id,
				boundary: checkpoint.boundary,
				canAutoResume: checkpoint.safety.canAutoResume,
				reason: "Checkpoint resume started.",
			},
			message: `Resuming from checkpoint ${checkpoint.id} at ${checkpoint.boundary}.`,
		});
		return sanitizeAgentLoopCheckpoint(checkpoint);
	}

	private async runFromCheckpoint(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		checkpoint: AgentLoopCheckpoint,
	): Promise<AgentTurnResult> {
		const maxIterations = Math.max(
			checkpoint.nextStep,
			context.budget.tool?.maxIterations ?? checkpoint.maxIterations ?? checkpoint.nextStep,
		);
		const contextPackage: ContextPackage = {
			toolCallingMode: checkpoint.channel,
			maxIterations,
			messages: cloneMessages(checkpoint.modelMessages),
		};
		const initialState = {
			startStep: checkpoint.nextStep,
			traces: checkpoint.traces,
		};
		if (checkpoint.channel === "prompt") {
			return this.runPromptLoop(input, context, contextPackage, initialState);
		}
		return this.runNativeLoop(input, context, contextPackage, initialState);
	}

	private repairNativeModelMessages(messages: AgentChatMessage[]): ToolBoundaryRepair[] {
		const result = this.toolBoundaryFilter.repair(messages as ToolBoundaryMessage[], {
			maxToolResultTokens: 4096,
		});
		if (result.repairs.length === 0) {
			return [];
		}
		messages.splice(0, messages.length, ...(result.messages as AgentChatMessage[]));
		return result.repairs;
	}

	private reportNativeMessageRepairs(input: AgentTurnInput, step: number, repairs: ToolBoundaryRepair[]): void {
		const summary = repairs
			.reduce<Record<string, number>>((counts, repair) => {
				counts[repair.reason] = (counts[repair.reason] ?? 0) + 1;
				return counts;
			}, {});
		this.report(input, {
			phase: "context",
			depth: input.depth ?? 0,
			step,
			summary: JSON.stringify(summary),
			message: `Step ${step}: repaired native tool-call history before model request.`,
		});
	}

	private async markCheckpointConsumed(
		checkpointId: string,
		result: "resumed" | "rejected" | "expired",
		reason: string,
	): Promise<void> {
		try {
			await this.options.checkpoint?.markConsumed?.(checkpointId, result, reason);
		} catch {
			// Checkpoint consumption metadata is diagnostic; do not fail the user turn.
		}
	}

	private async saveCheckpoint(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		options: {
			boundary: AgentLoopCheckpointBoundary;
			channel: "prompt" | "native";
			step: number;
			nextStep: number;
			maxIterations?: number;
			modelMessages: AgentChatMessage[];
			traces: RuntimeToolTrace[];
			pendingMutations?: RuntimeMutationPlan[];
			completedToolCalls?: AgentCheckpointToolResultRef[];
			safetyReason: string;
		},
	): Promise<void> {
		if (!this.options.checkpoint) {
			return;
		}
		const canAutoResume = options.boundary === "context_ready" || (
			options.boundary === "after_tool_result" &&
			(options.pendingMutations?.length ?? 0) === 0 &&
			(options.completedToolCalls?.length ?? 0) > 0 &&
			(options.completedToolCalls ?? []).every((tool) => tool.status === "ok")
		);
		const checkpoint = sanitizeAgentLoopCheckpoint({
			schemaVersion: 1,
			id: createAgentLoopCheckpointId(context.turnId, options.boundary, options.step),
			turnId: context.turnId,
			...(context.taskId ? { taskId: context.taskId } : {}),
			traceId: context.traceId,
			conversationId: context.conversationId,
			agentId: context.agentId,
			boundary: options.boundary,
			channel: options.channel,
			step: options.step,
			nextStep: options.nextStep,
			...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
			createdAt: new Date().toISOString(),
			...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
			mode: input.mode,
			...(input.allowedTools ? { allowedTools: [...input.allowedTools] } : {}),
			modelMessages: cloneMessages(options.modelMessages),
			traces: options.traces.map((trace) => ({ ...trace })),
			pendingMutations: options.pendingMutations?.map((mutation) => ({ ...mutation })) ?? [],
			completedToolCalls: options.completedToolCalls?.map((tool) => ({ ...tool })) ?? [],
			lastEventSequence: context.snapshotEvents().length,
			safety: {
				canAutoResume,
				reason: options.safetyReason,
			},
			privacy: {
				redacted: true,
				localOnly: true,
			},
		});
		try {
			await this.options.checkpoint.save(checkpoint);
			context.emit({
				type: "checkpoint_saved",
				payload: this.buildCheckpointEventPayload(checkpoint, options.safetyReason),
			});
			this.report(input, {
				phase: "checkpoint",
				depth: input.depth ?? 0,
				step: checkpoint.step,
				checkpoint: {
					type: "saved",
					checkpointId: checkpoint.id,
					boundary: checkpoint.boundary,
					canAutoResume: checkpoint.safety.canAutoResume,
					reason: options.safetyReason,
				},
				message: `Checkpoint saved at ${checkpoint.boundary}.`,
			});
		} catch {
			// Checkpoints improve recovery only. A persistence failure must not fail the user turn.
		}
	}

	private emitCheckpointResumeCompleted(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		checkpoint: AgentLoopCheckpoint,
	): void {
		context.emit({
			type: "checkpoint_resume_completed",
			payload: this.buildCheckpointEventPayload(checkpoint, "Checkpoint resume completed."),
		});
		this.report(input, {
			phase: "checkpoint",
			depth: input.depth ?? 0,
			step: checkpoint.nextStep,
			checkpoint: {
				type: "resume_completed",
				checkpointId: checkpoint.id,
				boundary: checkpoint.boundary,
				canAutoResume: checkpoint.safety.canAutoResume,
				reason: "Checkpoint resume completed.",
			},
			message: `Checkpoint resume completed from ${checkpoint.boundary}.`,
		});
	}

	private buildCheckpointEventPayload(checkpoint: AgentLoopCheckpoint, reason: string): Record<string, unknown> {
		return {
			checkpointId: checkpoint.id,
			boundary: checkpoint.boundary,
			step: checkpoint.step,
			nextStep: checkpoint.nextStep,
			canAutoResume: checkpoint.safety.canAutoResume,
			reason,
		};
	}

	private resolveMaxIterations(contextPackage: ContextPackage, context: AgentExecutionContext): number {
		return Math.max(1, context.budget.tool?.maxIterations ?? contextPackage.maxIterations ?? 1);
	}

	private resolveEmergencyFuseStep(startStep: number, maxIterations: number): number {
		const configuredIterations = Math.max(1, maxIterations - startStep + 1);
		const fuseIterations = Math.min(
			MAX_EMERGENCY_FUSE_ITERATIONS,
			Math.max(MIN_EMERGENCY_FUSE_ITERATIONS, configuredIterations * EMERGENCY_FUSE_MULTIPLIER),
		);
		return startStep + fuseIterations - 1;
	}

	private isRetryableTransportFailure(message: string): boolean {
		return this.options.fallbackPolicy?.isRetryableTransportFailure(message) ??
			/(gateway timeout|504|timeout|econnreset|retryable|temporarily unavailable|暂时不可用|网关)/i.test(message);
	}

	private shouldFallbackToPrompt(message: string): boolean {
		return this.options.fallbackPolicy?.shouldFallbackToPrompt(message) ??
			/(400|404|405|tool|function|responses|unsupported|schema|protocol)/i.test(message);
	}

	private report(input: AgentTurnInput, event: RuntimeProgressEvent): void {
		this.options.progress?.report(input, event);
	}

	private isIntermediateAssistantText(text: string): boolean {
		const normalized = text.trim().toLowerCase();
		return !normalized || normalized.startsWith("calling tool:") || normalized.includes("continuing with tool calls");
	}

	private resolveFinalAssistantText(
		candidate: string,
		traces: RuntimeToolTrace[],
		lastToolUserFallback: string,
		emptyFallback: string,
	): { assistantText: string; replacedTraceSummary: boolean } {
		const assistantText = candidate.trim();
		const fallback = lastToolUserFallback.trim() || this.buildGenericToolFallback(traces);
		if (!assistantText) {
			return { assistantText: fallback || emptyFallback, replacedTraceSummary: Boolean(fallback) };
		}
		if (this.isTraceOnlyAssistantText(assistantText, traces)) {
			return { assistantText: fallback || emptyFallback, replacedTraceSummary: true };
		}
		return { assistantText, replacedTraceSummary: false };
	}

	private isTraceOnlyAssistantText(text: string, traces: RuntimeToolTrace[]): boolean {
		const normalized = text.trim();
		if (!normalized || /^TOOL_RESULT\b/.test(normalized)) {
			return true;
		}
		if (traces.some((trace) => trace.summary.trim() === normalized)) {
			return true;
		}
		if (this.isTraceOnlyReadSummary(normalized, traces)) {
			return true;
		}
		return [
			/^Listed \d+ item\(s\)$/,
			/^(?:grep|search_text) matched \d+ result\(s\)$/,
			/^glob matched \d+ file\(s\)$/,
			/^Write completed .+$/,
			/^Delete completed (?:file|folder) .+$/,
			/^Edited .+ \(\d+ replacement\(s\)\)$/,
			/^Exec completed \((?:exit code .+|timed out)\)$/,
		].some((pattern) => pattern.test(normalized));
	}

	private isTraceOnlyReadSummary(text: string, traces: RuntimeToolTrace[]): boolean {
		const match = text.match(/^Read\s+(.+?)(?:\s+\(truncated\))?$/);
		const readTarget = match?.[1]?.trim();
		if (!readTarget) {
			return false;
		}
		return traces.some((trace) => {
			if (trace.tool !== "read") {
				return false;
			}
			const traceTarget = trace.targetPath?.trim();
			if (traceTarget && traceTarget === readTarget) {
				return true;
			}
			return trace.summary.trim().replace(/\s+\(truncated\)$/, "") === text;
		});
	}

	private buildGenericToolFallback(traces: RuntimeToolTrace[]): string {
		const lastTrace = [...traces].reverse().find((trace) => trace.tool);
		if (!lastTrace) {
			return "";
		}
		if (lastTrace.status === "failed" || lastTrace.status === "denied") {
			return `I couldn't complete the ${lastTrace.tool} step. Check the process details for the error and recovery suggestions.`;
		}
		return "I completed the tool step, but the model did not provide a user-facing final answer. Check the process details for the tool output.";
	}

	private buildFallbackAssistantFromToolPayload(payload: ToolExecutionResult["payload"] | null, explicitFallback = ""): string {
		const fallback = explicitFallback.trim() || summarizeForUserFallback(payload).trim();
		if (fallback) {
			return fallback;
		}
		if (!payload?.ok) {
			return "";
		}
		if (payload.tool === "read") {
			const data = payload.data as { path?: string; content?: string } | undefined;
			if (!data?.path) {
				return "";
			}
			const content = typeof data.content === "string" ? data.content.trim().slice(0, 320) : "";
			return content ? `已读取 ${data.path}，摘录如下：\n${content}` : `已读取 ${data.path}，但文件内容为空。`;
		}
		if (payload.tool === "ls") {
			const data = payload.data as { path?: string; items?: string[] } | undefined;
			const items = Array.isArray(data?.items) ? data.items.filter((item) => typeof item === "string" && item.length > 0) : [];
			if (items.length === 0) {
				return "当前项目下没有检索到可见条目。";
			}
			const scopeLabel = data?.path?.trim() || "当前项目";
			return `当前范围 ${scopeLabel} 下可见 ${items.length} 项：\n${items.slice(0, 8).map((item) => `- ${item}`).join("\n")}`;
		}
		return "";
	}
}

function cloneMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
	return messages.map((message) => ({
		...message,
		...(message.parts ? { parts: [...message.parts] } : {}),
		...(message.toolCalls ? { toolCalls: message.toolCalls.map(cloneToolCallLike) } : {}),
	}));
}

function normalizeTextModelResponse(response: Awaited<ReturnType<ModelDriverPort["requestText"]>> | string): Awaited<ReturnType<ModelDriverPort["requestText"]>> {
	if (typeof response === "string") {
		return {
			assistantText: response,
			toolCalls: [],
		};
	}
	return response;
}

function cloneToolCallLike(call: unknown): unknown {
	if (!call || typeof call !== "object") {
		return call;
	}
	const value = call as { args?: unknown };
	return {
		...value,
		...(value.args && typeof value.args === "object" ? { args: { ...value.args } } : {}),
	};
}

function buildSafeReasoningMetadata(reasoningArtifact: ReasoningArtifact | undefined): {
	hasReasoning: boolean;
	reasoningProvider?: ReasoningArtifact["provider"];
	reasoningRawFormat?: ReasoningArtifact["rawFormat"];
	reasoningContinuationPolicy?: ReasoningArtifact["continuationPolicy"];
	reasoningVisibleSummary?: string;
	reasoningWarnings?: string[];
} {
	if (!reasoningArtifact?.hasReasoning) {
		return { hasReasoning: false };
	}
	const warnings = reasoningArtifact.metadata.warnings?.filter((item) => item.trim().length > 0) ?? [];
	return {
		hasReasoning: true,
		reasoningProvider: reasoningArtifact.provider,
		reasoningRawFormat: reasoningArtifact.rawFormat,
		reasoningContinuationPolicy: reasoningArtifact.continuationPolicy,
		reasoningVisibleSummary: reasoningArtifact.visibleSummary,
		...(warnings.length > 0 ? { reasoningWarnings: warnings } : {}),
	};
}
