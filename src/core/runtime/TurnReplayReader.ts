import { readFile } from "fs/promises";

import type { TurnEventRecord, TurnEventRef } from "./TurnEventLog";

export interface TurnReplayReaderOptions {
	resolveTurnPath: (ref: TurnEventRef) => string;
}

export interface TurnReplayValidation {
	ok: boolean;
	errors: string[];
}

export interface TurnReplaySummary extends TurnEventRef {
	totalEvents: number;
	eventTypes: string[];
	status: "completed" | "failed" | "cancelled" | "safe_stopped" | "open";
	modelCalls: {
		requested: number;
		completed: number;
		failed: number;
	};
	toolEvents: {
		requested: number;
		completed: number;
		failed: number;
		denied: number;
	};
	toolCalls: Array<{
		step: number;
		tool: string;
		toolCallId: string;
		status: "requested" | "ok" | "failed" | "denied";
		targetPath: string;
	}>;
	approvals: {
		requested: number;
		resolved: number;
		approved: number;
		denied: number;
	};
	mutations: {
		planned: number;
		applied: number;
		rejected: number;
		conflicted: number;
		applyFailed: number;
	};
	mutationTimeline: Array<{
		id: string;
		event: "planned" | "applied" | "rejected" | "conflicted" | "apply_failed";
		operation: string;
		targetPath: string;
		status: string;
		summary: string;
		reason: string;
	}>;
	taskTimeline: Array<{
		taskId: string;
		event: "created" | "running" | "waiting_for_approval" | "waiting_for_user" | "failed" | "cancelled" | "completed";
		status: string;
		summary: string;
		reason: string;
	}>;
	finalAnswerSummary: string;
	errors: string[];
	terminalStatus: "turn_completed" | "turn_failed" | "turn_cancelled" | "open";
}

const TERMINAL_EVENTS = new Set(["turn_completed", "turn_failed", "turn_cancelled"]);
const POST_TURN_REVIEW_EVENTS = new Set([
	"mutation_applied",
	"mutation_rejected",
	"mutation_conflicted",
	"mutation_apply_failed",
	"task_waiting_for_approval",
	"task_waiting_for_user",
	"task_failed",
	"task_cancelled",
	"task_completed",
]);

export class TurnReplayReader {
	constructor(private readonly options: TurnReplayReaderOptions) {}

