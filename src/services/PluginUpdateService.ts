import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import {
	PLUGIN_UPDATE_ARTIFACT_DIR,
	PLUGIN_UPDATE_BRANCH,
	PLUGIN_UPDATE_CHANGELOG_PATH,
	PLUGIN_UPDATE_MAIN_JS_PATH,
	PLUGIN_UPDATE_MANIFEST_JSON_PATH,
	PLUGIN_UPDATE_MANIFEST_PATH,
	PLUGIN_UPDATE_REPO_URL,
	PLUGIN_UPDATE_STYLES_PATH,
} from "../constants/update";
import type { ProjectGitCredential } from "../types/project";
import type {
	ReleaseFeed,
	UpdateApplyResult,
	UpdateAvailability,
	UpdateCheckResult,
} from "../types/update";
import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";

export interface PluginUpdateAdapter {
	exists(path: string, sensitive?: boolean): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	rmdir?(path: string, recursive: boolean): Promise<void>;
	rename(path: string, newPath: string): Promise<void>;
}

export interface UpdateGitClient {
	ensureWorkspace(): Promise<void>;
	lsRemote(): Promise<string>;
	fetch(branch: string): Promise<void>;
	readText(ref: string, path: string): Promise<string>;
	cleanup(): Promise<void>;
}

export interface PluginUpdateServiceDeps {
	pluginId: string;
	currentVersion: string;
	adapter: PluginUpdateAdapter;
	getGitRuntimeStatus: () => Promise<GitRuntimeStatus>;
	getUserCredential: () => Promise<ProjectGitCredential | null>;
	getUserGitEmail: () => string;
	supportsMinAppVersion?: (minAppVersion: string) => boolean;
	gitClientFactory?: (credential: ProjectGitCredential) => Promise<UpdateGitClient> | UpdateGitClient;
	now?: () => Date;
}

interface UpdateSnapshot {
	release: ReleaseFeed;
	files: Map<string, string>;
	changelog: string | null;
}

export class PluginUpdateService {
	private readonly pluginRoot: string;
	private readonly updateRoot: string;
	private readonly backupRoot: string;
	private readonly supportsMinAppVersion: (minAppVersion: string) => boolean;
	private readonly gitClientFactory: (credential: ProjectGitCredential) => Promise<UpdateGitClient>;
	private readonly now: () => Date;

	constructor(private readonly deps: PluginUpdateServiceDeps) {
		this.pluginRoot = normalizePathLite(`.obsidian/plugins/${deps.pluginId}`);
		this.updateRoot = normalizePathLite(`${this.pluginRoot}/.update`);
		this.backupRoot = normalizePathLite(`${this.pluginRoot}/.backup`);
		this.supportsMinAppVersion = deps.supportsMinAppVersion ?? (() => true);
		this.gitClientFactory = async (credential) =>
			deps.gitClientFactory ? await deps.gitClientFactory(credential) : await createGitReleaseClient(credential);
		this.now = deps.now ?? (() => new Date());
	}

	async getAvailability(): Promise<UpdateAvailability> {
		const gitRuntime = await this.deps.getGitRuntimeStatus();
		if (!gitRuntime.available) {
			return {
				available: false,
				reason: "git_unavailable",
				gitRuntime,
				gitProfileComplete: false,
			};
		}

		const credential = await this.deps.getUserCredential();
		const gitProfileComplete = Boolean(
			this.deps.getUserGitEmail().trim() &&
			credential?.username?.trim() &&
			credential?.token?.trim(),
		);
		if (!gitProfileComplete) {
			return {
				available: false,
				reason: "git_profile_incomplete",
				gitRuntime,
				gitProfileComplete: false,
			};
		}

		return {
			available: true,
			reason: "ready",
			gitRuntime,
			gitProfileComplete: true,
		};
	}

	async checkForUpdate(): Promise<UpdateCheckResult> {
		try {
			const snapshot = await this.fetchReleaseSnapshot();
			const hasUpdate = isNewerStrictVersion(snapshot.release.version, this.deps.currentVersion);
			return {
				hasUpdate,
				currentVersion: this.deps.currentVersion,
				latestVersion: snapshot.release.version,
				release: hasUpdate ? snapshot.release : null,
			};
		} catch (error) {
			return {
				hasUpdate: false,
				currentVersion: this.deps.currentVersion,
				latestVersion: this.deps.currentVersion,
				release: null,
				error: error instanceof Error ? error.message : String(error ?? ""),
			};
		}
	}

