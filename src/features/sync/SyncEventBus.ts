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
			projectSlug: string;
			recordedAt: string;
	  }
	| {
			type: "sync_stage_changed";
			projectId: string;
			projectSlug: string;
			stage: SyncRuntimeStage;
			message?: string;
			recordedAt: string;
	  }
	| {
			type: "sync_status_observed";
			projectId: string;
			projectSlug: string;
			branch: string;
			connected: boolean;
			conflicts: number;
			recordedAt: string;
	  }
	| {
			type: "sync_conflict_detected";
			projectId: string;
			projectSlug: string;
			conflicts: string[];
			recordedAt: string;
	  }
	| {
			type: "sync_completed";
			projectId: string;
			projectSlug: string;
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
