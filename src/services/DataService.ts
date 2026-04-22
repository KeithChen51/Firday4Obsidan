import path from "path";
import { normalizePath, parseYaml, stringifyYaml, TFile, TFolder, Vault } from "obsidian";
import {
	getPathPresets,
	getRootCandidates,
	PathPreset,
	PERSONAL_SLUG,
	PRIMARY_PATHS,
} from "../constants/paths";
import { ProjectEntry, ProjectMember } from "../types/project";
import { FridaySettings } from "../types/settings";
import { sortFrontmatterKeys } from "../utils/frontmatter";
import { getRoleLabel } from "../utils/labels";

export class DataService {
	constructor(
		private readonly vault: Vault,
		private readonly fridayRoot: string = PRIMARY_PATHS.root,
	) {}

	async ensureDirectoryStructure(): Promise<void> {
		const folders = [
			this.fridayRoot,
			`${this.fridayRoot}/${PRIMARY_PATHS.projects}`,
			`${this.fridayRoot}/${PRIMARY_PATHS.personal}`,
		];

		for (const folder of folders) {
			await this.ensureFolderRecursive(folder);
		}
	}

	async writeConfigMirror(settings: FridaySettings): Promise<void> {
		const filePath = this.resolveConfigMirrorPath();
		const safeLlm = {
			mode: settings.llm.mode,
			apiUrl: settings.llm.apiUrl,
			// apiKey intentionally excluded: never write secrets to vault files
			model: settings.llm.model,
			temperature: settings.llm.temperature,
			maxTokens: settings.llm.maxTokens,
			enableStreaming: settings.llm.enableStreaming,
		};
		const frontmatter = sortFrontmatterKeys({
			type: "config",
			version: settings.version,
			llm: safeLlm,
			sync: settings.sync,
			user: {
				displayName: settings.user.displayName,
				userId: settings.user.userId,
			},
		});
		const content = this.renderMarkdownWithFrontmatter(frontmatter, "");
		await this.upsertTextFile(filePath, content);
	}

