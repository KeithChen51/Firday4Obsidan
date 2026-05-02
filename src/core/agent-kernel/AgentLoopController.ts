import type { ToolCall } from "../../types/tools";
import type { AgentExecutionContext } from "./AgentExecutionContext";
import { AgentFailureClassifier } from "./AgentFailureClassifier";
import type { AgentFailureClassifierPort, RuntimeTurnExecutorPort } from "./AgentKernelPorts";
import type { AgentLoopFallbackPolicy, AgentLoopLifecyclePort, AgentLoopProgressPort } from "./AgentLoopTypes";
import type { ContextEnginePort, ContextPackage } from "./ContextEnginePort";
import type { ModelDriverPort } from "./ModelDriverPort";
import type { ToolExecutionPort, ToolExecutionResult } from "./ToolExecutionPort";
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
	fallbackPolicy?: AgentLoopFallbackPolicy;
	failureClassifier?: AgentFailureClassifierPort;
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
		const contextPackage = await this.options.contextEngine.buildContext(input, context, { channel: "native" });
		if (contextPackage.toolCallingMode === "prompt") {
			return this.runPromptLoop(input, context, contextPackage);
		}
		if (contextPackage.toolCallingMode === "native") {
			return this.runNativeLoop(input, context, contextPackage);
		}
		try {
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
	): Promise<AgentTurnResult> {
		const maxIterations = this.resolveMaxIterations(contextPackage, context);
		const traces: RuntimeToolTrace[] = [];
		const modelMessages = [...contextPackage.messages];
		let finalReply = "";
		for (let step = 1; step <= maxIterations; step += 1) {
			this.emitModelRequest(input, context, step, "prompt", modelMessages);
			const response = await this.options.modelDriver.requestText({
				messages: cloneMessages(modelMessages),
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: context.signal,
				step,
				taskId: context.taskId,
				traceId: context.traceId,
				budget: context.budget,
			});
			finalReply = response.assistantText.trim();
			this.emitModelResponse(input, context, step, "prompt", response.assistantText);

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
			const terminal = this.resolveTerminalEnvelope(input, context, parsed, finalReply, traces, contextPackage);
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
				modelMessages.push({ role: "assistant", content: finalReply });
				modelMessages.push({ role: "user", content: executed.modelResultText });
				if (executed.loadedSkillContext) {
					modelMessages.push({ role: "system", content: executed.loadedSkillContext });
				}
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
	): Promise<AgentTurnResult> {
		const maxIterations = this.resolveMaxIterations(contextPackage, context);
		const traces: RuntimeToolTrace[] = [];
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
		for (let step = 1; step <= maxIterations; step += 1) {
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
			});
			const assistantStepText = response.assistantText?.trim() || "";
			if (assistantStepText) {
				finalReply = assistantStepText;
			}
			this.emitModelResponse(input, context, step, "native", response.assistantText, response.reasoningContent);

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
			for (const toolCall of response.toolCalls) {
				const executed = await this.executeTool(input, context, step, {
					id: toolCall.id,
					name: toolCall.name,
					args: toolCall.args ?? {},
				});
				traces.push(executed.trace);
				lastToolPayload = executed.payload;
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
				reasoningContent: response.reasoningContent,
			});
			modelMessages.push(...toolResultMessages);
			for (const loadedSkillContext of loadedSkillContexts) {
				modelMessages.push({ role: "system", content: loadedSkillContext });
			}
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
			const terminal = this.resolveTerminalEnvelope(input, context, parsed, assistantStepText, traces, contextPackage);
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

	private resolveTerminalEnvelope(
		input: AgentTurnInput,
		context: AgentExecutionContext,
		envelope: RuntimeEnvelope,
		rawFinalReply: string,
		traces: RuntimeToolTrace[],
		contextPackage: ContextPackage,
	): AgentTurnResult | null {
		if (isResponseEnvelope(envelope) || (!envelope.tool && hasMutationPlans(envelope))) {
			const pendingMutations = this.recordMutationPlans(envelope, context);
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
		reasoningContent?: string,
	): void {
		context.emit({
			type: "model_response",
			payload: {
				step,
				channel,
				hasAssistantText: Boolean(assistantText?.trim()),
				hasReasoningContent: Boolean(reasoningContent?.trim()),
			},
		});
		this.report(input, {
			phase: "model_response",
			depth: input.depth ?? 0,
			step,
			message: `Step ${step}: model response received`,
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

	private recordMutationPlans(envelope: RuntimeEnvelope, context: AgentExecutionContext): RuntimeMutationPlan[] {
		return this.options.toolExecution.recordMutationPlans?.(envelope, "model_envelope", context) ?? [];
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
