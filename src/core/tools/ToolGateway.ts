import {
	CapabilityPolicy,
	type CapabilityDecision,
	type CapabilityPolicyInput,
} from "../policy/CapabilityPolicy";
import { ToolGovernor, type ToolFailureClass } from "../tool-governor/ToolGovernor";
import { ToolRegistry } from "./ToolRegistry";

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

export interface ToolGatewayAuditPolicy {
	allow: boolean;
	code?: string;
	reason: string;
	approval: "none" | "standard" | "strict";
}

export interface ToolGatewayAuditApproval {
	requested: boolean;
	allowed: boolean;
	persisted: boolean;
	viaRule: boolean;
	reason: string;
}

export interface ToolGatewayAuditExecution {
	attempted: boolean;
	status: "ok" | "failed" | "denied";
	failureClass?: ToolFailureClass;
}

export interface ToolGatewayAudit {
	tool: string;
	capability: string;
	scope: ToolGatewayApprovalScope;
	targetPath: string;
	policy: ToolGatewayAuditPolicy;
	approval?: ToolGatewayAuditApproval;
	execution: ToolGatewayAuditExecution;
}

export interface ToolGatewayRunResult<T> {
	status: "ok" | "denied" | "failed";
	decision: CapabilityDecision;
	audit: ToolGatewayAudit;
	approval?: ToolGatewayApprovalResult;
	data?: T;
	error?: string;
}

export class ToolGateway {
	private readonly registry = ToolRegistry.getInstance();

	constructor(
		private readonly policy: CapabilityPolicy = new CapabilityPolicy(),
		private readonly governor: ToolGovernor = new ToolGovernor(),
	) {}

	async run<T>(input: ToolGatewayRunInput<T>): Promise<ToolGatewayRunResult<T>> {
		const decision = this.policy.evaluateToolCall(input.policyInput);
		const audit = this.createAudit(input.policyInput, decision);
		if (!decision.allow) {
			return {
				status: "denied",
				decision,
				audit,
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
			audit.approval = {
				requested: Boolean(input.approvalRequest && input.requestApproval),
				allowed: approval.allowed,
				persisted: approval.persisted,
				viaRule: approval.viaRule,
				reason: approval.reason,
			};

			if (!approval.allowed) {
				return {
					status: "denied",
					decision,
					audit,
					approval,
					error: approval.reason,
				};
			}
		}

		try {
			audit.execution.attempted = true;
			const data = await input.execute();
			audit.execution.status = "ok";
			return {
				status: "ok",
				decision,
				audit,
				approval,
				data,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			audit.execution.attempted = true;
			audit.execution.status = "failed";
			audit.execution.failureClass = this.governor.classifyFailure(message);
			return {
				status: "failed",
				decision,
				audit,
				approval,
				error: message,
			};
		}
	}

	private createAudit(input: CapabilityPolicyInput, decision: CapabilityDecision): ToolGatewayAudit {
		const toolName = input.toolName.trim().toLowerCase();
		const tool = this.registry.get(toolName);
		return {
			tool: toolName,
			capability: tool?.capability ?? "unknown",
			scope: input.scope ?? "any",
			targetPath: input.targetPath ?? "",
			policy: {
				allow: decision.allow,
				...(decision.allow ? {} : { code: decision.code }),
				reason: decision.reason,
				approval: decision.allow ? decision.approval : "none",
			},
			execution: {
				attempted: false,
				status: "denied",
			},
		};
	}
}
