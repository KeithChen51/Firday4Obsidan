import path from "path";
import { normalizePath } from "obsidian";
import { PRIMARY_PATHS } from "../constants/paths";
import { ProjectEntry } from "../types/project";
import { FridaySettings } from "../types/settings";

function normalizeVaultPath(value: string): string {
	const normalizer = typeof normalizePath === "function" ? normalizePath : (input: string) => input.replace(/\\/g, "/");
	return normalizer(value).replace(/\/+/g, "/").replace(/\/$/, "");
}

export class ProjectBoundaryService {
	constructor(
		private readonly getSettings: () => FridaySettings,
		private readonly getVaultBasePath: () => string = () => ".",
	) {}

	getActiveProject(): ProjectEntry | null {
		const settings = this.getSettings();
		const projects = settings.projects ?? [];
		if (projects.length === 0) {
			return null;
		}
		if (!settings.activeProjectId) {
			return projects[0] ?? null;
		}
		return projects.find((item) => this.getProjectKey(item) === settings.activeProjectId) ?? projects[0] ?? null;
	}

	getProjectBySlug(projectSlug: string): ProjectEntry | null {
		if (!projectSlug) {
			return null;
		}
		return this.getSettings().projects.find((item) => this.getProjectKey(item) === projectSlug) ?? null;
	}

	getProjectVaultPath(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		const projectRootPath = project.boundaryPath?.trim() || project.projectRootPath?.trim();
		if (projectRootPath && !path.isAbsolute(projectRootPath)) {
			return normalizeVaultPath(projectRootPath);
		}
		return normalizeVaultPath(`${PRIMARY_PATHS.root}/${PRIMARY_PATHS.projects}/${this.getProjectKey(project)}`);
	}

	getProjectAbsolutePath(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		const localPath = project.localPath?.trim();
		if (localPath && path.isAbsolute(localPath)) {
			return path.normalize(localPath);
		}
		return path.join(this.getVaultBasePath(), ...this.getProjectVaultPath(project).split("/"));
	}

	getProjectRoot(project: ProjectEntry): string {
		return this.getProjectVaultPath(project);
	}

	getActiveProjectRoot(): string {
		const activeProject = this.getActiveProject();
		if (!activeProject) {
			return "";
		}
		return this.getProjectRoot(activeProject);
	}

	isWithinProject(project: ProjectEntry, vaultRelativePath: string): boolean {
		const normalizedPath = normalizeVaultPath(vaultRelativePath);
		const root = this.getProjectRoot(project);
		return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
	}

	assertWithinProject(project: ProjectEntry, vaultRelativePath: string): void {
		if (!this.isWithinProject(project, vaultRelativePath)) {
			const normalizedPath = normalizeVaultPath(vaultRelativePath);
			const root = this.getProjectRoot(project);
			throw new Error(
				`Path out of active project boundary: ${normalizedPath} (activeProject=${project.slug}, projectRoot=${root})`,
			);
		}
	}

	normalizeProjectPath(project: ProjectEntry, inputPath: string): string {
		const normalizedInput = normalizeVaultPath(inputPath || "");
		if (!normalizedInput) {
			return this.getProjectVaultPath(project);
		}
		if (normalizedInput.startsWith("/")) {
			return normalizedInput;
		}
		const root = this.getProjectVaultPath(project);
		if (normalizedInput === root || normalizedInput.startsWith(`${root}/`)) {
			return normalizedInput;
		}
		return normalizeVaultPath(`${root}/${normalizedInput}`);
	}

	private getProjectKey(project: ProjectEntry): string {
		return project.projectId || project.slug;
	}
}
