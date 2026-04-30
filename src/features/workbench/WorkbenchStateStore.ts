import { SyncResult } from "../../types/project";
import type { SyncConflictRecord } from "../../types/sync";

export interface SyncReportRecord {
	projectId: string;
	result: SyncResult;
	recordedAt: string;
}

export interface ConflictProposalRecord {
	projectId: string;
	filePath: string;
	markdown: string;
	recommendedStrategy: "ours" | "theirs" | "manual";
	recordedAt: string;
	status: "pending" | "applied" | "rejected";
	appliedStrategy?: "ours" | "theirs" | "manual";
}

export interface EditPlanRecord {
	id: string;
	agentId: string;
	originConversationId?: string;
	originTurnId?: string;
	originTaskId?: string;
	toolCallId?: string;
	tool: string;
	recordedAt: string;
	items: Array<{
		path: string;
		before: string;
		after: string;
		beforeHash?: string;
		afterHash?: string;
		status: "pending" | "accepted" | "rejected" | "applied" | "rolled_back" | "conflicted";
		changeType: "create" | "update" | "delete";
		riskLevel?: "standard" | "high";
		summary?: string;
	}>;
}

export interface SyncStatusSnapshotRecord {
	projectId: string;
	stage: string;
	message: string;
	recordedAt: string;
}

export class WorkbenchStateStore {
	private syncReports: SyncReportRecord[] = [];
	private syncStatusSnapshots: SyncStatusSnapshotRecord[] = [];
	private syncConflicts: SyncConflictRecord[] = [];
	private conflictProposals: ConflictProposalRecord[] = [];
	private editPlans: EditPlanRecord[] = [];
	private qualityReport = "";

	getSyncReports(): SyncReportRecord[] {
		return [...this.syncReports];
	}

	setSyncReports(reports: SyncReportRecord[]): void {
		this.syncReports = [...reports];
	}

	recordSyncReport(report: SyncReportRecord): void {
		this.syncReports = [report, ...this.syncReports.filter((item) => item.projectId !== report.projectId)].slice(0, 20);
	}

	clearSyncReports(): void {
		this.syncReports = [];
	}

	recordSyncStatusSnapshot(record: SyncStatusSnapshotRecord): void {
		this.syncStatusSnapshots = [
			record,
			...this.syncStatusSnapshots.filter((item) => item.projectId !== record.projectId),
		].slice(0, 20);
	}

	getSyncStatusSnapshots(): SyncStatusSnapshotRecord[] {
		return [...this.syncStatusSnapshots];
	}

	replaceProjectSyncConflicts(projectId: string, records: SyncConflictRecord[]): void {
		this.syncConflicts = [
			...this.syncConflicts.filter((item) => item.projectId !== projectId),
			...records.map((item) => ({ ...item })),
		];
	}

	getSyncConflicts(projectId?: string): SyncConflictRecord[] {
		return this.syncConflicts
			.filter((item) => !projectId || item.projectId === projectId)
			.map((item) => ({ ...item }));
	}

	replaceSyncConflict(record: SyncConflictRecord): void {
		this.syncConflicts = [
			record,
			...this.syncConflicts.filter(
				(item) => !(item.projectId === record.projectId && item.filePath === record.filePath),
			),
		];
	}

	clearSyncConflicts(projectId?: string): void {
		if (!projectId) {
			this.syncConflicts = [];
			return;
		}
		this.syncConflicts = this.syncConflicts.filter((item) => item.projectId !== projectId);
	}

	recordConflictProposal(record: ConflictProposalRecord): void {
		this.conflictProposals = [
			record,
			...this.conflictProposals.filter(
				(item) => !(item.projectId === record.projectId && item.filePath === record.filePath),
			),
		].slice(0, 20);
	}

	getConflictProposals(): ConflictProposalRecord[] {
		return this.conflictProposals.map((item) => ({ ...item }));
	}

	clearConflictProposals(): void {
		this.conflictProposals = [];
	}

	replaceConflictProposal(record: ConflictProposalRecord): void {
		this.recordConflictProposal(record);
	}

	recordEditPlan(record: EditPlanRecord): void {
		this.editPlans = [record, ...this.editPlans.filter((item) => item.id !== record.id)].slice(0, 20);
	}

	getEditPlans(): EditPlanRecord[] {
		return this.editPlans.map((item) => ({
			...item,
			items: item.items.map((entry) => ({ ...entry })),
		}));
	}

	replaceEditPlan(record: EditPlanRecord): void {
		this.editPlans = [record, ...this.editPlans.filter((item) => item.id !== record.id)].slice(0, 20);
	}

	clearEditPlans(): void {
		this.editPlans = [];
	}

	getQualityReport(): string {
		return this.qualityReport;
	}

	setQualityReport(markdown: string): void {
		this.qualityReport = markdown;
	}
}
