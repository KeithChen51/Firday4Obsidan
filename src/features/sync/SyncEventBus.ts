export type SyncRuntimeStage =
	| "idle"
	| "checking"
	| "committing"
	| "pulling"
	| "pushing"
	| "resolving"
	| "succeeded"
	| "failed"
	| "offline"
	| "blocked";

export type SyncRuntimeEvent =
	| {
			type: "sync_started";
			projectId: string;
			recordedAt: string;
	  }
	| {
			type: "sync_stage_changed";
			projectId: string;
			stage: SyncRuntimeStage;
			message?: string;
			recordedAt: string;
	  }
	| {
			type: "sync_pull_completed";
			projectId: string;
			pulledFiles: string[];
			recordedAt: string;
	  }
	| {
			type: "sync_status_observed";
			projectId: string;
			branch: string;
			connected: boolean;
			conflicts: number;
			recordedAt: string;
	  }
	| {
			type: "sync_conflict_detected";
			projectId: string;
			conflicts: string[];
			recordedAt: string;
	  }
	| {
			type: "sync_recovery_failed";
			projectId: string;
			message: string;
			recordedAt: string;
	  }
	| {
			type: "sync_conflict_resolved_written_back";
			projectId: string;
			filePath: string;
			strategy: "ours" | "theirs";
			recordedAt: string;
	  }
	| {
			type: "sync_completed";
			projectId: string;
			success: boolean;
			error?: string;
			recordedAt: string;
	  };

type SyncEventListener = (event: SyncRuntimeEvent) => void;

export class SyncEventBus {
	private readonly listeners = new Set<SyncEventListener>();

	emit(event: SyncRuntimeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	subscribe(listener: SyncEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
