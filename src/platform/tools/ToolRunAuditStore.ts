import { TFile, Vault } from "obsidian";
import { ToolFailureClass } from "../../core/tool-governor/ToolGovernor";

const RUNTIME_DIR = "F.R.I.D.A.Y/runtime";
const TOOL_RUNS_PATH = `${RUNTIME_DIR}/tool_runs.jsonl`;

export interface ToolRunAuditRecord {
	turnId: string;
	runId: string;
	step: number;
	tool: string;
	status: "ok" | "failed" | "denied";
	failureClass?: ToolFailureClass;
	scope: string;
	targetPath: string;
	summary: string;
	error?: string;
	startedAt: string;
	endedAt: string;
}

export class ToolRunAuditStore {
	constructor(private readonly vault: Vault) {}

	async append(record: ToolRunAuditRecord): Promise<void> {
		await this.ensureFolder(RUNTIME_DIR);
		const line = `${JSON.stringify(record)}\n`;
		const existing = this.vault.getAbstractFileByPath(TOOL_RUNS_PATH);
		if (existing instanceof TFile) {
			const current = await this.vault.cachedRead(existing);
			await this.vault.modify(existing, `${current}${line}`);
			return;
		}
		await this.vault.create(TOOL_RUNS_PATH, line);
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const segments = folderPath.split("/").filter(Boolean);
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (this.vault.getAbstractFileByPath(current)) {
				continue;
			}
			await this.vault.createFolder(current);
		}
	}
}
