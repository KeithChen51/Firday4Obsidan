import { readFile, writeFile } from "fs/promises";
import { TFile, Vault } from "obsidian";
import { FridaySettings } from "../types/settings";
import { AgentService } from "./AgentService";
import { ConversationService } from "./ConversationService";
import { RuntimeStateStore } from "./RuntimeStateStore";
import { SoulStore } from "./SoulStore";
import { ToolApprovalRule, ToolApprovalService } from "./ToolApprovalService";

interface MigrationStateRecord {
	completed: boolean;
	completedAt: string;
	version: string;
}

const MIGRATION_VERSION = "soul-local-state-v1";

export class LegacyAgentMigrationService {
	constructor(
		private readonly vault: Vault,
		private readonly settings: FridaySettings,
		private readonly soulStore: SoulStore,
		private readonly conversationService: ConversationService,
		private readonly toolApprovalService: ToolApprovalService,
		private readonly runtimeStateStore: RuntimeStateStore,
		private readonly agentService: AgentService,
		private readonly persistSettings: () => Promise<void>,
	) {}

	async migrateIfNeeded(): Promise<boolean> {
		const existing = await this.readMigrationState();
		if (existing?.completed && existing.version === MIGRATION_VERSION) {
			return false;
		}

		let migrated = false;
		for (const agent of this.settings.agents) {
			const existingSoul = await this.soulStore.getSoul(agent.id);
			if (!existingSoul) {
				await this.soulStore.createSoul({
					id: agent.id,
					name: agent.name,
					summary: agent.description,
					description: agent.description,
				});
				migrated = true;
			}
			const importedSessions = await this.conversationService.importLegacySessions(agent.id);
			if (importedSessions > 0) {
				migrated = true;
			}
			const legacyRules = await this.readLegacyApprovalRules(agent.id);
			if (legacyRules.length > 0) {
				await this.toolApprovalService.mergeLegacyRules(legacyRules);
				migrated = true;
			}
		}

		const nextSoulId = this.settings.activeSoulId || this.settings.activeAgentId || this.settings.agents[0]?.id || "";
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

	private async readLegacyApprovalRules(agentId: string): Promise<ToolApprovalRule[]> {
		const path = this.agentService.getLegacyToolApprovalStorePath(agentId);
		const file = this.vault.getAbstractFileByPath(path);
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
