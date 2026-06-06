import { streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/openai-completions";
import { streamSimpleOpenAIResponses } from "@earendil-works/pi-ai/openai-responses";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	Tool,
	ToolCall,
} from "@earendil-works/pi-ai";

type EventCompletionPredicate<TEvent> = (event: TEvent) => boolean;
type EventResultExtractor<TEvent, TResult> = (event: TEvent) => TResult;
type SchemaRecord = Record<string | symbol, unknown>;

const validatorCache = new WeakMap<object, { Check(value: unknown): boolean; Errors(value: unknown): Iterable<unknown> }>();

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export class EventStream<TEvent, TResult = TEvent> implements AsyncIterable<TEvent> {
	private readonly queue: TEvent[] = [];
	private readonly waiting: Array<(result: IteratorResult<TEvent>) => void> = [];
	private done = false;
	private readonly finalResultPromise: Promise<TResult>;
	private resolveFinalResult: (result: TResult) => void = () => undefined;

	constructor(
		private readonly isComplete: EventCompletionPredicate<TEvent>,
		private readonly extractResult: EventResultExtractor<TEvent, TResult>,
	) {
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: TEvent): void {
		if (this.done) {
			return;
		}
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
			return;
		}
		this.queue.push(event);
	}

	end(result?: TResult): void {
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		while (this.waiting.length > 0) {
			this.waiting.shift()?.({ value: undefined, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<TEvent> {
		while (true) {
			const event = this.queue.shift();
			if (event) {
				yield event;
				continue;
			}
			if (this.done) {
				return;
			}
			const result = await new Promise<IteratorResult<TEvent>>((resolve) => this.waiting.push(resolve));
			if (result.done) {
				return;
			}
			yield result.value;
		}
	}

	result(): Promise<TResult> {
		return this.finalResultPromise;
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				}
				if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result.");
			},
		);
	}
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}

export function getModel(provider: string, modelId: string): Model<Api> | undefined {
	if (provider !== "openai") {
		return undefined;
	}
	const isResponsesModel =
		modelId.startsWith("gpt-5") ||
		modelId.startsWith("gpt-4.1") ||
		modelId.startsWith("o1") ||
		modelId.startsWith("o3") ||
		modelId.startsWith("o4");
	if (!isResponsesModel) {
		return undefined;
	}
	return {
		id: modelId,
		name: modelId,
		api: "openai-responses",
		provider,
		baseUrl: "https://api.openai.com/v1",
		reasoning: modelId.startsWith("gpt-5") || modelId.startsWith("o"),
		input: ["text", "image"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

export function streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	if (model.api === "openai-completions") {
		return streamSimpleOpenAICompletions(model, context, options);
	}
	if (model.api === "openai-responses") {
		return streamSimpleOpenAIResponses(model, context, options);
	}
	return createUnsupportedApiStream(model, `FRIDAY PI browser runtime does not support PI API "${model.api}" yet.`);
}

export function validateToolArguments(tool: Tool, toolCall: ToolCall): unknown {
	const args = structuredClone(toolCall.arguments);
	Value.Convert(tool.parameters, args);
	const validator = getValidator(tool.parameters);
	if (validator.Check(args)) {
		return args;
	}
	const errors = Array.from(validator.Errors(args), formatValidationError).join("\n") || "Unknown validation error";
	throw new Error(
		`Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(
			toolCall.arguments,
			null,
			2,
		)}`,
	);
}

function createUnsupportedApiStream(model: Model<Api>, message: string): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		const errorMessage: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: EMPTY_USAGE,
			stopReason: "error",
			errorMessage: message,
			timestamp: Date.now(),
		};
		stream.push({ type: "error", reason: "error", error: errorMessage });
		stream.end(errorMessage);
	});
	return stream;
}

function getValidator(schema: unknown): { Check(value: unknown): boolean; Errors(value: unknown): Iterable<unknown> } {
	if (!isRecord(schema)) {
		throw new Error("Tool parameters must be a JSON schema object.");
	}
	const cached = validatorCache.get(schema);
	if (cached) {
		return cached;
	}
	const validator = Compile(schema);
	validatorCache.set(schema, validator);
	return validator;
}

function formatValidationError(error: unknown): string {
	const record = isRecord(error) ? error : {};
	const message = typeof record.message === "string" ? record.message : "Invalid value";
	const path = formatValidationPath(record);
	return `  - ${path}: ${message}`;
}

function formatValidationPath(error: SchemaRecord): string {
	if (error.keyword === "required") {
		const params = isRecord(error.params) ? error.params : {};
		const requiredProperties = params.requiredProperties;
		const requiredProperty = Array.isArray(requiredProperties) ? requiredProperties[0] : undefined;
		if (typeof requiredProperty === "string" && requiredProperty) {
			const basePath = normalizeInstancePath(error.instancePath);
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}
	return normalizeInstancePath(error.instancePath) || "root";
}

function normalizeInstancePath(value: unknown): string {
	return typeof value === "string" ? value.replace(/^\//, "").replace(/\//g, ".") : "";
}

function isRecord(value: unknown): value is SchemaRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { Type };
