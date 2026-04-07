export type ToolCallingMode = "auto" | "native" | "prompt";

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolCall {
	id?: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ToolResultEnvelope {
	ok: boolean;
	tool: string;
	data?: unknown;
	error?: string;
}
