import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
	ArtifactCreateInput,
	ArtifactHostPort,
	ArtifactVersionFile,
	ArtifactVersionFileReadResult,
	ArtifactVersionFileWriteInput,
	DesktopArtifactManifest,
	ProjectFileArtifactWrapperInput,
} from "../contracts/ArtifactHostPort";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { encodeStatePathSegment } from "./StatePathSegments";

export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;

export type ArtifactStorageMode = "managed_file" | "project_file_reference";

export interface StoredArtifactFileRecord {
	path: string;
	managedPath?: string;
	projectRelativePath?: string;
	contentType?: string;
	size?: number;
	createdAt?: string;
	metadata?: Record<string, unknown>;
}

export interface ArtifactVersionRecord {
	versionId: string;
	createdTurnId: string;
	createdAt: string;
	files: StoredArtifactFileRecord[];
	metadata?: Record<string, unknown>;
}

export interface StoredArtifactManifest extends DesktopArtifactManifest {
	schemaVersion: typeof ARTIFACT_MANIFEST_SCHEMA_VERSION;
	id: string;
	artifactId: string;
	projectId: string;
	conversationId: string;
	createdTurnId: string;
	updatedTurnId: string;
	artifactType: string;
	title?: string;
	renderable: boolean;
	currentVersionId?: string;
	storageMode: ArtifactStorageMode;
	source: Record<string, unknown>;
	versions: ArtifactVersionRecord[];
	createdAt: string;
	updatedAt: string;
	metadata: Record<string, unknown>;
}

export interface GeneratedArtifactFileInput {
	path: string;
	content: string;
	contentType?: string;
	metadata?: Record<string, unknown>;
}

export interface CreateGeneratedArtifactInput extends ArtifactCreateInput {
	artifactId?: string;
	versionId?: string;
	renderable?: boolean;
	files?: GeneratedArtifactFileInput[];
	metadata?: Record<string, unknown>;
	source?: Record<string, unknown>;
}

export interface OpenProjectFileArtifactInput extends ProjectFileArtifactWrapperInput {
	artifactId?: string;
	versionId?: string;
	renderable?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ArtifactStoreOptions {
	clock?: () => Date;
	idFactory?: () => string;
	versionIdFactory?: () => string;
}

export class ArtifactStore implements ArtifactHostPort {
	readonly projectRoot: string;
	readonly artifactsRoot: string;

	private readonly clock: () => Date;
	private readonly idFactory: () => string;
	private readonly versionIdFactory: () => string;

	constructor(projectRoot: string, options: ArtifactStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.artifactsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "artifacts");
		this.clock = options.clock ?? (() => new Date());
		this.idFactory = options.idFactory ?? createArtifactId;
		this.versionIdFactory = options.versionIdFactory ?? createArtifactVersionId;
	}

	async createGeneratedArtifact(
		context: DesktopTurnContext,
		input: CreateGeneratedArtifactInput,
	): Promise<StoredArtifactManifest> {
		const now = this.now();
		const artifactId = input.artifactId ?? this.idFactory();
		const versionId = input.versionId ?? this.versionIdFactory();
		const files = input.files ?? [];
		const fileRecords: StoredArtifactFileRecord[] = [];

		for (const file of files) {
			fileRecords.push(await this.writeManagedVersionFile(artifactId, versionId, file, now));
		}

		const manifest = this.normalizeManifest({
			schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
			id: artifactId,
			artifactId,
			projectId: context.projectId,
			conversationId: context.conversationId,
			createdTurnId: context.turnId,
			updatedTurnId: context.turnId,
			artifactType: input.artifactType,
			title: input.title,
			renderable: Boolean(input.renderable),
			currentVersionId: versionId,
			storageMode: "managed_file",
			source: input.source ?? {
				kind: "friday_generated",
				turnId: context.turnId,
			},
			versions: [
				{
					versionId,
					createdTurnId: context.turnId,
					createdAt: now,
					files: fileRecords,
				},
			],
			createdAt: now,
			updatedAt: now,
			metadata: input.metadata ?? {},
		});

		await this.writeManifest(manifest);
		return manifest;
	}

