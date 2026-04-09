import { promises as fs } from "fs";
import path from "path";
import simpleGit, { SimpleGit } from "simple-git";
import { App, normalizePath } from "obsidian";
import { getPathPresets, getRootCandidates, PRIMARY_PATHS } from "../constants/paths";
import { ProjectEntry, SyncResult, SyncStatus } from "../types/project";
import { formatDate } from "../utils/dateUtils";
import { getVaultBasePath } from "../utils/vaultPath";

type PostPullHandler = (
	project: ProjectEntry,
	pulledFiles: string[],
	headRevision: string,
) => Promise<void> | void;

export class SyncService {
	private gitAvailable: boolean | null = null;
	private postPullHandler: PostPullHandler | null = null;

	constructor(private readonly app: App, private readonly fridayRoot = PRIMARY_PATHS.root) {}

	setPostPullHandler(handler: PostPullHandler | null): void {
		this.postPullHandler = handler;
	}

	async prepareRepository(project: ProjectEntry): Promise<void> {
		await this.ensureGitAvailable();
		const baseDir = this.resolveProjectPath(project);
		await fs.mkdir(baseDir, { recursive: true });

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

	async pull(project: ProjectEntry): Promise<SyncResult> {
		try {
			await this.ensureGitAvailable();
			const git = await this.requireSyncGit(project);
			const hasTracking = await this.hasTrackingBranch(git);
			if (!hasTracking) {
				return {
					success: true,
					projectSlug: project.slug,
					pulledFiles: [],
					pushedFiles: [],
					conflicts: [],
				};
			}

				const status = await git.status();
				let hasStash = false;
				const headBeforePull = await this.getHeadRevision(git);

				if (!status.isClean()) {
					await git.stash(["push", "-u", "-m", "friday-auto-stash"]);
					hasStash = true;
				}

				await git.raw([...this.authArgs(project), "pull", "--rebase"]);
				const headAfterPull = await this.getHeadRevision(git);
				const pulledFiles = await this.collectPulledFiles(git, headBeforePull, headAfterPull);

				if (hasStash) {
					try {
						await git.stash(["pop"]);
					} catch (error) {
					console.warn("[Friday] Stash pop produced conflict:", error);
				}
			}

			const conflicts = await this.getConflicts(project);
				const conflictSnapshots =
					conflicts.length > 0
						? await this.createConflictSnapshots(project, conflicts, git)
						: undefined;
				if (this.postPullHandler && pulledFiles.length > 0) {
					try {
						await this.postPullHandler(project, pulledFiles, headAfterPull);
					} catch (error) {
						console.warn("[Friday] Post-pull handler failed:", error);
					}
				}

				return {
					success: conflicts.length === 0,
					projectSlug: project.slug,
					pulledFiles,
					pushedFiles: [],
					conflicts,
					conflictSnapshots,
				};
		} catch (error) {
			return this.makeErrorResult(project.slug, error);
		}
	}

	async push(project: ProjectEntry): Promise<SyncResult> {
		try {
			await this.ensureGitAvailable();
			const git = await this.requireSyncGit(project);
			const status = await git.status();
			const changedFiles = status.files.map((file) => file.path);

			if (changedFiles.length > 0) {
				await git.add(".");
				const commitMessage = `friday: sync ${formatDate()} ${new Date()
					.toTimeString()
					.slice(0, 5)}`;
				await git.commit(commitMessage);
			}

			if (await this.hasTrackingBranch(git)) {
				await git.raw([...this.authArgs(project), "push"]);
			} else {
				const branchSummary = await git.branchLocal();
				const branchName = branchSummary.current?.trim() || "HEAD";
				await git.raw([...this.authArgs(project), "push", "-u", "origin", branchName]);
			}

			return {
				success: true,
				projectSlug: project.slug,
				pulledFiles: [],
				pushedFiles: changedFiles,
				conflicts: [],
			};
		} catch (error) {
			return this.makeErrorResult(project.slug, error);
		}
	}

	async sync(project: ProjectEntry): Promise<SyncResult> {
		const pulled = await this.pull(project);
		if (!pulled.success) {
			return pulled;
		}

		const pushed = await this.push(project);
		return {
			...pushed,
			pulledFiles: pulled.pulledFiles,
			conflicts: [...pulled.conflicts, ...pushed.conflicts],
			conflictSnapshots: {
				...(pulled.conflictSnapshots ?? {}),
				...(pushed.conflictSnapshots ?? {}),
			},
		};
	}

	async syncAll(projects: ProjectEntry[]): Promise<Map<string, SyncResult>> {
		const result = new Map<string, SyncResult>();
		for (const project of projects.filter((item) => item.autoSync)) {
			result.set(project.slug, await this.sync(project));
		}
		return result;
	}

	async getStatus(project: ProjectEntry): Promise<SyncStatus> {
		try {
			await this.ensureGitAvailable();
			const git = await this.getRepoGitOrNull(project);
			if (!git) {
				return this.makeDefaultStatus(project, false);
			}

			const status = await git.status();
			const connected = project.gitRemote
				? await this.canReachRemote(project, git)
				: false;

			return {
				projectSlug: project.slug,
				connected,
				ahead: status.ahead,
				behind: status.behind,
				dirty: status.files.length,
				conflicts: status.conflicted.length,
				lastSyncAt: project.lastSyncAt || "",
			};
		} catch (error) {
			console.error("[Friday] Failed to get sync status:", error);
			return this.makeDefaultStatus(project, false);
		}
	}

	async getConflicts(project: ProjectEntry): Promise<string[]> {
		const git = await this.requireRepoGit(project);
		const output = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
		return output
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);
	}

