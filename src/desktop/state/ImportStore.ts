import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { ExternalImportSnapshot } from "../contracts/FileSystemHostPort";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export const IMPORT_METADATA_SCHEMA_VERSION = 1;

export interface ImportMetadata extends ExternalImportSnapshot {
	schemaVersion: typeof IMPORT_METADATA_SCHEMA_VERSION;
	importId: string;
	originalFileName: string;
	createdAt: string;
}

export interface ImportStoreOptions {
	clock?: () => Date;
}

export class ImportStore {
	readonly projectRoot: string;
	readonly importsRoot: string;
	readonly archiveConversationsRoot: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: ImportStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.importsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "imports");
		this.archiveConversationsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "archive", "conversations");
		this.clock = options.clock ?? (() => new Date());
	}

	async importExternalFile(context: DesktopTurnContext, sourcePath: string): Promise<ImportMetadata> {
		const resolvedSourcePath = path.resolve(sourcePath);
		const sourceStat = await fs.stat(resolvedSourcePath);
		if (!sourceStat.isFile()) {
			throw new Error(`External import source must be a file: ${sourcePath}`);
		}
		const realProjectRoot = await fs.realpath(this.projectRoot);
		const realSourcePath = await fs.realpath(resolvedSourcePath);
		if (isPathInside(realProjectRoot, realSourcePath)) {
			throw new Error(`Project files are direct sources and should not be imported: ${sourcePath}`);
		}

		const sourceBuffer = await fs.readFile(resolvedSourcePath);
		const importId = this.createImportId();
		const conversationSegment = safePathSegment(context.conversationId);
		const importDirectory = path.join(this.importsRoot, conversationSegment, importId);
		const originalFileName = path.basename(resolvedSourcePath);
		const targetPath = path.join(importDirectory, originalFileName);
		const managedPath = toPortablePath(path.relative(this.projectRoot, targetPath));
		const metadata: ImportMetadata = {
			schemaVersion: IMPORT_METADATA_SCHEMA_VERSION,
			importId,
			sourcePath: resolvedSourcePath,
			managedPath,
			originalFileName,
			hash: sha256(sourceBuffer),
			mimeType: inferMimeType(originalFileName),
			createdTurnId: context.turnId,
			createdAt: this.clock().toISOString(),
		};

		await fs.mkdir(importDirectory, { recursive: true });
		await fs.copyFile(resolvedSourcePath, targetPath);
		await atomicWriteJson(path.join(importDirectory, "import.json"), metadata);
		return metadata;
	}

	async archiveConversationImports(conversationId: string): Promise<string> {
		const conversationSegment = safePathSegment(conversationId);
		const sourceDirectory = path.join(this.importsRoot, conversationSegment);
		const archiveDirectory = path.join(this.archiveConversationsRoot, conversationSegment, "imports");

		if (!await pathExists(sourceDirectory)) {
			return archiveDirectory;
		}

		await fs.mkdir(path.dirname(archiveDirectory), { recursive: true });
		await fs.rename(sourceDirectory, archiveDirectory);
		return archiveDirectory;
	}

	private createImportId(): string {
		return `import-${randomUUID()}`;
	}
}

function sha256(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

function inferMimeType(fileName: string): string | undefined {
	const extension = path.extname(fileName).toLowerCase();
	const mimeTypes: Record<string, string> = {
		".css": "text/css",
		".csv": "text/csv",
		".gif": "image/gif",
		".htm": "text/html",
		".html": "text/html",
		".jpeg": "image/jpeg",
		".jpg": "image/jpeg",
		".json": "application/json",
		".md": "text/markdown",
		".pdf": "application/pdf",
		".png": "image/png",
		".svg": "image/svg+xml",
		".txt": "text/plain",
		".webp": "image/webp",
		".yaml": "application/yaml",
		".yml": "application/yaml",
	};
	return mimeTypes[extension];
}

function safePathSegment(value: string): string {
	const segment = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	if (!segment || segment === "." || segment === "..") {
		return "default";
	}
	return segment;
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

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function toPortablePath(relativePath: string): string {
	return relativePath.split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
