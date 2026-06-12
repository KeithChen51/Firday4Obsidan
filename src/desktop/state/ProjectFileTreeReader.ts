import { promises as fs } from "fs";
import path from "path";
import type { ProjectContextItem, ProjectFileTreeEntry } from "../contracts/ProjectLibraryHostPort";
import { FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export interface ProjectFileTreeReaderOptions {
	ignoredEntries?: string[];
}

export interface ReadProjectFileTreeOptions {
	contextItems?: ProjectContextItem[];
}

const DEFAULT_IGNORED_ENTRIES = [
	".git",
	"node_modules",
	FRIDAY_DIRECTORY_NAME,
	`${FRIDAY_DIRECTORY_NAME}/local`,
	`${FRIDAY_DIRECTORY_NAME}/runtime`,
] as const;

export class ProjectFileTreeReader {
	readonly projectRoot: string;

	private readonly ignoredEntries: string[];

	constructor(projectRoot: string, options: ProjectFileTreeReaderOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.ignoredEntries = [
			...DEFAULT_IGNORED_ENTRIES,
			...(options.ignoredEntries ?? []),
		].map(normalizeIgnoredEntry).filter(Boolean);
	}

	async read(options: ReadProjectFileTreeOptions = {}): Promise<ProjectFileTreeEntry[]> {
		const contextItemByPath = buildContextItemMap(options.contextItems ?? []);
		const realProjectRoot = await fs.realpath(this.projectRoot);
		return this.readDirectory(this.projectRoot, "", realProjectRoot, contextItemByPath);
	}

	private async readDirectory(
		absoluteDirectoryPath: string,
		relativeDirectoryPath: string,
		realProjectRoot: string,
		contextItemByPath: Map<string, string>,
	): Promise<ProjectFileTreeEntry[]> {
		const directoryEntries = await fs.readdir(absoluteDirectoryPath, { withFileTypes: true });
		const entries: ProjectFileTreeEntry[] = [];

		for (const directoryEntry of directoryEntries) {
			const entryRelativePath = toPortablePath(path.join(relativeDirectoryPath, directoryEntry.name));
			if (this.shouldIgnore(entryRelativePath, directoryEntry.name)) {
				continue;
			}

			const absoluteEntryPath = path.join(absoluteDirectoryPath, directoryEntry.name);
			const resolved = await resolveSafeEntry(absoluteEntryPath, realProjectRoot);
			if (!resolved || resolved.type === "other") {
				continue;
			}
			if (resolved.type === "directory" && resolved.isSymlink) {
				continue;
			}

			const treeEntry: ProjectFileTreeEntry = {
				path: entryRelativePath,
				name: directoryEntry.name,
				type: resolved.type,
			};
			const contextItemId = contextItemByPath.get(entryRelativePath);
			if (contextItemId) {
				treeEntry.contextItemId = contextItemId;
			}

			if (resolved.type === "directory") {
				treeEntry.children = await this.readDirectory(
					absoluteEntryPath,
					entryRelativePath,
					realProjectRoot,
					contextItemByPath,
				);
			}

			entries.push(treeEntry);
		}

		return entries.sort(compareTreeEntries);
	}

	private shouldIgnore(relativePath: string, name: string): boolean {
		return this.ignoredEntries.some((ignoredEntry) => {
			if (ignoredEntry === name || ignoredEntry === relativePath) {
				return true;
			}
			return relativePath.startsWith(`${ignoredEntry}/`);
		});
	}
}

interface ResolvedEntry {
	type: "file" | "directory" | "other";
	isSymlink: boolean;
}

async function resolveSafeEntry(absoluteEntryPath: string, realProjectRoot: string): Promise<ResolvedEntry | null> {
	let linkStat;
	try {
		linkStat = await fs.lstat(absoluteEntryPath);
	} catch (error) {
		if (isSkippableSymlinkError(error)) {
			return null;
		}
		throw error;
	}
	const isSymlink = linkStat.isSymbolicLink();
	if (isSymlink) {
		let realEntryPath: string;
		try {
			realEntryPath = await fs.realpath(absoluteEntryPath);
		} catch (error) {
			if (isSkippableSymlinkError(error)) {
				return null;
			}
			throw error;
		}
		if (!isPathInside(realProjectRoot, realEntryPath)) {
			return null;
		}
		let targetStat;
		try {
			targetStat = await fs.stat(realEntryPath);
		} catch (error) {
			if (isSkippableSymlinkError(error)) {
				return null;
			}
			throw error;
		}
		return {
			type: resolveEntryType(targetStat),
			isSymlink: true,
		};
	}
	return {
		type: resolveEntryType(linkStat),
		isSymlink: false,
	};
}

function resolveEntryType(stat: { isDirectory(): boolean; isFile(): boolean }): ResolvedEntry["type"] {
	if (stat.isDirectory()) {
		return "directory";
	}
	if (stat.isFile()) {
		return "file";
	}
	return "other";
}

function compareTreeEntries(a: ProjectFileTreeEntry, b: ProjectFileTreeEntry): number {
	if (a.type !== b.type) {
		return a.type === "directory" ? -1 : 1;
	}
	return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

function buildContextItemMap(contextItems: ProjectContextItem[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const item of contextItems) {
		const itemPath = toPortablePath(item.path);
		if (item.id && itemPath) {
			map.set(itemPath, item.id);
		}
	}
	return map;
}

function normalizeIgnoredEntry(value: string): string {
	return toPortablePath(value.trim())
		.replace(/^\/+/u, "")
		.replace(/\/+$/u, "");
}

function toPortablePath(value: string): string {
	return value.split(path.sep).join("/").replace(/\\/gu, "/");
}

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isSkippableSymlinkError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ELOOP");
}
