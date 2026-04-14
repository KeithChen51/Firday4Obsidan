import type { ChatMessage } from "../../services/AIService";
import type {
	AgentRuntimeService,
	RuntimeProgressEvent,
	RuntimeTurnResult,
} from "../../services/AgentRuntimeService";
import type { SkillCommandService } from "../../services/SkillCommandService";
import type { ExecutionDecision } from "./ExecutionDecision";

export interface ExecutionOrchestratorRunOptions {
	agentId: string;
	conversation: ChatMessage[];
	modelOverride?: string;
	currentFilePath?: string;
	extraSystemContext?: string;
	allowedTools?: string[];
	onProgress?: (event: RuntimeProgressEvent) => void;
}

export class ExecutionOrchestrator {
	constructor(
		private readonly skillCommandService: SkillCommandService,
		private readonly agentRuntimeService: AgentRuntimeService,
	) {}

	async execute(
		decision: ExecutionDecision,
		options: ExecutionOrchestratorRunOptions,
	): Promise<RuntimeTurnResult> {
		const extraSystemContext = await this.buildSystemContext(decision, options.extraSystemContext);

		return this.agentRuntimeService.runTurn({
			agentId: options.agentId,
			conversation: options.conversation,
			userPrompt: decision.runtimePrompt,
			modelOverride: options.modelOverride,
			currentFilePath: options.currentFilePath,
			extraSystemContext,
			allowedTools: decision.allowedTools?.length ? decision.allowedTools : options.allowedTools,
			onProgress: options.onProgress,
		});
	}

	async buildSystemContext(decision: ExecutionDecision, baseSystemContext = ""): Promise<string> {
		let extraSystemContext = baseSystemContext.trim();
		if (decision.mode === "runtime_with_skill_context" && decision.requestedSkillName) {
			const skillContext = await this.skillCommandService.buildSkillSystemContext(decision.requestedSkillName, {
				invocationMode: decision.skillInvocationMode ?? "manual",
				selectionReason: decision.selectionReason,
			});
			extraSystemContext = extraSystemContext
				? `${skillContext.systemContext}\n\n${extraSystemContext}`
				: skillContext.systemContext;
		}
		return extraSystemContext;
	}
}
