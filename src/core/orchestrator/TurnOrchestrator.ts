import type { RuntimeProgressEvent } from "../../services/AgentRuntimeService";
import { StepEventName, TurnStateMachine } from "../turn-state/TurnStateMachine";

const PHASE_TO_STEP_EVENT: Record<RuntimeProgressEvent["phase"], StepEventName> = {
	start: "STEP_START",
	intake: "STEP_NARRATION",
	plan: "STEP_CHECKPOINT",
	narration: "STEP_NARRATION",
	context: "STEP_CONTEXT",
	model_request: "STEP_MODEL_REQUEST",
	model_retry: "STEP_MODEL_RETRY",
	model_response: "STEP_MODEL_RESPONSE",
	checkpoint: "STEP_CHECKPOINT",
	tool_approval: "STEP_TOOL_APPROVAL",
	tool_call: "STEP_TOOL_CALL",
	tool_result: "STEP_TOOL_RESULT",
	fallback: "STEP_FALLBACK",
	done: "STEP_DONE",
	error: "STEP_ERROR",
};

export class TurnOrchestrator {
	appendProgress(stateMachine: TurnStateMachine, event: RuntimeProgressEvent): void {
		stateMachine.append({
			stepName: PHASE_TO_STEP_EVENT[event.phase],
			depth: event.depth,
			step: event.step,
			tool: event.tool,
			contextKey: event.contextKey,
			activeFileContext: event.activeFileContext,
			targetPath: event.targetPath,
			status: event.status,
			summary: event.summary,
			transport: event.transport,
			checkpoint: event.checkpoint,
			narration: event.narration,
			message: event.message,
		});
	}
}
