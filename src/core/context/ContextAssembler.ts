import { ContextInputEnvelope } from "./ContextInputEnvelope";
import { SemanticCompactor } from "./SemanticCompactor";
import { ApproximateTokenCounter, TokenBudget, type TokenCounter } from "./TokenBudget";

export interface ContextAssemblerResult {
	text: string;
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
	overflowChannels: string[];
}

const TRIM_ORDER = ["attachments", "history", "secondary_context", "mentions"] as const;
const PROTECTED_OVERFLOW_ORDER = ["system", "policy", "user_query"] as const;

type TrimmableKey = (typeof TRIM_ORDER)[number];
type ProtectedKey = (typeof PROTECTED_OVERFLOW_ORDER)[number];
type ContextChannelKey = TrimmableKey | ProtectedKey;

export class ContextAssembler {
	private readonly compactor = new SemanticCompactor();

	constructor(private readonly tokenCounter: TokenCounter = new ApproximateTokenCounter()) {}

	assemble(input: ContextInputEnvelope): ContextAssemblerResult {
		const budget = Math.max(64, input.hardLimit ?? 1200);
		const tokenBudget = new TokenBudget({
			maxTokens: budget,
			counter: this.tokenCounter,
		});
		const softLimit = tokenBudget.softLimit;
		const hardLimit = tokenBudget.hardLimit;

		const channels: Record<string, string> = {
			system: input.system?.trim() ?? "",
			policy: input.policy?.trim() ?? "",
			user_query: input.userQuery.trim(),
			mentions: input.mentions?.trim() ?? "",
			history: input.history?.trim() ?? "",
			attachments: input.attachments?.trim() ?? "",
			secondary_context: input.secondaryContext?.trim() ?? "",
		};

		const trimmedChannels: string[] = [];
		const overflowChannels: string[] = [];
		let text = this.joinChannels(channels);
		let used = tokenBudget.measure(text).used;
		if (used <= softLimit) {
			return {
				text,
				used,
				softLimit,
				hardLimit,
				trimmedChannels,
				overflowChannels,
			};
		}

		for (const key of TRIM_ORDER) {
			if (!channels[key]) {
				continue;
			}
			channels[key] = this.compactChannel(channels[key], hardLimit, key);
			trimmedChannels.push(key);
			text = this.joinChannels(channels);
			used = tokenBudget.measure(text).used;
			if (used <= softLimit) {
				break;
			}
			channels[key] = "";
			text = this.joinChannels(channels);
			used = tokenBudget.measure(text).used;
			if (used <= softLimit) {
				break;
			}
		}

		used = tokenBudget.measure(text).used;
		if (used > hardLimit) {
			text = this.fitProtectedChannels(channels, hardLimit, overflowChannels);
			used = tokenBudget.measure(text).used;
		}

		return {
			text,
			used,
			softLimit,
			hardLimit,
			trimmedChannels,
			overflowChannels,
		};
	}

	private compactChannel(value: string, hardLimit: number, key: TrimmableKey): string {
		const targetTokens = Math.max(8, Math.floor(hardLimit * (key === "attachments" ? 0.12 : 0.18)));
		const target = Math.max(32, targetTokens * 4);
		return this.compactor.compact(value, target);
	}

	private fitProtectedChannels(
		channels: Record<string, string>,
		hardLimit: number,
		overflowChannels: string[],
	): string {
		const next = { ...channels };
		for (const key of PROTECTED_OVERFLOW_ORDER) {
			const text = this.joinChannels(next);
			if (this.tokenCounter.count(text) <= hardLimit) {
				return text;
			}
			if (!next[key]) {
				continue;
			}
			this.pushUnique(overflowChannels, key);
			next[key] = this.truncateChannelToFit(next, key, hardLimit);
		}
		return this.joinChannels(next);
	}

	private truncateChannelToFit(
		channels: Record<string, string>,
		key: ProtectedKey,
		hardLimit: number,
	): string {
		const original = channels[key] ?? "";
		const marker = `[context_overflow: ${key} truncated]`;
		const withCandidate = (candidate: string) => ({
			...channels,
			[key]: candidate,
		});
		if (this.tokenCounter.count(this.joinChannels(withCandidate(original))) <= hardLimit) {
			return original;
		}
		let low = 0;
		let high = original.length;
		let best = marker;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const prefix = original.slice(0, mid).trimEnd();
			const candidate = prefix ? `${prefix}\n${marker}` : marker;
			if (this.tokenCounter.count(this.joinChannels(withCandidate(candidate))) <= hardLimit) {
				best = candidate;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return best;
	}

	private pushUnique(values: string[], value: ContextChannelKey): void {
		if (!values.includes(value)) {
			values.push(value);
		}
	}

	private joinChannels(channels: Record<string, string>): string {
		const lines: string[] = [];
		const orderedKeys = ["system", "policy", "user_query", "mentions", "history", "attachments", "secondary_context"];
		for (const key of orderedKeys) {
			const value = channels[key];
			if (!value) {
				continue;
			}
			lines.push(`[${key}]`);
			lines.push(value);
			lines.push("");
		}
		return lines.join("\n").trim();
	}
}
