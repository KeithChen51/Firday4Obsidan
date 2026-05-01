import { ApproximateTokenCounter, type TokenCounter } from "./TokenBudget";

export interface ToolBoundaryToolCall {
	id?: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ToolBoundaryMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	toolCallId?: string;
	name?: string;
	toolCalls?: ToolBoundaryToolCall[];
}

export type ToolBoundaryRepairReason =
	| "orphan_tool_result"
	| "duplicate_tool_result"
	| "dangling_tool_call"
	| "trimmed_tool_result";

export interface ToolBoundaryRepair {
	reason: ToolBoundaryRepairReason;
	toolCallId?: string;
	tool?: string;
	index: number;
}

export interface ToolBoundaryFilterOptions {
	maxToolResultTokens?: number;
	counter?: TokenCounter;
}

export interface ToolBoundaryFilterResult<T extends ToolBoundaryMessage = ToolBoundaryMessage> {
	messages: T[];
	repairs: ToolBoundaryRepair[];
}

export class ToolBoundaryFilter {
	repair<T extends ToolBoundaryMessage>(
		messages: T[],
		options: ToolBoundaryFilterOptions = {},
	): ToolBoundaryFilterResult<T> {
		const repairs: ToolBoundaryRepair[] = [];
		const output: ToolBoundaryMessage[] = [];
		const seenToolResults = new Set<string>();
		const pendingToolCalls = new Set<string>();
		const counter = options.counter ?? new ApproximateTokenCounter();
		let activeAssistantOutputIndex = -1;

		const clearDanglingToolCalls = (sourceIndex: number) => {
			if (activeAssistantOutputIndex < 0 || pendingToolCalls.size === 0) {
				return;
			}
			const assistant = output[activeAssistantOutputIndex];
			if (!assistant) {
				pendingToolCalls.clear();
				activeAssistantOutputIndex = -1;
				return;
			}
			const remaining = (assistant.toolCalls ?? []).filter((toolCall) =>
				!toolCall.id || !pendingToolCalls.has(toolCall.id)
			);
			if (remaining.length > 0) {
				assistant.toolCalls = remaining;
			} else {
				delete assistant.toolCalls;
			}
			for (const toolCallId of pendingToolCalls) {
				repairs.push({
					reason: "dangling_tool_call",
					toolCallId,
					index: sourceIndex,
				});
			}
			pendingToolCalls.clear();
			activeAssistantOutputIndex = -1;
		};

		for (let index = 0; index < messages.length; index += 1) {
			const sourceMessage = messages[index];
			if (!sourceMessage) {
				continue;
			}
			const message = this.cloneMessage(sourceMessage);
			if (message.role === "assistant") {
				clearDanglingToolCalls(index);
				output.push(message);
				if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
					activeAssistantOutputIndex = output.length - 1;
					for (const toolCall of message.toolCalls) {
						if (toolCall.id) {
							pendingToolCalls.add(toolCall.id);
						}
					}
				}
				continue;
			}

			if (message.role === "tool") {
				const toolCallId = message.toolCallId;
				if (!toolCallId || !pendingToolCalls.has(toolCallId)) {
					repairs.push({
						reason: toolCallId && seenToolResults.has(toolCallId) ? "duplicate_tool_result" : "orphan_tool_result",
						toolCallId,
						tool: message.name,
						index,
					});
					continue;
				}
				pendingToolCalls.delete(toolCallId);
				seenToolResults.add(toolCallId);
				output.push(this.trimToolResult(message, index, repairs, counter, options.maxToolResultTokens));
				if (pendingToolCalls.size === 0) {
					activeAssistantOutputIndex = -1;
				}
				continue;
			}

			clearDanglingToolCalls(index);
			output.push(message);
		}

		clearDanglingToolCalls(messages.length);
		return {
			messages: output as T[],
			repairs,
		};
	}

	private cloneMessage<T extends ToolBoundaryMessage>(message: T): ToolBoundaryMessage {
		return {
			...message,
			toolCalls: Array.isArray(message.toolCalls)
				? message.toolCalls.map((toolCall) => ({ ...toolCall }))
				: undefined,
		};
	}

	private trimToolResult(
		message: ToolBoundaryMessage,
		index: number,
		repairs: ToolBoundaryRepair[],
		counter: TokenCounter,
		maxToolResultTokens?: number,
	): ToolBoundaryMessage {
		if (!maxToolResultTokens || maxToolResultTokens <= 0) {
			return message;
		}
		if (counter.count(message.content) <= maxToolResultTokens) {
			return message;
		}
		const marker = "\n[trimmed tool result]";
		const maxPrefixTokens = Math.max(1, maxToolResultTokens - counter.count(marker));
		let low = 0;
		let high = message.content.length;
		let best = "";
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const candidate = message.content.slice(0, mid).trimEnd();
			if (counter.count(candidate) <= maxPrefixTokens) {
				best = candidate;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		repairs.push({
			reason: "trimmed_tool_result",
			toolCallId: message.toolCallId,
			tool: message.name,
			index,
		});
		return {
			...message,
			content: `${best}${marker}`,
		};
	}
}
