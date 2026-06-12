import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { ExternalImportSnapshot, FileSystemHostPort } from "../contracts/FileSystemHostPort";
import type {
	ProjectContextItem,
	ProjectFileTreeEntry,
	ProjectLibraryHostPort,
} from "../contracts/ProjectLibraryHostPort";
import { ImportStore } from "./ImportStore";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { ProjectFileTreeReader, type ProjectFileTreeReaderOptions } from "./ProjectFileTreeReader";

export const PROJECT_CONTEXT_REGISTRY_SCHEMA_VERSION = 1;
export const PROJECT_LIBRARY_VIEW_SCHEMA_VERSION = 1;

export interface ProjectContextRegistry {
	schemaVersion: typeof PROJECT_CONTEXT_REGISTRY_SCHEMA_VERSION;
	items: ProjectContextItem[];
}

export interface RegisterProjectFileInput {
	path: string;
	title?: string;
	description?: string;
	enabled?: boolean;
	metadata?: Record<string, unknown>;
}

export interface PendingExternalContextItem {
	snapshot: ExternalImportSnapshot;
	pendingItem: ProjectContextItem;
}

export interface ProjectLibraryView {
	schemaVersion: typeof PROJECT_LIBRARY_VIEW_SCHEMA_VERSION;
	fileTree: ProjectFileTreeEntry[];
	registeredItems: ProjectContextItem[];
}

export interface ProjectLibraryStoreOptions extends ProjectFileTreeReaderOptions {
	clock?: () => Date;
	idFactory?: () => string;
	fileSystemHost?: Pick<FileSystemHostPort, "importExternalFileSnapshot">;
	fileTreeReader?: ProjectFileTreeReader;
}

type ProjectContextItemInput = Omit<Partial<ProjectContextItem>, "path"> & Pick<ProjectContextItem, "path">;

export class ProjectLibraryStore implements ProjectLibraryHostPort {
	readonly projectRoot: string;
	readonly registryPath: string;

	private readonly clock: () => Date;
	private readonly idFactory: () => string;
	private readonly fileSystemHost?: Pick<FileSystemHostPort, "importExternalFileSnapshot">;
	private readonly fileTreeReader: ProjectFileTreeReader;

