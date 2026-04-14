import type { ResolvedInvocation } from "./ResolvedInvocation";

export type ExecutionDecisionMode = "runtime_prompt" | "runtime_with_skill_context";
export type ExecutionDecisionSkillMode = "manual" | "auto";

export interface ExecutionDecision {
	mode: ExecutionDecisionMode;
	invocation: ResolvedInvocation;
	runtimePrompt: string;
	requestedSkillName?: string;
	skillInvocationMode?: ExecutionDecisionSkillMode;
	selectionReason?: string;
	allowedTools?: string[];
	allowedModels?: string[];
}
