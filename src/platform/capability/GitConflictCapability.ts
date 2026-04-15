import path from "path";
import { normalizePath, type Vault } from "obsidian";
import simpleGit, { type SimpleGit } from "simple-git";
import { buildConflictProposal } from "../../core/extensions/ConflictProposalBuilder";
import type { ProjectEntry } from "../../types/project";

export class GitConflictCapability {
	constructor(
		private readonly vault: Vault,
		private readonly getActiveProject: () => ProjectEntry | null,
	) {}

	async generateProposal(taskPrompt: string): Promise<{
		markdown: string;
		recommendedStrategy: "ours" | "theirs" | "manual";
	}> {
		const activeProject = this.getActiveProject();
		if (!activeProject) {
			throw new Error("No active project selected.");
		}
		const conflicts = await this.getConflictFiles(activeProject);
		if (conflicts.length === 0) {
			return {
				markdown: "Skill used: resolve-conflict\n\nNo conflicts detected.",
				recommendedStrategy: "manual",
			};
		}
		const requestedPath = this.extractConflictPathFromPrompt(taskPrompt);
		const targetPath = requestedPath && conflicts.includes(requestedPath) ? requestedPath : conflicts[0]!;
		const proposal = await this.buildConflictProposalForFile(activeProject, targetPath);
		return {
			markdown: `Skill used: resolve-conflict\n\n${proposal.markdown}`,
			recommendedStrategy: proposal.recommendedStrategy,
		};
	}

	private async getConflictFiles(project: ProjectEntry): Promise<string[]> {
		const git = this.createProjectGit(project);
		const output = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
		return output
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);
	}

	private createProjectGit(project: ProjectEntry) {
		const baseDir = this.resolveProjectAbsolutePath(project);
		return simpleGit({ baseDir, maxConcurrentProcesses: 1 }) as SimpleGit;
	}

	private resolveProjectAbsolutePath(project: ProjectEntry): string {
		const adapter = this.vault.adapter as { getBasePath?: () => string };
		const basePath = adapter.getBasePath?.() ?? ".";
		return path.join(basePath, ...normalizePath(project.boundaryPath).split("/"));
	}

	private extractConflictPathFromPrompt(prompt: string): string {
		const match = prompt.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)/);
		return match?.[1]?.trim() ?? "";
	}

	private async buildConflictProposalForFile(project: ProjectEntry, filePath: string) {
		const git = this.createProjectGit(project);
		const localSnippet = await git.raw(["show", `:2:${filePath}`]).catch(() => "");
		const remoteSnippet = await git.raw(["show", `:3:${filePath}`]).catch(() => "");
		return buildConflictProposal({
			filePath,
			localSnippet,
			remoteSnippet,
		});
	}
}
