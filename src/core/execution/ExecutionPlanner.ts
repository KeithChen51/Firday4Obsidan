import type { ExecutionDecision } from "./ExecutionDecision";
import type { InvocationResolution } from "./InvocationResolver";
import type { SuggestedSkill } from "../../services/SkillCommandService";

export interface ExecutionPlannerPlanOptions {
	currentFilePath?: string;
}

interface ExecutionPlannerDeps {
	suggestSkillsForPrompt: (prompt: string, currentFilePath?: string) => Promise<SuggestedSkill[]>;
}

const MIN_AUTO_SKILL_SCORE = 8;
const MIN_AUTO_SKILL_LEAD = 3;

export class ExecutionPlanner {
	constructor(private readonly deps: ExecutionPlannerDeps) {}

	async plan(
		resolution: Extract<InvocationResolution, { type: "runtime" }>,
		options: ExecutionPlannerPlanOptions = {},
	): Promise<ExecutionDecision> {
		if (resolution.requestedSkillName) {
			return {
				mode: "runtime_with_skill_context",
				invocation: resolution.invocation,
				runtimePrompt: resolution.runtimePrompt,
				requestedSkillName: resolution.requestedSkillName,
				skillInvocationMode: "manual",
				allowedTools: resolution.allowedTools,
				allowedModels: resolution.allowedModels,
			};
		}

		const autoSkill = await this.selectAutoSkill(resolution.runtimePrompt, options.currentFilePath);
		const requestedSkillName = autoSkill?.skill.command;
		return {
			mode: requestedSkillName ? "runtime_with_skill_context" : "runtime_prompt",
			invocation: resolution.invocation,
			runtimePrompt: resolution.runtimePrompt,
			requestedSkillName,
			skillInvocationMode: requestedSkillName ? "auto" : undefined,
			selectionReason: autoSkill?.reasons.join("; ") || undefined,
			allowedTools: resolution.allowedTools,
			allowedModels: resolution.allowedModels,
		};
	}

	private async selectAutoSkill(prompt: string, currentFilePath?: string): Promise<SuggestedSkill | null> {
		const suggestions = await this.deps.suggestSkillsForPrompt(prompt, currentFilePath);
		if (suggestions.length === 0) {
			return null;
		}
		const [top, second] = suggestions;
		if (!top || top.score < MIN_AUTO_SKILL_SCORE) {
			return null;
		}
		if (second && top.score - second.score < MIN_AUTO_SKILL_LEAD) {
			return null;
		}
		return top;
	}
}
