import { App } from "obsidian";
import { ConflictResolutionService } from "../features/sync/ConflictResolutionService";
import { SyncOrchestrator } from "../features/sync/SyncOrchestrator";
import { SyncEventBus } from "../features/sync/SyncEventBus";
import { PromiseQueue } from "../platform/git/PromiseQueue";
import { SimpleGitOperator } from "../platform/git/SimpleGitOperator";
import { SecureStorage } from "../platform/obsidian/SecureStorage";
import { ProjectEntry, ProjectGitCredential, SyncResult, SyncStatus } from "../types/project";
import type { SyncConflictRecord } from "../types/sync";
import type { FridaySettings } from "../types/settings";
import { ProjectBoundaryService } from "./ProjectBoundaryService";

type PostPullHandler = (
	project: ProjectEntry,
	pulledFiles: string[],
	headRevision: string,
) => Promise<void> | void;

export class SyncService {
	private readonly operator: SimpleGitOperator;
	private readonly queue: PromiseQueue;
	private readonly orchestrator: SyncOrchestrator;
	private readonly eventBus?: SyncEventBus;
	private readonly conflictResolutionService = new ConflictResolutionService();

	constructor(
		app: App,
		fridayRoot: string,
		getSettings: () => FridaySettings,
		secureStorage: SecureStorage,
		projectBoundaryService: ProjectBoundaryService,
		eventBus?: SyncEventBus,
	) {
		this.eventBus = eventBus;
		this.operator = new SimpleGitOperator(
			app,
			fridayRoot,
			getSettings,
			secureStorage,
			projectBoundaryService,
		);
		this.queue = new PromiseQueue();
		this.orchestrator = new SyncOrchestrator(this.operator, this.queue, eventBus);
	}

	setPostPullHandler(handler: PostPullHandler | null): void {
		this.operator.setPostPullHandler(handler);
	}

	async prepareRepository(project: ProjectEntry): Promise<void> {
		await this.operator.prepareRepository(project);
	}

	async pull(project: ProjectEntry): Promise<SyncResult> {
		const result = await this.operator.pull(project);
		return result.success
			? {
				success: true,
				projectSlug: project.slug,
				projectId: project.projectId,
				pulledFiles: result.pulledFiles,
				pushedFiles: [],
				conflicts: [],
			}
			: this.operator.makeErrorResult(project.slug, result.error ?? "Pull failed");
	}

	async push(project: ProjectEntry): Promise<SyncResult> {
		const result = await this.operator.push(project);
		return result.success
			? {
				success: true,
				projectSlug: project.slug,
				projectId: project.projectId,
				pulledFiles: [],
				pushedFiles: result.pushedFiles,
				conflicts: [],
			}
			: this.operator.makeErrorResult(project.slug, result.error ?? "Push failed");
	}

	async sync(project: ProjectEntry): Promise<SyncResult> {
		const result = await this.orchestrator.sync(project);
		if (!result.conflicts.length) {
			return result;
		}
		return {
			...result,
			conflictRecords: await this.buildConflictRecords(project, result.conflicts, result.conflictSnapshots),
		};
	}

	async syncAll(projects: ProjectEntry[]): Promise<Map<string, SyncResult>> {
		const results = new Map<string, SyncResult>();
		for (const project of projects) {
			results.set(project.projectId, await this.sync(project));
		}
		return results;
	}

	async getStatus(project: ProjectEntry): Promise<SyncStatus> {
		const status = await this.operator.getStatus(project);
		this.eventBus?.emit({
			type: "sync_status_observed",
			projectId: project.projectId,
			projectSlug: project.slug,
			branch: status.branch,
			connected: status.connected,
			conflicts: status.conflicts,
			recordedAt: new Date().toISOString(),
		});
		return status;
	}

	async getConflicts(project: ProjectEntry): Promise<string[]> {
		const result = await this.operator.detectConflicts(project);
		return result.conflicts;
	}

	async getConflictRecords(
		project: ProjectEntry,
		previous: SyncConflictRecord[] = [],
	): Promise<SyncConflictRecord[]> {
		const result = await this.operator.detectConflicts(project);
		return this.buildConflictRecords(project, result.conflicts, result.conflictSnapshots, previous);
	}

	async resolveConflict(project: ProjectEntry, filePath: string, strategy: "ours" | "theirs"): Promise<void> {
		await this.operator.resolveConflict(project, filePath, strategy);
		this.eventBus?.emit({
			type: "sync_conflict_resolved_written_back",
			projectId: project.projectId,
			projectSlug: project.slug,
			filePath,
			strategy,
			recordedAt: new Date().toISOString(),
		});
	}

	async finalizeConflictResolution(project: ProjectEntry): Promise<void> {
		await this.operator.finalizeConflictResolution(project);
	}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		return this.operator.getProjectGitCredential(projectId);
	}

	async setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void> {
		await this.operator.setProjectGitCredential(projectId, credential);
	}

	private async buildConflictRecords(
		project: ProjectEntry,
		conflicts: string[],
		conflictSnapshots?: Record<string, string>,
		previous: SyncConflictRecord[] = [],
	): Promise<SyncConflictRecord[]> {
		if (!conflicts.length) {
			return [];
		}
		const detailedConflicts = await Promise.all(
			conflicts.map((filePath) =>
				this.operator.readConflictContent(project, filePath, conflictSnapshots?.[filePath]),
			),
		);
		return this.conflictResolutionService.buildRecords({
			project,
			conflicts: detailedConflicts,
			previous,
		});
	}
}
