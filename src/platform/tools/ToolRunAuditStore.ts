import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { ToolFailureClass } from "../../core/tool-governor/ToolGovernor";

const TOOL_RUNS_FILENAME = "tool_runs.jsonl";

export interface ToolRunAuditRecord {
	turnId: string;
	runId: string;
	step: number;
	tool: string;
	approved: boolean;
	approvalReason: string;
	persistedRule: boolean;
	viaRule: boolean;
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
	constructor(private readonly runtimeRoot: string) {}

	async append(record: ToolRunAuditRecord): Promise<void> {
		await mkdir(this.runtimeRoot, { recursive: true });
		await appendFile(path.join(this.runtimeRoot, TOOL_RUNS_FILENAME), `${JSON.stringify(record)}\n`, "utf8");
	}
}
