export type ProjectStatus = "active" | "completed" | "archived" | "on_hold";
export type ProjectPriority = "low" | "medium" | "high" | "urgent";
export type ProjectRole = "admin" | "editor" | "viewer";

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

export interface ProjectEntry {
	slug: string;
	localPath: string;
	gitRemote: string;
	gitUsername: string;
	gitUserEmail?: string;
	gitToken: string;
	autoSync: boolean;
	lastSyncAt: string;
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
