import { SessionOverrideAdapter } from "../../session-control/SessionOverrideAdapter";
import { PolicyDecision, PolicyEffect, PolicyRule } from "./types";

interface PolicyResolverOptions {
	globalRules: PolicyRule[];
	projectRules: PolicyRule[];
	sessionOverrideAdapter: SessionOverrideAdapter;
}

const DEFAULT_POLICY_EFFECT: PolicyEffect = "ask";

export class PolicyResolverCore {
	constructor(private readonly options: PolicyResolverOptions) {}

	resolve(action: string): PolicyDecision {
		const normalizedAction = action.trim();
		const matchedRules: PolicyRule[] = [];

		const sessionEffect = this.options.sessionOverrideAdapter.getOverride(normalizedAction);
		if (sessionEffect) {
			const sessionRule: PolicyRule = {
				action: normalizedAction,
				effect: sessionEffect,
				source: "session",
			};
			matchedRules.push(sessionRule);
			return {
				action: normalizedAction,
				effectiveEffect: sessionEffect,
				source: "session",
				matchedRules,
			};
		}

		const projectMatched = this.filterActionRules(this.options.projectRules, normalizedAction);
		const globalMatched = this.filterActionRules(this.options.globalRules, normalizedAction);
		matchedRules.push(...projectMatched, ...globalMatched);

		const effective = matchedRules[0];
		if (effective) {
			return {
				action: normalizedAction,
				effectiveEffect: effective.effect,
				source: effective.source,
				matchedRules,
			};
		}

		return {
			action: normalizedAction,
			effectiveEffect: DEFAULT_POLICY_EFFECT,
			source: "global",
			matchedRules: [],
		};
	}

	private filterActionRules(rules: PolicyRule[], action: string): PolicyRule[] {
		return rules
			.filter((rule) => {
				const normalizedRuleAction = rule.action.trim();
				if (!normalizedRuleAction) {
					return false;
				}
				if (normalizedRuleAction === "*") {
					return true;
				}
				if (normalizedRuleAction === action) {
					return true;
				}
				if (normalizedRuleAction.endsWith("*")) {
					const prefix = normalizedRuleAction.slice(0, -1);
					return prefix.length > 0 && action.startsWith(prefix);
				}
				return false;
			});
	}
}
