import type { ProjectEntry, SyncResult } from "../../types/project";
import type { GitOperator } from "../../platform/git/GitOperator";
import { PromiseQueue } from "../../platform/git/PromiseQueue";
import { SyncEventBus } from "./SyncEventBus";
import {
	isNonFastForwardGitError,
	REMOTE_UPDATED_BEFORE_PUSH_ERROR,
} from "../../platform/git/classifyGitError";

export class SyncOrchestrator {
	constructor(
		private readonly operator: GitOperator,
		private readonly queue: PromiseQueue = new PromiseQueue(),
		private readonly eventBus?: SyncEventBus,
	) {}

	async sync(project: ProjectEntry): Promise<SyncResult> {
		return this.queue.enqueue(async () => {
			const recordedAt = new Date().toISOString();
			this.eventBus?.emit({
				type: "sync_started",
				projectId: project.projectId,
				recordedAt,
			});
			try {
				this.emitStage(project, "checking");
				await this.operator.prepareRepository(project);
				this.emitStage(project, "pulling");
				const pulled = await this.pull(project);
				if (!pulled.success) {
					const recovered = await this.preserveDetectedConflictsAfterFailure(project, pulled.pulledFiles, pulled.error);
					if (recovered) {
						return recovered;
					}
					this.emitRecoveryFailedIfNeeded(project, pulled.error);
					this.emitCompleted(project, false, pulled.error);
					return this.operator.makeErrorResult(project.projectId, pulled.error ?? "Pull failed");
				}
				this.emitPullCompleted(project, pulled.pulledFiles);

				const conflictState = await this.detectConflicts(project);
				if (conflictState.conflicts.length > 0) {
					return this.preserveConflictsAndContinue(project, pulled.pulledFiles, conflictState);
				}

				return this.commitAndPush(project, pulled.pulledFiles);
			} catch (error) {
				this.emitCompleted(project, false, String(error));
				return this.operator.makeErrorResult(project.projectId, error);
			}
		});
	}

	async syncAll(projects: ProjectEntry[]): Promise<Map<string, SyncResult>> {
		const result = new Map<string, SyncResult>();
		for (const project of projects) {
			result.set(project.projectId, await this.sync(project));
		}
		return result;
	}

	async commitWorkingTree(project: ProjectEntry): Promise<string[]> {
		return this.operator.commitWorkingTree(project);
	}

	async pull(project: ProjectEntry) {
		return this.operator.pull(project);
	}

	async detectConflicts(project: ProjectEntry) {
		return this.operator.detectConflicts(project);
	}

	async preserveConflicts(project: ProjectEntry, conflicts: string[]): Promise<string[]> {
		return this.operator.preserveConflicts(project, conflicts);
	}

	async push(project: ProjectEntry) {
		return this.operator.push(project);
	}

	private emitStage(project: ProjectEntry, stage: "checking" | "committing" | "pulling" | "pushing"): void {
		this.eventBus?.emit({
			type: "sync_stage_changed",
			projectId: project.projectId,
			stage,
			recordedAt: new Date().toISOString(),
		});
	}

	private emitPullCompleted(project: ProjectEntry, pulledFiles: string[]): void {
		this.eventBus?.emit({
			type: "sync_pull_completed",
			projectId: project.projectId,
			pulledFiles,
			recordedAt: new Date().toISOString(),
		});
	}

	private emitConflictDetected(project: ProjectEntry, conflicts: string[]): void {
		this.eventBus?.emit({
			type: "sync_conflict_detected",
			projectId: project.projectId,
			conflicts,
			recordedAt: new Date().toISOString(),
		});
	}

	private emitCompleted(project: ProjectEntry, success: boolean, error?: string): void {
		this.eventBus?.emit({
			type: "sync_completed",
			projectId: project.projectId,
			success,
			error,
			recordedAt: new Date().toISOString(),
		});
	}

