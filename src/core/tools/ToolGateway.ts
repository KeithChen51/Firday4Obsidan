import {
	CapabilityPolicy,
	type CapabilityDecision,
	type CapabilityPolicyInput,
} from "../policy/CapabilityPolicy";

export type ToolGatewayApprovalScope = "vault" | "external" | "any";

export interface ToolGatewayApprovalRequest {
	agentId: string;
	tool: string;
	scope: ToolGatewayApprovalScope;
	targetPath?: string;
	description: string;
}

export interface ToolGatewayApprovalResult {
	allowed: boolean;
	persisted: boolean;
	viaRule: boolean;
	reason: string;
}

export interface ToolGatewayRunInput<T> {
	policyInput: CapabilityPolicyInput;
	approvalRequest?: ToolGatewayApprovalRequest;
	requestApproval?: (request: ToolGatewayApprovalRequest) => Promise<ToolGatewayApprovalResult>;
	execute: () => Promise<T>;
}

export interface ToolGatewayRunResult<T> {
	status: "ok" | "denied" | "failed";
	decision: CapabilityDecision;
	approval?: ToolGatewayApprovalResult;
	data?: T;
	error?: string;
}

export class ToolGateway {
	constructor(private readonly policy: CapabilityPolicy = new CapabilityPolicy()) {}

	async run<T>(input: ToolGatewayRunInput<T>): Promise<ToolGatewayRunResult<T>> {
		const decision = this.policy.evaluateToolCall(input.policyInput);
		if (!decision.allow) {
			return {
				status: "denied",
				decision,
				error: decision.reason,
			};
		}

		let approval: ToolGatewayApprovalResult | undefined;
		if (decision.approval !== "none") {
			if (!input.approvalRequest || !input.requestApproval) {
				approval = {
					allowed: false,
					persisted: false,
					viaRule: false,
					reason: "Approval port unavailable.",
				};
			} else {
				approval = await input.requestApproval(input.approvalRequest);
			}

			if (!approval.allowed) {
				return {
					status: "denied",
					decision,
					approval,
					error: approval.reason,
				};
			}
		}

		try {
			const data = await input.execute();
			return {
				status: "ok",
				decision,
				approval,
				data,
			};
		} catch (error) {
			return {
				status: "failed",
				decision,
				approval,
				error: error instanceof Error ? error.message : String(error ?? ""),
			};
		}
	}
}
