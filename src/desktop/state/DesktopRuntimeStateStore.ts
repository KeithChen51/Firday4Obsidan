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
import { atomicWriteJson, FRIDAY_DIRECTORY_NAME } from "./ProjectManifestStore";
import { WorkspaceStateStore } from "./WorkspaceStateStore";

export interface DesktopRuntimeStateStoreOptions {
	clock?: () => Date;
}

export class DesktopRuntimeStateStore implements RuntimeStateHostPort {
	readonly projectRoot: string;
	readonly fridayRoot: string;

	private readonly clock: () => Date;
	private readonly workspaceStateStore: WorkspaceStateStore;

	constructor(projectRoot: string, options: DesktopRuntimeStateStoreOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.fridayRoot = path.join(this.projectRoot, FRIDAY_DIRECTORY_NAME);
		this.clock = options.clock ?? (() => new Date());
		this.workspaceStateStore = new WorkspaceStateStore(this.projectRoot, { clock: this.clock });
	}

	async saveConversation(record: DesktopConversationRecord): Promise<void> {
		await atomicWriteJson(
			path.join(this.getConversationRoot(record.id), "conversation.json"),
			record,
		);
	}

	async saveTurn(_context: DesktopTurnContext, record: DesktopTurnRecord): Promise<void> {
		await this.appendJsonl(
			path.join(this.getConversationRoot(record.conversationId), "turns.jsonl"),
			record,
		);
	}

	async saveTrace(context: DesktopTurnContext, trace: Record<string, unknown>): Promise<void> {
		await this.appendJsonl(
			path.join(this.fridayRoot, "traces", `${safePathSegment(context.conversationId)}.jsonl`),
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
			path.join(this.fridayRoot, "references", `${safePathSegment(reference.conversationId || context.conversationId)}.jsonl`),
			reference,
		);
	}

	async saveArtifact(context: DesktopTurnContext, artifact: Record<string, unknown>): Promise<void> {
		const conversationId = asString(artifact.conversationId) ?? context.conversationId;
		await this.appendJsonl(
			path.join(this.fridayRoot, "artifacts", `${safePathSegment(conversationId)}.jsonl`),
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
		return path.join(this.fridayRoot, "conversations", safePathSegment(conversationId));
	}

	private async appendJsonl(filePath: string, record: unknown): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
	}
}

function safePathSegment(value: string): string {
	const segment = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	if (!segment || segment === "." || segment === "..") {
		return "default";
	}
	return segment;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
