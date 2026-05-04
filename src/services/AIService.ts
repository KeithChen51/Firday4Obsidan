import { requestUrl } from "obsidian";
import { FridaySettings } from "../types/settings";
import { ToolCall, ToolDefinition } from "../types/tools";
import {
	buildLlmHeaders,
	extractHttpStatus,
	getLlmRetryDelayMs,
	isRetryableLlmFailure,
	shouldRetryLlmRequest,
} from "../core/llm/LlmTransportPolicy";
import {
	createLlmTransportEvent,
	createLlmTransportRequestId,
	type LlmTransportChannel,
	type LlmTransportEventInput,
	type LlmTransportObserver,
} from "../core/llm/LlmTransportTelemetry";

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	parts?: ChatMessagePart[];
	toolCallId?: string;
	name?: string;
	toolCalls?: ToolCall[];
	reasoningContent?: string;
	uiMeta?: ChatMessageUiMeta;
}

export interface ChatMessageUiBadge {
	kind: "skill" | "context" | "model";
	label: string;
}

export interface ChatMessageUiToken {
	kind: "skill" | "context";
	label: string;
	tokenType?: "skill" | "active_note" | "note" | "folder";
	target?: string;
}

export type ChatMessageUiSegment =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "token";
			token: ChatMessageUiToken;
	  };

export interface ChatMessageUiMeta {
	badges?: ChatMessageUiBadge[];
	detail?: string;
	segments?: ChatMessageUiSegment[];
	taskId?: string;
}

export type ChatMessagePart =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "image_url";
			image_url: {
				url: string;
			};
	  };

interface ChatOptions extends LlmTransportObserver {
	temperature?: number;
	maxTokens?: number;
	modelOverride?: string;
	signal?: AbortSignal;
}

interface ChatWithToolsOptions extends ChatOptions {
	toolChoice?: "auto" | "none";
}

interface ChatStreamOptions extends ChatOptions {
	onDelta?: (delta: string) => void;
}

interface ResponseTextPart {
	type?: string;
	text?: string;
}

