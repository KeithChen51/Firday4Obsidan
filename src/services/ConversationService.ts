import { normalizePath, parseYaml, TFile, TFolder, Vault } from "obsidian";
import { HistoryCompactor } from "../core/context/HistoryCompactor";
import { ChatMessage } from "./AIService";
import { AgentService } from "./AgentService";

interface SessionLine {
	type?: "message";
	sessionId: string;
	agentId: string;
	index: number;
	role: ChatMessage["role"];
	content: string;
	ts: string;
}

interface SessionMetaLine {
	type: "meta";
	sessionId: string;
	agentId: string;
	title?: string;
	ts: string;
}

export interface ConversationSession {
	sessionId: string;
	agentId: string;
	updatedAt: string;
	filePath: string;
	messages: ChatMessage[];
	title?: string;
}

export class ConversationService {
	private readonly historyCompactor = new HistoryCompactor();

	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
	) {}

	createSessionId(date = new Date()): string {
		return date.toISOString().replace(/[:.]/g, "-");
	}

	async loadLatestSession(agentId: string): Promise<ConversationSession | null> {
		const folderPath = this.agentService.getLegacyAgentSessionsRoot(agentId);
		const files = this.vault
			.getFiles()
			.filter((file) => normalizePath(file.path).startsWith(`${folderPath}/`) && file.extension === "jsonl")
			.sort((left, right) => right.path.localeCompare(left.path));

		const latest = files[0];
		if (!latest) {
			return null;
		}
		return this.readSessionFromFile(latest, agentId);
	}

	async saveSession(
		agentId: string,
		sessionId: string,
		messages: ChatMessage[],
		title?: string,
	): Promise<ConversationSession> {
		const targetPath = normalizePath(`${this.agentService.getLegacyAgentSessionsRoot(agentId)}/${sessionId}.jsonl`);
		const now = new Date().toISOString();
		const existingFile = await this.resolveFileConflict(targetPath);
		let effectiveTitle = title;
		if (effectiveTitle === undefined && existingFile instanceof TFile) {
			const existingSession = await this.readSessionFromFile(existingFile, agentId);
			effectiveTitle = existingSession?.title;
		}
		const metaRows = [
			JSON.stringify({
				type: "meta",
				sessionId,
				agentId,
				title: effectiveTitle?.trim() || "",
				ts: now,
			} satisfies SessionMetaLine),
		];
		const messageRows = messages.map((message, index) =>
			JSON.stringify({
				type: "message",
				sessionId,
				agentId,
				index,
				role: message.role,
				content: message.content,
				ts: now,
			} satisfies SessionLine),
		);
		const payload = [...metaRows, ...messageRows].join("\n");
		const file = existingFile;
		if (file instanceof TFile) {
			await this.vault.modify(file, payload);
		} else {
			try {
				await this.vault.create(targetPath, payload);
			} catch (error) {
				if (!this.isAlreadyExistsError(error)) {
					throw error;
				}
				const created = await this.resolveFileConflict(targetPath);
				if (!(created instanceof TFile)) {
					throw error;
				}
				await this.vault.modify(created, payload);
			}
		}

		return {
			sessionId,
			agentId,
			updatedAt: now,
			filePath: targetPath,
			messages,
			title: effectiveTitle?.trim() || undefined,
		};
	}

	async listSessions(agentId: string, limit = 100): Promise<ConversationSession[]> {
		const folderPath = this.agentService.getLegacyAgentSessionsRoot(agentId);
		const files = this.vault
			.getFiles()
			.filter((file) => normalizePath(file.path).startsWith(`${folderPath}/`) && file.extension === "jsonl")
			.sort((left, right) => right.path.localeCompare(left.path))
			.slice(0, limit);

		const sessions: ConversationSession[] = [];
		for (const file of files) {
			const session = await this.readSessionFromFile(file, agentId);
			if (session) {
				sessions.push(session);
			}
		}
		return sessions;
	}

	async renameSession(agentId: string, sessionId: string, title: string): Promise<ConversationSession> {
		const session = await this.getSession(agentId, sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return this.saveSession(agentId, sessionId, session.messages, title);
	}

	async deleteSession(agentId: string, sessionId: string): Promise<void> {
		const file = await this.findSessionFile(agentId, sessionId);
		if (!(file instanceof TFile)) {
			return;
		}
		await this.vault.delete(file);
	}

	async getSession(agentId: string, sessionId: string): Promise<ConversationSession | null> {
		const file = await this.findSessionFile(agentId, sessionId);
		if (!(file instanceof TFile)) {
			return null;
		}
		return this.readSessionFromFile(file, agentId);
	}

	async collectRecentSessionsAcrossAgents(
		agentIds: string[],
		sessionLimit: number,
		charLimitPerSession: number,
	): Promise<ConversationSession[]> {
		const merged: ConversationSession[] = [];
		for (const agentId of agentIds) {
			const sessions = await this.listSessions(agentId, sessionLimit);
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

	private async resolveFileConflict(filePath: string): Promise<TFile | null> {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		if (direct instanceof TFolder) {
			const backup = normalizePath(`${normalized}.legacy-folder-${Date.now()}`);
			await this.vault.rename(direct, backup);
			return null;
		}
		return this.getFileByPathRelaxed(normalized);
	}

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		const lower = normalized.toLowerCase();
		return this.vault
			.getFiles()
			.find((item) => normalizePath(item.path).toLowerCase() === lower) ?? null;
	}

	private async findSessionFile(agentId: string, sessionId: string): Promise<TFile | null> {
		const directPath = normalizePath(`${this.agentService.getLegacyAgentSessionsRoot(agentId)}/${sessionId}.jsonl`);
		const direct = this.getFileByPathRelaxed(directPath);
		if (direct instanceof TFile) {
			return direct;
		}
		const folderPath = this.agentService.getLegacyAgentSessionsRoot(agentId);
		return this.vault
			.getFiles()
			.find((file) =>
				normalizePath(file.path).startsWith(`${folderPath}/`) &&
				file.extension === "jsonl" &&
				file.basename === sessionId,
			) ?? null;
	}

	private isAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("already exists") || message.includes("eexist");
	}

	private async readSessionFromFile(file: TFile, agentId: string): Promise<ConversationSession | null> {
		const raw = await this.vault.cachedRead(file);
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) {
			return null;
		}

		const messages: ChatMessage[] = [];
		let sessionId = file.basename;
		let updatedAt = file.stat.mtime ? new Date(file.stat.mtime).toISOString() : new Date().toISOString();
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
				if (parsed.type === "meta") {
					if (typeof parsed.title === "string") {
						title = parsed.title.trim();
					}
					continue;
				}
				const role = typeof parsed.role === "string" ? parsed.role : "";
				const content = typeof parsed.content === "string" ? parsed.content : "";
				if (
					(role === "system" || role === "user" || role === "assistant") &&
					content
				) {
					messages.push({
						role,
						content,
					});
				}
			} catch {
				// Compatibility: allow old markdown export sessions.
				const fallback = parseYaml(line);
				if (typeof fallback === "object" && fallback && "content" in fallback && "role" in fallback) {
					const role = String((fallback as { role?: unknown }).role ?? "");
					const content = String((fallback as { content?: unknown }).content ?? "");
					if (
						(role === "system" || role === "user" || role === "assistant") &&
						content
					) {
						messages.push({
							role,
							content,
						});
					}
				}
			}
		}

		if (messages.length === 0) {
			return null;
		}

		return {
			sessionId,
			agentId,
			updatedAt,
			filePath: file.path,
			messages,
			title: title || undefined,
		};
	}
}



