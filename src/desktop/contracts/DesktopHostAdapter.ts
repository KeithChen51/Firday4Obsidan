import type { ArtifactHostPort } from "./ArtifactHostPort";
import type { FileSystemHostPort } from "./FileSystemHostPort";
import type { PermissionHostPort } from "./PermissionHostPort";
import type { ProjectHostPort } from "./ProjectHostPort";
import type { ProjectLibraryHostPort } from "./ProjectLibraryHostPort";
import type { RuntimeStateHostPort } from "./RuntimeStateHostPort";
import type { SkillHostPort } from "./SkillHostPort";
import type { ToolExecutionHostPort } from "./ToolExecutionHostPort";
import type { TraceHostPort } from "./TraceHostPort";

export type DesktopPermissionMode = "safe" | "standard" | "autonomous";

export interface DesktopTurnContext {
	projectId: string;
	conversationId: string;
	turnId: string;
	permissionMode: DesktopPermissionMode;
	projectRoot: string;
}

export interface DesktopHostAdapter {
	project: ProjectHostPort;
	fileSystem: FileSystemHostPort;
	runtimeState: RuntimeStateHostPort;
	permissions: PermissionHostPort;
	trace: TraceHostPort;
	tools: ToolExecutionHostPort;
	artifacts: ArtifactHostPort;
	library: ProjectLibraryHostPort;
	skills: SkillHostPort;
}

export type { ArtifactHostPort } from "./ArtifactHostPort";
export type { FileSystemHostPort } from "./FileSystemHostPort";
export type { PermissionHostPort } from "./PermissionHostPort";
export type { ProjectHostPort } from "./ProjectHostPort";
export type { ProjectLibraryHostPort } from "./ProjectLibraryHostPort";
export type { RuntimeStateHostPort } from "./RuntimeStateHostPort";
export type { SkillHostPort } from "./SkillHostPort";
export type { ToolExecutionHostPort } from "./ToolExecutionHostPort";
export type { TraceHostPort } from "./TraceHostPort";
