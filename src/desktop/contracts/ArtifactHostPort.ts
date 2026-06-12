import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface DesktopArtifactManifest {
	id: string;
	conversationId: string;
	artifactType: string;
	title?: string;
	renderable?: boolean;
	currentVersionId?: string;
	storageMode?: "managed_file" | "project_file_reference";
	metadata?: Record<string, unknown>;
}

export interface ArtifactCreateInput {
	artifactType: string;
	title?: string;
	source?: Record<string, unknown>;
}

export interface ArtifactVersionFile {
	artifactId: string;
	versionId: string;
	path: string;
	contentType?: string;
	size?: number;
	createdAt?: string;
}

export interface ArtifactVersionFileReadResult extends ArtifactVersionFile {
	content: string;
}

export interface ArtifactVersionFileWriteInput {
	artifactId: string;
	versionId: string;
	path: string;
	content: string;
	contentType?: string;
}

export interface ProjectFileArtifactWrapperInput {
	conversationId: string;
	projectFilePath: string;
	artifactType: string;
	title?: string;
}

export interface ArtifactHostPort {
	createArtifact(context: DesktopTurnContext, input: ArtifactCreateInput): Promise<DesktopArtifactManifest>;
	listArtifacts(context: DesktopTurnContext, conversationId: string): Promise<DesktopArtifactManifest[]>;
	openArtifact(context: DesktopTurnContext, artifactId: string): Promise<DesktopArtifactManifest>;
	updateArtifactManifest(context: DesktopTurnContext, manifest: DesktopArtifactManifest): Promise<void>;
	writeArtifactVersionFile(context: DesktopTurnContext, input: ArtifactVersionFileWriteInput): Promise<ArtifactVersionFile>;
	readArtifactVersionFile(context: DesktopTurnContext, artifactId: string, versionId: string, path: string): Promise<ArtifactVersionFileReadResult>;
	listArtifactVersionFiles(context: DesktopTurnContext, artifactId: string, versionId: string): Promise<ArtifactVersionFile[]>;
	createProjectFileArtifactWrapper(context: DesktopTurnContext, input: ProjectFileArtifactWrapperInput): Promise<DesktopArtifactManifest>;
	openProjectFileArtifactWrapper(context: DesktopTurnContext, artifactId: string): Promise<DesktopArtifactManifest>;
}