	constructor(projectRoot: string, options: ProjectLibraryStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.registryPath = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "context", "registry.json");
		this.clock = options.clock ?? (() => new Date());
		this.idFactory = options.idFactory ?? (() => `context-${randomUUID()}`);
		this.fileSystemHost = options.fileSystemHost;
		this.fileTreeReader = options.fileTreeReader ?? new ProjectFileTreeReader(this.projectRoot, {
			ignoredEntries: options.ignoredEntries,
		});
	}

	async registerContextItem(context: DesktopTurnContext, item: ProjectContextItemInput): Promise<ProjectContextItem> {
		this.assertContextProjectRoot(context);
		const resolvedPath = await this.resolveExistingProjectFilePath(item.path);
		const registry = await this.readRegistry();
		const now = this.clock().toISOString();
		const incomingId = normalizeContextId(item.id);
		const existingPathIndex = registry.items.findIndex((existingItem) => existingItem.path === resolvedPath.relativePath);
		const existingIdIndex = incomingId
			? registry.items.findIndex((existingItem) => existingItem.id === incomingId)
			: -1;
		const existingIndex = resolveRegistrationIndex(registry.items, {
			pathIndex: existingPathIndex,
			idIndex: existingIdIndex,
			incomingId,
			path: resolvedPath.relativePath,
		});
		const existing = existingIndex >= 0 ? registry.items[existingIndex] : null;
		const registered: ProjectContextItem = normalizeContextItem({
			...existing,
			...item,
			id: existing?.id ?? incomingId ?? this.idFactory(),
			path: resolvedPath.relativePath,
			title: item.title ?? existing?.title ?? path.basename(resolvedPath.relativePath),
			enabled: item.enabled ?? existing?.enabled ?? true,
			metadata: buildSystemMetadata({
				existing: existing?.metadata,
				incoming: item.metadata,
				sourceType: inferSourceType(resolvedPath.relativePath),
				now,
			}),
		});

		if (existingIndex >= 0) {
			registry.items[existingIndex] = registered;
		} else {
			registry.items.push(registered);
		}
		await this.writeRegistry(registry);
		return registered;
	}

	async registerProjectFile(context: DesktopTurnContext, input: RegisterProjectFileInput): Promise<ProjectContextItem> {
		const resolvedPath = await this.resolveExistingProjectFilePath(input.path);
		return this.registerContextItem(context, {
			path: resolvedPath.relativePath,
			title: input.title ?? path.basename(resolvedPath.relativePath),
			description: input.description,
			enabled: input.enabled ?? true,
			metadata: input.metadata,
		});
	}

	async listContextItems(_projectId: string): Promise<ProjectContextItem[]> {
		return (await this.readRegistry()).items;
	}

	async updateContextItem(context: DesktopTurnContext, item: ProjectContextItem): Promise<ProjectContextItem> {
		this.assertContextProjectRoot(context);
		const resolvedPath = await this.resolveExistingProjectFilePath(item.path);
		const registry = await this.readRegistry();
		const incomingId = normalizeContextId(item.id);
		if (!incomingId) {
			throw new Error("Project context item id is required for update.");
		}
		const existingIndex = registry.items.findIndex((existingItem) => existingItem.id === incomingId);
		if (existingIndex < 0) {
			throw new Error(`Project context item not found: ${incomingId}`);
		}

		const existing = registry.items[existingIndex];
		if (!existing) {
			throw new Error(`Project context item not found: ${incomingId}`);
		}
		const duplicatePathIndex = registry.items.findIndex((existingItem) => existingItem.path === resolvedPath.relativePath);
		if (duplicatePathIndex >= 0 && duplicatePathIndex !== existingIndex) {
			throw new Error(`Project context path is already registered by a different item: ${resolvedPath.relativePath}`);
		}
		const now = this.clock().toISOString();
		const updated = normalizeContextItem({
			...existing,
			...item,
			id: existing.id,
			path: resolvedPath.relativePath,
			title: item.title ?? existing.title ?? path.basename(resolvedPath.relativePath),
			enabled: item.enabled,
			metadata: buildSystemMetadata({
				existing: existing.metadata,
				incoming: item.metadata,
				sourceType: inferSourceType(resolvedPath.relativePath),
				now,
			}),
		});

		registry.items[existingIndex] = updated;
		await this.writeRegistry(registry);
		return updated;
	}

	async readProjectFileTree(_projectId: string): Promise<ProjectFileTreeEntry[]> {
		return this.fileTreeReader.read({
			contextItems: await this.listContextItems(_projectId),
		});
	}

	async prepareExternalImport(context: DesktopTurnContext, sourcePath: string): Promise<PendingExternalContextItem> {
		this.assertContextProjectRoot(context);
		const snapshot = await this.importExternalFile(context, sourcePath);
		const now = this.clock().toISOString();
		const title = asString((snapshot as { originalFileName?: unknown }).originalFileName) ?? path.basename(snapshot.sourcePath);
		return {
			snapshot,
			pendingItem: {
				id: `context-${snapshot.importId}`,
				path: snapshot.managedPath,
				title,
				enabled: true,
				metadata: {
					sourceType: "external_import",
					importId: snapshot.importId,
					sourcePath: snapshot.sourcePath,
					managedPath: snapshot.managedPath,
					hash: snapshot.hash,
					mimeType: snapshot.mimeType,
					summary: { status: "pending" },
					createdAt: now,
					updatedAt: now,
				},
			},
		};
	}

	async readLibraryView(projectId: string): Promise<ProjectLibraryView> {
		return {
			schemaVersion: PROJECT_LIBRARY_VIEW_SCHEMA_VERSION,
			fileTree: await this.readProjectFileTree(projectId),
			registeredItems: await this.listContextItems(projectId),
		};
	}

	private async readRegistry(): Promise<ProjectContextRegistry> {
		try {
			const raw = await fs.readFile(this.registryPath, "utf8");
			return normalizeRegistry(JSON.parse(raw));
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return {
					schemaVersion: PROJECT_CONTEXT_REGISTRY_SCHEMA_VERSION,
					items: [],
				};
			}
			throw error;
		}
	}

	private async writeRegistry(registry: ProjectContextRegistry): Promise<void> {
		const normalizedRegistry = normalizeRegistry(registry);
		assertUniqueRegistryItems(normalizedRegistry.items);
		await atomicWriteJson(this.registryPath, normalizedRegistry);
	}

	private async resolveExistingProjectFilePath(candidatePath: string): Promise<{ absolutePath: string; relativePath: string }> {
		const relativePath = normalizeProjectRelativePath(candidatePath);
		const absolutePath = path.resolve(this.projectRoot, relativePath);
		assertPathInside(this.projectRoot, absolutePath, `Project context path escape outside project root: ${candidatePath}`);

		let realProjectRoot: string;
		let realFilePath: string;
		try {
			realProjectRoot = await fs.realpath(this.projectRoot);
			realFilePath = await fs.realpath(absolutePath);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				throw new Error(`Project context file must exist: ${candidatePath}`);
			}
			throw error;
		}
		assertPathInside(realProjectRoot, realFilePath, `Project context path resolves outside project root through a symlink: ${candidatePath}`);

		const stat = await fs.stat(realFilePath);
		if (!stat.isFile()) {
			throw new Error(`Project context path must be a file: ${candidatePath}`);
		}

		return {
			absolutePath,
			relativePath: toPortablePath(path.relative(this.projectRoot, absolutePath)),
		};
	}

	private async importExternalFile(context: DesktopTurnContext, sourcePath: string): Promise<ExternalImportSnapshot> {
		if (this.fileSystemHost) {
			return this.fileSystemHost.importExternalFileSnapshot(context, sourcePath);
		}
		return new ImportStore(this.projectRoot).importExternalFile(context, sourcePath);
	}

	private assertContextProjectRoot(context: DesktopTurnContext): void {
		if (path.resolve(context.projectRoot) !== this.projectRoot) {
			throw new Error(`Desktop turn context project root does not match ProjectLibraryStore root: ${context.projectRoot}`);
		}
	}
}

