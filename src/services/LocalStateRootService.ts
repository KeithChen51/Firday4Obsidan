import path from "path";
import { mkdir } from "fs/promises";

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
