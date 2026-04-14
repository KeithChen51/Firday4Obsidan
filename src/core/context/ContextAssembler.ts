import { ContextInputEnvelope } from "./ContextInputEnvelope";
import { SemanticCompactor } from "./SemanticCompactor";

export interface ContextAssemblerResult {
	text: string;
	used: number;
	softLimit: number;
	hardLimit: number;
	trimmedChannels: string[];
}

const SOFT_RATIO = 0.55;
const HARD_RATIO = 0.70;
const TRIM_ORDER = ["attachments", "history", "secondary_context"] as const;

type TrimmableKey = (typeof TRIM_ORDER)[number];

export class ContextAssembler {
	private readonly compactor = new SemanticCompactor();

	assemble(input: ContextInputEnvelope): ContextAssemblerResult {
		const budget = Math.max(64, input.hardLimit ?? 1200);
		const softLimit = Math.floor(budget * SOFT_RATIO);
		const hardLimit = Math.floor(budget * HARD_RATIO);

		const channels: Record<string, string> = {
			system: input.system?.trim() ?? "",
			policy: input.policy?.trim() ?? "",
			user_query: input.userQuery.trim(),
			history: input.history?.trim() ?? "",
			attachments: input.attachments?.trim() ?? "",
			secondary_context: input.secondaryContext?.trim() ?? "",
		};

		const trimmedChannels: string[] = [];
		let text = this.joinChannels(channels);
		if (text.length <= hardLimit) {
			return {
				text,
				used: text.length,
				softLimit,
				hardLimit,
				trimmedChannels,
			};
		}

		for (const key of TRIM_ORDER) {
			if (!channels[key]) {
				continue;
			}
			channels[key] = this.compactChannel(channels[key], hardLimit, key);
			trimmedChannels.push(key);
			text = this.joinChannels(channels);
			if (text.length <= hardLimit) {
				break;
			}
			channels[key] = "";
			text = this.joinChannels(channels);
			if (text.length <= hardLimit) {
				break;
			}
		}

		if (text.length > hardLimit) {
			text = `${text.slice(0, Math.max(0, hardLimit - 3))}...`;
		}

		return {
			text,
			used: text.length,
			softLimit,
			hardLimit,
			trimmedChannels,
		};
	}

	private compactChannel(value: string, hardLimit: number, key: TrimmableKey): string {
		const target = Math.max(32, Math.floor(hardLimit * (key === "attachments" ? 0.12 : 0.18)));
		return this.compactor.compact(value, target);
	}

	private joinChannels(channels: Record<string, string>): string {
		const lines: string[] = [];
		const orderedKeys = ["system", "policy", "user_query", "history", "attachments", "secondary_context"];
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
