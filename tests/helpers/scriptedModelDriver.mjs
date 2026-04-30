/* eslint-env node */

export class ScriptedModelDriver {
	constructor(modelSteps = []) {
		this.modelSteps = [...modelSteps];
		this.index = 0;
		this.calls = {
			native: 0,
			prompt: 0,
			total: 0,
		};
		this.requests = [];
		this.pendingMutations = [];
	}

	async chat(messages, options = {}) {
		this.calls.prompt += 1;
		this.calls.total += 1;
		this.requests.push({ channel: "prompt", messages, options });
		const step = this.nextStep("prompt");
		this.collectPendingMutations(step);
		if (step.raw != null) {
			return String(step.raw);
		}
		if (step.tool) {
			return this.formatPromptToolCall(step.tool);
		}
		if (Array.isArray(step.pendingMutations)) {
			return this.formatPromptMutationPlan(step.assistant ?? step.final ?? "", step.pendingMutations);
		}
		return this.formatPromptAssistant(step.assistant ?? step.final ?? "");
	}

	async chatWithTools(messages, tools, options = {}) {
		this.calls.native += 1;
		this.calls.total += 1;
		this.requests.push({ channel: "native", messages, tools, options });
		const step = this.nextStep("native");
		this.collectPendingMutations(step);
		const toolCalls = step.toolCalls ?? (step.tool ? [this.toToolCall(step.tool)] : []);
		const assistantText = toolCalls.length > 0
			? String(step.assistant ?? step.final ?? "")
			: this.formatNativeAssistant(step);
		return {
			assistantText,
			toolCalls,
			finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
			reasoningContent: String(step.reasoningContent ?? ""),
		};
	}

	nextStep(channel) {
		if (this.index >= this.modelSteps.length) {
			throw new Error(`ScriptedModelDriver has no model step for ${channel} call ${this.index + 1}.`);
		}
		const step = this.modelSteps[this.index];
		this.index += 1;
		if (step.error) {
			throw step.error instanceof Error ? step.error : new Error(String(step.error));
		}
		return step;
	}

	collectPendingMutations(step) {
		if (!Array.isArray(step.pendingMutations)) {
			return;
		}
		this.pendingMutations.push(...step.pendingMutations.map((mutation) => ({ ...mutation })));
	}

	toToolCall(tool) {
		return {
			id: tool.id ?? `call_${this.index}_${tool.name}`,
			name: tool.name,
			args: tool.args ?? {},
		};
	}

	formatPromptToolCall(tool) {
		return [
			"```friday-runtime",
			JSON.stringify({
				type: "tool_call",
				tool: {
					name: tool.name,
					args: tool.args ?? {},
				},
			}),
			"```",
		].join("\n");
	}

	formatPromptAssistant(text) {
		return [
			"```friday-runtime",
			JSON.stringify({
				type: "response",
				assistant: String(text),
			}),
			"```",
		].join("\n");
	}

	formatNativeAssistant(step) {
		if (Array.isArray(step.pendingMutations)) {
			return this.formatPromptMutationPlan(step.assistant ?? step.final ?? "", step.pendingMutations);
		}
		return String(step.assistant ?? step.final ?? "");
	}

	formatPromptMutationPlan(text, mutations) {
		return [
			"```friday-runtime",
			JSON.stringify({
				type: "mutation_plan",
				assistant: String(text),
				mutations,
			}),
			"```",
		].join("\n");
	}
}

export function createScriptedModelDriver(modelSteps = []) {
	return new ScriptedModelDriver(modelSteps);
}
