import type { ToolExecutionListRequest, ToolExecutionPort, ToolExecutionRequest, ToolExecutionResult } from "../core/agent-kernel/ToolExecutionPort";
import type { RuntimeEnvelope } from "../core/agent-kernel/RuntimeProtocol";
import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import type { RuntimeMutationPlan } from "../core/agent-kernel/contracts";
import type { ToolDefinition } from "../types/tools";

export interface ToolExecutionAdapterDelegate {
	listNativeTools(input: ToolExecutionListRequest): Promise<ToolDefinition[]>;
	executeTool(input: ToolExecutionRequest): Promise<ToolExecutionResult>;
	recordMutationPlans?(
		envelope: RuntimeEnvelope,
		source: string,
		context?: AgentExecutionContext,
	): RuntimeMutationPlan[] | Promise<RuntimeMutationPlan[]>;
}

export class ToolExecutionAdapter implements ToolExecutionPort {
	constructor(private readonly delegate: ToolExecutionAdapterDelegate) {}

	listNativeTools(input: ToolExecutionListRequest): Promise<ToolDefinition[]> {
		return this.delegate.listNativeTools(input);
	}

	executeTool(input: ToolExecutionRequest): Promise<ToolExecutionResult> {
		return this.delegate.executeTool(input);
	}

	recordMutationPlans(
		envelope: RuntimeEnvelope,
		source: string,
		context: AgentExecutionContext,
	): RuntimeMutationPlan[] | Promise<RuntimeMutationPlan[]> {
		return this.delegate.recordMutationPlans?.(envelope, source, context) ?? [];
	}
}