	async applyUpdate(): Promise<UpdateApplyResult> {
		const updatedFiles: string[] = [];
		try {
			const snapshot = await this.fetchReleaseSnapshot();
			if (!isNewerStrictVersion(snapshot.release.version, this.deps.currentVersion)) {
				return {
					success: false,
					updatedFiles,
					error: "当前已是最新版本。",
				};
			}

			const versionDir = normalizePathLite(`${this.updateRoot}/${snapshot.release.version}`);
			await this.deps.adapter.mkdir(this.updateRoot);
			await this.deps.adapter.mkdir(versionDir);

			for (const [name, content] of snapshot.files.entries()) {
				await this.deps.adapter.write(normalizePathLite(`${versionDir}/${name}`), content);
			}

			const stagedManifestText = await this.deps.adapter.read(normalizePathLite(`${versionDir}/manifest.json`));
			const stagedManifest = JSON.parse(stagedManifestText) as { id?: string; version?: string };
			if (stagedManifest.id !== this.deps.pluginId || stagedManifest.version !== snapshot.release.version) {
				throw new Error("更新包中的 manifest.json 与当前插件不匹配。");
			}

			const backupStamp = buildBackupStamp(this.now());
			const backupDir = normalizePathLite(`${this.backupRoot}/${backupStamp}`);
			await this.deps.adapter.mkdir(this.backupRoot);
			await this.deps.adapter.mkdir(backupDir);

			const liveFiles = ["main.js", "manifest.json", "styles.css"];
			const backupContents = new Map<string, string | null>();
			for (const fileName of liveFiles) {
				const livePath = normalizePathLite(`${this.pluginRoot}/${fileName}`);
				if (await this.deps.adapter.exists(livePath)) {
					const content = await this.deps.adapter.read(livePath);
					backupContents.set(fileName, content);
					await this.deps.adapter.write(normalizePathLite(`${backupDir}/${fileName}`), content);
				} else {
					backupContents.set(fileName, null);
				}
			}
			const bundledChangelogPath = normalizePathLite(`${this.pluginRoot}/${PLUGIN_UPDATE_CHANGELOG_PATH}`);
			const bundledChangelogBackup = await this.readOptionalFile(bundledChangelogPath);

			try {
				for (const [name, content] of snapshot.files.entries()) {
					await this.deps.adapter.write(normalizePathLite(`${this.pluginRoot}/${name}`), content);
					updatedFiles.push(name);
				}
				if (snapshot.changelog?.trim()) {
					await this.deps.adapter.write(bundledChangelogPath, snapshot.changelog);
					updatedFiles.push("CHANGELOG.md");
				}
			} catch (error) {
				for (const [name, content] of backupContents.entries()) {
					const livePath = normalizePathLite(`${this.pluginRoot}/${name}`);
					if (content == null) {
						if (await this.deps.adapter.exists(livePath)) {
							await this.deps.adapter.remove(livePath);
						}
						continue;
					}
					await this.deps.adapter.write(livePath, content);
				}
				await this.restoreOptionalFile(bundledChangelogPath, bundledChangelogBackup);
				throw error;
			}

			for (const [name] of snapshot.files.entries()) {
				await this.removeIfExists(normalizePathLite(`${versionDir}/${name}`));
			}
			await this.removeDirectoryIfExists(versionDir);

			return {
				success: true,
				updatedFiles,
			};
		} catch (error) {
			return {
				success: false,
				updatedFiles,
				error: error instanceof Error ? error.message : String(error ?? ""),
			};
		}
	}

	private async fetchReleaseSnapshot(): Promise<UpdateSnapshot> {
		const availability = await this.getAvailability();
		if (!availability.available) {
			if (availability.reason === "git_unavailable") {
				throw new Error("未检测到本机 Git，内部更新不可用。");
			}
			throw new Error("Git 身份信息未填写完整，无法检查内部更新。");
		}

		const credential = await this.deps.getUserCredential();
		if (!credential?.username?.trim() || !credential.token?.trim()) {
			throw new Error("缺少 Git 认证信息。");
		}

		const gitClient = await this.gitClientFactory(credential);
		try {
			await gitClient.ensureWorkspace();
			await gitClient.lsRemote();
			await gitClient.fetch(PLUGIN_UPDATE_BRANCH);

			const manifestText = await gitClient.readText("FETCH_HEAD", PLUGIN_UPDATE_MANIFEST_PATH);
			const release = this.validateReleaseFeed(manifestText);

			const files = new Map<string, string>();
			files.set("main.js", await gitClient.readText("FETCH_HEAD", PLUGIN_UPDATE_MAIN_JS_PATH));
			files.set("manifest.json", await gitClient.readText("FETCH_HEAD", PLUGIN_UPDATE_MANIFEST_JSON_PATH));

			const stylesPath = release.files["styles.css"];
			if (stylesPath) {
				files.set("styles.css", await gitClient.readText("FETCH_HEAD", PLUGIN_UPDATE_STYLES_PATH));
			}

			let changelog: string | null = null;
			try {
				changelog = await gitClient.readText("FETCH_HEAD", PLUGIN_UPDATE_CHANGELOG_PATH);
			} catch (error) {
				console.warn("[Friday] Failed to read repository changelog for plugin update:", error);
			}
			if (!changelog && release.releaseNotes?.trim()) {
				changelog = buildFallbackChangelog(release);
			}

			return { release, files, changelog };
		} finally {
			await gitClient.cleanup();
		}
	}

