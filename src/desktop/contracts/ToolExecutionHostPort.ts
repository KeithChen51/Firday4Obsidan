import type { DesktopTurnContext } from "./DesktopHostAdapter";

export interface DesktopToolInvocation {
	id: string;
	toolName: string;
	input: Record<string, unknown>;
	reason?: string;
}

export interface DesktopToolResult {
	invocationId: string;
	status: "ok" | "error" | "cancelled";
	output?: unknown;
	error?: string;
	traceEventId?: string;
}

export interface ToolExecutionHostPort {
	executeToolInvocation(context: DesktopTurnContext, invocation: DesktopToolInvocation): Promise<DesktopToolResult>;
}
