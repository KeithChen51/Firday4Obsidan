import type { InvocationSource } from "./InvocationRequest";

export type RuntimeEventType =
	| "knowledge.compile_requested"
	| "sync.conflict_proposal_requested"
	| "memory.extraction_requested";

export interface RuntimeEvent {
	type: RuntimeEventType;
	source: InvocationSource;
	prompt?: string;
	projectSlug?: string;
	currentFilePath?: string;
	payload?: Record<string, unknown>;
}
