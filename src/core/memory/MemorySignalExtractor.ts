export interface MemorySignal {
	text: string;
	scope: "global" | "project";
	confidence: number;
	ephemeral: boolean;
}

const GLOBAL_HINTS = [/reply/i, /format/i, /style/i, /emoji/i, /以后/i, /始终/i, /总是/i, /不要/i];
const PROJECT_HINTS = [/project/i, /repo/i, /typescript/i, /react/i, /本项目/i, /当前项目/i, /代码/i, /依赖/i];

export function extractMemorySignals(userPrompt: string): MemorySignal[] {
	const prompt = userPrompt.trim();
	if (!prompt) {
		return [];
	}
	const normalized = prompt.replace(/\s+/g, " ").trim();
	const looksPersistent = /must|always|never|don't|do not|prefer|以后|必须|不要|禁止|默认|记住/i.test(normalized);
	if (!looksPersistent) {
		return [];
	}

	const scope = PROJECT_HINTS.some((pattern) => pattern.test(normalized)) ? "project" : "global";
	const confidence = GLOBAL_HINTS.some((pattern) => pattern.test(normalized)) || scope === "project" ? 0.92 : 0.86;

	return [
		{
			text: normalized,
			scope,
			confidence,
			ephemeral: false,
		},
	];
}
