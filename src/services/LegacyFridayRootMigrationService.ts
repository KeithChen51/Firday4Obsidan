import { readdir, rename, rm, stat } from "fs/promises";
import path from "path";
import simpleGit from "simple-git";
import { PRIMARY_PATHS } from "../constants/paths";
import type { OfficialContentLegacyGuardState } from "../types/officialContent";
import { ProjectEntry, ProjectGitState } from "../types/project";
import { FridaySettings } from "../types/settings";

export interface LegacyFridayRootProjectRecord {
	projectId: string;
	boundaryPath: string;
}

export interface LegacyFridayImportCandidate {
	folderPath: string;
	suggestedProjectId: string;
	source: "projects" | "personal";
}

export interface LegacyFridayRootReport {
	registeredLegacyProjects: LegacyFridayRootProjectRecord[];
	importableLegacyProjects: LegacyFridayImportCandidate[];
	legacyPersonalFolders: string[];
	hasLegacyAgentData: boolean;
	hasObsoleteVisibleConfigMirror: boolean;
	cleanupCandidates: string[];
}

export interface LegacyFridayCleanupResult {
	removedPaths: string[];
}

export interface LegacyFridayArchiveResult {
	archivedPath: string;
}

export interface FridayRootOwnershipInspectionInput {
	ownedTopLevelPaths: string[];
}

const KNOWN_ROOT_LEGACY_BLOCKERS = new Set([
	"runtime",
	"Agents",
	PRIMARY_PATHS.projects,
	PRIMARY_PATHS.personal,
	PRIMARY_PATHS.configFile,
]);

export class LegacyFridayRootMigrationService {
	constructor(
		private readonly vaultBasePath: string,
		private readonly fridayRoot: string,
		private readonly getSettings: () => Pick<FridaySettings, "projects">,
	) {}

	async scan(): Promise<LegacyFridayRootReport> {
		const projectsRoot = normalizeVaultPath(`${this.fridayRoot}/${PRIMARY_PATHS.projects}`);
		const personalRoot = normalizeVaultPath(`${this.fridayRoot}/${PRIMARY_PATHS.personal}`);
		const registeredLegacyProjects = (this.getSettings().projects ?? [])
			.filter((project) => this.isFridayManagedPath(project.boundaryPath))
			.map((project) => ({
				projectId: project.projectId,
				boundaryPath: normalizeVaultPath(project.boundaryPath),
			}));
		const registeredRoots = new Set(registeredLegacyProjects.map((item) => item.boundaryPath));
		const importableLegacyProjects: LegacyFridayImportCandidate[] = [];
		const legacyPersonalFolders: string[] = [];
		const hasLegacyAgentData = await this.isDirectoryNonEmpty(normalizeVaultPath(`${this.fridayRoot}/Agents`));

		for (const folderPath of await this.listChildFolders(projectsRoot)) {
			if (registeredRoots.has(folderPath)) {
				continue;
			}
			if (await this.looksLikeProject(folderPath)) {
				importableLegacyProjects.push({
					folderPath,
					suggestedProjectId: this.suggestProjectId(folderPath),
					source: "projects",
				});
			}
		}

		for (const folderPath of await this.listChildFolders(personalRoot)) {
			if (registeredRoots.has(folderPath)) {
				continue;
			}
			if (await this.looksLikeProject(folderPath)) {
				importableLegacyProjects.push({
					folderPath,
					suggestedProjectId: this.suggestProjectId(folderPath),
					source: "personal",
				});
				continue;
			}
			if (await this.isDirectoryNonEmpty(folderPath)) {
				legacyPersonalFolders.push(folderPath);
			}
		}

		const cleanupCandidates: string[] = [];
		if (await this.exists(normalizeVaultPath(`${this.fridayRoot}/${PRIMARY_PATHS.configFile}`))) {
			cleanupCandidates.push(normalizeVaultPath(`${this.fridayRoot}/${PRIMARY_PATHS.configFile}`));
		}
		if (await this.isDirectoryEmpty(normalizeVaultPath(`${this.fridayRoot}/runtime`))) {
			cleanupCandidates.push(normalizeVaultPath(`${this.fridayRoot}/runtime`));
		}
		if (await this.isDirectoryEmpty(projectsRoot)) {
			cleanupCandidates.push(projectsRoot);
		}
		if (await this.isDirectoryEmpty(personalRoot)) {
			cleanupCandidates.push(personalRoot);
		}

		return {
			registeredLegacyProjects,
			importableLegacyProjects,
			legacyPersonalFolders,
			hasLegacyAgentData,
			hasObsoleteVisibleConfigMirror: cleanupCandidates.includes(normalizeVaultPath(`${this.fridayRoot}/${PRIMARY_PATHS.configFile}`)),
			cleanupCandidates,
		};
	}