	async readTurn(ref: TurnEventRef): Promise<TurnEventRecord[]> {
		const filePath = this.options.resolveTurnPath(ref);
		try {
			const content = await readFile(filePath, "utf8");
			return content
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as TurnEventRecord);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	validateOrder(events: TurnEventRecord[]): TurnReplayValidation {
		const errors: string[] = [];
		if (events.length === 0) {
			return { ok: false, errors: ["Turn event log is empty."] };
		}
		const first = events[0] as TurnEventRecord;
		if (first.type !== "turn_started") {
			errors.push(`First event must be turn_started, got ${first.type}.`);
		}
		for (const [index, event] of events.entries()) {
			const expectedSequence = index + 1;
			if (event.sequence !== expectedSequence) {
				errors.push(`Expected sequence ${expectedSequence} but found ${event.sequence}.`);
			}
			if (event.conversationId !== first.conversationId) {
				errors.push(`Event ${event.sequence} has mismatched conversationId.`);
			}
			if (event.turnId !== first.turnId) {
				errors.push(`Event ${event.sequence} has mismatched turnId.`);
			}
		}
		const terminalIndex = events.findIndex((event) => TERMINAL_EVENTS.has(event.type));
		if (terminalIndex >= 0 && terminalIndex !== events.length - 1) {
			const terminalEvent = events[terminalIndex] as TurnEventRecord;
			const invalidLateEvent = events
				.slice(terminalIndex + 1)
				.find((event) => !POST_TURN_REVIEW_EVENTS.has(event.type));
			if (invalidLateEvent) {
				errors.push(`Found events after terminal event ${terminalEvent.type}.`);
			}
		}
		return { ok: errors.length === 0, errors };
	}

	summarize(events: TurnEventRecord[]): TurnReplaySummary {
		const first = events[0];
		const terminal = [...events].reverse().find((event) => TERMINAL_EVENTS.has(event.type));
		const status = this.resolveStatus(terminal);
		const finalAnswer = [...events].reverse().find((event) => event.type === "assistant_final");
		const toolCalls = this.summarizeToolCalls(events);
		return {
			conversationId: first?.conversationId ?? "",
			turnId: first?.turnId ?? "",
			taskId: first?.taskId,
			totalEvents: events.length,
			eventTypes: events.map((event) => event.type),
			status,
			modelCalls: {
				requested: events.filter((event) => event.type === "model_requested").length,
				completed: events.filter((event) => event.type === "model_completed").length,
				failed: events.filter((event) => event.type === "model_failed").length,
			},
			toolEvents: {
				requested: events.filter((event) => event.type === "tool_requested").length,
				completed: events.filter((event) => event.type === "tool_completed").length,
				failed: events.filter((event) => event.type === "tool_failed").length,
				denied: events.filter((event) => event.type === "tool_denied").length,
			},
			toolCalls,
			approvals: {
				requested: events.filter((event) => event.type === "tool_approval_requested").length,
				resolved: events.filter((event) => event.type === "tool_approval_resolved").length,
				approved: events.filter((event) =>
					event.type === "tool_approval_resolved" && event.payload.approved === true
				).length,
				denied: events.filter((event) =>
					event.type === "tool_approval_resolved" && event.payload.approved === false
				).length,
			},
			mutations: {
				planned: events.filter((event) => event.type === "mutation_planned").length,
				applied: events.filter((event) => event.type === "mutation_applied").length,
				rejected: events.filter((event) => event.type === "mutation_rejected").length,
				conflicted: events.filter((event) => event.type === "mutation_conflicted").length,
				applyFailed: events.filter((event) => event.type === "mutation_apply_failed").length,
			},
			mutationTimeline: this.summarizeMutationTimeline(events),
			taskTimeline: this.summarizeTaskTimeline(events),
			finalAnswerSummary: this.getPayloadText(finalAnswer, "summary") || this.getPayloadText(finalAnswer, "text"),
			errors: events
				.filter((event) => [
					"model_failed",
					"tool_failed",
					"parse_error",
					"turn_failed",
					"turn_cancelled",
					"mutation_apply_failed",
				].includes(event.type))
				.map((event) =>
					this.getPayloadText(event, "error") ||
					this.getPayloadText(event, "summary") ||
					this.getPayloadText(event, "message")
				)
				.filter((item) => item.length > 0),
			terminalStatus: terminal?.type === "turn_completed" || terminal?.type === "turn_failed" || terminal?.type === "turn_cancelled"
				? terminal.type
				: "open",
		};
	}

	async readSummary(ref: TurnEventRef): Promise<TurnReplaySummary> {
		return this.summarize(await this.readTurn(ref));
	}

	private resolveStatus(
		terminal: TurnEventRecord | undefined,
	): TurnReplaySummary["status"] {
		if (!terminal) {
			return "open";
		}
		if (terminal.type === "turn_failed") {
			return "failed";
		}
		if (terminal.type === "turn_cancelled") {
			return "cancelled";
		}
		if (terminal.type === "turn_completed" && terminal.payload.status === "safe_stopped") {
			return "safe_stopped";
		}
		return "completed";
	}

	private summarizeToolCalls(events: TurnEventRecord[]): TurnReplaySummary["toolCalls"] {
		const calls: TurnReplaySummary["toolCalls"] = events
			.filter((event) => event.type === "tool_requested")
			.map((event) => ({
				step: this.getPayloadNumber(event, "step"),
				tool: this.getPayloadText(event, "tool"),
				toolCallId: this.getPayloadText(event, "toolCallId"),
				status: "requested" as const,
				targetPath: this.getPayloadText(event, "targetPath"),
			}));
		for (const event of events) {
			if (!["tool_completed", "tool_failed", "tool_denied"].includes(event.type)) {
				continue;
			}
			const toolCallId = this.getPayloadText(event, "toolCallId");
			const step = this.getPayloadNumber(event, "step");
			const tool = this.getPayloadText(event, "tool");
			const call = calls.find((item) =>
				(toolCallId && item.toolCallId === toolCallId) || (item.step === step && item.tool === tool)
			);
			if (!call) {
				continue;
			}
			call.status = event.type === "tool_completed"
				? "ok"
				: event.type === "tool_denied"
					? "denied"
					: "failed";
			if (!call.targetPath) {
				call.targetPath = this.getPayloadText(event, "targetPath");
			}
		}
		return calls;
	}

	private summarizeMutationTimeline(events: TurnEventRecord[]): TurnReplaySummary["mutationTimeline"] {
		return events
			.filter((event) => [
				"mutation_planned",
				"mutation_applied",
				"mutation_rejected",
				"mutation_conflicted",
				"mutation_apply_failed",
			].includes(event.type))
			.map((event) => ({
				id: this.getPayloadText(event, "id"),
				event: this.toMutationTimelineEvent(event.type),
				operation: this.getPayloadText(event, "operation"),
				targetPath: this.getPayloadText(event, "targetPath"),
				status: this.getPayloadText(event, "status"),
				summary: this.getPayloadText(event, "summary"),
				reason: this.getPayloadText(event, "reason") || this.getPayloadText(event, "error"),
			}));
	}

	private toMutationTimelineEvent(
		type: string,
	): TurnReplaySummary["mutationTimeline"][number]["event"] {
		if (type === "mutation_applied") {
			return "applied";
		}
		if (type === "mutation_rejected") {
			return "rejected";
		}
		if (type === "mutation_conflicted") {
			return "conflicted";
		}
		if (type === "mutation_apply_failed") {
			return "apply_failed";
		}
		return "planned";
	}

	private summarizeTaskTimeline(events: TurnEventRecord[]): TurnReplaySummary["taskTimeline"] {
		return events
			.filter((event) => [
				"task_created",
				"task_running",
				"task_waiting_for_approval",
				"task_waiting_for_user",
				"task_failed",
				"task_cancelled",
				"task_completed",
			].includes(event.type))
			.map((event) => ({
				taskId: this.getPayloadText(event, "taskId") || event.taskId || "",
				event: this.toTaskTimelineEvent(event.type),
				status: this.getPayloadText(event, "status"),
				summary: this.getPayloadText(event, "summary"),
				reason: this.getPayloadText(event, "reason") || this.getPayloadText(event, "error"),
			}));
	}

	private toTaskTimelineEvent(type: string): TurnReplaySummary["taskTimeline"][number]["event"] {
		return type.replace(/^task_/, "") as TurnReplaySummary["taskTimeline"][number]["event"];
	}

	private getPayloadText(event: TurnEventRecord | undefined, key: string): string {
		const value = event?.payload?.[key];
		return typeof value === "string" ? value : "";
	}

	private getPayloadNumber(event: TurnEventRecord, key: string): number {
		const value = event.payload[key];
		return typeof value === "number" ? value : 0;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}
