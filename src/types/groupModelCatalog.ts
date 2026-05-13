export interface GroupModelCatalogCapabilities {
	text?: boolean;
	image?: boolean;
	toolCall?: boolean;
	reasoning?: boolean;
}

export interface GroupModelCatalogModel {
	id: string;
	label: string;
	enabled: boolean;
	capabilities: GroupModelCatalogCapabilities;
}

export interface GroupModelCatalogDefaults {
	chat?: string;
	agent?: string;
	vision?: string;
	fallback?: string;
}

export interface GroupModelCatalogFeed {
	schemaVersion: 1;
	catalogVersion: string;
	updatedAt?: string;
	recommendedBranch?: string;
	providerId?: string;
	providerName?: string;
	models: GroupModelCatalogModel[];
	defaults?: GroupModelCatalogDefaults;
}

export interface GroupModelCatalogSettings {
	enabled: boolean;
	checkOnStartup: boolean;
	startupDelayMs: number;
	repoUrl: string;
	branch: string;
	filePath: string;
	lastCheckedAt: string;
	lastCatalogVersion: string;
	lastResult: "idle" | "updated" | "up-to-date" | "error";
	lastError: string;
	providerId: string;
	providerName: string;
	models: GroupModelCatalogModel[];
	defaults: GroupModelCatalogDefaults;
}

export interface GroupModelCatalogSyncResult {
	success: boolean;
	updated: boolean;
	catalogVersion: string;
	modelCount: number;
	error?: string;
}
