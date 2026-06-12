import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { DesktopTraceEvent, TraceHostPort, TraceQuery } from "../contracts/TraceHostPort";
import { FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export interface TraceStoreOptions {
	clock?: () => Date;
	idFactory?: () => string;
}

type StoredTraceEvent = DesktopTraceEvent & {
	projectId: string;
	conversationId: string;
	turnId: string;
};

export class TraceStore implements TraceHostPort {
	readonly projectRoot: string;
	readonly traceRoot: string;

	private readonly clock: () => Date;
	private readonly idFactory: () => string;

	constructor(projectRoot: string, options: TraceStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.traceRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "traces");
		this.clock = options.clock ?? (() => new Date());
		this.idFactory = options.idFactory ?? createTraceEventId;
	}

	async appendTraceEvent(context: DesktopTurnContext, event: DesktopTraceEvent): Promise<DesktopTraceEvent> {
		const storedEvent: StoredTraceEvent = {
			...event,
			id: event.id || this.idFactory(),
			at: event.at || this.clock().toISOString(),
			projectId: context.projectId,
			conversationId: context.conversationId,
			turnId: context.turnId,
		};
		const filePath = this.resolveTracePath(context.conversationId, context.turnId);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.appendFile(filePath, `${JSON.stringify(storedEvent)}\n`, "utf8");
		return storedEvent;
	}

	async queryTraceEvents(query: TraceQuery): Promise<DesktopTraceEvent[]> {
		const events = await this.readQueryEvents(query);
		const filtered = events.filter((event) => {
			if (event.projectId !== query.projectId) {
				return false;
			}
			if (query.conversationId && event.conversationId !== query.conversationId) {
				return false;
			}
			if (query.turnId && event.turnId !== query.turnId) {
				return false;
			}
			if (query.type && event.type !== query.type) {
				return false;
			}
			return true;
		});
		return typeof query.limit === "number" ? filtered.slice(-Math.max(0, query.limit)) : filtered;
	}

	async *replayTraceEvents(query: TraceQuery): AsyncIterable<DesktopTraceEvent> {
		for (const event of await this.queryTraceEvents(query)) {
			yield event;
		}
	}

	private async readQueryEvents(query: TraceQuery): Promise<StoredTraceEvent[]> {
		if (query.conversationId && query.turnId) {
			return this.readTraceFile(this.resolveTracePath(query.conversationId, query.turnId));
		}
		if (query.conversationId) {
			return this.readConversationEvents(query.conversationId);
		}
		return this.readAllEvents();
	}

	private async readAllEvents(): Promise<StoredTraceEvent[]> {
		let conversations: string[] = [];
		try {
			conversations = await fs.readdir(this.traceRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const events: StoredTraceEvent[] = [];
		for (const conversationId of conversations.sort()) {
			events.push(...await this.readConversationEvents(conversationId));
		}
		return events;
	}

	private async readConversationEvents(conversationId: string): Promise<StoredTraceEvent[]> {
		const conversationRoot = path.join(this.traceRoot, safePathSegment(conversationId));
		let files: string[] = [];
		try {
			files = await fs.readdir(conversationRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const events: StoredTraceEvent[] = [];
		for (const file of files.filter((entry) => entry.endsWith(".jsonl")).sort()) {
			events.push(...await this.readTraceFile(path.join(conversationRoot, file)));
		}
		return events;
	}

	private async readTraceFile(filePath: string): Promise<StoredTraceEvent[]> {
		let raw = "";
		try {
			raw = await fs.readFile(filePath, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const events: StoredTraceEvent[] = [];
		for (const line of raw.split(/\r?\n/u)) {
			const parsed = parseTraceLine(line);
			if (parsed) {
				events.push(parsed);
			}
		}
		return events;
	}

	private resolveTracePath(conversationId: string, turnId: string): string {
		return path.join(this.traceRoot, safePathSegment(conversationId), `${safePathSegment(turnId)}.jsonl`);
	}
}

function createTraceEventId(): string {
	return `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safePathSegment(value: string): string {
	const segment = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	if (!segment || segment === "." || segment === "..") {
		return "default";
	}
	return segment;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function parseTraceLine(line: string): StoredTraceEvent | null {
	if (!line.trim()) {
		return null;
	}
	try {
		const parsed = JSON.parse(line) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const event = parsed as Partial<StoredTraceEvent>;
		if (
			typeof event.projectId !== "string" ||
			typeof event.conversationId !== "string" ||
			typeof event.turnId !== "string" ||
			typeof event.type !== "string"
		) {
			return null;
		}
		return parsed as StoredTraceEvent;
	} catch {
		return null;
	}
}
