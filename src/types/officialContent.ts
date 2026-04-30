export type OfficialContentKind = "directory" | "file";

export interface OfficialContentCatalogEntry {
	id: string;
	title: string;
	kind: OfficialContentKind;
	path: string;
	version: string;
	manifestPath: string;
}

export interface OfficialContentFileBlob {
	path: string;
	hash: string;
	blobPath: string;
	encoding?: "utf8" | "base64";
	mediaType?: string;
}

export interface OfficialContentChannelManifest {
	id: string;
	title: string;
	rootPath: string;
	columns: Array<OfficialContentCatalogEntry & {
		files: OfficialContentFileBlob[];
	}>;
}

export interface OfficialContentChannelSubscription {
	subscribed: boolean;
	lastAppliedVersion: string;
	path: string;
}

export interface OfficialContentLegacyGuardState {
	blocked: boolean;
	blockingPaths: string[];
	canRefreshCatalog: boolean;
}

export type OfficialContentSyncStage = "idle" | "refreshingCatalog" | "applyingSubscriptions" | "completed" | "failed";

export interface OfficialContentSyncProgress {
	stage: OfficialContentSyncStage;
	percent: number;
	message: string;
	error?: string;
}

export interface CommunityChannelSource {
	repoUrl: string;
	branch?: string;
	manifestPath?: string;
}
