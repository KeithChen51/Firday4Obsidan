import { promises as fs } from "fs";
import path from "path";
import simpleGit, { type SimpleGit } from "simple-git";
import { App, normalizePath } from "obsidian";
import { getPathPresets, getRootCandidates, PRIMARY_PATHS } from "../../constants/paths";
import type {
	ProjectEntry,
	ProjectGitCredential,
	SyncResult,
	SyncStatus,
	SyncWorkingTreeChange,
	SyncWorkingTreeChangeKind,
} from "../../types/project";
import type { FridaySettings } from "../../types/settings";
import { formatDate } from "../../utils/dateUtils";
import { getVaultBasePath } from "../../utils/vaultPath";
import { SecureStorage } from "../obsidian/SecureStorage";
import type { GitConflictContent, GitConflictResult, GitOperator, GitPullResult, GitPushResult } from "./GitOperator";
import { ProjectBoundaryService } from "../../services/ProjectBoundaryService";
import { probeGitRuntime, type GitRuntimeStatus } from "./GitRuntimeProbe";

type PostPullHandler = (
	project: ProjectEntry,
	pulledFiles: string[],
	headRevision: string,
) => Promise<void> | void;

export class SimpleGitOperator implements GitOperator {
	private gitAvailable: boolean | null = null;
	private gitVersion = "";
	private postPullHandler: PostPullHandler | null = null;

	constructor(
		private readonly app: App,
		private readonly fridayRoot: string,
		private readonly getSettings: () => FridaySettings,
		private readonly secureStorage: SecureStorage,
		private readonly projectBoundaryService: ProjectBoundaryService,
	) {}

	setPostPullHandler(handler: PostPullHandler | null): void {
		this.postPullHandler = handler;
	}

	async prepareRepository(project: ProjectEntry): Promise<void> {
		await this.ensureGitAvailable();
		const baseDir = this.resolveProjectPath(project);
		await fs.mkdir(baseDir, { recursive: true });

		if (!project.gitRemote?.trim() && project.gitState === "none") {
			return;
		}

		const git = this.createGit(baseDir);
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			await git.init();
		}

		if (!project.gitRemote?.trim()) {
			return;
		}

