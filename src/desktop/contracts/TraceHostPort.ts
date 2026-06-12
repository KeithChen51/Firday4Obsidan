import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface DesktopTraceEvent {
	id?: string;
	type: string;
	at: string;
	summary?: string;
	payload?: Record<string, unknown>;
}

export interface TraceQuery {
	projectId: string;
	conversationId?: string;
	turnId?: string;
	type?: string;
	limit?: number;
}

export interface TraceHostPort {
	appendTraceEvent(context: DesktopTurnContext, event: DesktopTraceEvent): Promise<DesktopTraceEvent>;
	queryTraceEvents(query: TraceQuery): Promise<DesktopTraceEvent[]>;
	replayTraceEvents(query: TraceQuery): AsyncIterable<DesktopTraceEvent>;
}
