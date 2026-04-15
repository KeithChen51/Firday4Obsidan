import { promises as fs } from "fs";
import path from "path";
import { App } from "obsidian";
import simpleGit from "simple-git";
import { PRIMARY_PATHS } from "../../constants/paths";
import { SyncService } from "../../services/SyncService";
import { ProjectEntry, ProjectGitCredential, ProjectGitState } from "../../types/project";
import { getVaultBasePath } from "../../utils/vaultPath";

export type ProjectRegistrationMode = "local_only" | "register_existing_dir" | "remote_bootstrap";

export interface ProjectEditorDraft {
	groupId: string;
	mode: ProjectRegistrationMode;
	projectId: string;
	projectName: string;
	boundaryPath: string;
	localPath: string;
	gitRemote: string;
	autoSync: boolean;
	gitUsername?: string;
	gitToken?: string;
	slug?: string;
	projectRootPath?: string;
}

export interface ProjectGitStateDetection {
	gitState: ProjectGitState;
	repositoryRoot: string;
	detectedParentRepository: boolean;
}

interface SubmitOptions {
	app: App;
	syncService: SyncService;
	draft: ProjectEditorDraft;
	initial?: ProjectEntry;
	existingProjectIds: Set<string>;
	fridayRoot: string;
	currentUserId: string;
}

interface NormalizedProjectDraft {
	groupId: string;
	mode: ProjectRegistrationMode;
	projectId: string;
	projectName: string;
	boundaryPath: string;
	localPath: string;
	gitRemote: string;
	autoSync: boolean;
	gitUsername: string;
	gitToken: string;
}

export function buildDefaultProjectRootPath(fridayRoot: string, slug: string): string {
	const safeSlug = slug.trim().toLowerCase() || "new-project";
	return normalizeVaultPath(`${fridayRoot}/${PRIMARY_PATHS.projects}/${safeSlug}`);
}

export function validateProjectDraft(
	draft: ProjectEditorDraft,
	existingProjectIds: Set<string>,
	initialProjectId = "",
): void {
	const normalizedDraft = normalizeProjectDraft(draft);
	if (!normalizedDraft.projectId || !/^[a-z0-9-]+$/.test(normalizedDraft.projectId)) {
		throw new Error("Project ID must use lowercase letters, numbers, or hyphens only.");
	}
	if (existingProjectIds.has(normalizedDraft.projectId) && initialProjectId !== normalizedDraft.projectId) {
		throw new Error(`Project already exists: ${normalizedDraft.projectId}`);
	}
	if (!normalizedDraft.projectName) {
		throw new Error("Project name is required.");
	}
	if (normalizedDraft.mode === "remote_bootstrap" && !normalizedDraft.gitRemote) {
		throw new Error("Git remote is required for remote bootstrap.");
	}
	if (Boolean(normalizedDraft.gitUsername) !== Boolean(normalizedDraft.gitToken)) {
		throw new Error("Git username and token must both be provided, or both left empty.");
	}
	const normalizedRoot = normalizeVaultPath(normalizedDraft.boundaryPath.trim());
	if (!normalizedRoot || normalizedRoot === "." || normalizedRoot.startsWith("/")) {
		throw new Error("Project root must be a Vault-relative path.");
	}
}

export async function submitProjectDraft(options: SubmitOptions): Promise<ProjectEntry> {
	const { app, syncService, draft, initial } = options;
	const normalizedDraft = normalizeProjectDraft(draft);
	validateProjectDraft(normalizedDraft, options.existingProjectIds, initial?.projectId ?? initial?.slug ?? "");

	const normalizedRoot = normalizeVaultPath(normalizedDraft.boundaryPath.trim());
	const resolvedPath = await resolveProjectPath(
		app,
		normalizedDraft.mode,
		normalizedRoot,
		normalizedDraft.localPath.trim(),
	);
	await prepareProjectDirectory(app, normalizedDraft, resolvedPath, normalizedRoot);
	await persistProjectGitCredential(syncService, normalizedDraft.projectId, normalizeProjectGitCredential(normalizedDraft));

	const detectedState =
		normalizedDraft.mode === "register_existing_dir" || normalizedDraft.mode === "remote_bootstrap"
			? await detectProjectGitState(resolvedPath)
			: null;
	const hasRemote = Boolean(normalizedDraft.gitRemote.trim());
	const entry: ProjectEntry = {
		projectId: normalizedDraft.projectId,
		projectName: normalizedDraft.projectName,
		boundaryPath: normalizedRoot,
		gitState: detectedState?.gitState ?? (hasRemote ? "git_remote_bound" : "none"),
		groupId: normalizedDraft.groupId.trim() || "default-group",
		slug: normalizedDraft.projectId,
		projectRootPath: normalizedRoot,
		localPath: normalizedDraft.localPath.trim(),
		gitRemote: normalizedDraft.gitRemote.trim(),
		autoSync: hasRemote ? normalizedDraft.autoSync : false,
		lastSyncAt: initial?.lastSyncAt ?? "",
	};

	await syncService.prepareRepository(entry);
	return entry;
}