	async importLegacyProject(folderPath: string): Promise<ProjectEntry> {
		const normalizedFolderPath = normalizeVaultPath(folderPath);
		const absolutePath = this.resolveAbsolutePath(normalizedFolderPath);
		const folderStat = await stat(absolutePath);
		if (!folderStat.isDirectory()) {
			throw new Error(`Legacy project folder not found: ${normalizedFolderPath}`);
		}

		const projectId = this.suggestProjectId(normalizedFolderPath);
		const gitState = await this.detectGitState(absolutePath);

		return {
			projectId,
			projectName: path.basename(normalizedFolderPath),
			boundaryPath: normalizedFolderPath,
			gitState: gitState.gitState,
			slug: projectId,
			groupId: "default-group",
			gitRemote: gitState.gitRemote,
			autoSync: gitState.gitState === "git_remote_bound" && Boolean(gitState.gitRemote),
			lastSyncAt: "",
		};
	}

	async cleanupVisibleLegacyArtifacts(): Promise<LegacyFridayCleanupResult> {
		const report = await this.scan();
		const removedPaths: string[] = [];
		for (const relativePath of report.cleanupCandidates.sort((left, right) => right.length - left.length)) {
			const absolutePath = this.resolveAbsolutePath(relativePath);
			await rm(absolutePath, { recursive: true, force: true });
			removedPaths.push(relativePath);
		}
		return { removedPaths };
	}

	async archiveVisibleLegacyRoot(): Promise<LegacyFridayArchiveResult> {
		const sourcePath = this.resolveAbsolutePath(this.fridayRoot);
		const sourceStat = await stat(sourcePath);
		if (!sourceStat.isDirectory()) {
			throw new Error(`Legacy Friday root not found: ${this.fridayRoot}`);
		}

		const archivedPath = await this.resolveUniqueArchivePath("旧版本F.R.I.D.A.Y文件夹");
		await rename(sourcePath, this.resolveAbsolutePath(archivedPath));
		return { archivedPath };
	}

	async inspectDestructiveApplySafety(
		input: FridayRootOwnershipInspectionInput,
	): Promise<OfficialContentLegacyGuardState> {
		const ownedTopLevelPaths = new Set(
			(input.ownedTopLevelPaths ?? [])
				.map((item) => normalizeVaultPath(item).split("/")[0] ?? "")
				.filter(Boolean),
		);
		const blockingPaths = (await this.listTopLevelEntries()).filter((entryName) =>
			!ownedTopLevelPaths.has(entryName),
		);
		return {
			blocked: blockingPaths.length > 0,
			blockingPaths,
			canRefreshCatalog: true,
		};
	}

	hasVisibleCleanupCandidates(report: LegacyFridayRootReport | null | undefined): boolean {
		return Boolean(report?.cleanupCandidates.length);
	}

	hasBlockingLegacyProjectContent(report: LegacyFridayRootReport | null | undefined): boolean {
		return Boolean(
			report && (
				report.registeredLegacyProjects.length > 0
				|| report.importableLegacyProjects.length > 0
				|| report.legacyPersonalFolders.length > 0
			),
		);
	}

	canCleanupSystemArtifacts(report: LegacyFridayRootReport | null | undefined): boolean {
		return Boolean(
			report
			&& !this.hasBlockingLegacyProjectContent(report)
			&& (report.hasLegacyAgentData || report.cleanupCandidates.length > 0),
		);
	}

