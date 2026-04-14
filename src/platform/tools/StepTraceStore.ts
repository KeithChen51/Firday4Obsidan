import { TFile, Vault } from "obsidian";
import { StepTraceEvent } from "../../core/turn-state/TurnStateMachine";

const RUNTIME_DIR = "F.R.I.D.A.Y/runtime";
const STEP_TRACES_PATH = `${RUNTIME_DIR}/step_traces.jsonl`;

export class StepTraceStore {
	constructor(private readonly vault: Vault) {}

	async appendMany(events: StepTraceEvent[]): Promise<void> {
		if (events.length === 0) {
			return;
		}
		await this.ensureFolder(RUNTIME_DIR);
		const content = events.map((event) => JSON.stringify(event)).join("\n");
		const lineBlock = `${content}\n`;
		const existing = this.vault.getAbstractFileByPath(STEP_TRACES_PATH);
		if (existing instanceof TFile) {
			const current = await this.vault.cachedRead(existing);
			await this.vault.modify(existing, `${current}${lineBlock}`);
			return;
		}
		await this.vault.create(STEP_TRACES_PATH, lineBlock);
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