function normalizeRegistry(value: unknown): ProjectContextRegistry {
	const record = isRecord(value) ? value : {};
	const items = Array.isArray(record.items)
		? record.items.map(normalizeMaybeContextItem).filter((item): item is ProjectContextItem => Boolean(item))
		: [];
	return {
		schemaVersion: PROJECT_CONTEXT_REGISTRY_SCHEMA_VERSION,
		items,
	};
}

function normalizeMaybeContextItem(value: unknown): ProjectContextItem | null {
	if (!isRecord(value)) {
		return null;
	}
	const id = normalizeContextId(value.id);
	const itemPath = asString(value.path);
	if (!id || !itemPath) {
		return null;
	}
	return normalizeContextItem({
		id,
		path: toPortablePath(itemPath),
		title: asString(value.title),
		description: asString(value.description),
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		metadata: isRecord(value.metadata) ? value.metadata : undefined,
	});
}

function normalizeContextItem(item: ProjectContextItem): ProjectContextItem {
	const id = normalizeContextId(item.id);
	if (!id) {
		throw new Error("Project context item id is required.");
	}
	const normalized: ProjectContextItem = {
		id,
		path: toPortablePath(item.path),
		enabled: item.enabled,
	};
	if (item.title) {
		normalized.title = item.title;
	}
	if (item.description) {
		normalized.description = item.description;
	}
	if (item.metadata) {
		normalized.metadata = { ...item.metadata };
	}
	return normalized;
}

function normalizeProjectRelativePath(candidatePath: string): string {
	if (path.isAbsolute(candidatePath)) {
		throw new Error(`Expected a relative project path: ${candidatePath}`);
	}
	const normalized = toPortablePath(candidatePath.trim()).replace(/^\/+/u, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Project context path escape outside project root: ${candidatePath}`);
	}
	return normalized;
}

function buildSystemMetadata(input: {
	existing?: Record<string, unknown>;
	incoming?: Record<string, unknown>;
	sourceType: string;
	now: string;
}): Record<string, unknown> {
	const existingExtra = stripProtectedMetadata(input.existing);
	const incomingExtra = stripProtectedMetadata(input.incoming);
	const createdAt = asString(input.existing?.createdAt) ?? input.now;
	const summary = isRecord(input.existing?.summary)
		? { ...input.existing.summary }
		: { status: "pending" };
	return {
		...existingExtra,
		...incomingExtra,
		sourceType: input.sourceType,
		summary,
		createdAt,
		updatedAt: input.now,
	};
}

function stripProtectedMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value ?? {})) {
		if (key === "sourceType" || key === "createdAt" || key === "updatedAt" || key === "summary") {
			continue;
		}
		result[key] = entry;
	}
	return result;
}

function resolveRegistrationIndex(
	items: ProjectContextItem[],
	input: {
		pathIndex: number;
		idIndex: number;
		incomingId?: string;
		path: string;
	},
): number {
	if (input.pathIndex >= 0) {
		const existing = items[input.pathIndex];
		if (input.incomingId && existing && existing.id !== input.incomingId) {
			throw new Error(`Project context path is already registered with a different id: ${input.path}`);
		}
		return input.pathIndex;
	}
	if (input.idIndex >= 0) {
		throw new Error(`Project context id is already registered with a different path: ${input.incomingId}`);
	}
	return -1;
}

function assertUniqueRegistryItems(items: ProjectContextItem[]): void {
	const seenIds = new Map<string, string>();
	const seenPaths = new Map<string, string>();
	for (const item of items) {
		const id = normalizeContextId(item.id);
		const itemPath = toPortablePath(item.path);
		if (!id) {
			throw new Error("Project context item id is required.");
		}
		const existingPathForId = seenIds.get(id);
		if (existingPathForId && existingPathForId !== itemPath) {
			throw new Error(`Project context registry contains duplicate id: ${id}`);
		}
		const existingIdForPath = seenPaths.get(itemPath);
		if (existingIdForPath && existingIdForPath !== id) {
			throw new Error(`Project context registry contains duplicate path: ${itemPath}`);
		}
		seenIds.set(id, itemPath);
		seenPaths.set(itemPath, id);
	}
}

function inferSourceType(relativePath: string): string {
	return relativePath.startsWith(`${FRIDAY_DIRECTORY_NAME}/imports/`) ? "external_import" : "project_file";
}

function assertPathInside(root: string, candidatePath: string, message: string): void {
	if (isPathInside(root, candidatePath)) {
		return;
	}
	throw new Error(message);
}

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function toPortablePath(value: string): string {
	return value.split(path.sep).join("/").replace(/\\/gu, "/");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeContextId(value: unknown): string | undefined {
	return asString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
