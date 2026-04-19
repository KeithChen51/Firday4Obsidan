import { promises as fs } from "fs";
import path from "path";
import { App } from "obsidian";
import simpleGit from "simple-git";
import { getRootCandidates, PRIMARY_PATHS } from "../../constants/paths";
import { SyncService } from "../../services/SyncService";
import { ProjectEntry, ProjectGitCredential, ProjectGitState } from "../../types/project";
import { getVaultBasePath } from "../../utils/vaultPath";

export type ProjectRegistrationMode = "local_only" | "remote_bootstrap";

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
	gitRemote: string;
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
	const projectId = normalizeProjectIdCandidate(repoName) || "new-project";
	return {
		projectId,
		projectName: repoName,
		boundaryPath: buildDefaultProjectRootPath(fridayRoot, projectId),
	};
}

export function isFridayManagedProjectRoot(projectRootPath: string, fridayRoot: string): boolean {
	const normalizedProjectRoot = normalizeVaultPath(projectRootPath);
	if (!normalizedProjectRoot || !fridayRoot.trim()) {
		return false;
	}
	return getRootCandidates(fridayRoot).some((rootCandidate) => {
		const normalizedRootCandidate = normalizeVaultPath(rootCandidate);
		return Boolean(
			normalizedRootCandidate &&
			(normalizedProjectRoot === normalizedRootCandidate || normalizedProjectRoot.startsWith(`${normalizedRootCandidate}/`)),
		);
	});
}

export function validateProjectDraft(
	draft: ProjectEditorDraft | NormalizedProjectDraft,
	existingProjectIds: Set<string>,
	initialProjectId = "",
	fridayRoot = "",
	initialBoundaryPath = "",
): void {
	const normalizedDraft =
		"localPath" in draft || "projectRootPath" in draft || "slug" in draft
			? normalizeProjectDraft(draft as ProjectEditorDraft)
			: draft;
	if (!normalizedDraft.projectId || !PROJECT_ID_PATTERN.test(normalizedDraft.projectId)) {
		throw new Error("项目 ID 只能使用小写字母、数字或连字符。");
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

	const rawRoot = String(draft.boundaryPath || ("projectRootPath" in draft ? draft.projectRootPath : "") || "").trim();
	if (!rawRoot) {
		throw new Error("Project root is required.");
	}
	if (!isVaultRelativePath(rawRoot)) {
		throw new Error("Project root must be a Vault-relative path.");
	}
	const normalizedRoot = normalizeVaultPath(rawRoot);
	if (!normalizedRoot || normalizedRoot === "." || normalizedRoot.startsWith("/")) {
		throw new Error("Project root must be a Vault-relative path.");
	}
	const normalizedInitialBoundaryPath = normalizeVaultPath(initialBoundaryPath);
	if (
		isFridayManagedProjectRoot(normalizedRoot, fridayRoot) &&
		normalizedInitialBoundaryPath !== normalizedRoot
	) {
		throw new Error("Project root cannot point to the Friday workspace. Choose a folder outside F.R.I.D.A.Y.");
	}
}

export async function submitProjectDraft(options: SubmitOptions): Promise<ProjectEntry> {
	const { app, syncService, draft, initial } = options;
	let normalizedDraft = normalizeProjectDraft(applyRemoteBootstrapDraftDefaults(draft, options.fridayRoot));
	if (!initial && (!normalizedDraft.projectId || !PROJECT_ID_PATTERN.test(normalizedDraft.projectId))) {
		const preferredProjectIdSource =
			normalizedDraft.projectName
			|| (normalizedDraft.mode === "remote_bootstrap" ? extractRepositoryName(normalizedDraft.gitRemote) : "")
			|| normalizedDraft.projectId;
		normalizedDraft = {
			...normalizedDraft,
			projectId: generateProjectId(preferredProjectIdSource, options.existingProjectIds),
		};
	}
	validateProjectDraft(
		normalizedDraft,
		options.existingProjectIds,
		initial?.projectId ?? initial?.slug ?? "",
		options.fridayRoot,
		initial?.boundaryPath ?? "",
	);

	const normalizedRoot = normalizeVaultPath(normalizedDraft.boundaryPath.trim());
	const resolvedPath = await resolveProjectPath(app, normalizedDraft.mode, normalizedRoot);
	let detectedBefore =
		normalizedDraft.mode === "local_only" ? await detectProjectGitState(resolvedPath) : null;
	const effectiveGitRemote = resolveEffectiveGitRemote(normalizedDraft, detectedBefore);

	if (normalizedDraft.mode === "local_only" && effectiveGitRemote && detectedBefore?.detectedParentRepository) {
		throw new Error(
			"The selected directory is inside a parent Git repository. Choose the repository root before binding a remote.",
		);
	}

	await prepareProjectDirectory(normalizedDraft, resolvedPath);
	await persistProjectGitCredential(syncService, normalizedDraft.projectId, normalizeProjectGitCredential(normalizedDraft));

	if (normalizedDraft.mode === "local_only" && effectiveGitRemote) {
		await syncService.prepareRepository({
			projectId: normalizedDraft.projectId,
			projectName: normalizedDraft.projectName,
			boundaryPath: normalizedRoot,
			gitState: detectedBefore?.gitState ?? "none",
			slug: normalizedDraft.projectId,
			groupId: normalizedDraft.groupId,
			gitRemote: effectiveGitRemote,
			autoSync: false,
			lastSyncAt: initial?.lastSyncAt ?? "",
		});
	}

	const detectedAfter =
		normalizedDraft.mode === "local_only" || normalizedDraft.mode === "remote_bootstrap"
			? await detectProjectGitState(resolvedPath)
			: null;
	const finalGitRemote = detectedAfter?.gitRemote || effectiveGitRemote;
	const finalGitState = detectedAfter?.gitState ?? (finalGitRemote ? "git_remote_bound" : "none");
	const autoSyncAllowed = finalGitState === "git_remote_bound" && Boolean(finalGitRemote);

	return {
		projectId: normalizedDraft.projectId,
		projectName: normalizedDraft.projectName,
		boundaryPath: normalizedRoot,
		gitState: finalGitState,
		groupId: normalizedDraft.groupId.trim() || "default-group",
		slug: normalizedDraft.projectId,
		gitRemote: finalGitRemote,
		autoSync: autoSyncAllowed ? normalizedDraft.autoSync : false,
		lastSyncAt: initial?.lastSyncAt ?? "",
	};
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
				gitRemote: "",
			};
		}
		const remotes = await git.getRemotes(true);
		const gitRemote = pickGitRemote(remotes);
		return {
			gitState: gitRemote ? "git_remote_bound" : "git_local",
			repositoryRoot,
			detectedParentRepository: false,
			gitRemote,
		};
	} catch {
		return {
			gitState: "none",
			repositoryRoot: "",
			detectedParentRepository: false,
			gitRemote: "",
		};
	}
}

