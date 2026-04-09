import { promises as fsPromises } from "fs";
import path from "path";
import {
	normalizePath,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
} from "obsidian";
import { ChatMessage, AIService } from "./AIService";
import { AgentAction, AgentActionType } from "../types/action";
import { FridaySettings } from "../types/settings";
import { AgentActionService } from "./AgentActionService";
import { AgentService } from "./AgentService";
import { WorkspaceAccessService } from "./WorkspaceAccessService";
import { ToolApprovalScope, ToolApprovalService } from "./ToolApprovalService";
import { CommandExecService } from "./CommandExecService";
import { InlineEditService, EditOperation } from "./InlineEditService";
import { ToolDefinition } from "../types/tools";
import { SkillCommandService, SuggestedSkill } from "./SkillCommandService";
import { ProjectBoundaryService } from "./ProjectBoundaryService";

interface RuntimeToolCall {
	name: string;
	args?: Record<string, unknown>;
}

interface RuntimeSubagentCall {
	goal: string;
	model?: string;
}

interface RuntimeEnvelope {
	type?: string;
	assistant?: string;
	tool?: RuntimeToolCall;
	subagent?: RuntimeSubagentCall;
}

interface RuntimeToolResultPayload {
	ok: boolean;
	tool: string;
	data?: unknown;
	error?: string;
}

export interface RuntimeToolTrace {
	step: number;
	tool: string;
	scope: ToolApprovalScope;
	targetPath: string;
	approved: boolean;
	approvalReason: string;
	persistedRule: boolean;
	viaRule: boolean;
	ok: boolean;
	summary: string;
	error?: string;
}

export interface RuntimeTurnResult {
	assistantText: string;
	traces: RuntimeToolTrace[];
	rawFinalReply: string;
	parseError?: string;
}

export interface RuntimeProgressEvent {
	phase:
		| "start"
		| "model_request"
		| "model_response"
		| "tool_approval"
		| "tool_call"
		| "tool_result"
		| "subagent_start"
		| "subagent_result"
		| "fallback"
		| "done"
		| "error";
	depth: number;
	step?: number;
	tool?: string;
	message: string;
}

export interface RuntimeWikiCompileSummary {
	projectSlug: string;
	projectRoot: string;
	requested: number;
	processed: number;
	succeeded: number;
	failed: number;
	rawPaths: string[];
	updatedDocs: string[];
	updatedIndex: string;
	updatedLog: string;
}

interface RuntimeTurnInput {
	agentId: string;
	conversation: ChatMessage[];
	userPrompt: string;
	modelOverride?: string;
	depth?: number;
	currentFilePath?: string;
	extraSystemContext?: string;
	allowedTools?: string[];
	onProgress?: (event: RuntimeProgressEvent) => void;
}

const RUNTIME_CODE_FENCE = "friday-runtime";
const MAX_MODEL_RESULT_CHARS = 5000;
const MAX_TOOL_RESULT_ITEM = 80;
const DEFAULT_MAX_LIST = 120;
const DEFAULT_MAX_READ_CHARS = 10000;
const DEFAULT_MAX_GREP_MATCHES = 40;

export class AgentRuntimeService {
	constructor(
		private readonly vault: Vault,
		private readonly aiService: AIService,
		private readonly agentService: AgentService,
		private readonly workspaceAccessService: WorkspaceAccessService,
		private readonly actionService: AgentActionService,
		private readonly approvalService: ToolApprovalService,
		private readonly commandExecService: CommandExecService,
		private readonly inlineEditService: InlineEditService,
		private readonly skillCommandService: SkillCommandService,
		private readonly projectBoundaryService: ProjectBoundaryService,
		private readonly compileWikiForActiveProject: (
			rawPaths?: string[],
		) => Promise<RuntimeWikiCompileSummary>,
		private readonly getSettings: () => FridaySettings,
	) {}

	async runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const depth = input.depth ?? 0;
		const mode = this.getSettings().agentRuntime.toolCallingMode ?? "auto";
		this.reportProgress(input, {
			phase: "start",
			depth,
			message: `Runtime started (mode=${mode}, depth=${depth})`,
		});

