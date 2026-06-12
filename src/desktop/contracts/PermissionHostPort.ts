import type { DesktopPermissionMode, DesktopTurnContext } from "./DesktopHostAdapter";

export interface DesktopPermissionSnapshot {
	turnId: string;
	mode: DesktopPermissionMode;
	allowedScopes: string[];
	requiresApprovalFor: string[];
}

export interface PermissionApprovalRequest {
	action: string;
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
