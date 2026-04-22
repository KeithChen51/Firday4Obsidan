import path from "path";
import { homedir } from "os";
import { cp, mkdir, readdir, rename, rm, stat } from "fs/promises";

export function getFridayUserRoot(): string {
	if (process.platform === "win32") {
		const appData = process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
		return path.join(appData, "friday");
	}
	if (process.platform === "darwin") {
		return path.join(homedir(), "Library", "Application Support", "friday");
	}
	return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "friday");
}

export class LocalStateRootService {
	constructor(
		private readonly vaultBasePath: string,
		private readonly pluginId: string,
	) {}

	getVaultRoot(): string {
		const absoluteVaultBasePath = path.resolve(this.vaultBasePath || ".");
		return path.join(absoluteVaultBasePath, ".obsidian", "friday-state", this.pluginId);
	}

	getLegacyVaultRoot(): string {
		const absoluteVaultBasePath = path.resolve(this.vaultBasePath || ".");
		const vaultName = path.basename(absoluteVaultBasePath) || "vault";
		const parentDir = path.dirname(absoluteVaultBasePath);
		return path.join(parentDir, ".friday-local-state", vaultName, this.pluginId);
	}

	getUserRoot(): string {
		return getFridayUserRoot();
	}

	resolveUser(...parts: string[]): string {
		return path.join(this.getUserRoot(), ...parts);
	}

	resolveVault(...parts: string[]): string {
		return path.join(this.getVaultRoot(), ...parts);
	}

	async ensureBaseLayout(): Promise<void> {
		await this.migrateLegacyVaultStateIfNeeded();
		const directories = [
			this.getUserRoot(),
			this.getVaultRoot(),
			this.resolveVault("souls"),
			this.resolveVault("souls", "definitions"),
			this.resolveVault("sessions"),
			this.resolveVault("approvals"),
			this.resolveVault("snapshots"),
		];
		for (const directory of directories) {
			await mkdir(directory, { recursive: true });
		}
	}

	private async migrateLegacyVaultStateIfNeeded(): Promise<void> {
		const legacyRoot = this.getLegacyVaultRoot();
		const vaultRoot = this.getVaultRoot();
		if (legacyRoot === vaultRoot) {
			return;
		}
		if (!(await this.exists(legacyRoot))) {
			return;
		}
		await mkdir(path.dirname(vaultRoot), { recursive: true });
		if (!(await this.exists(vaultRoot))) {
			try {
				await rename(legacyRoot, vaultRoot);
				await this.cleanupLegacyParents();
				return;
			} catch {
				// fall through to copy mode
			}
		}
		await this.copyMissingTree(legacyRoot, vaultRoot);
		await rm(legacyRoot, { recursive: true, force: true });
		await this.cleanupLegacyParents();
	}

	private async copyMissingTree(sourceRoot: string, targetRoot: string): Promise<void> {
		await mkdir(targetRoot, { recursive: true });
		const entries = await readdir(sourceRoot, { withFileTypes: true });
		for (const entry of entries) {
			const sourcePath = path.join(sourceRoot, entry.name);
			const targetPath = path.join(targetRoot, entry.name);
			if (entry.isDirectory()) {
				await this.copyMissingTree(sourcePath, targetPath);
				continue;
			}
			if (await this.exists(targetPath)) {
				continue;
			}
			await mkdir(path.dirname(targetPath), { recursive: true });
			await cp(sourcePath, targetPath);
		}
	}

	private async cleanupLegacyParents(): Promise<void> {
		const legacyRoot = this.getLegacyVaultRoot();
		const vaultNameRoot = path.dirname(legacyRoot);
		const legacyStateRoot = path.dirname(vaultNameRoot);
		await this.removeDirIfEmpty(vaultNameRoot);
		await this.removeDirIfEmpty(legacyStateRoot);
	}

	private async removeDirIfEmpty(targetPath: string): Promise<void> {
		try {
			const entries = await readdir(targetPath);
			if (entries.length > 0) {
				return;
			}
			await rm(targetPath, { recursive: true, force: true });
		} catch {
			// ignore cleanup failures
		}
	}

	private async exists(targetPath: string): Promise<boolean> {
		try {
			await stat(targetPath);
			return true;
		} catch {
			return false;
		}
	}
}