		try {
			if (mode === "prompt") {
				const result = await this.runTurnPrompt(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return result;
			}
			if (mode === "native") {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return result;
			}
			try {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				if (!this.isNativeFallbackCandidate(message)) {
					throw error;
				}
				this.reportProgress(input, {
					phase: "fallback",
					depth,
					message: `Native tool calling failed, fallback to prompt mode: ${this.truncateText(message, 180)}`,
				});
				const result = await this.runTurnPrompt(input);
				if (result.parseError) {
					result.parseError = `Native tool calling fallback: ${message}\n${result.parseError}`;
				} else {
					result.parseError = `Native tool calling fallback: ${message}`;
				}
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length}, fallback)`,
				});
				return result;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.reportProgress(input, {
				phase: "error",
				depth,
				message: `Runtime failed: ${this.truncateText(message, 220)}`,
			});
			throw error;
		}
	}

	private reportProgress(input: RuntimeTurnInput, event: RuntimeProgressEvent): void {
		try {
			input.onProgress?.(event);
		} catch {
			// Ignore observer errors to avoid blocking runtime execution.
		}
	}

	private async runTurnPrompt(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const settings = this.getSettings();
		const depth = input.depth ?? 0;
		const maxSteps = Math.max(1, settings.agentRuntime.maxToolIterations || 1);
		const allowedToolSet = this.buildAllowedToolSet(input.allowedTools);
		const traces: RuntimeToolTrace[] = [];
		const history = this.buildRuntimeHistory(input.conversation);
		const systemPrompt = await this.buildSystemPrompt(
			input.agentId,
			depth,
			input.currentFilePath,
			input.extraSystemContext,
			input.userPrompt,
		);
		const modelMessages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...history,
			{ role: "user", content: input.userPrompt },
		];

		let finalReply = "";
		for (let step = 1; step <= maxSteps; step += 1) {
			this.reportProgress(input, {
				phase: "model_request",
				depth,
				step,
				message: `Step ${step}: requesting model decision (prompt runtime)`,
			});
			const reply = await this.aiService.chat(modelMessages, {
				modelOverride: input.modelOverride?.trim() || undefined,
			});
			finalReply = reply.trim();
			this.reportProgress(input, {
				phase: "model_response",
				depth,
				step,
				message: `Step ${step}: model response received`,
			});
			const parsed = this.parseRuntimeEnvelope(finalReply);
			if (!parsed) {
				return {
					assistantText: finalReply,
					traces,
					rawFinalReply: finalReply,
					parseError: "Runtime response is not valid JSON; returned as plain text.",
				};
			}

			if (parsed.type === "response" || (!parsed.type && !parsed.tool && !parsed.subagent)) {
				return {
					assistantText: (parsed.assistant ?? finalReply).trim() || "(Model returned no usable content)",
					traces,
					rawFinalReply: finalReply,
				};
			}

			if (parsed.type === "subagent" || parsed.subagent) {
				const subGoal = parsed.subagent?.goal?.trim() || "(empty goal)";
				this.reportProgress(input, {
					phase: "subagent_start",
					depth,
					step,
					message: `Step ${step}: starting subagent - ${this.truncateText(subGoal, 120)}`,
				});
				const subResult = await this.executeSubagent(step, input, parsed.subagent);
				traces.push(subResult.trace);
				this.reportProgress(input, {
					phase: "subagent_result",
					depth,
					step,
					message: `Step ${step}: subagent completed - ${subResult.trace.summary}`,
				});
				modelMessages.push({ role: "assistant", content: finalReply });
				modelMessages.push({
					role: "user",
					content: this.formatToolResultForModel(subResult.payload),
				});
				continue;
			}

			if (parsed.type === "tool_call" || parsed.tool) {
				const tool = parsed.tool;
				if (!tool || !tool.name) {
					return {
						assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
						traces,
						rawFinalReply: finalReply,
						parseError: "tool.name is missing",
					};
				}

				this.reportProgress(input, {
					phase: "tool_call",
					depth,
					step,
					tool: tool.name,
					message: `Step ${step}: calling tool ${tool.name}`,
				});
				const executedResult = await this.executeTool(step, input, tool, allowedToolSet);
				traces.push(executedResult.trace);
				this.reportProgress(input, {
					phase: "tool_result",
					depth,
					step,
					tool: tool.name,
					message: `Step ${step}: tool ${tool.name} finished - ${executedResult.trace.summary}`,
				});
				modelMessages.push({ role: "assistant", content: finalReply });
				modelMessages.push({
					role: "user",
					content: this.formatToolResultForModel(executedResult.payload),
				});
				continue;
			}

			return {
				assistantText: finalReply,
				traces,
				rawFinalReply: finalReply,
				parseError: "Unknown runtime envelope type.",
			};
		}

		const overflowTip = "Maximum tool-iteration limit reached. Stopped further tool calls.";
		return {
			assistantText: finalReply ? `${finalReply}\n\n${overflowTip}` : overflowTip,
			traces,
			rawFinalReply: finalReply,
		};
	}

	private async runTurnNative(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const settings = this.getSettings();
		const depth = input.depth ?? 0;
		const maxSteps = Math.max(1, settings.agentRuntime.maxToolIterations || 1);
		const allowedToolSet = this.buildAllowedToolSet(input.allowedTools);
		const traces: RuntimeToolTrace[] = [];
		const history = this.buildRuntimeHistory(input.conversation);
		const systemPrompt = await this.buildSystemPrompt(
			input.agentId,
			depth,
			input.currentFilePath,
			input.extraSystemContext,
			input.userPrompt,
		);
		const modelMessages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...history,
			{ role: "user", content: input.userPrompt },
		];
		const tools = this.buildNativeToolDefinitions(settings, allowedToolSet);
		if (tools.length === 0) {
			return {
				assistantText: "No tool is allowed for this command.",
				traces,
				rawFinalReply: "",
			};
		}

		let finalReply = "";
		for (let step = 1; step <= maxSteps; step += 1) {
			this.reportProgress(input, {
				phase: "model_request",
				depth,
				step,
				message: `Step ${step}: requesting model decision (native tools)`,
			});
			const response = await this.aiService.chatWithTools(modelMessages, tools, {
				modelOverride: input.modelOverride?.trim() || undefined,
			});
			finalReply = response.assistantText?.trim() || finalReply;
			this.reportProgress(input, {
				phase: "model_response",
				depth,
				step,
				message: `Step ${step}: model response received`,
			});

			if (!response.toolCall) {
				const assistantPayload = response.assistantText?.trim() || finalReply || "";
				const parsed = this.parseRuntimeEnvelope(assistantPayload);
				if (parsed) {
					if (parsed.type === "response" || (!parsed.type && !parsed.tool && !parsed.subagent)) {
						return {
							assistantText: (parsed.assistant ?? assistantPayload).trim() || "(Model returned no usable content)",
							traces,
							rawFinalReply: assistantPayload || finalReply,
						};
					}

					if (parsed.type === "subagent" || parsed.subagent) {
						const subGoal = parsed.subagent?.goal?.trim() || "(empty goal)";
						this.reportProgress(input, {
							phase: "subagent_start",
							depth,
							step,
							message: `Step ${step}: starting subagent - ${this.truncateText(subGoal, 120)}`,
						});
						const subResult = await this.executeSubagent(step, input, parsed.subagent);
						traces.push(subResult.trace);
						this.reportProgress(input, {
							phase: "subagent_result",
							depth,
							step,
							message: `Step ${step}: subagent completed - ${subResult.trace.summary}`,
						});
						modelMessages.push({
							role: "assistant",
							content: assistantPayload || "Subagent call generated from JSON envelope.",
						});
						modelMessages.push({
							role: "user",
							content: this.formatToolResultForModel(subResult.payload),
						});
						continue;
					}

					if (parsed.type === "tool_call" || parsed.tool) {
						const tool = parsed.tool;
						if (!tool || !tool.name) {
							return {
								assistantText: "Tool call is missing tool.name. Runtime execution stopped for this turn.",
								traces,
								rawFinalReply: assistantPayload || finalReply,
								parseError: "tool.name is missing",
							};
						}
						this.reportProgress(input, {
							phase: "tool_call",
							depth,
							step,
							tool: tool.name,
							message: `Step ${step}: calling tool ${tool.name} (JSON envelope fallback)`,
						});
						const toolResult = await this.executeTool(step, input, tool, allowedToolSet);
						traces.push(toolResult.trace);
						this.reportProgress(input, {
							phase: "tool_result",
							depth,
							step,
							tool: tool.name,
							message: `Step ${step}: tool ${tool.name} finished - ${toolResult.trace.summary}`,
						});
						modelMessages.push({
							role: "assistant",
							content: assistantPayload || `Calling tool: ${tool.name}`,
						});
						modelMessages.push({
							role: "user",
							content: this.formatToolResultForModel(toolResult.payload),
						});
						continue;
					}
				}

				return {
					assistantText: assistantPayload || "(Model returned no usable content)",
					traces,
					rawFinalReply: finalReply,
				};
			}

			this.reportProgress(input, {
				phase: "tool_call",
				depth,
				step,
				tool: response.toolCall.name,
				message: `Step ${step}: calling tool ${response.toolCall.name}`,
			});
			const toolResult = await this.executeTool(step, input, {
				name: response.toolCall.name,
				args: response.toolCall.args,
			}, allowedToolSet);
			traces.push(toolResult.trace);
			this.reportProgress(input, {
				phase: "tool_result",
				depth,
				step,
				tool: response.toolCall.name,
				message: `Step ${step}: tool ${response.toolCall.name} finished - ${toolResult.trace.summary}`,
			});

			modelMessages.push({
				role: "assistant",
				content: response.assistantText?.trim() || `Calling tool: ${response.toolCall.name}`,
			});
			modelMessages.push({
				role: "tool",
				content: this.formatToolResultForModel(toolResult.payload),
				toolCallId: response.toolCall.id,
				name: response.toolCall.name,
			});
		}

		const overflowTip = "Maximum tool-iteration limit reached. Stopped further tool calls.";
		return {
			assistantText: finalReply ? `${finalReply}\n\n${overflowTip}` : overflowTip,
			traces,
			rawFinalReply: finalReply,
		};
	}

	private buildRuntimeHistory(conversation: ChatMessage[]): ChatMessage[] {
		const maxHistory = 12;
		return conversation.slice(-maxHistory).map((message) => ({
			role: message.role,
			content: this.truncateText(message.content, 1800),
		}));
	}

	private async buildSystemPrompt(
		agentId: string,
		depth: number,
		currentFilePath?: string,
		extraSystemContext?: string,
		userPrompt?: string,
	): Promise<string> {
		const settings = this.getSettings();
		const focusPaths = settings.agentRuntime.vaultFocusPaths.length
			? settings.agentRuntime.vaultFocusPaths.map((item) => normalizePath(item)).join(", ")
			: "(entire Vault)";
		const externalPaths = settings.agentRuntime.externalReadOnlyPaths.length
			? settings.agentRuntime.externalReadOnlyPaths.join(", ")
			: "(none)";

		// --- Layer merge: FRIDAY.md (project) + agent.md (agent) ---
		const fridayMd = await this.loadFridayMd();
		const agentFilePath = this.agentService.getAgentFilePath(agentId);
		const agentFile = this.vault.getAbstractFileByPath(agentFilePath);
		const agentProfile = agentFile instanceof TFile
			? this.truncateText(await this.vault.cachedRead(agentFile), 3000)
			: "agent.md not found";

		const lines = [
			"You are F.R.I.D.A.Y Agent Runtime.",
			"You must output strict JSON only. Do not output Markdown.",
			"",
			"Allowed response schema (choose one):",
			'{"type":"response","assistant":"final response for user"}',
			'{"type":"tool_call","assistant":"optional note","tool":{"name":"ls|read|grep|glob|compile_wiki|write|edit|delete","args":{...}}}',
			'{"type":"subagent","assistant":"optional note","subagent":{"goal":"task goal","model":"optional"}}',
			"",
			"Rules:",
			"- Prefer tool evidence first; do not hallucinate filesystem facts.",
			"- Call at most one tool each step, then reason with TOOL_RESULT.",
			"- write/delete only supports Vault-relative paths.",
			"- If user asks to compile/rebuild Wiki, call compile_wiki tool first.",
			"- If user asks to create/update/save a file, you MUST call write tool to execute it.",
			"- Never say 'I cannot create/write files' when write tool is available.",
			"- If user says '当前文档/这个文档', prioritize current active file path.",
			"- Before final response, ensure conclusions are based on tool results.",
			"",
			"Tool arguments:",
			'- ls: {"path":"optional path","recursive":false,"maxEntries":120}',
			'- read: {"path":"file path","maxChars":10000}',
			'- grep: {"path":"optional directory or file path","pattern":"regex","flags":"i","maxMatches":40}',
			'- glob: {"path":"optional directory path","pattern":"*.md","maxMatches":80}',
			'- compile_wiki: {"mode":"all|changed(optional)","path":"optional raw path","paths":["optional raw paths"]}',
			'- write: {"path":"Vault-relative path","content":"full file content","mode":"create|update|upsert"}',
			'- edit: {"path":"Vault-relative path","edits":[{"search":"old text","replace":"new text"}]}',
			'- delete: {"path":"Vault-relative path"}',
			...(settings.agentRuntime.enableExecTool
				? ['- exec: {"command":"command-name","args":["arg1","arg2"],"cwd":"optional-working-directory"}']
				: []),
			"",
			"--- Few-shot examples ---",
			"User: list files in project root",
			'Assistant: {"type":"tool_call","assistant":"List files in root.","tool":{"name":"ls","args":{"path":"","recursive":false}}}',
			"",
			"User: read notes/todo.md",
			'Assistant: {"type":"tool_call","assistant":"Read file.","tool":{"name":"read","args":{"path":"notes/todo.md"}}}',
			"",
			'User: create test.md with content "hello"',
			'Assistant: {"type":"tool_call","assistant":"Create file.","tool":{"name":"write","args":{"path":"test.md","content":"hello","mode":"create"}}}',
			"--- End examples ---",
			"",
			`Runtime depth: ${depth}`,
			`Current active file: ${currentFilePath?.trim() || "(none)"}`,
			`Vault focus paths: ${focusPaths}`,
			`External read-only paths: ${externalPaths}`,
		];

		// Layer 1: FRIDAY.md (project-level persistent instructions)
		if (fridayMd) {
			lines.push("");
			lines.push("--- Project instructions (FRIDAY.md) ---");
			lines.push(fridayMd);
			lines.push("--- End project instructions ---");
		}

		// Layer 2: agent.md (agent-specific profile)
		lines.push("");
		lines.push("Current agent.md excerpt:");
		lines.push(agentProfile);

		const trimmedExtra = extraSystemContext?.trim();
		if (trimmedExtra) {
			lines.push("");
			lines.push("Extra runtime context:");
			lines.push(trimmedExtra);
		}

		const autoSkillContext = await this.buildAutoSkillContext(userPrompt, currentFilePath, trimmedExtra);
		if (autoSkillContext) {
			lines.push("");
			lines.push(autoSkillContext);
		}

		return lines.join("\n");
	}

	private async buildAutoSkillContext(
		userPrompt: string | undefined,
		currentFilePath: string | undefined,
		extraSystemContext: string | undefined,
	): Promise<string> {
		const prompt = userPrompt?.trim() ?? "";
		if (!prompt) {
			return "";
		}
		if (extraSystemContext?.includes("[SkillInvocation]")) {
			return "";
		}

		let suggestions: SuggestedSkill[] = [];
		try {
			suggestions = await this.skillCommandService.suggestSkillsForPrompt(prompt, currentFilePath);
		} catch {
			return "";
		}
		if (suggestions.length === 0) {
			return "";
		}

		const lines: string[] = [];
		lines.push("--- Auto-matched skills (trigger=auto) ---");
		lines.push("Use these skills only when the task clearly matches their domain constraints:");
		for (const item of suggestions.slice(0, 3)) {
			lines.push(`- ${item.skill.name} (/${item.skill.command})`);
			if (item.reasons.length > 0) {
				lines.push(`  reasons: ${item.reasons.join("; ")}`);
			}
			if (item.skill.tags.length > 0) {
				lines.push(`  tags: ${item.skill.tags.join(", ")}`);
			}
			if (item.skill.globs.length > 0) {
				lines.push(`  globs: ${item.skill.globs.join(", ")}`);
			}
		}
		lines.push("--- End auto-matched skills ---");
		return lines.join("\n");
	}

	private async loadFridayMd(): Promise<string | null> {
		const fridayMdPath = normalizePath("F.R.I.D.A.Y/Agents/_global/FRIDAY.md");
		const file = this.vault.getAbstractFileByPath(fridayMdPath);
		if (!(file instanceof TFile)) {
			return null;
		}
		try {
			const content = await this.vault.cachedRead(file);
			const trimmed = content.trim();
			return trimmed ? this.truncateText(trimmed, 6000) : null;
		} catch {
			return null;
		}
	}

	private parseRuntimeEnvelope(raw: string): RuntimeEnvelope | null {
		const trimmed = raw.trim();
		if (!trimmed) {
			return null;
		}

		const fencedMatch = trimmed.match(new RegExp("```" + RUNTIME_CODE_FENCE + "\\s*([\\s\\S]*?)```", "i"));
		const jsonPayload = fencedMatch?.[1]?.trim() ?? trimmed;
		const objectText = this.extractJsonObject(jsonPayload);
		if (!objectText) {
			return null;
		}

		try {
			const parsed = JSON.parse(objectText) as RuntimeEnvelope;
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	}

	private extractJsonObject(raw: string): string | null {
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		if (start < 0 || end <= start) {
			return null;
		}
		return raw.slice(start, end + 1);
	}

	private async executeSubagent(
		step: number,
		input: RuntimeTurnInput,
		subagent: RuntimeSubagentCall | undefined,
	): Promise<{ trace: RuntimeToolTrace; payload: RuntimeToolResultPayload }> {
		const settings = this.getSettings();
		const depth = input.depth ?? 0;
		const goal = subagent?.goal?.trim() ?? "";
		if (!goal) {
			return {
				trace: this.traceFromError(step, "subagent", "vault", "", "子代理调用缺少 goal"),
				payload: { ok: false, tool: "subagent", error: "missing goal" },
			};
		}

		if (!settings.agentRuntime.enableSubagent) {
			return {
				trace: this.traceFromError(step, "subagent", "vault", "", "子代理功能未启用"),
				payload: { ok: false, tool: "subagent", error: "subagent disabled" },
			};
		}

		if (depth >= settings.agentRuntime.maxSubagentDepth) {
			return {
				trace: this.traceFromError(step, "subagent", "vault", "", "Subagent depth limit reached"),
				payload: { ok: false, tool: "subagent", error: "subagent depth limit reached" },
			};
		}

		const approval = await this.approvalService.requestApproval({
			agentId: input.agentId,
			tool: "subagent",
			scope: "vault",
			description: `Run subagent task: ${this.truncateText(goal, 160)}`,
		});

		if (!approval.allowed) {
			return {
				trace: {
					step,
					tool: "subagent",
					scope: "vault",
					targetPath: "",
					approved: false,
					approvalReason: approval.reason,
					persistedRule: approval.persisted,
					viaRule: approval.viaRule,
					ok: false,
					summary: "子代理执行被拒绝",
					error: approval.reason,
				},
				payload: { ok: false, tool: "subagent", error: approval.reason },
			};
		}

		const result = await this.runTurn({
			agentId: input.agentId,
			conversation: [],
			userPrompt: goal,
			modelOverride: subagent?.model?.trim() || input.modelOverride,
			depth: depth + 1,
			currentFilePath: input.currentFilePath,
			extraSystemContext: input.extraSystemContext,
			allowedTools: input.allowedTools,
			onProgress: input.onProgress,
		});

		return {
			trace: {
				step,
				tool: "subagent",
				scope: "vault",
				targetPath: "",
				approved: true,
				approvalReason: approval.reason,
				persistedRule: approval.persisted,
				viaRule: approval.viaRule,
				ok: true,
				summary: `子代理完成：${this.truncateText(result.assistantText, 120)}`,
			},
			payload: {
				ok: true,
				tool: "subagent",
				data: {
					assistantText: result.assistantText,
					traceCount: result.traces.length,
				},
			},
		};
	}

	private async executeTool(
		step: number,
		input: RuntimeTurnInput,
		tool: RuntimeToolCall,
		allowedTools: Set<string> | null,
	): Promise<{ trace: RuntimeToolTrace; payload: RuntimeToolResultPayload }> {
		const depth = input.depth ?? 0;
		const agentId = input.agentId;
		const name = tool.name.trim().toLowerCase();
		const args = tool.args ?? {};
		const targetPath = this.resolveToolTargetPath(name, args);
		const scope = this.resolveScope(targetPath);
		const shouldReportApproval = !["ls", "read", "grep", "glob"].includes(name);
		if (allowedTools && allowedTools.size > 0 && !allowedTools.has(name)) {
			const reason = `Tool ${name} is not allowed by the current command policy.`;
			return {
				trace: {
					step,
					tool: name,
					scope,
					targetPath,
					approved: false,
					approvalReason: reason,
					persistedRule: false,
					viaRule: false,
					ok: false,
					summary: `${name} 已被命令策略拦截`,
					error: reason,
				},
				payload: {
					ok: false,
					tool: name,
					error: reason,
				},
			};
		}

		if (shouldReportApproval) {
			const target = targetPath ? `（${targetPath}）` : "";
			this.reportProgress(input, {
				phase: "tool_approval",
				depth,
				step,
				tool: name,
				message: `正在申请工具权限：${name}${target}`,
			});
		}

		const approval = await this.approvalService.requestApproval({
			agentId,
			tool: name,
			scope,
			targetPath: scope === "vault" ? normalizePath(targetPath || "") : targetPath,
			description: `${name}(${this.safeStringify(args, 260)})`,
		});

		if (!approval.allowed) {
			if (shouldReportApproval) {
				this.reportProgress(input, {
					phase: "tool_approval",
					depth,
					step,
					tool: name,
					message: `工具权限被拒绝：${name}`,
				});
			}
			return {
				trace: {
					step,
					tool: name,
					scope,
					targetPath,
					approved: false,
					approvalReason: approval.reason,
					persistedRule: approval.persisted,
					viaRule: approval.viaRule,
					ok: false,
					summary: `${name} blocked`,
					error: approval.reason,
				},
				payload: { ok: false, tool: name, error: approval.reason },
			};
		}

		if (shouldReportApproval) {
			const approvalStatus = approval.viaRule
				? "命中已保存规则，自动授权"
				: approval.persisted
					? "已授权并保存规则"
					: "已授权";
			this.reportProgress(input, {
				phase: "tool_approval",
				depth,
				step,
				tool: name,
				message: `${name} 权限${approvalStatus}`,
			});
		}

		try {
			const data = await this.runToolByName(name, args, agentId);
			const payload: RuntimeToolResultPayload = { ok: true, tool: name, data };
			return {
				trace: {
					step,
					tool: name,
					scope,
					targetPath,
					approved: true,
					approvalReason: approval.reason,
					persistedRule: approval.persisted,
					viaRule: approval.viaRule,
					ok: true,
					summary: this.buildSummaryFromData(name, data),
				},
				payload,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			return {
				trace: {
					step,
					tool: name,
					scope,
					targetPath,
					approved: true,
					approvalReason: approval.reason,
					persistedRule: approval.persisted,
					viaRule: approval.viaRule,
					ok: false,
					summary: `${name} failed`,
					error: message || "Unknown error",
				},
				payload: {
					ok: false,
					tool: name,
					error: message || "unknown tool execution error",
				},
			};
		}
	}

	private async runToolByName(name: string, args: Record<string, unknown>, agentId: string): Promise<unknown> {
		if (name === "ls") {
			return this.toolList(args);
		}
		if (name === "read") {
			return this.toolRead(args);
		}
		if (name === "grep") {
			return this.toolGrep(args);
		}
		if (name === "glob") {
			return this.toolGlob(args);
		}
		if (name === "compile_wiki") {
			return this.toolCompileWiki(args);
		}
		if (name === "write") {
			return this.toolWrite(args, agentId);
		}
		if (name === "edit") {
			return this.toolEdit(args, agentId);
		}
		if (name === "delete") {
			return this.toolDelete(args, agentId);
		}
		if (name === "exec") {
			return this.toolExec(args);
		}

		throw new Error(`Unsupported tool: ${name}`);
	}

	private async toolList(args: Record<string, unknown>): Promise<unknown> {
		const rawPath = this.getStringArg(args, "path");
		const maxEntries = this.getPositiveIntArg(args, "maxEntries", DEFAULT_MAX_LIST);
		const recursive = this.getBooleanArg(args, "recursive", false);
		const scope = this.resolveScope(rawPath);
		if (scope === "external") {
			if (!rawPath || !this.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const rows = await this.listExternal(rawPath, recursive, maxEntries);
			return {
				scope: "external",
				path: rawPath,
				items: rows,
			};
		}

		const targetPath = normalizePath(rawPath || "");
		if (targetPath && !this.workspaceAccessService.canReadVaultPath(targetPath)) {
			throw new Error(this.buildVaultScopeDeniedError(targetPath, "read"));
		}

		const rows = this.listVault(targetPath, recursive, maxEntries);
		return {
			scope: "vault",
			path: targetPath,
			items: rows,
		};
	}

	private async toolRead(args: Record<string, unknown>): Promise<unknown> {
		const rawPath = this.getRequiredStringArg(args, "path");
		const maxChars = this.getPositiveIntArg(args, "maxChars", DEFAULT_MAX_READ_CHARS);
		const scope = this.resolveScope(rawPath);

		if (scope === "external") {
			if (!this.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath}`);
			}
			const stat = await fsPromises.stat(rawPath);
			if (!stat.isFile()) {
				throw new Error(`External path is not a file: ${rawPath}`);
			}
			const text = await fsPromises.readFile(rawPath, "utf8");
			return {
				scope: "external",
				path: rawPath,
				content: this.truncateText(text, maxChars),
				truncated: text.length > maxChars,
			};
		}

		const targetPath = this.resolveVaultFilePath(rawPath);
		if (!this.workspaceAccessService.canReadVaultPath(targetPath)) {
			throw new Error(this.buildVaultScopeDeniedError(targetPath, "read"));
		}
		const file = this.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${targetPath}`);
		}
		const text = await this.vault.cachedRead(file);
		return {
			scope: "vault",
			path: targetPath,
			content: this.truncateText(text, maxChars),
			truncated: text.length > maxChars,
		};
	}

	private async toolGrep(args: Record<string, unknown>): Promise<unknown> {
		const pattern = this.getRequiredStringArg(args, "pattern");
		const flags = this.getStringArg(args, "flags") || "i";
		const maxMatches = this.getPositiveIntArg(args, "maxMatches", DEFAULT_MAX_GREP_MATCHES);
		const rawPath = this.getStringArg(args, "path");
		const scope = this.resolveScope(rawPath);
		const regExp = this.buildSafeRegex(pattern, flags);

		const matches: Array<{ path: string; line: number; text: string }> = [];
		if (scope === "external") {
			if (!rawPath || !this.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const fileList = await this.collectExternalFiles(rawPath, 120);
			for (const filePath of fileList) {
				const text = await fsPromises.readFile(filePath, "utf8");
				this.appendGrepMatches(matches, filePath, text, regExp, maxMatches);
				if (matches.length >= maxMatches) break;
			}
		} else {
			const targetPath = normalizePath(rawPath || "");
			if (targetPath && !this.workspaceAccessService.canReadVaultPath(targetPath)) {
				throw new Error(this.buildVaultScopeDeniedError(targetPath, "read"));
			}
			const files = this.vault
				.getFiles()
				.filter((file) => !targetPath || this.isPathWithin(file.path, targetPath));
			for (const file of files) {
				if (!this.workspaceAccessService.canReadVaultPath(file.path)) {
					continue;
				}
				const text = await this.vault.cachedRead(file);
				this.appendGrepMatches(matches, file.path, text, regExp, maxMatches);
				if (matches.length >= maxMatches) break;
			}
		}

		return {
			scope,
			path: rawPath || "",
			pattern,
			matches,
			truncated: matches.length >= maxMatches,
		};
	}

	private async toolGlob(args: Record<string, unknown>): Promise<unknown> {
		const pattern = this.getRequiredStringArg(args, "pattern");
		const maxMatches = this.getPositiveIntArg(args, "maxMatches", MAX_TOOL_RESULT_ITEM);
		const rawPath = this.getStringArg(args, "path");
		const scope = this.resolveScope(rawPath);
		const matcher = this.globToRegex(pattern);

		const matched: string[] = [];
		if (scope === "external") {
			if (!rawPath || !this.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const files = await this.collectExternalFiles(rawPath, 300);
			for (const filePath of files) {
				const relative = rawPath ? normalizePath(path.relative(rawPath, filePath)) : filePath;
				const baseName = path.basename(filePath);
				if (matcher.test(relative) || (!pattern.includes("/") && matcher.test(baseName))) {
					matched.push(filePath);
				}
				if (matched.length >= maxMatches) break;
			}
		} else {
			const targetPath = normalizePath(rawPath || "");
			if (targetPath && !this.workspaceAccessService.canReadVaultPath(targetPath)) {
				throw new Error(this.buildVaultScopeDeniedError(targetPath, "read"));
			}
			for (const file of this.vault.getFiles()) {
				if (targetPath && !this.isPathWithin(file.path, targetPath)) {
					continue;
				}
				if (!this.workspaceAccessService.canReadVaultPath(file.path)) {
					continue;
				}
				const relative = targetPath ? normalizePath(path.posix.relative(targetPath, file.path)) : file.path;
				const baseName = path.posix.basename(file.path);
				if (matcher.test(relative) || (!pattern.includes("/") && matcher.test(baseName))) {
					matched.push(file.path);
				}
				if (matched.length >= maxMatches) break;
			}
		}

		return {
			scope,
			path: rawPath || "",
			pattern,
			files: matched,
			truncated: matched.length >= maxMatches,
		};
	}

	private async toolCompileWiki(args: Record<string, unknown>): Promise<unknown> {
		const mode = this.getStringArg(args, "mode").toLowerCase();
		if (mode === "all") {
			return this.compileWikiForActiveProject(undefined);
		}

		const requestedPaths: string[] = [];
		const singlePath = this.getStringArg(args, "path");
		if (singlePath) {
			requestedPaths.push(singlePath);
		}

		const multiPaths = args["paths"];
		if (Array.isArray(multiPaths)) {
			for (const item of multiPaths) {
				if (typeof item !== "string") {
					continue;
				}
				const normalized = item.trim();
				if (normalized) {
					requestedPaths.push(normalized);
				}
			}
		}

		const normalized = [...new Set(requestedPaths.map((item) => normalizePath(item)))].filter(Boolean);
		return this.compileWikiForActiveProject(normalized.length > 0 ? normalized : undefined);
	}

	private async toolWrite(args: Record<string, unknown>, agentId: string): Promise<unknown> {
		const pathValue = this.getRequiredStringArg(args, "path");
		if (this.resolveScope(pathValue) === "external") {
			throw new Error("write only supports Vault-relative paths.");
		}
		const normalizedPath = normalizePath(pathValue);
		const resolvedExistingPath = this.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.assertVaultWritePath(effectivePath);
		const modeRaw = this.getStringArg(args, "mode").toLowerCase();
		const content = this.getRequiredStringArg(args, "content");
		const existing = this.vault.getAbstractFileByPath(effectivePath);

		let actionType: AgentActionType = "update";
		if (modeRaw === "create") {
			actionType = "create";
		} else if (modeRaw === "update") {
			actionType = "update";
		} else {
			actionType = existing instanceof TFile ? "update" : "create";
		}

		const beforeContent = existing instanceof TFile ? await this.vault.cachedRead(existing) : "";
		const action: AgentAction = {
			type: actionType,
			targetType: normalizedPath.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
			path: effectivePath,
			content,
		};

		await this.actionService.execute(action, agentId);
		const afterFile = this.vault.getAbstractFileByPath(effectivePath);
		const afterContent = afterFile instanceof TFile ? await this.vault.cachedRead(afterFile) : content;

		const diffSegments = this.inlineEditService.computeLineDiff(beforeContent, afterContent);
		return {
			path: effectivePath,
			type: actionType,
			diff: this.makeSimpleDiffSummary(beforeContent, afterContent),
			diffPreview: this.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private async toolDelete(args: Record<string, unknown>, agentId: string): Promise<unknown> {
		const pathValue = this.getRequiredStringArg(args, "path");
		if (this.resolveScope(pathValue) === "external") {
			throw new Error("delete only supports Vault-relative paths.");
		}
		const normalizedPath = normalizePath(pathValue);
		const resolvedExistingPath = this.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.assertVaultWritePath(effectivePath);
		const action: AgentAction = {
			type: "delete",
			targetType: effectivePath.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
			path: effectivePath,
		};
		await this.actionService.execute(action, agentId);
		return {
			path: effectivePath,
			type: "delete",
		};
	}

	private async toolEdit(args: Record<string, unknown>, agentId: string): Promise<unknown> {
		const pathValue = this.getRequiredStringArg(args, "path");
		if (this.resolveScope(pathValue) === "external") {
			throw new Error("edit only supports Vault-relative paths.");
		}
		const normalizedPath = normalizePath(pathValue);
		const resolvedExistingPath = this.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.assertVaultWritePath(effectivePath);
		const file = this.vault.getAbstractFileByPath(effectivePath);
		if (!(file instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${effectivePath}`);
		}
		const beforeContent = await this.vault.cachedRead(file);
		const edits = this.parseEditOperations(args);
		const editResult = this.inlineEditService.applyEdits(beforeContent, edits);

		if (editResult.appliedCount === 0) {
			throw new Error(`No matching text found: ${editResult.failedReasons.join("; ")}`);
		}

		const action: AgentAction = {
			type: "update",
			targetType: effectivePath.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
			path: effectivePath,
			content: editResult.result,
		};
		await this.actionService.execute(action, agentId);

		const diffSegments = this.inlineEditService.computeLineDiff(beforeContent, editResult.result);
		return {
			path: effectivePath,
			appliedEdits: editResult.appliedCount,
			failedReasons: editResult.failedReasons,
			diffPreview: this.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private parseEditOperations(args: Record<string, unknown>): EditOperation[] {
		const rawEdits = args["edits"];
		if (!Array.isArray(rawEdits)) {
			throw new Error("edit tool requires an edits array argument.");
		}
		return rawEdits
			.filter((item): item is Record<string, unknown> => item && typeof item === "object")
			.map((item) => ({
				search: String(item["search"] ?? ""),
				replace: String(item["replace"] ?? ""),
				description: item["description"] ? String(item["description"]) : undefined,
			}));
	}

	private async toolExec(args: Record<string, unknown>): Promise<unknown> {
		const settings = this.getSettings();
		if (!settings.agentRuntime.enableExecTool) {
			throw new Error("exec tool is disabled. Enable it in settings first.");
		}
		const command = this.getRequiredStringArg(args, "command");
		const rawArgs = args["args"];
		const cmdArgs = Array.isArray(rawArgs)
			? rawArgs.map((item) => String(item))
			: [];
		const cwd = this.getStringArg(args, "cwd") || undefined;

		const result = await this.commandExecService.exec(command, cmdArgs, { cwd });
		return {
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			truncated: result.truncated,
			timedOut: result.timedOut,
		};
	}

	private resolveVaultFilePath(rawPath: string): string {
		const resolved = this.resolveExistingVaultFilePath(rawPath);
		if (!resolved) {
			throw new Error(`Vault file does not exist: ${normalizePath(rawPath)}`);
		}
		return resolved;
	}

	private resolveExistingVaultFilePath(rawPath: string): string | null {
		const normalized = normalizePath(rawPath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return normalized;
		}

		const normalizedLower = normalized.toLowerCase();
		const exactCaseInsensitive = this.vault
			.getFiles()
			.find((item) => normalizePath(item.path).toLowerCase() === normalizedLower);
		if (exactCaseInsensitive) {
			return exactCaseInsensitive.path;
		}

		if (normalized.includes("/")) {
			return null;
		}

		const activeProject = this.projectBoundaryService.getActiveProject();
		const activeProjectRoot = activeProject ? this.projectBoundaryService.getProjectRoot(activeProject) : "";
		const hasExtension = normalized.includes(".");
		const candidates = this.vault.getFiles().filter((file) => {
			if (activeProjectRoot && !this.isPathWithin(file.path, activeProjectRoot)) {
				return false;
			}
			if (hasExtension) {
				return file.name.toLowerCase() === normalizedLower;
			}
			return file.basename.toLowerCase() === normalizedLower;
		});

		if (candidates.length === 1) {
			return candidates[0]!.path;
		}
		if (candidates.length > 1) {
			const sample = candidates
				.slice(0, 5)
				.map((item) => item.path)
				.join(", ");
			throw new Error(`File name is not unique: ${normalized}. Candidates: ${sample}`);
		}
		return null;
	}

	private assertVaultWritePath(targetPath: string): void {
		if (this.workspaceAccessService.canWriteVaultPath(targetPath)) {
			return;
		}
		throw new Error(this.buildVaultScopeDeniedError(targetPath, "write"));
	}

	private buildVaultScopeDeniedError(targetPath: string, mode: "read" | "write"): string {
		const normalizedPath = normalizePath(targetPath || "");
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (!activeProject) {
			return `${mode === "write" ? "Write" : "Read"} denied for Vault path: ${normalizedPath}`;
		}
		const projectRoot = this.projectBoundaryService.getProjectRoot(activeProject);
		return `${mode === "write" ? "Write" : "Read"} denied for Vault path: ${normalizedPath} (activeProject=${activeProject.slug}, projectRoot=${projectRoot})`;
	}

	private resolveToolTargetPath(name: string, args: Record<string, unknown>): string {
		if (name === "compile_wiki") {
			const single = this.getStringArg(args, "path");
			if (single) {
				return single;
			}
			const many = args["paths"];
			if (Array.isArray(many)) {
				for (const item of many) {
					if (typeof item !== "string") {
						continue;
					}
					const normalized = item.trim();
					if (normalized) {
						return normalized;
					}
				}
			}
			return "raw";
		}

		const keysByTool: Record<string, string[]> = {
			ls: ["path"],
			read: ["path"],
			grep: ["path"],
			glob: ["path"],
			compile_wiki: ["path"],
			write: ["path"],
			edit: ["path"],
			delete: ["path"],
			exec: ["command"],
		};
		const keys = keysByTool[name] ?? ["path"];
		for (const key of keys) {
			const value = this.getStringArg(args, key);
			if (value) return value;
		}
		return "";
	}

	private resolveScope(pathValue: string): ToolApprovalScope {
		if (!pathValue) return "vault";
		return path.isAbsolute(pathValue) ? "external" : "vault";
	}

	private listVault(targetPath: string, recursive: boolean, maxEntries: number): string[] {
		const allFiles = this.vault.getAllLoadedFiles();
		const scoped = allFiles
			.filter((item) => {
				if (!targetPath) return true;
				return item.path === targetPath || item.path.startsWith(`${targetPath}/`);
			})
			.filter((item) => targetPath || item.path.includes("/"));

		const entries = scoped
			.filter((item) => {
				if (!targetPath) {
					return item.path.split("/").length === 2 || recursive;
				}
				if (recursive) return true;
				const depth = item.path.split("/").length - targetPath.split("/").length;
				return depth <= 1;
			})
			.map((item) => this.formatAbstractFile(item))
			.slice(0, maxEntries);

		return entries;
	}

	private formatAbstractFile(item: TAbstractFile): string {
		if (item instanceof TFolder) {
			return `${item.path}/`;
		}
		return item.path;
	}

	private async listExternal(rootPath: string, recursive: boolean, maxEntries: number): Promise<string[]> {
		const stat = await fsPromises.stat(rootPath);
		if (stat.isFile()) {
			return [normalizePath(rootPath)];
		}

		const output: string[] = [];
		const queue: string[] = [rootPath];
		while (queue.length > 0 && output.length < maxEntries) {
			const current = queue.shift()!;
			const entries = await fsPromises.readdir(current, { withFileTypes: true });
			for (const entry of entries) {
				const absolute = path.join(current, entry.name);
				const normalized = normalizePath(absolute);
				output.push(entry.isDirectory() ? `${normalized}/` : normalized);
				if (output.length >= maxEntries) break;
				if (recursive && entry.isDirectory()) {
					queue.push(absolute);
				}
			}
		}
		return output;
	}

	private async collectExternalFiles(rootPath: string, maxFiles: number): Promise<string[]> {
		const stat = await fsPromises.stat(rootPath);
		if (stat.isFile()) return [rootPath];

		const files: string[] = [];
		const queue: string[] = [rootPath];
		while (queue.length > 0 && files.length < maxFiles) {
			const current = queue.shift()!;
			const entries = await fsPromises.readdir(current, { withFileTypes: true });
			for (const entry of entries) {
				const absolute = path.join(current, entry.name);
				if (entry.isDirectory()) {
					queue.push(absolute);
				} else if (entry.isFile()) {
					files.push(absolute);
				}
				if (files.length >= maxFiles) break;
			}
		}
		return files;
	}

	private appendGrepMatches(
		output: Array<{ path: string; line: number; text: string }>,
		filePath: string,
		text: string,
		regExp: RegExp,
		maxMatches: number,
	): void {
		const lines = text.split(/\r?\n/);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]!;
			if (!regExp.test(line)) {
				continue;
			}
			output.push({
				path: filePath,
				line: index + 1,
				text: this.truncateText(line.trim(), 220),
			});
			if (output.length >= maxMatches) {
				return;
			}
		}
	}

	private buildSafeRegex(pattern: string, flags: string): RegExp {
		try {
			return new RegExp(pattern, flags || "i");
		} catch (error) {
			throw new Error(`Invalid regular expression: ${String(error)}`);
		}
	}

	private globToRegex(pattern: string): RegExp {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".");
		return new RegExp(`^${escaped}$`, "i");
	}

	private isPathWithin(candidatePath: string, basePath: string): boolean {
		if (!basePath) return true;
		return candidatePath === basePath || candidatePath.startsWith(`${basePath}/`);
	}

	private formatToolResultForModel(payload: RuntimeToolResultPayload): string {
		const compact = this.safeStringify(payload, MAX_MODEL_RESULT_CHARS);
		return `TOOL_RESULT ${compact}`;
	}

	private buildSummaryFromData(tool: string, data: unknown): string {
		if (tool === "read") {
			const payload = data as { path?: string; truncated?: boolean };
			return `Read ${payload.path ?? ""}${payload.truncated ? " (truncated)" : ""}`.trim();
		}
		if (tool === "ls") {
			const payload = data as { items?: unknown[] };
			return `Listed ${payload.items?.length ?? 0} item(s)`;
		}
		if (tool === "grep") {
			const payload = data as { matches?: unknown[] };
			return `grep matched ${payload.matches?.length ?? 0} result(s)`;
		}
		if (tool === "glob") {
			const payload = data as { files?: unknown[] };
			return `glob matched ${payload.files?.length ?? 0} file(s)`;
		}
		if (tool === "compile_wiki") {
			const payload = data as {
				projectSlug?: string;
				requested?: number;
				processed?: number;
				succeeded?: number;
				failed?: number;
				updatedDocs?: string[];
				updatedIndex?: string;
				updatedLog?: string;
			};
			const updatedDocs = Array.isArray(payload.updatedDocs) ? payload.updatedDocs.length : 0;
			const indexState = payload.updatedIndex ? "index updated" : "index unchanged";
			const logState = payload.updatedLog ? "log updated" : "log unchanged";
			return `Wiki compile ${payload.projectSlug ?? ""} (requested ${payload.requested ?? 0}, processed ${payload.processed ?? 0}, success ${payload.succeeded ?? 0}, failed ${payload.failed ?? 0}, docs ${updatedDocs}, ${indexState}, ${logState})`.trim();
		}
		if (tool === "write") {
			const payload = data as { path?: string };
			return `Write completed ${payload.path ?? ""}`.trim();
		}
		if (tool === "delete") {
			const payload = data as { path?: string };
			return `Delete completed ${payload.path ?? ""}`.trim();
		}
		if (tool === "edit") {
			const payload = data as { path?: string; appliedEdits?: number };
			return `Edited ${payload.path ?? ""} (${payload.appliedEdits ?? 0} replacement(s))`.trim();
		}
		if (tool === "exec") {
			const payload = data as { exitCode?: number; timedOut?: boolean };
			const status = payload.timedOut ? "timed out" : `exit code ${payload.exitCode ?? "?"}`;
			return `Exec completed (${status})`;
		}
		return `${tool} completed`;
	}

	private traceFromError(
		step: number,
		tool: string,
		scope: ToolApprovalScope,
		targetPath: string,
		error: string,
	): RuntimeToolTrace {
		return {
			step,
			tool,
			scope,
			targetPath,
			approved: true,
			approvalReason: "No approval required",
			persistedRule: false,
			viaRule: false,
			ok: false,
			summary: `${tool} failed`,
			error,
		};
	}

	private makeSimpleDiffSummary(beforeContent: string, afterContent: string): {
		beforeLines: number;
		afterLines: number;
		addedLines: number;
		removedLines: number;
		beforePreview: string;
		afterPreview: string;
	} {
		const beforeLines = beforeContent.split(/\r?\n/);
		const afterLines = afterContent.split(/\r?\n/);
		const addedLines = Math.max(0, afterLines.length - beforeLines.length);
		const removedLines = Math.max(0, beforeLines.length - afterLines.length);
		return {
			beforeLines: beforeLines.length,
			afterLines: afterLines.length,
			addedLines,
			removedLines,
			beforePreview: this.truncateText(beforeContent, 320),
			afterPreview: this.truncateText(afterContent, 320),
		};
	}

	private getStringArg(args: Record<string, unknown>, key: string): string {
		const value = args[key];
		return typeof value === "string" ? value.trim() : "";
	}

	private getRequiredStringArg(args: Record<string, unknown>, key: string): string {
		const value = this.getStringArg(args, key);
		if (!value) {
			throw new Error(`Missing required argument: ${key}`);
		}
		return value;
	}

	private getPositiveIntArg(args: Record<string, unknown>, key: string, fallback: number): number {
		const value = args[key];
		const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	}

	private getBooleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
		const value = args[key];
		if (typeof value === "boolean") return value;
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (normalized === "true") return true;
			if (normalized === "false") return false;
		}
		return fallback;
	}

	private truncateText(text: string, maxChars: number): string {
		if (text.length <= maxChars) return text;
		return `${text.slice(0, maxChars)}...`;
	}

	private safeStringify(value: unknown, maxChars: number): string {
		let raw = "";
		try {
			raw = JSON.stringify(value);
		} catch {
			raw = String(value ?? "");
		}
		return this.truncateText(raw, maxChars);
	}

	private buildNativeToolDefinitions(settings: FridaySettings, allowedTools: Set<string> | null): ToolDefinition[] {
		const tools: ToolDefinition[] = [
			{
				name: "ls",
				description: "List files and folders in a path. Uses Vault-relative path by default.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string", description: "Optional path. Relative for Vault; absolute for allowed external path." },
						recursive: { type: "boolean", default: false },
						maxEntries: { type: "number", default: 120 },
					},
					additionalProperties: false,
				},
			},
			{
				name: "read",
				description: "Read file content from Vault or allowed external path.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string", description: "File path." },
						maxChars: { type: "number", default: 10000 },
					},
					required: ["path"],
					additionalProperties: false,
				},
			},
			{
				name: "grep",
				description: "Search text pattern in files.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						pattern: { type: "string" },
						flags: { type: "string", default: "i" },
						maxMatches: { type: "number", default: 40 },
					},
					required: ["pattern"],
					additionalProperties: false,
				},
			},
			{
				name: "glob",
				description: "Find files by glob pattern.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						pattern: { type: "string" },
						maxMatches: { type: "number", default: 80 },
					},
					required: ["pattern"],
					additionalProperties: false,
				},
			},
			{
				name: "compile_wiki",
				description: "Compile active project raw files into wiki outputs (raw -> wiki re-ingest).",
				parameters: {
					type: "object",
					properties: {
						mode: { type: "string", enum: ["changed", "all"] },
						path: {
							type: "string",
							description: "Optional single raw path (raw-relative, project-relative, or Vault path).",
						},
						paths: {
							type: "array",
							items: { type: "string" },
							description: "Optional raw path list to compile.",
						},
					},
					additionalProperties: false,
				},
			},
			{
				name: "write",
				description: "Create or update a Vault file with full content.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						content: { type: "string" },
						mode: { type: "string", enum: ["create", "update", "upsert"] },
					},
					required: ["path", "content"],
					additionalProperties: false,
				},
			},
			{
				name: "edit",
				description: "Apply targeted search/replace edits to a Vault file.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						edits: {
							type: "array",
							items: {
								type: "object",
								properties: {
									search: { type: "string" },
									replace: { type: "string" },
									description: { type: "string" },
								},
								required: ["search", "replace"],
								additionalProperties: false,
							},
						},
					},
					required: ["path", "edits"],
					additionalProperties: false,
				},
			},
			{
				name: "delete",
				description: "Delete a Vault file.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
					},
					required: ["path"],
					additionalProperties: false,
				},
			},
		];

		if (settings.agentRuntime.enableExecTool) {
			tools.push({
				name: "exec",
				description: "Run a shell command with allowlist/approval restrictions.",
				parameters: {
					type: "object",
					properties: {
						command: { type: "string" },
						args: {
							type: "array",
							items: { type: "string" },
						},
						cwd: { type: "string" },
					},
					required: ["command"],
					additionalProperties: false,
				},
			});
		}

		if (!allowedTools || allowedTools.size === 0) {
			return tools;
		}
		return tools.filter((tool) => allowedTools.has(tool.name));
	}

	private buildAllowedToolSet(allowedTools: string[] | undefined): Set<string> | null {
		if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
			return null;
		}
		const normalized = allowedTools
			.map((item) => item.trim().toLowerCase())
			.filter((item) => item.length > 0);
		if (normalized.length === 0) {
			return null;
		}
		return new Set(normalized);
	}

	private isNativeFallbackCandidate(message: string): boolean {
		const lower = message.toLowerCase();
		return (
			lower.includes("400") ||
			lower.includes("404") ||
			lower.includes("405") ||
			lower.includes("tool") ||
			lower.includes("function") ||
			lower.includes("responses") ||
			lower.includes("unsupported")
		);
	}
}

