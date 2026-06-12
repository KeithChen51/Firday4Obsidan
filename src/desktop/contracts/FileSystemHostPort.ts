import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface ProjectFileReadResult {
	path: string;
	content: string;
	mtime?: string;
}

export interface ProjectFileWriteInput {
	path: string;
	content: string;
	reason?: string;
}

export interface ExternalImportSnapshot {
	importId: string;
	sourcePath: string;
	managedPath: string;
	hash?: string;
	mimeType?: string;
	createdTurnId: string;
}

export interface ManagedFileWriteInput {
	path: string;
	content: string;
	atomic?: boolean;
	reason?: string;
}

export interface FileSystemHostPort {
	readProjectFile(context: DesktopTurnContext, relativePath: string): Promise<ProjectFileReadResult>;
	writeProjectFile(context: DesktopTurnContext, input: ProjectFileWriteInput): Promise<void>;
	importExternalFileSnapshot(context: DesktopTurnContext, sourcePath: string): Promise<ExternalImportSnapshot>;
	normalizeProjectPath(projectRoot: string, candidatePath: string): Promise<string>;
	writeManagedFile(context: DesktopTurnContext, input: ManagedFileWriteInput): Promise<void>;
}
