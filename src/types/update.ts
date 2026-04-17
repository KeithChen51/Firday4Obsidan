import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";

export type PluginUpdateResultState = "idle" | "up-to-date" | "available" | "applied" | "error";

export interface ReleaseFeed {
	schemaVersion: number;
	pluginId: string;
	version: string;
	minAppVersion: string;
	branch: string;
	publishedAt?: string;
	releaseNotes?: string;
	files: {
		"main.js": string;
		"manifest.json": string;
		"styles.css"?: string;
	};
}

export type UpdateAvailabilityReason =
	| "ready"
	| "git_unavailable"
	| "git_profile_incomplete"
	| "remote_unreachable"
	| "invalid_release";

export interface UpdateAvailability {
	available: boolean;
	reason: UpdateAvailabilityReason;
	gitRuntime: GitRuntimeStatus;
	gitProfileComplete: boolean;
}

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion: string;
	release: ReleaseFeed | null;
	error?: string;
}

export interface UpdateApplyResult {
	success: boolean;
	updatedFiles: string[];
	error?: string;
}
