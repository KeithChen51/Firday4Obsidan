import type { FridaySettings } from "../../types/settings";

export interface AgentModelOption {
	value: string;
	label: string;
	mode: "openai" | "group";
	model: string;
}

export interface AgentModelCatalogInput {
	openaiConfig: {
		apiUrl?: string;
		model?: string;
	};
	groupConfig: {
		apiUrl?: string;
	};
}

export function serializeAgentModelChoice(mode: "openai" | "group", model: string): string {
	return `${mode}::${model}`;
}

export function parseAgentModelChoice(
	value: string,
): { mode: "openai" | "group"; model: string } | null {
	const matched = value.match(/^(openai|group)::(.+)$/);
	if (!matched) {
		return null;
	}
	const mode = matched[1] as "openai" | "group";
	const model = matched[2]?.trim() ?? "";
	if (!model) {
		return null;
	}
	return { mode, model };
}

export function buildAgentModelOptions(
	input: AgentModelCatalogInput,
	groupModels: Array<{ id: string; label: string }>,
): AgentModelOption[] {
	const openaiAvailable = Boolean(input.openaiConfig.apiUrl?.trim() && input.openaiConfig.model?.trim());
	const groupAvailable = Boolean(input.groupConfig.apiUrl?.trim() && groupModels.length > 0);
	const showSourcePrefix = openaiAvailable && groupAvailable;
	const options: AgentModelOption[] = [];

	if (openaiAvailable) {
		const model = input.openaiConfig.model!.trim();
		options.push({
			value: serializeAgentModelChoice("openai", model),
			label: showSourcePrefix ? `OpenAI · ${model}` : model,
			mode: "openai",
			model,
		});
	}

	if (groupAvailable) {
		for (const item of groupModels) {
			const model = item.id.trim();
			if (!model) {
				continue;
			}
			options.push({
				value: serializeAgentModelChoice("group", model),
				label: showSourcePrefix ? `集团集采 · ${item.label}` : item.label,
				mode: "group",
				model,
			});
		}
	}

	return options;
}

export function resolveSelectedAgentModelValue(
	agent: { model?: string; modelMode?: "openai" | "group" } | null,
	options: AgentModelOption[],
): string {
	const currentModel = agent?.model?.trim() ?? "";
	const currentMode = agent?.modelMode;
	if (!currentModel) {
		return "";
	}
	if (currentMode) {
		const encoded = serializeAgentModelChoice(currentMode, currentModel);
		if (options.some((item) => item.value === encoded)) {
			return encoded;
		}
	}
	const matched = options.find((item) => item.model === currentModel);
	return matched?.value ?? "";
}

export function buildAgentModelCatalogFromSettings(
	settings: FridaySettings["llm"],
	groupModels: Array<{ id: string; label: string }>,
): AgentModelOption[] {
	return buildAgentModelOptions(
		{
			openaiConfig: settings.openaiConfig,
			groupConfig: settings.groupConfig,
		},
		groupModels,
	);
}
