export type KnowledgeScope = "global_user" | "project_agent" | "global_playbook";

export type KnowledgeStatus = "active" | "needs_review" | "superseded";

export interface KnowledgeRecord {
	id: string;
	scope: KnowledgeScope;
	category: string;
	content: string;
	sourceSessionIds: string[];
	confidence: number;
	status: KnowledgeStatus;
	updatedAt: string;
}

export interface KnowledgeBucket {
	title: string;
	records: KnowledgeRecord[];
}

export interface KnowledgeSummary {
	lastRunAt: string;
	globalUserCount: number;
	projectCount: number;
	needsReviewCount: number;
	budgetHitRate: number;
}
