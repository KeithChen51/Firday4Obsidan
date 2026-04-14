import { PolicyDecision, PolicyEffect, PolicyRule, ScopeLevel } from "./types";

export interface PolicyMatrixRow {
	tool: string;
	action: string;
	globalEffect: PolicyEffect;
	projectEffect: PolicyEffect | null;
	sessionEffect: PolicyEffect | null;
	effectiveEffect: PolicyEffect;
	effectiveSource: ScopeLevel;
	matchedRules: PolicyRule[];
}

export interface PolicyMatrixInput {
	tools: string[];
	globalRules: PolicyRule[];
	projectRules: PolicyRule[];
	sessionOverrides: Record<string, PolicyEffect>;
}

const DEFAULT_EFFECT: PolicyEffect = "ask";

export function buildPolicyMatrix(input: PolicyMatrixInput): PolicyMatrixRow[] {
	return input.tools.map((tool) => {
		const action = `tool:${tool}`;
		const globalMatched = matchRule(input.globalRules, action);
		const projectMatched = matchRule(input.projectRules, action);
		const sessionEffect = input.sessionOverrides[action] ?? null;
		const decision = resolvePolicyDecision(action, globalMatched, projectMatched, sessionEffect);
		return {
			tool,
			action,
			globalEffect: globalMatched?.effect ?? DEFAULT_EFFECT,
			projectEffect: projectMatched?.effect ?? null,
			sessionEffect,
			effectiveEffect: decision.effectiveEffect,
			effectiveSource: decision.source,
			matchedRules: decision.matchedRules,
		};
	});
}

function resolvePolicyDecision(
	action: string,
	globalMatched: PolicyRule | null,
	projectMatched: PolicyRule | null,
	sessionEffect: PolicyEffect | null,
): PolicyDecision {
	if (sessionEffect) {
		return {
			action,
			effectiveEffect: sessionEffect,
			source: "session",
			matchedRules: [{ action, effect: sessionEffect, source: "session" }],
		};
	}
	if (projectMatched) {
		return {
			action,
			effectiveEffect: projectMatched.effect,
			source: "project",
			matchedRules: [projectMatched, ...(globalMatched ? [globalMatched] : [])],
		};
	}
	if (globalMatched) {
		return {
			action,
			effectiveEffect: globalMatched.effect,
			source: "global",
			matchedRules: [globalMatched],
		};
	}
	return {
		action,
		effectiveEffect: DEFAULT_EFFECT,
		source: "global",
		matchedRules: [],
	};
}

function matchRule(rules: PolicyRule[], action: string): PolicyRule | null {
	for (const rule of rules) {
		const candidate = rule.action.trim();
		if (!candidate) {
			continue;
		}
		if (candidate === action || candidate === "*") {
			return rule;
		}
		if (candidate.endsWith("*") && action.startsWith(candidate.slice(0, -1))) {
			return rule;
		}
	}
	return null;
}
