import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { StepTraceEvent } from "../../core/turn-state/TurnStateMachine";

const STEP_TRACES_FILENAME = "step_traces.jsonl";

export class StepTraceStore {
	constructor(private readonly runtimeRoot: string) {}

	async appendMany(events: StepTraceEvent[]): Promise<void> {
		if (events.length === 0) {
			return;
		}
		await mkdir(this.runtimeRoot, { recursive: true });
		const content = events.map((event) => JSON.stringify(event)).join("\n");
		await appendFile(path.join(this.runtimeRoot, STEP_TRACES_FILENAME), `${content}\n`, "utf8");
	}
}
