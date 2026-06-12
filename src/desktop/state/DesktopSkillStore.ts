import { promises as fs } from "fs";
import type { Dirent } from "fs";
import path from "path";
import type {
	ComposerSkillReference,
	DesktopSkillScope,
	DesktopSkillSummary,
	SkillHostPort,
} from "../contracts/SkillHostPort";
import { FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

const SKILL_STATE_SCHEMA_VERSION = 1;
const SKILL_FILE_NAMES = ["SKILL.md", "skill.md"];

export interface DesktopSkillStoreOptions {
	globalSkillsRoot?: string;
}

export interface ProjectSkillPromotionState {
	projectId: string;
	skillId: string;
	promotableToGlobal: boolean;
}

interface DesktopSkillState {
	schemaVersion: typeof SKILL_STATE_SCHEMA_VERSION;
	projectId?: string;
	enabled: {
		project: Record<string, boolean>;
		global: Record<string, boolean>;
	};
	promotableProjectSkills: Record<string, boolean>;
}

interface ParsedSkillFile {
	id: string;
	name: string;
	description?: string;
	sourcePath: string;
}

export class DesktopSkillStore implements SkillHostPort {
	readonly projectRoot: string;
	readonly projectSkillsRoot: string;
	readonly globalSkillsRoot: string;
	readonly statePath: string;

	private executionCountForTest = 0;

	constructor(projectRoot: string, options: DesktopSkillStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.projectSkillsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "skills");
		this.globalSkillsRoot = path.resolve(options.globalSkillsRoot ?? path.join(process.cwd(), ".friday-global-skills"));
		this.statePath = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "state", "desktop-skills.json");
	}

	async listProjectSkills(_projectId: string): Promise<DesktopSkillSummary[]> {
		if (!await this.isProjectSkillsRootSafe()) {
			return [];
		}
		return this.listSkillsFromRoot(this.projectSkillsRoot, "project");
	}

	async listGlobalSkills(): Promise<DesktopSkillSummary[]> {
		return this.listSkillsFromRoot(this.globalSkillsRoot, "global");
	}

	async setSkillEnabled(projectId: string, skillId: string, enabled: boolean): Promise<DesktopSkillSummary> {
		const resolved = await this.resolveUnscopedSkillForEnabledUpdate(skillId);
		if (!resolved) {
			throw new Error(`Desktop skill not found: ${skillId}`);
		}

		const state = await this.readState();
		state.projectId = projectId;
		state.enabled[resolved.scope][resolved.id] = enabled;
		await this.writeState(state);

		return {
			...resolved,
			enabled,
		};
	}

	async setScopedSkillEnabled(
		projectId: string,
		skillId: string,
		scope: DesktopSkillScope,
		enabled: boolean,
	): Promise<DesktopSkillSummary> {
		const skills = scope === "project" ? await this.listProjectSkills(projectId) : await this.listGlobalSkills();
		const resolved = skills.find((item) => item.id === skillId);
		if (!resolved) {
			throw new Error(`Desktop ${scope} skill not found: ${skillId}`);
		}

		const state = await this.readState();
		state.projectId = projectId;
		state.enabled[scope][resolved.id] = enabled;
		await this.writeState(state);

		return {
			...resolved,
			enabled,
		};
	}

	async markProjectSkillPromotable(
		projectId: string,
		skillId: string,
		promotableToGlobal: boolean,
	): Promise<ProjectSkillPromotionState> {
		const skill = (await this.listProjectSkills(projectId)).find((item) => item.id === skillId);
		if (!skill) {
			throw new Error(`Project skill not found: ${skillId}`);
		}

		const state = await this.readState();
		state.projectId = projectId;
		state.promotableProjectSkills[skill.id] = promotableToGlobal;
		await this.writeState(state);

		return {
			projectId,
			skillId: skill.id,
			promotableToGlobal,
		};
	}

	async getProjectSkillPromotionState(projectId: string, skillId: string): Promise<ProjectSkillPromotionState> {
		const state = await this.readState();
		return {
			projectId,
			skillId,
			promotableToGlobal: state.promotableProjectSkills[skillId] === true,
		};
	}

	async buildComposerSkillReference(
		_projectId: string,
		skillId: string,
		scope: DesktopSkillScope,
	): Promise<ComposerSkillReference> {
		const skills = scope === "project" ? await this.listProjectSkills(_projectId) : await this.listGlobalSkills();
		const skill = skills.find((item) => item.id === skillId);
		if (!skill) {
			throw new Error(`Desktop ${scope} skill not found: ${skillId}`);
		}

		return {
			skillId: skill.id,
			scope: skill.scope,
			label: skill.name,
			referenceText: `@${skill.name}`,
			sourcePath: skill.sourcePath,
		};
	}

	getExecutionCountForTest(): number {
		return this.executionCountForTest;
	}

	private async listSkillsFromRoot(root: string, scope: DesktopSkillScope): Promise<DesktopSkillSummary[]> {
		const state = await this.readState();
		const files = await this.collectSkillFiles(root);
		const skills: DesktopSkillSummary[] = [];

		for (const filePath of files) {
			const parsed = await this.parseSkillFile(root, filePath);
			if (!parsed) {
				continue;
			}
			skills.push({
				id: parsed.id,
				name: parsed.name,
				description: parsed.description,
				scope,
				enabled: state.enabled[scope][parsed.id] ?? true,
				sourcePath: parsed.sourcePath,
			});
		}

		return skills.sort((left, right) => {
			const nameOrder = left.name.localeCompare(right.name);
			if (nameOrder !== 0) {
				return nameOrder;
			}
			return left.id.localeCompare(right.id);
		});
	}

	private async collectSkillFiles(root: string): Promise<string[]> {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(root, { withFileTypes: true });
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}

		const files: string[] = [];
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const candidate = path.join(root, entry.name);
			if (entry.isFile() && isSkillFileName(entry.name)) {
				files.push(candidate);
				continue;
			}
			if (!entry.isDirectory()) {
				continue;
			}
			for (const skillFileName of SKILL_FILE_NAMES) {
				const skillPath = path.join(candidate, skillFileName);
				try {
					const stat = await fs.stat(skillPath);
					if (stat.isFile()) {
						files.push(skillPath);
						break;
					}
				} catch (error) {
					if (isNodeError(error) && error.code === "ENOENT") {
						continue;
					}
					throw error;
				}
			}
		}
		return files;
	}

	private async parseSkillFile(root: string, filePath: string): Promise<ParsedSkillFile | null> {
		if (!await this.isRealPathInside(root, filePath)) {
			return null;
		}
		let raw = "";
		try {
			raw = await fs.readFile(filePath, "utf8");
		} catch {
			return null;
		}

		const frontmatter = parseFrontmatter(raw);
		const folderName = path.basename(path.dirname(filePath));
		const fallbackName = isSkillFileName(path.basename(filePath)) && folderName ? folderName : path.basename(filePath, path.extname(filePath));
		const name = frontmatter.name || toTitle(fallbackName);
		const id = normalizeSkillId(frontmatter.id || folderName || name);
		if (!id) {
			return null;
		}
		return {
			id,
			name,
			description: frontmatter.description,
			sourcePath: filePath,
		};
	}

	private async resolveUnscopedSkillForEnabledUpdate(skillId: string): Promise<DesktopSkillSummary | null> {
		const projectSkill = (await this.listProjectSkills("")).find((item) => item.id === skillId);
		const globalSkill = (await this.listGlobalSkills()).find((item) => item.id === skillId);
		if (projectSkill && globalSkill) {
			throw new Error(`Ambiguous skill id "${skillId}" exists in both project and global skills.`);
		}
		return projectSkill ?? globalSkill ?? null;
	}

	private async readState(): Promise<DesktopSkillState> {
		try {
			const raw = await fs.readFile(this.statePath, "utf8");
			return normalizeState(JSON.parse(raw));
		} catch {
			return createEmptyState();
		}
	}

	private async writeState(state: DesktopSkillState): Promise<void> {
		await safeAtomicWriteJsonInsideProject(this.projectRoot, this.statePath, normalizeState(state));
	}

	private async isProjectSkillsRootSafe(): Promise<boolean> {
		try {
			const realProjectRoot = await fs.realpath(this.projectRoot);
			const realSkillsRoot = await fs.realpath(this.projectSkillsRoot);
			return isPathInside(realProjectRoot, realSkillsRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return true;
			}
			throw error;
		}
	}

	private async isRealPathInside(root: string, candidatePath: string): Promise<boolean> {
		const resolvedRoot = path.resolve(root);
		const resolvedCandidate = path.resolve(candidatePath);
		if (!isPathInside(resolvedRoot, resolvedCandidate)) {
			return false;
		}

		try {
			const realRoot = await fs.realpath(resolvedRoot);
			const realCandidate = await fs.realpath(resolvedCandidate);
			return isPathInside(realRoot, realCandidate);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return false;
			}
			throw error;
		}
	}
}