	getProjectIdFromPath(filePath: string): string | null {
		const normalizedPath = normalizePath(filePath);

		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				const projectPrefix = normalizePath(`${root}/${preset.projects}/`);
				if (normalizedPath.startsWith(projectPrefix)) {
					const remainder = normalizedPath.slice(projectPrefix.length);
					return remainder.split("/")[0] ?? null;
				}

				const personalPrefix = normalizePath(`${root}/${preset.personal}/`);
				if (normalizedPath.startsWith(personalPrefix)) {
					return PERSONAL_SLUG;
				}
			}
		}

		return null;
	}

	getFridayRoot(): string {
		return this.fridayRoot;
	}

	async getProjectMembers(project: Pick<ProjectEntry, "projectId" | "boundaryPath">): Promise<ProjectMember[]> {
		if (!project.projectId || project.projectId === PERSONAL_SLUG) {
			return [];
		}

		const projectFolder = this.resolveProjectFolder(project);
		if (!projectFolder) {
			return [];
		}

		const membersFromMembersFile = await this.readMembersFromFiles(
			projectFolder,
			(preset) => preset.projectMembersFile,
		);
		if (membersFromMembersFile.length > 0) {
			return membersFromMembersFile;
		}

		return this.readMembersFromFiles(projectFolder, (preset) => preset.projectMetaFile);
	}

	async setProjectMembers(
		project: Pick<ProjectEntry, "projectId" | "boundaryPath">,
		members: ProjectMember[],
	): Promise<void> {
		if (!project.projectId || project.projectId === PERSONAL_SLUG) {
			throw new Error("个人项目不支持成员管理。");
		}

		const projectFolder = this.resolveProjectFolder(project);
		if (!projectFolder) {
			throw new Error(`未找到项目目录：${project.boundaryPath || project.projectId}`);
		}

		const filePath = this.resolveMembersFilePath(projectFolder);
		const normalizedMembers = this.normalizeMembers(members);
		const frontmatter = {
			type: "project_members",
			projectId: project.projectId,
			updatedAt: new Date().toISOString(),
			members: normalizedMembers,
		};
		const body =
			normalizedMembers.length === 0
				? "## 项目成员\n\n（暂无成员）\n"
				: [
						"## 项目成员",
						"",
						...normalizedMembers.map((item) => `- ${item.userId}（${getRoleLabel(item.role)}）`),
						"",
				  ].join("\n");
		const content = this.renderMarkdownWithFrontmatter(frontmatter, body);
		await this.upsertTextFile(filePath, content);
	}

	private async ensureFolderRecursive(pathValue: string): Promise<void> {
		const normalizedPath = normalizePath(pathValue);
		if (this.vault.getAbstractFileByPath(normalizedPath)) {
			return;
		}

		const segments = normalizedPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.vault.getAbstractFileByPath(current)) {
				try {
					await this.vault.createFolder(current);
				} catch (error) {
					if (this.isFolderAlreadyExistsError(error)) {
						continue;
					}

					const existing = this.vault.getAbstractFileByPath(current);
					if (existing instanceof TFolder) {
						continue;
					}

					throw error;
				}
			}
		}
	}

	private async upsertTextFile(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const existing = this.getFileByPathRelaxed(normalized);
		if (existing) {
			await this.vault.modify(existing, content);
			return;
		}

		try {
			await this.vault.create(normalized, content);
			return;
		} catch (error) {
			if (!this.isFileAlreadyExistsError(error)) {
				throw error;
			}
		}

		await this.writeTextFileBestEffort(normalized, content);
	}

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const directHit = this.vault.getAbstractFileByPath(normalized);
		if (directHit instanceof TFile) {
			return directHit;
		}

		const normalizedLower = normalized.toLowerCase();
		return (
			this.vault
				.getFiles()
				.find((item) => normalizePath(item.path).toLowerCase() === normalizedLower) ?? null
		);
	}

	private async writeTextFileBestEffort(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const existing = this.getFileByPathRelaxed(normalized);
		if (existing) {
			await this.vault.modify(existing, content);
			return;
		}

		const parentPath = normalizePath(path.posix.dirname(normalized));
		if (parentPath && parentPath !== "." && !this.vault.getAbstractFileByPath(parentPath)) {
			await this.ensureFolderRecursive(parentPath);
		}

		await this.vault.adapter.write(normalized, content);
	}

	private isFolderAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("folder already exists") || message.includes("already exists");
	}

	private isFileAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("file already exists") || message.includes("already exists");
	}

	private resolveProjectFolder(project: Pick<ProjectEntry, "boundaryPath">): string | null {
		const projectRoot = normalizePath(project.boundaryPath?.trim() ?? "");
		if (!projectRoot || path.isAbsolute(projectRoot)) {
			return null;
		}

		const abstractFile = this.vault.getAbstractFileByPath(projectRoot);
		return abstractFile instanceof TFolder ? projectRoot : null;
	}

	private resolveMembersFilePath(projectFolder: string): string {
		for (const preset of getPathPresets()) {
			const candidatePath = normalizePath(`${projectFolder}/${preset.projectMembersFile}`);
			const abstractFile = this.vault.getAbstractFileByPath(candidatePath);
			if (abstractFile instanceof TFile) {
				return candidatePath;
			}
		}

		return normalizePath(`${projectFolder}/${PRIMARY_PATHS.projectMembersFile}`);
	}

	private splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
		const matched = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		if (!matched) {
			return null;
		}

		const frontmatter = matched[1] ?? "";
		const body = content.slice(matched[0].length);
		return { frontmatter, body };
	}

	private renderMarkdownWithFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
		const yaml = stringifyYaml(sortFrontmatterKeys(frontmatter)).trimEnd();
		if (!body) {
			return `---\n${yaml}\n---\n`;
		}
		return `---\n${yaml}\n---\n\n${body}`;
	}

	private async readMembersFromFiles(
		projectFolder: string,
		fileSelector: (preset: PathPreset) => string,
	): Promise<ProjectMember[]> {
		for (const preset of getPathPresets()) {
			const filePath = normalizePath(`${projectFolder}/${fileSelector(preset)}`);
			const abstractFile = this.vault.getAbstractFileByPath(filePath);
			if (!(abstractFile instanceof TFile)) {
				continue;
			}

			const content = await this.vault.cachedRead(abstractFile);
			const parsed = this.splitFrontmatter(content);
			if (!parsed) {
				continue;
			}

			try {
				const frontmatter = parseYaml(parsed.frontmatter) as { members?: unknown };
				return this.normalizeMembers(frontmatter.members);
			} catch (error) {
				console.warn("[Friday] Failed to parse project members:", filePath, error);
			}
		}

		return [];
	}

	private normalizeMembers(value: unknown): ProjectMember[] {
		if (!Array.isArray(value)) {
			return [];
		}

		const result: ProjectMember[] = [];
		for (const item of value) {
			const record = item as { userId?: unknown; role?: unknown };
			const userId = typeof record.userId === "string" ? record.userId.trim() : "";
			const role = typeof record.role === "string" ? record.role.trim() : "";
			if (!userId || !role || !["admin", "editor", "viewer"].includes(role)) {
				continue;
			}

			result.push({
				userId,
				role: role as ProjectMember["role"],
			});
		}

		return result;
	}

	private resolveConfigMirrorPath(): string {
		const candidates: string[] = [];
		for (const root of getRootCandidates(this.fridayRoot)) {
			for (const preset of getPathPresets()) {
				candidates.push(normalizePath(`${root}/${preset.configFile}`));
			}
		}

		const existing = candidates.find((item) => this.vault.getAbstractFileByPath(item) instanceof TFile);
		return existing ?? normalizePath(`${this.fridayRoot}/${PRIMARY_PATHS.configFile}`);
	}
}