	private async commitAndPush(project: ProjectEntry, pulledFiles: string[]): Promise<SyncResult> {
		this.emitStage(project, "committing");
		await this.commitWorkingTree(project);
		this.emitStage(project, "pushing");
		const pushed = await this.push(project);
		if (!pushed.success) {
			const recovered = await this.retryPushAfterRemoteUpdate(project, pulledFiles, pushed.error);
			if (recovered) {
				return recovered;
			}
			this.emitCompleted(project, false, pushed.error);
			return this.operator.makeErrorResult(project.projectId, pushed.error ?? "Push failed");
		}

		this.emitCompleted(project, true);
		return {
			success: true,
			projectId: project.projectId,
			pulledFiles,
			pushedFiles: pushed.pushedFiles,
			conflicts: [],
			conflictSnapshots: {},
		};
	}

	private async preserveDetectedConflictsAfterFailure(
		project: ProjectEntry,
		pulledFiles: string[],
		error?: string,
	): Promise<SyncResult | null> {
		try {
			const conflictState = await this.detectConflicts(project);
			if (conflictState.conflicts.length === 0) {
				return null;
			}
			return this.preserveConflictsAndContinue(project, pulledFiles, conflictState);
		} catch {
			this.emitRecoveryFailedIfNeeded(project, error);
			return null;
		}
	}

	private async preserveConflictsAndContinue(
		project: ProjectEntry,
		pulledFiles: string[],
		conflictState: Awaited<ReturnType<SyncOrchestrator["detectConflicts"]>>,
	): Promise<SyncResult> {
		this.emitConflictDetected(project, conflictState.conflicts);
		await this.preserveConflicts(project, conflictState.conflicts);
		await this.operator.finalizeConflictResolution(project);
		const remaining = await this.detectConflicts(project);
		if (remaining.conflicts.length > 0) {
			this.emitConflictDetected(project, remaining.conflicts);
			return {
				success: false,
				projectId: project.projectId,
				pulledFiles,
				pushedFiles: [],
				conflicts: remaining.conflicts,
				conflictSnapshots: remaining.conflictSnapshots,
			};
		}
		return this.commitAndPush(project, pulledFiles);
	}

	private async retryPushAfterRemoteUpdate(
		project: ProjectEntry,
		existingPulledFiles: string[],
		pushError?: string,
	): Promise<SyncResult | null> {
		if (!isNonFastForwardGitError(pushError)) {
			return null;
		}

		this.emitStage(project, "pulling");
		const pulled = await this.pull(project);
		if (!pulled.success) {
			const error = pulled.error ?? REMOTE_UPDATED_BEFORE_PUSH_ERROR;
			const recovered = await this.preserveDetectedConflictsAfterFailure(project, existingPulledFiles, error);
			if (recovered) {
				return recovered;
			}
			this.emitRecoveryFailedIfNeeded(project, error);
			this.emitCompleted(project, false, error);
			return this.operator.makeErrorResult(project.projectId, error);
		}
		this.emitPullCompleted(project, pulled.pulledFiles);

		const pulledFiles = [...existingPulledFiles, ...pulled.pulledFiles];
		const conflictState = await this.detectConflicts(project);
		if (conflictState.conflicts.length > 0) {
			return this.preserveConflictsAndContinue(project, pulledFiles, conflictState);
		}

		this.emitStage(project, "pushing");
		const pushed = await this.push(project);
		if (!pushed.success) {
			const error = isNonFastForwardGitError(pushed.error)
				? REMOTE_UPDATED_BEFORE_PUSH_ERROR
				: pushed.error ?? "Push failed";
			this.emitCompleted(project, false, error);
			return this.operator.makeErrorResult(project.projectId, error);
		}

		this.emitCompleted(project, true);
		return {
			success: true,
			projectId: project.projectId,
			pulledFiles,
			pushedFiles: pushed.pushedFiles,
			conflicts: [],
			conflictSnapshots: {},
		};
	}

	private emitRecoveryFailedIfNeeded(project: ProjectEntry, error?: string): void {
		const message = String(error ?? "");
		if (!message.toLowerCase().includes("stash pop recovery failed")) {
			return;
		}
		this.eventBus?.emit({
			type: "sync_recovery_failed",
			projectId: project.projectId,
			message,
			recordedAt: new Date().toISOString(),
		});
	}
}
