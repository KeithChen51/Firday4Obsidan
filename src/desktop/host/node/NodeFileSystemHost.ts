import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../../contracts/DesktopHostAdapter";
import type {
	ExternalImportSnapshot,
	FileSystemHostPort,
	ManagedFileWriteInput,
	ProjectFileReadResult,
	ProjectFileWriteInput,
} from "../../contracts/FileSystemHostPort";
import { FRIDAY_DIRECTORY_NAME } from "../../state/ProjectManifestStore";
import { ImportStore } from "../../state/ImportStore";

export class NodeFileSystemHost implements FileSystemHostPort {
	async readProjectFile(context: DesktopTurnContext, relativePath: string): Promise<ProjectFileReadResult> {
		const resolvedPath = resolveProjectRelativePath(context.projectRoot, relativePath);
		const realProjectRoot = await fs.realpath(path.resolve(context.projectRoot));
		const realFilePath = await fs.realpath(resolvedPath.absolutePath);
		assertPathInside(realProjectRoot, realFilePath, `Path resolves outside project root: ${relativePath}`);

		const stat = await fs.stat(realFilePath);
		if (!stat.isFile()) {
			throw new Error(`Project path is not a file: ${relativePath}`);
		}

		return {
			path: resolvedPath.relativePath,
			content: await fs.readFile(realFilePath, "utf8"),
			mtime: stat.mtime.toISOString(),
		};
	}

	async writeProjectFile(context: DesktopTurnContext, input: ProjectFileWriteInput): Promise<void> {
		const resolvedPath = resolveProjectRelativePath(context.projectRoot, input.path);
		await assertWritableTargetInsideBoundary(
			resolvedPath.absolutePath,
			path.resolve(context.projectRoot),
			`Path resolves outside project root: ${input.path}`,
		);
		await fs.mkdir(path.dirname(resolvedPath.absolutePath), { recursive: true });
		await fs.writeFile(resolvedPath.absolutePath, input.content, "utf8");
	}

	async importExternalFileSnapshot(context: DesktopTurnContext, sourcePath: string): Promise<ExternalImportSnapshot> {
		return new ImportStore(context.projectRoot).importExternalFile(context, sourcePath);
	}

	async normalizeProjectPath(projectRoot: string, candidatePath: string): Promise<string> {
		const root = path.resolve(projectRoot);
		const resolvedPath = path.isAbsolute(candidatePath)
			? path.resolve(candidatePath)
			: path.resolve(root, candidatePath);
		assertPathInside(root, resolvedPath, `Path is outside project root: ${candidatePath}`);
		await assertWritableTargetInsideBoundary(
			resolvedPath,
			root,
			`Path resolves outside project root: ${candidatePath}`,
		);
		return resolvedPath;
	}

	async writeManagedFile(context: DesktopTurnContext, input: ManagedFileWriteInput): Promise<void> {
		const resolvedPath = resolveFridayManagedPath(context.projectRoot, input.path);
		const fridayRoot = path.join(path.resolve(context.projectRoot), FRIDAY_DIRECTORY_NAME);
		await fs.mkdir(fridayRoot, { recursive: true });
		await assertWritableTargetInsideBoundary(
			resolvedPath,
			fridayRoot,
			`Path resolves outside FRIDAY managed path: ${input.path}`,
		);
		await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
		if (input.atomic === false) {
			await fs.writeFile(resolvedPath, input.content, "utf8");
			return;
		}
		await atomicWriteText(resolvedPath, input.content);
	}
}

interface ResolvedProjectPath {
	absolutePath: string;
	relativePath: string;
}

function resolveProjectRelativePath(projectRoot: string, candidatePath: string): ResolvedProjectPath {
	if (path.isAbsolute(candidatePath)) {
		throw new Error(`Expected a relative project path: ${candidatePath}`);
	}
	if (!candidatePath.trim()) {
		throw new Error("Expected a relative project path.");
	}

	const root = path.resolve(projectRoot);
	const absolutePath = path.resolve(root, candidatePath);
	assertPathInside(root, absolutePath, `Path is outside project root: ${candidatePath}`);
	return {
		absolutePath,
		relativePath: toPortablePath(path.relative(root, absolutePath)),
	};
}

function resolveFridayManagedPath(projectRoot: string, candidatePath: string): string {
	const root = path.resolve(projectRoot);
	const fridayRoot = path.join(root, FRIDAY_DIRECTORY_NAME);
	const absolutePath = path.isAbsolute(candidatePath)
		? path.resolve(candidatePath)
		: path.resolve(root, candidatePath);
	assertPathInside(fridayRoot, absolutePath, `Expected a FRIDAY managed path: ${candidatePath}`);
	return absolutePath;
}

function assertPathInside(root: string, candidatePath: string, message: string): void {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	if (relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
		return;
	}
	throw new Error(message);
}

async function assertWritableTargetInsideBoundary(targetPath: string, boundaryRoot: string, message: string): Promise<void> {
	const realBoundaryRoot = await fs.realpath(path.resolve(boundaryRoot));
	const existingTargetRealPath = await realpathIfExists(targetPath);
	if (existingTargetRealPath) {
		assertPathInside(realBoundaryRoot, existingTargetRealPath, message);
		return;
	}

	const parentPath = await findNearestExistingParent(targetPath, boundaryRoot, message);
	const realParentPath = await fs.realpath(parentPath);
	assertPathInside(realBoundaryRoot, realParentPath, message);
}

async function realpathIfExists(targetPath: string): Promise<string | null> {
	try {
		return await fs.realpath(targetPath);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function findNearestExistingParent(targetPath: string, boundaryRoot: string, message: string): Promise<string> {
	const resolvedBoundaryRoot = path.resolve(boundaryRoot);
	let currentPath = path.dirname(path.resolve(targetPath));
	while (true) {
		assertPathInside(resolvedBoundaryRoot, currentPath, message);
		try {
			const stat = await fs.stat(currentPath);
			if (!stat.isDirectory()) {
				throw new Error(`Writable target parent is not a directory: ${currentPath}`);
			}
			return currentPath;
		} catch (error) {
			if (!(isNodeError(error) && error.code === "ENOENT")) {
				throw error;
			}
			const nextPath = path.dirname(currentPath);
			if (nextPath === currentPath) {
				throw error;
			}
			currentPath = nextPath;
		}
	}
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	await fs.writeFile(tempPath, content, "utf8");
	await fs.rename(tempPath, filePath);
}

function toPortablePath(relativePath: string): string {
	return relativePath.split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
