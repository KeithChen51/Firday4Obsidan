import path from "path";

export type ToolPathIntent =
	| "read_file"
	| "read_directory"
	| "search"
	| "write_file"
	| "edit_file"
	| "delete_path"
	| "external_read"
	| "exec_cwd";

export interface ToolPathResolverOptions {
	activeProjectRoot?: string;
	vaultFiles?: Iterable<string>;
	vaultFolders?: Iterable<string>;
}

export interface ToolPathResolveInput {
	intent: ToolPathIntent;
	path?: string;
}

export interface ToolPathResolution {
	ok: boolean;
	scope: "vault" | "external" | "any";
	inputPath: string;
	normalizedInput: string;
	targetPath: string;
	resolvedPath?: string;
	displayPath: string;
	projectRoot?: string;
	candidates: string[];
	reason?: string;
	code?: string;
	suggestedArgs?: Record<string, unknown>;
}

const PROJECT_SYSTEM_SEGMENTS = new Set(["workspace", "wiki", "memory", ".friday", "raw"]);
const WRITE_INTENTS = new Set<ToolPathIntent>(["write_file", "edit_file", "delete_path"]);
const READ_EXISTING_INTENTS = new Set<ToolPathIntent>(["read_file", "read_directory"]);

export class ToolPathResolver {
	private readonly activeProjectRoot: string;
	private readonly vaultFiles: string[];
	private readonly vaultFolders: string[];

	constructor(options: ToolPathResolverOptions = {}) {
		this.activeProjectRoot = normalizeVaultPath(options.activeProjectRoot ?? "");
		this.vaultFiles = [...(options.vaultFiles ?? [])].map(normalizeVaultPath).filter(Boolean).sort();
		this.vaultFolders = [...(options.vaultFolders ?? [])].map(normalizeVaultPath).filter(Boolean).sort();
	}

	resolve(input: ToolPathResolveInput): ToolPathResolution {
		const inputPath = String(input.path ?? "");
		const normalizedInput = normalizeVaultPath(inputPath);
		const projectRoot = this.activeProjectRoot || undefined;
		if (isAbsolutePath(inputPath)) {
			if (WRITE_INTENTS.has(input.intent)) {
				return this.failed({
					scope: "external",
					inputPath,
					normalizedInput: inputPath,
					targetPath: inputPath,
					code: "external_write_denied",
					reason: `External writes are not supported: ${inputPath}`,
				});
			}
			return this.ok({
				scope: "external",
				inputPath,
				normalizedInput: inputPath,
				targetPath: inputPath,
			});
		}

		if (!normalizedInput && isDiscoveryIntent(input.intent)) {
			const targetPath = normalizeWholeVaultRoot(this.activeProjectRoot);
			return this.ok({
				scope: "vault",
				inputPath,
				normalizedInput,
				targetPath,
				projectRoot,
				candidates: targetPath ? [targetPath] : [],
			});
		}

		const targetPath = this.resolveVaultTargetPath(input.intent, normalizedInput);
		const candidates = this.resolveCandidates(input.intent, normalizedInput, targetPath);

		if (WRITE_INTENTS.has(input.intent) && this.isRawPath(targetPath)) {
			const suggestedPath = this.buildWorkspaceSuggestion(targetPath);
			return this.failed({
				scope: "vault",
				inputPath,
				normalizedInput,
				targetPath,
				projectRoot,
				candidates: suggestedPath ? [suggestedPath] : [],
				code: "project_raw_write_denied",
				reason: `AI-generated file operations are blocked under raw/: ${targetPath}`,
				suggestedArgs: suggestedPath ? { path: suggestedPath } : undefined,
			});
		}

		if (!normalizedInput && !targetPath && !isDiscoveryIntent(input.intent)) {
			return this.failed({
				scope: "vault",
				inputPath,
				normalizedInput,
				targetPath,
				projectRoot,
				code: "empty_path",
				reason: "Path is required.",
			});
		}

		const boundaryFailure = this.resolveProjectBoundaryFailure(
			input.intent,
			inputPath,
			normalizedInput,
			targetPath,
			candidates,
			projectRoot,
		);
		if (boundaryFailure) {
			return boundaryFailure;
		}

		if (isBarePath(normalizedInput) && (READ_EXISTING_INTENTS.has(input.intent) || input.intent === "search")) {
			if (candidates.length === 1) {
				return this.ok({
					scope: "vault",
					inputPath,
					normalizedInput,
					targetPath: candidates[0]!,
					projectRoot,
					candidates,
				});
			}
			if (candidates.length > 1) {
				return this.failed({
					scope: "vault",
					inputPath,
					normalizedInput,
					targetPath: normalizedInput,
					projectRoot,
					candidates,
					code: "ambiguous_bare_filename",
					reason: `File name is ambiguous: ${normalizedInput}`,
					suggestedArgs: { path: candidates[0] },
				});
			}
		}

		if (READ_EXISTING_INTENTS.has(input.intent) && candidates.length === 1) {
			return this.ok({
				scope: "vault",
				inputPath,
				normalizedInput,
				targetPath: candidates[0]!,
				projectRoot,
				candidates,
			});
		}

		const likelyCandidates = targetPath && targetPath !== normalizedInput ? [targetPath] : [];
		return this.ok({
			scope: "vault",
			inputPath,
			normalizedInput,
			targetPath,
			projectRoot,
			candidates: candidates.length > 0 ? candidates : likelyCandidates,
		});
	}

