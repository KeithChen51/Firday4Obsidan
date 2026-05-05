import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
	AgentLoopCheckpoint,
	isCheckpointExpired,
	sanitizeAgentLoopCheckpoint,
} from "./AgentLoopCheckpoint";

export interface AgentLoopCheckpointStoreOptions {
	storePath?: string | (() => string);
	now?: () => Date;
	ttlMs?: number;
}

export class AgentLoopCheckpointStore {
	private readonly checkpoints = new Map<string, AgentLoopCheckpoint>();
	private readonly now: () => Date;
	private readonly ttlMs: number;
	private loaded = false;

	constructor(private readonly options: AgentLoopCheckpointStoreOptions = {}) {
		this.now = options.now ?? (() => new Date());
		this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
	}

	async save(checkpoint: AgentLoopCheckpoint): Promise<void> {
		await this.ensureLoaded();
		const sanitized = sanitizeAgentLoopCheckpoint(checkpoint);
		this.checkpoints.set(sanitized.id, cloneCheckpoint(sanitized));
		await this.flush();
	}

	async get(checkpointId: string): Promise<AgentLoopCheckpoint | null> {
		await this.ensureLoaded();
		const checkpoint = this.checkpoints.get(checkpointId);
		return checkpoint ? cloneCheckpoint(checkpoint) : null;
	}

	async getLatestForTask(taskId: string): Promise<AgentLoopCheckpoint | null> {
		await this.ensureLoaded();
		return this.getLatest((checkpoint) => checkpoint.taskId === taskId);
	}

	async getLatestForTurn(turnId: string): Promise<AgentLoopCheckpoint | null> {
		await this.ensureLoaded();
		return this.getLatest((checkpoint) => checkpoint.turnId === turnId);
	}

	async markConsumed(
		checkpointId: string,
		result: "resumed" | "rejected" | "expired",
		reason: string,
	): Promise<void> {
		await this.ensureLoaded();
		const checkpoint = this.checkpoints.get(checkpointId);
		if (!checkpoint) {
			return;
		}
		this.checkpoints.set(checkpointId, sanitizeAgentLoopCheckpoint({
			...checkpoint,
			consumed: {
				result,
				reason,
				at: this.now().toISOString(),
			},
		}));
		await this.flush();
	}

	private getLatest(predicate: (checkpoint: AgentLoopCheckpoint) => boolean): AgentLoopCheckpoint | null {
		const candidates = [...this.checkpoints.values()]
			.filter((checkpoint) =>
				predicate(checkpoint) &&
				!checkpoint.consumed &&
				!isCheckpointExpired(checkpoint, this.now(), this.ttlMs)
			)
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		const checkpoint = candidates[0];
		return checkpoint ? cloneCheckpoint(checkpoint) : null;
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		const filePath = this.resolveStorePath();
		if (!filePath) {
			return;
		}
		let raw = "";
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		if (!raw.trim()) {
			return;
		}
		const parsed = JSON.parse(raw) as unknown;
		const records = Array.isArray(parsed) ? parsed : [];
		for (const item of records) {
			if (isCheckpointLike(item)) {
				const checkpoint = sanitizeAgentLoopCheckpoint(item);
				this.checkpoints.set(checkpoint.id, checkpoint);
			}
		}
	}

	private async flush(): Promise<void> {
		const filePath = this.resolveStorePath();
		if (!filePath) {
			return;
		}
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, `${JSON.stringify([...this.checkpoints.values()], null, 2)}\n`, "utf8");
	}

	private resolveStorePath(): string {
		const storePath = this.options.storePath;
		if (!storePath) {
			return "";
		}
		return typeof storePath === "function" ? storePath() : storePath;
	}
}

function cloneCheckpoint(checkpoint: AgentLoopCheckpoint): AgentLoopCheckpoint {
	return JSON.parse(JSON.stringify(checkpoint)) as AgentLoopCheckpoint;
}

function isCheckpointLike(value: unknown): value is AgentLoopCheckpoint {
	if (!value || typeof value !== "object") {
		return false;
	}
	const checkpoint = value as Partial<AgentLoopCheckpoint>;
	return checkpoint.schemaVersion === 1 &&
		typeof checkpoint.id === "string" &&
		typeof checkpoint.turnId === "string" &&
		typeof checkpoint.conversationId === "string" &&
		typeof checkpoint.agentId === "string" &&
		typeof checkpoint.createdAt === "string" &&
		Array.isArray(checkpoint.modelMessages);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}
