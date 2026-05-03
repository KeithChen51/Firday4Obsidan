import type { AgentExecutionContext } from "./AgentExecutionContext";
import {
	createMutationPlan,
	type CreateMutationPlanInput,
	type MutationPlan,
	type MutationPlanStatus,
} from "../mutations/MutationPlan";

export interface AgentMutationStorePort {
	save(plan: MutationPlan): Promise<void>;
	get(planId: string): Promise<MutationPlan | undefined>;
	replace(plan: MutationPlan): Promise<void>;
	markStatus(planId: string, status: MutationPlanStatus): Promise<MutationPlan | undefined>;
}

export interface AgentMutationCoordinatorOptions {
	mutationStore: AgentMutationStorePort;
}

export type AgentMutationCreateInput =
	& Omit<CreateMutationPlanInput, "agentId" | "conversationId" | "turnId" | "taskId" | "traceId">
	& Partial<Pick<CreateMutationPlanInput, "agentId" | "conversationId" | "turnId" | "taskId" | "traceId">>;

export class AgentMutationCoordinator {
	constructor(private readonly options: AgentMutationCoordinatorOptions) {}

	async createPlan(context: AgentExecutionContext, input: AgentMutationCreateInput): Promise<MutationPlan> {
		const plan = createMutationPlan({
			...input,
			agentId: input.agentId ?? context.agentId,
			conversationId: input.conversationId ?? context.conversationId,
			turnId: input.turnId ?? context.turnId,
			taskId: input.taskId ?? context.taskId,
			traceId: input.traceId ?? context.traceId,
		});
		await this.options.mutationStore.save(plan);
		context.emit({
			type: "mutation_planned",
			payload: this.buildMutationPayload(plan, "pending"),
		});
		return plan;
	}

	async markApplied(context: AgentExecutionContext, planId: string, reason?: string): Promise<MutationPlan> {
		const plan = await this.markStatus(planId, "applied");
		context.emit({
			type: "mutation_applied",
			payload: this.buildMutationPayload(plan, "applied", reason),
		});
		return plan;
	}

	async rejectPlan(context: AgentExecutionContext, planId: string, reason?: string): Promise<MutationPlan> {
		const plan = await this.markStatus(planId, "rejected");
		context.emit({
			type: "mutation_rejected",
			payload: this.buildMutationPayload(plan, "rejected", reason),
		});
		return plan;
	}

	private async markStatus(planId: string, status: MutationPlanStatus): Promise<MutationPlan> {
		const plan = await this.options.mutationStore.markStatus(planId, status);
		if (!plan) {
			throw new Error(`Mutation plan not found: ${planId}`);
		}
		return plan;
	}

	private buildMutationPayload(plan: MutationPlan, status: MutationPlanStatus, reason?: string): Record<string, unknown> {
		return {
			id: plan.id,
			taskId: plan.taskId,
			traceId: plan.traceId,
			toolCallId: plan.toolCallId,
			operation: plan.operation,
			targetPath: plan.targetPath,
			beforeHash: plan.beforeHash,
			proposedHash: plan.proposedHash,
			riskLevel: plan.riskLevel,
			status,
			summary: reason ?? plan.summary,
			itemCount: plan.items.length,
			...(reason ? { reason } : {}),
		};
	}
}
