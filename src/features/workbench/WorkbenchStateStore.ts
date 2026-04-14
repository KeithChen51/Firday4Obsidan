import { SyncResult } from "../../types/project";

export interface SyncReportRecord {
	projectSlug: string;
	result: SyncResult;
	recordedAt: string;
}

export interface ProjectEditorRequest {
	mode: "create" | "edit";
	projectSlug?: string;
}

export interface ConflictProposalRecord {
	projectSlug: string;
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
	tool: string;
	recordedAt: string;
	items: Array<{
		path: string;
		before: string;
		after: string;
		status: "pending" | "accepted" | "rejected" | "applied" | "rolled_back";
		changeType: "create" | "update" | "delete";
	}>;
}

export class WorkbenchStateStore {
	private syncReports: SyncReportRecord[] = [];
	private projectEditorRequest: ProjectEditorRequest | null = null;
	private conflictProposals: ConflictProposalRecord[] = [];
	private editPlans: EditPlanRecord[] = [];

	getSyncReports(): SyncReportRecord[] {
		return [...this.syncReports];
	}

	setSyncReports(reports: SyncReportRecord[]): void {
		this.syncReports = [...reports];
	}

	recordSyncReport(report: SyncReportRecord): void {
		this.syncReports = [report, ...this.syncReports.filter((item) => item.projectSlug !== report.projectSlug)].slice(0, 20);
	}

	clearSyncReports(): void {
		this.syncReports = [];
	}

	setProjectEditorRequest(request: ProjectEditorRequest): void {
		this.projectEditorRequest = request;
	}

	consumeProjectEditorRequest(): ProjectEditorRequest | null {
		const current = this.projectEditorRequest;
		this.projectEditorRequest = null;
		return current;
	}

	recordConflictProposal(record: ConflictProposalRecord): void {
		this.conflictProposals = [
			record,
			...this.conflictProposals.filter(
				(item) => !(item.projectSlug === record.projectSlug && item.filePath === record.filePath),
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
}
