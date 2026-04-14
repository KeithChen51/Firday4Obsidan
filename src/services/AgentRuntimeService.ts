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
import { EditPlanRecord, WorkbenchStateStore } from "../features/workbench/WorkbenchStateStore";
import { TurnOrchestrator } from "../core/orchestrator/TurnOrchestrator";
import { SessionOverrideAdapter } from "../core/session-control/SessionOverrideAdapter";
import { PolicyResolverCore } from "../core/security/policy-resolver/PolicyResolverCore";
import { buildPolicyMatrix, PolicyMatrixRow } from "../core/security/policy-resolver/PolicyMatrix";
import { PolicyEffect, PolicyRule } from "../core/security/policy-resolver/types";
import { ContextAssembler } from "../core/context/ContextAssembler";
import { FileMemoryStore } from "../core/memory/FileMemoryStore";
import { WikiKnowledgeProvider } from "../core/retrieval/WikiKnowledgeProvider";
import { parseRuntimeEnvelopeText } from "../core/orchestrator/RuntimeEnvelopeParser";
import { CapabilityResolver } from "../core/tool-governor/CapabilityResolver";
import { ToolFailureClass, ToolGovernor } from "../core/tool-governor/ToolGovernor";
import { StepTraceEvent, TurnStateMachine } from "../core/turn-state/TurnStateMachine";
import { ExecutionGate } from "../core/execution/ExecutionGate";
import type { InvocationRequest } from "../core/execution/InvocationRequest";
import type { ResolvedInvocation } from "../core/execution/ResolvedInvocation";
import { GitConflictCapability } from "../platform/capability/GitConflictCapability";
import { MemoryPersistCapability } from "../platform/capability/MemoryPersistCapability";
import { WikiCompileCapability } from "../platform/capability/WikiCompileCapability";
import { WikiLookupCapability } from "../platform/capability/WikiLookupCapability";
import { detectRuntimeProfile, RuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { StepTraceStore } from "../platform/tools/StepTraceStore";
import { findToolManifest } from "../platform/tools/ToolManifestCatalog";
import { ToolRunAuditStore } from "../platform/tools/ToolRunAuditStore";
import {
	isAgentWritableProjectPath,
	isProjectRawPath,
	resolveAgentWritableVaultPath,
} from "../utils/projectWorkspacePolicy";

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

interface ExecVaultDeleteRedirect {
	routedToDelete: true;
	path: string;
	deletedType: "file" | "folder";
}

interface ExecVaultDeleteRedirect {
	routedToDelete: true;
	path: string;
	deletedType: "file" | "folder";
}

export interface RuntimeToolTrace {
	runId: string;
	step: number;
	tool: string;
	scope: ToolApprovalScope;
	targetPath: string;
	approved: boolean;
	approvalReason: string;
	persistedRule: boolean;
	viaRule: boolean;
	status: "ok" | "failed" | "denied";
	failureClass?: ToolFailureClass;
	ok: boolean;
	summary: string;
	error?: string;
}

export interface RuntimeTurnResult {
	assistantText: string;
	traces: RuntimeToolTrace[];
	rawFinalReply: string;
	turnId?: string;
	stepTraces?: StepTraceEvent[];
	runtimeProfile?: RuntimeProfile;
	contextSummary?: RuntimeContextSummary;
	parseError?: string;
}

export interface RuntimeContextSummary {
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	hasWikiContext: boolean;
	hasMemoryContext: boolean;
	hasAutoSkillContext: boolean;
}

export interface RuntimeProgressEvent {
	phase:
		| "start"
		| "context"
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
	contextKey?: "instructions" | "skills" | "wiki" | "memory" | "compact";
	targetPath?: string;
	status?: "ok" | "failed" | "denied";
	summary?: string;
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

interface BuiltinSkillRunInput {
	agentId: string;
	skillName: string;
	taskPrompt: string;
	currentFilePath?: string;
}

const RUNTIME_CODE_FENCE = "friday-runtime";
const MAX_MODEL_RESULT_CHARS = 5000;
const MAX_TOOL_RESULT_ITEM = 80;
const DEFAULT_MAX_LIST = 120;
const DEFAULT_MAX_READ_CHARS = 10000;
const DEFAULT_MAX_GREP_MATCHES = 40;
const PROJECT_SCOPED_DISCOVERY_TOOLS = new Set(["ls", "grep", "search_text", "glob"]);

export class AgentRuntimeService {
	private readonly turnOrchestrator: TurnOrchestrator;
	private readonly toolGovernor: ToolGovernor;
	private readonly sessionOverrideAdapter: SessionOverrideAdapter;
	private readonly toolRunAuditStore: ToolRunAuditStore;
	private readonly stepTraceStore: StepTraceStore;
	private readonly contextAssembler: ContextAssembler;
	private readonly fileMemoryStore: FileMemoryStore;
	private readonly wikiKnowledgeProvider: WikiKnowledgeProvider;
	private readonly executionGate: ExecutionGate;
	private readonly wikiCompileCapability: WikiCompileCapability;
	private readonly wikiLookupCapability: WikiLookupCapability;
	private readonly memoryPersistCapability: MemoryPersistCapability;
	private readonly gitConflictCapability: GitConflictCapability;
	private activeTurnId = "";
	private activeTurnStateMachine: TurnStateMachine | null = null;
	private activeRuntimeProfile: RuntimeProfile = detectRuntimeProfile();
	private lastContextSummary: RuntimeContextSummary | null = null;

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
		private readonly workbenchStateStore: WorkbenchStateStore,
		private readonly compileWikiForActiveProject: (
			rawPaths?: string[],
			forceRebuild?: boolean,
		) => Promise<RuntimeWikiCompileSummary>,
		private readonly getSettings: () => FridaySettings,
	) {
		this.turnOrchestrator = new TurnOrchestrator();
		this.toolGovernor = new ToolGovernor();
		this.sessionOverrideAdapter = new SessionOverrideAdapter();
		this.toolRunAuditStore = new ToolRunAuditStore(this.vault);
		this.stepTraceStore = new StepTraceStore(this.vault);
		this.contextAssembler = new ContextAssembler();
		this.fileMemoryStore = new FileMemoryStore(this.vault);
		this.wikiKnowledgeProvider = new WikiKnowledgeProvider();
		this.executionGate = new ExecutionGate(this.getSettings);
		this.wikiCompileCapability = new WikiCompileCapability(this.compileWikiForActiveProject);
		this.wikiLookupCapability = new WikiLookupCapability(
			this.vault,
			this.projectBoundaryService,
			this.wikiKnowledgeProvider,
		);
		this.memoryPersistCapability = new MemoryPersistCapability(this.fileMemoryStore, this.projectBoundaryService);
		this.gitConflictCapability = new GitConflictCapability(
			this.vault,
			() => this.projectBoundaryService.getActiveProject(),
		);
	}

	async runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const turnId = this.createTurnId();
		const depth = input.depth ?? 0;
		const mode = this.getSettings().agentRuntime.toolCallingMode ?? "auto";
		this.lastContextSummary = null;
		this.activeTurnId = turnId;
		this.activeTurnStateMachine = new TurnStateMachine(turnId);
		this.activeRuntimeProfile = detectRuntimeProfile();
		this.reportProgress(input, {
			phase: "start",
			depth,
			message: `Runtime started (mode=${mode}, depth=${depth}, profile=${this.activeRuntimeProfile.id})`,
		});
		const gateDecision = this.executionGate.evaluate(this.buildRuntimeTurnInvocation(input), this.activeRuntimeProfile);
		if (!gateDecision.allow) {
			this.reportProgress(input, {
				phase: "error",
				depth,
				message: `Runtime blocked: ${gateDecision.reason}`,
			});
			return this.finalizeTurnResult(
				turnId,
				{
					assistantText: gateDecision.reason,
					traces: [],
					rawFinalReply: gateDecision.reason,
					parseError: gateDecision.reason,
				},
				input.userPrompt,
			);
		}

		try {
			if (mode === "prompt") {
				const result = await this.runTurnPrompt(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
			if (mode === "native") {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
			try {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return this.finalizeTurnResult(turnId, result, input.userPrompt);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				if (!this.toolGovernor.shouldFallbackToPrompt(message)) {
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
				return this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.reportProgress(input, {
				phase: "error",
				depth,
				message: `Runtime failed: ${this.truncateText(message, 220)}`,
			});
			throw error;
		} finally {
			this.activeTurnId = "";
			this.activeTurnStateMachine = null;
		}
	}

	async runBuiltinSkillCommand(input: BuiltinSkillRunInput): Promise<RuntimeTurnResult> {
		const turnId = this.createTurnId();
		this.lastContextSummary = null;
		this.activeTurnId = turnId;
		this.activeTurnStateMachine = new TurnStateMachine(turnId);
		this.activeRuntimeProfile = detectRuntimeProfile();

		const runId = this.toolGovernor.createRunId(`skill-${input.skillName}`, 1);
		const startedAt = new Date().toISOString();
		const traceBase: RuntimeToolTrace = {
			runId,
			step: 1,
			tool: `skill:${input.skillName}`,
			scope: "vault",
			targetPath: input.currentFilePath ?? "",
			approved: true,
			approvalReason: "Explicit skill invocation",
			persistedRule: false,
			viaRule: false,
			status: "ok",
			ok: true,
			summary: "",
		};

		this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, {
			phase: "start",
			depth: 0,
			step: 1,
			tool: `skill:${input.skillName}`,
			message: `Running builtin skill ${input.skillName}`,
		});
		const gateDecision = this.executionGate.evaluate(this.buildBuiltinSkillInvocation(input), this.activeRuntimeProfile);
		if (!gateDecision.allow) {
			const trace: RuntimeToolTrace = {
				...traceBase,
				approved: false,
				approvalReason: gateDecision.reason,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: `Builtin skill blocked: ${input.skillName}`,
				error: gateDecision.reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, {
				phase: "error",
				depth: 0,
				step: 1,
				tool: `skill:${input.skillName}`,
				message: gateDecision.reason,
			});
			return this.finalizeTurnResult(
				turnId,
				{
					assistantText: gateDecision.reason,
					traces: [trace],
					rawFinalReply: gateDecision.reason,
					parseError: gateDecision.reason,
				},
				input.taskPrompt,
			);
		}

		try {
			let assistantText = "";
			let summary = `Builtin skill completed: ${input.skillName}`;
			if (input.skillName === "lookup-wiki") {
				const wikiKnowledgeContext = await this.wikiLookupCapability.execute(input.taskPrompt);
				assistantText = wikiKnowledgeContext
					? `Skill used: lookup-wiki\n\n${wikiKnowledgeContext}`
					: "Skill used: lookup-wiki\n\nNo related knowledge found.";
			} else if (input.skillName === "maintain-memory") {
				await this.memoryPersistCapability.persistSignals(input.taskPrompt, turnId);
				assistantText = `Skill used: maintain-memory\n\nMemory extraction attempted for turn ${turnId}.`;
			} else if (input.skillName === "resolve-conflict") {
				const conflictResult = await this.gitConflictCapability.generateProposal(input.taskPrompt);
				assistantText = conflictResult.markdown;
				summary = `Builtin skill completed: ${input.skillName} (${conflictResult.recommendedStrategy})`;
			} else if (input.skillName === "compile-wiki") {
				const compileSummary = await this.wikiCompileCapability.execute(undefined, true);
				assistantText = `Skill used: compile-wiki\n\nWiki compile requested=${compileSummary.requested}, processed=${compileSummary.processed}, succeeded=${compileSummary.succeeded}, failed=${compileSummary.failed}`;
			} else {
				throw new Error(`Unsupported builtin skill: ${input.skillName}`);
			}

			const trace: RuntimeToolTrace = {
				...traceBase,
				summary,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, {
				phase: "done",
				depth: 0,
				step: 1,
				tool: `skill:${input.skillName}`,
				message: `Builtin skill ${input.skillName} completed`,
			});
			return await this.finalizeTurnResult(
				turnId,
				{
					assistantText,
					traces: [trace],
					rawFinalReply: assistantText,
				},
				input.taskPrompt,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			const failureClass = this.toolGovernor.classifyFailure(message);
			const trace: RuntimeToolTrace = {
				...traceBase,
				status: "failed",
				failureClass,
				ok: false,
				summary: `Builtin skill failed: ${input.skillName}`,
				error: message,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, {
				phase: "error",
				depth: 0,
				step: 1,
				tool: `skill:${input.skillName}`,
				message,
			});
			return await this.finalizeTurnResult(
				turnId,
				{
					assistantText: message,
					traces: [trace],
					rawFinalReply: message,
					parseError: message,
				},
				input.taskPrompt,
			);
		} finally {
			this.activeTurnId = "";
			this.activeTurnStateMachine = null;
		}
	}

	private reportProgress(input: RuntimeTurnInput, event: RuntimeProgressEvent): void {
		if (this.activeTurnStateMachine) {
			this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, event);
		}
		try {
			input.onProgress?.(event);
		} catch {
			// Ignore observer errors to avoid blocking runtime execution.
		}
	}

	private buildRuntimeTurnInvocation(input: RuntimeTurnInput): ResolvedInvocation {
		const request: InvocationRequest = {
			source: input.depth && input.depth > 0 ? "service_call" : "chat_prompt",
			intentType: "runtime",
			prompt: input.userPrompt,
			projectSlug: this.projectBoundaryService.getActiveProject()?.slug,
			sessionId: this.activeTurnId,
		};
		return {
			request,
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		};
	}

	private buildBuiltinSkillInvocation(input: BuiltinSkillRunInput): ResolvedInvocation {
		const skillName = input.skillName.trim().toLowerCase();
		const request: InvocationRequest = {
			source: "service_call",
			intentType: "skill",
			targetId: skillName,
			prompt: input.taskPrompt,
			projectSlug: this.projectBoundaryService.getActiveProject()?.slug,
			sessionId: this.activeTurnId,
		};
		const requiredCapabilities: Record<string, string[]> = {
			"compile-wiki": ["compile_wiki"],
		};
		return {
			request,
			resolvedType: "skill",
			resolvedId: skillName,
			requiresRuntime: true,
			requiredCapabilities: requiredCapabilities[skillName] ?? [],
		};
	}

	private reportContextProgress(
		input: RuntimeTurnInput,
		depth: number,
		contextKey: NonNullable<RuntimeProgressEvent["contextKey"]>,
		message: string,
	): void {
		this.reportProgress(input, {
			phase: "context",
			depth,
			contextKey,
			message,
		});
	}

	private createTurnId(): string {
		const rand = Math.random().toString(16).slice(2, 8);
		return `turn-${Date.now()}-${rand}`;
	}

	private async finalizeTurnResult(
		turnId: string,
		result: RuntimeTurnResult,
		userPrompt: string,
	): Promise<RuntimeTurnResult> {
		const stepTraces = this.activeTurnStateMachine?.snapshot() ?? [];
		try {
			await this.stepTraceStore.appendMany(stepTraces);
		} catch {
			// Keep runtime response available even if trace persistence fails.
		}
		try {
			await this.memoryPersistCapability.persistSignals(userPrompt, turnId);
		} catch {
			// Memory persistence is best-effort and must not break the turn.
		}
		return {
			...result,
			turnId,
			stepTraces,
			runtimeProfile: this.activeRuntimeProfile,
			contextSummary: this.lastContextSummary ?? undefined,
		};
	}

	setSessionToolPolicyOverride(action: string, effect: PolicyEffect): void {
		this.sessionOverrideAdapter.setOverride(action, effect);
	}

	clearSessionToolPolicyOverride(action: string): void {
		this.sessionOverrideAdapter.clearOverride(action);
	}

	clearAllSessionToolPolicyOverrides(): void {
		this.sessionOverrideAdapter.clearAll();
	}

	listSessionToolPolicyOverrides(): Record<string, PolicyEffect> {
		return this.sessionOverrideAdapter.listOverrides();
	}

	getToolPolicyMatrix(tools: string[]): PolicyMatrixRow[] {
		return buildPolicyMatrix({
			tools,
			globalRules: this.buildGlobalPolicyRules(),
			projectRules: this.buildProjectPolicyRules(),
			sessionOverrides: this.sessionOverrideAdapter.listOverrides(),
		});
	}

	async acceptEditPlan(planId: string): Promise<void> {
		const record = this.workbenchStateStore.getEditPlans().find((item) => item.id === planId);
		if (!record) {
			throw new Error(`Edit plan not found: ${planId}`);
		}
		this.workbenchStateStore.replaceEditPlan({
			...record,
			items: record.items.map((item) => ({
				...item,
				status: item.status === "applied" ? "accepted" : item.status,
			})),
		});
	}

	async rejectEditPlan(planId: string): Promise<void> {
		await this.rollbackEditPlan(planId, "rejected");
	}

	async rollbackEditPlan(planId: string, nextStatus: "rejected" | "rolled_back" = "rolled_back"): Promise<void> {
		const record = this.workbenchStateStore.getEditPlans().find((item) => item.id === planId);
		if (!record) {
			throw new Error(`Edit plan not found: ${planId}`);
		}
		for (const item of [...record.items].reverse()) {
			if (item.status !== "applied" && item.status !== "accepted") {
				continue;
			}
			await this.rollbackEditPlanItem(item, record.agentId);
			item.status = nextStatus;
		}
		this.workbenchStateStore.replaceEditPlan(record);
	}

	private resolveToolPolicy(toolName: string): { effect: PolicyEffect; source: string } {
		const globalRules = this.buildGlobalPolicyRules();
		const projectRules = this.buildProjectPolicyRules();
		const resolver = new PolicyResolverCore({
			globalRules,
			projectRules,
			sessionOverrideAdapter: this.sessionOverrideAdapter,
		});
		const decision = resolver.resolve(`tool:${toolName}`);
		return {
			effect: decision.effectiveEffect,
			source: decision.source,
		};
	}

	private buildGlobalPolicyRules(): PolicyRule[] {
		const mode = this.getSettings().agentRuntime.toolPermissionMode;
		const disabledTools = this.buildDisabledToolSet();
		const readEffect: PolicyEffect = "allow";
		let writeEffect: PolicyEffect = "ask";
		let execEffect: PolicyEffect = "ask";
		if (mode === "auto") {
			writeEffect = "allow";
			execEffect = "allow";
		}
		if (mode === "strict") {
			writeEffect = "deny";
			execEffect = "deny";
		}
		const resolveEffect = (tool: string, fallback: PolicyEffect): PolicyEffect =>
			disabledTools.has(tool) ? "deny" : fallback;
		return [
			{ action: "tool:ls", effect: resolveEffect("ls", readEffect), source: "global" },
			{ action: "tool:read", effect: resolveEffect("read", readEffect), source: "global" },
			{ action: "tool:grep", effect: resolveEffect("grep", readEffect), source: "global" },
			{ action: "tool:search_text", effect: resolveEffect("search_text", readEffect), source: "global" },
			{ action: "tool:glob", effect: resolveEffect("glob", readEffect), source: "global" },
			{ action: "tool:compile_wiki", effect: resolveEffect("compile_wiki", writeEffect), source: "global" },
			{ action: "tool:write", effect: resolveEffect("write", writeEffect), source: "global" },
			{ action: "tool:edit", effect: resolveEffect("edit", writeEffect), source: "global" },
			{ action: "tool:delete", effect: resolveEffect("delete", writeEffect), source: "global" },
			{ action: "tool:exec", effect: resolveEffect("exec", execEffect), source: "global" },
			{ action: "tool:subagent", effect: resolveEffect("subagent", execEffect), source: "global" },
		];
	}

	private buildProjectPolicyRules(): PolicyRule[] {
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (!activeProject) {
			return [];
		}
		const settings = this.getSettings();
		const projectPolicySource = settings.agentRuntime.projectToolPolicyRules?.[activeProject.slug] ?? [];
		return projectPolicySource
			.filter((item) => item && typeof item.action === "string" && typeof item.effect === "string")
			.map((item) => ({
				action: item.action.trim(),
				effect: item.effect as PolicyEffect,
				source: "project" as const,
			}))
			.filter((item) => item.action.length > 0 && (item.effect === "allow" || item.effect === "ask" || item.effect === "deny"));
	}

	private async runTurnPrompt(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const settings = this.getSettings();
		const depth = input.depth ?? 0;
		const maxSteps = Math.max(1, settings.agentRuntime.maxToolIterations || 1);
		const allowedToolSet = this.buildAllowedToolSet(input.allowedTools);
		const traces: RuntimeToolTrace[] = [];
		const history = this.buildRuntimeHistory(input.conversation);
		const systemPrompt = await this.buildSystemPrompt(input, depth);
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
				const targetPath = this.resolveToolTargetPath(tool.name, tool.args ?? {});

				this.reportProgress(input, {
					phase: "tool_call",
					depth,
					step,
					tool: tool.name,
					targetPath,
					message: `Step ${step}: calling tool ${tool.name}`,
				});
				const executedResult = await this.executeTool(step, input, tool, allowedToolSet);
				traces.push(executedResult.trace);
				this.reportProgress(input, {
					phase: "tool_result",
					depth,
					step,
					tool: tool.name,
					targetPath: executedResult.trace.targetPath,
					status: executedResult.trace.status,
					summary: executedResult.trace.summary,
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
		const systemPrompt = await this.buildSystemPrompt(input, depth);
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
		let lastToolPayload: RuntimeToolResultPayload | null = null;
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
			const assistantStepText = response.assistantText?.trim() || "";
			if (assistantStepText) {
				finalReply = assistantStepText;
			}
			this.reportProgress(input, {
				phase: "model_response",
				depth,
				step,
				message: `Step ${step}: model response received`,
			});

			if (!response.toolCall) {
				const assistantPayload = assistantStepText;
				const fallbackAssistant = this.buildFallbackAssistantFromToolPayload(lastToolPayload);
				if (!assistantPayload || this.isIntermediateAssistantText(assistantPayload)) {
					return {
						assistantText: fallbackAssistant,
						traces,
						rawFinalReply: finalReply,
						parseError: "Native tool call completed without a user-facing final answer. Generated a fallback reply from tool results.",
					};
				}
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
					targetPath: this.resolveToolTargetPath(tool.name, tool.args ?? {}),
					message: `Step ${step}: calling tool ${tool.name} (JSON envelope fallback)`,
				});
				const toolResult = await this.executeTool(step, input, tool, allowedToolSet);
				traces.push(toolResult.trace);
				lastToolPayload = toolResult.payload;
				this.reportProgress(input, {
					phase: "tool_result",
					depth,
					step,
					tool: tool.name,
					targetPath: toolResult.trace.targetPath,
					status: toolResult.trace.status,
					summary: toolResult.trace.summary,
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
				targetPath: this.resolveToolTargetPath(response.toolCall.name, response.toolCall.args ?? {}),
				message: `Step ${step}: calling tool ${response.toolCall.name}`,
			});
			const toolResult = await this.executeTool(step, input, {
				name: response.toolCall.name,
				args: response.toolCall.args,
			}, allowedToolSet);
			traces.push(toolResult.trace);
			lastToolPayload = toolResult.payload;
			this.reportProgress(input, {
				phase: "tool_result",
				depth,
				step,
				tool: response.toolCall.name,
				targetPath: toolResult.trace.targetPath,
				status: toolResult.trace.status,
				summary: toolResult.trace.summary,
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
		input: RuntimeTurnInput,
		depth: number,
	): Promise<string> {
		const settings = this.getSettings();
		const agentId = input.agentId;
		const currentFilePath = input.currentFilePath;
		const extraSystemContext = input.extraSystemContext;
		const userPrompt = input.userPrompt;
		const focusPaths = settings.agentRuntime.vaultFocusPaths.length
			? settings.agentRuntime.vaultFocusPaths.map((item) => normalizePath(item)).join(", ")
			: "(entire Vault)";
		const externalPaths = settings.agentRuntime.externalReadOnlyPaths.length
			? settings.agentRuntime.externalReadOnlyPaths.join(", ")
			: "(none)";
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot() || "(none)";

		// --- Layer merge: FRIDAY.md (project) + agent.md (agent) ---
		this.reportContextProgress(input, depth, "instructions", "加载项目规则与 Agent 画像");
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
			'{"type":"tool_call","assistant":"optional note","tool":{"name":"ls|read|grep|search_text|glob|compile_wiki|write|edit|delete","args":{...}}}',
			'{"type":"subagent","assistant":"optional note","subagent":{"goal":"task goal","model":"optional"}}',
			"",
			"Rules:",
			"- Prefer tool evidence first; do not hallucinate filesystem facts.",
			"- Call at most one tool each step, then reason with TOOL_RESULT.",
			"- When an active project root is available, prefer scoping ls/grep/search_text/glob to that root.",
			"- For ls/grep/search_text/glob, an empty path auto-scopes to the active project root when one is selected.",
			"- Never use '/' or '\\' as the path for Vault discovery tools; use the active project root instead.",
			"- write/delete only supports Vault-relative paths.",
			"- When removing a Vault file or folder, use delete instead of exec or shell builtins like rmdir/rm.",
			"- raw/ is user-curated project input. Never write, edit, or delete files under <projectRoot>/raw/.",
			"- AI-generated drafts, process files, and interim outputs must go under <projectRoot>/workspace/.",
			"- When creating a new project file without an explicit folder, default to <projectRoot>/workspace/.",
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
			'- search_text: {"path":"optional directory or file path","query":"plain text query","maxMatches":40}',
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
			"User: read notes/project-overview.md",
			'Assistant: {"type":"tool_call","assistant":"Read file.","tool":{"name":"read","args":{"path":"notes/project-overview.md"}}}',
			"",
			'User: create test.md with content "hello"',
			'Assistant: {"type":"tool_call","assistant":"Create file in workspace.","tool":{"name":"write","args":{"path":"workspace/test.md","content":"hello","mode":"create"}}}',
			"--- End examples ---",
			"",
			`Runtime depth: ${depth}`,
			`Current active file: ${currentFilePath?.trim() || "(none)"}`,
			`Active project root: ${activeProjectRoot}`,
			`Vault focus paths: ${focusPaths}`,
			`External read-only paths: ${externalPaths}`,
			`Runtime profile: ${this.activeRuntimeProfile.id} (supported=${this.activeRuntimeProfile.supported})`,
			`Runtime capabilities: exec=${this.activeRuntimeProfile.capabilities.supportsExecTool}, externalRead=${this.activeRuntimeProfile.capabilities.supportsExternalRead}, subagent=${this.activeRuntimeProfile.capabilities.supportsSubagent}`,
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

		this.reportContextProgress(input, depth, "skills", "匹配相关技能与命令约束");
		const autoSkillContext = await this.buildAutoSkillContext(userPrompt, currentFilePath, trimmedExtra);
		if (autoSkillContext) {
			lines.push("");
			lines.push(autoSkillContext);
		}

		this.reportContextProgress(input, depth, "wiki", "检索项目知识与候选文档");
		const wikiKnowledgeContext = await this.wikiLookupCapability.execute(userPrompt ?? "");
		if (wikiKnowledgeContext) {
			lines.push("");
			lines.push("--- Wiki knowledge context ---");
			lines.push(wikiKnowledgeContext);
			lines.push("--- End wiki knowledge context ---");
		}

		this.reportContextProgress(input, depth, "memory", "加载长期记忆与项目偏好");
		const memoryContext = await this.loadMemoryContext();
		if (memoryContext) {
			lines.push("");
			lines.push("--- Memory context ---");
			lines.push(memoryContext);
			lines.push("--- End memory context ---");
		}

		this.reportContextProgress(input, depth, "compact", "压缩上下文并生成提示包");
		const assembledContext = this.contextAssembler.assemble({
			userQuery: userPrompt ?? "",
			system: fridayMd ?? "",
			policy: trimmedExtra ?? "",
			history: memoryContext,
			secondaryContext: autoSkillContext,
			attachments: wikiKnowledgeContext,
			hardLimit: 1600,
		});
		this.lastContextSummary = {
			used: assembledContext.used,
			softLimit: assembledContext.softLimit,
			hardLimit: assembledContext.hardLimit,
			trimmedChannels: [...assembledContext.trimmedChannels],
			hasWikiContext: Boolean(wikiKnowledgeContext),
			hasMemoryContext: Boolean(memoryContext),
			hasAutoSkillContext: Boolean(autoSkillContext),
		};
		if (assembledContext.text) {
			lines.push("");
			lines.push("--- Assembled context bundle ---");
			lines.push(assembledContext.text);
			lines.push(
				`Context budget: used=${assembledContext.used}, soft=${assembledContext.softLimit}, hard=${assembledContext.hardLimit}, trimmed=${assembledContext.trimmedChannels.join(",") || "none"}`,
			);
			lines.push("--- End assembled context bundle ---");
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

		const primarySkill = suggestions[0];
		if (!primarySkill) {
			return "";
		}
		const selectionReason = primarySkill.reasons.join("; ") || `score=${primarySkill.score}`;
		try {
			const skillContext = await this.skillCommandService.buildSkillSystemContext(primarySkill.skill.command, {
				invocationMode: "auto",
				selectionReason,
			});
			return skillContext.systemContext;
		} catch {
			return "";
		}
	}

	private async loadMemoryContext(): Promise<string> {
		const paths: string[] = ["F.R.I.D.A.Y/memory/global_user_memory.md"];
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		if (activeProjectRoot) {
			paths.push(`${activeProjectRoot}/memory/project_behavior_memory.md`);
		}

		const sections: string[] = [];
		for (const rawPath of paths) {
			const normalized = normalizePath(rawPath);
			const file = this.vault.getAbstractFileByPath(normalized);
			if (!(file instanceof TFile)) {
				continue;
			}
			const content = (await this.vault.cachedRead(file)).trim();
			if (!content) {
				continue;
			}
			sections.push(`[memory:${normalized}]`);
			sections.push(this.truncateText(content, 1200));
		}

		return sections.join("\n\n");
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
		const parsed = parseRuntimeEnvelopeText(raw, RUNTIME_CODE_FENCE);
		return parsed as RuntimeEnvelope | null;
	}

	private async executeSubagent(
		step: number,
		input: RuntimeTurnInput,
		subagent: RuntimeSubagentCall | undefined,
	): Promise<{ trace: RuntimeToolTrace; payload: RuntimeToolResultPayload }> {
		const startedAt = new Date().toISOString();
		const runId = this.toolGovernor.createRunId("subagent", step);
		const settings = this.getSettings();
		const depth = input.depth ?? 0;
		const goal = subagent?.goal?.trim() ?? "";
		if (!this.activeRuntimeProfile.capabilities.supportsSubagent) {
			const trace = this.traceFromError(
				step,
				"subagent",
				"vault",
				"",
				"Subagent is not supported on current runtime profile",
				runId,
				"dependency_unavailable",
			);
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: { ok: false, tool: "subagent", error: "subagent unsupported on runtime profile" },
			};
		}
		if (!goal) {
			const trace = this.traceFromError(step, "subagent", "vault", "", "子代理调用缺少 goal", runId, "invalid_input");
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: { ok: false, tool: "subagent", error: "missing goal" },
			};
		}

		if (!settings.agentRuntime.enableSubagent) {
			const trace = this.traceFromError(step, "subagent", "vault", "", "子代理功能未启用", runId, "dependency_unavailable");
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: { ok: false, tool: "subagent", error: "subagent disabled" },
			};
		}

		if (depth >= settings.agentRuntime.maxSubagentDepth) {
			const trace = this.traceFromError(step, "subagent", "vault", "", "Subagent depth limit reached", runId, "invalid_input");
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
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
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: "subagent",
				scope: "vault",
				targetPath: "",
				approved: false,
				approvalReason: approval.reason,
				persistedRule: approval.persisted,
				viaRule: approval.viaRule,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: "子代理执行被拒绝",
				error: approval.reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
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

		const trace: RuntimeToolTrace = {
			runId,
			step,
			tool: "subagent",
			scope: "vault",
			targetPath: "",
			approved: true,
			approvalReason: approval.reason,
			persistedRule: approval.persisted,
			viaRule: approval.viaRule,
			status: "ok",
			ok: true,
			summary: `子代理完成：${this.truncateText(result.assistantText, 120)}`,
		};
		await this.persistToolRun(trace, startedAt, new Date().toISOString());
		return {
			trace,
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
		const startedAt = new Date().toISOString();
		const depth = input.depth ?? 0;
		const agentId = input.agentId;
		const name = tool.name.trim().toLowerCase();
		const args = this.normalizeToolArgs(name, tool.args ?? {});
		const runId = this.toolGovernor.createRunId(name, step);
		const targetPath = this.resolveToolTargetPath(name, args);
		const scope = this.resolveScope(targetPath);
		const shouldReportApproval = !["ls", "read", "grep", "search_text", "glob"].includes(name);
		if (scope === "external" && !this.activeRuntimeProfile.capabilities.supportsExternalRead) {
			const reason = `Runtime profile ${this.activeRuntimeProfile.id} does not allow external read operations.`;
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: false,
				approvalReason: reason,
				persistedRule: false,
				viaRule: false,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: `${name} blocked by runtime capability`,
				error: reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: {
					ok: false,
					tool: name,
					error: reason,
				},
			};
		}
		if (allowedTools && allowedTools.size > 0 && !allowedTools.has(name)) {
			const reason = `Tool ${name} is not allowed by the current command policy.`;
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: false,
				approvalReason: reason,
				persistedRule: false,
				viaRule: false,
				status: "denied",
				failureClass: "invalid_input",
				ok: false,
				summary: `${name} 已被命令策略拦截`,
				error: reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: {
					ok: false,
					tool: name,
					error: reason,
				},
			};
		}

		const policy = this.resolveToolPolicy(name);
		if (policy.effect === "deny") {
			const reason = `Policy denied tool:${name} (source=${policy.source})`;
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: false,
				approvalReason: reason,
				persistedRule: false,
				viaRule: false,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: `${name} blocked by policy`,
				error: reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
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

		const approval = policy.effect === "allow"
			? {
				allowed: true,
				persisted: false,
				viaRule: false,
				reason: `Policy allow (source=${policy.source})`,
			}
			: await this.approvalService.requestApproval({
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
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: false,
				approvalReason: approval.reason,
				persistedRule: approval.persisted,
				viaRule: approval.viaRule,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: `${name} blocked`,
				error: approval.reason,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
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
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: true,
				approvalReason: approval.reason,
				persistedRule: approval.persisted,
				viaRule: approval.viaRule,
				status: "ok",
				ok: true,
				summary: this.buildSummaryFromData(name, data),
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			const failureClass = this.toolGovernor.classifyFailure(message);
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: true,
				approvalReason: approval.reason,
				persistedRule: approval.persisted,
				viaRule: approval.viaRule,
				status: "failed",
				failureClass,
				ok: false,
				summary: `${name} failed`,
				error: message || "Unknown error",
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: {
					ok: false,
					tool: name,
					error: message || "unknown tool execution error",
				},
			};
		}
	}

	private async runToolByName(name: string, args: Record<string, unknown>, agentId: string): Promise<unknown> {
		const manifest = findToolManifest(name);
		if (!manifest) {
			throw new Error(`Unsupported tool: ${name}`);
		}

		const resolver = new CapabilityResolver({
			ls: async (payload) => this.toolList(payload),
			read: async (payload) => this.toolRead(payload),
			grep: async (payload) => this.toolGrep(payload),
			search_text: async (payload) => this.toolSearchText(payload),
			glob: async (payload) => this.toolGlob(payload),
			compile_wiki: async (payload) => this.toolCompileWiki(payload),
			write: async (payload) => this.toolWrite(payload, agentId),
			edit: async (payload) => this.toolEdit(payload, agentId),
			delete: async (payload) => this.toolDelete(payload, agentId),
			exec: async (payload) => this.toolExec(payload),
		});

		const handler = resolver.resolve(manifest.name);
		if (!handler) {
			throw new Error(`No capability handler bound for tool: ${manifest.name}`);
		}
		return handler(args, agentId);
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

		const targetPath = this.resolveDefaultVaultSearchPath(rawPath);
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
			const targetPath = this.resolveDefaultVaultSearchPath(rawPath);
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

	private async toolSearchText(args: Record<string, unknown>): Promise<unknown> {
		const query = this.getRequiredStringArg(args, "query");
		return this.toolGrep({
			path: this.getStringArg(args, "path"),
			pattern: this.escapeRegExp(query),
			flags: "i",
			maxMatches: this.getPositiveIntArg(args, "maxMatches", DEFAULT_MAX_GREP_MATCHES),
		});
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
			const targetPath = this.resolveDefaultVaultSearchPath(rawPath);
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
			return this.wikiCompileCapability.execute(undefined, true);
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
		return this.wikiCompileCapability.execute(normalized.length > 0 ? normalized : undefined, false);
	}

	private async toolWrite(args: Record<string, unknown>, agentId: string): Promise<unknown> {
		const pathValue = this.getRequiredStringArg(args, "path");
		if (this.resolveScope(pathValue) === "external") {
			throw new Error("write only supports Vault-relative paths.");
		}
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		const normalizedPath = activeProjectRoot
			? resolveAgentWritableVaultPath(activeProjectRoot, pathValue)
			: normalizePath(pathValue);
		const resolvedExistingPath = this.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.assertAgentWritableVaultPath(effectivePath);
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
		const editPlanId = this.recordEditPlan({
			agentId,
			tool: "write",
			path: effectivePath,
			before: beforeContent,
			after: afterContent,
			changeType: actionType === "create" ? "create" : "update",
		});
		return {
			editPlanId,
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
		this.assertAgentWritableVaultPath(effectivePath);
		const beforeTarget = this.vault.getAbstractFileByPath(effectivePath);
		if (!(beforeTarget instanceof TFile) && !(beforeTarget instanceof TFolder)) {
			throw new Error(`Vault path does not exist: ${effectivePath}`);
		}
		const deletedType = beforeTarget instanceof TFolder ? "folder" : "file";
		const beforeContent = beforeTarget instanceof TFile ? await this.vault.cachedRead(beforeTarget) : "";
		const action: AgentAction = {
			type: "delete",
			targetType: deletedType === "folder"
				? "folder"
				: effectivePath.toLowerCase().endsWith(".canvas")
					? "canvas"
					: "markdown",
			path: effectivePath,
		};
		await this.actionService.execute(action, agentId);
		const editPlanId = deletedType === "folder"
			? undefined
			: this.recordEditPlan({
				agentId,
				tool: "delete",
				path: effectivePath,
				before: beforeContent,
				after: "",
				changeType: "delete",
			});
		return {
			editPlanId,
			path: effectivePath,
			type: "delete",
			deletedType,
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
		this.assertAgentWritableVaultPath(effectivePath);
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
		const editPlanId = this.recordEditPlan({
			agentId,
			tool: "edit",
			path: effectivePath,
			before: beforeContent,
			after: editResult.result,
			changeType: "update",
		});
		return {
			editPlanId,
			path: effectivePath,
			appliedEdits: editResult.appliedCount,
			failedReasons: editResult.failedReasons,
			diffPreview: this.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private recordEditPlan(input: {
		agentId: string;
		tool: string;
		path: string;
		before: string;
		after: string;
		changeType: "create" | "update" | "delete";
	}): string {
		const record: EditPlanRecord = {
			id: `edit-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
			agentId: input.agentId,
			tool: input.tool,
			recordedAt: new Date().toISOString(),
			items: [
				{
					path: input.path,
					before: input.before,
					after: input.after,
					status: "applied",
					changeType: input.changeType,
				},
			],
		};
		this.workbenchStateStore.recordEditPlan(record);
		return record.id;
	}

	private async rollbackEditPlanItem(
		item: EditPlanRecord["items"][number],
		agentId: string,
	): Promise<void> {
		if (item.changeType === "create") {
			const existing = this.vault.getAbstractFileByPath(item.path);
			if (existing instanceof TFile) {
				await this.actionService.execute({
					type: "delete",
					targetType: item.path.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
					path: item.path,
				}, agentId);
			}
			return;
		}

		if (item.changeType === "delete") {
			await this.ensureVaultFolder(item.path.split("/").slice(0, -1).join("/"));
			const existing = this.vault.getAbstractFileByPath(item.path);
			await this.actionService.execute({
				type: existing instanceof TFile ? "update" : "create",
				targetType: item.path.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
				path: item.path,
				content: item.before,
			}, agentId);
			return;
		}

		await this.ensureVaultFolder(item.path.split("/").slice(0, -1).join("/"));
		const existing = this.vault.getAbstractFileByPath(item.path);
		await this.actionService.execute({
			type: existing instanceof TFile ? "update" : "create",
			targetType: item.path.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
			path: item.path,
			content: item.before,
		}, agentId);
	}

	private async ensureVaultFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath || "");
		if (!normalized) {
			return;
		}
		const segments = normalized.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) {
				continue;
			}
			if (!existing) {
				await this.vault.createFolder(current);
			}
		}
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
		if (!this.activeRuntimeProfile.capabilities.supportsExecTool) {
			throw new Error(`exec tool is not supported on runtime profile: ${this.activeRuntimeProfile.id}`);
		}
		if (!settings.agentRuntime.enableExecTool) {
			throw new Error("exec tool is disabled. Enable it in settings first.");
		}
		const command = this.getRequiredStringArg(args, "command");
		const rawArgs = args["args"];
		const cmdArgs = Array.isArray(rawArgs)
			? rawArgs.map((item) => String(item))
			: [];
		const redirectedDelete = await this.tryExecuteVaultDeleteBuiltin(command, cmdArgs);
		if (redirectedDelete) {
			return redirectedDelete;
		}
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

	private async tryExecuteVaultDeleteBuiltin(command: string, args: string[]): Promise<ExecVaultDeleteRedirect | null> {
		const normalizedCommand = command.trim().toLowerCase();
		if (!["rmdir", "rd", "rm", "del", "erase"].includes(normalizedCommand)) {
			return null;
		}
		const targetArg = args.find((item) => {
			const normalized = item.trim();
			return normalized.length > 0 && !normalized.startsWith("/") && !normalized.startsWith("-");
		});
		if (!targetArg) {
			return null;
		}
		const normalizedTarget = normalizePath(targetArg.replace(/\\/g, "/"));
		if (!normalizedTarget || path.isAbsolute(normalizedTarget)) {
			return null;
		}
		const existing = this.vault.getAbstractFileByPath(normalizedTarget);
		if (!(existing instanceof TFile) && !(existing instanceof TFolder)) {
			return null;
		}
		const activeAgentId = this.getSettings().activeAgentId;
		if (!activeAgentId) {
			return null;
		}
		await this.toolDelete({ path: normalizedTarget }, activeAgentId);
		return {
			routedToDelete: true,
			path: normalizedTarget,
			deletedType: existing instanceof TFolder ? "folder" : "file",
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

	private assertAgentWritableVaultPath(targetPath: string): void {
		this.assertVaultWritePath(targetPath);
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		if (!activeProjectRoot) {
			return;
		}
		if (isAgentWritableProjectPath(activeProjectRoot, targetPath)) {
			return;
		}
		if (isProjectRawPath(activeProjectRoot, targetPath)) {
			throw new Error(this.buildRawBoundaryDeniedError(targetPath, activeProjectRoot));
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

	private buildRawBoundaryDeniedError(targetPath: string, projectRoot: string): string {
		const normalizedPath = normalizePath(targetPath || "");
		return `AI-generated file operations are blocked under raw/: ${normalizedPath} (projectRoot=${projectRoot}). Use ${projectRoot}/workspace/ instead.`;
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
			search_text: ["path"],
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
		if (name === "ls" || name === "grep" || name === "search_text" || name === "glob") {
			return this.resolveDefaultVaultSearchPath("");
		}
		return "";
	}

	private resolveDefaultVaultSearchPath(rawPath: string | undefined): string {
		const normalized = normalizePath(rawPath || "");
		if (normalized) {
			return normalized;
		}
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		return activeProjectRoot ? normalizePath(activeProjectRoot) : "";
	}

	private normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
		if (!PROJECT_SCOPED_DISCOVERY_TOOLS.has(name)) {
			return args;
		}
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		if (!activeProjectRoot) {
			return args;
		}
		const rawPath = this.getStringArg(args, "path");
		if (!rawPath || rawPath === "/" || rawPath === "\\" || rawPath === ".") {
			return {
				...args,
				path: normalizePath(activeProjectRoot),
			};
		}
		return args;
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

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
		if (tool === "search_text") {
			const payload = data as { matches?: unknown[] };
			return `search_text matched ${payload.matches?.length ?? 0} result(s)`;
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
			const payload = data as { path?: string; deletedType?: string };
			const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
			return `Delete completed ${targetLabel} ${payload.path ?? ""}`.trim();
		}
		if (tool === "edit") {
			const payload = data as { path?: string; appliedEdits?: number };
			return `Edited ${payload.path ?? ""} (${payload.appliedEdits ?? 0} replacement(s))`.trim();
		}
		if (tool === "exec") {
			const payload = data as { exitCode?: number; timedOut?: boolean; routedToDelete?: boolean; path?: string; deletedType?: string };
			if (payload.routedToDelete) {
				const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
				return `Exec redirected to native delete (${targetLabel} ${payload.path ?? ""})`.trim();
			}
			const status = payload.timedOut ? "timed out" : `exit code ${payload.exitCode ?? "?"}`;
			return `Exec completed (${status})`;
		}
		return `${tool} completed`;
	}

	private isIntermediateAssistantText(text: string): boolean {
		const normalized = text.trim().toLowerCase();
		if (!normalized) {
			return true;
		}
		return normalized.startsWith("calling tool:") || normalized.includes("continuing with tool calls");
	}

	private buildFallbackAssistantFromToolPayload(payload: RuntimeToolResultPayload | null): string {
		if (!payload || !payload.ok) {
			return "";
		}
		if (payload.tool === "ls") {
			const data = payload.data as { path?: string; items?: string[] } | undefined;
			const items = Array.isArray(data?.items) ? data.items.filter((item) => typeof item === "string" && item.length > 0) : [];
			if (items.length === 0) {
				return "当前项目下没有检索到可见条目。";
			}
			const scopeLabel = data?.path?.trim() || "当前项目";
			const preview = items.slice(0, 8).map((item) => `- ${item}`).join("\n");
			const more = items.length > 8 ? `\n- 其余 ${items.length - 8} 项已省略` : "";
			return `当前范围 ${scopeLabel} 下可见 ${items.length} 项：\n${preview}${more}`;
		}
		if (payload.tool === "glob") {
			const data = payload.data as { files?: string[] } | undefined;
			const files = Array.isArray(data?.files) ? data.files.filter((item) => typeof item === "string" && item.length > 0) : [];
			if (files.length === 0) {
				return "没有匹配到相关文件。";
			}
			return `已匹配到 ${files.length} 个文件：\n${files.slice(0, 8).map((item) => `- ${item}`).join("\n")}`;
		}
		if (payload.tool === "search_text" || payload.tool === "grep") {
			const data = payload.data as { matches?: Array<{ path?: string; line?: number; text?: string }> } | undefined;
			const matches = Array.isArray(data?.matches) ? data.matches : [];
			if (matches.length === 0) {
				return "没有检索到相关文本。";
			}
			return `已检索到 ${matches.length} 条相关结果，请继续缩小范围或指定文件。`;
		}
		if (payload.tool === "read") {
			const data = payload.data as { path?: string; content?: string } | undefined;
			if (!data?.path) {
				return "";
			}
			const content = typeof data.content === "string" ? this.truncateText(data.content.trim(), 320) : "";
			if (!content) {
				return `已读取 ${data.path}，但文件内容为空。`;
			}
			return `已读取 ${data.path}，摘录如下：\n${content}`;
		}
		return "";
	}

	private traceFromError(
		step: number,
		tool: string,
		scope: ToolApprovalScope,
		targetPath: string,
		error: string,
		runId: string,
		failureClass: ToolFailureClass = "tool_runtime_error",
	): RuntimeToolTrace {
		return {
			runId,
			step,
			tool,
			scope,
			targetPath,
			approved: true,
			approvalReason: "No approval required",
			persistedRule: false,
			viaRule: false,
			status: "failed",
			failureClass,
			ok: false,
			summary: `${tool} failed`,
			error,
		};
	}

	private async persistToolRun(trace: RuntimeToolTrace, startedAt: string, endedAt: string): Promise<void> {
		if (!this.activeTurnId) {
			return;
		}
		try {
			await this.toolRunAuditStore.append({
				turnId: this.activeTurnId,
				runId: trace.runId,
				step: trace.step,
				tool: trace.tool,
				status: trace.status,
				failureClass: trace.failureClass,
				scope: trace.scope,
				targetPath: trace.targetPath,
				summary: trace.summary,
				error: trace.error,
				startedAt,
				endedAt,
			});
		} catch {
			// Tool execution result should not fail only because audit persistence fails.
		}
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
		const disabledTools = this.buildDisabledToolSet();
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
				name: "search_text",
				description: "Search plain text keywords in files.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						query: { type: "string" },
						maxMatches: { type: "number", default: 40 },
					},
					required: ["query"],
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
				description: "Delete a Vault file or folder.",
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
		const enabledTools = tools.filter((tool) => !disabledTools.has(tool.name));

		if (!allowedTools || allowedTools.size === 0) {
			return enabledTools;
		}
		return enabledTools.filter((tool) => allowedTools.has(tool.name));
	}

	private buildDisabledToolSet(): Set<string> {
		return new Set(
			(this.getSettings().agentRuntime.disabledTools ?? [])
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.length > 0),
		);
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

