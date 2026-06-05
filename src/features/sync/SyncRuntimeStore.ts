import {
	GIT_ERROR_MESSAGE_KEYS,
	GIT_ERROR_RECOVERY_ACTION_KEYS,
	classifyGitError,
	type GitExternalCondition,
} from "../../platform/git/classifyGitError";
import { SyncEventBus, type SyncRuntimeEvent, type SyncRuntimeStage } from "./SyncEventBus";

type SyncActiveStage = Extract<SyncRuntimeStage, "checking" | "pulling" | "committing" | "pushing">;

export interface SyncRuntimeState {
	projectId: string;
	stage: SyncRuntimeStage;
	lastActiveStage?: SyncActiveStage;
	condition?: GitExternalCondition;
	message: string;
	messageKey?: string;
	recoveryAction?: string;
	recoveryActionKey?: string;
	technicalMessage?: string;
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
					stage: "checking",
					lastActiveStage: "checking",
					condition: undefined,
					message: "",
					messageKey: undefined,
					recoveryAction: "",
					recoveryActionKey: undefined,
					technicalMessage: "",
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
					stage: event.stage,
					lastActiveStage: isSyncActiveStage(event.stage) ? event.stage : current?.lastActiveStage,
					condition: isSyncActiveStage(event.stage) ? undefined : current?.condition,
					message: event.message ?? current?.message ?? "",
					messageKey: isSyncActiveStage(event.stage) ? undefined : current?.messageKey,
					recoveryAction: isSyncActiveStage(event.stage) ? "" : current?.recoveryAction ?? "",
					recoveryActionKey: isSyncActiveStage(event.stage) ? undefined : current?.recoveryActionKey,
					technicalMessage: isSyncActiveStage(event.stage) ? "" : current?.technicalMessage ?? "",
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: current?.conflicts ?? 0,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_pull_completed": {
				const current = this.getProjectState(event.projectId);
				this.setProjectState({
					projectId: event.projectId,
					stage: current?.stage ?? "pulling",
					lastActiveStage: current?.lastActiveStage ?? "pulling",
					condition: current?.condition,
					message: event.pulledFiles.length > 0 ? `Pulled ${event.pulledFiles.length} file(s).` : "",
					messageKey: undefined,
					recoveryAction: current?.recoveryAction ?? "",
					recoveryActionKey: current?.recoveryActionKey,
					technicalMessage: current?.technicalMessage ?? "",
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
				const condition = !event.connected
					? event.condition ?? "remote_unreachable"
					: event.conflicts > 0
						? "content_conflict"
						: undefined;
				this.setProjectState({
					projectId: event.projectId,
					stage: nextStage,
					lastActiveStage: current?.lastActiveStage,
					condition,
					message: event.message ?? current?.message ?? "",
					messageKey: event.messageKey ?? current?.messageKey,
					recoveryAction: event.recoveryAction ?? current?.recoveryAction ?? "",
					recoveryActionKey: event.recoveryActionKey ?? current?.recoveryActionKey,
					technicalMessage: event.technicalMessage ?? current?.technicalMessage ?? "",
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
					stage: "resolving",
					lastActiveStage: current?.lastActiveStage ?? "pulling",
					condition: "content_conflict",
					message: "",
					messageKey: GIT_ERROR_MESSAGE_KEYS.content_conflict,
					recoveryAction: "",
					recoveryActionKey: GIT_ERROR_RECOVERY_ACTION_KEYS.content_conflict,
					technicalMessage: event.conflicts.join(", "),
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: event.conflicts.length,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_recovery_failed": {
				const current = this.getProjectState(event.projectId);
				this.setProjectState({
					projectId: event.projectId,
					stage: "blocked",
					lastActiveStage: current?.lastActiveStage,
					condition: "stash_restore_conflict",
					message: "",
					messageKey: GIT_ERROR_MESSAGE_KEYS.stash_restore_conflict,
					recoveryAction: "",
					recoveryActionKey: GIT_ERROR_RECOVERY_ACTION_KEYS.stash_restore_conflict,
					technicalMessage: event.message,
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: current?.conflicts ?? 0,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_conflict_resolved_written_back": {
				const current = this.getProjectState(event.projectId);
				this.setProjectState({
					projectId: event.projectId,
					stage: "resolving",
					lastActiveStage: current?.lastActiveStage ?? "pulling",
					condition: current?.condition ?? "content_conflict",
					message: `已处理 ${event.filePath}。`,
					messageKey: undefined,
					recoveryAction: current?.recoveryAction ?? "",
					recoveryActionKey: current?.recoveryActionKey,
					technicalMessage: `Wrote ${event.strategy} resolution for ${event.filePath}.`,
					branch: current?.branch ?? "",
					connected: current?.connected ?? null,
					conflicts: current?.conflicts ?? 0,
					recordedAt: event.recordedAt,
				});
				return;
			}
			case "sync_completed": {
				const current = this.getProjectState(event.projectId);
				if (event.success) {
					this.setProjectState({
						projectId: event.projectId,
						stage: "succeeded",
						lastActiveStage: current?.lastActiveStage ?? "pushing",
						condition: undefined,
						message: "",
						messageKey: undefined,
						recoveryAction: "",
						recoveryActionKey: undefined,
						technicalMessage: "",
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
					stage: classified.kind,
					lastActiveStage: current?.lastActiveStage ?? "checking",
					condition: classified.condition,
					message: "",
					messageKey: classified.messageKey,
					recoveryAction: "",
					recoveryActionKey: classified.recoveryActionKey,
					technicalMessage: classified.technicalMessage,
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

function isSyncActiveStage(stage: SyncRuntimeStage): stage is SyncActiveStage {
	return stage === "checking" || stage === "pulling" || stage === "committing" || stage === "pushing";
}