async function resolveProjectPath(
	app: App,
	mode: ProjectRegistrationMode,
	projectRootPath: string,
): Promise<string> {
	const expectedPath = getVaultProjectAbsolutePath(app, projectRootPath);
	if (mode === "remote_bootstrap") {
		await fs.mkdir(expectedPath, { recursive: true });
		return expectedPath;
	}

	await fs.mkdir(expectedPath, { recursive: true });
	return expectedPath;
}

async function prepareProjectDirectory(
	draft: NormalizedProjectDraft,
	resolvedPath: string,
): Promise<void> {
	if (draft.mode === "remote_bootstrap") {
		const stat = await fs.stat(resolvedPath).catch(() => null);
		const entries = stat?.isDirectory() ? await fs.readdir(resolvedPath) : [];
		if (entries.length > 0) {
			throw new Error(`Remote bootstrap target must be empty: ${resolvedPath}`);
		}
		if (draft.gitRemote) {
			await simpleGit().clone(draft.gitRemote, resolvedPath);
		}
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
	const sanitizedProjectId = normalizeProjectIdCandidate(draft.projectId ?? "");
	const safeDefaultBoundaryPath = isFridayManagedProjectRoot(defaults.boundaryPath, fridayRoot)
		? ""
		: defaults.boundaryPath;
	return {
		...draft,
		projectId: sanitizedProjectId || defaults.projectId,
		projectName: draft.projectName?.trim() || defaults.projectName,
		boundaryPath: draft.boundaryPath?.trim() || safeDefaultBoundaryPath,
		projectRootPath: draft.projectRootPath?.trim() || safeDefaultBoundaryPath,
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

function resolveEffectiveGitRemote(
	draft: NormalizedProjectDraft,
	detectedState: ProjectGitStateDetection | null,
): string {
	return draft.gitRemote.trim() || detectedState?.gitRemote || "";
}

function pickGitRemote(remotes: Array<{ name: string; refs?: { fetch?: string; push?: string } }>): string {
	if (!remotes.length) {
		return "";
	}
	const origin = remotes.find((remote) => remote.name === "origin");
	const target = origin ?? remotes[0];
	return target?.refs?.fetch?.trim() || target?.refs?.push?.trim() || "";
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

const PROJECT_ID_PATTERN = /^[a-z0-9-]+$/;

function normalizeProjectIdCandidate(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

function generateProjectId(projectName: string, existingProjectIds: Set<string>): string {
	const preferred = normalizeProjectIdCandidate(projectName);
	if (preferred && !existingProjectIds.has(preferred)) {
		return preferred;
	}
	if (preferred) {
		for (let attempt = 2; attempt < 100; attempt += 1) {
			const candidate = `${preferred}-${attempt}`;
			if (!existingProjectIds.has(candidate)) {
				return candidate;
			}
		}
	}
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
