import { readdir, readFile, rm, writeFile } from "fs/promises";
import { parseYaml } from "obsidian";
import { HistoryCompactor } from "../core/context/HistoryCompactor";
import { ChatMessage } from "./AIService";
import { RuntimeStateStore } from "./RuntimeStateStore";

interface SessionLine {
	type?: "message";
	sessionId: string;
	soulId: string;
	projectId?: string;
	index: number;
	role: ChatMessage["role"];
	content: string;
	uiMeta?: ChatMessage["uiMeta"];
	ts: string;
}

interface SessionMetaLine {
	type: "meta";
	sessionId: string;
	soulId: string;
	projectId?: string;
	title?: string;
	ts: string;
}

export interface ConversationSession {
	sessionId: string;
	soulId: string;
	projectId?: string;
	updatedAt: string;
	filePath: string;
	messages: ChatMessage[];
	title?: string;
}

export class ConversationService {
	private readonly historyCompactor = new HistoryCompactor();

	constructor(private readonly runtimeStateStore: RuntimeStateStore) {}

	createSessionId(date = new Date()): string {
		return date.toISOString().replace(/[:.]/g, "-");
	}

	async loadLatestSession(soulId: string, projectId?: string): Promise<ConversationSession | null> {
		const sessions = await this.listSessions(soulId, 1, projectId);
		return sessions[0] ?? null;
	}

	async saveSession(input: {
		soulId: string;
		sessionId: string;
		messages: ChatMessage[];
		title?: string;
		projectId?: string;
	}): Promise<ConversationSession> {
		await this.runtimeStateStore.ensureBaseLayout();
		const targetPath = this.runtimeStateStore.getSessionFilePath(input.sessionId);
		const now = new Date().toISOString();
		let effectiveTitle = input.title;
		if (effectiveTitle === undefined) {
			const existingSession = await this.getSession(input.soulId, input.sessionId, input.projectId);
			effectiveTitle = existingSession?.title;
		}
		const metaRows = [
			JSON.stringify({
				type: "meta",
				sessionId: input.sessionId,
				soulId: input.soulId,
				projectId: input.projectId,
				title: effectiveTitle?.trim() || "",
				ts: now,
			} satisfies SessionMetaLine),
		];
		const messageRows = input.messages.map((message, index) =>
			JSON.stringify({
				type: "message",
				sessionId: input.sessionId,
				soulId: input.soulId,
				projectId: input.projectId,
				index,
				role: message.role,
				content: message.content,
				...(message.uiMeta ? { uiMeta: message.uiMeta } : {}),
				ts: now,
			} satisfies SessionLine),
		);
		await writeFile(targetPath, [...metaRows, ...messageRows].join("\n"), "utf8");
		return {
			sessionId: input.sessionId,
			soulId: input.soulId,
			projectId: input.projectId,
			updatedAt: now,
			filePath: targetPath,
			messages: input.messages,
			title: effectiveTitle?.trim() || undefined,
		};
	}

	async listSessions(soulId: string, limit = 100, projectId?: string): Promise<ConversationSession[]> {
		return this.listLocalSessions(soulId, limit, projectId);
	}

	async renameSession(soulId: string, sessionId: string, title: string, projectId?: string): Promise<ConversationSession> {
		const session = await this.getSession(soulId, sessionId, projectId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return this.saveSession({
			soulId,
			sessionId,
			projectId: session.projectId ?? projectId,
			messages: session.messages,
			title,
		});
	}

	async deleteSession(soulId: string, sessionId: string, projectId?: string): Promise<void> {
		const session = await this.getSession(soulId, sessionId, projectId);
		if (!session) {
			return;
		}
		try {
			await rm(session.filePath, { force: true });
		} catch {
			return;
		}
	}

	async getSession(soulId: string, sessionId: string, projectId?: string): Promise<ConversationSession | null> {
		const localPath = this.runtimeStateStore.getSessionFilePath(sessionId);
		const localSession = await this.readSessionFromFile(localPath);
		if (
			localSession &&
			localSession.soulId === soulId &&
			(!projectId || localSession.projectId === projectId)
		) {
			return localSession;
		}
		return null;
	}

	async collectRecentSessionsAcrossSouls(
		soulIds: string[],
		sessionLimit: number,
		charLimitPerSession: number,
		projectId?: string,
	): Promise<ConversationSession[]> {
		const merged: ConversationSession[] = [];
		for (const soulId of soulIds) {
			const sessions = await this.listSessions(soulId, sessionLimit, projectId);
			for (const session of sessions) {
				const truncatedMessages = this.historyCompactor.compact(session.messages, {
					preserveRecent: false,
					maxMessages: session.messages.length || 1,
					maxCharsPerMessage: charLimitPerSession,
					maxTotalChars: charLimitPerSession,
				}).messages;
				merged.push({
					...session,
					messages: truncatedMessages,
				});
			}
		}
		return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, sessionLimit);
	}

