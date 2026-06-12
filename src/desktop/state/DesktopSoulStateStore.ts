import { promises as fs } from "fs";
import path from "path";
import { FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export const DESKTOP_SOUL_STATE_SCHEMA_VERSION = 1;

export type DesktopBasicSoulTonePreset = "balanced" | "calm" | "warm";

export interface DesktopBasicSoulProfile {
	id: string;
	name: string;
	summary: string;
	tonePreset: DesktopBasicSoulTonePreset;
}

export interface DesktopBasicSoulState {
	schemaVersion?: typeof DESKTOP_SOUL_STATE_SCHEMA_VERSION;
	activeSoulId: string;
	lastUsedSoulId: string;
	recentlyUsedSoulIds: string[];
	profile?: DesktopBasicSoulProfile;
}

export class DesktopSoulStateStore {
	readonly projectRoot: string;
	readonly statePath: string;

	constructor(projectRoot: string) {
		this.projectRoot = path.resolve(projectRoot);
		this.statePath = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "state", "desktop-soul-state.json");
	}

	async restoreBasicState(): Promise<DesktopBasicSoulState | null> {
		try {
			const raw = await fs.readFile(this.statePath, "utf8");
			return normalizeBasicSoulState(JSON.parse(raw));
		} catch {
			return null;
		}
	}

	async saveBasicState(state: DesktopBasicSoulState): Promise<DesktopBasicSoulState> {
		const normalized = normalizeBasicSoulState(state) ?? createEmptySoulState();
		await safeAtomicWriteJsonInsideProject(this.projectRoot, this.statePath, normalized);
		return normalized;
	}
}

function normalizeBasicSoulState(value: unknown): DesktopBasicSoulState | null {
	const record = isRecord(value) ? value : {};
	const activeSoulId = asString(record.activeSoulId);
	const lastUsedSoulId = asString(record.lastUsedSoulId) ?? activeSoulId;
	const recentlyUsedSoulIds = Array.isArray(record.recentlyUsedSoulIds)
		? record.recentlyUsedSoulIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
	const profile = normalizeBasicSoulProfile(record.profile);

	if (!activeSoulId && !lastUsedSoulId && recentlyUsedSoulIds.length === 0 && !profile) {
		return null;
	}

	return {
		activeSoulId: activeSoulId ?? profile?.id ?? "",
		lastUsedSoulId: lastUsedSoulId ?? activeSoulId ?? profile?.id ?? "",
		recentlyUsedSoulIds: [...new Set(recentlyUsedSoulIds)],
		...(profile ? { profile } : {}),
	};
}

function normalizeBasicSoulProfile(value: unknown): DesktopBasicSoulProfile | undefined {
	const record = isRecord(value) ? value : {};
	const id = asString(record.id);
	if (!id) {
		return undefined;
	}
	return {
		id,
		name: asString(record.name) ?? id,
		summary: asString(record.summary) ?? "",
		tonePreset: normalizeTonePreset(record.tonePreset),
	};
}

function createEmptySoulState(): DesktopBasicSoulState {
	return {
		activeSoulId: "",
		lastUsedSoulId: "",
		recentlyUsedSoulIds: [],
	};
}

function normalizeTonePreset(value: unknown): DesktopBasicSoulTonePreset {
	if (value === "calm" || value === "warm") {
		return value;
	}
	return "balanced";
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isPathInside(root: string, candidatePath: string): boolean {
	const relativePath = path.relative(path.resolve(root), path.resolve(candidatePath));
	return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
