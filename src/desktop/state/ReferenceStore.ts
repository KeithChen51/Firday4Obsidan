import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { AnswerReference } from "./AnswerReferenceBuilder";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { encodeStatePathSegment } from "./StatePathSegments";

export const TURN_REFERENCES_SCHEMA_VERSION = 1;

export interface ReferenceTarget {
	targetType: string;
	targetUri: string;
	fileName?: string;
	fileType?: string;
	metadata?: Record<string, unknown>;
}

export interface ExplicitReferenceRecord {
	id: string;
	tokenId?: string;
	tokenType?: string;
	target: ReferenceTarget;
	metadata?: Record<string, unknown>;
}

export interface ResolvedReferenceRecord {
	id: string;
	explicitReferenceId?: string;
	resolver?: string;
	target: ReferenceTarget;
	summary?: string;
	metadata?: Record<string, unknown>;
}

export interface TraceSourceRecord {
	id: string;
	traceEventId?: string;
	operation?: string;
	target: ReferenceTarget;
	metadata?: Record<string, unknown>;
}

export interface SaveTurnReferencesInput {
	explicitReferences?: ExplicitReferenceRecord[];
	resolvedReferences?: ResolvedReferenceRecord[];
	traceSources?: TraceSourceRecord[];
	answerReferences?: AnswerReference[];
}

export interface StoredTurnReferences {
	schemaVersion: typeof TURN_REFERENCES_SCHEMA_VERSION;
	conversationId: string;
	turnId: string;
	explicitReferences: ExplicitReferenceRecord[];
	resolvedReferences: ResolvedReferenceRecord[];
	traceSources: TraceSourceRecord[];
	answerReferences: AnswerReference[];
	createdAt: string;
	updatedAt: string;
}

export interface ReferenceStoreOptions {
	clock?: () => Date;
}

export class ReferenceStore {
	readonly projectRoot: string;
	readonly conversationsRoot: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: ReferenceStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.conversationsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "conversations");
		this.clock = options.clock ?? (() => new Date());
	}

	async saveTurnReferences(
		context: DesktopTurnContext,
		input: SaveTurnReferencesInput,
	): Promise<StoredTurnReferences> {
		const existing = await this.readTurnReferences(context.conversationId, context.turnId);
		const now = this.clock().toISOString();
		const record: StoredTurnReferences = {
			schemaVersion: TURN_REFERENCES_SCHEMA_VERSION,
			conversationId: context.conversationId,
			turnId: context.turnId,
			explicitReferences: deepClone(input.explicitReferences ?? []),
			resolvedReferences: deepClone(input.resolvedReferences ?? []),
			traceSources: deepClone(input.traceSources ?? []),
			answerReferences: deepClone(input.answerReferences ?? []),
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await atomicWriteJson(this.resolveReferenceFile(context.conversationId, context.turnId), record);
		return record;
	}

	async readTurnReferences(conversationId: string, turnId: string): Promise<StoredTurnReferences | null> {
		try {
			return JSON.parse(await fs.readFile(this.resolveReferenceFile(conversationId, turnId), "utf8")) as StoredTurnReferences;
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async listTurnReferences(conversationId: string): Promise<StoredTurnReferences[]> {
		const referenceDirectory = this.resolveReferenceDirectory(conversationId);
		let files: string[] = [];
		try {
			files = await fs.readdir(referenceDirectory);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const references: StoredTurnReferences[] = [];
		for (const file of files.filter((entry) => entry.endsWith(".json")).sort()) {
			const record = await readTurnReferencesFile(path.join(referenceDirectory, file));
			if (record) {
				references.push(record);
			}
		}
		return references.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.turnId.localeCompare(right.turnId));
	}

	private resolveReferenceFile(conversationId: string, turnId: string): string {
		return path.join(this.resolveReferenceDirectory(conversationId), `${encodeStatePathSegment(turnId)}.json`);
	}

	private resolveReferenceDirectory(conversationId: string): string {
		return path.join(this.conversationsRoot, encodeStatePathSegment(conversationId), "references");
	}
}

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

async function readTurnReferencesFile(filePath: string): Promise<StoredTurnReferences | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as StoredTurnReferences;
	} catch (error) {
		if ((isNodeError(error) && error.code === "ENOENT") || error instanceof SyntaxError) {
			return null;
		}
		throw error;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
