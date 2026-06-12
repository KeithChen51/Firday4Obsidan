import type { DesktopPermissionMode } from "./DesktopHostAdapter";
import type { DesktopWorkspaceState } from "./RuntimeStateHostPort";

export interface DesktopProject {
	id: string;
	name: string;
	root: string;
	manifestPath?: string;
}

export interface DesktopProjectLayout {
	root: string;
	fridayRoot: string;
	createdPaths: string[];
}

export interface GitProfile {
	branch?: string;
	remote?: string;
	isRepository: boolean;
	hasUncommittedChanges?: boolean;
}

export interface DesktopProjectGitProfile extends GitProfile {
	shareFridayLayer?: boolean;
	lastCheckedAt?: string;
}

export interface DesktopProjectManifest {
	schemaVersion: number;
	projectId: string;
	name: string;
	rootPath: string;
	createdAt: string;
	updatedAt: string;
	defaultPermissionMode: DesktopPermissionMode;
	gitProfile: DesktopProjectGitProfile;
}

export interface InitializeDesktopProjectOptions {
	projectId?: string;
	name?: string;
	defaultPermissionMode?: DesktopPermissionMode;
	gitProfile?: Partial<DesktopProjectGitProfile>;
}

export interface DesktopProjectSession {
	project: DesktopProject;
	manifest: DesktopProjectManifest;
	workspaceState: DesktopWorkspaceState | null;
}

export interface ProjectHostPort {
	getActiveProject(): Promise<DesktopProject | null>;
	getProjectRoot(projectId: string): Promise<string>;
	initializeProject(projectRoot: string, options?: InitializeDesktopProjectOptions): Promise<DesktopProjectSession>;
	initializeFridayLayout(projectRoot: string): Promise<DesktopProjectLayout>;
	getGitProfile(projectId: string): Promise<GitProfile>;
}
