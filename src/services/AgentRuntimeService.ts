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
import { AgentLoopController } from "../core/agent-kernel/AgentLoopController";
import { createObsidianAgentLoopController } from "./ObsidianKernelRuntimePorts";
import { AgentActionType } from "../types/action";
import { FridaySettings } from "../types/settings";
import { AgentActionService } from "./AgentActionService";
import { WorkspaceAccessService } from "./WorkspaceAccessService";
import { ToolApprovalScope, ToolApprovalService } from "./ToolApprovalService";
import { CommandExecService } from "./CommandExecService";
import { InlineEditService, EditOperation } from "./InlineEditService";
import { ToolDefinition } from "../types/tools";
import { SkillCommandService } from "./SkillCommandService";
import { ProjectBoundaryService } from "./ProjectBoundaryService";
import { EditPlanRecord, WorkbenchStateStore } from "../features/workbench/WorkbenchStateStore";
import { TurnOrchestrator } from "../core/orchestrator/TurnOrchestrator";
import { SessionOverrideAdapter } from "../core/session-control/SessionOverrideAdapter";
import { PolicyResolverCore } from "../core/security/policy-resolver/PolicyResolverCore";
import { buildPolicyMatrix, PolicyMatrixRow } from "../core/security/policy-resolver/PolicyMatrix";
import { PolicyEffect, PolicyRule } from "../core/security/policy-resolver/types";
import { HistoryCompactor } from "../core/context/HistoryCompactor";
import { ToolBoundaryFilter } from "../core/context/ToolBoundaryFilter";
import { PromptContextEngine, type PromptMentionContext } from "../core/context/PromptContextEngine";
import { MemoryStoreV1 } from "../core/memory/MemoryStoreV1";
import type { MemoryWriteInput } from "../core/memory/MemoryTypes";
import { WikiKnowledgeProvider } from "../core/retrieval/WikiKnowledgeProvider";
import { parseRuntimeEnvelopeText } from "../core/orchestrator/RuntimeEnvelopeParser";
import { CapabilityPolicy } from "../core/policy/CapabilityPolicy";
import { ToolGateway } from "../core/tools/ToolGateway";
import {
	buildNativeToolDefinitionsFromRegistry,
	type AgentMode,
} from "../core/tools/ToolRegistry";
import { TurnEventLog, type TurnEventInput } from "../core/runtime/TurnEventLog";
import {
	createMutationPlan,
	hashMutationContent,
	setMutationPlanStatus,
	type MutationApplyStatus,
	MutationPlan,
	MutationPlanStatus,
	type MutationChangeType,
	type MutationOperation,
} from "../core/mutations/MutationPlan";
import { MutationApplier } from "../core/mutations/MutationApplier";
import { MutationPlanStore } from "../core/mutations/MutationPlanStore";
import type { AgentTask, AgentTaskRunInputSnapshot } from "../core/tasks/AgentTask";
import { AgentTaskStore } from "../core/tasks/AgentTaskStore";
import { CapabilityResolver } from "../core/tool-governor/CapabilityResolver";
import { ToolFailureClass, ToolGovernor } from "../core/tool-governor/ToolGovernor";
import { StepTraceEvent, TurnStateMachine } from "../core/turn-state/TurnStateMachine";
import { ExecutionGate } from "../core/execution/ExecutionGate";
import type { InvocationRequest } from "../core/execution/InvocationRequest";
import type { ResolvedInvocation } from "../core/execution/ResolvedInvocation";
import { GitConflictCapability } from "../platform/capability/GitConflictCapability";
import { WikiCompileCapability } from "../platform/capability/WikiCompileCapability";
import { WikiLookupCapability } from "../platform/capability/WikiLookupCapability";
import { WIKI_FEATURE_ENABLED, WIKI_SKILL_COMMANDS } from "../constants/wikiFeature";
import { detectRuntimeProfile, RuntimeProfile } from "../platform/runtime/RuntimeProfile";
import { StepTraceStore } from "../platform/tools/StepTraceStore";
import { findToolManifest } from "../platform/tools/ToolManifestCatalog";
import { ToolRunAuditStore } from "../platform/tools/ToolRunAuditStore";
import { SoulStore } from "./SoulStore";
import { RuntimeStateStore } from "./RuntimeStateStore";
import {
	isAgentWritableProjectPath,
	isProjectRawPath,
	resolveAgentWritableVaultPath,
} from "../utils/projectWorkspacePolicy";

interface RuntimeToolCall {
	name: string;
	args?: Record<string, unknown>;
}

export interface RuntimeMutationPlan {
	id?: string;
	operation?: string;
	targetPath?: string;
	summary?: string;
	status?: string;
	source?: string;
}

interface RuntimeEnvelope {
	type?: string;
	assistant?: string;
	tool?: RuntimeToolCall;
	mutations?: RuntimeMutationPlan[];
	pendingMutations?: RuntimeMutationPlan[];
}

interface RuntimeToolResultPayload {
	ok: boolean;
	tool: string;
	data?: unknown;
	error?: string;
}

type RuntimeFailureClass = ToolFailureClass | "cancelled";

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
	pendingMutations?: RuntimeMutationPlan[];
	turnId?: string;
	stepTraces?: StepTraceEvent[];
	runtimeProfile?: RuntimeProfile;
	contextSummary?: RuntimeContextSummary;
	task?: AgentTask;
	parseError?: string;
}

export interface RuntimeContextSummary {
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	overflowChannels?: string[];
	hasWikiContext: boolean;
	hasMemoryContext: boolean;
	hasAutoSkillContext: boolean;
	hasMentionContext: boolean;
	mentionResolvedCount: number;
	mentionTokenTypes: string[];
	mentionSourceMap: Array<{
		tokenId: string;
		tokenType: string;
		channel: string;
		target: string;
		zone?: string;
		dynamic?: boolean;
	}>;
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
	taskId?: string;
	message: string;
}

export interface RuntimeWikiCompileSummary {
	projectId: string;
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

export interface RuntimeTurnInput {
	turnId?: string;
	conversationId?: string;
	agentId: string;
	conversation: ChatMessage[];
	userPrompt: string;
	modelOverride?: string;
	depth?: number;
	currentFilePath?: string;
	extraSystemContext?: string;
	mentionContext?: PromptMentionContext;
	allowedTools?: string[];
	agentMode?: AgentMode;
	onProgress?: (event: RuntimeProgressEvent) => void;
	signal?: AbortSignal;
	retryOfTaskId?: string;
	continueFromTaskId?: string;
}

interface RuntimeTaskResumeOptions {
	userPrompt?: string;
	onProgress?: (event: RuntimeProgressEvent) => void;
	signal?: AbortSignal;
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
	private readonly turnEventLog: TurnEventLog;
	private readonly historyCompactor: HistoryCompactor;
	private readonly toolBoundaryFilter: ToolBoundaryFilter;
	private readonly promptContextEngine: PromptContextEngine;
	private readonly memoryStore: MemoryStoreV1;
	private readonly wikiKnowledgeProvider: WikiKnowledgeProvider;
	private readonly executionGate: ExecutionGate;
	private readonly wikiCompileCapability: WikiCompileCapability;
	private readonly wikiLookupCapability: WikiLookupCapability;
	private readonly gitConflictCapability: GitConflictCapability;
	private readonly capabilityPolicy: CapabilityPolicy;
	private readonly toolGateway: ToolGateway;
	private readonly mutationApplier: MutationApplier;
	private readonly mutationPlanStore: MutationPlanStore;
	private readonly agentTaskStore: AgentTaskStore;
	private activeTurnId = "";
	private activeConversationId = "default";
	private activeTaskId: string | undefined;
	private activeTaskAbortController: AbortController | undefined;
	private readonly taskAbortControllers = new Map<string, AbortController>();
	private activeTurnSideEvents: TurnEventInput[] = [];
	private activeTurnStateMachine: TurnStateMachine | null = null;
	private activeRuntimeProfile: RuntimeProfile = detectRuntimeProfile();
	private activeAgentMode: AgentMode = "ask";
	private lastContextSummary: RuntimeContextSummary | null = null;

	constructor(
		private readonly vault: Vault,
		private readonly aiService: AIService,
		private readonly soulStore: SoulStore,
		private readonly runtimeStateStore: RuntimeStateStore,
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
		const runtimeRoot = this.runtimeStateStore.getRuntimeRoot();
		this.toolRunAuditStore = new ToolRunAuditStore(runtimeRoot);
		this.stepTraceStore = new StepTraceStore(runtimeRoot);
		this.turnEventLog = new TurnEventLog({
			resolveTurnPath: ({ conversationId, turnId }) =>
				this.runtimeStateStore.getTurnEventLogPath(conversationId, turnId),
		});
		this.historyCompactor = new HistoryCompactor();
		this.toolBoundaryFilter = new ToolBoundaryFilter();
		this.promptContextEngine = new PromptContextEngine();
		this.memoryStore = new MemoryStoreV1({ vault: this.vault });
		this.wikiKnowledgeProvider = new WikiKnowledgeProvider();
		this.executionGate = new ExecutionGate(this.getSettings);
		this.capabilityPolicy = new CapabilityPolicy();
		this.toolGateway = new ToolGateway(this.capabilityPolicy);
		this.mutationPlanStore = new MutationPlanStore({
			storePath: () => this.runtimeStateStore.getMutationPlanStorePath(),
		});
		this.agentTaskStore = new AgentTaskStore({
			storePath: () => this.runtimeStateStore.getAgentTaskStorePath(),
		});
		this.mutationApplier = new MutationApplier(
			{
				read: async (targetPath) => this.readVaultFileContentOrNull(targetPath),
				write: async (targetPath, content, plan) => this.applyVaultWrite(targetPath, content, plan.agentId),
				delete: async (targetPath, plan) => this.applyVaultDelete(targetPath, plan.agentId),
			},
			{
				validatePath: (targetPath) => this.validateMutationApplyPath(targetPath),
			},
		);
		this.wikiCompileCapability = new WikiCompileCapability(this.compileWikiForActiveProject);
		this.wikiLookupCapability = new WikiLookupCapability(
			this.vault,
			this.projectBoundaryService,
			this.wikiKnowledgeProvider,
		);
		this.gitConflictCapability = new GitConflictCapability(
			this.vault,
			() => this.projectBoundaryService.getActiveProject(),
		);
	}

	createAgentLoopController(): AgentLoopController {
		return createObsidianAgentLoopController(
			this as unknown as Parameters<typeof createObsidianAgentLoopController>[0],
		);
	}

