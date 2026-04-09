import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { IngestEvent } from "../types/project";

export class IngestEventStore {
	constructor(private readonly vault: Vault) {}

	async append(projectRoot: string, event: IngestEvent): Promise<void> {
		const eventPath = normalizePath(`${normalizePath(projectRoot)}/.friday/ingest-events.jsonl`);
		const line = `${JSON.stringify(event)}\n`;
		await this.ensureParentFolder(eventPath);

		const existing = await this.resolveFileConflict(eventPath);
		if (existing instanceof TFile) {
			const current = await this.vault.cachedRead(existing);
			await this.vault.modify(existing, `${current}${line}`);
			return;
		}

		try {
			await this.vault.create(eventPath, line);
		} catch (error) {
			if (!this.isAlreadyExistsError(error)) {
				throw error;
			}
			const created = await this.resolveFileConflict(eventPath);
			if (!(created instanceof TFile)) {
				throw error;
			}
			const current = await this.vault.cachedRead(created);
			await this.vault.modify(created, `${current}${line}`);
		}
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

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parentPath = normalizePath(path.posix.dirname(normalizePath(filePath)));
		if (!parentPath || parentPath === ".") {
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
				const backup = normalizePath(`${current}.legacy-file-${Date.now()}`);
				await this.vault.rename(existing, backup);
			}
			try {
				await this.vault.createFolder(current);
			} catch (error) {
				const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
				if (!message.includes("already exists")) {
					throw error;
				}
			}
		}
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

	private isAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("already exists") || message.includes("eexist");
	}
}
