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
	tonePrompt: string;
	behaviorRules: string[];
	antiPatterns: string[];
	preferredModel?: string;
	tags: string[];
}

export interface SoulState {
	activeSoulId: string;
	lastUsedSoulId: string;
	recentlyUsedSoulIds: string[];
}
