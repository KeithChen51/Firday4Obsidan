import { promises as fs } from "fs";
import path from "path";
import simpleGit from "simple-git";
import type { ProjectEntry } from "../../types/project";

export interface GitIgnoreCandidate {
	path: string;
	kind: "file" | "directory";
}

export class GitIgnoreService {
	constructor(private readonly resolveProjectAbsolutePath: (project: ProjectEntry) => string) {}

	async listCandidates(project: ProjectEntry): Promise<GitIgnoreCandidate[]> {
		const repoRoot = this.resolveProjectPath(project);
		const git = simpleGit({ baseDir: repoRoot, maxConcurrentProcesses: 1 });
		const output = await git.raw(["status", "--porcelain", "--untracked-files=normal"]);
		const candidates = new Map<string, GitIgnoreCandidate>();

		for (const line of output.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("?? ")) {
				continue;
			}
			const relativePath = trimmed.slice(3).trim();
			if (!relativePath) {
				continue;
			}
			const normalized = relativePath.replace(/\\/g, "/");
			const isDirectory = normalized.endsWith("/");
			candidates.set(normalized, {
				path: normalized,
				kind: isDirectory ? "directory" : "file",
			});
		}

		return [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
	}

	async applyRule(project: ProjectEntry, rulePath: string): Promise<void> {
		const repoRoot = this.resolveProjectPath(project);
		const normalizedRule = this.normalizeRule(rulePath);
		const gitIgnorePath = path.join(repoRoot, ".gitignore");
		const existing = await fs.readFile(gitIgnorePath, "utf8").catch(() => "");
		const lines = existing
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.includes(normalizedRule)) {
			return;
		}

		const next = [...lines, normalizedRule].join("\n");
		await fs.writeFile(gitIgnorePath, `${next}\n`, "utf8");
	}

	private resolveProjectPath(project: ProjectEntry): string {
		const candidate = this.resolveProjectAbsolutePath(project)?.trim() || "";
		if (!candidate) {
			throw new Error("Project absolute path is required for ignore management.");
		}
		return path.normalize(candidate);
	}

	private normalizeRule(rulePath: string): string {
		return rulePath.replace(/\\/g, "/").trim();
	}
}
