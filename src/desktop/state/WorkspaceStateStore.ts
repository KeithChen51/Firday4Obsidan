import { promises as fs } from "fs";
import path from "path";
import type { DesktopWorkspaceState } from "../contracts/RuntimeStateHostPort";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export const WORKSPACE_STATE_SCHEMA_VERSION = 1;

export interface WorkspaceState extends DesktopWorkspaceState {
	schemaVersion?: typeof WORKSPACE_STATE_SCHEMA_VERSION;
	resourcePanelState?: Record<string, unknown>;
	lastOpenedAt?: string;
}

export interface WorkspaceStateStoreOptions {
	clock?: () => Date;
}

export class WorkspaceStateStore {
	readonly projectRoot: string;
	readonly stateRoot: string;
	readonly workspaceStatePath: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: WorkspaceStateStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.stateRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "state");
		this.workspaceStatePath = path.join(this.stateRoot, "workspace-state.json");
		this.clock = options.clock ?? (() => new Date());
	}

	async restore(): Promise<WorkspaceState | null> {
		try {
			const raw = await fs.readFile(this.workspaceStatePath, "utf8");
			return normalizeWorkspaceState(JSON.parse(raw));
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async save(state: WorkspaceState): Promise<WorkspaceState> {
		const nextState = normalizeWorkspaceState({
			...state,
			schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
			lastOpenedAt: this.clock().toISOString(),
		});
		await atomicWriteJson(this.workspaceStatePath, nextState);
		return nextState;
	}

	async saveWorkspaceState(projectId: string, state: WorkspaceState): Promise<void> {
		await this.save({
			...state,
			activeProjectId: projectId,
		});
	}

	async restoreWorkspaceState(_projectId: string): Promise<WorkspaceState | null> {
		return this.restore();
	}
}

function normalizeWorkspaceState(value: unknown): WorkspaceState {
	const record = isRecord(value) ? value : {};
	return {
		schemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
		activeProjectId: asString(record.activeProjectId),
		activeConversationId: asString(record.activeConversationId),
		activeArtifactId: asString(record.activeArtifactId),
		layout: isRecord(record.layout) ? cloneRecord(record.layout) : undefined,
		resourcePanelState: isRecord(record.resourcePanelState) ? cloneRecord(record.resourcePanelState) : undefined,
		lastOpenedAt: asString(record.lastOpenedAt),
	};
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
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
