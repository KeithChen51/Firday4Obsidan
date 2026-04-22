import { mkdir } from "fs/promises";
import path from "path";
import { LocalStateRootService } from "./LocalStateRootService";

export class RuntimeStateStore {
	constructor(private readonly localStateRootService: LocalStateRootService) {}

	getSoulsRoot(): string {
		return this.localStateRootService.resolveVault("souls");
	}

	getSessionsRoot(): string {
		return this.localStateRootService.resolveVault("sessions");
	}

	getApprovalsRoot(): string {
		return this.localStateRootService.resolveVault("approvals");
	}

	getSnapshotsRoot(): string {
		return this.localStateRootService.resolveVault("snapshots");
	}

	getSoulSnapshotsRoot(soulId: string): string {
		return path.join(this.getSnapshotsRoot(), soulId);
	}

	getRuntimeRoot(): string {
		return this.localStateRootService.resolveVault("runtime");
	}

	getBackupsRoot(): string {
		return this.localStateRootService.resolveVault("backups");
	}

	getSessionFilePath(sessionId: string): string {
		return path.join(this.getSessionsRoot(), `${sessionId}.jsonl`);
	}

	getApprovalStorePath(scopeKey = "global"): string {
		return path.join(this.getApprovalsRoot(), `${scopeKey}.json`);
	}

	getMigrationStatePath(): string {
		return path.join(this.getRuntimeRoot(), "migration.json");
	}

	getLegacyAgentBackupRoot(): string {
		return path.join(this.getBackupsRoot(), "legacy-agents");
	}

	async ensureBaseLayout(): Promise<void> {
		await this.localStateRootService.ensureBaseLayout();
		for (const directory of [
			this.getSoulsRoot(),
			this.getSessionsRoot(),
			this.getApprovalsRoot(),
			this.getSnapshotsRoot(),
			this.getRuntimeRoot(),
			this.getBackupsRoot(),
		]) {
			await mkdir(directory, { recursive: true });
		}
	}
}
