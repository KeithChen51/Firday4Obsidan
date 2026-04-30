export type MutationOperation = "write" | "edit" | "delete";
export type MutationChangeType = "create" | "update" | "delete";
export type MutationPlanStatus = "pending" | "applied" | "rejected" | "conflicted";
export type MutationApplyStatus = MutationPlanStatus | "failed";
export type MutationRiskLevel = "standard" | "high";
export type MutationStoredContentMode = "inline" | "patch" | "blob" | "omitted";

export interface MutationContentPatch {
	type: "replace_range";
	start: number;
	deleteCount: number;
	insert: string;
}

export interface MutationContentStorage {
	before: "inline" | "omitted";
	after: MutationStoredContentMode;
}

export interface MutationContentBlob {
	key: string;
	hash: string;
	size: number;
}

export interface MutationPlanItem {
	path: string;
	before: string;
	after: string;
	beforeHash: string;
	afterHash: string;
	status: MutationPlanStatus;
	changeType: MutationChangeType;
	proposedPatch?: MutationContentPatch;
	proposedBlob?: MutationContentBlob;
	contentStorage?: MutationContentStorage;
}

export interface MutationPlan {
	id: string;
	agentId: string;
	conversationId?: string;
	turnId?: string;
	taskId?: string;
	toolCallId?: string;
	operation: MutationOperation;
	targetPath: string;
	beforeHash: string;
	proposedHash: string;
	riskLevel: MutationRiskLevel;
	summary: string;
	status: MutationPlanStatus;
	createdAt: string;
	items: MutationPlanItem[];
}

export interface CreateMutationPlanInput {
	id?: string;
	agentId: string;
	conversationId?: string;
	turnId?: string;
	taskId?: string;
	toolCallId?: string;
	operation: MutationOperation;
	targetPath: string;
	before: string;
	after: string;
	summary: string;
	changeType?: MutationChangeType;
	riskLevel?: MutationRiskLevel;
	createdAt?: string;
}

export function createMutationPlan(input: CreateMutationPlanInput): MutationPlan {
	const changeType = input.changeType ?? resolveChangeType(input.operation, input.before);
	const beforeHash = hashMutationContent(input.before);
	const afterHash = hashMutationContent(input.after);
	const riskLevel = input.riskLevel ?? (changeType === "delete" || input.operation === "delete" ? "high" : "standard");
	return {
		id: input.id ?? `mutation-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
		agentId: input.agentId,
		...(input.conversationId ? { conversationId: input.conversationId } : {}),
		...(input.turnId ? { turnId: input.turnId } : {}),
		...(input.taskId ? { taskId: input.taskId } : {}),
		...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
		operation: input.operation,
		targetPath: input.targetPath,
		beforeHash,
		proposedHash: afterHash,
		riskLevel,
		summary: input.summary,
		status: "pending",
		createdAt: input.createdAt ?? new Date().toISOString(),
		items: [
			{
				path: input.targetPath,
				before: input.before,
				after: input.after,
				beforeHash,
				afterHash,
				status: "pending",
				changeType,
				contentStorage: {
					before: "inline",
					after: "inline",
				},
			},
		],
	};
}

export function cloneMutationPlan(plan: MutationPlan): MutationPlan {
	return {
		...plan,
		items: plan.items.map((item) => ({
			...item,
			...(item.proposedPatch ? { proposedPatch: { ...item.proposedPatch } } : {}),
			...(item.proposedBlob ? { proposedBlob: { ...item.proposedBlob } } : {}),
			...(item.contentStorage ? { contentStorage: { ...item.contentStorage } } : {}),
		})),
	};
}

export function setMutationPlanStatus(plan: MutationPlan, status: MutationPlanStatus): MutationPlan {
	const next = cloneMutationPlan(plan);
	next.status = status;
	next.items = next.items.map((item) => ({
		...item,
		status,
	}));
	return next;
}

export function hashMutationContent(content: string): string {
	let hash = 2166136261;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function resolveChangeType(operation: MutationOperation, before: string): MutationChangeType {
	if (operation === "delete") {
		return "delete";
	}
	return before.length > 0 ? "update" : "create";
}
