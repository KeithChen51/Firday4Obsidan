import type { ActiveFileContext } from "../context/ActiveFileContext";
import type { AgentNarrationPayload } from "../agent-kernel/contracts/AgentTurn";

export type StepEventName =
	| "STEP_START"
	| "STEP_NARRATION"
	| "STEP_CONTEXT"
	| "STEP_MODEL_REQUEST"
	| "STEP_MODEL_RETRY"
	| "STEP_MODEL_RESPONSE"
	| "STEP_CHECKPOINT"
	| "STEP_TOOL_APPROVAL"
	| "STEP_TOOL_CALL"
	| "STEP_TOOL_RESULT"
	| "STEP_FALLBACK"
	| "STEP_DONE"
	| "STEP_ERROR";

export interface StepTraceEvent {
	turnId: string;
	index: number;
	stepName: StepEventName;
	timestamp: string;
	depth: number;
	step?: number;
	tool?: string;
	contextKey?: "instructions" | "skills" | "wiki" | "memory" | "compact";
	activeFileContext?: ActiveFileContext;
	targetPath?: string;
	status?: "ok" | "failed" | "denied";
	summary?: string;
	transport?: {
		type: string;
		requestId: string;
		attempt: number;
		maxAttempts: number;
		delayMs?: number;
		httpStatus?: number;
		retryable: boolean;
		channel: string;
		endpointIndex: number;
		endpointCount: number;
	};
	checkpoint?: {
		type: "saved" | "resume_started" | "resume_rejected" | "resume_completed";
		checkpointId: string;
		boundary: string;
		canAutoResume?: boolean;
		reason?: string;
	};
	narration?: AgentNarrationPayload;
	message: string;
}

export class TurnStateMachine {
	private readonly traces: StepTraceEvent[] = [];
	private index = 0;

	constructor(private readonly turnId: string) {}

	append(event: Omit<StepTraceEvent, "turnId" | "index" | "timestamp">): StepTraceEvent {
		const trace: StepTraceEvent = {
			turnId: this.turnId,
			index: ++this.index,
			timestamp: new Date().toISOString(),
			...event,
		};
		this.traces.push(trace);
		return trace;
	}

	snapshot(): StepTraceEvent[] {
		return [...this.traces];
	}
}
