export type ProjectStatus = "active" | "completed" | "archived" | "on_hold";
export type ProjectPriority = "low" | "medium" | "high" | "urgent";
export type ProjectRole = "admin" | "editor" | "viewer";
export type SourceType = "local_create" | "git_sync" | "import";
export type IngestStatus = "pending" | "running" | "success" | "failed";

export interface ProjectMember {
	userId: string;
	role: ProjectRole;
}

export interface ProjectMeta {
	type: "project";
	projectId: string;
	name: string;
	description: string;
	owner: string;
	status: ProjectStatus;
	priority: ProjectPriority;
	startDate: string;
	endDate: string;
	createdAt: string;
	updatedAt: string;
	color: string;
	tags: string[];
	members: ProjectMember[];
}

export interface ProjectGroupEntry {
	id: string;
	name: string;
	description: string;
	projectSlugs: string[];
	createdAt: string;
	updatedAt: string;
}

export interface ProjectEntry {
	slug: string;
	groupId: string;
	projectRootPath: string;
	localPath?: string;
	gitRemote: string;
	gitUsername: string;
	gitUserEmail?: string;
	gitToken: string;
	autoSync: boolean;
	lastSyncAt: string;
}

export interface RawSidecarMeta {
	metaVersion: number;
	docId: string;
	projectId: string;
	rawPath: string;
	sourceUserId: string;
	sourceUserName: string;
	sourceType: SourceType;
	sourceRepo: string;
	sourceBranch: string;
	sourceCommit: string;
	sourceUpdatedAt: string;
	sourceVersion: number;
	contentHash: string;
	prevContentHash: string;
	lastIngestId: string;
	lastIngestAt: string;
	lastIngestStatus: IngestStatus;
}

export interface IngestEvent {
	ingestId: string;
	docId: string;
	projectId: string;
	sourceVersion: number;
	fromHash: string;
	toHash: string;
	status: IngestStatus;
	error: string;
	startedAt: string;
	finishedAt: string;
}

export interface WikiDocIndexEntry {
	docId: string;
	title: string;
	wikiPath: string;
	sourcePath: string;
	sourceVersion: number;
	contentHash: string;
	summary: string;
	keywords: string[];
	tags?: string[];
	contextZone?: "archive_source" | "workspace_draft" | "wiki_artifact";
	targetZone?: "archive_source" | "workspace_draft" | "wiki_artifact" | "";
	governanceRuleIds?: string[];
	moveTo?: string;
	renameTo?: string;
	suggestionOnly?: boolean;
	evidenceCount: number;
	updatedAt: string;
}

export interface WikiIndexFile {
	version: number;
	projectId: string;
	generatedAt: string;
	wikiRoot: string;
	documents: WikiDocIndexEntry[];
}

export interface SyncResult {
	success: boolean;
	projectSlug: string;
	pulledFiles: string[];
	pushedFiles: string[];
	conflicts: string[];
	conflictSnapshots?: Record<string, string>;
	error?: string;
}

export interface SyncStatus {
	projectSlug: string;
	connected: boolean;
	ahead: number;
	behind: number;
	dirty: number;
	conflicts: number;
	lastSyncAt: string;
}
