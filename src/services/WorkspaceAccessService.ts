import path from "path";
import { normalizePath } from "obsidian";
import { FridaySettings } from "../types/settings";
import { ProjectBoundaryService } from "./ProjectBoundaryService";

export class WorkspaceAccessService {
	constructor(
		private readonly getSettings: () => FridaySettings,
		private readonly projectBoundaryService: ProjectBoundaryService,
	) {}

	canReadVaultPath(vaultRelativePath: string): boolean {
		const normalizedPath = normalizePath(vaultRelativePath);
		const activeProject = this.projectBoundaryService.getActiveProject();
		if (activeProject && !this.projectBoundaryService.isWithinProject(activeProject, normalizedPath)) {
			return false;
		}

		const focusPaths = this.getSettings().agentRuntime.vaultFocusPaths
			.map((item) => normalizePath(item))
			.filter((item) => item.length > 0);
		if (focusPaths.length === 0) {
			return true;
		}

		return focusPaths.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
	}

	canWriteVaultPath(vaultRelativePath: string): boolean {
		return this.canReadVaultPath(vaultRelativePath);
	}

	canReadExternalPath(absolutePath: string): boolean {
		const normalizedTarget = this.normalizeAbsolutePath(absolutePath);
		const settings = this.getSettings();
		const allowList = [...settings.agentRuntime.externalReadOnlyPaths, ...settings.agentRuntime.externalSkillPaths]
			.map((item) => this.normalizeAbsolutePath(item))
			.filter((item) => item.length > 0);

		return allowList.some((prefix) => normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`));
	}

	canWriteExternalPath(): boolean {
		return false;
	}

	private normalizeAbsolutePath(inputPath: string): string {
		const resolved = path.resolve(inputPath);
		return normalizePath(resolved);
	}
}
