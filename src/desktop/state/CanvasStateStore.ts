import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";

export const CANVAS_STATE_SCHEMA_VERSION = 1;

export interface CanvasTabState {
	artifactId: string;
	pinned?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ConversationCanvasState {
	projectId: string;
	conversationId: string;
	activeArtifactId?: string;
	tabOrder: string[];
	tabs: CanvasTabState[];
	layout?: Record<string, unknown>;
	updatedAt: string;
}

export interface SaveConversationCanvasStateInput {
	activeArtifactId?: string;
	tabs?: CanvasTabState[];
	tabOrder?: string[];
	layout?: Record<string, unknown>;
}

export interface StoredCanvasStateDocument {
	schemaVersion: typeof CANVAS_STATE_SCHEMA_VERSION;
	conversations: Record<string, ConversationCanvasState>;
	updatedAt?: string;
}

export interface CanvasStateStoreOptions {
	clock?: () => Date;
}

export class CanvasStateStore {
	readonly projectRoot: string;
	readonly stateRoot: string;
	readonly canvasStatePath: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: CanvasStateStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.stateRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "state");
		this.canvasStatePath = path.join(this.stateRoot, "canvas-state.json");
		this.clock = options.clock ?? (() => new Date());
	}

	async saveConversationCanvasState(
		context: DesktopTurnContext,
		input: SaveConversationCanvasStateInput,
	): Promise<ConversationCanvasState> {
		const document = await this.readDocument();
		const now = this.clock().toISOString();
		const tabs = normalizeTabs(input.tabs ?? []);
		const tabOrder = normalizeTabOrder(input.tabOrder, tabs);
		const activeArtifactId = normalizeActiveArtifactId(input.activeArtifactId, tabOrder);
		const state: ConversationCanvasState = {
			projectId: context.projectId,
			conversationId: context.conversationId,
			activeArtifactId,
			tabOrder,
			tabs,
			layout: isRecord(input.layout) ? deepClone(input.layout) : undefined,
			updatedAt: now,
		};

		document.conversations[context.conversationId] = state;
		document.updatedAt = now;
		await atomicWriteJson(this.canvasStatePath, document);
		return state;
	}

	async restoreConversationCanvasState(conversationId: string): Promise<ConversationCanvasState | null> {
		const document = await this.readDocument();
		return document.conversations[conversationId] ?? null;
	}

	async restoreAll(): Promise<StoredCanvasStateDocument> {
		return this.readDocument();
	}

	private async readDocument(): Promise<StoredCanvasStateDocument> {
		try {
			return normalizeCanvasStateDocument(JSON.parse(await fs.readFile(this.canvasStatePath, "utf8")));
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return {
					schemaVersion: CANVAS_STATE_SCHEMA_VERSION,
					conversations: {},
				};
			}
			throw error;
		}
	}
}

function normalizeCanvasStateDocument(value: unknown): StoredCanvasStateDocument {
	const record = isRecord(value) ? value : {};
	const conversations: Record<string, ConversationCanvasState> = {};
	if (isRecord(record.conversations)) {
		for (const [conversationId, conversationValue] of Object.entries(record.conversations)) {
			const normalized = normalizeConversationCanvasState(conversationValue, conversationId);
			if (normalized) {
				conversations[conversationId] = normalized;
			}
		}
	}
	return {
		schemaVersion: CANVAS_STATE_SCHEMA_VERSION,
		conversations,
		updatedAt: asString(record.updatedAt),
	};
}

function normalizeConversationCanvasState(value: unknown, fallbackConversationId: string): ConversationCanvasState | null {
	if (!isRecord(value)) {
		return null;
	}
	const tabs = normalizeTabs(value.tabs);
	const tabOrder = normalizeTabOrder(value.tabOrder, tabs);
	return {
		projectId: asString(value.projectId) ?? "desktop-project",
		conversationId: asString(value.conversationId) ?? fallbackConversationId,
		activeArtifactId: normalizeActiveArtifactId(asString(value.activeArtifactId), tabOrder),
		tabOrder,
		tabs,
		layout: isRecord(value.layout) ? deepClone(value.layout) : undefined,
		updatedAt: asString(value.updatedAt) ?? new Date(0).toISOString(),
	};
}

function normalizeTabs(value: unknown): CanvasTabState[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const tabs: CanvasTabState[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const artifactId = asString(item.artifactId);
		if (!artifactId || seen.has(artifactId)) {
			continue;
		}
		seen.add(artifactId);
		const tab: CanvasTabState = {
			artifactId,
		};
		if (typeof item.pinned === "boolean") {
			tab.pinned = item.pinned;
		}
		if (isRecord(item.metadata)) {
			tab.metadata = deepClone(item.metadata);
		}
		tabs.push(tab);
	}
	return tabs;
}

function normalizeTabOrder(value: unknown, tabs: CanvasTabState[]): string[] {
	const knownTabs = new Set(tabs.map((tab) => tab.artifactId));
	if (!Array.isArray(value)) {
		return tabs.map((tab) => tab.artifactId);
	}
	const ordered: string[] = [];
	for (const item of value) {
		const artifactId = asString(item);
		if (artifactId && knownTabs.has(artifactId) && !ordered.includes(artifactId)) {
			ordered.push(artifactId);
		}
	}
	for (const tab of tabs) {
		if (!ordered.includes(tab.artifactId)) {
			ordered.push(tab.artifactId);
		}
	}
	return ordered;
}

function normalizeActiveArtifactId(value: unknown, tabOrder: string[]): string | undefined {
	const artifactId = asString(value);
	if (artifactId && tabOrder.includes(artifactId)) {
		return artifactId;
	}
	return tabOrder[0];
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
