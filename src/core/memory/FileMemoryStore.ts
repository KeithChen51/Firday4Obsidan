import { normalizePath, TFile, TFolder, Vault } from "obsidian";

export interface PersistMemoryEntry {
	text: string;
	scope: "global" | "project";
	sourceRef: string;
	projectRoot?: string;
}

export class FileMemoryStore {
	constructor(private readonly vault: Vault) {}

	async persist(entries: PersistMemoryEntry[]): Promise<void> {
		for (const entry of entries) {
			const filePath = this.resolvePath(entry);
			if (!filePath) {
				continue;
			}
			await this.ensureParentFolder(filePath);
			const existing = this.vault.getAbstractFileByPath(filePath);
			const line = `- ${entry.text} (Source: ${entry.sourceRef})`;

			if (existing instanceof TFile) {
				const current = await this.vault.cachedRead(existing);
				if (current.includes(line)) {
					continue;
				}
				await this.vault.modify(existing, `${current.trimEnd()}\n${line}\n`);
				continue;
			}

			const header = entry.scope === "global" ? "# User Memory" : "# Project Behavior Memory";
			await this.vault.create(filePath, `${header}\n\n${line}\n`);
		}
	}

	private resolvePath(entry: PersistMemoryEntry): string {
		if (entry.scope === "global") {
			return normalizePath("F.R.I.D.A.Y/memory/global_user_memory.md");
		}
		if (!entry.projectRoot?.trim()) {
			return "";
		}
		return normalizePath(`${entry.projectRoot.trim()}/memory/project_behavior_memory.md`);
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parentPath = normalizePath(filePath.split("/").slice(0, -1).join("/"));
		if (!parentPath) {
			return;
		}
		const segments = parentPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) {
				continue;
			}
			if (existing instanceof TFile) {
				await this.vault.rename(existing, `${current}.legacy-file-${Date.now()}`);
			}
			if (!this.vault.getAbstractFileByPath(current)) {
				await this.vault.createFolder(current);
			}
		}
	}
}