interface ChatResponseBody {
	choices?: Array<{
		finish_reason?: string;
		message?: {
			content?: string | ResponseTextPart[];
			reasoning?: string;
			reasoning_content?: string;
			tool_calls?: Array<{
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
	}>;
	output_text?: string;
	output?: Array<{
		content?: ResponseTextPart[];
	}>;
}

export interface ChatWithToolsResult {
	assistantText: string;
	toolCalls: ToolCall[];
	finishReason: string;
	reasoningContent: string;
}

export type VisionCapability = "supported" | "unsupported" | "unknown";

export interface ModelCapabilityInfo {
	model: string;
	vision: VisionCapability;
	confidence: "high" | "medium" | "low";
	reason: string;
}

export interface ConnectionProbeResult {
	probeText: string;
	visionCapability: ModelCapabilityInfo;
}

const VISION_PROBE_IMAGE_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6u8AAAAASUVORK5CYII=";

export class AIService {
	private static readonly MAX_RETRY_ATTEMPTS = 3;

	constructor(private readonly getConfig: () => FridaySettings["llm"]) {}

	isConfigured(): boolean {
		const config = this.getConfig();
		if (!config.apiUrl?.trim()) {
			return false;
		}
		if (config.mode === "group") {
			return Boolean(config.model?.trim());
		}
		return true;
	}

	getModelCapability(modelOverride?: string): ModelCapabilityInfo {
		const model = (modelOverride?.trim() || this.getConfig().model?.trim() || "").toLowerCase();
		if (!model) {
			return {
				model: "",
				vision: "unknown",
				confidence: "low",
				reason: "未设置模型，无法判断视觉能力。",
			};
		}

		const supportedKeywords = [
			"gpt-4o",
			"gpt-4.1",
			"gpt-5",
			"vision",
			"-vl",
			"gemini",
			"claude-3",
			"claude-4",
			"glm-4v",
			"qwen-vl",
			"internvl",
			"llava",
			"minicpm-v",
			"pixtral",
		];
		const unsupportedKeywords = [
			"embedding",
			"rerank",
			"tts",
			"whisper",
			"speech",
			"qwen3-coder",
			"deepseek-coder",
		];

		if (supportedKeywords.some((token) => model.includes(token))) {
			return {
				model,
				vision: "supported",
				confidence: "high",
				reason: "模型名称命中视觉多模态关键词。",
			};
		}

		if (unsupportedKeywords.some((token) => model.includes(token))) {
			return {
				model,
				vision: "unsupported",
				confidence: "medium",
				reason: "模型名称更接近文本/语音/向量专用模型。",
			};
		}

		return {
			model,
			vision: "unknown",
			confidence: "low",
			reason: "无法从模型名称可靠判断，建议实际测试。",
		};
	}

	private buildCapabilityInfo(
		model: string,
		vision: VisionCapability,
		confidence: "high" | "medium" | "low",
		reason: string,
	): ModelCapabilityInfo {
		return {
			model: model.trim(),
			vision,
			confidence,
			reason,
		};
	}

	private classifyVisionProbeError(error: unknown, model: string): ModelCapabilityInfo {
		const raw = String(error ?? "").trim();
		const lower = raw.toLowerCase();
		const status = extractHttpStatus(error);
		if (
			status === 400 ||
			status === 404 ||
			status === 405 ||
			status === 422 ||
			lower.includes("unsupported") ||
			lower.includes("vision") ||
			lower.includes("image") ||
			lower.includes("multimodal") ||
			lower.includes("input_image")
		) {
			return this.buildCapabilityInfo(model, "unsupported", "medium", "图片探测失败，当前模型或网关可能不支持视觉输入。");
		}
		return this.buildCapabilityInfo(
			model,
			"unknown",
			"low",
			`视觉探测未完成：${raw || "未知错误"}`,
		);
	}

	private addCandidate(list: string[], value: string): void {
		const normalized = value.trim();
		if (!normalized) {
			return;
		}
		if (!list.includes(normalized)) {
			list.push(normalized);
		}
	}

	private withPath(base: URL, pathname: string): string {
		const url = new URL(base.toString());
		url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
		return url.toString();
	}

	private isExactEndpoint(pathname: string): boolean {
		return (
			pathname.endsWith("/chat/completions") ||
			pathname.endsWith("/v1/chat/completions") ||
			pathname.endsWith("/responses") ||
			pathname.endsWith("/v1/responses")
		);
	}

	private resolveEndpointCandidates(rawUrl: string): string[] {
		const trimmed = rawUrl.trim();
		if (!trimmed) {
			return [];
		}

		try {
			const url = new URL(trimmed);
			const cleanPath = url.pathname.replace(/\/+$/, "");
			const candidates: string[] = [];

			if (this.isExactEndpoint(cleanPath)) {
				this.addCandidate(candidates, url.toString());
				return candidates;
			}

			if (!cleanPath || cleanPath === "/") {
				this.addCandidate(candidates, this.withPath(url, "/v1/chat/completions"));
				this.addCandidate(candidates, this.withPath(url, "/chat/completions"));
				this.addCandidate(candidates, this.withPath(url, "/v1/responses"));
				this.addCandidate(candidates, this.withPath(url, "/responses"));
				this.addCandidate(candidates, url.toString());
				return candidates;
			}

			if (cleanPath.endsWith("/v1")) {
				this.addCandidate(candidates, this.withPath(url, `${cleanPath}/chat/completions`));
				this.addCandidate(candidates, this.withPath(url, `${cleanPath}/responses`));
				this.addCandidate(candidates, url.toString());
				return candidates;
			}

			// Enterprise gateway/custom route:
			// try raw path first, then common OpenAI-compatible variants.
			this.addCandidate(candidates, url.toString());
			this.addCandidate(candidates, this.withPath(url, `${cleanPath}/chat/completions`));
			this.addCandidate(candidates, this.withPath(url, `${cleanPath}/v1/chat/completions`));
			this.addCandidate(candidates, this.withPath(url, `${cleanPath}/responses`));
			this.addCandidate(candidates, this.withPath(url, `${cleanPath}/v1/responses`));
			this.addCandidate(candidates, this.withPath(url, "/v1/chat/completions"));
			this.addCandidate(candidates, this.withPath(url, "/v1/responses"));
			return candidates;
		} catch {
			return [trimmed];
		}
	}

	private isResponsesEndpoint(endpoint: string): boolean {
		try {
			const pathName = new URL(endpoint).pathname.replace(/\/+$/, "");
			return pathName.endsWith("/responses") || pathName.endsWith("/v1/responses");
		} catch {
			return endpoint.includes("/responses");
		}
	}

	private formatTriedEndpoints(endpoints: string[]): string {
		return endpoints.map((item) => `\n- ${item}`).join("");
	}

	private localizeKnownErrorMessage(raw: string): string {
		const trimmed = raw.trim();
		const lower = trimmed.toLowerCase();

		if (lower.includes("llm response has no usable message content")) {
			return (
				"LLM 已返回响应，但返回体字段里没有可用的文本内容。" +
				"这通常表示接口已经连通，但返回体字段或协议与当前解析规则不兼容；" +
				"请检查网关是否返回 choices[0].message.content、output_text 或 output[].content[].text。"
			);
		}

		return trimmed;
	}

	private normalizeError(error: unknown, endpoint: string, triedEndpoints: string[]): Error {
		const raw = String(error ?? "").trim();
		const lower = raw.toLowerCase();
		const triedText =
			triedEndpoints.length > 0 ? this.formatTriedEndpoints(triedEndpoints) : `\n- ${endpoint}`;

		if (lower.includes("err_connection_reset") || lower.includes("econnreset")) {
			return new Error(
				`连接被重置（ERR_CONNECTION_RESET）。这通常是网络、代理、VPN 或证书链路不稳定，不是协议不兼容。当前请求未拿到完整结果；若重试，需要重新发送本次模型请求。已尝试地址：${triedText}`,
			);
		}

		if (lower.includes("504") || lower.includes("gateway timeout")) {
			return new Error(
				`网关超时（504）。这通常是网关或上游模型排队超时，不是协议不兼容。当前请求未拿到完整结果；若重试，需要重新发送本次模型请求。已尝试地址：${triedText}`,
			);
		}

		if (lower.includes("timed out") || lower.includes("timeout")) {
			return new Error(
				`请求超时。通常是网关、代理或网络链路不稳定，不是协议不兼容。当前请求未拿到完整结果；若重试，需要重新发送本次模型请求。已尝试地址：${triedText}`,
			);
		}

		if (lower.includes("401") || lower.includes("unauthorized")) {
			return new Error("鉴权失败（401）。请检查 API 密钥或网关鉴权策略。");
		}

		if (lower.includes("403") || lower.includes("forbidden")) {
			return new Error("访问被拒绝（403）。请检查账号权限或网关策略。");
		}

		if (lower.includes("404")) {
			return new Error(`接口不存在（404）。这更像是网关路径不兼容，而不是模型本身故障。请确认网关要求的请求路径。已尝试地址：${triedText}`);
		}

		if (lower.includes("405")) {
			return new Error(`请求方法不被允许（405）。这通常表示当前网关端点与 OpenAI 协议路径不兼容。已尝试地址：${triedText}`);
		}

		if (lower.includes("429")) {
			return new Error("请求过于频繁（429）或额度不足。当前请求未成功完成；若重试，需要重新发送本次模型请求。");
		}

		if (
			lower.includes("unsupported tool") ||
			lower.includes("tool schema") ||
			lower.includes("tool_calls") ||
			lower.includes("function.name") ||
			lower.includes("合法 json")
		) {
			return new Error(
				"当前模型或网关与 Friday 的 native tool calling 协议不兼容。可以改用兼容模式继续执行，但会从当前步骤重新请求一次模型。",
			);
		}

		if (lower.includes("500") || lower.includes("502") || lower.includes("503")) {
			return new Error(
				`模型服务或网关暂时不可用（${extractHttpStatus(error) ?? "5xx"}）。这通常是临时性网络/网关故障，不是协议不兼容。当前请求未拿到完整结果；若重试，需要重新发送本次模型请求。原始错误：${raw}`,
			);
		}

		return new Error(this.localizeKnownErrorMessage(raw) || "未知网络错误");
	}

	private buildPayload(messages: ChatMessage[], endpoint: string, options?: ChatOptions): Record<string, unknown> {
		const config = this.getConfig();
		const isGroupMode = config.mode === "group";
		const temperature = options?.temperature ?? config.temperature;
		const maxTokens = options?.maxTokens ?? config.maxTokens;
		const modelOverride = options?.modelOverride?.trim() ?? "";
		const effectiveModel = modelOverride || config.model?.trim() || "";

		if (this.isResponsesEndpoint(endpoint)) {
			const payload: Record<string, unknown> = {
				input: messages.map((item) => ({
					role: item.role,
					content:
						item.parts && item.parts.length > 0
							? item.parts.map((part) => {
									if (part.type === "text") {
										return {
											type: "input_text",
											text: part.text,
										};
									}
									return {
										type: "input_image",
										image_url: part.image_url.url,
									};
								})
							: [{ type: "input_text", text: item.content }],
				})),
			};

			if (effectiveModel) {
				payload.model = effectiveModel;
			}
			if (!isGroupMode && temperature != null) {
				payload.temperature = temperature;
			}
			if (!isGroupMode && maxTokens != null) {
				payload.max_output_tokens = maxTokens;
			}

			return payload;
		}

		const payload: Record<string, unknown> = { messages: this.toOpenAIMessages(messages) };
		if (effectiveModel) {
			payload.model = effectiveModel;
		}
		if (!isGroupMode && temperature != null) {
			payload.temperature = temperature;
		}
		if (!isGroupMode && maxTokens != null) {
			payload.max_tokens = maxTokens;
		}

		return payload;
	}

	private toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
		return messages.map((item) => {
			if (item.role === "tool") {
				return {
					role: "tool",
					content: item.content,
					...(item.toolCallId ? { tool_call_id: item.toolCallId } : {}),
					...(item.name ? { name: item.name } : {}),
				};
			}
			if (item.role === "assistant" && Array.isArray(item.toolCalls) && item.toolCalls.length > 0) {
				const message: Record<string, unknown> = {
					role: "assistant",
					content: item.parts && item.parts.length > 0 ? item.parts : item.content,
					tool_calls: item.toolCalls.map((call) => ({
						id: call.id,
						type: "function",
						function: {
							name: call.name,
							arguments: JSON.stringify(call.args ?? {}),
						},
					})),
				};
				const reasoningContent = item.reasoningContent?.trim();
				if (reasoningContent) {
					message.reasoning_content = reasoningContent;
				}
				return message;
			}
			const message: Record<string, unknown> = {
				role: item.role,
				content: item.parts && item.parts.length > 0 ? item.parts : item.content,
			};
			if (item.role === "assistant") {
				const reasoningContent = item.reasoningContent?.trim();
				if (reasoningContent) {
					message.reasoning_content = reasoningContent;
				}
			}
			return message;
		});
	}

	private extractStreamDeltaText(eventData: unknown): string {
		if (!eventData || typeof eventData !== "object") {
			return "";
		}
		const payload = eventData as Record<string, unknown>;

		const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
		if (choice && typeof choice === "object") {
			const choiceObj = choice as Record<string, unknown>;
			const delta = choiceObj.delta as Record<string, unknown> | undefined;
			if (delta) {
				const content = delta.content;
				if (typeof content === "string" && content) {
					return content;
				}
				if (Array.isArray(content)) {
					const merged = content
						.map((item) =>
							item && typeof item === "object"
								? String((item as Record<string, unknown>).text ?? "")
								: "",
						)
						.filter((item) => item.length > 0)
						.join("");
					if (merged) {
						return merged;
					}
				}
			}

			const message = choiceObj.message as Record<string, unknown> | undefined;
			if (message) {
				const messageContent = message.content;
				if (typeof messageContent === "string" && messageContent) {
					return messageContent;
				}
			}
		}

		const outputText = payload.output_text;
		if (typeof outputText === "string" && outputText) {
			return outputText;
		}

		const type = typeof payload.type === "string" ? payload.type : "";
		if (type.includes("output_text") && typeof payload.delta === "string") {
			return payload.delta;
		}
		if (type.includes("output_text") && typeof payload.text === "string") {
			return payload.text;
		}

		const delta = payload.delta;
		if (typeof delta === "string" && delta) {
			return delta;
		}
		if (delta && typeof delta === "object") {
			const deltaObj = delta as Record<string, unknown>;
			if (typeof deltaObj.text === "string" && deltaObj.text) {
				return deltaObj.text;
			}
			const content = deltaObj.content;
			if (Array.isArray(content)) {
				const merged = content
					.map((item) =>
						item && typeof item === "object"
							? String((item as Record<string, unknown>).text ?? "")
							: "",
					)
					.filter((item) => item.length > 0)
					.join("");
				if (merged) {
					return merged;
				}
			}
		}

		const output = payload.output;
		if (Array.isArray(output)) {
			const merged = output
				.flatMap((item) => {
					if (!item || typeof item !== "object") {
						return [];
					}
					const content = (item as Record<string, unknown>).content;
					return Array.isArray(content) ? content : [];
				})
				.map((item) =>
					item && typeof item === "object"
						? String((item as Record<string, unknown>).text ?? "")
						: "",
				)
				.filter((item) => item.length > 0)
				.join("");
			if (merged) {
				return merged;
			}
		}

		return "";
	}

	private extractMessageContent(body: ChatResponseBody, allowEmpty = false): string {
		const direct = body.choices?.[0]?.message?.content;
		if (typeof direct === "string" && direct.trim()) {
			return direct;
		}

		if (Array.isArray(direct)) {
			const merged = direct
				.map((item) => item.text?.trim() ?? "")
				.filter((item) => item.length > 0)
				.join("\n")
				.trim();
			if (merged) {
				return merged;
			}
		}

		if (typeof body.output_text === "string" && body.output_text.trim()) {
			return body.output_text;
		}

		const outputText = (body.output ?? [])
			.flatMap((item) => item.content ?? [])
			.map((item) => item.text?.trim() ?? "")
			.filter((item) => item.length > 0)
			.join("\n")
			.trim();
		if (outputText) {
			return outputText;
		}

		if (allowEmpty) {
			return "";
		}

		throw new Error(
			this.localizeKnownErrorMessage("LLM response has no usable message content."),
		);
	}

	private extractReasoningContent(body: ChatResponseBody): string {
		const message = body.choices?.[0]?.message;
		const reasoningContent = message?.reasoning_content?.trim() || message?.reasoning?.trim() || "";
		return reasoningContent;
	}

	private extractConnectionProbeText(body: ChatResponseBody): string {
		const text = this.extractMessageContent(body, true).trim();
		if (text) {
			return text;
		}
		if (body.choices?.[0] || typeof body.output_text === "string" || Array.isArray(body.output)) {
			return "";
		}
		throw new Error(
			this.localizeKnownErrorMessage("LLM response has no usable message content."),
		);
	}

	private getTransportMaxAttempts(): number {
		return AIService.MAX_RETRY_ATTEMPTS + 1;
	}

	private emitTransportEvent(
		observer: LlmTransportObserver | undefined,
		input: LlmTransportEventInput,
	): void {
		try {
			observer?.onTransportEvent?.(createLlmTransportEvent(input));
		} catch {
			// Telemetry observers must not affect model request behavior.
		}
	}

	private emitTransportRequestStarted(
		observer: LlmTransportObserver | undefined,
		channel: LlmTransportChannel,
		requestId: string,
		endpoints: string[],
		endpointIndex: number,
	): void {
		this.emitTransportEvent(observer, {
			type: "request_started",
			requestId,
			channel,
			endpointIndex,
			endpointCount: endpoints.length,
			attempt: 1,
			maxAttempts: this.getTransportMaxAttempts(),
			retryable: false,
			message: "Model request started",
		});
	}

	private emitTransportRetryStarted(
		observer: LlmTransportObserver | undefined,
		channel: LlmTransportChannel,
		requestId: string,
		endpoints: string[],
		endpointIndex: number,
		attempt: number,
	): void {
		this.emitTransportEvent(observer, {
			type: "retry_started",
			requestId,
			channel,
			endpointIndex,
			endpointCount: endpoints.length,
			attempt: attempt + 1,
			maxAttempts: this.getTransportMaxAttempts(),
			retryable: true,
			message: "Retrying model request",
		});
	}

	private emitTransportRequestSucceeded(
		observer: LlmTransportObserver | undefined,
		channel: LlmTransportChannel,
		requestId: string,
		endpoints: string[],
		endpointIndex: number,
		attempt: number,
	): void {
		this.emitTransportEvent(observer, {
			type: "request_succeeded",
			requestId,
			channel,
			endpointIndex,
			endpointCount: endpoints.length,
			attempt: attempt + 1,
			maxAttempts: this.getTransportMaxAttempts(),
			retryable: false,
			message: "Model request succeeded",
		});
	}

	private emitTransportRetryScheduled(
		observer: LlmTransportObserver | undefined,
		channel: LlmTransportChannel,
		requestId: string,
		endpoints: string[],
		endpointIndex: number,
		attempt: number,
		delayMs: number,
		error: unknown,
	): void {
		this.emitTransportEvent(observer, {
			type: "retry_scheduled",
			requestId,
			channel,
			endpointIndex,
			endpointCount: endpoints.length,
			attempt: attempt + 1,
			maxAttempts: this.getTransportMaxAttempts(),
			delayMs,
			retryable: true,
			error,
		});
	}

	private emitTransportRequestFailed(
		observer: LlmTransportObserver | undefined,
		channel: LlmTransportChannel,
		requestId: string,
		endpoints: string[],
		endpointIndex: number,
		attempt: number,
		error: unknown,
	): void {
		const type = isRetryableLlmFailure(error) ? "request_exhausted" : "request_failed";
		this.emitTransportEvent(observer, {
			type,
			requestId,
			channel,
			endpointIndex,
			endpointCount: endpoints.length,
			attempt: attempt + 1,
			maxAttempts: this.getTransportMaxAttempts(),
			retryable: type !== "request_failed",
			error,
		});
	}

	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const config = this.getConfig();
		const modelOverride = options?.modelOverride?.trim() ?? "";
		const effectiveModel = modelOverride || config.model.trim();
		if (!this.isConfigured()) {
			throw new Error("LLM 尚未配置，请先在设置中填写 API 地址。");
		}
		if (config.mode === "group" && !effectiveModel) {
			throw new Error("集团集采模式需要先选择模型。");
		}

		const endpoints = this.resolveEndpointCandidates(config.apiUrl);
		if (endpoints.length === 0) {
			throw new Error("LLM API 地址为空，请先在设置中配置。");
		}

		const headers = buildLlmHeaders(config.apiKey, config.extraHeaders);

		const triedEndpoints: string[] = [];
		let lastError: unknown = null;
		const requestId = createLlmTransportRequestId("llm-chat");

		for (let index = 0; index < endpoints.length; index += 1) {
			const endpoint = endpoints[index]!;
			triedEndpoints.push(endpoint);
			let attempt = 0;
			this.emitTransportRequestStarted(options, "chat", requestId, endpoints, index);

			while (true) {
				this.throwIfAborted(options?.signal);
				if (attempt > 0) {
					this.emitTransportRetryStarted(options, "chat", requestId, endpoints, index, attempt);
				}
				const payload = this.buildPayload(messages, endpoint, options);
				try {
					const response = await requestUrl({
						url: endpoint,
						method: "POST",
						headers,
						body: JSON.stringify(payload),
					});
					this.throwIfAborted(options?.signal);
					const text = this.extractMessageContent(response.json as ChatResponseBody);
					this.emitTransportRequestSucceeded(options, "chat", requestId, endpoints, index, attempt);
					return text;
				} catch (error) {
					lastError = error;
					const status = extractHttpStatus(error);
					const hasFallback = index < endpoints.length - 1;
					if ((status === 404 || status === 405) && hasFallback) {
						break;
					}
					if (status === 400 && this.isResponsesEndpoint(endpoint) && hasFallback) {
						break;
					}
					if (shouldRetryLlmRequest(error, attempt, AIService.MAX_RETRY_ATTEMPTS)) {
						const delayMs = getLlmRetryDelayMs(attempt);
						this.emitTransportRetryScheduled(options, "chat", requestId, endpoints, index, attempt, delayMs, error);
						await this.delay(delayMs, options?.signal);
						attempt += 1;
						continue;
					}
					this.emitTransportRequestFailed(options, "chat", requestId, endpoints, index, attempt, error);
					throw this.normalizeError(error, endpoint, triedEndpoints);
				}
			}
		}

		throw this.normalizeError(lastError, endpoints[endpoints.length - 1]!, triedEndpoints);
	}

