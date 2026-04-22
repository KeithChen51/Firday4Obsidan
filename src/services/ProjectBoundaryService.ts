import path from "path";
import { normalizePath } from "obsidian";
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
		return (this.getSettings().projects ?? []).find((item) => this.getProjectKey(item) === projectSlug) ?? null;
	}

	getProjectForVaultPath(vaultRelativePath: string): ProjectEntry | null {
		const normalizedPath = normalizeVaultPath(vaultRelativePath);
		if (!normalizedPath) {
			return null;
		}

		const settings = this.getSettings();
		const projects = settings.projects ?? [];
		let matchedProject: ProjectEntry | null = null;
		let matchedLength = -1;

		for (const project of projects) {
			const projectRoot = this.getProjectVaultPath(project);
			if (!projectRoot) {
				continue;
			}
			if (normalizedPath !== projectRoot && !normalizedPath.startsWith(`${projectRoot}/`)) {
				continue;
			}
			if (projectRoot.length > matchedLength) {
				matchedProject = project;
				matchedLength = projectRoot.length;
			}
		}

		if (matchedProject) {
			return matchedProject;
		}

		return null;
	}

	getProjectVaultPath(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		const projectRootPath = project.boundaryPath?.trim();
		if (!projectRootPath) {
			return "";
		}
		return normalizeVaultPath(projectRootPath);
	}

	getProjectAbsolutePath(project: ProjectEntry | null | undefined): string {
		if (!project) {
			return "";
		}
		const vaultPath = this.getProjectVaultPath(project);
		if (!vaultPath) {
			return this.getVaultBasePath();
		}
		if (path.isAbsolute(vaultPath)) {
			return path.normalize(vaultPath);
		}
		return path.join(this.getVaultBasePath(), ...vaultPath.split("/"));
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
		if (!root) {
			return true;
		}
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
		if (!root) {
			return normalizedInput;
		}
		if (normalizedInput === root || normalizedInput.startsWith(`${root}/`)) {
			return normalizedInput;
		}
		return normalizeVaultPath(`${root}/${normalizedInput}`);
	}

	private getProjectKey(project: ProjectEntry): string {
		return project.projectId;
	}
}
