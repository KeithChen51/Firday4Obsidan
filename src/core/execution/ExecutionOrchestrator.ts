import type { ChatMessage } from "../../services/AIService";
import type {
	AgentRuntimeFacade,
	RuntimeProgressEvent,
	RuntimeTurnResult,
} from "../agent-kernel/AgentKernel";
import type { SkillCommandService } from "../../services/SkillCommandService";
import type { ExecutionDecision } from "./ExecutionDecision";
import type { PromptMentionContext } from "../context/PromptContextEngine";
import type { ActiveFileContext } from "../context/ActiveFileContext";

export interface ExecutionOrchestratorRunOptions {
	agentId: string;
	conversationId?: string;
	conversation: ChatMessage[];
	modelOverride?: string;
	activeFileContext?: ActiveFileContext;
	extraSystemContext?: string;
	mentionContext?: PromptMentionContext;
	allowedTools?: string[];
	onProgress?: (event: RuntimeProgressEvent) => void;
	signal?: AbortSignal;
}

export class ExecutionOrchestrator {
	constructor(
		private readonly skillCommandService: SkillCommandService,
		private readonly agentRuntimeFacade: AgentRuntimeFacade,
	) {}

	async execute(
		decision: ExecutionDecision,
		options: ExecutionOrchestratorRunOptions,
	): Promise<RuntimeTurnResult> {
		const extraSystemContext = await this.buildSystemContext(
			decision,
			options.extraSystemContext,
			options.activeFileContext,
		);

		return this.agentRuntimeFacade.runTurn({
			agentId: options.agentId,
			conversationId: options.conversationId,
			conversation: options.conversation,
			userPrompt: decision.runtimePrompt,
			modelOverride: options.modelOverride,
			activeFileContext: options.activeFileContext,
			extraSystemContext,
			mentionContext: options.mentionContext,
			allowedTools: decision.allowedTools?.length ? decision.allowedTools : options.allowedTools,
			onProgress: options.onProgress,
			signal: options.signal,
		});
	}

	async buildSystemContext(
		decision: ExecutionDecision,
		baseSystemContext = "",
		activeFileContext?: ActiveFileContext,
	): Promise<string> {
		let extraSystemContext = baseSystemContext.trim();
		if (decision.mode === "runtime_with_skill_context" && decision.requestedSkillName) {
			const skillContext = await this.skillCommandService.buildSkillSystemContext(decision.requestedSkillName, {
				invocationMode: decision.skillInvocationMode ?? "manual",
				selectionReason: decision.selectionReason,
			});
			extraSystemContext = extraSystemContext
				? `${skillContext.systemContext}\n\n${extraSystemContext}`
				: skillContext.systemContext;
		} else {
			const skillCatalogContext = await this.skillCommandService.buildSkillCatalogContext({ activeFileContext });
			extraSystemContext = extraSystemContext
				? `${skillCatalogContext}\n\n${extraSystemContext}`
				: skillCatalogContext;
		}
		return extraSystemContext;
	}
}
