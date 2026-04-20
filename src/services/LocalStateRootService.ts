import path from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";

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

	getRoot(): string {
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

	resolve(...parts: string[]): string {
		return path.join(this.getRoot(), ...parts);
	}

	async ensureBaseLayout(): Promise<void> {
		const directories = [
			this.getRoot(),
			this.resolve("souls"),
			this.resolve("souls", "definitions"),
			this.resolve("sessions"),
			this.resolve("approvals"),
			this.resolve("snapshots"),
		];
		for (const directory of directories) {
			await mkdir(directory, { recursive: true });
		}
	}
}
