import type { ToolCall, ToolDefinition } from "../../types/tools";
import type { AgentExecutionContext } from "./AgentExecutionContext";
import type { AgentTurnInput, RuntimeMutationPlan, RuntimeToolTrace } from "./contracts";
import type { RuntimeEnvelope } from "./RuntimeProtocol";

export interface ToolExecutionListRequest {
	input?: AgentTurnInput;
	context?: AgentExecutionContext;
	allowedTools?: string[];
}

export interface ToolExecutionRequest {
	input?: AgentTurnInput;
	context?: AgentExecutionContext;
	step: number;
	tool: ToolCall;
}

export interface ToolExecutionResult {
	trace: RuntimeToolTrace;
	payload: {
		ok: boolean;
		tool: string;
		data?: unknown;
		error?: string;
	};
	modelResultText: string;
	loadedSkillContext?: string;
}

export interface ToolExecutionPort {
	listNativeTools(input: ToolExecutionListRequest): Promise<ToolDefinition[]>;
	executeTool(input: ToolExecutionRequest): Promise<ToolExecutionResult>;
	recordMutationPlans?(
		envelope: RuntimeEnvelope,
		source: string,
		context: AgentExecutionContext,
	): RuntimeMutationPlan[] | Promise<RuntimeMutationPlan[]>;
}
