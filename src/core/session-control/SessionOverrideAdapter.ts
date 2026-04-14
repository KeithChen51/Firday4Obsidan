import { PolicyEffect } from "../security/policy-resolver/types";

export class SessionOverrideAdapter {
	private readonly overrides = new Map<string, PolicyEffect>();

	setOverride(action: string, effect: PolicyEffect): void {
		const normalized = action.trim();
		if (!normalized) {
			return;
		}
		this.overrides.set(normalized, effect);
	}

	clearOverride(action: string): void {
		const normalized = action.trim();
		if (!normalized) {
			return;
		}
		this.overrides.delete(normalized);
	}

	clearAll(): void {
		this.overrides.clear();
	}

	getOverride(action: string): PolicyEffect | null {
		const normalized = action.trim();
		if (!normalized) {
			return null;
		}
		return this.overrides.get(normalized) ?? null;
	}

	listOverrides(): Record<string, PolicyEffect> {
		return Object.fromEntries(this.overrides.entries());
	}
}
