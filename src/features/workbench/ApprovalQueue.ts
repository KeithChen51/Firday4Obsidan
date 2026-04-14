import type { ApprovalDecision, ToolApprovalRequest } from "../../services/ToolApprovalService";

export interface PendingApproval {
	id: string;
	request: ToolApprovalRequest;
	createdAt: string;
}

interface QueueEntry extends PendingApproval {
	resolve: (decision: ApprovalDecision) => void;
}

export class ApprovalQueue {
	private readonly entries: QueueEntry[] = [];

	enqueue(request: ToolApprovalRequest): Promise<ApprovalDecision> {
		return new Promise((resolve) => {
			this.entries.push({
				id: this.createId(),
				request,
				createdAt: new Date().toISOString(),
				resolve,
			});
		});
	}

	list(): PendingApproval[] {
		return this.entries.map(({ resolve: _resolve, ...rest }) => rest);
	}

	resolve(id: string, decision: ApprovalDecision): void {
		const index = this.entries.findIndex((item) => item.id === id);
		if (index < 0) {
			return;
		}
		const [entry] = this.entries.splice(index, 1);
		entry?.resolve(decision);
	}

	clearWithDecision(decision: ApprovalDecision): void {
		const pending = [...this.entries];
		this.entries.length = 0;
		for (const entry of pending) {
			entry.resolve(decision);
		}
	}

	private createId(): string {
		return `approval-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	}
}
