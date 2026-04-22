import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { normalizePath, parseYaml, TFile, Vault } from "obsidian";
import { AgentProfile } from "../types/agent";
import { FridaySettings } from "../types/settings";
import { ConversationService, type ConversationSession } from "./ConversationService";
import { RuntimeStateStore } from "./RuntimeStateStore";
import { SoulStore } from "./SoulStore";
import { ToolApprovalRule, ToolApprovalService } from "./ToolApprovalService";
import { GLOBAL_MEMORY_PATH, LEGACY_GLOBAL_MEMORY_PATH } from "../core/memory/MemoryStoreV1";
import { AgentService } from "./AgentService";

interface MigrationStateRecord {
	completed: boolean;
	completedAt: string;
	version: string;
}

const MIGRATION_VERSION = "soul-local-state-v2";

export class LegacyAgentMigrationService {
	constructor(
		private readonly vault: Vault,
		private readonly settings: FridaySettings,
		private readonly soulStore: SoulStore,
		private readonly conversationService: ConversationService,
		private readonly toolApprovalService: ToolApprovalService,
		private readonly runtimeStateStore: RuntimeStateStore,
		private readonly agentService: AgentService,
		private readonly legacyAgents: AgentProfile[],
		private readonly legacyActiveAgentId: string,
		private readonly persistSettings: () => Promise<void>,
	) {}

	async migrateIfNeeded(): Promise<boolean> {
		const existing = await this.readMigrationState();
		if (existing?.completed && existing.version === MIGRATION_VERSION) {
			return false;
		}

		let migrated = false;
		if (await this.importLegacyGlobalMemory()) {
			migrated = true;
		}

		for (const agent of this.legacyAgents) {
			const existingSoul = await this.soulStore.getSoul(agent.id);
			if (!existingSoul) {
				await this.soulStore.createSoul({
					id: agent.id,
					name: agent.name,
					summary: agent.description,
					description: agent.description,
					preferredModel: agent.model,
					preferredModelMode: agent.modelMode,
				});
				migrated = true;
			}

			const importedSessions = await this.importLegacySessions(agent.id);
			if (importedSessions > 0) {
				migrated = true;
			}

			const legacyRules = await this.readLegacyApprovalRules(agent.id);
			if (legacyRules.length > 0) {
				await this.toolApprovalService.mergeLegacyRules(legacyRules);
				migrated = true;
			}
		}

		const nextSoulId = this.settings.activeSoulId || this.legacyActiveAgentId || this.legacyAgents[0]?.id || "";
		if (nextSoulId && this.settings.activeSoulId !== nextSoulId) {
			this.settings.activeSoulId = nextSoulId;
			migrated = true;
		}
		if (nextSoulId) {
			await this.soulStore.setActiveSoul(nextSoulId);
		}
		if (migrated) {
			await this.persistSettings();
		}
		await this.writeMigrationState({
			completed: true,
			completedAt: new Date().toISOString(),
			version: MIGRATION_VERSION,
		});
		return migrated;
	}

	private async importLegacyGlobalMemory(): Promise<boolean> {
		const legacyFile = this.vault.getAbstractFileByPath(LEGACY_GLOBAL_MEMORY_PATH);
		if (!(legacyFile instanceof TFile)) {
			return false;
		}
		try {
			await readFile(GLOBAL_MEMORY_PATH, "utf8");
			return false;
		} catch {
			// fall through
		}
		const raw = await this.vault.cachedRead(legacyFile);
		if (!raw.trim()) {
			return false;
		}
		await this.runtimeStateStore.ensureBaseLayout();
		await mkdir(path.dirname(GLOBAL_MEMORY_PATH), { recursive: true });
		await writeFile(GLOBAL_MEMORY_PATH, raw, "utf8");
		return true;
	}

	private async importLegacySessions(soulId: string): Promise<number> {
		const folderPath = this.agentService.getLegacyAgentSessionsRoot(soulId);
		const files = this.vault
			.getFiles()
			.filter((file) => normalizePath(file.path).startsWith(`${folderPath}/`) && file.extension === "jsonl")
			.sort((left, right) => right.path.localeCompare(left.path));
		let imported = 0;
		for (const file of files) {
			const raw = await this.vault.cachedRead(file);
			const legacySession = this.readLegacySession(raw, file.path, soulId);
			if (!legacySession) {
				continue;
			}
			const existing = await this.conversationService.getSession(
				legacySession.soulId,
				legacySession.sessionId,
				legacySession.projectId,
			);
			if (existing) {
				continue;
			}
			await this.conversationService.saveSession({
				soulId: legacySession.soulId,
				projectId: legacySession.projectId,
				sessionId: legacySession.sessionId,
				messages: legacySession.messages,
				title: legacySession.title,
			});
			imported += 1;
		}
		return imported;
	}

	private readLegacySession(raw: string, filePath: string, fallbackSoulId: string): ConversationSession | null {
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) {
			return null;
		}

		const messages: ConversationSession["messages"] = [];
		let sessionId = filePath.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, "") || "";
		let soulId = fallbackSoulId;
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
					messages.push({ role, content });
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

		if (messages.length === 0) {
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

	private async readLegacyApprovalRules(agentId: string): Promise<ToolApprovalRule[]> {
		const targetPath = this.agentService.getLegacyToolApprovalStorePath(agentId);
		const file = this.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile)) {
			return [];
		}
		try {
			const raw = await this.vault.cachedRead(file);
			const parsed = JSON.parse(raw) as { rules?: ToolApprovalRule[] };
			return Array.isArray(parsed.rules) ? parsed.rules : [];
		} catch {
			return [];
		}
	}

	private async readMigrationState(): Promise<MigrationStateRecord | null> {
		try {
			const raw = await readFile(this.runtimeStateStore.getMigrationStatePath(), "utf8");
			return JSON.parse(raw) as MigrationStateRecord;
		} catch {
			return null;
		}
	}

	private async writeMigrationState(state: MigrationStateRecord): Promise<void> {
		await this.runtimeStateStore.ensureBaseLayout();
		await writeFile(this.runtimeStateStore.getMigrationStatePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
	}
}