function parseFrontmatter(markdown: string): { id?: string; name?: string; description?: string } {
	const block = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*/u);
	if (!block) {
		return {};
	}
	const result: { id?: string; name?: string; description?: string } = {};
	for (const rawLine of (block[1] ?? "").split(/\r?\n/u)) {
		const line = rawLine.trim();
		const matched = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u);
		if (!matched) {
			continue;
		}
		const key = (matched[1] ?? "").toLowerCase();
		const value = stripQuotes(matched[2] ?? "");
		if (!value) {
			continue;
		}
		if (key === "id") {
			result.id = value;
		} else if (key === "name") {
			result.name = value;
		} else if (key === "description") {
			result.description = value;
		}
	}
	return result;
}

function normalizeState(value: unknown): DesktopSkillState {
	const record = isRecord(value) ? value : {};
	const enabled = isRecord(record.enabled) ? record.enabled : {};
	return {
		schemaVersion: SKILL_STATE_SCHEMA_VERSION,
		projectId: asString(record.projectId),
		enabled: {
			project: toBooleanRecord(isRecord(enabled.project) ? enabled.project : {}),
			global: toBooleanRecord(isRecord(enabled.global) ? enabled.global : {}),
		},
		promotableProjectSkills: toBooleanRecord(
			isRecord(record.promotableProjectSkills) ? record.promotableProjectSkills : {},
		),
	};
}

