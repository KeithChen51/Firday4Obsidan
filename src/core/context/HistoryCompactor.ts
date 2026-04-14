export interface HistoryMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
}

export interface HistoryCompactionOptions {
	maxMessages?: number;
	maxCharsPerMessage?: number;
	maxTotalChars?: number;
	preserveRecent?: boolean;
}

export interface HistoryCompactionResult {
	messages: HistoryMessage[];
	usedChars: number;
	droppedMessages: number;
	truncatedMessages: number;
}

export class HistoryCompactor {
	compact(messages: HistoryMessage[], options: HistoryCompactionOptions = {}): HistoryCompactionResult {
		const selectedCount = options.maxMessages ?? messages.length ?? 1;
		const maxMessages = Math.max(1, selectedCount);
		const maxCharsPerMessage = Math.max(8, options.maxCharsPerMessage ?? 1800);
		const preserveRecent = options.preserveRecent ?? true;
		const selected = preserveRecent ? messages.slice(-maxMessages) : messages.slice(0, maxMessages);

		let truncatedMessages = 0;
		const normalized = selected.map((message) => {
			const content = this.truncateText(message.content, maxCharsPerMessage);
			if (content !== message.content) {
				truncatedMessages += 1;
			}
			return {
				role: message.role,
				content,
			};
		});

		const limited = this.applyTotalBudget(normalized, options.maxTotalChars, preserveRecent);
		const usedChars = limited.reduce((sum, item) => sum + item.content.length, 0);
		return {
			messages: limited,
			usedChars,
			droppedMessages: Math.max(0, messages.length - limited.length),
			truncatedMessages,
		};
	}

	private applyTotalBudget(
		messages: HistoryMessage[],
		maxTotalChars: number | undefined,
		preserveRecent: boolean,
	): HistoryMessage[] {
		if (!maxTotalChars || maxTotalChars <= 0) {
			return messages;
		}
		const limited: HistoryMessage[] = [];
		let consumed = 0;
		const iterate = preserveRecent ? [...messages].reverse() : messages;
		for (const message of iterate) {
			const nextLength = message.content.length;
			if (consumed + nextLength > maxTotalChars) {
				if (!preserveRecent) {
					break;
				}
				continue;
			}
			if (preserveRecent) {
				limited.unshift(message);
			} else {
				limited.push(message);
			}
			consumed += nextLength;
		}
		return limited;
	}

	private truncateText(text: string, maxChars: number): string {
		if (text.length <= maxChars) {
			return text;
		}
		if (maxChars <= 3) {
			return text.slice(0, maxChars);
		}
		return `${text.slice(0, maxChars)}...`;
	}
}
