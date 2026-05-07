import type { ExecutionDecision } from "./ExecutionDecision";
import type { InvocationResolution } from "./InvocationResolver";
import type { ActiveFileContext } from "../context/ActiveFileContext";

export interface ExecutionPlannerPlanOptions {
	activeFileContext?: ActiveFileContext;
}

export class ExecutionPlanner {
	async plan(
		resolution: Extract<InvocationResolution, { type: "runtime" }>,
		_options: ExecutionPlannerPlanOptions = {},
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

		return {
			mode: "runtime_prompt",
			invocation: resolution.invocation,
			runtimePrompt: resolution.runtimePrompt,
			allowedTools: resolution.allowedTools,
			allowedModels: resolution.allowedModels,
		};
	}
}
