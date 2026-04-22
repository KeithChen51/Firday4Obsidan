import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { AgentService } from "./AgentService";
import { RuntimeStateStore } from "./RuntimeStateStore";

interface CleanupResult {
	removedCount: number;
	backedUpCount: number;
}

export class LegacyAgentCleanupService {
	constructor(
		private readonly vault: Vault,
		private readonly agentService: AgentService,
		private readonly runtimeStateStore: RuntimeStateStore,
	) {}

	hasLegacyAgentData(): boolean {
		const root = this.vault.getAbstractFileByPath(this.agentService.getLegacyAgentsRoot());
		if (!(root instanceof TFolder)) {
			return false;
		}
		return root.children.length > 0;
	}

	async cleanupLegacyAgentData(): Promise<CleanupResult> {
		let removedCount = 0;
		let backedUpCount = 0;
		const root = this.vault.getAbstractFileByPath(this.agentService.getLegacyAgentsRoot());
		if (!(root instanceof TFolder)) {
			return { removedCount, backedUpCount };
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const backupRoot = path.join(this.runtimeStateStore.getLegacyAgentBackupRoot(), timestamp);
		await mkdir(backupRoot, { recursive: true });

		for (const child of [...root.children]) {
			if (!(child instanceof TFolder)) {
				continue;
			}
			if (child.name === "_global" || child.name === "_presets") {
				backedUpCount += await this.backupFolderIfPresent(child, backupRoot);
				await this.vault.delete(child, true);
				removedCount += 1;
				continue;
			}
			backedUpCount += await this.backupKnowledgeArtifacts(child, backupRoot);
			removedCount += await this.removeLegacyRuntimeArtifacts(child);
		}

		const refreshedRoot = this.vault.getAbstractFileByPath(this.agentService.getLegacyAgentsRoot());
		if (refreshedRoot instanceof TFolder && refreshedRoot.children.length === 0) {
			await this.vault.delete(refreshedRoot, true);
			removedCount += 1;
		}
		return { removedCount, backedUpCount };
	}

	private async backupKnowledgeArtifacts(agentFolder: TFolder, backupRoot: string): Promise<number> {
		let backedUp = 0;
		const files = [
			"knowledge/project_context.md",
			"knowledge/decision_log.md",
			"knowledge/lessons_learned.md",
		];
		for (const relativePath of files) {
			const sourcePath = normalizePath(`${agentFolder.path}/${relativePath}`);
			const file = this.vault.getAbstractFileByPath(sourcePath);
			if (!(file instanceof TFile)) {
				continue;
			}
			const raw = await this.vault.cachedRead(file);
			const targetPath = path.join(backupRoot, ...sourcePath.split("/"));
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, raw, "utf8");
			backedUp += 1;
		}
		return backedUp;
	}

	private async backupFolderIfPresent(folder: TFolder, backupRoot: string): Promise<number> {
		let backedUp = 0;
		for (const file of this.vault.getFiles().filter((item) => normalizePath(item.path).startsWith(`${folder.path}/`))) {
			const raw = await this.vault.cachedRead(file);
			const targetPath = path.join(backupRoot, ...normalizePath(file.path).split("/"));
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, raw, "utf8");
			backedUp += 1;
		}
		return backedUp;
	}

	private async removeLegacyRuntimeArtifacts(agentFolder: TFolder): Promise<number> {
		let removed = 0;
		const candidates = [
			normalizePath(`${agentFolder.path}/sessions`),
			normalizePath(`${agentFolder.path}/snapshots`),
			normalizePath(`${agentFolder.path}/memory`),
			normalizePath(`${agentFolder.path}/profile.json`),
			normalizePath(`${agentFolder.path}/agent.md`),
			normalizePath(`${agentFolder.path}/knowledge`),
		];
		for (const candidate of candidates) {
			const abstract = this.vault.getAbstractFileByPath(candidate);
			if (!abstract) {
				continue;
			}
			await this.vault.delete(abstract, true);
			removed += 1;
		}
		const refreshed = this.vault.getAbstractFileByPath(agentFolder.path);
		if (refreshed instanceof TFolder && refreshed.children.length === 0) {
			await this.vault.delete(refreshed, true);
			removed += 1;
		}
		return removed;
	}
}