	private resolveVaultTargetPath(intent: ToolPathIntent, normalizedInput: string): string {
		if (!normalizedInput) {
			return isDiscoveryIntent(intent) ? normalizeWholeVaultRoot(this.activeProjectRoot) : "";
		}
		if (!this.activeProjectRoot) {
			return normalizedInput;
		}
		if (isWholeVaultProjectRoot(this.activeProjectRoot)) {
			return this.resolveWholeVaultPath(intent, normalizedInput);
		}
		if (normalizedInput === this.activeProjectRoot || normalizedInput.startsWith(`${this.activeProjectRoot}/`)) {
			return normalizedInput;
		}
		const firstSegment = normalizedInput.split("/")[0] ?? "";
		if (PROJECT_SYSTEM_SEGMENTS.has(firstSegment)) {
			return normalizeVaultPath(`${this.activeProjectRoot}/${normalizedInput}`);
		}
		if (WRITE_INTENTS.has(intent)) {
			return normalizeVaultPath(`${this.activeProjectRoot}/workspace/${normalizedInput}`);
		}
		return normalizedInput;
	}

	private resolveWholeVaultPath(intent: ToolPathIntent, normalizedInput: string): string {
		const firstSegment = normalizedInput.split("/")[0] ?? "";
		if (WRITE_INTENTS.has(intent) && !PROJECT_SYSTEM_SEGMENTS.has(firstSegment)) {
			return normalizeVaultPath(`workspace/${normalizedInput}`);
		}
		return normalizedInput;
	}

	private resolveProjectBoundaryFailure(
		intent: ToolPathIntent,
		inputPath: string,
		normalizedInput: string,
		targetPath: string,
		candidates: string[],
		projectRoot: string | undefined,
	): ToolPathResolution | null {
		if (!this.hasActiveProjectBoundary()) {
			return null;
		}
		if (!normalizedInput && !targetPath) {
			return null;
		}

		const outsideCandidates = this.findOutsideProjectCandidates(intent, normalizedInput, targetPath);
		const boundaryCandidates = candidates.length > 0
			? candidates.filter((candidate) => !isPathWithin(candidate, this.activeProjectRoot))
			: outsideCandidates;
		const targetOutsideProject = Boolean(targetPath) && !isPathWithin(targetPath, this.activeProjectRoot);
		if (WRITE_INTENTS.has(intent) && targetPath && !targetOutsideProject) {
			return null;
		}
		const bareMissingEverywhere = isBarePath(normalizedInput) && boundaryCandidates.length === 0;
		if (!targetOutsideProject && boundaryCandidates.length === 0) {
			return null;
		}
		if (targetOutsideProject && bareMissingEverywhere) {
			return null;
		}

		const targetLabel = targetPath || normalizedInput;
		return this.failed({
			scope: "vault",
			inputPath,
			normalizedInput,
			targetPath,
			projectRoot,
			candidates: boundaryCandidates,
			code: "project_boundary_mismatch",
			reason: `Path is outside the active project boundary: ${targetLabel} (activeProjectRoot=${this.activeProjectRoot}). Switch to the owning project or use a path under ${this.activeProjectRoot}.`,
		});
	}

	private hasActiveProjectBoundary(): boolean {
		return Boolean(this.activeProjectRoot) && !isWholeVaultProjectRoot(this.activeProjectRoot);
	}

	private findOutsideProjectCandidates(intent: ToolPathIntent, normalizedInput: string, targetPath: string): string[] {
		if (!this.hasActiveProjectBoundary()) {
			return [];
		}
		const pools = this.getCandidatePools(intent);
		const inputLower = normalizedInput.toLowerCase();
		const targetLower = targetPath.toLowerCase();
		const suffixLower = inputLower ? `/${inputLower}` : "";
		const matches = pools.filter((item) => {
			if (isPathWithin(item, this.activeProjectRoot)) {
				return false;
			}
			const itemLower = item.toLowerCase();
			if (targetLower && itemLower === targetLower) {
				return true;
			}
			if (inputLower && isBarePath(normalizedInput)) {
				return path.posix.basename(itemLower) === inputLower;
			}
			return Boolean(suffixLower) && itemLower.endsWith(suffixLower);
		});
		return [...new Set(matches)].sort();
	}

	private getCandidatePools(intent: ToolPathIntent): string[] {
		if (intent === "read_directory") {
			return this.vaultFolders;
		}
		if (intent === "search" || intent === "delete_path") {
			return [...this.vaultFiles, ...this.vaultFolders].sort();
		}
		return this.vaultFiles;
	}

