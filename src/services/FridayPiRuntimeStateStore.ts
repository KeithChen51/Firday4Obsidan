import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AgentTurnStatus, RuntimeToolTrace } from "../core/agent-kernel/contracts";
import { RuntimeStateStore } from "./RuntimeStateStore";

export type FridayPiExternalAccessPolicy = "explicit";

export interface FridayPiWorkspacePolicyMetadata {
	trustBoundary: "vault" | "project";
	vault: {
		root: "/";
		absoluteRoot?: string;
	};
	activeProject?: {
		projectId?: string;
		slug?: string;
		name?: string;
		vaultRoot?: string;
		absoluteRoot?: string;
	};
	externalAccess: FridayPiExternalAccessPolicy;
	externalWrite: false;
}

export interface FridayPiPackageMetadataInput {
	packageId?: string;
	name?: string;
	version?: string;
	kind?: string;
	marketplace?: boolean;
	bridge?: string;
	description?: string;
	createdAt?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

export interface FridayPiPackageMetadataRef {
	packageId: string;
	manifestPath: string;
	runtime: "friday-pi";
	kind: string;
	marketplace: boolean;
}

export interface FridayPiSessionTurnRecord {
	schemaVersion?: 1;
	kind?: "pi_session_turn";
	sessionId: string;
	conversationId: string;
	turnId: string;
	taskId?: string;
	traceId?: string;
	status: AgentTurnStatus | string;
	startedAt: string;
	endedAt: string;
	recordedAt?: string;
	assistantSummary?: string;
	assistantTextLength?: number;
	rawFinalReplyLength?: number;
	packageRef?: FridayPiPackageMetadataRef;
	workspacePolicy?: FridayPiWorkspacePolicyMetadata;
	[key: string]: unknown;
}

export interface FridayPiToolTraceRecord {
	schemaVersion?: 1;
	kind?: "pi_tool_trace";
	sessionId: string;
	conversationId: string;
	turnId: string;
	taskId?: string;
	traceId?: string;
	recordedAt?: string;
	packageRef?: FridayPiPackageMetadataRef;
	workspacePolicy?: FridayPiWorkspacePolicyMetadata;
	runId: RuntimeToolTrace["runId"];
	step: RuntimeToolTrace["step"];
	tool: RuntimeToolTrace["tool"];
	scope: RuntimeToolTrace["scope"];
	targetPath: RuntimeToolTrace["targetPath"];
	approved?: RuntimeToolTrace["approved"];
	approvalReason?: RuntimeToolTrace["approvalReason"];
	persistedRule?: RuntimeToolTrace["persistedRule"];
	viaRule?: RuntimeToolTrace["viaRule"];
	status: RuntimeToolTrace["status"];
	failureClass?: RuntimeToolTrace["failureClass"];
	ok: RuntimeToolTrace["ok"];
	summary: RuntimeToolTrace["summary"];
	error?: RuntimeToolTrace["error"];
	[key: string]: unknown;
}

export interface FridayPiRuntimeStatePersistence {
	appendSessionTurnRecord(record: FridayPiSessionTurnRecord): Promise<void>;
	appendToolTraceRecords(records: FridayPiToolTraceRecord[]): Promise<void>;
	writePackageMetadata(metadata: FridayPiPackageMetadataInput): Promise<FridayPiPackageMetadataRef>;
}

const DEFAULT_PACKAGE_ID = "friday-pi-local-bridge";
const DEFAULT_PACKAGE_KIND = "local_bridge";

export class FridayPiRuntimeStateStore implements FridayPiRuntimeStatePersistence {
	constructor(private readonly runtimeStateStore: RuntimeStateStore) {}

	async appendSessionTurnRecord(record: FridayPiSessionTurnRecord): Promise<void> {
		const sessionId = this.resolveSessionId(record);
		const nextRecord: FridayPiSessionTurnRecord = {
			...record,
			schemaVersion: 1,
			kind: "pi_session_turn",
			sessionId,
			recordedAt: record.recordedAt ?? new Date().toISOString(),
		};
		await this.appendJsonl(this.runtimeStateStore.getPiSessionStatePath(sessionId), [nextRecord]);
	}

	async readSessionTurnRecords(sessionId: string): Promise<FridayPiSessionTurnRecord[]> {
		const filePath = this.runtimeStateStore.getPiSessionStatePath(sessionId);
		let raw: string;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			if (this.isNotFoundError(error)) {
				return [];
			}
			throw error;
		}
		return raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as FridayPiSessionTurnRecord);
	}

	async appendToolTraceRecords(records: FridayPiToolTraceRecord[]): Promise<void> {
		if (records.length === 0) {
			return;
		}
		const now = new Date().toISOString();
		const nextRecords = records.map((record): FridayPiToolTraceRecord => ({
			...record,
			schemaVersion: 1,
			kind: "pi_tool_trace",
			recordedAt: record.recordedAt ?? now,
		}));
		await this.appendJsonl(this.runtimeStateStore.getPiToolTracesPath(), nextRecords);
	}

	async writePackageMetadata(metadata: FridayPiPackageMetadataInput): Promise<FridayPiPackageMetadataRef> {
		const now = new Date().toISOString();
		const packageId = this.resolvePackageId(metadata.packageId);
		const kind = this.resolveText(metadata.kind, DEFAULT_PACKAGE_KIND);
		const marketplace = metadata.marketplace ?? false;
		const manifestPath = this.runtimeStateStore.getPiPackageManifestPath(packageId);
		const manifest = {
			...metadata,
			schemaVersion: 1,
			packageId,
			name: this.resolveText(metadata.name, "FRIDAY PI local bridge"),
			version: this.resolveText(metadata.version, "0.1.0"),
			kind,
			runtime: "friday-pi",
			bridge: this.resolveText(metadata.bridge, "obsidian-host"),
			marketplace,
			createdAt: this.resolveText(metadata.createdAt, now),
			updatedAt: now,
		};
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
		return {
			packageId,
			manifestPath,
			runtime: "friday-pi",
			kind,
			marketplace,
		};
	}

	private async appendJsonl(filePath: string, records: unknown[]): Promise<void> {
		await mkdir(path.dirname(filePath), { recursive: true });
		await appendFile(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
	}

	private resolveSessionId(record: Pick<FridayPiSessionTurnRecord, "sessionId" | "conversationId">): string {
		return this.resolveText(record.sessionId, this.resolveText(record.conversationId, "default"));
	}

	private resolvePackageId(packageId: unknown): string {
		return this.resolveText(packageId, DEFAULT_PACKAGE_ID);
	}

	private resolveText(value: unknown, fallback: string): string {
		const normalized = typeof value === "string" ? value.trim() : "";
		return normalized || fallback;
	}

	private isNotFoundError(error: unknown): boolean {
		return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
	}
}
