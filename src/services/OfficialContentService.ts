import { mkdir, mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import {
	OFFICIAL_CONTENT_MANIFEST_PATH,
	OFFICIAL_CONTENT_PROVIDER_ID,
	OFFICIAL_CONTENT_RELEASE_BRANCH,
	OFFICIAL_CONTENT_ROOT_PATH,
} from "../constants/officialContent";
import { PLUGIN_UPDATE_REPO_URL } from "../constants/update";
import type { ProjectGitCredential } from "../types/project";
import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";
import type {
	OfficialContentCatalogEntry,
	OfficialContentChannelManifest,
	OfficialContentFileBlob,
	OfficialContentLegacyGuardState,
} from "../types/officialContent";
import type { FridaySettings } from "../types/settings";

type OfficialContentAdapter = {
	exists(path: string, sensitive?: boolean): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
	remove(path: string): Promise<void>;
	rmdir?(path: string, recursive: boolean): Promise<void>;
	list?(path: string): Promise<{ files: string[]; folders: string[] }>;
};

interface OfficialContentGitClient {
	ensureWorkspace(): Promise<void>;
	lsRemote(): Promise<string>;
	fetch(branch: string): Promise<void>;
	readText(ref: string, targetPath: string): Promise<string>;
	cleanup(): Promise<void>;
}

interface OfficialContentLatestFeed {
	schemaVersion: number;
	generatedAt?: string;
	providers?: Array<{
		id: string;
		title: string;
		rootPath: string;
		manifestPath: string;
		columns: OfficialContentCatalogEntry[];
	}>;
}

interface OfficialContentServiceDeps {
	adapter: OfficialContentAdapter;
	getSettings: () => FridaySettings;
	saveSettings: () => Promise<void>;
	getGitRuntimeStatus: () => Promise<GitRuntimeStatus>;
	getUserCredential: () => Promise<ProjectGitCredential | null>;
	getUserGitEmail: () => string;
	gitClientFactory?: (credential: ProjectGitCredential) => Promise<OfficialContentGitClient> | OfficialContentGitClient;
	inspectDestructiveApplySafety?: (input: {
		ownedTopLevelPaths: string[];
	}) => Promise<OfficialContentLegacyGuardState>;
}

export class OfficialContentService {
	private readonly gitClientFactory: (credential: ProjectGitCredential) => Promise<OfficialContentGitClient>;

	constructor(private readonly deps: OfficialContentServiceDeps) {
		this.gitClientFactory = async (credential) =>
			deps.gitClientFactory ? await deps.gitClientFactory(credential) : await createOfficialContentGitClient(credential);
	}

	async refreshCatalog(): Promise<OfficialContentCatalogEntry[]> {
		const latest = await this.fetchLatestFeed();
		if (!latest) {
			return this.deps.getSettings().officialContent.catalog;
		}

		const provider = latest.providers?.find((item) =>
			item.id === OFFICIAL_CONTENT_PROVIDER_ID || item.rootPath === OFFICIAL_CONTENT_ROOT_PATH,
		);
		if (!provider) {
			return this.deps.getSettings().officialContent.catalog;
		}

		const settings = this.deps.getSettings();
		const catalog = [...(provider.columns ?? [])]
			.map((item) => ({
				id: item.id,
				title: item.title,
				kind: item.kind,
				path: item.path,
				version: item.version,
				manifestPath: item.manifestPath || provider.manifestPath,
			}))
			.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));

		const channels = { ...settings.officialContent.channels };
		for (const entry of catalog) {
			channels[entry.id] = {
				subscribed: channels[entry.id]?.subscribed ?? true,
				lastAppliedVersion: channels[entry.id]?.lastAppliedVersion ?? "",
				path: entry.path,
			};
		}

		settings.officialContent.catalog = catalog;
		settings.officialContent.channels = channels;
		settings.officialContent.lastCheckedAt = new Date().toISOString();
		settings.officialContent.lastCatalogVersion = latest.generatedAt ?? buildCatalogVersion(catalog);
		await this.deps.saveSettings();

		return catalog;
	}

	async applySubscriptions(): Promise<OfficialContentLegacyGuardState> {
		const settings = this.deps.getSettings();
		const catalog = settings.officialContent.catalog.length > 0
			? settings.officialContent.catalog
			: await this.refreshCatalog();
		const ownedTopLevelPaths = [...new Set([
			...catalog.map((item) => item.path),
			...Object.values(settings.officialContent.channels)
				.map((item) => item.path?.trim() || "")
				.filter((item) => item.trim().length > 0),
		])];
		const guardState = this.deps.inspectDestructiveApplySafety
			? await this.deps.inspectDestructiveApplySafety({ ownedTopLevelPaths })
			: {
				blocked: false,
				blockingPaths: [],
				canRefreshCatalog: true,
				takeoverConfirmed: false,
			};
		if (guardState.blocked) {
			return guardState;
		}

		const manifestMap = await this.loadChannelManifests(catalog);
		const subscribed = new Set(
			Object.entries(settings.officialContent.channels)
				.filter(([, value]) => value.subscribed)
				.map(([id]) => id),
		);

		for (const entry of catalog) {
			if (subscribed.has(entry.id)) {
				await this.applyCatalogEntry(entry, manifestMap.get(entry.manifestPath) ?? null);
				settings.officialContent.channels[entry.id] = {
					subscribed: settings.officialContent.channels[entry.id]?.subscribed === true,
					lastAppliedVersion: entry.version,
					path: entry.path,
				};
				continue;
			}
			await this.removeCatalogEntry(entry);
			settings.officialContent.channels[entry.id] = {
				subscribed: false,
				lastAppliedVersion: "",
				path: entry.path,
			};
		}

		const activeIds = new Set(catalog.map((item) => item.id));
		for (const [channelId, state] of Object.entries({ ...settings.officialContent.channels })) {
			if (activeIds.has(channelId) || !state.path?.trim()) {
				continue;
			}
			await this.removePathRecursive(normalizeVaultPath(`${OFFICIAL_CONTENT_ROOT_PATH}/${state.path}`));
			delete settings.officialContent.channels[channelId];
		}

		await this.cleanupRootIfEmpty();
		await this.deps.saveSettings();
		return guardState;
	}

	async runStartupCheck(): Promise<void> {
		await this.refreshCatalog();
		await this.applySubscriptions();
	}

	private async fetchLatestFeed(): Promise<OfficialContentLatestFeed | null> {
		const availability = await this.getAvailability();
		if (!availability.ready) {
			return null;
		}

		const credential = await this.deps.getUserCredential();
		if (!credential?.username?.trim() || !credential.token?.trim()) {
			return null;
		}

		const gitClient = await this.gitClientFactory(credential);
		try {
			await gitClient.ensureWorkspace();
			await gitClient.lsRemote();
			await gitClient.fetch(OFFICIAL_CONTENT_RELEASE_BRANCH);
			const latestText = await gitClient.readText("FETCH_HEAD", OFFICIAL_CONTENT_MANIFEST_PATH);
			return JSON.parse(latestText) as OfficialContentLatestFeed;
		} finally {
			await gitClient.cleanup();
		}
	}

	private async loadChannelManifests(catalog: OfficialContentCatalogEntry[]): Promise<Map<string, OfficialContentChannelManifest>> {
		const manifestPaths = [...new Set(catalog.map((item) => item.manifestPath).filter(Boolean))];
		const manifests = new Map<string, OfficialContentChannelManifest>();
		if (manifestPaths.length === 0) {
			return manifests;
		}

		const availability = await this.getAvailability();
		if (!availability.ready) {
			throw new Error("Official content manifests cannot be loaded because Git or credentials are unavailable.");
		}

		const credential = await this.deps.getUserCredential();
		if (!credential?.username?.trim() || !credential.token?.trim()) {
			throw new Error("Official content manifests cannot be loaded because Git credentials are unavailable.");
		}

		const gitClient = await this.gitClientFactory(credential);
		try {
			await gitClient.ensureWorkspace();
			await gitClient.lsRemote();
			await gitClient.fetch(OFFICIAL_CONTENT_RELEASE_BRANCH);
			for (const manifestPath of manifestPaths) {
				const raw = await gitClient.readText("FETCH_HEAD", manifestPath);
				manifests.set(manifestPath, JSON.parse(raw) as OfficialContentChannelManifest);
			}
		} finally {
			await gitClient.cleanup();
		}

		return manifests;
	}

	private async applyCatalogEntry(
		entry: OfficialContentCatalogEntry,
		manifest: OfficialContentChannelManifest | null,
	): Promise<void> {
		if (!manifest) {
			throw new Error(`Official content manifest is unavailable for ${entry.id}.`);
		}
		const column = manifest.columns.find((item) => item.id === entry.id);
		if (!column) {
			throw new Error(`Official content manifest does not contain catalog entry: ${entry.id}.`);
		}

		const expectedFiles = new Map<string, OfficialContentFileBlob>();
		for (const file of column.files) {
			expectedFiles.set(normalizeVaultPath(file.path), file);
		}

		if (entry.kind === "directory") {
			for (const file of column.files) {
				await this.writeRemoteBlob(file);
			}
			const targetRoot = normalizeVaultPath(`${OFFICIAL_CONTENT_ROOT_PATH}/${entry.path}`);
			const existingFiles = await this.listFilesRecursive(targetRoot);
			for (const filePath of existingFiles) {
				const relative = normalizeVaultPath(filePath.replace(`${OFFICIAL_CONTENT_ROOT_PATH}/`, ""));
				if (!expectedFiles.has(relative)) {
					await this.removePathRecursive(filePath);
				}
			}
			await this.cleanupEmptyDirectories(targetRoot);
			return;
		}

		const onlyFile = column.files[0];
		if (!onlyFile) {
			throw new Error(`Official content catalog entry has no file to apply: ${entry.id}.`);
		}
		await this.writeRemoteBlob(onlyFile);
	}

	private async writeRemoteBlob(file: OfficialContentFileBlob): Promise<void> {
		const availability = await this.getAvailability();
		if (!availability.ready) {
			throw new Error(`Official content blob cannot be written because Git or credentials are unavailable: ${file.path}`);
		}

		const credential = await this.deps.getUserCredential();
		if (!credential?.username?.trim() || !credential.token?.trim()) {
			throw new Error(`Official content blob cannot be written because Git credentials are unavailable: ${file.path}`);
		}

		const gitClient = await this.gitClientFactory(credential);
		try {
			await gitClient.ensureWorkspace();
			await gitClient.lsRemote();
			await gitClient.fetch(OFFICIAL_CONTENT_RELEASE_BRANCH);
			const content = await gitClient.readText("FETCH_HEAD", file.blobPath);
			const targetPath = normalizeVaultPath(`${OFFICIAL_CONTENT_ROOT_PATH}/${file.path}`);
			await this.ensureDirectory(path.posix.dirname(targetPath));
			if (file.encoding === "base64") {
				if (typeof this.deps.adapter.writeBinary !== "function") {
					throw new Error(`Official content asset requires binary write support: ${file.path}`);
				}
				const bytes = Buffer.from(content.trim(), "base64");
				await this.deps.adapter.writeBinary(targetPath, toExactArrayBuffer(bytes));
				return;
			}
			await this.deps.adapter.write(targetPath, content);
		} finally {
			await gitClient.cleanup();
		}
	}

	private async removeCatalogEntry(entry: OfficialContentCatalogEntry): Promise<void> {
		await this.removePathRecursive(normalizeVaultPath(`${OFFICIAL_CONTENT_ROOT_PATH}/${entry.path}`));
	}

	private async cleanupRootIfEmpty(): Promise<void> {
		const listing = await this.listDirectory(OFFICIAL_CONTENT_ROOT_PATH);
		if (listing.files.length === 0 && listing.folders.length === 0) {
			await this.removePathRecursive(OFFICIAL_CONTENT_ROOT_PATH);
		}
	}

	private async cleanupEmptyDirectories(rootPath: string): Promise<void> {
		const listing = await this.listDirectory(rootPath);
		for (const folder of listing.folders) {
			await this.cleanupEmptyDirectories(folder);
		}
		if (rootPath === OFFICIAL_CONTENT_ROOT_PATH) {
			return;
		}
		const refreshed = await this.listDirectory(rootPath);
		if (refreshed.files.length === 0 && refreshed.folders.length === 0) {
			await this.removeDirectory(rootPath);
		}
	}

	private async listFilesRecursive(rootPath: string): Promise<string[]> {
		const listing = await this.listDirectory(rootPath);
		const files = [...listing.files];
		for (const folder of listing.folders) {
			files.push(...(await this.listFilesRecursive(folder)));
		}
		return files;
	}

	private async listDirectory(targetPath: string): Promise<{ files: string[]; folders: string[] }> {
		if (!(await this.deps.adapter.exists(targetPath))) {
			return { files: [], folders: [] };
		}
		if (typeof this.deps.adapter.list !== "function") {
			return { files: [], folders: [] };
		}
		return this.deps.adapter.list(targetPath);
	}

	private async ensureDirectory(targetDir: string): Promise<void> {
		const normalized = normalizeVaultPath(targetDir);
		if (!normalized || normalized === ".") {
			return;
		}
		const segments = normalized.split("/").filter(Boolean);
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (await this.deps.adapter.exists(current)) {
				continue;
			}
			await this.deps.adapter.mkdir(current);
		}
	}

	private async removePathRecursive(targetPath: string): Promise<void> {
		if (!(await this.deps.adapter.exists(targetPath))) {
			return;
		}
		const listing = await this.listDirectory(targetPath);
		for (const file of listing.files) {
			await this.deps.adapter.remove(file);
		}
		for (const folder of listing.folders) {
			await this.removePathRecursive(folder);
		}
		if (listing.files.length > 0 || listing.folders.length > 0) {
			await this.removeDirectory(targetPath);
			return;
		}
		await this.deps.adapter.remove(targetPath);
	}

	private async removeDirectory(targetPath: string): Promise<void> {
		if (typeof this.deps.adapter.rmdir === "function") {
			await this.deps.adapter.rmdir(targetPath, false);
			return;
		}
		await this.deps.adapter.remove(targetPath);
	}

	private async getAvailability(): Promise<{ ready: boolean; gitRuntime: GitRuntimeStatus }> {
		const gitRuntime = await this.deps.getGitRuntimeStatus();
		if (!gitRuntime.available) {
			return { ready: false, gitRuntime };
		}
		const credential = await this.deps.getUserCredential();
		const gitProfileComplete = Boolean(
			credential?.username?.trim() &&
			credential?.token?.trim(),
		);
		return { ready: gitProfileComplete, gitRuntime };
	}
}