	async chatStream(messages: ChatMessage[], options?: ChatStreamOptions): Promise<string> {
		const config = this.getConfig();
		const modelOverride = options?.modelOverride?.trim() ?? "";
		const effectiveModel = modelOverride || config.model.trim();
		if (!this.isConfigured()) {
			throw new Error("LLM 尚未配置，请先在设置中填写 API 地址。");
		}
		if (config.mode === "group" && !effectiveModel) {
			throw new Error("集团集采模式需要先选择模型。");
		}

		const endpoints = this.resolveEndpointCandidates(config.apiUrl);
		if (endpoints.length === 0) {
			throw new Error("LLM API 地址为空，请先在设置中配置。");
		}

		const headers = buildLlmHeaders(config.apiKey, config.extraHeaders);
		const triedEndpoints: string[] = [];
		let lastError: unknown = null;
		const requestId = createLlmTransportRequestId("llm-stream");

		for (let index = 0; index < endpoints.length; index += 1) {
			const endpoint = endpoints[index]!;
			triedEndpoints.push(endpoint);
			let attempt = 0;
			this.emitTransportRequestStarted(options, "chat_stream", requestId, endpoints, index);

			while (true) {
				if (attempt > 0) {
					this.emitTransportRetryStarted(options, "chat_stream", requestId, endpoints, index, attempt);
				}
				const payload = this.buildPayload(messages, endpoint, options);
				payload.stream = true;

				try {
					const response = await fetch(endpoint, {
						method: "POST",
						headers,
						body: JSON.stringify(payload),
						signal: options?.signal,
					});
					if (!response.ok) {
						throw new Error(`${response.status} ${response.statusText}`.trim());
					}

					const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
					if (!response.body || contentType.includes("application/json")) {
						const body = (await response.json()) as ChatResponseBody;
						const text = this.extractMessageContent(body);
						if (text) {
							options?.onDelta?.(text);
						}
						this.emitTransportRequestSucceeded(options, "chat_stream", requestId, endpoints, index, attempt);
						return text;
					}

					const reader = response.body.getReader();
					const decoder = new TextDecoder("utf-8");
					let buffer = "";
					let fullText = "";

					while (true) {
						const chunk = await reader.read();
						if (chunk.done) {
							break;
						}
						buffer += decoder.decode(chunk.value, { stream: true });

						let newlineIndex = buffer.indexOf("\n");
						while (newlineIndex >= 0) {
							const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
							buffer = buffer.slice(newlineIndex + 1);
							newlineIndex = buffer.indexOf("\n");

							const line = rawLine.trim();
							if (!line || !line.startsWith("data:")) {
								continue;
							}

							const data = line.slice(5).trim();
							if (!data || data === "[DONE]") {
								continue;
							}

							let parsed: unknown;
							try {
								parsed = JSON.parse(data);
							} catch {
								continue;
							}
							const deltaText = this.extractStreamDeltaText(parsed);
							if (!deltaText) {
								continue;
							}
							fullText += deltaText;
							options?.onDelta?.(deltaText);
						}
					}

					buffer += decoder.decode();
					if (buffer.trim().startsWith("data:")) {
						const data = buffer.trim().slice(5).trim();
						if (data && data !== "[DONE]") {
							try {
								const parsed = JSON.parse(data);
								const deltaText = this.extractStreamDeltaText(parsed);
								if (deltaText) {
									fullText += deltaText;
									options?.onDelta?.(deltaText);
								}
							} catch {
								// Ignore trailing partial event.
							}
						}
					}

					if (fullText.trim()) {
						this.emitTransportRequestSucceeded(options, "chat_stream", requestId, endpoints, index, attempt);
						return fullText;
					}

					return this.chat(messages, options);
				} catch (error) {
					lastError = error;
					const status = extractHttpStatus(error);
					const hasFallback = index < endpoints.length - 1;
					if ((status === 404 || status === 405 || status === 400) && hasFallback) {
						break;
					}
					if (shouldRetryLlmRequest(error, attempt, AIService.MAX_RETRY_ATTEMPTS)) {
						const delayMs = getLlmRetryDelayMs(attempt);
						this.emitTransportRetryScheduled(options, "chat_stream", requestId, endpoints, index, attempt, delayMs, error);
						await this.delay(delayMs, options?.signal);
						attempt += 1;
						continue;
					}
					if (status != null) {
						this.emitTransportRequestFailed(options, "chat_stream", requestId, endpoints, index, attempt, error);
						throw this.normalizeError(error, endpoint, triedEndpoints);
					}
					if (isRetryableLlmFailure(error)) {
						this.emitTransportRequestFailed(options, "chat_stream", requestId, endpoints, index, attempt, error);
						throw this.normalizeError(error, endpoint, triedEndpoints);
					}

					try {
						return await this.chat(messages, options);
					} catch (fallbackError) {
						this.emitTransportRequestFailed(options, "chat_stream", requestId, endpoints, index, attempt, fallbackError);
						throw this.normalizeError(fallbackError, endpoint, triedEndpoints);
					}
				}
			}
		}

		throw this.normalizeError(lastError, endpoints[endpoints.length - 1]!, triedEndpoints);
	}