	private validateReleaseFeed(raw: string): ReleaseFeed {
		const parsed = JSON.parse(raw) as Partial<ReleaseFeed>;
		if (parsed.schemaVersion !== 1) {
			throw new Error("更新描述 schemaVersion 非法。");
		}
		if (parsed.pluginId !== this.deps.pluginId) {
			throw new Error("更新源与当前插件不匹配。");
		}
		if (!parsed.version || !STRICT_VERSION_RE.test(parsed.version)) {
			throw new Error("更新描述中的 version 非法。");
		}
		if (!parsed.minAppVersion || !this.supportsMinAppVersion(parsed.minAppVersion)) {
			throw new Error("当前 Obsidian 版本不支持该更新。");
		}
		if (parsed.branch !== PLUGIN_UPDATE_BRANCH) {
			throw new Error("更新分支与预期不一致。");
		}
		if (!parsed.files?.["main.js"] || !parsed.files?.["manifest.json"]) {
			throw new Error("更新包不完整。");
		}
		const paths = [parsed.files["main.js"], parsed.files["manifest.json"], parsed.files["styles.css"]].filter(Boolean);
		for (const candidate of paths) {
			if (!candidate!.startsWith(`${PLUGIN_UPDATE_ARTIFACT_DIR}/`)) {
				throw new Error("更新文件路径超出正式产物目录。");
			}
		}
		return parsed as ReleaseFeed;
	}

	private async ensureDirectory(targetDir: string): Promise<void> {
		const normalized = normalizePathLite(targetDir);
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

	private async readOptionalFile(targetPath: string): Promise<string | null> {
		const normalized = normalizePathLite(targetPath);
		if (!(await this.deps.adapter.exists(normalized))) {
			return null;
		}
		return this.deps.adapter.read(normalized);
	}

	private async restoreOptionalFile(targetPath: string, content: string | null): Promise<void> {
		const normalized = normalizePathLite(targetPath);
		if (content == null) {
			if (await this.deps.adapter.exists(normalized)) {
				await this.deps.adapter.remove(normalized);
			}
			return;
		}
		await this.ensureDirectory(path.posix.dirname(normalized));
		await this.deps.adapter.write(normalized, content);
	}

	private async removeIfExists(targetPath: string): Promise<void> {
		if (await this.deps.adapter.exists(targetPath)) {
			await this.deps.adapter.remove(targetPath);
		}
	}

	private async removeDirectoryIfExists(targetPath: string): Promise<void> {
		if (!(await this.deps.adapter.exists(targetPath))) {
			return;
		}
		if (typeof this.deps.adapter.rmdir === "function") {
			await this.deps.adapter.rmdir(targetPath, false);
			return;
		}
		await this.deps.adapter.remove(targetPath);
	}
}

const STRICT_VERSION_RE = /^\d+\.\d+\.\d+$/;

function isNewerStrictVersion(latest: string, current: string): boolean {
	if (!STRICT_VERSION_RE.test(latest) || !STRICT_VERSION_RE.test(current)) {
		return false;
	}
	const latestParts = latest.split(".").map((item) => Number.parseInt(item, 10));
	const currentParts = current.split(".").map((item) => Number.parseInt(item, 10));
	for (let index = 0; index < 3; index += 1) {
		if ((latestParts[index] ?? 0) !== (currentParts[index] ?? 0)) {
			return (latestParts[index] ?? 0) > (currentParts[index] ?? 0);
		}
	}
	return false;
}

function buildBackupStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizePathLite(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/\/\.\//g, "/")
		.replace(/^\.\//, "")
		.replace(/\/$/, "");
}

function buildFallbackChangelog(release: ReleaseFeed): string {
	const lines = [
		"# Changelog",
		"",
		`## ${release.version}`,
	];
	if (release.publishedAt) {
		lines.push(``, `- Published at: ${release.publishedAt}`);
	}
	if (release.releaseNotes?.trim()) {
		lines.push("", release.releaseNotes.trim());
	}
	return lines.join("\n").trim();
}

async function createGitReleaseClient(credential: ProjectGitCredential): Promise<UpdateGitClient> {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "friday-plugin-update-"));
	const git = simpleGit({ baseDir: workspace, maxConcurrentProcesses: 1 });
	const authArgs = buildAuthArgs(credential);
	let initialized = false;

	return {
		async ensureWorkspace() {
			if (initialized) {
				return;
			}
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