	async openProjectFileArtifact(
		context: DesktopTurnContext,
		input: OpenProjectFileArtifactInput,
	): Promise<StoredArtifactManifest> {
		const now = this.now();
		const artifactId = input.artifactId ?? this.idFactory();
		const versionId = input.versionId ?? this.versionIdFactory();
		const projectRelativePath = this.resolveProjectRelativePath(input.projectFilePath);
		const manifest = this.normalizeManifest({
			schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
			id: artifactId,
			artifactId,
			projectId: context.projectId,
			conversationId: context.conversationId,
			createdTurnId: context.turnId,
			updatedTurnId: context.turnId,
			artifactType: input.artifactType,
			title: input.title ?? path.basename(projectRelativePath),
			renderable: input.renderable ?? true,
			currentVersionId: versionId,
			storageMode: "project_file_reference",
			source: {
				kind: "project_file",
				projectRelativePath,
			},
			versions: [
				{
					versionId,
					createdTurnId: context.turnId,
					createdAt: now,
					files: [
						{
							path: path.basename(projectRelativePath),
							projectRelativePath,
							contentType: inferContentType(projectRelativePath),
							createdAt: now,
						},
					],
				},
			],
			createdAt: now,
			updatedAt: now,
			metadata: input.metadata ?? {},
		});

		await this.writeManifest(manifest);
		return manifest;
	}

	async createArtifact(context: DesktopTurnContext, input: ArtifactCreateInput): Promise<StoredArtifactManifest> {
		return this.createGeneratedArtifact(context, {
			...input,
			files: [],
			renderable: false,
		});
	}

	async listArtifacts(_context: DesktopTurnContext, conversationId: string): Promise<StoredArtifactManifest[]> {
		return this.listConversationArtifacts(conversationId);
	}

	async listConversationArtifacts(conversationId: string): Promise<StoredArtifactManifest[]> {
		const manifests = await this.listAllArtifacts();
		return manifests
			.filter((manifest) => manifest.conversationId === conversationId)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
	}

	async openArtifact(_context: DesktopTurnContext, artifactId: string): Promise<StoredArtifactManifest> {
		const manifest = await this.readArtifactManifest(artifactId);
		if (!manifest) {
			throw new Error(`Artifact does not exist: ${artifactId}`);
		}
		return manifest;
	}

