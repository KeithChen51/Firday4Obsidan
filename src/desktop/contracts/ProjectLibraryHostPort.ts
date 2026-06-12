import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface ProjectContextItem {
	id: string;
	path: string;
	title?: string;
	description?: string;
	enabled: boolean;
	metadata?: Record<string, unknown>;
}

export interface ProjectFileTreeEntry {
	path: string;
	name: string;
	type: "file" | "directory";
	children?: ProjectFileTreeEntry[];
	contextItemId?: string;
}

export interface ProjectLibraryHostPort {
	registerContextItem(context: DesktopTurnContext, item: ProjectContextItem): Promise<ProjectContextItem>;
	listContextItems(projectId: string): Promise<ProjectContextItem[]>;
	updateContextItem(context: DesktopTurnContext, item: ProjectContextItem): Promise<ProjectContextItem>;
	readProjectFileTree(projectId: string): Promise<ProjectFileTreeEntry[]>;
}
