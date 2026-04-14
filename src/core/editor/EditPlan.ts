export interface EditPlanItem {
	path: string;
	before: string;
	after: string;
	status: "pending" | "accepted" | "rejected" | "applied" | "rolled_back";
}

export class EditPlan {
	private readonly entries: EditPlanItem[];

	constructor(
		public readonly id: string,
		items: Array<{ path: string; before: string; after: string }>,
	) {
		this.entries = items.map((item) => ({
			...item,
			status: "pending",
		}));
	}

	items(): EditPlanItem[] {
		return this.entries.map((item) => ({ ...item }));
	}

	accept(path: string): void {
		this.update(path, "accepted");
	}

	reject(path: string): void {
		this.update(path, "rejected");
	}

	markApplied(path: string): void {
		this.update(path, "applied");
	}

	rollbackLastApplied(): EditPlanItem | null {
		const lastApplied = [...this.entries].reverse().find((item) => item.status === "applied");
		if (!lastApplied) {
			return null;
		}
		lastApplied.status = "rolled_back";
		return { ...lastApplied };
	}

	private update(path: string, status: EditPlanItem["status"]): void {
		const target = this.entries.find((item) => item.path === path);
		if (!target) {
			return;
		}
		target.status = status;
	}
}
