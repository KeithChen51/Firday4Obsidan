import type { ProjectEntry, ProjectGitCredential, SyncResult, SyncStatus } from "../../types/project";

export interface GitPullResult {
	success: boolean;
	pulledFiles: string[];
	error?: string;
}

export interface GitPushResult {
	success: boolean;
	pushedFiles: string[];
	error?: string;
}

export interface GitConflictResult {
	conflicts: string[];
	conflictSnapshots?: Record<string, string>;
}

export interface GitConflictContent {
	filePath: string;
	localSnippet: string;
	remoteSnippet: string;
	mergedSnippet: string;
	snapshotPath?: string;
}

export interface GitOperator {
	prepareRepository(project: ProjectEntry): Promise<void>;
	commitWorkingTree(project: ProjectEntry): Promise<string[]>;
	pull(project: ProjectEntry): Promise<GitPullResult>;
	detectConflicts(project: ProjectEntry): Promise<GitConflictResult>;
	readConflictContent(project: ProjectEntry, filePath: string, snapshotPath?: string): Promise<GitConflictContent>;
	push(project: ProjectEntry): Promise<GitPushResult>;
	getStatus(project: ProjectEntry): Promise<SyncStatus>;
	resolveConflict(project: ProjectEntry, filePath: string, strategy: "ours" | "theirs"): Promise<void>;
	finalizeConflictResolution(project: ProjectEntry): Promise<void>;
	getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null>;
	setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void>;
	getUserGitCredential(): Promise<ProjectGitCredential | null>;
	setUserGitCredential(credential: ProjectGitCredential | null): Promise<void>;
	makeErrorResult(projectSlug: string, error: unknown): SyncResult;
}
