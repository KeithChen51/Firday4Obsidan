import type { ToolCall } from "../../types/tools";
import type { LlmTransportEvent } from "../llm/LlmTransportTelemetry";
import type { ReasoningArtifact } from "../llm/ReasoningArtifact";
import type { AgentExecutionContext } from "./AgentExecutionContext";
import { AgentFailureClassifier } from "./AgentFailureClassifier";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "./AgentKernelPorts";
import type { AgentLoopCheckpointPort, AgentLoopFallbackPolicy, AgentLoopLifecyclePort, AgentLoopProgressPort } from "./AgentLoopTypes";
import type { ContextEnginePort, ContextPackage } from "./ContextEnginePort";
import type { ModelDriverPort } from "./ModelDriverPort";
import type { ToolExecutionPort, ToolExecutionResult } from "./ToolExecutionPort";
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
	MAX_TOOL_ITERATION_MESSAGE,
	parseKernelRuntimeEnvelope,
	type RuntimeEnvelope,
} from "./RuntimeProtocol";
import type {
	AgentChatMessage,
	AgentTurnEvent,
	AgentTurnInput,
	AgentTurnResult,
	RuntimeMutationPlan,
	RuntimeProgressEvent,
	RuntimeToolTrace,
} from "./contracts";

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

export class AgentLoopController implements RuntimeTurnExecutorPort {
	private readonly failureClassifier: AgentFailureClassifierPort;

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
			return await this.options.lifecycle?.complete?.(input, context, result) ?? result;
		} catch (error) {
			await this.options.lifecycle?.fail?.(input, context, error);
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
		const contextPackage = await this.options.contextEngine.buildContext(input, context, { channel: "native" });
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
			return this.runPromptLoop(input, context, contextPackage);
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
			return this.runNativeLoop(input, context, contextPackage);
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
			return await this.runNativeLoop(input, context, contextPackage);
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
			const result = await this.runPromptLoop(input, context, promptContext);
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
	): Promise<AgentTurnResult> {
		const startStep = initialState.startStep ?? 1;
		const maxIterations = Math.max(startStep, this.resolveMaxIterations(contextPackage, context));
		const traces: RuntimeToolTrace[] = initialState.traces?.map((trace) => ({ ...trace })) ?? [];
		const modelMessages = [...contextPackage.messages];
		let finalReply = "";
		for (let step = startStep; step <= maxIterations; step += 1) {
			this.emitModelRequest(input, context, step, "prompt", modelMessages);
			const response = await this.options.modelDriver.requestText({
				messages: cloneMessages(modelMessages),
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: context.signal,
				step,
				taskId: context.taskId,
				traceId: context.traceId,
				budget: context.budget,
				onTransportEvent: (event) => this.emitModelTransport(input, context, step, event),
			});
			finalReply = response.assistantText.trim();
			this.emitModelResponse(input, context, step, "prompt", response.assistantText, response.reasoningArtifact);

			const parsed = parseKernelRuntimeEnvelope(finalReply);
			if (!parsed) {
				return this.makeResult(input, context, {
					assistantText: finalReply,
					traces,
					rawFinalReply: finalReply,
					parseError: "Runtime response is not valid JSON; returned as plain text.",
					contextSummary: contextPackage.contextSummary,
				});
			}
			const terminal = await this.resolveTerminalEnvelope(input, context, parsed, finalReply, traces, contextPackage);
			if (terminal) {
				return terminal;
			}
			const tool = parsed.tool;
			if (parsed.type === "tool_call" || tool) {
				if (!tool?.name) {
					return this.makeResult(input, context, {
						assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
						traces,
						rawFinalReply: finalReply,
						parseError: "tool.name is missing",
						contextSummary: contextPackage.contextSummary,
					});
				}
				const executed = await this.executeTool(input, context, step, {
					name: tool.name,
					args: tool.args ?? {},
				});
				traces.push(executed.trace);
				modelMessages.push({
					role: "assistant",
					content: finalReply,
					...(response.reasoningArtifact?.hasReasoning ? { reasoningArtifact: response.reasoningArtifact } : {}),
				});
				modelMessages.push({ role: "user", content: executed.modelResultText });
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
		return this.makeResult(input, context, {
			assistantText: finalReply ? `${finalReply}\n\n${MAX_TOOL_ITERATION_MESSAGE}` : MAX_TOOL_ITERATION_MESSAGE,
			traces,
			rawFinalReply: finalReply,
			contextSummary: contextPackage.contextSummary,
		});
	}

	private async runNativeLoop(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		contextPackage: ContextPackage,
		initialState: AgentLoopInitialState = {},
	): Promise<AgentTurnResult> {
		const startStep = initialState.startStep ?? 1;
		const maxIterations = Math.max(startStep, this.resolveMaxIterations(contextPackage, context));
		const traces: RuntimeToolTrace[] = initialState.traces?.map((trace) => ({ ...trace })) ?? [];
		const modelMessages = [...contextPackage.messages];
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
		for (let step = startStep; step <= maxIterations; step += 1) {
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
			if (assistantStepText) {
				finalReply = assistantStepText;
			}
			this.emitModelResponse(input, context, step, "native", response.assistantText, response.reasoningArtifact);

			if (response.toolCalls.length === 0) {
				const terminal = this.resolveNativeNoToolResult(
					input,
					context,
					contextPackage,
					traces,
					assistantStepText,
					finalReply,
					lastToolPayload,
				);
				return terminal;
			}

			const toolResultMessages: AgentChatMessage[] = [];
			const loadedSkillContexts: string[] = [];
			const completedToolCalls: AgentCheckpointToolResultRef[] = [];
			for (const toolCall of response.toolCalls) {
				const executed = await this.executeTool(input, context, step, {
					id: toolCall.id,
					name: toolCall.name,
					args: toolCall.args ?? {},
				});
				traces.push(executed.trace);
				lastToolPayload = executed.payload;
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
		}
		return this.makeResult(input, context, {
			assistantText: finalReply ? `${finalReply}\n\n${MAX_TOOL_ITERATION_MESSAGE}` : MAX_TOOL_ITERATION_MESSAGE,
			traces,
			rawFinalReply: finalReply,
			contextSummary: contextPackage.contextSummary,
		});
	}

	private async resolveNativeNoToolResult(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		contextPackage: ContextPackage,
		traces: RuntimeToolTrace[],
		assistantStepText: string,
		finalReply: string,
		lastToolPayload: ToolExecutionResult["payload"] | null,
	): Promise<AgentTurnResult> {
		const fallbackAssistant = this.buildFallbackAssistantFromToolPayload(lastToolPayload);
		if (!assistantStepText || this.isIntermediateAssistantText(assistantStepText)) {
			return this.makeResult(input, context, {
				assistantText: fallbackAssistant,
				traces,
				rawFinalReply: finalReply,
				parseError: "Native tool call completed without a user-facing final answer. Generated a fallback reply from tool results.",
				contextSummary: contextPackage.contextSummary,
			});
		}
		const parsed = parseKernelRuntimeEnvelope(assistantStepText);
		if (parsed) {
			const terminal = await this.resolveTerminalEnvelope(input, context, parsed, assistantStepText, traces, contextPackage);
			if (terminal) {
				return terminal;
			}
			const tool = parsed.tool;
			if (parsed.type === "tool_call" || tool) {
				if (!tool?.name) {
					return this.makeResult(input, context, {
						assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
						traces,
						rawFinalReply: assistantStepText || finalReply,
						parseError: "tool.name is missing",
						contextSummary: contextPackage.contextSummary,
					});
				}
				const executed = await this.executeTool(input, context, traces.length + 1, {
					name: tool.name,
					args: tool.args ?? {},
				});
				traces.push(executed.trace);
				return this.makeResult(input, context, {
					assistantText: fallbackAssistant || executed.trace.summary,
					traces,
					rawFinalReply: assistantStepText || finalReply,
					contextSummary: contextPackage.contextSummary,
				});
			}
		}
		return this.makeResult(input, context, {
			assistantText: assistantStepText || "(Model returned no usable content)",
			traces,
			rawFinalReply: finalReply,
			contextSummary: contextPackage.contextSummary,
		});
	}

	private async resolveTerminalEnvelope(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		envelope: RuntimeEnvelope,
		rawFinalReply: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
	): Promise<AgentTurnResult | null> {
		if (isResponseEnvelope(envelope) || (!envelope.tool && hasMutationPlans(envelope))) {
			const pendingMutations = await this.recordMutationPlans(envelope, context);
			return this.makeResult(input, context, {
				assistantText: (envelope.assistant ?? rawFinalReply).trim() || "(Model returned no usable content)",
				traces,
				rawFinalReply,
				pendingMutations,
				contextSummary: contextPackage.contextSummary,
			});
		}
		return null;
	}

	private async executeTool(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		step: number,
		tool: ToolCall,
	): Promise<ToolExecutionResult> {
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
		const result = await this.options.toolExecution.executeTool({ input, context, step, tool });
		context.emit({
			type: "tool_result",
			payload: {
				step,
				tool: tool.name,
				toolCallId: tool.id ?? result.trace.runId,
				status: result.trace.status,
				summary: result.trace.summary,
				targetPath: result.trace.targetPath,
				error: result.trace.error,
				failureClass: result.trace.failureClass,
				recoverable: result.trace.failureClass === "transport_unstable",
				retryable: result.trace.failureClass === "transport_unstable",
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
		return result;
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
		const attempt = `attempt ${event.attempt}/${event.maxAttempts}`;
		const status = event.httpStatus !== undefined ? `HTTP ${event.httpStatus}` : event.message;
		const suffix = status ? ` after ${status}` : "";
		switch (event.type) {
			case "retry_scheduled": {
				const backoff = event.delayMs !== undefined ? `, retrying in ${event.delayMs}ms` : "";
				return `Model request retry scheduled${suffix} (${attempt}${backoff})`;
			}
			case "retry_started":
				return `Model request retry started (${attempt})`;
			case "request_exhausted":
				return `Model request retries exhausted${suffix} (${attempt})`;
			case "request_failed":
				return `Model request failed${suffix} (${attempt})`;
			case "request_succeeded":
				return `Model request succeeded (${attempt})`;
			case "request_started":
			default:
				return `Model request started (${attempt})`;
		}
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

	private buildFallbackAssistantFromToolPayload(payload: ToolExecutionResult["payload"] | null): string {
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
