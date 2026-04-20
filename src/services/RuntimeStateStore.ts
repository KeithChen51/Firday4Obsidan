import { mkdir } from "fs/promises";
import path from "path";
import { LocalStateRootService } from "./LocalStateRootService";

export class RuntimeStateStore {
	constructor(private readonly localStateRootService: LocalStateRootService) {}

	getSoulsRoot(): string {
		return this.localStateRootService.resolve("souls");
	}

	getSessionsRoot(): string {
		return this.localStateRootService.resolve("sessions");
	}

	getApprovalsRoot(): string {
		return this.localStateRootService.resolve("approvals");
	}

	getSnapshotsRoot(): string {
		return this.localStateRootService.resolve("snapshots");
	}

	getSessionFilePath(sessionId: string): string {
		return path.join(this.getSessionsRoot(), `${sessionId}.jsonl`);
	}

	async ensureBaseLayout(): Promise<void> {
		await this.localStateRootService.ensureBaseLayout();
		for (const directory of [this.getSoulsRoot(), this.getSessionsRoot(), this.getApprovalsRoot(), this.getSnapshotsRoot()]) {
			await mkdir(directory, { recursive: true });
		}
	}
}