function buildCatalogVersion(catalog: OfficialContentCatalogEntry[]): string {
	return JSON.stringify(catalog.map((item) => ({ id: item.id, version: item.version })));
}

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function createOfficialContentGitClient(credential: ProjectGitCredential): Promise<OfficialContentGitClient> {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "friday-official-content-"));
	const git = simpleGit({ baseDir: workspace, maxConcurrentProcesses: 1 });
	const authArgs = buildAuthArgs(credential);
	let initialized = false;

	return {
		async ensureWorkspace() {
			if (initialized) {
				return;
			}
			await mkdir(workspace, { recursive: true });
			await git.init();
			await git.addRemote("origin", PLUGIN_UPDATE_REPO_URL);
			initialized = true;
		},
		async lsRemote() {
			return git.raw([...authArgs, "ls-remote", PLUGIN_UPDATE_REPO_URL]);
		},
		async fetch(branch: string) {
			await git.raw([...authArgs, "fetch", "--depth", "1", "origin", branch]);
		},
		async readText(ref: string, targetPath: string) {
			return git.raw(["show", `${ref}:${targetPath}`]);
		},
		async cleanup() {
			await rm(workspace, { recursive: true, force: true });
		},
	};
}

function buildAuthArgs(credential: ProjectGitCredential): string[] {
	const basic = Buffer.from(`${credential.username}:${credential.token}`).toString("base64");
	return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
}
