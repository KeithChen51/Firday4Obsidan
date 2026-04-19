export type MemoryScope = "global" | "project";
export type MemoryAction = "add" | "replace" | "remove";

export interface MemoryWriteInput {
	action: MemoryAction;
	scope: MemoryScope;
	content?: string;
	oldText?: string;
	projectRoot?: string;
}

export interface MemoryWriteResult {
	ok: boolean;
	code:
		| "written"
		| "duplicate"
		| "missing_project"
		| "invalid_input"
		| "not_found"
		| "ambiguous_match"
		| "capacity_exceeded";
	scope: MemoryScope;
	path: string;
	summary: string;
	reason?: string;
	currentSize?: number;
	limit?: number;
	matches?: string[];
	appliesOnNextTurn?: boolean;
}