	async runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		const turnId = input.turnId?.trim() || this.createTurnId();
		const conversationId = input.conversationId?.trim() || this.resolveConversationId(input.agentId);
		const depth = input.depth ?? 0;
		const mode = this.getSettings().agentRuntime.toolCallingMode ?? "auto";
		this.lastContextSummary = null;
		this.activeTurnId = turnId;
		this.activeConversationId = conversationId;
		this.activeTaskId = undefined;
		this.activeTaskAbortController = new AbortController();
		this.activeTurnSideEvents = [];
		this.activeTurnStateMachine = new TurnStateMachine(turnId);
		this.activeRuntimeProfile = detectRuntimeProfile();
		this.activeAgentMode = this.resolveAgentMode(input);
		const abortInputListener = () => this.activeTaskAbortController?.abort();
		if (input.signal?.aborted) {
			this.activeTaskAbortController.abort();
		} else {
			input.signal?.addEventListener("abort", abortInputListener, { once: true });
		}
		const activeTask = await this.startAgentTaskForTurn(input, turnId, conversationId);
		if (this.activeTaskAbortController) {
			this.taskAbortControllers.set(activeTask.id, this.activeTaskAbortController);
		}
		this.assertActiveTaskNotCancelled();
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
			return await this.finalizeTurnResult(
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
				return await this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
			if (mode === "native") {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return await this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
			try {
				const result = await this.runTurnNative(input);
				this.reportProgress(input, {
					phase: "done",
					depth,
					message: `Runtime finished (tool traces=${result.traces.length})`,
				});
				return await this.finalizeTurnResult(turnId, result, input.userPrompt);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error ?? "");
				if (this.toolGovernor.isRetryableTransportFailure(message)) {
					throw new Error(
						`模型服务或网关暂时不可用，已停止自动切换兼容模式，避免从当前步骤重新请求一次模型并产生额外消耗。${message}`,
					);
				}
				if (!this.toolGovernor.shouldFallbackToPrompt(message)) {
					throw error;
				}
				this.reportProgress(input, {
					phase: "fallback",
					depth,
					message: `Native tool calling incompatible, fallback to prompt mode (replays current step once): ${this.truncateText(message, 180)}`,
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
				return await this.finalizeTurnResult(turnId, result, input.userPrompt);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.reportProgress(input, {
				phase: "error",
				depth,
				message: `Runtime failed: ${this.truncateText(message, 220)}`,
			});
			await this.markActiveTaskFailure(message);
			await this.persistTurnEvents(
				turnId,
				conversationId,
				this.activeTurnStateMachine?.snapshot() ?? [],
				{ failureMessage: message, taskId: this.activeTaskId },
			);
			throw error;
		} finally {
			this.activeTurnId = "";
			this.activeConversationId = "default";
			if (this.activeTaskId) {
				this.taskAbortControllers.delete(this.activeTaskId);
			}
			input.signal?.removeEventListener("abort", abortInputListener);
			this.activeTaskId = undefined;
			this.activeTaskAbortController = undefined;
			this.activeTurnSideEvents = [];
			this.activeTurnStateMachine = null;
			this.activeAgentMode = "ask";
		}
	}

	async runBuiltinSkillCommand(input: BuiltinSkillRunInput): Promise<RuntimeTurnResult> {
		const turnId = this.createTurnId();
		const conversationId = this.resolveConversationId(input.agentId);
		const normalizedSkillName = input.skillName.trim().toLowerCase();
		this.lastContextSummary = null;
		this.activeTurnId = turnId;
		this.activeConversationId = conversationId;
		this.activeTaskId = undefined;
		this.activeTurnSideEvents = [];
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

		if (!WIKI_FEATURE_ENABLED && WIKI_SKILL_COMMANDS.has(normalizedSkillName)) {
			const message = `Builtin skill is disabled: ${input.skillName}`;
			const trace: RuntimeToolTrace = {
				...traceBase,
				approved: false,
				approvalReason: message,
				status: "denied",
				failureClass: "dependency_unavailable",
				ok: false,
				summary: message,
				error: message,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
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
		}

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
			return await this.finalizeTurnResult(
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
			if (input.skillName === "resolve-conflict") {
				const conflictResult = await this.gitConflictCapability.generateProposal(input.taskPrompt);
				assistantText = conflictResult.markdown;
				summary = `Builtin skill completed: ${input.skillName} (${conflictResult.recommendedStrategy})`;
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
			this.activeConversationId = "default";
			this.activeTaskId = undefined;
			this.activeTurnSideEvents = [];
			this.activeTurnStateMachine = null;
		}
	}

	private reportProgress(input: RuntimeTurnInput, event: RuntimeProgressEvent): void {
		const eventWithTask = this.activeTaskId && !event.taskId
			? { ...event, taskId: this.activeTaskId }
			: event;
		if (this.activeTurnStateMachine) {
			this.turnOrchestrator.appendProgress(this.activeTurnStateMachine, eventWithTask);
		}
		try {
			input.onProgress?.(eventWithTask);
		} catch {
			// Ignore observer errors to avoid blocking runtime execution.
		}
	}

	private async startAgentTaskForTurn(
		input: RuntimeTurnInput,
		turnId: string,
		conversationId: string,
	): Promise<AgentTask> {
		const task = await this.agentTaskStore.create({
			agentId: input.agentId,
			conversationId,
			turnId,
			mode: input.agentMode ?? "ask",
			title: input.userPrompt,
			summary: "Task created.",
			retryOfTaskId: input.retryOfTaskId,
			continueFromTaskId: input.continueFromTaskId,
			runInput: this.createTaskRunInputSnapshot(input),
		});
		this.activeTaskId = task.id;
		await this.recordTaskLifecycleEvent(task);
		const runningTask = await this.agentTaskStore.markRunning(task.id, {
			summary: `Runtime started for ${input.agentMode ?? "ask"} mode.`,
		});
		await this.recordTaskLifecycleEvent(runningTask);
		return runningTask;
	}

	private async finalizeActiveTask(result: RuntimeTurnResult): Promise<AgentTask | undefined> {
		if (!this.activeTaskId) {
			return undefined;
		}
		const currentTask = await this.agentTaskStore.get(this.activeTaskId);
		if (
			currentTask?.status === "failed" ||
			currentTask?.status === "cancelled" ||
			currentTask?.status === "completed"
		) {
			return currentTask;
		}
		const pendingPlans = this.getPendingMutationRecordsForActiveTurn();
		const pendingMutationCount = pendingPlans.reduce(
			(total, plan) => total + plan.items.filter((item) => item.status === "pending").length,
			0,
		);
		if (pendingMutationCount > 0) {
			const firstPlan = pendingPlans[0];
			const firstItem = firstPlan?.items[0];
			const task = await this.agentTaskStore.markWaitingForApproval(this.activeTaskId, {
				summary: `Waiting for review of ${pendingMutationCount} pending file change(s).`,
				waitingForApproval: {
					kind: "mutation",
					tool: firstPlan?.tool ?? "mutation",
					targetPath: firstItem?.path ?? "",
					summary: firstItem?.summary ?? "Review pending file changes.",
					mutationPlanIds: pendingPlans.map((plan) => plan.id),
				},
				pendingMutationCount,
				changedFileCount: pendingMutationCount,
			});
			await this.recordTaskLifecycleEvent(task);
			return task;
		}
		if (result.parseError && result.assistantText === result.parseError) {
			const task = await this.agentTaskStore.markFailed(this.activeTaskId, {
				summary: this.truncateText(result.parseError, 240),
				failureReason: result.parseError,
			});
			await this.recordTaskLifecycleEvent(task);
			return task;
		}
		if (this.isMaxToolIterationStop(result.assistantText)) {
			const task = await this.agentTaskStore.markFailed(this.activeTaskId, {
				summary: "Runtime stopped at the maximum tool iteration limit.",
				failureReason: result.assistantText,
			});
			await this.recordTaskLifecycleEvent(task);
			return task;
		}
		const task = await this.agentTaskStore.markCompleted(this.activeTaskId, {
			summary: "Final answer delivered.",
		});
		await this.recordTaskLifecycleEvent(task);
		return task;
	}

	private async markActiveTaskFailure(message: string): Promise<void> {
		if (!this.activeTaskId) {
			return;
		}
		if (this.isCancellationFailure(message)) {
			const current = await this.agentTaskStore.get(this.activeTaskId);
			if (current?.status === "cancelled") {
				return;
			}
			const task = await this.agentTaskStore.cancelTask(this.activeTaskId, {
				summary: this.truncateText(message, 240),
				failureReason: message,
			});
			await this.recordTaskLifecycleEvent(task);
			return;
		}
		const task = await this.agentTaskStore.markFailed(this.activeTaskId, {
			summary: this.truncateText(message, 240),
			failureReason: message,
		});
		await this.recordTaskLifecycleEvent(task);
	}

	private async markActiveTaskWaitingForToolApproval(
		tool: string,
		targetPath: string,
	): Promise<void> {
		if (!this.activeTaskId) {
			return;
		}
		const current = await this.agentTaskStore.get(this.activeTaskId);
		if (current?.status !== "running") {
			return;
		}
		const task = await this.agentTaskStore.markWaitingForApproval(this.activeTaskId, {
			summary: `Waiting for approval to run ${tool}.`,
			waitingForApproval: {
				kind: "tool",
				tool,
				targetPath,
				summary: `Approve ${tool}${targetPath ? ` on ${targetPath}` : ""}.`,
			},
			pendingMutationCount: 0,
		});
		await this.recordTaskLifecycleEvent(task);
	}

	private async markActiveTaskToolApprovalResolved(
		tool: string,
		approved: boolean,
		reason: string,
	): Promise<void> {
		if (!this.activeTaskId) {
			return;
		}
		const current = await this.agentTaskStore.get(this.activeTaskId);
		if (current?.status !== "waiting_for_approval" || current.waitingForApproval?.kind !== "tool") {
			return;
		}
		if (!approved) {
			const summary = `Tool approval denied for ${tool}.`;
			const task = await this.agentTaskStore.markFailed(this.activeTaskId, {
				summary,
				failureReason: reason || summary,
			});
			await this.recordTaskLifecycleEvent(task);
			return;
		}
		const task = await this.agentTaskStore.markRunning(this.activeTaskId, {
			summary: `Tool approval resolved for ${tool}.`,
			pendingMutationCount: 0,
		});
		await this.recordTaskLifecycleEvent(task);
	}

	private getPendingMutationRecordsForActiveTurn(): EditPlanRecord[] {
		return this.workbenchStateStore
			.getEditPlans()
			.filter((plan) =>
				plan.originConversationId === this.activeConversationId &&
				plan.originTurnId === this.activeTurnId &&
				plan.items.some((item) => item.status === "pending")
			);
	}

	private async updateTaskAfterMutationReview(
		record: EditPlanRecord,
		status: MutationApplyStatus | "rejected",
		reason?: string,
	): Promise<void> {
		const taskId = record.originTaskId;
		if (!taskId) {
			return;
		}
		if (status === "failed") {
			const task = await this.agentTaskStore.markFailed(taskId, {
				summary: reason ?? "Mutation apply failed.",
				failureReason: reason ?? "Mutation apply failed.",
			});
			await this.recordTaskLifecycleEvent(task);
			return;
		}
		if (status === "conflicted") {
			const task = await this.agentTaskStore.markWaitingForUser(taskId, {
				summary: reason ?? "File changed before apply. Review the conflict before continuing.",
				waitingForUser: {
					prompt: reason ?? "Resolve the mutation conflict.",
				},
			});
			await this.recordTaskLifecycleEvent(task);
			return;
		}
		const remainingPendingCount = await this.countPendingMutationPlansForTask(taskId);
		if (remainingPendingCount > 0) {
			const task = await this.agentTaskStore.markWaitingForApproval(taskId, {
				summary: `Waiting for review of ${remainingPendingCount} pending file change(s).`,
				waitingForApproval: {
					kind: "mutation",
					tool: record.tool,
					targetPath: record.items[0]?.path ?? "",
					summary: "Review remaining pending file changes.",
				},
				pendingMutationCount: remainingPendingCount,
				changedFileCount: remainingPendingCount,
			});
			await this.recordTaskLifecycleEvent(task);
			return;
		}
		const task = await this.agentTaskStore.markCompleted(taskId, {
			summary: status === "rejected"
				? "Pending file changes were rejected."
				: "Pending file changes were applied.",
			pendingMutationCount: 0,
		});
		await this.recordTaskLifecycleEvent(task);
	}

	private async countPendingMutationPlansForTask(taskId: string): Promise<number> {
		const plans = await this.mutationPlanStore.list();
		return plans
			.filter((plan) => plan.taskId === taskId && plan.status === "pending")
			.reduce((total, plan) => total + plan.items.filter((item) => item.status === "pending").length, 0);
	}

	private createTaskRunInputSnapshot(input: RuntimeTurnInput): AgentTaskRunInputSnapshot {
		return {
			agentId: input.agentId,
			userPrompt: input.userPrompt,
			...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
			...(input.depth !== undefined ? { depth: input.depth } : {}),
			...(input.currentFilePath ? { currentFilePath: input.currentFilePath } : {}),
			...(input.extraSystemContext ? { extraSystemContext: input.extraSystemContext } : {}),
			...(input.allowedTools ? { allowedTools: [...input.allowedTools] } : {}),
			...(input.agentMode ? { agentMode: input.agentMode } : {}),
		};
	}

	private async recordTaskLifecycleEvent(task: AgentTask): Promise<void> {
		const event = this.buildTaskLifecycleEvent(task);
		if (!event) {
			return;
		}
		if (this.activeTurnStateMachine || this.activeTurnId) {
			this.activeTurnSideEvents.push(event);
			return;
		}
		if (!task.turnId) {
			return;
		}
		try {
			await this.turnEventLog.append(
				{ conversationId: task.conversationId, turnId: task.turnId, taskId: task.id },
				event,
			);
		} catch {
			// Task lifecycle replay should not block user-facing actions.
		}
	}

	private buildTaskLifecycleEvent(task: AgentTask): TurnEventInput | null {
		const type = this.toTaskEventType(task.status);
		if (!type) {
			return null;
		}
		return {
			type,
			payload: {
				taskId: task.id,
				status: task.status,
				summary: task.summary,
				...(task.failureReason ? { reason: task.failureReason } : {}),
				...(task.pendingMutationCount ? { pendingMutationCount: task.pendingMutationCount } : {}),
				...(task.changedFileCount ? { changedFileCount: task.changedFileCount } : {}),
			},
		};
	}

	private toTaskEventType(status: AgentTask["status"]): TurnEventInput["type"] | null {
		switch (status) {
			case "created":
				return "task_created";
			case "running":
				return "task_running";
			case "waiting_for_approval":
				return "task_waiting_for_approval";
			case "waiting_for_user":
				return "task_waiting_for_user";
			case "failed":
				return "task_failed";
			case "cancelled":
				return "task_cancelled";
			case "completed":
				return "task_completed";
			default:
				return null;
		}
	}

	private buildRuntimeTurnInvocation(input: RuntimeTurnInput): ResolvedInvocation {
		const request: InvocationRequest = {
			source: input.depth && input.depth > 0 ? "service_call" : "chat_prompt",
			intentType: "runtime",
			prompt: input.userPrompt,
			projectId: this.projectBoundaryService.getActiveProject()?.projectId,
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
			projectId: this.projectBoundaryService.getActiveProject()?.projectId,
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
		const finalResult = this.withPendingMutationNotice(result);
		const stepTraces = this.activeTurnStateMachine?.snapshot() ?? [];
		const conversationId = this.activeConversationId;
		const task = await this.finalizeActiveTask(finalResult);
		const sideEvents = [...this.activeTurnSideEvents];
		try {
			await this.stepTraceStore.appendMany(stepTraces);
		} catch {
			// Keep runtime response available even if trace persistence fails.
		}
		await this.persistTurnEvents(turnId, conversationId, stepTraces, { result: finalResult, sideEvents, taskId: task?.id });
		void userPrompt;
		return {
			...finalResult,
			turnId,
			stepTraces,
			runtimeProfile: this.activeRuntimeProfile,
			contextSummary: this.lastContextSummary ?? undefined,
			...(task ? { task } : {}),
		};
	}

	private withPendingMutationNotice(result: RuntimeTurnResult): RuntimeTurnResult {
		const pendingPlans = this.workbenchStateStore
			.getEditPlans()
			.filter((plan) =>
				plan.originConversationId === this.activeConversationId &&
				plan.originTurnId === this.activeTurnId &&
				plan.items.some((item) => item.status === "pending")
			);
		const pendingCount = pendingPlans.reduce(
			(total, plan) => total + plan.items.filter((item) => item.status === "pending").length,
			0,
		);
		if (pendingCount === 0) {
			return result;
		}
		const notice = `Pending file review: ${pendingCount} change(s) prepared but not applied. Review and apply or reject them in FRIDAY.`;
		if (result.assistantText.includes(notice)) {
			return result;
		}
		return {
			...result,
			assistantText: `${result.assistantText.trim()}\n\n${notice}`.trim(),
		};
	}

	private async persistTurnEvents(
		turnId: string,
		conversationId: string,
		stepTraces: StepTraceEvent[],
		options: { result?: RuntimeTurnResult; failureMessage?: string; sideEvents?: TurnEventInput[]; taskId?: string },
	): Promise<void> {
		const events = this.buildTurnEvents(stepTraces, options);
		if (events.length === 0) {
			return;
		}
		try {
			await this.turnEventLog.appendMany({ conversationId, turnId, taskId: options.taskId ?? this.activeTaskId }, events);
		} catch {
			// Event replay must not block the user-facing runtime result.
		}
	}

	private buildTurnEvents(
		stepTraces: StepTraceEvent[],
		options: { result?: RuntimeTurnResult; failureMessage?: string; sideEvents?: TurnEventInput[] },
	): TurnEventInput[] {
		const result = options.result;
		const toolTraces = result?.traces ?? [];
		const toolTraceCursors = new Map<string, number>();
		const events = stepTraces.flatMap((trace) =>
			this.mapStepTraceToTurnEvents(trace, toolTraces, toolTraceCursors)
		);
		events.push(...(options.sideEvents ?? this.activeTurnSideEvents));
		if (result?.parseError) {
			events.push({
				type: "parse_error",
				payload: { summary: this.truncateText(result.parseError, 240) },
			});
		}
		const safeStopped = this.isMaxToolIterationStop(result?.assistantText ?? "");
		if (safeStopped) {
			events.push({
				type: "max_tool_iterations",
				payload: { summary: "Maximum tool iteration limit reached." },
			});
		}
		if (options.failureMessage) {
			const diagnostics = this.buildFailureDiagnostics(
				options.failureMessage,
				this.isCancellationFailure(options.failureMessage) ? "cancelled" : undefined,
			);
			const failedModelStep = this.findUnansweredModelRequestStep(stepTraces);
			if (failedModelStep !== undefined) {
				events.push({
					type: "model_failed",
					payload: {
						step: failedModelStep,
						summary: this.truncateText(options.failureMessage, 240),
						...diagnostics,
					},
				});
			}
			if (this.isCancellationFailure(options.failureMessage)) {
				events.push({
					type: "turn_cancelled",
					payload: {
						summary: this.truncateText(options.failureMessage, 240),
						...diagnostics,
					},
				});
				return events;
			}
			events.push({
				type: "turn_failed",
				payload: {
					summary: this.truncateText(options.failureMessage, 240),
					...diagnostics,
				},
			});
			return events;
		}
		events.push({
			type: "assistant_final",
			payload: { summary: this.truncateText(result?.assistantText ?? "", 240) },
		});
		events.push({
			type: "turn_completed",
			payload: {
				status: safeStopped ? "safe_stopped" : "completed",
				summary: safeStopped ? "Stopped after maximum tool iterations." : "Turn completed.",
			},
		});
		return events;
	}

	private mapStepTraceToTurnEvents(
		trace: StepTraceEvent,
		toolTraces: RuntimeToolTrace[],
		toolTraceCursors: Map<string, number>,
	): TurnEventInput[] {
		const toolTrace = this.getToolTraceForStepTrace(trace, toolTraces, toolTraceCursors, trace.stepName === "STEP_TOOL_RESULT");
		const payload = this.buildStepTracePayload(trace, toolTrace);
		switch (trace.stepName) {
			case "STEP_START":
				return [{ type: "turn_started", payload }];
			case "STEP_CONTEXT":
				return [{ type: "context_built", payload }];
			case "STEP_MODEL_REQUEST":
				return [{ type: "model_requested", payload }];
			case "STEP_MODEL_RESPONSE":
				return [{ type: "model_completed", payload }];
			case "STEP_TOOL_CALL":
				return [
					{ type: "tool_requested", payload },
					{ type: "tool_policy_checked", payload: this.buildToolPolicyPayload(payload, toolTrace) },
				];
			case "STEP_TOOL_APPROVAL":
				return [{
					type: this.isApprovalRequestTrace(trace) ? "tool_approval_requested" : "tool_approval_resolved",
					payload: this.isApprovalRequestTrace(trace)
						? payload
						: this.buildToolApprovalResolvedPayload(payload, toolTrace),
				}];
			case "STEP_TOOL_RESULT":
				if (trace.status === "ok") {
					return [{ type: "tool_completed", payload }];
				}
				if (trace.status === "denied") {
					return [{ type: "tool_denied", payload }];
				}
				return [{ type: "tool_failed", payload }];
			case "STEP_FALLBACK":
				return [{ type: "fallback", payload }];
			case "STEP_DONE":
			case "STEP_ERROR":
				return [];
			default:
				return [];
		}
	}

	private buildStepTracePayload(trace: StepTraceEvent, toolTrace?: RuntimeToolTrace): Record<string, unknown> {
		const payload: Record<string, unknown> = {
			depth: trace.depth,
			summary: this.truncateText(trace.summary ?? trace.message, 240),
		};
		if (trace.step !== undefined) {
			payload.step = trace.step;
		}
		if (trace.tool) {
			payload.tool = trace.tool;
		}
		if (trace.step !== undefined && trace.tool) {
			payload.toolCallId = this.resolveToolCallId(trace, toolTrace);
		}
		if (toolTrace?.runId) {
			payload.runId = toolTrace.runId;
		}
		if (trace.contextKey) {
			payload.contextKey = trace.contextKey;
		}
		if (trace.contextKey === "compact" && this.lastContextSummary) {
			payload.used = this.lastContextSummary.used;
			payload.softLimit = this.lastContextSummary.softLimit;
			payload.hardLimit = this.lastContextSummary.hardLimit;
			payload.trimmedChannels = [...this.lastContextSummary.trimmedChannels];
			payload.overflowChannels = [...(this.lastContextSummary.overflowChannels ?? [])];
		}
		if (trace.targetPath) {
			payload.targetPath = trace.targetPath;
		}
		if (trace.status) {
			payload.status = trace.status;
		}
		if ((trace.status === "failed" || toolTrace?.status === "failed") && (toolTrace?.error || trace.summary || trace.message)) {
			Object.assign(
				payload,
				this.buildFailureDiagnostics(toolTrace?.error ?? trace.summary ?? trace.message, toolTrace?.failureClass),
			);
		}
		return payload;
	}

	private buildToolPolicyPayload(
		payload: Record<string, unknown>,
		toolTrace: RuntimeToolTrace | undefined,
	): Record<string, unknown> {
		return {
			...payload,
			decision: toolTrace?.approved === false || toolTrace?.status === "denied" ? "deny" : "allow",
			status: toolTrace?.status,
			reason: toolTrace?.approvalReason,
		};
	}

	private buildToolApprovalResolvedPayload(
		payload: Record<string, unknown>,
		toolTrace: RuntimeToolTrace | undefined,
	): Record<string, unknown> {
		const approved = Boolean(toolTrace?.approved);
		return {
			...payload,
			approved,
			decision: approved ? "approved" : "denied",
			persistedRule: toolTrace?.persistedRule ?? false,
			viaRule: toolTrace?.viaRule ?? false,
			reason: toolTrace?.approvalReason,
		};
	}

	private getToolTraceForStepTrace(
		trace: StepTraceEvent,
		toolTraces: RuntimeToolTrace[],
		cursors: Map<string, number>,
		consume: boolean,
	): RuntimeToolTrace | undefined {
		if (trace.step === undefined || !trace.tool) {
			return undefined;
		}
		const key = this.toolTraceKey(trace.step, trace.tool);
		const matchingTraces = toolTraces.filter((item) => this.toolTraceKey(item.step, item.tool) === key);
		const cursor = cursors.get(key) ?? 0;
		const match = matchingTraces[cursor];
		if (consume && match) {
			cursors.set(key, cursor + 1);
		}
		return match;
	}

	private toolTraceKey(step: number, tool: string): string {
		return `${step}:${tool.trim().toLowerCase()}`;
	}

	private resolveToolCallId(trace: StepTraceEvent, toolTrace?: RuntimeToolTrace): string {
		if (toolTrace?.runId) {
			return toolTrace.runId;
		}
		return `tool-${trace.step ?? 0}-${(trace.tool ?? "unknown").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
	}

	private isApprovalRequestTrace(trace: StepTraceEvent): boolean {
		return trace.message.includes("正在申请") || trace.message.toLowerCase().includes("request");
	}

	private findUnansweredModelRequestStep(stepTraces: StepTraceEvent[]): number | undefined {
		const requested = stepTraces.filter((trace) => trace.stepName === "STEP_MODEL_REQUEST" && trace.step !== undefined);
		for (const request of [...requested].reverse()) {
			const hasResponse = stepTraces.some((trace) =>
				trace.step === request.step &&
				trace.index > request.index &&
				trace.stepName === "STEP_MODEL_RESPONSE"
			);
			if (!hasResponse) {
				return request.step;
			}
		}
		return undefined;
	}

	private isCancellationFailure(message: string): boolean {
		return /cancelled|canceled|aborted|abort/i.test(message);
	}

	private assertActiveTaskNotCancelled(): void {
		if (this.activeTaskAbortController?.signal.aborted) {
			throw new Error("Task cancelled.");
		}
	}

	private getActiveTaskSignal(): AbortSignal | undefined {
		return this.activeTaskAbortController?.signal;
	}

	private buildFailureDiagnostics(
		message: string,
		failureClassOverride?: RuntimeFailureClass,
	): Record<string, unknown> {
		const error = message.trim() || "Unknown runtime failure.";
		const failureClass = failureClassOverride ?? this.toolGovernor.classifyFailure(error);
		const retryable = failureClass !== "cancelled" && this.toolGovernor.isRetryableTransportFailure(error);
		return {
			error: this.truncateText(error, 500),
			failureClass,
			recoverable: retryable,
			retryable,
		};
	}

	private isMaxToolIterationStop(assistantText: string): boolean {
		return assistantText.includes("Maximum tool-iteration limit reached");
	}

	private resolveConversationId(agentId: string | undefined): string {
		return agentId?.trim() || "default";
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

	async restorePendingMutationPlans(): Promise<number> {
		const plans = await this.mutationPlanStore.getPending();
		for (const plan of plans) {
			this.workbenchStateStore.recordEditPlan(this.toEditPlanRecord(plan));
		}
		return plans.length;
	}

	async listPendingMutationPlans(): Promise<MutationPlan[]> {
		return this.mutationPlanStore.getPending();
	}

	async listMutationPlansByTurnId(turnId: string): Promise<MutationPlan[]> {
		return this.mutationPlanStore.getByTurnId(turnId);
	}

	async listMutationPlansByConversationId(conversationId: string): Promise<MutationPlan[]> {
		return this.mutationPlanStore.getByConversationId(conversationId);
	}

	async listAgentTasks(limit = 50): Promise<AgentTask[]> {
		const tasks = await this.agentTaskStore.list();
		return tasks.slice(Math.max(0, tasks.length - limit));
	}

	async listAgentTasksByConversationId(conversationId: string): Promise<AgentTask[]> {
		return this.agentTaskStore.getByConversationId(conversationId);
	}

	async getAgentTask(taskId: string): Promise<AgentTask | undefined> {
		return this.agentTaskStore.get(taskId);
	}

	async cancelAgentTask(taskId: string, reason = "User cancelled task."): Promise<AgentTask> {
		this.taskAbortControllers.get(taskId)?.abort();
		const task = await this.agentTaskStore.cancelTask(taskId, {
			summary: reason,
			failureReason: reason,
		});
		await this.recordTaskLifecycleEvent(task);
		return task;
	}

	async retryAgentTask(taskId: string, options: RuntimeTaskResumeOptions = {}): Promise<RuntimeTurnResult> {
		const original = await this.getRequiredAgentTask(taskId);
		const input = this.buildResumeTurnInput(original, "retry", options);
		return this.runTurn({
			...input,
			retryOfTaskId: original.id,
		});
	}

	async continueAgentTask(taskId: string, options: RuntimeTaskResumeOptions = {}): Promise<RuntimeTurnResult> {
		const original = await this.getRequiredAgentTask(taskId);
		const input = this.buildResumeTurnInput(original, "continue", options);
		return this.runTurn({
			...input,
			continueFromTaskId: original.id,
		});
	}

	private async getRequiredAgentTask(taskId: string): Promise<AgentTask> {
		const task = await this.agentTaskStore.get(taskId);
		if (!task) {
			throw new Error(`Agent task not found: ${taskId}`);
		}
		return task;
	}

	private buildResumeTurnInput(
		task: AgentTask,
		kind: "retry" | "continue",
		options: RuntimeTaskResumeOptions,
	): RuntimeTurnInput {
		const snapshot = task.runInput;
		if (!snapshot) {
			throw new Error(`Agent task ${task.id} cannot be ${kind === "retry" ? "retried" : "continued"} because its original turn input was not recorded.`);
		}
		const continuationText = options.userPrompt?.trim() || "";
		const userPrompt = kind === "continue"
			? [
				snapshot.userPrompt,
				continuationText ? `User continuation: ${continuationText}` : "User continuation: Continue from the current task state.",
			].join("\n\n")
			: snapshot.userPrompt;
		return {
			agentId: snapshot.agentId || task.agentId || task.conversationId,
			conversation: [],
			userPrompt,
			modelOverride: snapshot.modelOverride,
			depth: snapshot.depth,
			currentFilePath: snapshot.currentFilePath,
			extraSystemContext: snapshot.extraSystemContext,
			allowedTools: snapshot.allowedTools,
			agentMode: snapshot.agentMode as AgentMode | undefined,
			onProgress: options.onProgress,
			signal: options.signal,
		};
	}

	async acceptEditPlan(planId: string): Promise<MutationApplyStatus> {
		const record = await this.getEditPlanRecord(planId);
		const storedPlan = await this.mutationPlanStore.get(planId);
		const result = await this.mutationApplier.apply(storedPlan ?? this.toMutationPlan(record));
		await this.mutationPlanStore.replace(result.plan);
		if (result.status === "failed") {
			this.workbenchStateStore.replaceEditPlan(record);
			await this.persistMutationReviewEvent(record, "mutation_apply_failed", result.reason);
			await this.updateTaskAfterMutationReview(record, "failed", result.reason);
			return result.status;
		}
		const nextRecord = this.withEditPlanStatus(record, result.status);
		this.workbenchStateStore.replaceEditPlan(nextRecord);
		await this.persistMutationReviewEvent(
			nextRecord,
			result.status === "conflicted" ? "mutation_conflicted" : "mutation_applied",
			result.reason,
		);
		await this.updateTaskAfterMutationReview(nextRecord, result.status, result.reason);
		return result.status;
	}

	async rejectEditPlan(planId: string): Promise<void> {
		const record = await this.getEditPlanRecord(planId);
		if (record.items.some((item) => item.status === "applied" || item.status === "accepted")) {
			await this.rollbackEditPlan(planId, "rejected");
			return;
		}
		const storedPlan = await this.mutationPlanStore.get(planId);
		const result = await this.mutationApplier.reject(storedPlan ?? this.toMutationPlan(record));
		if (result.status === "failed") {
			throw new Error(result.reason ?? `Edit plan could not be rejected: ${planId}`);
		}
		await this.mutationPlanStore.replace(result.plan);
		const nextRecord = this.withEditPlanStatus(record, "rejected");
		this.workbenchStateStore.replaceEditPlan(nextRecord);
		await this.persistMutationReviewEvent(nextRecord, "mutation_rejected");
		await this.updateTaskAfterMutationReview(nextRecord, "rejected");
	}

	async rollbackEditPlan(planId: string, nextStatus: "rejected" | "rolled_back" = "rolled_back"): Promise<void> {
		const record = this.workbenchStateStore.getEditPlans().find((item) => item.id === planId);
		if (!record) {
			throw new Error(`Edit plan not found: ${planId}`);
		}
		for (const item of [...record.items].reverse()) {
			if (item.status !== "applied" && item.status !== "accepted") {
				item.status = nextStatus;
				continue;
			}
			await this.rollbackEditPlanItem(item, record.agentId);
			item.status = nextStatus;
		}
		this.workbenchStateStore.replaceEditPlan(record);
		await this.mutationPlanStore.replace(setMutationPlanStatus(this.toMutationPlan(record), "rejected"));
		await this.persistMutationReviewEvent(record, "mutation_rejected");
		await this.updateTaskAfterMutationReview(record, "rejected");
	}

	private async getEditPlanRecord(planId: string): Promise<EditPlanRecord> {
		const record = this.workbenchStateStore.getEditPlans().find((item) => item.id === planId);
		if (record) {
			return record;
		}
		const storedPlan = await this.mutationPlanStore.get(planId);
		if (storedPlan) {
			return this.toEditPlanRecord(storedPlan);
		}
		throw new Error(`Edit plan not found: ${planId}`);
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
			{ action: "tool:use_skill", effect: "allow", source: "global" },
			{ action: "tool:ls", effect: resolveEffect("ls", readEffect), source: "global" },
			{ action: "tool:read", effect: resolveEffect("read", readEffect), source: "global" },
			{ action: "tool:grep", effect: resolveEffect("grep", readEffect), source: "global" },
			{ action: "tool:search_text", effect: resolveEffect("search_text", readEffect), source: "global" },
			{ action: "tool:glob", effect: resolveEffect("glob", readEffect), source: "global" },
			...(WIKI_FEATURE_ENABLED
				? [{ action: "tool:compile_wiki", effect: resolveEffect("compile_wiki", writeEffect), source: "global" } as PolicyRule]
				: []),
			{ action: "tool:memory", effect: resolveEffect("memory", "allow"), source: "global" },
			{ action: "tool:write", effect: resolveEffect("write", writeEffect), source: "global" },
			{ action: "tool:edit", effect: resolveEffect("edit", writeEffect), source: "global" },
			{ action: "tool:delete", effect: resolveEffect("delete", writeEffect), source: "global" },
			{ action: "tool:exec", effect: resolveEffect("exec", execEffect), source: "global" },
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
			this.assertActiveTaskNotCancelled();
			this.reportProgress(input, {
				phase: "model_request",
				depth,
				step,
				message: `Step ${step}: requesting model decision (prompt runtime)`,
			});
			const reply = await this.aiService.chat(modelMessages, {
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: this.getActiveTaskSignal(),
			});
			this.assertActiveTaskNotCancelled();
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

			if (parsed.type === "response" || (!parsed.type && !parsed.tool)) {
				const pendingMutations = this.recordMutationPlansFromEnvelope(parsed);
				return {
					assistantText: (parsed.assistant ?? finalReply).trim() || "(Model returned no usable content)",
					traces,
					rawFinalReply: finalReply,
					...(pendingMutations.length > 0 ? { pendingMutations } : {}),
				};
			}

			if (!parsed.tool && this.hasMutationPlans(parsed)) {
				const pendingMutations = this.recordMutationPlansFromEnvelope(parsed);
				return {
					assistantText: (parsed.assistant ?? finalReply).trim() || "(Model returned no usable content)",
					traces,
					rawFinalReply: finalReply,
					pendingMutations,
				};
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
				this.assertActiveTaskNotCancelled();
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
				const loadedSkillContext = this.extractLoadedSkillSystemContext(executedResult.payload);
				if (loadedSkillContext) {
					modelMessages.push({ role: "system", content: loadedSkillContext });
				}
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
		const tools = this.buildNativeToolDefinitions(settings, allowedToolSet, this.resolveAgentMode(input));
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
			this.assertActiveTaskNotCancelled();
			this.reportProgress(input, {
				phase: "model_request",
				depth,
				step,
				message: `Step ${step}: requesting model decision (native tools)`,
			});
			const response = await this.aiService.chatWithTools(modelMessages, tools, {
				modelOverride: input.modelOverride?.trim() || undefined,
				signal: this.getActiveTaskSignal(),
			});
			this.assertActiveTaskNotCancelled();
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

			const toolCalls = response.toolCalls;
			if (toolCalls.length === 0) {
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
					if (parsed.type === "response" || (!parsed.type && !parsed.tool)) {
						const pendingMutations = this.recordMutationPlansFromEnvelope(parsed);
						return {
							assistantText: (parsed.assistant ?? assistantPayload).trim() || "(Model returned no usable content)",
							traces,
							rawFinalReply: assistantPayload || finalReply,
							...(pendingMutations.length > 0 ? { pendingMutations } : {}),
						};
					}

					if (!parsed.tool && this.hasMutationPlans(parsed)) {
						const pendingMutations = this.recordMutationPlansFromEnvelope(parsed);
						return {
							assistantText: (parsed.assistant ?? assistantPayload).trim() || "(Model returned no usable content)",
							traces,
							rawFinalReply: assistantPayload || finalReply,
							pendingMutations,
						};
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
				this.assertActiveTaskNotCancelled();
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
						const loadedSkillContext = this.extractLoadedSkillSystemContext(toolResult.payload);
						if (loadedSkillContext) {
							modelMessages.push({ role: "system", content: loadedSkillContext });
						}
						continue;
					}
				}

				return {
					assistantText: assistantPayload || "(Model returned no usable content)",
					traces,
					rawFinalReply: finalReply,
				};
			}

			const toolResultMessages: ChatMessage[] = [];
			const loadedSkillContexts: string[] = [];
			for (const toolCall of toolCalls) {
				this.assertActiveTaskNotCancelled();
				this.reportProgress(input, {
					phase: "tool_call",
					depth,
					step,
					tool: toolCall.name,
					targetPath: this.resolveToolTargetPath(toolCall.name, toolCall.args ?? {}),
					message: `Step ${step}: calling tool ${toolCall.name}`,
				});
				const toolResult = await this.executeTool(step, input, {
					name: toolCall.name,
					args: toolCall.args,
				}, allowedToolSet);
				this.assertActiveTaskNotCancelled();
				traces.push(toolResult.trace);
				lastToolPayload = toolResult.payload;
				this.reportProgress(input, {
					phase: "tool_result",
					depth,
					step,
					tool: toolCall.name,
					targetPath: toolResult.trace.targetPath,
					status: toolResult.trace.status,
					summary: toolResult.trace.summary,
					message: `Step ${step}: tool ${toolCall.name} finished - ${toolResult.trace.summary}`,
				});
				toolResultMessages.push({
					role: "tool",
					content: this.formatToolResultForModel(toolResult.payload),
					toolCallId: toolCall.id,
					name: toolCall.name,
				});
				const loadedSkillContext = this.extractLoadedSkillSystemContext(toolResult.payload);
				if (loadedSkillContext) {
					loadedSkillContexts.push(loadedSkillContext);
				}
			}

			modelMessages.push({
				role: "assistant",
				content: response.assistantText?.trim() || "",
				toolCalls,
				reasoningContent: response.reasoningContent,
			});
			modelMessages.push(...toolResultMessages);
			for (const loadedSkillContext of loadedSkillContexts) {
				modelMessages.push({ role: "system", content: loadedSkillContext });
			}
		}

		const overflowTip = "Maximum tool-iteration limit reached. Stopped further tool calls.";
		return {
			assistantText: finalReply ? `${finalReply}\n\n${overflowTip}` : overflowTip,
			traces,
			rawFinalReply: finalReply,
		};
	}

	private buildRuntimeHistory(conversation: ChatMessage[]): ChatMessage[] {
		const compacted = this.historyCompactor.compact(conversation, {
			preserveRecent: true,
			maxMessages: 12,
			maxCharsPerMessage: 1800,
		}).messages as ChatMessage[];
		return this.toolBoundaryFilter.repair(compacted, {
			maxToolResultTokens: 900,
		}).messages as ChatMessage[];
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

		// --- Layer merge: FRIDAY.md (project) + soul definition ---
		this.reportContextProgress(input, depth, "instructions", "加载项目规则与 Soul 设定");
		const fridayMd = await this.loadFridayMd();
		const soulDefinition = await this.soulStore.getSoul(agentId);
		const agentProfile = soulDefinition
			? this.truncateText(
				[
					`# ${soulDefinition.name}`,
					soulDefinition.summary,
					soulDefinition.description,
					soulDefinition.rolePrompt,
					this.resolveSoulTonePrompt(soulDefinition.tonePreset, soulDefinition.tonePrompt),
					soulDefinition.behaviorRules.length > 0
						? `Behavior rules:\n- ${soulDefinition.behaviorRules.join("\n- ")}`
						: "",
					soulDefinition.antiPatterns.length > 0
						? `Anti-patterns:\n- ${soulDefinition.antiPatterns.join("\n- ")}`
						: "",
				].filter(Boolean).join("\n\n"),
				3000,
			)
			: "soul definition not found";

		const trimmedExtra = extraSystemContext?.trim();

		this.reportContextProgress(input, depth, "skills", "匹配相关技能与命令约束");
		const autoSkillContext = await this.buildAutoSkillContext(userPrompt, currentFilePath, trimmedExtra);
		const runtimeExtraContext = autoSkillContext && autoSkillContext === trimmedExtra ? "" : trimmedExtra;

		let wikiKnowledgeContext = "";
		if (WIKI_FEATURE_ENABLED) {
			this.reportContextProgress(input, depth, "wiki", "检索项目知识与候选文档");
			wikiKnowledgeContext = await this.wikiLookupCapability.execute(userPrompt ?? "");
		}

		this.reportContextProgress(input, depth, "memory", "加载长期记忆与项目偏好");
		const memoryContext = await this.loadMemoryContext();

		this.reportContextProgress(input, depth, "compact", "压缩上下文并生成提示包");
		const agentMode = this.resolveAgentMode(input);
		const allowedToolSet = this.buildAllowedToolSet(input.allowedTools);
		const promptContext = this.promptContextEngine.build({
			mode: settings.agentRuntime.toolCallingMode ?? "auto",
			depth,
			permissionMode: "auto",
			runtimeProfileId: this.activeRuntimeProfile.id,
			runtimeSupported: this.activeRuntimeProfile.supported,
			runtimeCapabilities: this.activeRuntimeProfile.capabilities,
			focusPaths,
			externalPaths,
			currentFilePath,
			activeProjectRoot,
			userPrompt: userPrompt ?? "",
			fridayMd,
			agentProfile,
			extraSystemContext: runtimeExtraContext,
			autoSkillContext,
			wikiKnowledgeContext,
			memoryContext,
			mentionContext: input.mentionContext,
			enableExecTool: this.shouldExposeExecTool(settings, allowedToolSet, agentMode),
			agentMode,
			hardLimit: 1600,
		});
		this.lastContextSummary = promptContext.summary;
		return promptContext.prompt;
	}

	private resolveSoulTonePrompt(tonePreset: string | undefined, tonePrompt: string | undefined): string {
		const presetText =
			tonePreset === "calm"
				? "语气风格：冷静。表达克制、客观、少情绪化。"
				: tonePreset === "warm"
					? "语气风格：亲和。表达有温度、易接近，但不要过度热情。"
					: "语气风格：平衡。表达清晰自然，不过冷也不过热。";
		const noteText = tonePrompt?.trim() ? `补充说明：${tonePrompt.trim()}` : "";
		return [presetText, noteText].filter(Boolean).join("\n");
	}

	private async buildAutoSkillContext(
		userPrompt: string | undefined,
		currentFilePath: string | undefined,
		extraSystemContext: string | undefined,
	): Promise<string> {
		if (extraSystemContext?.includes("[SkillInvocation]")) {
			return extraSystemContext;
		}
		void userPrompt;
		void currentFilePath;
		return "";
	}

	private async loadMemoryContext(): Promise<string> {
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		const context = await this.memoryStore.readPromptContext(activeProjectRoot || undefined);
		return context ? this.truncateText(context, 1600) : "";
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

	private hasMutationPlans(envelope: RuntimeEnvelope): boolean {
		return envelope.type === "mutation_plan" ||
			Array.isArray(envelope.mutations) ||
			Array.isArray(envelope.pendingMutations);
	}

	private recordMutationPlansFromEnvelope(envelope: RuntimeEnvelope): RuntimeMutationPlan[] {
		const rawPlans = Array.isArray(envelope.mutations)
			? envelope.mutations
			: Array.isArray(envelope.pendingMutations)
				? envelope.pendingMutations
				: [];
		return this.recordRuntimeMutationPlans(rawPlans, "model_envelope");
	}

	private recordRuntimeMutationPlans(
		plans: RuntimeMutationPlan[],
		source: string,
	): RuntimeMutationPlan[] {
		const normalized = plans
			.map((plan, index) => this.normalizeRuntimeMutationPlan(plan, index, source))
			.filter((plan) => Boolean(plan.operation || plan.targetPath || plan.summary));
		for (const plan of normalized) {
			this.activeTurnSideEvents.push({
				type: "mutation_planned",
				payload: {
					id: plan.id,
					operation: plan.operation,
					targetPath: plan.targetPath,
					summary: plan.summary,
					status: plan.status,
					source: plan.source,
				},
			});
		}
		return normalized;
	}

	private normalizeRuntimeMutationPlan(
		plan: RuntimeMutationPlan,
		index: number,
		source: string,
	): RuntimeMutationPlan {
		const operation = typeof plan.operation === "string" ? plan.operation.trim() : "";
		const targetPath = typeof plan.targetPath === "string" ? normalizePath(plan.targetPath.trim()) : "";
		const summary = typeof plan.summary === "string" ? this.truncateText(plan.summary.trim(), 240) : "";
		const id = typeof plan.id === "string" && plan.id.trim()
			? plan.id.trim()
			: `mutation-plan-${this.activeTurnId || "turn"}-${index + 1}`;
		const status = typeof plan.status === "string" && plan.status.trim() ? plan.status.trim() : "pending";
		return {
			id,
			operation,
			targetPath,
			summary,
			status,
			source,
		};
	}

	private async executeTool(
		step: number,
		input: RuntimeTurnInput,
		tool: RuntimeToolCall,
		allowedTools: Set<string> | null,
	): Promise<{ trace: RuntimeToolTrace; payload: RuntimeToolResultPayload }> {
		this.assertActiveTaskNotCancelled();
		const startedAt = new Date().toISOString();
		const depth = input.depth ?? 0;
		const agentId = input.agentId;
		const name = tool.name.trim().toLowerCase();
		const args = this.normalizeToolArgs(name, tool.args ?? {});
		const runId = this.toolGovernor.createRunId(name, step);
		const targetPath = this.resolveToolTargetPath(name, args);
		const scope = this.resolveScope(targetPath);
		const shouldReportApproval = !["use_skill", "ls", "read", "grep", "search_text", "glob"].includes(name);
		const settings = this.getSettings();
		const gatewayPolicy = this.resolveToolPolicy(name);
		const shouldRequestToolApproval = shouldReportApproval && gatewayPolicy.effect === "ask";
		if (shouldReportApproval) {
			const target = targetPath ? `（${targetPath}）` : "";
			if (shouldRequestToolApproval) {
				await this.markActiveTaskWaitingForToolApproval(name, targetPath);
			}
			this.reportProgress(input, {
				phase: "tool_approval",
				depth,
				step,
				tool: name,
				message: `正在申请工具权限：${name}${target}`,
			});
		}

		const gatewayResult = await this.toolGateway.run({
			policyInput: {
				agentMode: this.resolveAgentMode(input),
				enableExecTool: settings.agentRuntime.enableExecTool,
				runtimeProfile: this.activeRuntimeProfile,
				toolName: name,
				args,
				scope,
				targetPath,
				disabledTools: this.buildDisabledToolSet(),
				allowedTools,
				policyEffect: gatewayPolicy.effect,
				workspaceRoot: this.resolvePolicyWorkspaceRoot(),
			},
			approvalRequest: {
				agentId,
				tool: name,
				scope,
				targetPath: scope === "vault" ? normalizePath(targetPath || "") : targetPath,
				description: `${name}(${this.safeStringify(args, 260)})`,
			},
			requestApproval: gatewayPolicy.effect === "allow"
				? async () => ({
					allowed: true,
					persisted: false,
					viaRule: false,
					reason: `Policy allow (source=${gatewayPolicy.source})`,
				})
				: (request) => this.approvalService.requestApproval(request),
			execute: () => {
				this.assertActiveTaskNotCancelled();
				return this.runToolByName(name, args, agentId, runId);
			},
		});
		this.assertActiveTaskNotCancelled();
		const gatewayApproval = gatewayResult.approval;
		const gatewayApprovalReason = gatewayApproval?.reason ?? gatewayResult.decision.reason;
		if (shouldRequestToolApproval) {
			await this.markActiveTaskToolApprovalResolved(
				name,
				Boolean(gatewayApproval?.allowed ?? gatewayResult.status !== "denied"),
				gatewayApprovalReason,
			);
		}

		if (shouldReportApproval) {
			if (gatewayResult.status === "denied") {
				this.reportProgress(input, {
					phase: "tool_approval",
					depth,
					step,
					tool: name,
					message: `工具权限被拒绝：${name}`,
				});
			} else {
				const approvalStatus = gatewayApproval?.viaRule
					? "命中已保存规则，自动授权"
					: gatewayApproval?.persisted
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
		}

		if (gatewayResult.status === "ok") {
			const data = gatewayResult.data;
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: true,
				approvalReason: gatewayApprovalReason,
				persistedRule: gatewayApproval?.persisted ?? false,
				viaRule: gatewayApproval?.viaRule ?? false,
				status: "ok",
				ok: true,
				summary: this.buildSummaryFromData(name, data),
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: { ok: true, tool: name, data },
			};
		}

		if (gatewayResult.status === "failed") {
			const message = gatewayResult.error || "Unknown error";
			const failureClass = this.toolGovernor.classifyFailure(message);
			const trace: RuntimeToolTrace = {
				runId,
				step,
				tool: name,
				scope,
				targetPath,
				approved: Boolean(gatewayApproval?.allowed ?? gatewayResult.decision.allow),
				approvalReason: gatewayApprovalReason,
				persistedRule: gatewayApproval?.persisted ?? false,
				viaRule: gatewayApproval?.viaRule ?? false,
				status: "failed",
				failureClass,
				ok: false,
				summary: `${name} failed`,
				error: message,
			};
			await this.persistToolRun(trace, startedAt, new Date().toISOString());
			return {
				trace,
				payload: { ok: false, tool: name, error: message },
			};
		}

		const denyCode = gatewayResult.decision.allow ? undefined : gatewayResult.decision.code;
		const denyReason = gatewayResult.error || gatewayApprovalReason;
		const deniedTrace: RuntimeToolTrace = {
			runId,
			step,
			tool: name,
			scope,
			targetPath,
			approved: false,
			approvalReason: denyReason,
			persistedRule: gatewayApproval?.persisted ?? false,
			viaRule: gatewayApproval?.viaRule ?? false,
			status: "denied",
			failureClass: this.classifyPolicyDeny(denyCode),
			ok: false,
			summary: `${name} blocked`,
			error: denyReason,
		};
		await this.persistToolRun(deniedTrace, startedAt, new Date().toISOString());
		return {
			trace: deniedTrace,
			payload: { ok: false, tool: name, error: denyReason },
		};
	}

	private async runToolByName(
		name: string,
		args: Record<string, unknown>,
		agentId: string,
		toolCallId?: string,
	): Promise<unknown> {
		if (name === "use_skill") {
			return this.toolUseSkill(args);
		}
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
			...(WIKI_FEATURE_ENABLED ? { compile_wiki: async (payload) => this.toolCompileWiki(payload) } : {}),
			memory: async (payload) => this.toolMemory(payload),
			write: async (payload) => this.toolWrite(payload, agentId, toolCallId),
			edit: async (payload) => this.toolEdit(payload, agentId, toolCallId),
			delete: async (payload) => this.toolDelete(payload, agentId, toolCallId),
			exec: async (payload) => this.toolExec(payload),
		});

		const handler = resolver.resolve(manifest.name);
		if (!handler) {
			throw new Error(`No capability handler bound for tool: ${manifest.name}`);
		}
		return handler(args, agentId);
	}

	private async toolUseSkill(args: Record<string, unknown>): Promise<unknown> {
		const command = this.getRequiredStringArg(args, "command");
		const reason = this.getStringArg(args, "reason");
		const skillContext = await this.skillCommandService.buildSkillSystemContext(command, {
			invocationMode: "auto",
			selectionReason: reason || "Model selected the skill during runtime routing.",
		});
		return {
			command: skillContext.skill.command,
			name: skillContext.skill.name,
			description: skillContext.skill.description,
			loaded: true,
			summary: `Loaded skill ${skillContext.skill.command}`,
			systemContext: skillContext.systemContext,
		};
	}

	private async toolMemory(args: Record<string, unknown>): Promise<unknown> {
		const action = this.getRequiredStringArg(args, "action") as MemoryWriteInput["action"];
		const scope = this.getRequiredStringArg(args, "scope") as MemoryWriteInput["scope"];
		const content = this.getStringArg(args, "content");
		const oldText = this.getStringArg(args, "old_text");
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		const result = await this.memoryStore.write({
			action,
			scope,
			content,
			oldText,
			projectRoot: scope === "project" ? activeProjectRoot || undefined : undefined,
		});
		return result;
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

	private async toolWrite(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
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
		const afterContent = content;
		const diffSegments = this.inlineEditService.computeLineDiff(beforeContent, afterContent);
		const editPlanId = await this.recordEditPlan({
			agentId,
			toolCallId,
			tool: "write",
			path: effectivePath,
			before: beforeContent,
			after: afterContent,
			changeType: actionType === "create" ? "create" : "update",
		});
		const applied = await this.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			type: actionType,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
			diff: this.makeSimpleDiffSummary(beforeContent, afterContent),
			diffPreview: this.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private async toolDelete(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
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
		if (deletedType === "folder") {
			throw new Error("Folder delete cannot be represented as a reviewable mutation plan yet.");
		}
		const editPlanId = await this.recordEditPlan({
			agentId,
			toolCallId,
			tool: "delete",
			path: effectivePath,
			before: beforeContent,
			after: "",
			changeType: "delete",
		});
		const applied = await this.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			type: "delete",
			deletedType,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
		};
	}

	private async toolEdit(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
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

		const diffSegments = this.inlineEditService.computeLineDiff(beforeContent, editResult.result);
		const editPlanId = await this.recordEditPlan({
			agentId,
			toolCallId,
			tool: "edit",
			path: effectivePath,
			before: beforeContent,
			after: editResult.result,
			changeType: "update",
		});
		const applied = await this.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
			proposedEdits: editResult.appliedCount,
			appliedEdits: editResult.appliedCount,
			failedReasons: editResult.failedReasons,
			diffPreview: this.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private async recordEditPlan(input: {
		agentId: string;
		toolCallId?: string;
		tool: string;
		path: string;
		before: string;
		after: string;
		changeType: "create" | "update" | "delete";
	}): Promise<string> {
		const id = `edit-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const operation = this.resolveMutationOperation(input.tool);
		const plan = createMutationPlan({
			id,
			agentId: input.agentId,
			conversationId: this.activeConversationId,
			turnId: this.activeTurnId,
			taskId: this.activeTaskId,
			toolCallId: input.toolCallId,
			operation,
			targetPath: input.path,
			before: input.before,
			after: input.after,
			changeType: input.changeType,
			summary: `${input.tool} ${input.changeType} ${input.path}`,
		});
		const record: EditPlanRecord = {
			id: plan.id,
			agentId: plan.agentId,
			originConversationId: plan.conversationId,
			originTurnId: plan.turnId,
			originTaskId: plan.taskId,
			toolCallId: plan.toolCallId,
			tool: input.tool,
			recordedAt: plan.createdAt,
			items: [
				{
					path: input.path,
					before: input.before,
					after: input.after,
					beforeHash: plan.beforeHash,
					afterHash: plan.proposedHash,
					status: "pending",
					changeType: input.changeType,
					riskLevel: plan.riskLevel,
					summary: plan.summary,
				},
			],
		};
		await this.mutationPlanStore.save(plan);
		this.workbenchStateStore.recordEditPlan(record);
		this.activeTurnSideEvents.push({
			type: "mutation_planned",
			payload: this.buildMutationEventPayload(record, "planned"),
		});
		return record.id;
	}

	private async maybeAutoApplyEditPlan(planId: string): Promise<boolean> {
		if (this.getFileMutationMode() !== "autoApproved") {
			return false;
		}
		const status = await this.acceptEditPlan(planId);
		return status === "applied";
	}

	private getFileMutationMode(): FridaySettings["agentRuntime"]["fileMutationMode"] {
		return this.getSettings().agentRuntime.fileMutationMode ?? "review";
	}

	private resolveMutationOperation(tool: string): MutationOperation {
		const normalized = tool.trim().toLowerCase();
		if (normalized === "delete") {
			return "delete";
		}
		if (normalized === "edit") {
			return "edit";
		}
		return "write";
	}

	private toMutationPlan(record: EditPlanRecord): MutationPlan {
		const items = record.items.map((item) => ({
			path: item.path,
			before: item.before,
			after: item.after,
			beforeHash: item.beforeHash ?? hashMutationContent(item.before),
			afterHash: item.afterHash ?? hashMutationContent(item.after),
			status: this.toMutationPlanStatus(item.status),
			changeType: item.changeType as MutationChangeType,
		}));
		const firstItem = items[0];
		const riskLevel = record.items[0]?.riskLevel ??
			(firstItem?.changeType === "delete" ? "high" : "standard");
		return {
			id: record.id,
			agentId: record.agentId,
			...(record.originConversationId ? { conversationId: record.originConversationId } : {}),
			...(record.originTurnId ? { turnId: record.originTurnId } : {}),
			...(record.originTaskId ? { taskId: record.originTaskId } : {}),
			...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
			operation: this.resolveMutationOperation(record.tool),
			targetPath: firstItem?.path ?? "",
			beforeHash: firstItem?.beforeHash ?? hashMutationContent(""),
			proposedHash: firstItem?.afterHash ?? hashMutationContent(""),
			riskLevel,
			summary: record.items[0]?.summary ?? `${record.tool} ${firstItem?.changeType ?? "update"} ${firstItem?.path ?? ""}`.trim(),
			status: this.resolveEditPlanStatus(record),
			createdAt: record.recordedAt,
			items,
		};
	}

	private toEditPlanRecord(plan: MutationPlan): EditPlanRecord {
		return {
			id: plan.id,
			agentId: plan.agentId,
			originConversationId: plan.conversationId,
			originTurnId: plan.turnId,
			originTaskId: plan.taskId,
			toolCallId: plan.toolCallId,
			tool: plan.operation,
			recordedAt: plan.createdAt,
			items: plan.items.map((item) => ({
				path: item.path,
				before: item.before,
				after: item.after,
				beforeHash: item.beforeHash,
				afterHash: item.afterHash,
				status: item.status,
				changeType: item.changeType,
				riskLevel: plan.riskLevel,
				summary: plan.summary,
			})),
		};
	}

	private resolveEditPlanStatus(record: EditPlanRecord): MutationPlanStatus {
		if (record.items.some((item) => item.status === "conflicted")) {
			return "conflicted";
		}
		if (record.items.length > 0 && record.items.every((item) => item.status === "applied" || item.status === "accepted")) {
			return "applied";
		}
		if (record.items.length > 0 && record.items.every((item) => item.status === "rejected" || item.status === "rolled_back")) {
			return "rejected";
		}
		return "pending";
	}

	private toMutationPlanStatus(status: EditPlanRecord["items"][number]["status"]): MutationPlanStatus {
		if (status === "applied" || status === "accepted") {
			return "applied";
		}
		if (status === "rejected" || status === "rolled_back") {
			return "rejected";
		}
		if (status === "conflicted") {
			return "conflicted";
		}
		return "pending";
	}

	private withEditPlanStatus(record: EditPlanRecord, status: MutationPlanStatus): EditPlanRecord {
		return {
			...record,
			items: record.items.map((item) => ({
				...item,
				status,
			})),
		};
	}

	private async persistMutationReviewEvent(
		record: EditPlanRecord,
		type: "mutation_applied" | "mutation_rejected" | "mutation_conflicted" | "mutation_apply_failed",
		reason?: string,
	): Promise<void> {
		if (!record.originConversationId || !record.originTurnId) {
			return;
		}
		const status = type === "mutation_applied"
			? "applied"
			: type === "mutation_rejected"
				? "rejected"
				: type === "mutation_conflicted"
					? "conflicted"
					: "apply_failed";
		const event: TurnEventInput = {
			type,
			payload: this.buildMutationEventPayload(record, status, reason),
		};
		if (record.originTurnId === this.activeTurnId && record.originConversationId === this.activeConversationId) {
			this.activeTurnSideEvents.push(event);
			return;
		}
		try {
			await this.turnEventLog.append({
				conversationId: record.originConversationId,
				turnId: record.originTurnId,
				taskId: record.originTaskId,
			}, event);
		} catch {
			// Mutation review events are diagnostic and must not block review actions.
		}
	}

	private buildMutationEventPayload(
		record: EditPlanRecord,
		status: "planned" | "applied" | "rejected" | "conflicted" | "apply_failed",
		reason?: string,
	): Record<string, unknown> {
		const firstItem = record.items[0];
		return {
			id: record.id,
			...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
			...(record.originTaskId ? { taskId: record.originTaskId } : {}),
			tool: record.tool,
			status,
			operation: this.resolveMutationOperation(record.tool),
			targetPath: firstItem?.path ?? "",
			beforeHash: firstItem?.beforeHash ?? "",
			proposedHash: firstItem?.afterHash ?? "",
			riskLevel: firstItem?.riskLevel ?? "standard",
			itemCount: record.items.length,
			summary: reason || `${record.tool} ${status} ${record.items.length} mutation(s)`,
			...(reason ? { reason } : {}),
			...(status === "apply_failed" && reason ? { error: reason } : {}),
		};
	}

	private async readVaultFileContentOrNull(targetPath: string): Promise<string | null> {
		const file = this.vault.getAbstractFileByPath(normalizePath(targetPath));
		if (!(file instanceof TFile)) {
			return null;
		}
		return this.vault.cachedRead(file);
	}

	private async applyVaultWrite(targetPath: string, content: string, agentId: string): Promise<void> {
		await this.ensureVaultFolder(targetPath.split("/").slice(0, -1).join("/"));
		const existing = this.vault.getAbstractFileByPath(targetPath);
		await this.actionService.execute({
			type: existing instanceof TFile ? "update" : "create",
			targetType: targetPath.toLowerCase().endsWith(".canvas") ? "canvas" : "markdown",
			path: targetPath,
			content,
		}, agentId);
	}

	private async applyVaultDelete(targetPath: string, agentId: string): Promise<void> {
		const existing = this.vault.getAbstractFileByPath(targetPath);
		if (!(existing instanceof TFile) && !(existing instanceof TFolder)) {
			return;
		}
		await this.actionService.execute({
			type: "delete",
			targetType: existing instanceof TFolder
				? "folder"
				: targetPath.toLowerCase().endsWith(".canvas")
					? "canvas"
					: "markdown",
			path: targetPath,
		}, agentId);
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

		const result = await this.commandExecService.exec(command, cmdArgs, { cwd, agentMode: this.activeAgentMode });
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
		const activeSoulId = this.getSettings().activeSoulId;
		if (!activeSoulId) {
			return null;
		}
		await this.toolDelete({ path: normalizedTarget }, activeSoulId);
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

	private validateMutationApplyPath(targetPath: string): true | string {
		try {
			this.assertAgentWritableVaultPath(targetPath);
			return true;
		} catch (error) {
			return error instanceof Error ? error.message : String(error ?? "Mutation path is not writable.");
		}
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
			use_skill: ["command"],
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
		if (name === "memory") {
			const scope = this.getStringArg(args, "scope");
			const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
			if (scope === "project" && activeProjectRoot) {
				return this.memoryStore.resolvePath("project", activeProjectRoot);
			}
			if (scope === "global") {
				return this.memoryStore.resolvePath("global");
			}
			return scope || "";
		}
		if (name === "ls" || name === "grep" || name === "search_text" || name === "glob") {
			return this.resolveDefaultVaultSearchPath("");
		}
		return "";
	}

	private resolveDefaultVaultSearchPath(rawPath: string | undefined): string {
		const normalized = this.normalizeVaultRootSearchPath(rawPath);
		if (normalized) {
			return normalized;
		}
		const activeProjectRoot = this.projectBoundaryService.getActiveProjectRoot();
		return this.normalizeVaultRootSearchPath(activeProjectRoot);
	}

	private normalizeVaultRootSearchPath(rawPath: string | undefined): string {
		const normalized = normalizePath(rawPath || "");
		return normalized === "/" ? "" : normalized;
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
				path: this.normalizeVaultRootSearchPath(activeProjectRoot),
			};
		}
		return args;
	}

	private resolveScope(pathValue: string): ToolApprovalScope {
		if (!pathValue) return "vault";
		return path.isAbsolute(pathValue) ? "external" : "vault";
	}

	private listVault(targetPath: string, recursive: boolean, maxEntries: number): string[] {
		const normalizedTargetPath = this.normalizeVaultRootSearchPath(targetPath);
		const allFiles = this.vault.getAllLoadedFiles();
		const scoped = allFiles
			.filter((item) => {
				if (!normalizedTargetPath) return true;
				return item.path === normalizedTargetPath || item.path.startsWith(`${normalizedTargetPath}/`);
			})
			.filter((item) => normalizedTargetPath || item.path.includes("/"));

		const entries = scoped
			.filter((item) => {
				if (!normalizedTargetPath) {
					return item.path.split("/").length === 2 || recursive;
				}
				if (recursive) return true;
				const depth = item.path.split("/").length - normalizedTargetPath.split("/").length;
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
		if (!basePath || basePath === "/") return true;
		const normalizedBasePath = this.normalizeVaultRootSearchPath(basePath);
		if (!normalizedBasePath) return true;
		return candidatePath === normalizedBasePath || candidatePath.startsWith(`${normalizedBasePath}/`);
	}

	private formatToolResultForModel(payload: RuntimeToolResultPayload): string {
		if (payload.tool === "use_skill" && payload.ok) {
			const data = payload.data as { command?: string; summary?: string } | undefined;
			const summary = data?.summary?.trim() || `Loaded skill ${data?.command ?? ""}`.trim();
			return `TOOL_RESULT ${JSON.stringify({ ok: true, tool: "use_skill", data: { command: data?.command, summary } })}`;
		}
		if (payload.tool === "memory" && payload.data && typeof payload.data === "object") {
			const data = payload.data as { ok?: boolean; scope?: string; summary?: string; code?: string; reason?: string };
			return `TOOL_RESULT ${JSON.stringify({
				ok: Boolean(data.ok),
				tool: "memory",
				data: {
					scope: data.scope,
					summary: data.summary,
					code: data.code,
					reason: data.reason,
				},
			})}`;
		}
		const compact = this.safeStringify(payload, MAX_MODEL_RESULT_CHARS);
		return `TOOL_RESULT ${compact}`;
	}

	private buildSummaryFromData(tool: string, data: unknown): string {
		if (tool === "use_skill") {
			const payload = data as { command?: string; summary?: string } | undefined;
			return payload?.summary?.trim() || `Loaded skill ${payload?.command ?? ""}`.trim();
		}
		if (tool === "read") {
			const payload = data as { path?: string; truncated?: boolean };
			return `Read ${payload.path ?? ""}${payload.truncated ? " (truncated)" : ""}`.trim();
		}
		if (tool === "memory") {
			const payload = data as { summary?: string } | undefined;
			return payload?.summary?.trim() || "Memory updated";
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
				projectId?: string;
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
			return `Wiki compile ${payload.projectId ?? ""} (requested ${payload.requested ?? 0}, processed ${payload.processed ?? 0}, success ${payload.succeeded ?? 0}, failed ${payload.failed ?? 0}, docs ${updatedDocs}, ${indexState}, ${logState})`.trim();
		}
		if (tool === "write") {
			const payload = data as { path?: string; status?: string };
			return `${payload.status === "pending_review" ? "Write planned" : "Write completed"} ${payload.path ?? ""}`.trim();
		}
		if (tool === "delete") {
			const payload = data as { path?: string; deletedType?: string; status?: string };
			const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
			return `${payload.status === "pending_review" ? "Delete planned" : "Delete completed"} ${targetLabel} ${payload.path ?? ""}`.trim();
		}
		if (tool === "edit") {
			const payload = data as { path?: string; appliedEdits?: number; status?: string };
			const verb = payload.status === "pending_review" ? "Edit planned" : "Edited";
			return `${verb} ${payload.path ?? ""} (${payload.appliedEdits ?? 0} replacement(s))`.trim();
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

	private extractLoadedSkillSystemContext(payload: RuntimeToolResultPayload): string {
		if (!payload.ok || payload.tool !== "use_skill" || !payload.data || typeof payload.data !== "object") {
			return "";
		}
		const systemContext = (payload.data as { systemContext?: unknown }).systemContext;
		return typeof systemContext === "string" ? systemContext.trim() : "";
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
				approved: trace.approved,
				approvalReason: trace.approvalReason,
				persistedRule: trace.persistedRule,
				viaRule: trace.viaRule,
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

	private resolveAgentMode(input: RuntimeTurnInput): AgentMode {
		return input.agentMode ?? "ask";
	}

	private shouldExposeExecTool(
		settings: FridaySettings,
		allowedTools: Set<string> | null,
		agentMode: AgentMode,
	): boolean {
		if (!settings.agentRuntime.enableExecTool) {
			return false;
		}
		if (agentMode !== "debug" && agentMode !== "developer") {
			return false;
		}
		if (!this.activeRuntimeProfile.capabilities.supportsExecTool) {
			return false;
		}
		return !allowedTools || allowedTools.size === 0 || allowedTools.has("exec");
	}

	private resolvePolicyWorkspaceRoot(): string {
		const activeProject = this.projectBoundaryService.getActiveProject();
		const service = this.projectBoundaryService as ProjectBoundaryService & {
			getProjectAbsolutePath?: (project: ReturnType<ProjectBoundaryService["getActiveProject"]>) => string;
		};
		if (typeof service.getProjectAbsolutePath !== "function") {
			return "";
		}
		return service.getProjectAbsolutePath(activeProject);
	}

	private classifyPolicyDeny(code: string | undefined): ToolFailureClass {
		if (code === "tool_not_allowed" || code === "tool_unknown" || code === "tool_disabled") {
			return "invalid_input";
		}
		if (code === "external_read_unsupported") {
			return "dependency_unavailable";
		}
		return "dependency_unavailable";
	}

	private buildNativeToolDefinitions(
		settings: FridaySettings,
		allowedTools: Set<string> | null,
		agentMode: AgentMode = "ask",
	): ToolDefinition[] {
		const registryDisabledTools = this.buildDisabledToolSet();
		return buildNativeToolDefinitionsFromRegistry({
			agentMode,
			enableExecTool: this.shouldExposeExecTool(settings, allowedTools, agentMode),
			disabledTools: registryDisabledTools,
			allowedTools,
		});
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

