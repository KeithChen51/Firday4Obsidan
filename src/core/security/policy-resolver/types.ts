export type ScopeLevel = "session" | "project" | "global";
export type PolicyEffect = "allow" | "ask" | "deny";

export interface PolicyRule {
	action: string;
	effect: PolicyEffect;
	source: ScopeLevel;
}

export interface PolicyDecision {
	action: string;
	effectiveEffect: PolicyEffect;
	source: ScopeLevel;
	matchedRules: PolicyRule[];
}
