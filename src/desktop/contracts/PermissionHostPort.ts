import type { DesktopPermissionMode, DesktopTurnContext } from "./DesktopHostAdapter";

export type DesktopPermissionAction =
	| "read_project_file"
	| "write_project_file"
	| "write_friday_artifact"
	| "write_managed_file"
	| "delete_project_file"
	| "run_command"
	| "network_access"
	| "git_push"
	| "install_dependency"
	| "enable_skill";

export interface DesktopPermissionSnapshot {
	turnId: string;
	mode: DesktopPermissionMode;
	allowedScopes: string[];
	requiresApprovalFor: string[];
}

export interface PermissionApprovalRequest {
	action: DesktopPermissionAction;
	summary: string;
	target?: string;
	risk?: "low" | "medium" | "high";
}

export interface PermissionDecision {
	allowed: boolean;
	requiresReview: boolean;
	reason?: string;
	traceEventId: string;
}

export interface PermissionHostPort {
	getPermissionMode(projectId: string, conversationId: string): Promise<DesktopPermissionMode>;
	snapshotTurnPermissions(context: DesktopTurnContext): Promise<DesktopPermissionSnapshot>;
	requestApproval(context: DesktopTurnContext, request: PermissionApprovalRequest): Promise<PermissionDecision>;
	cancelTurn(context: DesktopTurnContext, reason?: string): Promise<void>;
	isTurnCancelled(context: DesktopTurnContext): Promise<boolean>;
}