	private resolveCandidates(intent: ToolPathIntent, normalizedInput: string, targetPath: string): string[] {
		const paths = intent === "read_directory" ? this.vaultFolders : this.vaultFiles;
		if (!normalizedInput && isDiscoveryIntent(intent)) {
			return targetPath ? [targetPath] : [];
		}
		if (targetPath) {
			const direct = findCaseInsensitive(paths, targetPath) ??
				(intent === "search" ? findCaseInsensitive(this.vaultFolders, targetPath) : undefined);
			if (direct) {
				return [direct];
			}
		}
		if (!isBarePath(normalizedInput)) {
			return [];
		}
		const lower = normalizedInput.toLowerCase();
		const matches = paths.filter((item) => {
			if (this.activeProjectRoot && !isWholeVaultProjectRoot(this.activeProjectRoot) && !isPathWithin(item, this.activeProjectRoot)) {
				return false;
			}
			return path.posix.basename(item).toLowerCase() === lower;
		});
		if (matches.length > 0 || intent !== "search") {
			return matches;
		}
		return this.vaultFolders.filter((item) => {
			if (this.activeProjectRoot && !isWholeVaultProjectRoot(this.activeProjectRoot) && !isPathWithin(item, this.activeProjectRoot)) {
				return false;
			}
			return path.posix.basename(item).toLowerCase() === lower;
		});
	}

	private isRawPath(targetPath: string): boolean {
		if (!targetPath) {
			return false;
		}
		if (isWholeVaultProjectRoot(this.activeProjectRoot)) {
			return targetPath === "raw" || targetPath.startsWith("raw/");
		}
		if (!this.activeProjectRoot) {
			return targetPath === "raw" || targetPath.startsWith("raw/");
		}
		const rawRoot = normalizeVaultPath(`${this.activeProjectRoot}/raw`);
		return targetPath === rawRoot || targetPath.startsWith(`${rawRoot}/`);
	}

	private buildWorkspaceSuggestion(targetPath: string): string {
		const rawPrefix = isWholeVaultProjectRoot(this.activeProjectRoot)
			? "raw"
			: normalizeVaultPath(`${this.activeProjectRoot}/raw`);
		const workspacePrefix = isWholeVaultProjectRoot(this.activeProjectRoot)
			? "workspace"
			: normalizeVaultPath(`${this.activeProjectRoot}/workspace`);
		if (targetPath === rawPrefix) {
			return workspacePrefix;
		}
		if (targetPath.startsWith(`${rawPrefix}/`)) {
			return normalizeVaultPath(`${workspacePrefix}/${targetPath.slice(rawPrefix.length + 1)}`);
		}
		return workspacePrefix;
	}

	private ok(input: {
		scope: "vault" | "external" | "any";
		inputPath: string;
		normalizedInput: string;
		targetPath: string;
		projectRoot?: string;
		candidates?: string[];
	}): ToolPathResolution {
		return {
			ok: true,
			scope: input.scope,
			inputPath: input.inputPath,
			normalizedInput: input.normalizedInput,
			targetPath: input.targetPath,
			resolvedPath: input.targetPath,
			displayPath: input.targetPath,
			projectRoot: input.projectRoot,
			candidates: input.candidates ?? [],
		};
	}

	private failed(input: {
		scope: "vault" | "external" | "any";
		inputPath: string;
		normalizedInput: string;
		targetPath: string;
		projectRoot?: string;
		candidates?: string[];
		code: string;
		reason: string;
		suggestedArgs?: Record<string, unknown>;
	}): ToolPathResolution {
		return {
			ok: false,
			scope: input.scope,
			inputPath: input.inputPath,
			normalizedInput: input.normalizedInput,
			targetPath: input.targetPath,
			displayPath: input.targetPath,
			projectRoot: input.projectRoot,
			candidates: input.candidates ?? [],
			code: input.code,
			reason: input.reason,
			suggestedArgs: input.suggestedArgs,
		};
	}
}

export function normalizeVaultPath(value: string): string {
	const normalized = String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
	if (normalized === "/") {
		return "/";
	}
	return normalized.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeWholeVaultRoot(value: string): string {
	return isWholeVaultProjectRoot(value) ? "" : normalizeVaultPath(value);
}

function isWholeVaultProjectRoot(value: string): boolean {
	return String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/") === "/";
}

function isAbsolutePath(value: string): boolean {
	return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value);
}

function isBarePath(value: string): boolean {
	return Boolean(value) && !value.includes("/");
}

function isDiscoveryIntent(intent: ToolPathIntent): boolean {
	return intent === "read_directory" || intent === "search";
}

function findCaseInsensitive(paths: string[], targetPath: string): string | undefined {
	const targetLower = targetPath.toLowerCase();
	return paths.find((item) => item.toLowerCase() === targetLower);
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
	return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
}
