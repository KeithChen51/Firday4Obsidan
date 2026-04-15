import { classifyGitError } from "../../platform/git/classifyGitError";
import { SyncEventBus, type SyncRuntimeEvent, type SyncRuntimeStage } from "./SyncEventBus";

export interface SyncRuntimeState {
	projectId: string;
	projectSlug: string;
	stage: SyncRuntimeStage;
	message: string;
	branch: string;
	connected: boolean | null;
	conflicts: number;
	recordedAt: string;
}

type SyncRuntimeListener = () => void;

export class SyncRuntimeStore {
	private readonly states = new Map<string, SyncRuntimeState>();
	private readonly listeners = new Set<SyncRuntimeListener>();
	private unsubscribeBus: (() => void) | null = null;

	constructor(bus?: SyncEventBus) {
		if (bus) {
			this.unsubscribeBus = bus.subscribe((event) => {
				this.handleEvent(event);
			});
		}
	}

	destroy(): void {
		this.unsubscribeBus?.();
		this.unsubscribeBus = null;
		this.listeners.clear();
	}

	subscribe(listener: SyncRuntimeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getProjectState(projectId: string): SyncRuntimeState | null {
		return this.states.get(projectId) ?? null;
	}

	getStates(): SyncRuntimeState[] {
		return [...this.states.values()];
	}

	setProjectState(state: SyncRuntimeState): void {
		this.states.set(state.projectId, state);
		this.emitChange();
	}

	private handleEvent(event: SyncRuntimeEvent): void {
		switch (event.type) {
			case "sync_started":
				this.setProjectState({
					projectId: event.projectId,
					projectSlug: event.projectSlug,
					stage: "checking",
					message: "",
					branch: "",
					connected: null,
					conflicts: 0,
					recordedAt: event.recordedAt,
				});
				return;
			case "sync_stage_changed": {
				const current = this.getProjectState(event.projectId);
				this.setProjectState({
					projectId: event.projectId,
					projectSlug: event.projectSlug,
					stage: event.stage,
					message: event.message ?? current?.message ?? "",
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: current?.conflicts ?? 0,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_status_observed": {
				const current = this.getProjectState(event.projectId);
				const nextStage =
					!event.connected ? "offline" : event.conflicts > 0 ? "blocked" : current?.stage ?? "idle";
				this.setProjectState({
					projectId: event.projectId,
					projectSlug: event.projectSlug,
					stage: nextStage,
					message: current?.message ?? "",
					branch: event.branch,
					connected: event.connected,
					conflicts: event.conflicts,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_conflict_detected": {
				const current = this.getProjectState(event.projectId);
				this.setProjectState({
					projectId: event.projectId,
					projectSlug: event.projectSlug,
					stage: "resolving",
					message: current?.message ?? "",
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: event.conflicts.length,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_completed": {
				const current = this.getProjectState(event.projectId);
				if (event.success) {
					this.setProjectState({
						projectId: event.projectId,
						projectSlug: event.projectSlug,
						stage: "succeeded",
						message: "",
						branch: current?.branch ?? "",
						connected: current?.connected ?? null,
						conflicts: 0,
						recordedAt: event.recordedAt,
					});
					return;
				}
				const classified = classifyGitError(event.error ?? "");
				this.setProjectState({
					projectId: event.projectId,
					projectSlug: event.projectSlug,
					stage: classified.kind,
					message: classified.message,
					branch: current?.branch ?? "",
					connected: classified.kind === "offline" ? false : current?.connected ?? null,
					conflicts: current?.conflicts ?? 0,
					recordedAt: event.recordedAt,
				});
			}
		}
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
