export type SoulTonePreset = "balanced" | "calm" | "warm";

export interface SoulSummary {
	id: string;
	name: string;
	summary: string;
	description: string;
	presetRefs: string[];
	builtIn: boolean;
	editable: boolean;
	archived: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface SoulDefinition extends SoulSummary {
	rolePrompt: string;
	identityAnchor?: string;
	identityVoice?: string;
	styleDisclosure?: string;
	tonePreset: SoulTonePreset;
	tonePrompt: string;
	behaviorRules: string[];
	antiPatterns: string[];
	builtInPresetVersion?: number;
	preferredModel?: string;
	preferredModelMode?: "openai" | "group";
	tags: string[];
}

export interface SoulState {
	activeSoulId: string;
	lastUsedSoulId: string;
	recentlyUsedSoulIds: string[];
}