		await this.ensureGitIdentity(project, git);
		await this.ensureOriginRemote(project, git);
	}

	async commitWorkingTree(project: ProjectEntry): Promise<string[]> {
		await this.prepareRepository(project);
		const git = await this.requireRepoGit(project);
		const status = await git.status();
		const changedFiles = status.files.map((file) => file.path);
		if (changedFiles.length === 0) {
			return [];
		}

		await git.add(".");
		const commitMessage = `friday-sync(${project.projectName || project.slug}): ${formatDate()} ${new Date()
			.toTimeString()
			.slice(0, 5)}`;
		await git.commit(commitMessage);
		return changedFiles;
	}

	async pull(project: ProjectEntry): Promise<GitPullResult> {
		try {
			await this.ensureGitAvailable();
			const git = await this.requireSyncGit(project);
			const hasTracking = await this.hasTrackingBranch(git);
			if (!hasTracking) {
				return {
					success: true,
					pulledFiles: [],
				};
			}

			const status = await git.status();
			let hasStash = false;
			const headBeforePull = await this.getHeadRevision(git);

			if (!status.isClean()) {
				await git.stash(["push", "-u", "-m", "friday-auto-stash"]);
				hasStash = true;
			}

			await git.raw([...(await this.authArgs(project)), "pull", "--rebase"]);
			const headAfterPull = await this.getHeadRevision(git);
			const pulledFiles = await this.collectPulledFiles(git, headBeforePull, headAfterPull);

			if (hasStash) {
				try {
					await git.stash(["pop"]);
				} catch (error) {
					return {
						success: false,
						pulledFiles,
						error: `Stash pop recovery failed: ${String(error)}`,
					};
				}
			}

			if (this.postPullHandler && pulledFiles.length > 0) {
				try {
					await this.postPullHandler(project, pulledFiles, headAfterPull);
				} catch (error) {
					console.warn("[Friday] Post-pull handler failed:", error);
				}
			}

			return {
				success: true,
				pulledFiles,
			};
		} catch (error) {
			return {
				success: false,
				pulledFiles: [],
				error: String(error),
			};
		}
	}

	async detectConflicts(project: ProjectEntry): Promise<GitConflictResult> {
		const git = await this.requireRepoGit(project);
		const output = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
		const conflicts = output
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);
		const conflictSnapshots =
			conflicts.length > 0 ? await this.createConflictSnapshots(project, conflicts, git) : undefined;
		return { conflicts, conflictSnapshots };
	}

	async readConflictContent(
		project: ProjectEntry,
		filePath: string,
		snapshotPath?: string,
	): Promise<GitConflictContent> {
		const git = await this.requireRepoGit(project);
		const projectPath = this.resolveProjectPath(project);
		const workingFilePath = path.join(projectPath, filePath);
		const [localSnippet, remoteSnippet, mergedSnippet] = await Promise.all([
			this.readConflictBlob(git, `:2:${filePath}`),
			this.readConflictBlob(git, `:3:${filePath}`),
			fs.readFile(workingFilePath, "utf8").catch(() => ""),
		]);
		return {
			filePath: normalizePath(filePath),
			localSnippet,
			remoteSnippet,
			mergedSnippet,
			snapshotPath,
		};
	}

	async push(project: ProjectEntry): Promise<GitPushResult> {
		try {
			await this.ensureGitAvailable();
			const git = await this.requireSyncGit(project);
			if (await this.hasTrackingBranch(git)) {
				await git.raw([...(await this.authArgs(project)), "push"]);
			} else {
				const branchSummary = await git.branchLocal();
				const branchName = branchSummary.current?.trim() || "HEAD";
				await git.raw([...(await this.authArgs(project)), "push", "-u", "origin", branchName]);
			}
			return {
				success: true,
				pushedFiles: [],
			};
		} catch (error) {
			return {
				success: false,
				pushedFiles: [],
				error: String(error),
			};
		}
	}

	async getStatus(project: ProjectEntry): Promise<SyncStatus> {
		try {
			await this.ensureGitAvailable();
			const git = await this.getRepoGitOrNull(project);
			if (!git) {
				return this.makeDefaultStatus(project, false);
			}

			const status = await git.status();
			const workingTreeChanges = this.buildWorkingTreeChanges(status);
			const connected = project.gitRemote ? await this.canReachRemote(project, git) : false;

			return {
				projectSlug: project.slug,
				projectId: project.projectId,
				branch: status.current?.trim() || "",
				connected,
				ahead: status.ahead,
				behind: status.behind,
				dirty: workingTreeChanges.length,
				conflicts: status.conflicted.length,
				lastSyncAt: project.lastSyncAt || "",
				workingTreeChanges,
			};
		} catch (error) {
			console.error("[Friday] Failed to get sync status:", error);
			return this.makeDefaultStatus(project, false);
		}
	}

	async resolveConflict(project: ProjectEntry, filePath: string, strategy: "ours" | "theirs"): Promise<void> {
		const git = await this.requireRepoGit(project);
		const flag = strategy === "ours" ? "--ours" : "--theirs";
		await git.raw(["checkout", flag, "--", filePath]);
		await git.add(filePath);
	}

	async finalizeConflictResolution(project: ProjectEntry): Promise<void> {
		const remaining = await this.detectConflicts(project);
		if (remaining.conflicts.length > 0) {
			throw new Error("仍有冲突未解决。");
		}
	}

	makeErrorResult(projectSlug: string, error: unknown): SyncResult {
		return {
			success: false,
			projectSlug,
			pulledFiles: [],
			pushedFiles: [],
			conflicts: [],
			error: String(error),
		};
	}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		return this.secureStorage.getProjectGitCredential(projectId);
	}

	async setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void> {
		await this.secureStorage.setProjectGitCredential(projectId, credential);
	}

	async getUserGitCredential(): Promise<ProjectGitCredential | null> {
		return this.secureStorage.getUserGitCredential();
	}

	async setUserGitCredential(credential: ProjectGitCredential | null): Promise<void> {
		await this.secureStorage.setUserGitCredential(credential);
	}

	async getGitRuntimeStatus(): Promise<GitRuntimeStatus> {
		const status = await probeGitRuntime();
		if (status.available) {
			this.gitAvailable = true;
			this.gitVersion = status.version;
		} else {
			this.gitAvailable = false;
			this.gitVersion = "";
		}
		return status;
	}

	private async ensureGitAvailable(): Promise<void> {
		if (this.gitAvailable === true) {
			return;
		}
		if (this.gitAvailable === false) {
			throw new Error("当前环境不可用 Git。");
		}

		const status = await this.getGitRuntimeStatus();
		if (!status.available) {
			throw new Error(`未找到 Git：${status.error}`);
		}
	}

	private createGit(baseDir: string): SimpleGit {
		return simpleGit({ baseDir, maxConcurrentProcesses: 1 });
	}

	private async getRepoGitOrNull(project: ProjectEntry): Promise<SimpleGit | null> {
		const baseDir = this.resolveProjectPath(project);
		const stat = await fs.stat(baseDir).catch(() => null);
		if (!stat?.isDirectory()) {
			return null;
		}

		const git = this.createGit(baseDir);
		const isRepo = await git.checkIsRepo();
		return isRepo ? git : null;
	}

	private async requireRepoGit(project: ProjectEntry): Promise<SimpleGit> {
		const baseDir = this.resolveProjectPath(project);
		const stat = await fs.stat(baseDir).catch(() => null);
		if (!stat?.isDirectory()) {
			throw new Error(`项目路径不存在：${baseDir}`);
		}

		const git = this.createGit(baseDir);
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			throw new Error(`项目目录尚未初始化 Git 仓库：${baseDir}。请先执行 git init 并配置远程。`);
		}

		return git;
	}

	private async requireSyncGit(project: ProjectEntry): Promise<SimpleGit> {
		await this.prepareRepository(project);
		if (!project.gitRemote?.trim()) {
			throw new Error(`项目 ${project.slug} 未配置 Git 远程地址，请先在“编辑项目”中补充。`);
		}

		return this.requireRepoGit(project);
	}

	private async hasTrackingBranch(git: SimpleGit): Promise<boolean> {
		const summary = await git.branchLocal();
		const branch = summary.current?.trim();
		if (!branch) {
			return false;
		}
		const branches = summary.branches as Record<string, { tracking?: string }>;
		return Boolean(branches[branch]?.tracking);
	}

	private async getHeadRevision(git: SimpleGit): Promise<string> {
		try {
			return (await git.revparse(["HEAD"])).trim();
		} catch {
			return "";
		}
	}

	private async collectPulledFiles(git: SimpleGit, headBeforePull: string, headAfterPull: string): Promise<string[]> {
		if (!headBeforePull || !headAfterPull || headBeforePull === headAfterPull) {
			return [];
		}
		try {
			const output = await git.diff(["--name-only", `${headBeforePull}..${headAfterPull}`]);
			return output
				.split(/\r?\n/)
				.map((item) => normalizePath(item.trim()))
				.filter(Boolean);
		} catch (error) {
			console.warn("[Friday] Failed to collect pulled files:", error);
			return [];
		}
	}

	private resolveProjectPath(project: ProjectEntry): string {
		const absolutePath = this.projectBoundaryService.getProjectAbsolutePath(project);
		if (absolutePath) {
			return absolutePath;
		}

		const vaultBasePath = getVaultBasePath(this.app);
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const relativePath = normalizePath(`${root}/${preset.projects}/${project.projectId || project.slug}`);
				if (this.app.vault.getAbstractFileByPath(relativePath)) {
					return path.join(vaultBasePath, root, preset.projects, project.projectId || project.slug);
				}
			}
		}

		return path.join(vaultBasePath, this.fridayRoot, PRIMARY_PATHS.projects, project.projectId || project.slug);
	}

	private async authArgs(project: ProjectEntry): Promise<string[]> {
		const credential = await this.resolveGitCredential(project);
		if (!credential?.username || !credential.token) {
			return [];
		}

		const basic = Buffer.from(`${credential.username}:${credential.token}`).toString("base64");
		return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
	}

	private async ensureOriginRemote(project: ProjectEntry, git: SimpleGit): Promise<void> {
		const remoteUrl = project.gitRemote?.trim();
		if (!remoteUrl) {
			return;
		}

		const remotes = await git.getRemotes(true);
		const origin = remotes.find((item) => item.name === "origin");
		const currentUrl = origin?.refs?.fetch?.trim() ?? "";

		if (!origin) {
			await git.addRemote("origin", remoteUrl);
			return;
		}
		if (!currentUrl || currentUrl !== remoteUrl) {
			await git.raw(["remote", "set-url", "origin", remoteUrl]);
		}
	}

	private async ensureGitIdentity(project: ProjectEntry, git: SimpleGit): Promise<void> {
		const localName = await this.readGitConfig(git, ["config", "--get", "user.name"]);
		const localEmail = await this.readGitConfig(git, ["config", "--get", "user.email"]);
		const globalName = await this.readGitConfig(git, ["config", "--global", "--get", "user.name"]);
		const globalEmail = await this.readGitConfig(git, ["config", "--global", "--get", "user.email"]);

		const owner = this.parseRemoteOwner(project.gitRemote);
		const user = this.getSettings().user;
		const credential = await this.resolveGitCredential(project);
		const inferredName = credential?.username?.trim() || owner;
		const inferredEmail = user.gitUserEmail?.trim() || this.inferNoreplyEmail(project.gitRemote, owner);

		if (!localName && !globalName) {
			if (!inferredName) {
				throw new Error("Git 全局 user.name 缺失。请在项目设置中填写 Git 用户名，或手动执行 git config --global user.name \"Your Name\"。");
			}
			await git.raw(["config", "--local", "user.name", inferredName]);
		}

		if (!localEmail && !globalEmail) {
			if (!inferredEmail) {
				throw new Error("Git 全局 user.email 缺失。请在设置 > 用户中填写 Git 提交邮箱，或手动执行 git config --global user.email \"you@example.com\"。");
			}
			await git.raw(["config", "--local", "user.email", inferredEmail]);
		}
	}

	private async readGitConfig(git: SimpleGit, args: string[]): Promise<string> {
		try {
			return (await git.raw(args)).trim();
		} catch {
			return "";
		}
	}

	private parseRemoteOwner(remote: string): string {
		const input = remote.trim();
		if (!input) {
			return "";
		}

		let resourcePath = "";
		const sshLike = input.match(/^git@[^:]+:(.+)$/i);
		const sshProtocol = input.match(/^ssh:\/\/git@[^/]+\/(.+)$/i);
		const httpsLike = input.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);

		if (sshLike) {
			resourcePath = sshLike[1] ?? "";
		} else if (sshProtocol) {
			resourcePath = sshProtocol[1] ?? "";
		} else if (httpsLike) {
			resourcePath = httpsLike[1] ?? "";
		}

		const segments = resourcePath.replace(/\.git$/i, "").split("/").map((item) => item.trim()).filter(Boolean);
		if (segments.length < 2) {
			return "";
		}
		return segments[segments.length - 2] ?? "";
	}

	private parseRemoteHost(remote: string): string {
		const input = remote.trim();
		if (!input) {
			return "";
		}
		const sshLike = input.match(/^git@([^:]+):.+$/i);
		const sshProtocol = input.match(/^ssh:\/\/git@([^/]+)\/.+$/i);
		const httpsLike = input.match(/^[a-z]+:\/\/([^/]+)\/.+$/i);
		return (sshLike?.[1] ?? sshProtocol?.[1] ?? httpsLike?.[1] ?? "").toLowerCase();
	}

	private inferNoreplyEmail(remote: string, owner: string): string {
		if (!owner) {
			return "";
		}
		const host = this.parseRemoteHost(remote);
		if (host.includes("github.com")) {
			return `${owner}@users.noreply.github.com`;
		}
		if (host.includes("gitee.com")) {
			return `${owner}@users.noreply.gitee.com`;
		}
		return "";
	}

	private async canReachRemote(project: ProjectEntry, git: SimpleGit): Promise<boolean> {
		if (!project.gitRemote) {
			return false;
		}

		try {
			await git.raw([...(await this.authArgs(project)), "ls-remote", project.gitRemote]);
			return true;
		} catch {
			return false;
		}
	}

	private async readConflictBlob(git: SimpleGit, spec: string): Promise<string> {
		try {
			return await git.raw(["show", spec]);
		} catch {
			return "";
		}
	}

	private async createConflictSnapshots(
		project: ProjectEntry,
		conflicts: string[],
		git: SimpleGit,
	): Promise<Record<string, string>> {
		const snapshots: Record<string, string> = {};
		const projectPath = this.resolveProjectPath(project);
		const timestamp = Date.now();

		for (const conflictPath of conflicts) {
			try {
				const theirs = await git.raw(["show", `:3:${conflictPath}`]);
				const snapshotPath = path.join(projectPath, `${conflictPath}.conflict-${timestamp}.md`);
				await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
				await fs.writeFile(snapshotPath, theirs, "utf8");
				snapshots[conflictPath] = snapshotPath;
			} catch (error) {
				console.warn("[Friday] Failed to create conflict snapshot:", conflictPath, error);
			}
		}

		return snapshots;
	}

	private makeDefaultStatus(project: ProjectEntry, connected: boolean): SyncStatus {
		return {
			projectSlug: project.slug,
			projectId: project.projectId,
			branch: "",
			connected,
			ahead: 0,
			behind: 0,
			dirty: 0,
			conflicts: 0,
			lastSyncAt: project.lastSyncAt || "",
			workingTreeChanges: [],
		};
	}

	private buildWorkingTreeChanges(
		status: Awaited<ReturnType<SimpleGit["status"]>>,
	): SyncWorkingTreeChange[] {
		const changes = new Map<string, SyncWorkingTreeChangeKind>();
		const addPaths = (paths: string[] | undefined, kind: SyncWorkingTreeChangeKind) => {
			for (const item of paths ?? []) {
				if (!item?.trim()) {
					continue;
				}
				changes.set(normalizePath(item.trim()), kind);
			}
		};
		const summary = status as typeof status & {
			not_added?: string[];
			modified?: string[];
			deleted?: string[];
			conflicted?: string[];
			created?: string[];
			renamed?: Array<{ from: string; to: string }>;
		};
		addPaths(summary.not_added, "untracked");
		addPaths(summary.created, "untracked");
		addPaths(summary.modified, "modified");
		addPaths(summary.deleted, "deleted");
		addPaths(summary.conflicted, "conflicted");
		for (const item of summary.renamed ?? []) {
			if (item?.to?.trim()) {
				changes.set(normalizePath(item.to.trim()), "renamed");
			}
		}
		return [...changes.entries()]
			.map(([path, kind]) => ({ path, kind }))
			.sort((left, right) => left.path.localeCompare(right.path, "en"));
	}

	private async resolveGitCredential(project: ProjectEntry): Promise<ProjectGitCredential | null> {
		const projectId = project.projectId || project.slug;
		const projectCredential = projectId ? await this.getProjectGitCredential(projectId) : null;
		if (projectCredential) {
			return projectCredential;
		}
		return this.getUserGitCredential();
	}
}