function createEmptyState(): DesktopSkillState {
	return {
		schemaVersion: SKILL_STATE_SCHEMA_VERSION,
		enabled: {
			project: {},
			global: {},
		},
		promotableProjectSkills: {},
	};
}

function toBooleanRecord(record: Record<string, unknown>): Record<string, boolean> {
	const result: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(record)) {
		if (typeof value === "boolean") {
			result[key] = value;
		}
	}
	return result;
}

function normalizeSkillId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\.md$/iu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/-+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function toTitle(value: string): string {
	return value
		.replace(/[-_]+/gu, " ")
		.replace(/\b\w/gu, (char) => char.toUpperCase())
		.trim() || "Untitled Skill";
}

function stripQuotes(value: string): string {
	return value.trim().replace(/^['"]+|['"]+$/gu, "").trim();
}

function isSkillFileName(value: string): boolean {
	return SKILL_FILE_NAMES.some((fileName) => fileName.toLowerCase() === value.toLowerCase());
}

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function safeAtomicWriteJsonInsideProject(projectRoot: string, filePath: string, value: unknown): Promise<void> {
	const stateRoot = path.dirname(filePath);
	await ensureManagedStateDirectoryInsideProject(projectRoot, stateRoot);
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await fs.rename(tempPath, filePath);
}

async function ensureManagedStateDirectoryInsideProject(projectRoot: string, stateRoot: string): Promise<void> {
	const resolvedProjectRoot = path.resolve(projectRoot);
	const realProjectRoot = await fs.realpath(resolvedProjectRoot);
	const fridayRoot = path.join(resolvedProjectRoot, FRIDAY_DIRECTORY_NAME);
	await ensureDirectoryPathInsideProject(realProjectRoot, fridayRoot, "FRIDAY directory");
	await ensureDirectoryPathInsideProject(realProjectRoot, stateRoot, "FRIDAY state directory");
}

async function ensureDirectoryPathInsideProject(
	realProjectRoot: string,
	directoryPath: string,
	label: string,
): Promise<void> {
	try {
		const realDirectoryPath = await fs.realpath(directoryPath);
		if (!isPathInside(realProjectRoot, realDirectoryPath)) {
			throw new Error(`${label} resolves outside project root: ${directoryPath}`);
		}
		const stat = await fs.stat(realDirectoryPath);
		if (!stat.isDirectory()) {
			throw new Error(`${label} is not a directory: ${directoryPath}`);
		}
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			await fs.mkdir(directoryPath, { recursive: true });
			const realDirectoryPath = await fs.realpath(directoryPath);
			if (!isPathInside(realProjectRoot, realDirectoryPath)) {
				throw new Error(`${label} resolves outside project root: ${directoryPath}`);
			}
			return;
		}
		throw error;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