	async readArtifactManifest(artifactId: string): Promise<StoredArtifactManifest | null> {
		try {
			const parsed = JSON.parse(await fs.readFile(this.resolveManifestPath(artifactId), "utf8")) as unknown;
			return this.parsePersistedManifest(parsed, {
				expectedArtifactId: artifactId,
			});
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async updateArtifactManifest(_context: DesktopTurnContext, manifest: DesktopArtifactManifest): Promise<void> {
		const existing = await this.readArtifactManifest(manifest.id);
		const now = this.now();
		await this.writeManifest(this.normalizeManifest({
			...existing,
			...manifest,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		}));
	}

	async writeArtifactVersionFile(
		context: DesktopTurnContext,
		input: ArtifactVersionFileWriteInput,
	): Promise<ArtifactVersionFile> {
		const manifest = await this.openArtifact(context, input.artifactId);
		if (manifest.storageMode !== "managed_file") {
			throw new Error(`Cannot write managed version file for referenced artifact: ${input.artifactId}`);
		}

		const now = this.now();
		const fileRecord = await this.writeManagedVersionFile(input.artifactId, input.versionId, {
			path: input.path,
			content: input.content,
			contentType: input.contentType,
		}, now);
		const version = manifest.versions.find((item) => item.versionId === input.versionId);
		if (version) {
			version.files = mergeVersionFiles(version.files, [fileRecord]);
		} else {
			manifest.versions.push({
				versionId: input.versionId,
				createdTurnId: context.turnId,
				createdAt: now,
				files: [fileRecord],
			});
		}
		manifest.currentVersionId = input.versionId;
		manifest.updatedTurnId = context.turnId;
		manifest.updatedAt = now;
		await this.writeManifest(manifest);

		return {
			artifactId: input.artifactId,
			versionId: input.versionId,
			path: fileRecord.path,
			contentType: fileRecord.contentType,
			size: fileRecord.size,
			createdAt: fileRecord.createdAt,
		};
	}

	async readArtifactVersionFile(
		_context: DesktopTurnContext,
		artifactId: string,
		versionId: string,
		filePath: string,
	): Promise<ArtifactVersionFileReadResult> {
		const manifest = await this.readArtifactManifest(artifactId);
		if (!manifest) {
			throw new Error(`Artifact does not exist: ${artifactId}`);
		}
		const fileRecord = this.findVersionFile(manifest, versionId, filePath);
		const absolutePath = this.resolveReadableFilePath(manifest, versionId, fileRecord);
		return {
			artifactId,
			versionId,
			path: fileRecord.path,
			contentType: fileRecord.contentType,
			size: fileRecord.size,
			createdAt: fileRecord.createdAt,
			content: await fs.readFile(absolutePath, "utf8"),
		};
	}

	async listArtifactVersionFiles(
		_context: DesktopTurnContext,
		artifactId: string,
		versionId: string,
	): Promise<ArtifactVersionFile[]> {
		const manifest = await this.readArtifactManifest(artifactId);
		if (!manifest) {
			return [];
		}
		const version = manifest.versions.find((item) => item.versionId === versionId);
		if (!version) {
			return [];
		}
		return version.files.map((file) => ({
			artifactId,
			versionId,
			path: file.path,
			contentType: file.contentType,
			size: file.size,
			createdAt: file.createdAt,
		}));
	}

	async createProjectFileArtifactWrapper(
		context: DesktopTurnContext,
		input: ProjectFileArtifactWrapperInput,
	): Promise<StoredArtifactManifest> {
		return this.openProjectFileArtifact(context, input);
	}

	async openProjectFileArtifactWrapper(context: DesktopTurnContext, artifactId: string): Promise<StoredArtifactManifest> {
		return this.openArtifact(context, artifactId);
	}

	private async listAllArtifacts(): Promise<StoredArtifactManifest[]> {
		let entries: string[] = [];
		try {
			entries = await fs.readdir(this.artifactsRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}

		const manifests: StoredArtifactManifest[] = [];
		for (const entry of entries.sort()) {
			const manifest = await this.readManifestFromPath(path.join(this.artifactsRoot, entry, "artifact.json"), entry);
			if (manifest) {
				manifests.push(manifest);
			}
		}
		return manifests;
	}

	private async readManifestFromPath(filePath: string, storageSegment: string): Promise<StoredArtifactManifest | null> {
		try {
			return this.parsePersistedManifest(JSON.parse(await fs.readFile(filePath, "utf8")), {
				storageSegment,
			});
		} catch (error) {
			if ((isNodeError(error) && error.code === "ENOENT") || error instanceof SyntaxError) {
				return null;
			}
			throw error;
		}
	}

	private async writeManagedVersionFile(
		artifactId: string,
		versionId: string,
		file: GeneratedArtifactFileInput,
		createdAt: string,
	): Promise<StoredArtifactFileRecord> {
		const absolutePath = this.resolveManagedVersionFilePath(artifactId, versionId, file.path);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, file.content, "utf8");
		const stat = await fs.stat(absolutePath);
		const managedPath = toPortablePath(path.relative(this.projectRoot, absolutePath));
		const record: StoredArtifactFileRecord = {
			path: toPortablePath(file.path),
			managedPath,
			size: stat.size,
			createdAt,
		};
		const contentType = file.contentType ?? inferContentType(file.path);
		if (contentType) {
			record.contentType = contentType;
		}
		if (file.metadata) {
			record.metadata = deepClone(file.metadata);
		}
		return record;
	}

	private async writeManifest(manifest: StoredArtifactManifest): Promise<void> {
		await atomicWriteJson(this.resolveManifestPath(manifest.id), manifest);
	}

	private normalizeManifest(value: unknown): StoredArtifactManifest {
		const record = isRecord(value) ? value : {};
		const now = this.now();
		const artifactId = asString(record.artifactId) ?? asString(record.id) ?? this.idFactory();
		const createdAt = asString(record.createdAt) ?? now;
		const versions = normalizeVersions(record.versions);
		const currentVersionId = asString(record.currentVersionId) ?? versions.at(-1)?.versionId;
		return {
			schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
			id: artifactId,
			artifactId,
			projectId: asString(record.projectId) ?? "desktop-project",
			conversationId: asString(record.conversationId) ?? "conversation",
			createdTurnId: asString(record.createdTurnId) ?? asString(record.updatedTurnId) ?? "turn",
			updatedTurnId: asString(record.updatedTurnId) ?? asString(record.createdTurnId) ?? "turn",
			artifactType: asString(record.artifactType) ?? "file",
			title: asString(record.title),
			renderable: Boolean(record.renderable),
			currentVersionId,
			storageMode: normalizeStorageMode(record.storageMode),
			source: isRecord(record.source) ? deepClone(record.source) : {},
			versions,
			createdAt,
			updatedAt: asString(record.updatedAt) ?? createdAt,
			metadata: isRecord(record.metadata) ? deepClone(record.metadata) : {},
		};
	}

	private parsePersistedManifest(
		value: unknown,
		options: { expectedArtifactId?: string; storageSegment?: string } = {},
	): StoredArtifactManifest | null {
		if (!isRecord(value)) {
			return null;
		}
		if (value.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
			return null;
		}
		const id = asString(value.id);
		const artifactId = asString(value.artifactId);
		if (!id || !artifactId || id !== artifactId) {
			return null;
		}
		if (options.expectedArtifactId && id !== options.expectedArtifactId) {
			return null;
		}
		if (options.storageSegment && encodeStatePathSegment(id) !== options.storageSegment) {
			return null;
		}

		const projectId = asString(value.projectId);
		const conversationId = asString(value.conversationId);
		const createdTurnId = asString(value.createdTurnId);
		const updatedTurnId = asString(value.updatedTurnId);
		const artifactType = asString(value.artifactType);
		const storageMode = parseStorageMode(value.storageMode);
		const createdAt = asString(value.createdAt);
		const updatedAt = asString(value.updatedAt);
		if (
			!projectId ||
			!conversationId ||
			!createdTurnId ||
			!updatedTurnId ||
			!artifactType ||
			!storageMode ||
			typeof value.renderable !== "boolean" ||
			!createdAt ||
			!updatedAt ||
			!isRecord(value.source) ||
			!Array.isArray(value.versions) ||
			!isRecord(value.metadata)
		) {
			return null;
		}

		const versions = normalizeVersions(value.versions);
		if (versions.length !== value.versions.length) {
			return null;
		}
		const currentVersionId = asString(value.currentVersionId);
		if (currentVersionId && !versions.some((version) => version.versionId === currentVersionId)) {
			return null;
		}

		return {
			schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
			id,
			artifactId,
			projectId,
			conversationId,
			createdTurnId,
			updatedTurnId,
			artifactType,
			title: asString(value.title),
			renderable: Boolean(value.renderable),
			currentVersionId,
			storageMode,
			source: deepClone(value.source),
			versions,
			createdAt,
			updatedAt,
			metadata: deepClone(value.metadata),
		};
	}

	private resolveManifestPath(artifactId: string): string {
		return path.join(this.resolveArtifactRoot(artifactId), "artifact.json");
	}

	private resolveArtifactRoot(artifactId: string): string {
		return path.join(this.artifactsRoot, encodeStatePathSegment(artifactId));
	}

	private resolveManagedVersionFilePath(artifactId: string, versionId: string, filePath: string): string {
		const versionRoot = this.resolveManagedVersionRoot(artifactId, versionId);
		const absolutePath = path.resolve(versionRoot, toPlatformPath(filePath));
		if (!isPathInside(versionRoot, absolutePath)) {
			throw new Error(`Artifact version file path escapes version root: ${filePath}`);
		}
		return absolutePath;
	}

	private resolveManagedVersionRoot(artifactId: string, versionId: string): string {
		return path.join(this.resolveArtifactRoot(artifactId), "files", encodeStatePathSegment(versionId));
	}

	private resolveProjectRelativePath(projectFilePath: string): string {
		const absolutePath = path.isAbsolute(projectFilePath)
			? path.resolve(projectFilePath)
			: path.resolve(this.projectRoot, projectFilePath);
		if (!isPathInside(this.projectRoot, absolutePath)) {
			throw new Error(`Project file path escapes project root: ${projectFilePath}`);
		}
		return toPortablePath(path.relative(this.projectRoot, absolutePath));
	}

	private resolveReadableFilePath(
		manifest: StoredArtifactManifest,
		versionId: string,
		fileRecord: StoredArtifactFileRecord,
	): string {
		if (manifest.storageMode === "project_file_reference") {
			if (!fileRecord.projectRelativePath) {
				throw new Error(`Invalid project file path for artifact: ${manifest.id}`);
			}
			return this.resolveProjectFileReferencePath(fileRecord.projectRelativePath);
		}

		if (fileRecord.projectRelativePath) {
			throw new Error(`Invalid managed artifact path metadata: ${manifest.id}`);
		}
		const derivedPath = this.resolveManagedVersionFilePath(manifest.id, versionId, fileRecord.path);
		if (fileRecord.managedPath) {
			this.assertManagedPathMatchesVersionRoot(manifest.id, versionId, fileRecord.managedPath, derivedPath);
		}
		return derivedPath;
	}

	private resolveProjectFileReferencePath(projectRelativePath: string): string {
		const absolutePath = path.resolve(this.projectRoot, toPlatformPath(projectRelativePath));
		if (!isPathInside(this.projectRoot, absolutePath)) {
			throw new Error(`Project file path escapes project root: ${projectRelativePath}`);
		}
		return absolutePath;
	}

	private assertManagedPathMatchesVersionRoot(
		artifactId: string,
		versionId: string,
		managedPath: string,
		derivedPath: string,
	): void {
		const versionRoot = this.resolveManagedVersionRoot(artifactId, versionId);
		const storedPath = path.resolve(this.projectRoot, toPlatformPath(managedPath));
		if (!isPathInside(versionRoot, storedPath)) {
			throw new Error(`Stored artifact path escapes version root: ${managedPath}`);
		}
		if (path.resolve(storedPath) !== path.resolve(derivedPath)) {
			throw new Error(`Stored artifact path does not match version file path: ${managedPath}`);
		}
	}

	private findVersionFile(manifest: StoredArtifactManifest, versionId: string, filePath: string): StoredArtifactFileRecord {
		const version = manifest.versions.find((item) => item.versionId === versionId);
		const portablePath = toPortablePath(filePath);
		const fileRecord = version?.files.find((file) => file.path === portablePath || file.projectRelativePath === portablePath);
		if (!fileRecord) {
			throw new Error(`Artifact version file does not exist: ${manifest.id}/${versionId}/${filePath}`);
		}
		return fileRecord;
	}

	private now(): string {
		return this.clock().toISOString();
	}
}

function normalizeVersions(value: unknown): ArtifactVersionRecord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const versions: ArtifactVersionRecord[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const versionId = asString(item.versionId);
		const createdTurnId = asString(item.createdTurnId);
		const createdAt = asString(item.createdAt);
		if (!versionId || !createdTurnId || !createdAt) {
			continue;
		}
		versions.push({
			versionId,
			createdTurnId,
			createdAt,
			files: normalizeVersionFiles(item.files),
			...(isRecord(item.metadata) ? { metadata: deepClone(item.metadata) } : {}),
		} as ArtifactVersionRecord);
	}
	return versions;
}

function normalizeVersionFiles(value: unknown): StoredArtifactFileRecord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const files: StoredArtifactFileRecord[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const filePath = asString(item.path);
		if (!filePath) {
			continue;
		}
		const fileRecord: StoredArtifactFileRecord = {
			path: toPortablePath(filePath),
		};
		const managedPath = asString(item.managedPath);
		const projectRelativePath = asString(item.projectRelativePath);
		const contentType = asString(item.contentType);
		const createdAt = asString(item.createdAt);
		if (managedPath) {
			fileRecord.managedPath = managedPath;
		}
		if (projectRelativePath) {
			fileRecord.projectRelativePath = projectRelativePath;
		}
		if (contentType) {
			fileRecord.contentType = contentType;
		}
		if (typeof item.size === "number") {
			fileRecord.size = item.size;
		}
		if (createdAt) {
			fileRecord.createdAt = createdAt;
		}
		if (isRecord(item.metadata)) {
			fileRecord.metadata = deepClone(item.metadata);
		}
		files.push(fileRecord);
	}
	return files;
}

