import type { ResolvedInvocation } from "./ResolvedInvocation";

export type ExecutionDecisionMode = "runtime_prompt" | "runtime_with_skill_context";

export interface ExecutionDecision {
	mode: ExecutionDecisionMode;
	invocation: ResolvedInvocation;
	runtimePrompt: string;
	requestedSkillName?: string;
	allowedTools?: string[];
	allowedModels?: string[];
}
