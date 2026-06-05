import type { AgentExecutionContext } from "../core/agent-kernel/AgentExecutionContext";
import type { RuntimeTurnExecutorPort } from "../core/agent-kernel/AgentKernelPorts";
import type { AgentTurnInput } from "../core/agent-kernel/contracts";
import type {
	FridayPiPromptOptions,
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionListener,
	FridayPiSessionPort,
	FridayPiSessionUnsubscribe,
} from "../core/agent-kernel/pi/FridayPiRuntimePorts";

export type ObsidianFridayPiRuntimeExecutorFactory = () => RuntimeTurnExecutorPort;

export class ObsidianFridayPiRuntimeHostAdapter implements FridayPiSessionHostPort {
	constructor(private readonly createExecutor: ObsidianFridayPiRuntimeExecutorFactory) {}

	createSession(input: AgentTurnInput, context: AgentExecutionContext): FridayPiSessionPort {
		return new ObsidianFridayPiRuntimeHostSession(this.createExecutor, input, context);
	}
}

class ObsidianFridayPiRuntimeHostSession implements FridayPiSessionPort {
	private readonly listeners = new Set<FridayPiSessionListener>();
	private promptStarted = false;
	private disposed = false;

	constructor(
		private readonly createExecutor: ObsidianFridayPiRuntimeExecutorFactory,
		private readonly input: AgentTurnInput,
		private readonly context: AgentExecutionContext,
	) {}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(text: string, _options?: FridayPiPromptOptions): Promise<void> {
		if (this.disposed) {
			throw new Error("PI host bridge session has been disposed.");
		}
		if (this.promptStarted) {
			throw new Error("PI host bridge session prompt already started.");
		}
		this.promptStarted = true;
		try {
			const result = await this.createExecutor().execute(
				text === this.input.userPrompt ? this.input : { ...this.input, userPrompt: text },
				this.context,
			);
			this.emit({
				type: "host_result",
				result,
				summary: result.status === "failed" || result.status === "cancelled"
					? "PI host bridge failed."
					: "PI host bridge completed.",
			});
		} catch (error) {
			this.emit({
				type: "error",
				error,
				message: this.stringifyError(error) || "PI host bridge failed.",
			});
		}
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}

	private emit(event: FridayPiSessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}

	private stringifyError(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === "string") {
			return error;
		}
		if (error && typeof error === "object" && "message" in error) {
			return String((error as { message?: unknown }).message ?? "");
		}
		return error === undefined || error === null ? "" : String(error);
	}
}
