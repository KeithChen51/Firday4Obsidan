import type { FridaySettings, LlmModeConfig } from "../types/settings";

export interface OnboardingSnapshot {
	modelConfigured: boolean;
	projectRegistered: boolean;
	shouldShowPanel: boolean;
}

export class OnboardingService {
	constructor(
		private readonly getSettings: () => FridaySettings,
	) {}

	getSnapshot(): OnboardingSnapshot {
		const settings = this.getSettings();
		const modelConfigured = this.isModelConfigured(settings);
		const projectRegistered = settings.projects.length > 0;

		return {
			modelConfigured,
			projectRegistered,
			shouldShowPanel: !settings.workbench.onboardingDismissed && (!projectRegistered || !modelConfigured),
		};
	}

	private isModelConfigured(settings: FridaySettings): boolean {
		const modeConfig = settings.llm.mode === "group" ? settings.llm.groupConfig : settings.llm.openaiConfig;
		return this.hasModelEndpoint(modeConfig) || this.hasModelEndpoint(settings.llm);
	}

	private hasModelEndpoint(config: Pick<LlmModeConfig, "apiUrl" | "model">): boolean {
		return Boolean(config.apiUrl.trim() && config.model.trim());
	}
}
