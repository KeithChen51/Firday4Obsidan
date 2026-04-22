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
}

export interface OfficialContentLegacyGuardState {
	blocked: boolean;
	blockingPaths: string[];
	canRefreshCatalog: boolean;
	takeoverConfirmed: boolean;
}
