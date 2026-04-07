import { normalizePath, parseYaml, TFile, Vault } from "obsidian";
import { ChatMessage } from "./AIService";
import { AgentService } from "./AgentService";

interface SessionLine {
	sessionId: string;
	agentId: string;
	index: number;
	role: ChatMessage["role"];
	content: string;
	ts: string;
}

export interface ConversationSession {
	sessionId: string;
	agentId: string;
	updatedAt: string;
	filePath: string;
	messages: ChatMessage[];
}

export class ConversationService {
	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
	) {}

	createSessionId(date = new Date()): string {
		return date.toISOString().replace(/[:.]/g, "-");
	}

	async loadLatestSession(agentId: string): Promise<ConversationSession | null> {
		const folderPath = this.agentService.getAgentSessionsRoot(agentId);
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
	): Promise<ConversationSession> {
		const targetPath = normalizePath(`${this.agentService.getAgentSessionsRoot(agentId)}/${sessionId}.jsonl`);
		const now = new Date().toISOString();
		const rows = messages.map((message, index) =>
			JSON.stringify({
				sessionId,
				agentId,
				index,
				role: message.role,
				content: message.content,
				ts: now,
			} satisfies SessionLine),
		);
		const payload = rows.join("\n");
		const file = this.vault.getAbstractFileByPath(targetPath);
		if (file instanceof TFile) {
			await this.vault.modify(file, payload);
		} else {
			await this.vault.create(targetPath, payload);
		}

		return {
			sessionId,
			agentId,
			updatedAt: now,
			filePath: targetPath,
			messages,
		};
	}

	async listSessions(agentId: string, limit = 100): Promise<ConversationSession[]> {
		const folderPath = this.agentService.getAgentSessionsRoot(agentId);
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

	async collectRecentSessionsAcrossAgents(
		agentIds: string[],
		sessionLimit: number,
		charLimitPerSession: number,
	): Promise<ConversationSession[]> {
		const merged: ConversationSession[] = [];
		for (const agentId of agentIds) {
			const sessions = await this.listSessions(agentId, sessionLimit);
			for (const session of sessions) {
				const truncatedMessages = this.truncateMessages(session.messages, charLimitPerSession);
				merged.push({
					...session,
					messages: truncatedMessages,
				});
			}
		}

		return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, sessionLimit);
	}

	private truncateMessages(messages: ChatMessage[], charLimit: number): ChatMessage[] {
		const result: ChatMessage[] = [];
		let consumed = 0;
		for (const message of messages) {
			if (consumed >= charLimit) {
				break;
			}
			const remaining = charLimit - consumed;
			const text = message.content.length > remaining ? `${message.content.slice(0, remaining)}…` : message.content;
			result.push({
				role: message.role,
				content: text,
			});
			consumed += text.length;
		}
		return result;
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

		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as Partial<SessionLine>;
				if (typeof parsed.sessionId === "string" && parsed.sessionId) {
					sessionId = parsed.sessionId;
				}
				if (typeof parsed.ts === "string" && parsed.ts) {
					updatedAt = parsed.ts;
				}
				if (
					(parsed.role === "system" || parsed.role === "user" || parsed.role === "assistant") &&
					typeof parsed.content === "string"
				) {
					messages.push({
						role: parsed.role,
						content: parsed.content,
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
		};
	}
}

