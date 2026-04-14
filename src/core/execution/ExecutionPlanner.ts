import type { ExecutionDecision } from "./ExecutionDecision";
import type { InvocationResolution } from "./InvocationResolver";

export class ExecutionPlanner {
	plan(resolution: Extract<InvocationResolution, { type: "runtime" }>): ExecutionDecision {
		return {
			mode: resolution.requestedSkillName ? "runtime_with_skill_context" : "runtime_prompt",
			invocation: resolution.invocation,
			runtimePrompt: resolution.runtimePrompt,
			requestedSkillName: resolution.requestedSkillName,
			allowedTools: resolution.allowedTools,
			allowedModels: resolution.allowedModels,
		};
	}
}