	private extractToolCalls(body: ChatResponseBody): ToolCall[] {
		const toolCalls = body.choices?.[0]?.message?.tool_calls;
		if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
			return [];
		}

		return toolCalls.map((toolCall) => {
			const fnName = toolCall?.function?.name?.trim() ?? "";
			if (!fnName) {
				throw new Error("工具调用协议不兼容：返回的 tool_calls 缺少 function.name。");
			}

			const rawArgs = toolCall?.function?.arguments?.trim() ?? "";
			if (!rawArgs) {
				return {
					id: toolCall?.id,
					name: fnName,
					args: {},
				};
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(rawArgs);
			} catch (error) {
				throw new Error(`工具调用协议不兼容：function.arguments 不是合法 JSON: ${String(error)}`);
			}

			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("工具参数必须是 JSON 对象。");
			}

			return {
				id: toolCall?.id,
				name: fnName,
				args: parsed as Record<string, unknown>,
			};
		});
	}

	private buildToolPayload(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		options?: ChatWithToolsOptions,
	): Record<string, unknown> {
		const config = this.getConfig();
		const isGroupMode = config.mode === "group";
		const temperature = options?.temperature ?? config.temperature;
		const maxTokens = options?.maxTokens ?? config.maxTokens;
		const modelOverride = options?.modelOverride?.trim() ?? "";
		const effectiveModel = modelOverride || config.model?.trim() || "";
		const toolChoice = options?.toolChoice ?? "auto";

		const payload: Record<string, unknown> = {
			messages: this.toOpenAIMessages(messages),
			tools: tools.map((tool) => ({
				type: "function",
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				},
			})),
			tool_choice: toolChoice,
		};

		if (effectiveModel) {
			payload.model = effectiveModel;
		}
		if (!isGroupMode && temperature != null) {
			payload.temperature = temperature;
		}
		if (!isGroupMode && maxTokens != null) {
			payload.max_tokens = maxTokens;
		}
		return payload;
	}

	async chatWithTools(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		options?: ChatWithToolsOptions,
	): Promise<ChatWithToolsResult> {
		const config = this.getConfig();
		const modelOverride = options?.modelOverride?.trim() ?? "";
		const effectiveModel = modelOverride || config.model.trim();
		if (!this.isConfigured()) {
			throw new Error("LLM 尚未配置，请先在设置中填写 API 地址。");
		}
		if (config.mode === "group" && !effectiveModel) {
			throw new Error("集团集采模式需要先选择模型。");
		}
		if (tools.length === 0) {
			throw new Error("chatWithTools 需要至少一个工具定义。");
		}

		const endpoints = this.resolveEndpointCandidates(config.apiUrl).filter((endpoint) => !this.isResponsesEndpoint(endpoint));
		if (endpoints.length === 0) {
			throw new Error("当前 API 地址仅命中 responses 端点，无法执行 native tool calling。这属于协议兼容性限制，不是网络故障。");
		}

		const headers = buildLlmHeaders(config.apiKey, config.extraHeaders);

		const triedEndpoints: string[] = [];
		let lastError: unknown = null;
		const requestId = createLlmTransportRequestId("llm-tools");
		for (let index = 0; index < endpoints.length; index += 1) {
			const endpoint = endpoints[index]!;
			triedEndpoints.push(endpoint);
			let attempt = 0;
			this.emitTransportRequestStarted(options, "chat_with_tools", requestId, endpoints, index);

			while (true) {
				this.throwIfAborted(options?.signal);
				if (attempt > 0) {
					this.emitTransportRetryStarted(options, "chat_with_tools", requestId, endpoints, index, attempt);
				}
				const payload = this.buildToolPayload(messages, tools, options);
				try {
					const response = await requestUrl({
						url: endpoint,
						method: "POST",
						headers,
						body: JSON.stringify(payload),
					});
					this.throwIfAborted(options?.signal);
					const body = response.json as ChatResponseBody;
					const assistantText = this.extractMessageContent(body, true);
					const toolCalls = this.extractToolCalls(body);
					this.emitTransportRequestSucceeded(options, "chat_with_tools", requestId, endpoints, index, attempt);
					return {
						assistantText,
						toolCalls,
						finishReason: body.choices?.[0]?.finish_reason ?? "",
						reasoningContent: this.extractReasoningContent(body),
					};
				} catch (error) {
					lastError = error;
					const status = extractHttpStatus(error);
					const hasFallback = index < endpoints.length - 1;
					if ((status === 404 || status === 405 || status === 400) && hasFallback) {
						break;
					}
					if (shouldRetryLlmRequest(error, attempt, AIService.MAX_RETRY_ATTEMPTS)) {
						const delayMs = getLlmRetryDelayMs(attempt);
						this.emitTransportRetryScheduled(options, "chat_with_tools", requestId, endpoints, index, attempt, delayMs, error);
						await this.delay(delayMs, options?.signal);
						attempt += 1;
						continue;
					}
					this.emitTransportRequestFailed(options, "chat_with_tools", requestId, endpoints, index, attempt, error);
					throw this.normalizeError(error, endpoint, triedEndpoints);
				}
			}
		}

		throw this.normalizeError(lastError, endpoints[endpoints.length - 1]!, triedEndpoints);
	}

	async checkConnection(options?: LlmTransportObserver): Promise<string> {
		const config = this.getConfig();
		const effectiveModel = config.model.trim();
		if (!this.isConfigured()) {
			throw new Error("LLM 尚未配置，请先在设置中填写 API 地址。");
		}
		if (config.mode === "group" && !effectiveModel) {
			throw new Error("集团集采模式需要先选择模型。");
		}

		const endpoints = this.resolveEndpointCandidates(config.apiUrl);
		if (endpoints.length === 0) {
			throw new Error("LLM API 地址为空，请先在设置中配置。");
		}

		const headers = buildLlmHeaders(config.apiKey, config.extraHeaders);
		const messages: ChatMessage[] = [
			{
				role: "user",
				content: "Reply exactly OK.",
			},
		];
		const triedEndpoints: string[] = [];
		let lastError: unknown = null;
		const requestId = createLlmTransportRequestId("llm-check");

		for (let index = 0; index < endpoints.length; index += 1) {
			const endpoint = endpoints[index]!;
			triedEndpoints.push(endpoint);
			let attempt = 0;
			this.emitTransportRequestStarted(options, "connection_check", requestId, endpoints, index);

			while (true) {
				if (attempt > 0) {
					this.emitTransportRetryStarted(options, "connection_check", requestId, endpoints, index, attempt);
				}
				const payload = this.buildPayload(messages, endpoint, { maxTokens: 256 });
				try {
					const response = await requestUrl({
						url: endpoint,
						method: "POST",
						headers,
						body: JSON.stringify(payload),
					});
					const probeText = this.extractConnectionProbeText(response.json as ChatResponseBody).trim();
					this.emitTransportRequestSucceeded(options, "connection_check", requestId, endpoints, index, attempt);
					return probeText;
				} catch (error) {
					lastError = error;
					const status = extractHttpStatus(error);
					const hasFallback = index < endpoints.length - 1;
					if ((status === 404 || status === 405) && hasFallback) {
						break;
					}
					if (status === 400 && this.isResponsesEndpoint(endpoint) && hasFallback) {
						break;
					}
					if (shouldRetryLlmRequest(error, attempt, AIService.MAX_RETRY_ATTEMPTS)) {
						const delayMs = getLlmRetryDelayMs(attempt);
						this.emitTransportRetryScheduled(options, "connection_check", requestId, endpoints, index, attempt, delayMs, error);
						await this.delay(delayMs);
						attempt += 1;
						continue;
					}
					this.emitTransportRequestFailed(options, "connection_check", requestId, endpoints, index, attempt, error);
					throw this.normalizeError(error, endpoint, triedEndpoints);
				}
			}
		}

		throw this.normalizeError(lastError, endpoints[endpoints.length - 1]!, triedEndpoints);
	}

	async probeVisionCapability(): Promise<ModelCapabilityInfo> {
		const model = this.getConfig().model.trim();
		try {
			await this.chat(
				[
					{
						role: "user",
						content: "请仅回复 OK",
						parts: [
							{ type: "text", text: "请仅回复 OK" },
							{ type: "image_url", image_url: { url: VISION_PROBE_IMAGE_DATA_URL } },
						],
					},
				],
				{ maxTokens: 16 },
			);
			return this.buildCapabilityInfo(model, "supported", "high", "已通过图片输入探测。");
		} catch (error) {
			return this.classifyVisionProbeError(error, model);
		}
	}

	async checkConnectionCapabilities(): Promise<ConnectionProbeResult> {
		const probeText = await this.checkConnection();
		return {
			probeText,
			visionCapability: await this.probeVisionCapability(),
		};
	}

	async chatJSON<T>(messages: ChatMessage[], schema?: object): Promise<T> {
		const schemaPrompt = schema
			? `Respond with strict JSON that matches this schema: ${JSON.stringify(schema)}`
			: "Respond with valid JSON only.";
		const mergedMessages: ChatMessage[] = [
			{
				role: "system",
				content: schemaPrompt,
			},
			...messages,
		];

		const content = await this.chat(mergedMessages);
		try {
			return JSON.parse(content) as T;
		} catch (error) {
			throw new Error(`解析 JSON 响应失败：${String(error)}`);
		}
	}

	private throwIfAborted(signal?: AbortSignal): void {
		if (signal?.aborted) {
			throw new Error("Task cancelled.");
		}
	}

	private async delay(ms: number, signal?: AbortSignal): Promise<void> {
		this.throwIfAborted(signal);
		await new Promise<void>((resolve) => {
			const timeout = window.setTimeout(resolve, ms);
			if (signal) {
				signal.addEventListener("abort", () => {
					window.clearTimeout(timeout);
					resolve();
				}, { once: true });
			}
		});
		this.throwIfAborted(signal);
	}
}

