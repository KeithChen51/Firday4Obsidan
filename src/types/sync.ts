export type SyncConflictStrategy = "ours" | "theirs" | "manual";
export type SyncConflictStatus = "pending" | "deferred";

export interface SyncConflictRecord {
	projectId: string;
	projectSlug: string;
	filePath: string;
	conflictType: "content";
	localSnippet: string;
	remoteSnippet: string;
	mergedSnippet: string;
	markdown: string;
	recommendedStrategy: SyncConflictStrategy;
	status: SyncConflictStatus;
	recordedAt: string;
	snapshotPath?: string;
}
