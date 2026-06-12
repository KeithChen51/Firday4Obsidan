import type { DesktopTurnContext } from "../../contracts/DesktopHostAdapter";
import type { DesktopTraceEvent, TraceHostPort, TraceQuery } from "../../contracts/TraceHostPort";
import { TraceStore, type TraceStoreOptions } from "../../state/TraceStore";

export class DesktopTraceHost implements TraceHostPort {
	private readonly store: TraceStore;

	constructor(projectRoot: string, options: TraceStoreOptions = {}) {
		this.store = new TraceStore(projectRoot, options);
	}

	appendTraceEvent(context: DesktopTurnContext, event: DesktopTraceEvent): Promise<DesktopTraceEvent> {
		return this.store.appendTraceEvent(context, event);
	}

	queryTraceEvents(query: TraceQuery): Promise<DesktopTraceEvent[]> {
		return this.store.queryTraceEvents(query);
	}

	replayTraceEvents(query: TraceQuery): AsyncIterable<DesktopTraceEvent> {
		return this.store.replayTraceEvents(query);
	}
}
