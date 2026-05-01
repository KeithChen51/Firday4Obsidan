import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
	AgentTask,
	AgentTaskCreateInput,
	AgentTaskTransitionPatch,
	cloneAgentTask,
	createAgentTask,
	transitionAgentTask,
} from "./AgentTask";

export interface AgentTaskStoreOptions {
	storePath?: string | (() => string);
	now?: () => Date;
}

export class AgentTaskStore {
	private readonly tasks = new Map<string, AgentTask>();
	private loaded = false;
	private readonly now: () => Date;

	constructor(private readonly options: AgentTaskStoreOptions = {}) {
		this.now = options.now ?? (() => new Date());
	}

	async create(input: AgentTaskCreateInput): Promise<AgentTask> {
		await this.ensureLoaded();
		const task = createAgentTask(input, this.now());
		this.tasks.set(task.id, cloneAgentTask(task));
		await this.flush();
		return cloneAgentTask(task);
	}

	async get(taskId: string): Promise<AgentTask | undefined> {
		await this.ensureLoaded();
		const task = this.tasks.get(taskId);
		return task ? cloneAgentTask(task) : undefined;
	}

	async list(): Promise<AgentTask[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.tasks.values()]);
	}

	async getByTurnId(turnId: string): Promise<AgentTask | undefined> {
		await this.ensureLoaded();
		const task = [...this.tasks.values()].find((item) => item.turnId === turnId);
		return task ? cloneAgentTask(task) : undefined;
	}

	async getByConversationId(conversationId: string): Promise<AgentTask[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.tasks.values()].filter((item) => item.conversationId === conversationId));
	}

	async getPending(): Promise<AgentTask[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.tasks.values()].filter((item) =>
			item.status === "created" ||
			item.status === "running" ||
			item.status === "waiting_for_approval" ||
			item.status === "waiting_for_user",
		));
	}

	async replace(task: AgentTask): Promise<void> {
		await this.ensureLoaded();
		this.tasks.set(task.id, cloneAgentTask(task));
		await this.flush();
	}

	async markRunning(taskId: string, patch: AgentTaskTransitionPatch = {}): Promise<AgentTask> {
		return this.transition(taskId, "running", patch);
	}

	async markWaitingForApproval(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask> {
		return this.transition(taskId, "waiting_for_approval", patch);
	}

	async markWaitingForUser(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask> {
		return this.transition(taskId, "waiting_for_user", patch);
	}

	async markFailed(taskId: string, patch: AgentTaskTransitionPatch): Promise<AgentTask> {
		return this.transition(taskId, "failed", patch);
	}

	async markCompleted(taskId: string, patch: AgentTaskTransitionPatch = {}): Promise<AgentTask> {
		return this.transition(taskId, "completed", patch);
	}

	async cancelTask(taskId: string, patch: AgentTaskTransitionPatch = {}): Promise<AgentTask> {
		return this.transition(taskId, "cancelled", patch);
	}

	async createRetryTask(taskId: string, input: Partial<AgentTaskCreateInput> = {}): Promise<AgentTask> {
		const original = await this.requireTask(taskId);
		return this.create({
			conversationId: input.conversationId ?? original.conversationId,
			turnId: input.turnId,
			agentId: input.agentId ?? original.agentId,
			mode: input.mode ?? original.mode,
			title: input.title ?? `Retry: ${original.title}`,
			summary: input.summary ?? "Retry task created.",
			id: input.id,
			retryOfTaskId: original.id,
			runInput: input.runInput ?? original.runInput,
		});
	}

	async createContinuationTask(taskId: string, input: Partial<AgentTaskCreateInput> = {}): Promise<AgentTask> {
		const original = await this.requireTask(taskId);
		return this.create({
			conversationId: input.conversationId ?? original.conversationId,
			turnId: input.turnId,
			agentId: input.agentId ?? original.agentId,
			mode: input.mode ?? original.mode,
			title: input.title ?? `Continue: ${original.title}`,
			summary: input.summary ?? "Continuation task created.",
			id: input.id,
			continueFromTaskId: original.id,
			runInput: input.runInput ?? original.runInput,
		});
	}

	private async transition(taskId: string, status: AgentTask["status"], patch: AgentTaskTransitionPatch): Promise<AgentTask> {
		await this.ensureLoaded();
		const current = await this.requireTask(taskId);
		const next = transitionAgentTask(current, status, patch, this.now());
		this.tasks.set(taskId, cloneAgentTask(next));
		await this.flush();
		return cloneAgentTask(next);
	}

	private async requireTask(taskId: string): Promise<AgentTask> {
		await this.ensureLoaded();
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`Agent task not found: ${taskId}`);
		}
		return cloneAgentTask(task);
	}

	private cloneList(tasks: AgentTask[]): AgentTask[] {
		return tasks.map((task) => cloneAgentTask(task));
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
		if (!Array.isArray(parsed)) {
			return;
		}
		for (const item of parsed) {
			if (isAgentTaskLike(item)) {
				this.tasks.set(item.id, cloneAgentTask(item));
			}
		}
	}

	private async flush(): Promise<void> {
		const filePath = this.resolveStorePath();
		if (!filePath) {
			return;
		}
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, `${JSON.stringify([...this.tasks.values()], null, 2)}\n`, "utf8");
	}

	private resolveStorePath(): string {
		const storePath = this.options.storePath;
		if (!storePath) {
			return "";
		}
		return typeof storePath === "function" ? storePath() : storePath;
	}
}

function isAgentTaskLike(value: unknown): value is AgentTask {
	if (!value || typeof value !== "object") {
		return false;
	}
	const task = value as Partial<AgentTask>;
	return typeof task.id === "string" &&
		typeof task.conversationId === "string" &&
		typeof task.title === "string" &&
		typeof task.status === "string" &&
		typeof task.createdAt === "string" &&
		typeof task.updatedAt === "string" &&
		Array.isArray(task.availableActions);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}
