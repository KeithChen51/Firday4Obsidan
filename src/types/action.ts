export type AgentActionType = "create" | "update" | "delete";
export type AgentActionTargetType = "markdown" | "canvas";

export interface AgentAction {
	type: AgentActionType;
	targetType: AgentActionTargetType;
	path: string;
	content?: string;
}

export interface AgentActionPreview {
	path: string;
	type: AgentActionType;
	targetType: AgentActionTargetType;
	summary: string;
}

