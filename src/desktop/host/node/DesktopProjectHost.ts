import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import type {
	DesktopProject,
	DesktopProjectLayout,
	DesktopProjectSession,
	GitProfile,
	InitializeDesktopProjectOptions,
	ProjectHostPort,
} from "../../contracts/ProjectHostPort";
import {
	FRIDAY_DIRECTORY_NAME,
	FRIDAY_PROJECT_DIRECTORIES,
	ProjectManifestStore,
} from "../../state/ProjectManifestStore";
import type {
	DesktopProjectManifest,
} from "../../state/ProjectManifestStore";
import { WorkspaceStateStore } from "../../state/WorkspaceStateStore";

const execFileAsync = promisify(execFile);

export interface DesktopProjectHostOptions {
	clock?: () => Date;
}

export type InitializeProjectOptions = InitializeDesktopProjectOptions;

export class DesktopProjectHost implements ProjectHostPort {
	private readonly clock: () => Date;
	private activeProject: DesktopProject | null = null;
	private readonly projectRootsById = new Map<string, string>();

	constructor(options: DesktopProjectHostOptions = {}) {
		this.clock = options.clock ?? (() => new Date());
	}

	async getActiveProject(): Promise<DesktopProject | null> {
		return this.activeProject ? { ...this.activeProject } : null;
	}

	async getProjectRoot(projectId: string): Promise<string> {
		const projectRoot = this.projectRootsById.get(projectId);
		if (!projectRoot) {
			throw new Error(`Unknown desktop project: ${projectId}`);
		}
		return projectRoot;
	}

	async initializeFridayLayout(projectRoot: string): Promise<DesktopProjectLayout> {
		const root = path.resolve(projectRoot);
		await fs.mkdir(root, { recursive: true });

		const fridayRoot = path.join(root, FRIDAY_DIRECTORY_NAME);
		const createdPaths: string[] = [];
		await ensureDirectory(fridayRoot, createdPaths);

		for (const directoryName of FRIDAY_PROJECT_DIRECTORIES) {
			await ensureDirectory(path.join(fridayRoot, directoryName), createdPaths);
		}

		return {
			root,
			fridayRoot,
			createdPaths,
		};
	}

	async initializeProject(projectRoot: string, options: InitializeProjectOptions = {}): Promise<DesktopProjectSession> {
		const root = path.resolve(projectRoot);
		await this.initializeFridayLayout(root);

		const manifestStore = new ProjectManifestStore(root, { clock: this.clock });
		const existingManifest = await manifestStore.read();
		const manifest = existingManifest ?? await manifestStore.initialize({
			...options,
			gitProfile: options.gitProfile ?? await detectGitProfile(root),
		});

		const project = this.rememberProject(manifest, manifestStore.manifestPath);
		return {
			project,
			manifest,
			workspaceState: await new WorkspaceStateStore(root, { clock: this.clock }).restore(),
		};
	}

	async getGitProfile(projectId: string): Promise<GitProfile> {
		return detectGitProfile(await this.getProjectRoot(projectId));
	}

	private rememberProject(manifest: DesktopProjectManifest, manifestPath: string): DesktopProject {
		this.projectRootsById.set(manifest.projectId, manifest.rootPath);
		const project = {
			id: manifest.projectId,
			name: manifest.name,
			root: manifest.rootPath,
			manifestPath,
		};
		this.activeProject = project;
		return { ...project };
	}
}

export async function detectGitProfile(projectRoot: string): Promise<GitProfile> {
	const root = path.resolve(projectRoot);
	const repositoryRoot = await runGit(root, ["rev-parse", "--show-toplevel"]);
	if (!repositoryRoot || path.resolve(repositoryRoot) !== root) {
		return { isRepository: false };
	}

	const branch = await runGit(root, ["branch", "--show-current"]);
	const remote = await runGit(root, ["config", "--get", "remote.origin.url"]);
	const status = await runGit(root, ["status", "--porcelain"]);

	return {
		isRepository: true,
		branch: branch || undefined,
		remote: remote || undefined,
		hasUncommittedChanges: Boolean(status),
	};
}

async function ensureDirectory(directoryPath: string, createdPaths: string[]): Promise<void> {
	const existed = await pathExists(directoryPath);
	await fs.mkdir(directoryPath, { recursive: true });
	if (!existed) {
		createdPaths.push(directoryPath);
	}
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.stat(targetPath);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd });
		return stdout.trim();
	} catch {
		return "";
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
