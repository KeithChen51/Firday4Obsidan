import type { ProjectEntry, SyncResult } from "../../types/project";
import type { GitOperator } from "../../platform/git/GitOperator";
import { PromiseQueue } from "../../platform/git/PromiseQueue";
import { SyncEventBus } from "./SyncEventBus";

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
				projectSlug: project.slug,
				recordedAt,
			});
			try {
				this.emitStage(project, "checking");
				await this.operator.prepareRepository(project);
				this.emitStage(project, "committing");
				await this.commitWorkingTree(project);
				this.emitStage(project, "pulling");
				const pulled = await this.pull(project);
				if (!pulled.success) {
					this.emitRecoveryFailedIfNeeded(project, pulled.error);
					this.emitCompleted(project, false, pulled.error);
					return this.operator.makeErrorResult(project.slug, pulled.error ?? "Pull failed");
				}
				this.eventBus?.emit({
					type: "sync_pull_completed",
					projectId: project.projectId,
					projectSlug: project.slug,
					pulledFiles: pulled.pulledFiles,
					recordedAt: new Date().toISOString(),
				});

				const conflictState = await this.detectConflicts(project);
				if (conflictState.conflicts.length > 0) {
					this.eventBus?.emit({
						type: "sync_conflict_detected",
						projectId: project.projectId,
						projectSlug: project.slug,
						conflicts: conflictState.conflicts,
						recordedAt: new Date().toISOString(),
					});
					return {
						success: false,
						projectSlug: project.slug,
						projectId: project.projectId,
						pulledFiles: pulled.pulledFiles,
						pushedFiles: [],
						conflicts: conflictState.conflicts,
						conflictSnapshots: conflictState.conflictSnapshots,
					};
				}

				this.emitStage(project, "pushing");
				const pushed = await this.push(project);
				if (!pushed.success) {
					this.emitCompleted(project, false, pushed.error);
					return this.operator.makeErrorResult(project.slug, pushed.error ?? "Push failed");
				}

				this.emitCompleted(project, true);
				return {
					success: true,
					projectSlug: project.slug,
					projectId: project.projectId,
					pulledFiles: pulled.pulledFiles,
					pushedFiles: pushed.pushedFiles,
					conflicts: [],
					conflictSnapshots: {},
				};
			} catch (error) {
				return this.operator.makeErrorResult(project.slug, error);
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

	async push(project: ProjectEntry) {
		return this.operator.push(project);
	}

	private emitStage(project: ProjectEntry, stage: "checking" | "committing" | "pulling" | "pushing"): void {
		this.eventBus?.emit({
			type: "sync_stage_changed",
			projectId: project.projectId,
			projectSlug: project.slug,
			stage,
			recordedAt: new Date().toISOString(),
		});
	}

	private emitCompleted(project: ProjectEntry, success: boolean, error?: string): void {
		this.eventBus?.emit({
			type: "sync_completed",
			projectId: project.projectId,
			projectSlug: project.slug,
			success,
			error,
			recordedAt: new Date().toISOString(),
		});
	}

	private emitRecoveryFailedIfNeeded(project: ProjectEntry, error?: string): void {
		const message = String(error ?? "");
		if (!message.toLowerCase().includes("stash pop recovery failed")) {
			return;
		}
		this.eventBus?.emit({
			type: "sync_recovery_failed",
			projectId: project.projectId,
			projectSlug: project.slug,
			message,
			recordedAt: new Date().toISOString(),
		});
	}
}
