import type { ProjectEntry, SyncStatus } from "../../types/project";
import type { FridaySettings } from "../../types/settings";
import { SyncEventBus } from "./SyncEventBus";

type TimerHandle = number;

interface AutoSyncManagerDeps {
	getSettings: () => Pick<FridaySettings, "sync" | "projects">;
	syncService: {
		sync(project: ProjectEntry): Promise<{ success: boolean }>;
		getStatus(project: ProjectEntry): Promise<Pick<SyncStatus, "branch" | "connected" | "conflicts">>;
	};
	hasBlockingConflicts: (project: ProjectEntry) => boolean;
	persistLastSyncAt: (project: ProjectEntry, recordedAt: string) => Promise<void>;
	eventBus?: SyncEventBus;
	debounceMs?: number;
	setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
	clearTimeoutFn?: (handle: TimerHandle) => void;
}

export class AutoSyncManager {
	private readonly debounceMs: number;
	private readonly setTimeoutFn: (handler: () => void, timeout: number) => TimerHandle;
	private readonly clearTimeoutFn: (handle: TimerHandle) => void;
	private readonly pendingTimers = new Map<string, TimerHandle>();

	constructor(private readonly deps: AutoSyncManagerDeps) {
		this.debounceMs = deps.debounceMs ?? 10_000;
		this.setTimeoutFn = deps.setTimeoutFn ?? ((handler, timeout) => window.setTimeout(handler, timeout));
		this.clearTimeoutFn = deps.clearTimeoutFn ?? ((handle) => window.clearTimeout(handle));
	}

	async runStartupSync(): Promise<void> {
		if (!this.deps.getSettings().sync.syncOnStartup) {
			return;
		}
		for (const project of this.getEligibleProjects()) {
			await this.tryAutoSync(project);
		}
	}

	async runIdleCycle(): Promise<void> {
		if (this.deps.getSettings().sync.mode !== "idle_auto") {
			return;
		}
		for (const project of this.getEligibleProjects()) {
			await this.tryAutoSync(project);
		}
	}

	notifyProjectMutation(project: ProjectEntry): void {
		if (this.deps.getSettings().sync.mode !== "continuous_auto" || !project.autoSync) {
			return;
		}
		const key = project.projectId || project.slug;
		const existing = this.pendingTimers.get(key);
		if (typeof existing === "number") {
			this.clearTimeoutFn(existing);
		}
		const handle = this.setTimeoutFn(() => {
			this.pendingTimers.delete(key);
			void this.tryAutoSync(project);
		}, this.debounceMs);
		this.pendingTimers.set(key, handle);
	}

	private getEligibleProjects(): ProjectEntry[] {
		return this.deps.getSettings().projects.filter((project) => project.autoSync);
	}

	private async tryAutoSync(project: ProjectEntry): Promise<void> {
		if (!(await this.canAutoSync(project))) {
			return;
		}
		const result = await this.deps.syncService.sync(project);
		if (result.success) {
			await this.deps.persistLastSyncAt(project, new Date().toISOString());
		}
	}

	private async canAutoSync(project: ProjectEntry): Promise<boolean> {
		if (project.gitState !== "git_remote_bound" || !project.gitRemote) {
			this.emitBlocked(project, "blocked", "Remote sync is not enabled.");
			return false;
		}
		if (this.deps.hasBlockingConflicts(project)) {
			this.emitBlocked(project, "blocked", "Pending conflict resolution blocks auto sync.");
			return false;
		}
		const status = await this.deps.syncService.getStatus(project);
		if (!status.connected) {
			this.emitBlocked(project, "offline", "Remote is unreachable.");
			return false;
		}
		if (!status.branch) {
			this.emitBlocked(project, "blocked", "Current branch is not pushable.");
			return false;
		}
		if (status.conflicts > 0) {
			this.emitBlocked(project, "blocked", "Conflicts block auto sync.");
			return false;
		}
		return true;
	}

	private emitBlocked(project: ProjectEntry, stage: "offline" | "blocked", message: string): void {
		this.deps.eventBus?.emit({
			type: "sync_stage_changed",
			projectId: project.projectId,
			projectSlug: project.slug,
			stage,
			message,
			recordedAt: new Date().toISOString(),
		});
	}
}
