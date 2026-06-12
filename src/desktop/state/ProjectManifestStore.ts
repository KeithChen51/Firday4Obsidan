import { promises as fs } from "fs";
import path from "path";
import type { DesktopPermissionMode } from "../contracts/DesktopHostAdapter";
import type {
	DesktopProjectGitProfile,
	DesktopProjectManifest as ContractDesktopProjectManifest,
	InitializeDesktopProjectOptions,
} from "../contracts/ProjectHostPort";

export const FRIDAY_DIRECTORY_NAME = "FRIDAY";
export const PROJECT_MANIFEST_SCHEMA_VERSION = 1;
export const FRIDAY_PROJECT_DIRECTORIES = [
	"context",
	"artifacts",
	"imports",
	"archive",
	"skills",
	"conversations",
	"traces",
	"references",
	"state",
	"runtime",
	"local",
] as const;

export type ProjectManifestGitProfile = DesktopProjectGitProfile;
export type DesktopProjectManifest = ContractDesktopProjectManifest;
export type InitializeProjectManifestOptions = InitializeDesktopProjectOptions;

export interface ProjectManifestStoreOptions {
	clock?: () => Date;
}

export class ProjectManifestStore {
	readonly projectRoot: string;
	readonly fridayRoot: string;
	readonly manifestPath: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: ProjectManifestStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.fridayRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME);
		this.manifestPath = path.join(this.fridayRoot, "project.json");
		this.clock = options.clock ?? (() => new Date());
	}

	async read(): Promise<DesktopProjectManifest | null> {
		try {
			const raw = await fs.readFile(this.manifestPath, "utf8");
			return normalizeManifest(JSON.parse(raw), this.projectRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async initialize(options: InitializeProjectManifestOptions = {}): Promise<DesktopProjectManifest> {
		const existing = await this.read();
		if (existing) {
			return existing;
		}

		const now = this.clock().toISOString();
		const manifest: DesktopProjectManifest = {
			schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
			projectId: buildProjectId(this.projectRoot, options.projectId),
			name: buildProjectName(this.projectRoot, options.name),
			rootPath: this.projectRoot,
			createdAt: now,
			updatedAt: now,
			defaultPermissionMode: options.defaultPermissionMode ?? "standard",
			gitProfile: {
				isRepository: false,
				...options.gitProfile,
			},
		};

		await this.write(manifest);
		return manifest;
	}

	async write(manifest: DesktopProjectManifest): Promise<DesktopProjectManifest> {
		const normalizedManifest = normalizeManifest(manifest, this.projectRoot);
		await fs.mkdir(this.fridayRoot, { recursive: true });
		await atomicWriteJson(this.manifestPath, normalizedManifest);
		return normalizedManifest;
	}
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await fs.rename(tempPath, filePath);
}

function normalizeManifest(value: unknown, projectRoot: string): DesktopProjectManifest {
	const record = isRecord(value) ? value : {};
	const timestamps = resolveTimestamps(record);
	return {
		schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
		projectId: buildProjectId(projectRoot, asString(record.projectId)),
		name: buildProjectName(projectRoot, asString(record.name)),
		rootPath: path.resolve(projectRoot),
		createdAt: timestamps.createdAt,
		updatedAt: timestamps.updatedAt,
		defaultPermissionMode: normalizePermissionMode(record.defaultPermissionMode),
		gitProfile: normalizeGitProfile(record.gitProfile),
	};
}

function resolveTimestamps(record: Record<string, unknown>): { createdAt: string; updatedAt: string } {
	const now = new Date().toISOString();
	const createdAt = asString(record.createdAt) ?? now;
	const updatedAt = asString(record.updatedAt) ?? createdAt;
	return { createdAt, updatedAt };
}

function normalizeGitProfile(value: unknown): ProjectManifestGitProfile {
	const record = isRecord(value) ? value : {};
	const profile: ProjectManifestGitProfile = {
		isRepository: Boolean(record.isRepository),
	};
	const branch = asString(record.branch);
	const remote = asString(record.remote);
	const lastCheckedAt = asString(record.lastCheckedAt);
	if (branch) {
		profile.branch = branch;
	}
	if (remote) {
		profile.remote = remote;
	}
	if (typeof record.hasUncommittedChanges === "boolean") {
		profile.hasUncommittedChanges = record.hasUncommittedChanges;
	}
	if (typeof record.shareFridayLayer === "boolean") {
		profile.shareFridayLayer = record.shareFridayLayer;
	}
	if (lastCheckedAt) {
		profile.lastCheckedAt = lastCheckedAt;
	}
	return profile;
}

function normalizePermissionMode(value: unknown): DesktopPermissionMode {
	if (value === "safe" || value === "standard" || value === "autonomous") {
		return value;
	}
	return "standard";
}

function buildProjectId(projectRoot: string, preferred?: string): string {
	const source = preferred?.trim() || path.basename(projectRoot) || "project";
	return source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "") || "project";
}

function buildProjectName(projectRoot: string, preferred?: string): string {
	return preferred?.trim() || path.basename(projectRoot) || "Untitled Project";
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
