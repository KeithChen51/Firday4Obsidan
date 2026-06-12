import { promises as fs } from "fs";
import path from "path";
import type { MentionComposerSnapshot } from "../../core/editor/mention/MentionComposerDocument";
import { createEmptyMentionComposerSnapshot } from "../../core/editor/mention/MentionComposerDocument";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type { DesktopTurnRecord } from "../contracts/RuntimeStateHostPort";
import type { AnswerReference } from "./AnswerReferenceBuilder";
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { encodeStatePathSegment } from "./StatePathSegments";

export interface StoredDesktopTurnRecord extends DesktopTurnRecord {
	composerSnapshot?: MentionComposerSnapshot;
	answerReferences?: AnswerReference[];
	metadata?: Record<string, unknown>;
}

export interface TurnStoreOptions {
	clock?: () => Date;
}

export class TurnStore {
	readonly projectRoot: string;
	readonly conversationsRoot: string;

	private readonly clock: () => Date;

	constructor(projectRoot: string, options: TurnStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.conversationsRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME, "conversations");
		this.clock = options.clock ?? (() => new Date());
	}

	async saveTurn(context: DesktopTurnContext, record: StoredDesktopTurnRecord): Promise<StoredDesktopTurnRecord> {
		const frozen = freezeTurnRecord({
			...record,
			conversationId: record.conversationId || context.conversationId,
			createdAt: record.createdAt || this.clock().toISOString(),
		});
		await atomicWriteJson(this.resolveTurnFile(frozen.conversationId, frozen.id), frozen);
		return frozen;
	}

	async readTurn(conversationId: string, turnId: string): Promise<StoredDesktopTurnRecord | null> {
		try {
			return JSON.parse(await fs.readFile(this.resolveTurnFile(conversationId, turnId), "utf8")) as StoredDesktopTurnRecord;
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async listTurns(conversationId: string): Promise<StoredDesktopTurnRecord[]> {
		const turnDirectory = this.resolveTurnDirectory(conversationId);
		let files: string[] = [];
		try {
			files = await fs.readdir(turnDirectory);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
		const turns: StoredDesktopTurnRecord[] = [];
		for (const file of files.filter((entry) => entry.endsWith(".json")).sort()) {
			const turn = await readTurnFile(path.join(turnDirectory, file));
			if (turn) {
				turns.push(turn);
			}
		}
		return turns.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
	}

	private resolveTurnFile(conversationId: string, turnId: string): string {
		return path.join(this.resolveTurnDirectory(conversationId), `${encodeStatePathSegment(turnId)}.json`);
	}

	private resolveTurnDirectory(conversationId: string): string {
		return path.join(this.conversationsRoot, encodeStatePathSegment(conversationId), "turns");
	}
}

export function createEmptyNextComposerSnapshot(): MentionComposerSnapshot {
	return createEmptyMentionComposerSnapshot();
}

export function isComposerSnapshotEmpty(snapshot: Partial<MentionComposerSnapshot> | null | undefined): boolean {
	const text = typeof snapshot?.text === "string" ? snapshot.text.trim() : "";
	return !text && (snapshot?.tokens?.length ?? 0) === 0;
}

function freezeTurnRecord(record: StoredDesktopTurnRecord): StoredDesktopTurnRecord {
	return deepClone(record);
}

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

async function readTurnFile(filePath: string): Promise<StoredDesktopTurnRecord | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as StoredDesktopTurnRecord;
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