export async function detectProjectGitState(targetPath: string): Promise<ProjectGitStateDetection> {
	const normalizedTarget = path.resolve(targetPath);
	const git = simpleGit({ baseDir: normalizedTarget, maxConcurrentProcesses: 1 });
	try {
		const repositoryRoot = path.resolve((await git.revparse(["--show-toplevel"])).trim());
		if (repositoryRoot !== normalizedTarget) {
			return {
				gitState: "none",
				repositoryRoot,
				detectedParentRepository: true,
			};
		}
		const remotes = await git.getRemotes(true);
		return {
			gitState: remotes.length > 0 ? "git_remote_bound" : "git_local",
			repositoryRoot,
			detectedParentRepository: false,
		};
	} catch {
		return {
			gitState: "none",
			repositoryRoot: "",
			detectedParentRepository: false,
		};
	}
}

async function resolveProjectPath(
	app: App,
	mode: ProjectRegistrationMode,
	projectRootPath: string,
	localPath: string,
): Promise<string> {
	const expectedPath = getVaultProjectAbsolutePath(app, projectRootPath);
	if (!localPath) {
		if (mode === "register_existing_dir") {
			const expectedStat = await fs.stat(expectedPath).catch(() => null);
			if (!expectedStat?.isDirectory()) {
				throw new Error(`Local path does not exist: ${expectedPath}`);
			}
			return expectedPath;
		}
		await fs.mkdir(expectedPath, { recursive: true });
		return expectedPath;
	}

	const target = path.normalize(localPath);
	const stat = await fs.stat(target).catch(() => null);
	if (!stat?.isDirectory()) {
		throw new Error(`Local path does not exist: ${target}`);
	}
	return target;
}

async function prepareProjectDirectory(
	app: App,
	draft: NormalizedProjectDraft,
	resolvedPath: string,
	projectRootPath: string,
): Promise<void> {
	if (draft.mode === "register_existing_dir") {
		return;
	}
	if (draft.mode === "remote_bootstrap") {
		const stat = await fs.stat(resolvedPath).catch(() => null);
		const entries = stat?.isDirectory() ? await fs.readdir(resolvedPath) : [];
		if (entries.length > 0) {
			throw new Error(`Remote bootstrap target must be empty: ${resolvedPath}`);
		}
		if (draft.gitRemote) {
			await simpleGit().clone(draft.gitRemote, resolvedPath);
		}
		return;
	}
	await ensureVaultLinkIfNeeded(app, resolvedPath, projectRootPath);
}

async function persistProjectGitCredential(
	syncService: SyncService,
	projectId: string,
	credential: ProjectGitCredential | null,
): Promise<void> {
	if (typeof syncService.setProjectGitCredential === "function") {
		await syncService.setProjectGitCredential(projectId, credential);
	}
}

function getVaultProjectAbsolutePath(app: App, projectRootPath: string): string {
	const vaultBasePath = getVaultBasePath(app);
	return path.join(vaultBasePath, ...projectRootPath.split("/"));
}

async function ensureVaultLinkIfNeeded(app: App, localProjectPath: string, projectRootPath: string): Promise<void> {
	const expectedPath = getVaultProjectAbsolutePath(app, projectRootPath);
	const localNormalized = path.normalize(localProjectPath);
	const expectedNormalized = path.normalize(expectedPath);

	if (localNormalized === expectedNormalized) {
		return;
	}

	await fs.mkdir(path.dirname(expectedNormalized), { recursive: true });
	const stat = await fs.lstat(expectedNormalized).catch(() => null);
	if (stat) {
		const linkedTarget = await fs.readlink(expectedNormalized).catch(() => "");
		if (linkedTarget && path.normalize(linkedTarget) === localNormalized) {
			return;
		}
		throw new Error(`Vault path already exists: ${expectedNormalized}`);
	}

	if (process.platform === "win32") {
		const targetForLink = localNormalized.endsWith("\\") ? localNormalized : `${localNormalized}\\`;
		await fs.symlink(targetForLink, expectedNormalized, "junction");
		return;
	}
	await fs.symlink(localNormalized, expectedNormalized, "dir");
}

function normalizeProjectDraft(draft: ProjectEditorDraft): NormalizedProjectDraft {
	const projectId = (draft.projectId || draft.slug || "").trim().toLowerCase();
	const projectName = (draft.projectName || draft.projectId || draft.slug || "").trim();
	const boundaryPath = normalizeVaultPath((draft.boundaryPath || draft.projectRootPath || "").trim());
	return {
		groupId: draft.groupId?.trim() || "default-group",
		mode: draft.mode ?? "local_only",
		projectId,
		projectName,
		boundaryPath,
		localPath: draft.localPath?.trim() || "",
		gitRemote: draft.gitRemote?.trim() || "",
		autoSync: Boolean(draft.autoSync),
		gitUsername: draft.gitUsername?.trim() || "",
		gitToken: draft.gitToken?.trim() || "",
	};
}

function normalizeProjectGitCredential(draft: NormalizedProjectDraft): ProjectGitCredential | null {
	if (!draft.gitUsername || !draft.gitToken) {
		return null;
	}
	return {
		username: draft.gitUsername,
		token: draft.gitToken,
	};
}

function normalizeVaultPath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/$/, "");
}
