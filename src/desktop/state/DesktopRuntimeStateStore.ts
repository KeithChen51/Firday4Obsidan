import { promises as fs } from "fs";
import path from "path";
import type { DesktopTurnContext } from "../contracts/DesktopHostAdapter";
import type {
	DesktopConversationRecord,
	DesktopReferenceRecord,
	DesktopTurnRecord,
	DesktopWorkspaceState,
	RuntimeStateHostPort,
} from "../contracts/RuntimeStateHostPort";
import { ConversationStore } from "./ConversationStore";
import { FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { encodeStatePathSegment } from "./StatePathSegments";
import { TurnStore } from "./TurnStore";
import { WorkspaceStateStore } from "./WorkspaceStateStore";

export interface DesktopRuntimeStateStoreOptions {
	clock?: () => Date;
}

export class DesktopRuntimeStateStore implements RuntimeStateHostPort {
	readonly projectRoot: string;
	readonly fridayRoot: string;

	private readonly clock: () => Date;
	private readonly workspaceStateStore: WorkspaceStateStore;
	private readonly conversationStore: ConversationStore;
	private readonly turnStore: TurnStore;

	constructor(projectRoot: string, options: DesktopRuntimeStateStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.fridayRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME);
		this.clock = options.clock ?? (() => new Date());
		this.workspaceStateStore = new WorkspaceStateStore(this.projectRoot, { clock: this.clock });
		this.conversationStore = new ConversationStore(this.projectRoot, { clock: this.clock });
		this.turnStore = new TurnStore(this.projectRoot, { clock: this.clock });
	}

	async saveConversation(record: DesktopConversationRecord): Promise<void> {
		await this.conversationStore.saveConversation(record);
	}

	async saveTurn(context: DesktopTurnContext, record: DesktopTurnRecord): Promise<void> {
		await this.turnStore.saveTurn(context, record);
		await this.appendJsonl(
			path.join(this.getConversationRoot(record.conversationId), "turns.jsonl"),
			record,
		);
	}

	async saveTrace(context: DesktopTurnContext, trace: Record<string, unknown>): Promise<void> {
		await this.appendJsonl(
			path.join(this.fridayRoot, "traces", `${encodeStatePathSegment(context.conversationId)}.jsonl`),
			{
				conversationId: context.conversationId,
				turnId: context.turnId,
				recordedAt: this.clock().toISOString(),
				...trace,
			},
		);
	}

	async saveReference(context: DesktopTurnContext, reference: DesktopReferenceRecord): Promise<void> {
		await this.appendJsonl(
			path.join(this.fridayRoot, "references", `${encodeStatePathSegment(reference.conversationId || context.conversationId)}.jsonl`),
			reference,
		);
	}

	async saveArtifact(context: DesktopTurnContext, artifact: Record<string, unknown>): Promise<void> {
		const conversationId = asString(artifact.conversationId) ?? context.conversationId;
		await this.appendJsonl(
			path.join(this.fridayRoot, "artifacts", `${encodeStatePathSegment(conversationId)}.jsonl`),
			artifact,
		);
	}

	async saveWorkspaceState(projectId: string, state: DesktopWorkspaceState): Promise<void> {
		await this.workspaceStateStore.saveWorkspaceState(projectId, state);
	}

	async restoreWorkspaceState(projectId: string): Promise<DesktopWorkspaceState | null> {
		return this.workspaceStateStore.restoreWorkspaceState(projectId);
	}

	private getConversationRoot(conversationId: string): string {
		return path.join(this.fridayRoot, "conversations", encodeStatePathSegment(conversationId));
	}

	private async appendJsonl(filePath: string, record: unknown): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
