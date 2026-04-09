import path from "path";
import { normalizePath } from "obsidian";
import { PRIMARY_PATHS } from "../constants/paths";
import { ProjectEntry } from "../types/project";
import { FridaySettings } from "../types/settings";

export class ProjectBoundaryService {
	constructor(private readonly getSettings: () => FridaySettings) {}

	getActiveProject(): ProjectEntry | null {
		const settings = this.getSettings();
		const projects = settings.projects ?? [];
		if (projects.length === 0) {
			return null;
		}
		if (!settings.activeProjectId) {
			return projects[0] ?? null;
		}
		return projects.find((item) => item.slug === settings.activeProjectId) ?? projects[0] ?? null;
	}

	getProjectBySlug(projectSlug: string): ProjectEntry | null {
		if (!projectSlug) {
			return null;
		}
		return this.getSettings().projects.find((item) => item.slug === projectSlug) ?? null;
	}

	getProjectRoot(project: ProjectEntry): string {
		const projectRootPath = project.projectRootPath?.trim();
		if (projectRootPath && !path.isAbsolute(projectRootPath)) {
			return normalizePath(projectRootPath);
		}
		return normalizePath(`${PRIMARY_PATHS.root}/${PRIMARY_PATHS.projects}/${project.slug}`);
	}

	getActiveProjectRoot(): string {
		const activeProject = this.getActiveProject();
		if (!activeProject) {
			return "";
		}
		return this.getProjectRoot(activeProject);
	}

	isWithinProject(project: ProjectEntry, vaultRelativePath: string): boolean {
		const normalizedPath = normalizePath(vaultRelativePath);
		const root = this.getProjectRoot(project);
		return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
	}

	assertWithinProject(project: ProjectEntry, vaultRelativePath: string): void {
		if (!this.isWithinProject(project, vaultRelativePath)) {
			const normalizedPath = normalizePath(vaultRelativePath);
			const root = this.getProjectRoot(project);
			throw new Error(
				`Path out of active project boundary: ${normalizedPath} (activeProject=${project.slug}, projectRoot=${root})`,
			);
		}
	}

	normalizeProjectPath(project: ProjectEntry, inputPath: string): string {
		const normalizedInput = normalizePath(inputPath || "");
		if (!normalizedInput) {
			return this.getProjectRoot(project);
		}
		if (normalizedInput.startsWith("/")) {
			return normalizedInput;
		}
		const root = this.getProjectRoot(project);
		if (normalizedInput === root || normalizedInput.startsWith(`${root}/`)) {
			return normalizedInput;
		}
		return normalizePath(`${root}/${normalizedInput}`);
	}
}