function mergeVersionFiles(existing: StoredArtifactFileRecord[], updates: StoredArtifactFileRecord[]): StoredArtifactFileRecord[] {
	const next = [...existing];
	for (const update of updates) {
		const index = next.findIndex((file) => file.path === update.path);
		if (index >= 0) {
			next[index] = update;
		} else {
			next.push(update);
		}
	}
	return next;
}

function normalizeStorageMode(value: unknown): ArtifactStorageMode {
	return value === "project_file_reference" ? "project_file_reference" : "managed_file";
}

function parseStorageMode(value: unknown): ArtifactStorageMode | null {
	if (value === "managed_file" || value === "project_file_reference") {
		return value;
	}
	return null;
}

function inferContentType(filePath: string): string | undefined {
	const extension = path.extname(filePath).toLowerCase();
	const contentTypes: Record<string, string> = {
		".css": "text/css",
		".csv": "text/csv",
		".html": "text/html",
		".htm": "text/html",
		".json": "application/json",
		".md": "text/markdown",
		".svg": "image/svg+xml",
		".txt": "text/plain",
	};
	return contentTypes[extension];
}

function createArtifactId(): string {
	return `artifact-${randomUUID()}`;
}

function createArtifactVersionId(): string {
	return `version-${randomUUID()}`;
}

function toPortablePath(filePath: string): string {
	return filePath.split(/[\\/]+/u).filter(Boolean).join("/");
}

function toPlatformPath(filePath: string): string {
	return toPortablePath(filePath).split("/").join(path.sep);
}

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
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
