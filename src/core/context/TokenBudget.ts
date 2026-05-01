export interface TokenCounter {
	count(text: string): number;
}

export interface TokenBudgetOptions {
	maxTokens: number;
	softRatio?: number;
	hardRatio?: number;
	counter?: TokenCounter;
}

export interface TokenBudgetMeasurement {
	used: number;
	softLimit: number;
	hardLimit: number;
	maxTokens: number;
	overSoft: boolean;
	overHard: boolean;
}

const DEFAULT_SOFT_RATIO = 0.55;
const DEFAULT_HARD_RATIO = 0.70;

export class ApproximateTokenCounter implements TokenCounter {
	count(text: string): number {
		const value = String(text ?? "");
		if (!value) {
			return 0;
		}
		let cjkChars = 0;
		let otherChars = 0;
		for (const char of Array.from(value)) {
			if (this.isCjk(char)) {
				cjkChars += 1;
			} else {
				otherChars += 1;
			}
		}
		return Math.ceil(otherChars / 4) + Math.ceil(cjkChars / 1.6);
	}

	private isCjk(char: string): boolean {
		const codePoint = char.codePointAt(0) ?? 0;
		return (
			(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
			(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
			(codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
			(codePoint >= 0x2a700 && codePoint <= 0x2b73f) ||
			(codePoint >= 0x2b740 && codePoint <= 0x2b81f) ||
			(codePoint >= 0x2b820 && codePoint <= 0x2ceaf) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff)
		);
	}
}

export class TokenBudget {
	readonly maxTokens: number;
	readonly softLimit: number;
	readonly hardLimit: number;
	readonly counter: TokenCounter;

	constructor(options: TokenBudgetOptions) {
		const maxTokens = Math.max(1, Math.floor(options.maxTokens));
		const softRatio = options.softRatio ?? DEFAULT_SOFT_RATIO;
		const hardRatio = options.hardRatio ?? DEFAULT_HARD_RATIO;
		this.maxTokens = maxTokens;
		this.softLimit = Math.max(1, Math.floor(maxTokens * softRatio));
		this.hardLimit = Math.max(this.softLimit, Math.floor(maxTokens * hardRatio));
		this.counter = options.counter ?? new ApproximateTokenCounter();
	}

	measure(text: string): TokenBudgetMeasurement {
		const used = this.counter.count(text);
		return {
			used,
			softLimit: this.softLimit,
			hardLimit: this.hardLimit,
			maxTokens: this.maxTokens,
			overSoft: used > this.softLimit,
			overHard: used > this.hardLimit,
		};
	}
}
