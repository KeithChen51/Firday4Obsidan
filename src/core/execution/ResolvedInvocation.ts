import type { InvocationRequest } from "./InvocationRequest";

export type ResolvedInvocationType = "skill" | "tool" | "plan" | "event" | "runtime";

export interface ResolvedInvocation {
	request: InvocationRequest;
	resolvedType: ResolvedInvocationType;
	resolvedId: string;
	requiresRuntime?: boolean;
	requiredCapabilities?: string[];
}