	private async listLocalSessions(soulId: string, limit: number, projectId?: string): Promise<ConversationSession[]> {
		await this.runtimeStateStore.ensureBaseLayout();
		let names: string[] = [];
		try {
			names = await readdir(this.runtimeStateStore.getSessionsRoot());
		} catch {
			return [];
		}
		const sessions: ConversationSession[] = [];
		for (const name of names.filter((item) => item.endsWith(".jsonl")).sort((left, right) => right.localeCompare(left))) {
			const filePath = this.runtimeStateStore.getSessionFilePath(name.replace(/\.jsonl$/i, ""));
			const session = await this.readSessionFromFile(filePath);
			if (!session) {
				continue;
			}
			if (session.soulId !== soulId) {
				continue;
			}
			if (projectId && session.projectId !== projectId) {
				continue;
			}
			sessions.push(session);
			if (sessions.length >= limit) {
				break;
			}
		}
		return sessions;
	}

	private async readSessionFromFile(filePath: string): Promise<ConversationSession | null> {
		try {
			const raw = await readFile(filePath, "utf8");
			return this.readSessionFromRaw(raw, filePath);
		} catch {
			return null;
		}
	}

	private readSessionFromRaw(raw: string, filePath: string): ConversationSession | null {
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) {
			return null;
		}

		const messages: ChatMessage[] = [];
		let sessionId = filePath.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, "") || "";
		let soulId = "";
		let projectId = "";
		let updatedAt = new Date().toISOString();
		let title = "";

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				const parsedSessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
				const parsedTs = typeof parsed.ts === "string" ? parsed.ts : "";
				if (parsedSessionId) {
					sessionId = parsedSessionId;
				}
				if (parsedTs) {
					updatedAt = parsedTs;
				}
				if (typeof parsed.soulId === "string" && parsed.soulId.trim()) {
					soulId = parsed.soulId.trim();
				}
				if (typeof parsed.projectId === "string" && parsed.projectId.trim()) {
					projectId = parsed.projectId.trim();
				}
				if (parsed.type === "meta") {
					if (typeof parsed.title === "string") {
						title = parsed.title.trim();
					}
					continue;
				}
				const role = typeof parsed.role === "string" ? parsed.role : "";
				const content = typeof parsed.content === "string" ? parsed.content : "";
				if ((role === "system" || role === "user" || role === "assistant") && content) {
					const message: ChatMessage = { role, content };
					if (parsed.uiMeta && typeof parsed.uiMeta === "object") {
						message.uiMeta = parsed.uiMeta as ChatMessage["uiMeta"];
					}
					messages.push(message);
				}
			} catch {
				const fallback = parseYaml(line);
				if (typeof fallback === "object" && fallback && "content" in fallback && "role" in fallback) {
					const role = String((fallback as { role?: unknown }).role ?? "");
					const content = String((fallback as { content?: unknown }).content ?? "");
					if ((role === "system" || role === "user" || role === "assistant") && content) {
						messages.push({ role, content });
					}
				}
			}
		}

		if (messages.length === 0 || !soulId) {
			return null;
		}

		return {
			sessionId,
			soulId,
			projectId: projectId || undefined,
			updatedAt,
			filePath,
			messages,
			title: title || undefined,
		};
	}
}