	private isFridayManagedPath(boundaryPath: string | undefined): boolean {
		const normalized = normalizeVaultPath(boundaryPath?.trim() ?? "");
		return Boolean(normalized) && (normalized === this.fridayRoot || normalized.startsWith(`${this.fridayRoot}/`));
	}

	private async listChildFolders(relativeRoot: string): Promise<string[]> {
		const absoluteRoot = this.resolveAbsolutePath(relativeRoot);
		try {
			const entries = await readdir(absoluteRoot, { withFileTypes: true });
			return entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => normalizeVaultPath(`${relativeRoot}/${entry.name}`));
		} catch {
			return [];
		}
	}

	private async listTopLevelEntries(): Promise<string[]> {
		const absoluteRoot = this.resolveAbsolutePath(this.fridayRoot);
		try {
			const entries = await readdir(absoluteRoot, { withFileTypes: true });
			return entries
				.map((entry) => entry.name)
				.filter((entry) => KNOWN_ROOT_LEGACY_BLOCKERS.has(entry) || Boolean(entry.trim()))
				.sort((left, right) => left.localeCompare(right, "zh-CN"));
		} catch {
			return [];
		}
	}

	private async looksLikeProject(relativePath: string): Promise<boolean> {
		for (const candidate of [".git", "_项目.md", "_meta.md", "raw", "wiki", ".friday"]) {
			if (await this.exists(normalizeVaultPath(`${relativePath}/${candidate}`))) {
				return true;
			}
		}
		return false;
	}

	private async isDirectoryNonEmpty(relativePath: string): Promise<boolean> {
		const absolutePath = this.resolveAbsolutePath(relativePath);
		try {
			const entries = await readdir(absolutePath);
			return entries.length > 0;
		} catch {
			return false;
		}
	}

	private async isDirectoryEmpty(relativePath: string): Promise<boolean> {
		const absolutePath = this.resolveAbsolutePath(relativePath);
		try {
			const folderStat = await stat(absolutePath);
			if (!folderStat.isDirectory()) {
				return false;
			}
			const entries = await readdir(absolutePath);
			return entries.length === 0;
		} catch {
			return false;
		}
	}

	private async exists(relativePath: string): Promise<boolean> {
		try {
			await stat(this.resolveAbsolutePath(relativePath));
			return true;
		} catch {
			return false;
		}
	}

	private async resolveUniqueArchivePath(baseName: string): Promise<string> {
		let index = 0;
		while (true) {
			const candidate = index === 0 ? baseName : `${baseName} ${index}`;
			if (!(await this.exists(candidate))) {
				return candidate;
			}
			index += 1;
		}
	}

	private resolveAbsolutePath(relativePath: string): string {
		return path.join(this.vaultBasePath, ...normalizeVaultPath(relativePath).split("/"));
	}

	private suggestProjectId(relativePath: string): string {
		const baseName = path.basename(relativePath);
		const normalized = baseName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+/, "")
			.replace(/-+$/, "");
		return normalized || `project-${Date.now().toString(36)}`;
	}

	private async detectGitState(absolutePath: string): Promise<{ gitState: ProjectGitState; gitRemote: string }> {
		const git = simpleGit({ baseDir: absolutePath, maxConcurrentProcesses: 1 });
		try {
			const repositoryRoot = path.resolve((await git.revparse(["--show-toplevel"])).trim());
			if (repositoryRoot !== path.resolve(absolutePath)) {
				return { gitState: "none", gitRemote: "" };
			}
			const remotes = await git.getRemotes(true);
			const gitRemote = remotes.find((remote) => remote.name === "origin")?.refs?.fetch?.trim()
				|| remotes[0]?.refs?.fetch?.trim()
				|| "";
			return {
				gitState: gitRemote ? "git_remote_bound" : "git_local",
				gitRemote,
			};
		} catch {
			return { gitState: "none", gitRemote: "" };
		}
	}
}

function normalizeVaultPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
