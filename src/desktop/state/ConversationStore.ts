import { promises as fs } from "fs";
import path from "path";
import type { DesktopConversationRecord } from "../contracts/RuntimeStateHostPort";
import { ImportStore } from "./ImportStore";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { encodeStatePathSegment } from "./StatePathSegments";

export interface CreateConversationInput {
	id: string;
	projectId: string;
	title?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface ArchiveConversationResult {
	conversationId: string;
	archivePath: string;
	importsArchivePath: string;
}

export interface ConversationStoreOptions {
	clock?: () => Date;
}

export class ConversationStore {
	readonly projectRoot: string;
	readonly conversationsRoot: string;
	readonly archiveConversationsRoot: string;

	private readonly clock: () => Date;
	private readonly importStore: ImportStore;

	constructor(projectRoot: string, options: ConversationStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.conversationsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "conversations");
		this.archiveConversationsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "archive", "conversations");
		this.clock = options.clock ?? (() => new Date());
		this.importStore = new ImportStore(this.projectRoot, { clock: this.clock });
	}

	async createConversation(input: CreateConversationInput): Promise<DesktopConversationRecord> {
		const now = this.now();
		const record: DesktopConversationRecord = {
			id: input.id,
			projectId: input.projectId,
			title: input.title,
			createdAt: input.createdAt ?? now,
			updatedAt: input.updatedAt ?? input.createdAt ?? now,
		};
		await this.saveConversation(record);
		return record;
	}

	async saveConversation(record: DesktopConversationRecord): Promise<DesktopConversationRecord> {
		const normalized = normalizeConversationRecord(record, this.now());
		await atomicWriteJson(this.resolveConversationFile(normalized.id), normalized);
		return normalized;
	}

	async readConversation(conversationId: string): Promise<DesktopConversationRecord | null> {
		try {
			return normalizeConversationRecord(
				JSON.parse(await fs.readFile(this.resolveConversationFile(conversationId), "utf8")),
				this.now(),
			);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async listConversations(): Promise<DesktopConversationRecord[]> {
		let entries: string[] = [];
		try {
			entries = await fs.readdir(this.conversationsRoot);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const conversations: DesktopConversationRecord[] = [];
		for (const entry of entries.sort()) {
			const record = await this.readConversationFromPath(path.join(this.conversationsRoot, entry, "conversation.json"));
			if (record) {
				conversations.push(record);
			}
		}
		return conversations.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
	}

	async archiveConversation(conversationId: string): Promise<ArchiveConversationResult> {
		const conversationSegment = encodeStatePathSegment(conversationId);
		const sourceDirectory = path.join(this.conversationsRoot, conversationSegment);
		const archiveDirectory = path.join(this.archiveConversationsRoot, conversationSegment);

		if (!await pathExists(sourceDirectory)) {
			throw new Error(`Conversation does not exist: ${conversationId}`);
		}
		if (await pathExists(archiveDirectory)) {
			throw new Error(`Archived conversation already exists: ${conversationId}`);
		}

		await fs.mkdir(path.dirname(archiveDirectory), { recursive: true });
		await fs.rename(sourceDirectory, archiveDirectory);
		let importsArchivePath: string;
		try {
			importsArchivePath = await this.importStore.archiveConversationImports(conversationId);
		} catch (error) {
			await this.rollbackConversationArchive(sourceDirectory, archiveDirectory);
			throw error;
		}

		return {
			conversationId,
			archivePath: archiveDirectory,
			importsArchivePath,
		};
	}

	private resolveConversationFile(conversationId: string): string {
		return path.join(this.conversationsRoot, encodeStatePathSegment(conversationId), "conversation.json");
	}

	private now(): string {
		return this.clock().toISOString();
	}

	private async readConversationFromPath(filePath: string): Promise<DesktopConversationRecord | null> {
		try {
			return normalizeConversationRecord(
				JSON.parse(await fs.readFile(filePath, "utf8")),
				this.now(),
			);
		} catch (error) {
			if ((isNodeError(error) && error.code === "ENOENT") || error instanceof SyntaxError) {
				return null;
			}
			throw error;
		}
	}

	private async rollbackConversationArchive(sourceDirectory: string, archiveDirectory: string): Promise<void> {
		if (!await pathExists(archiveDirectory) || await pathExists(sourceDirectory)) {
			return;
		}
		await fs.mkdir(path.dirname(sourceDirectory), { recursive: true });
		await fs.rename(archiveDirectory, sourceDirectory);
	}
}

function normalizeConversationRecord(value: unknown, now: string): DesktopConversationRecord {
	const record = isRecord(value) ? value : {};
	const id = asString(record.id) ?? "conversation";
	const createdAt = asString(record.createdAt) ?? now;
	return {
		id,
		projectId: asString(record.projectId) ?? "desktop-project",
		title: asString(record.title),
		createdAt,
		updatedAt: asString(record.updatedAt) ?? createdAt,
	};
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

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
