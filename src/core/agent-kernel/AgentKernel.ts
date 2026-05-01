import type {
	RuntimeProgressEvent,
	RuntimeTurnInput,
	RuntimeTurnResult,
} from "../../services/AgentRuntimeService";

export type { RuntimeProgressEvent, RuntimeTurnInput, RuntimeTurnResult };

export interface AgentRuntimeAdapter {
	runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult>;
}

export class AgentKernel {
	constructor(private readonly runtimeAdapter: AgentRuntimeAdapter) {}

	runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		return this.runtimeAdapter.runTurn(input);
	}
}

export class AgentRuntimeFacade {
	constructor(private readonly kernel: AgentKernel) {}

	runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
		return this.kernel.runTurn(input);
	}
}
