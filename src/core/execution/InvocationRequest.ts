export type InvocationSource =
	| "chat_prompt"
	| "slash_skill"
	| "slash_command"
	| "project_action"
	| "system_event"
	| "auto_skill_match"
	| "service_call";

export type InvocationIntentType = "skill" | "tool" | "plan" | "event" | "runtime";

export interface InvocationRequest {
	source: InvocationSource;
	intentType: InvocationIntentType;
	targetId?: string;
	prompt?: string;
	payload?: Record<string, unknown>;
	projectSlug?: string;
	sessionId?: string;
}
