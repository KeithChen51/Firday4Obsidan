import type { AgentExecutionContext } from "./AgentExecutionContext";

export interface HumanApprovalRequest {
	kind: "tool" | "mutation";
	tool?: string;
	targetPath?: string;
	summary: string;
	approvalId?: string;
	mutationPlanIds?: string[];
}

export interface HumanApprovalResolution {
	tool?: string;
	approved: boolean;
	reason: string;
	approvalId?: string;
}

export interface HumanApprovalPort {
	requestApproval(context: AgentExecutionContext, request: HumanApprovalRequest): Promise<void>;
	resolveApproval(context: AgentExecutionContext, resolution: HumanApprovalResolution): Promise<void>;
}
