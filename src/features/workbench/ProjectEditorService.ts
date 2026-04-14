import { promises as fs } from "fs";
import path from "path";
import { App } from "obsidian";
import { LEGACY_PATHS, PRIMARY_PATHS } from "../../constants/paths";
import { SyncService } from "../../services/SyncService";
import { ProjectEntry } from "../../types/project";
import { getVaultBasePath } from "../../utils/vaultPath";

export interface ProjectEditorDraft {
	groupId: string;
	slug: string;
	projectRootPath: string;
	localPath: string;
	gitRemote: string;
	gitUsername: string;
	gitUserEmail: string;
	gitToken: string;
	autoSync: boolean;
}

interface SubmitOptions {
	app: App;
	syncService: SyncService;
	draft: ProjectEditorDraft;
	initial?: ProjectEntry;
	existingSlugs: Set<string>;
	fridayRoot: string;
	currentUserId: string;
}

export function buildDefaultProjectRootPath(fridayRoot: string, slug: string): string {
	const safeSlug = slug.trim().toLowerCase() || "new-project";
	return normalizeVaultPath(`${fridayRoot}/${PRIMARY_PATHS.projects}/${safeSlug}`);
}

export function validateProjectDraft(
	draft: ProjectEditorDraft,
	existingSlugs: Set<string>,
	initialSlug = "",
): void {
	if (!draft.slug || !/^[a-z0-9-]+$/.test(draft.slug)) {
		throw new Error("Project slug must use lowercase letters, numbers, or hyphens only.");
	}
	if (existingSlugs.has(draft.slug) && initialSlug !== draft.slug) {
		throw new Error(`Project already exists: ${draft.slug}`);
	}
	const username = draft.gitUsername.trim();
	const token = draft.gitToken.trim();
	if ((username && !token) || (!username && token)) {
		throw new Error("Git username and token must both be filled or both be empty.");
	}
	const normalizedRoot = normalizeVaultPath(draft.projectRootPath.trim());
	if (!normalizedRoot || normalizedRoot === "." || normalizedRoot.startsWith("/")) {
		throw new Error("Project root must be a Vault-relative path.");
	}
}

export async function submitProjectDraft(options: SubmitOptions): Promise<ProjectEntry> {
	const { app, syncService, draft, initial, existingSlugs, currentUserId } = options;
	validateProjectDraft(draft, existingSlugs, initial?.slug ?? "");

	const normalizedRoot = normalizeVaultPath(draft.projectRootPath.trim());
	const resolvedPath = await resolveProjectPath(app, normalizedRoot, draft.localPath.trim());
	await ensureProjectScaffold(resolvedPath, draft.slug, currentUserId);
	await ensureVaultLinkIfNeeded(app, resolvedPath, normalizedRoot);

	const hasRemote = Boolean(draft.gitRemote.trim());
	const entry: ProjectEntry = {
		groupId: draft.groupId.trim() || "default-group",
		slug: draft.slug.trim(),
		projectRootPath: normalizedRoot,
		localPath: draft.localPath.trim(),
		gitRemote: draft.gitRemote.trim(),
		gitUsername: draft.gitUsername.trim(),
		gitUserEmail: draft.gitUserEmail.trim(),
		gitToken: draft.gitToken.trim(),
		autoSync: hasRemote ? draft.autoSync : false,
		lastSyncAt: initial?.lastSyncAt ?? "",
	};

	await syncService.prepareRepository(entry);
	return entry;
}

async function resolveProjectPath(app: App, projectRootPath: string, localPath: string): Promise<string> {
	const expectedPath = getVaultProjectAbsolutePath(app, projectRootPath);
	if (!localPath) {
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

async function ensureProjectScaffold(localProjectPath: string, slug: string, currentUserId: string): Promise<void> {
	await fs.mkdir(path.join(localProjectPath, "raw"), { recursive: true });
	await fs.mkdir(path.join(localProjectPath, "workspace"), { recursive: true });
	await fs.mkdir(path.join(localProjectPath, "wiki"), { recursive: true });
	await fs.mkdir(path.join(localProjectPath, ".friday"), { recursive: true });

	const now = new Date().toISOString();
	const metaPath = await resolveProjectMetaPath(localProjectPath);
	const existingMeta = await fs.stat(metaPath).catch(() => null);
	if (!existingMeta) {
		const metaContent = [
			"---",
			'color: "#6366F1"',
			`createdAt: ${now}`,
			'description: ""',
			'endDate: ""',
			"members:",
			"  - role: admin",
			`    userId: "${slug}"`,
			`name: "${slug}"`,
			`owner: "${currentUserId || slug}"`,
			"priority: medium",
			`projectId: "${slug}"`,
			'startDate: ""',
			"status: active",
			"tags: []",
			"type: project",
			`updatedAt: ${now}`,
			"---",
			"",
			"## 项目背景",
			"",
			"",
		].join("\n");
		await fs.writeFile(metaPath, metaContent, "utf8");
	}

	const membersPath = await resolveProjectMembersPath(localProjectPath);
	const existingMembers = await fs.stat(membersPath).catch(() => null);
	if (!existingMembers) {
		const memberId = currentUserId || slug;
		const membersContent = [
			"---",
			"type: project_members",
			`projectId: "${slug}"`,
			"members:",
			`  - userId: "${memberId}"`,
			"    role: admin",
			"---",
			"",
			"## 项目成员",
			"",
			`- ${memberId} (admin)`,
		].join("\n");
		await fs.writeFile(membersPath, membersContent, "utf8");
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

async function resolveProjectMetaPath(localProjectPath: string): Promise<string> {
	const candidates = [PRIMARY_PATHS.projectMetaFile, LEGACY_PATHS.projectMetaFile];
	for (const filename of candidates) {
		const candidatePath = path.join(localProjectPath, filename);
		const stat = await fs.stat(candidatePath).catch(() => null);
		if (stat?.isFile()) {
			return candidatePath;
		}
	}
	return path.join(localProjectPath, PRIMARY_PATHS.projectMetaFile);
}

async function resolveProjectMembersPath(localProjectPath: string): Promise<string> {
	const candidates = [PRIMARY_PATHS.projectMembersFile, LEGACY_PATHS.projectMembersFile];
	for (const filename of candidates) {
		const candidatePath = path.join(localProjectPath, filename);
		const stat = await fs.stat(candidatePath).catch(() => null);
		if (stat?.isFile()) {
			return candidatePath;
		}
	}
	return path.join(localProjectPath, PRIMARY_PATHS.projectMembersFile);
}

function normalizeVaultPath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/$/, "");
}
