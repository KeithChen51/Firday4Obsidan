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
	gitRemote: string;
	autoSync: boolean;
	gitUsername: string;
	gitToken: string;
}

export function buildDefaultProjectRootPath(fridayRoot: string, name: string): string {
	const safeName = normalizeProjectRootSegment(name);
	return normalizeVaultPath(`${fridayRoot}/${PRIMARY_PATHS.projects}/${safeName || "new-project"}`);
}

export function buildRemoteBootstrapDefaults(fridayRoot: string, gitRemote: string): {
	projectId: string;
	projectName: string;
	boundaryPath: string;
} {
	const repoName = extractRepositoryName(gitRemote);
	const projectId = repoName.trim().toLowerCase();
	return {
		projectId,
		projectName: repoName,
		boundaryPath: buildDefaultProjectRootPath(fridayRoot, projectId),
	};
}

export function validateProjectDraft(
	draft: ProjectEditorDraft | NormalizedProjectDraft,
	existingProjectIds: Set<string>,
	initialProjectId = "",
): void {
	const normalizedDraft =
		"localPath" in draft || "projectRootPath" in draft || "slug" in draft
			? normalizeProjectDraft(draft as ProjectEditorDraft)
			: draft;
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
	if (normalizedDraft.mode === "local_only" && normalizedDraft.gitRemote) {
		throw new Error("local_only mode cannot bind a remote repository.");
	}
	if (Boolean(normalizedDraft.gitUsername) !== Boolean(normalizedDraft.gitToken)) {
		throw new Error("Git username and token must both be provided, or both left empty.");
	}
	const rawRoot = String(draft.boundaryPath || ("projectRootPath" in draft ? draft.projectRootPath : "") || "").trim();
	if (normalizedDraft.mode === "local_only" && !rawRoot) {
		return;
	}
	if (!isVaultRelativePath(rawRoot)) {
		throw new Error("Project root must be a Vault-relative path.");
	}
	const normalizedRoot = normalizeVaultPath(rawRoot);
	if (!normalizedRoot || normalizedRoot === "." || normalizedRoot.startsWith("/")) {
		throw new Error("Project root must be a Vault-relative path.");
	}
}

export async function submitProjectDraft(options: SubmitOptions): Promise<ProjectEntry> {
	const { app, syncService, draft, initial } = options;
	let normalizedDraft = normalizeProjectDraft(applyRemoteBootstrapDraftDefaults(draft, options.fridayRoot));
	if (!normalizedDraft.projectId) {
		normalizedDraft = {
			...normalizedDraft,
			projectId: generateProjectId(normalizedDraft.projectName, options.existingProjectIds),
		};
	}
	validateProjectDraft(normalizedDraft, options.existingProjectIds, initial?.projectId ?? initial?.slug ?? "");

	const normalizedRoot = normalizeVaultPath(normalizedDraft.boundaryPath.trim());
	const resolvedPath = await resolveProjectPath(app, normalizedDraft.mode, normalizedRoot);
	await prepareProjectDirectory(normalizedDraft, resolvedPath);
	await persistProjectGitCredential(syncService, normalizedDraft.projectId, normalizeProjectGitCredential(normalizedDraft));

	const detectedState =
		normalizedDraft.mode === "register_existing_dir" || normalizedDraft.mode === "remote_bootstrap"
			? await detectProjectGitState(resolvedPath)
			: null;
	if (
		normalizedDraft.mode === "register_existing_dir" &&
		normalizedDraft.gitRemote.trim() &&
		detectedState?.gitState === "none"
	) {
		throw new Error("register_existing_dir cannot bind a remote unless the selected directory is already a Git repository root.");
	}
	const hasRemote = Boolean(normalizedDraft.gitRemote.trim());
	const entry: ProjectEntry = {
		projectId: normalizedDraft.projectId,
		projectName: normalizedDraft.projectName,
		boundaryPath: normalizedRoot,
		gitState: detectedState?.gitState ?? (hasRemote ? "git_remote_bound" : "none"),
		groupId: normalizedDraft.groupId.trim() || "default-group",
		slug: normalizedDraft.projectId,
		gitRemote: normalizedDraft.gitRemote.trim(),
		autoSync: hasRemote ? normalizedDraft.autoSync : false,
		lastSyncAt: initial?.lastSyncAt ?? "",
	};
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
): Promise<string> {
	const expectedPath = getVaultProjectAbsolutePath(app, projectRootPath);
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

async function prepareProjectDirectory(
	draft: NormalizedProjectDraft,
	resolvedPath: string,
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
		gitRemote: draft.gitRemote?.trim() || "",
		autoSync: Boolean(draft.autoSync),
		gitUsername: draft.gitUsername?.trim() || "",
		gitToken: draft.gitToken?.trim() || "",
	};
}

function applyRemoteBootstrapDraftDefaults(draft: ProjectEditorDraft, fridayRoot: string): ProjectEditorDraft {
	if (draft.mode !== "remote_bootstrap" || !draft.gitRemote?.trim()) {
		return draft;
	}
	const defaults = buildRemoteBootstrapDefaults(fridayRoot, draft.gitRemote);
	return {
		...draft,
		projectId: draft.projectId?.trim() || defaults.projectId,
		projectName: draft.projectName?.trim() || defaults.projectName,
		boundaryPath: draft.boundaryPath?.trim() || defaults.boundaryPath,
		projectRootPath: draft.projectRootPath?.trim() || defaults.boundaryPath,
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

function isVaultRelativePath(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) {
		return false;
	}
	return !path.isAbsolute(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed);
}

function extractRepositoryName(gitRemote: string): string {
	const trimmed = gitRemote.trim().replace(/\.git$/i, "");
	if (!trimmed) {
		return "new-project";
	}
	const segments = trimmed
		.split(/[/:]/)
		.map((item) => item.trim())
		.filter(Boolean);
	return segments[segments.length - 1] ?? "new-project";
}

function normalizeProjectRootSegment(value: string): string {
	return value
		.trim()
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^\.+/, "")
		.replace(/\.+$/, "");
}

function generateProjectId(projectName: string, existingProjectIds: Set<string>): string {
	const base = "project";
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const candidate = `${base}-${suffix}`;
		if (!existingProjectIds.has(candidate)) {
			return candidate;
		}
	}
	return `${base}-${Date.now().toString(36)}-${existingProjectIds.size + 1}`;
}