	async resolveConflict(
		project: ProjectEntry,
		filePath: string,
		strategy: "ours" | "theirs",
	): Promise<void> {
		const git = await this.requireRepoGit(project);
		const flag = strategy === "ours" ? "--ours" : "--theirs";
		await git.raw(["checkout", flag, "--", filePath]);
		await git.add(filePath);
	}

	async finalizeConflictResolution(project: ProjectEntry): Promise<void> {
		const git = await this.requireRepoGit(project);
		const remaining = await this.getConflicts(project);
		if (remaining.length > 0) {
			throw new Error("仍有冲突未解决。");
		}

		await git.commit("friday: resolve conflicts");
	}

	private async ensureGitAvailable(): Promise<void> {
		if (this.gitAvailable === true) {
			return;
		}

		if (this.gitAvailable === false) {
			throw new Error("当前环境不可用 Git。");
		}

		try {
			await simpleGit().raw(["--version"]);
			this.gitAvailable = true;
		} catch (error) {
			this.gitAvailable = false;
			throw new Error(`未找到 Git：${String(error)}`);
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
			throw new Error(
				`项目目录尚未初始化 Git 仓库：${baseDir}。请先执行 git init 并配置远程。`,
			);
		}

		return git;
	}

	private async requireSyncGit(project: ProjectEntry): Promise<SimpleGit> {
		await this.prepareRepository(project);
		if (!project.gitRemote?.trim()) {
			throw new Error(
				`项目 ${project.slug} 未配置 Git 远程地址，请先在“编辑项目”中补充。`,
			);
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

	private async collectPulledFiles(
		git: SimpleGit,
		headBeforePull: string,
		headAfterPull: string,
	): Promise<string[]> {
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
		if (project.localPath?.trim()) {
			return path.normalize(project.localPath);
		}

		if (project.projectRootPath?.trim()) {
			const normalizedRootPath = normalizePath(project.projectRootPath);
			if (!path.isAbsolute(normalizedRootPath)) {
				const vaultBasePath = getVaultBasePath(this.app);
				return path.join(vaultBasePath, ...normalizedRootPath.split("/"));
			}
		}

		const vaultBasePath = getVaultBasePath(this.app);
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const relativePath = normalizePath(`${root}/${preset.projects}/${project.slug}`);
				if (this.app.vault.getAbstractFileByPath(relativePath)) {
					return path.join(vaultBasePath, root, preset.projects, project.slug);
				}
			}
		}

		return path.join(
			vaultBasePath,
			this.fridayRoot,
			PRIMARY_PATHS.projects,
			project.slug,
		);
	}

	private authArgs(project: ProjectEntry): string[] {
		if (!project.gitUsername || !project.gitToken) {
			return [];
		}

		const basic = Buffer.from(`${project.gitUsername}:${project.gitToken}`).toString("base64");
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
		const inferredName = project.gitUsername?.trim() || owner;
		const inferredEmail = project.gitUserEmail?.trim() || (owner ? `${owner}@users.noreply.gitee.com` : "");

		if (!localName && !globalName) {
			if (!inferredName) {
				throw new Error(
					"Git 全局 user.name 缺失。请在项目中填写 Git 用户名，或手动执行 git config --global user.name \"Your Name\"。",
				);
			}
			// Write to local (repo-level) config to avoid affecting other repositories (#2)
			await git.raw(["config", "--local", "user.name", inferredName]);
		}

		if (!localEmail && !globalEmail) {
			if (!inferredEmail) {
				throw new Error(
					"Git 全局 user.email 缺失。请在项目中填写 Git 提交邮箱，或手动执行 git config --global user.email \"you@example.com\"。",
				);
			}
			// Write to local (repo-level) config to avoid affecting other repositories (#2)
			await git.raw(["config", "--local", "user.email", inferredEmail]);
		}
	}

	private async readGitConfig(git: SimpleGit, args: string[]): Promise<string> {
		try {
			const output = await git.raw(args);
			return output.trim();
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

		const segments = resourcePath
			.replace(/\.git$/i, "")
			.split("/")
			.map((item) => item.trim())
			.filter(Boolean);

		if (segments.length < 2) {
			return "";
		}

		return segments[segments.length - 2] ?? "";
	}

	private async canReachRemote(project: ProjectEntry, git: SimpleGit): Promise<boolean> {
		if (!project.gitRemote) {
			return false;
		}

		try {
			await git.raw([...this.authArgs(project), "ls-remote", project.gitRemote]);
			return true;
		} catch {
			return false;
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
				const snapshotPath = path.join(
					projectPath,
					`${conflictPath}.conflict-${timestamp}.md`,
				);

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
			connected,
			ahead: 0,
			behind: 0,
			dirty: 0,
			conflicts: 0,
			lastSyncAt: project.lastSyncAt || "",
		};
	}

	private makeErrorResult(projectSlug: string, error: unknown): SyncResult {
		return {
			success: false,
			projectSlug,
			pulledFiles: [],
			pushedFiles: [],
			conflicts: [],
			error: String(error),
		};
	}
}
