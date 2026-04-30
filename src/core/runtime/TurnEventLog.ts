import { appendFile, mkdir, readFile } from "fs/promises";
import path from "path";

export type TurnEventType =
	| "turn_started"
	| "context_built"
	| "model_requested"
	| "model_completed"
	| "model_failed"
	| "tool_requested"
	| "tool_policy_checked"
	| "tool_approval_requested"
	| "tool_approval_resolved"
	| "tool_approved"
	| "tool_denied"
	| "tool_completed"
	| "tool_failed"
	| "mutation_planned"
	| "mutation_applied"
	| "mutation_rejected"
	| "mutation_conflicted"
	| "mutation_apply_failed"
	| "assistant_final"
	| "turn_completed"
	| "turn_cancelled"
	| "turn_failed"
	| "fallback"
	| "parse_error"
	| "max_tool_iterations";

export interface TurnEventRef {
	conversationId: string;
	turnId: string;
	taskId?: string;
}

export interface TurnEventInput {
	type: TurnEventType;
	payload?: Record<string, unknown>;
}

export interface TurnEventRecord extends TurnEventRef {
	sequence: number;
	type: TurnEventType;
	at: string;
	payload: Record<string, unknown>;
}

export interface TurnEventLogOptions {
	resolveTurnPath: (ref: TurnEventRef) => string;
	now?: () => Date;
	maxPayloadStringLength?: number;
}

const DEFAULT_MAX_PAYLOAD_STRING_LENGTH = 320;

export class TurnEventLog {
	private readonly now: () => Date;
	private readonly maxPayloadStringLength: number;

	constructor(private readonly options: TurnEventLogOptions) {
		this.now = options.now ?? (() => new Date());
		this.maxPayloadStringLength = options.maxPayloadStringLength ?? DEFAULT_MAX_PAYLOAD_STRING_LENGTH;
	}

	async append(ref: TurnEventRef, event: TurnEventInput): Promise<TurnEventRecord> {
		const [record] = await this.appendMany(ref, [event]);
		if (!record) {
			throw new Error("TurnEventLog append did not create a record.");
		}
		return record;
	}

	async appendMany(ref: TurnEventRef, events: TurnEventInput[]): Promise<TurnEventRecord[]> {
		if (events.length === 0) {
			return [];
		}
		const filePath = this.options.resolveTurnPath(ref);
		await mkdir(path.dirname(filePath), { recursive: true });
		const startingSequence = await this.countExistingEvents(filePath);
		const records = events.map((event, index) => ({
			conversationId: ref.conversationId,
			turnId: ref.turnId,
			...(ref.taskId ? { taskId: ref.taskId } : {}),
			sequence: startingSequence + index + 1,
			type: event.type,
			at: this.now().toISOString(),
			payload: this.sanitizePayload(event.payload ?? {}) as Record<string, unknown>,
		}));
		await appendFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
		return records;
	}

	private async countExistingEvents(filePath: string): Promise<number> {
		try {
			const content = await readFile(filePath, "utf8");
			return content.split("\n").filter((line) => line.trim().length > 0).length;
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return 0;
			}
			throw error;
		}
	}

	private sanitizePayload(value: unknown, key = ""): unknown {
		if (this.isSensitiveKey(key)) {
			return "[redacted]";
		}
		if (typeof value === "string") {
			return this.redactString(this.redactSecrets(value));
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.sanitizePayload(item, key));
		}
		if (!value || typeof value !== "object") {
			return value;
		}
		const output: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			output[key] = this.sanitizePayload(child, key);
		}
		return output;
	}

	private isSensitiveKey(key: string): boolean {
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
		return [
			"authorization",
			"apikey",
			"xapikey",
			"token",
			"accesstoken",
			"refreshtoken",
			"password",
			"secret",
			"cookie",
			"setcookie",
		].includes(normalized);
	}

	private redactSecrets(value: string): string {
		return value
			.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
			.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
			.replace(/\b[A-Za-z0-9_]*secret[A-Za-z0-9_-]{8,}\b/gi, "[redacted]");
	}

	private redactString(value: string): string {
		if (value.length <= this.maxPayloadStringLength) {
			return value;
		}
		const omitted = value.length - this.maxPayloadStringLength;
		return `${value.slice(0, this.maxPayloadStringLength)}... [truncated ${omitted} chars]`;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}
