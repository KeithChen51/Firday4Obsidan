import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface DesktopConversationRecord {
	id: string;
	projectId: string;
	title?: string;
	createdAt: string;
	updatedAt: string;
}

export interface DesktopTurnRecord {
	id: string;
	conversationId: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	createdAt: string;
}

export interface DesktopReferenceRecord {
	id: string;
	conversationId: string;
	turnId?: string;
	targetUri: string;
	source: "mention" | "friday_read" | "artifact" | "selection" | "trace";
}

export interface DesktopWorkspaceState {
	activeProjectId?: string;
	activeConversationId?: string;
	activeArtifactId?: string;
	layout?: Record<string, unknown>;
	resourcePanelState?: Record<string, unknown>;
}

export interface RuntimeStateHostPort {
	saveConversation(record: DesktopConversationRecord): Promise<void>;
	saveTurn(context: DesktopTurnContext, record: DesktopTurnRecord): Promise<void>;
	saveTrace(context: DesktopTurnContext, trace: Record<string, unknown>): Promise<void>;
	saveReference(context: DesktopTurnContext, reference: DesktopReferenceRecord): Promise<void>;
	saveArtifact(context: DesktopTurnContext, artifact: Record<string, unknown>): Promise<void>;
	saveWorkspaceState(projectId: string, state: DesktopWorkspaceState): Promise<void>;
	restoreWorkspaceState(projectId: string): Promise<DesktopWorkspaceState | null>;
}
