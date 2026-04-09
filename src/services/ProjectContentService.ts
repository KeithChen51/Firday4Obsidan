import { createHash } from "crypto";
import path from "path";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import { ProjectEntry, RawSidecarMeta, SourceType } from "../types/project";

export interface RawSourceContext {
	sourceUserId?: string;
	sourceUserName?: string;
	sourceType?: SourceType;
	sourceRepo?: string;
	sourceBranch?: string;
	sourceCommit?: string;
}

export interface PreparedRawIngestMeta {
	meta: RawSidecarMeta;
	changed: boolean;
	previousHash: string;
}

export class ProjectContentService {
	constructor(private readonly vault: Vault) {}

	getRawRoot(projectRoot: string): string {
		return normalizePath(`${projectRoot}/raw`);
	}

	getWikiRoot(projectRoot: string): string {
		return normalizePath(`${projectRoot}/wiki`);
	}

	getIngestEventsPath(projectRoot: string): string {
		return normalizePath(`${projectRoot}/.friday/ingest-events.jsonl`);
	}

	getSidecarPath(rawPath: string): string {
		return normalizePath(`${normalizePath(rawPath)}.meta.json`);
	}

	isRawPath(projectRoot: string, filePath: string): boolean {
		const normalizedPath = normalizePath(filePath);
		const rawRoot = this.getRawRoot(projectRoot);
		return (
			(normalizedPath === rawRoot || normalizedPath.startsWith(`${rawRoot}/`)) &&
			!normalizedPath.endsWith(".meta.json")
		);
	}

	async listRawFiles(projectRoot: string): Promise<string[]> {
		const rawRoot = this.getRawRoot(projectRoot);
		return this.vault
			.getFiles()
			.filter((item) => this.isRawPath(projectRoot, item.path) && this.isPathWithin(item.path, rawRoot))
			.map((item) => item.path);
	}

	async readSidecar(rawPath: string): Promise<RawSidecarMeta | null> {
		const sidecarPath = this.getSidecarPath(rawPath);
		const sidecarFile = this.vault.getAbstractFileByPath(sidecarPath);
		if (!(sidecarFile instanceof TFile)) {
			return null;
		}
		try {
			const raw = await this.vault.cachedRead(sidecarFile);
			const parsed = JSON.parse(raw) as RawSidecarMeta;
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	}

	async upsertSidecar(rawPath: string, patch: Partial<RawSidecarMeta>): Promise<RawSidecarMeta> {
		const now = new Date().toISOString();
		const existing = await this.readSidecar(rawPath);
		const base: RawSidecarMeta = existing ?? {
			metaVersion: 1,
			docId: "",
			projectId: "",
			rawPath: normalizePath(rawPath),
			sourceUserId: "",
			sourceUserName: "",
			sourceType: "local_create",
			sourceRepo: "",
			sourceBranch: "",
			sourceCommit: "",
			sourceUpdatedAt: now,
			sourceVersion: 1,
			contentHash: "",
			prevContentHash: "",
			lastIngestId: "",
			lastIngestAt: "",
			lastIngestStatus: "pending",
		};
		const next: RawSidecarMeta = {
			...base,
			...patch,
			rawPath: normalizePath(rawPath),
		};
		await this.ensureParentFolder(this.getSidecarPath(rawPath));
		await this.writeTextFile(this.getSidecarPath(rawPath), `${JSON.stringify(next, null, 2)}\n`);
		return next;
	}

	async prepareRawForIngest(
		project: ProjectEntry,
		projectRoot: string,
		rawPath: string,
		source: RawSourceContext,
	): Promise<PreparedRawIngestMeta> {
		const normalizedRawPath = normalizePath(rawPath);
		const normalizedProjectRoot = normalizePath(projectRoot);
		if (!this.isRawPath(normalizedProjectRoot, normalizedRawPath)) {
			throw new Error(`Raw path out of project scope: ${normalizedRawPath}`);
		}

		const file = this.vault.getAbstractFileByPath(normalizedRawPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Raw file not found: ${normalizedRawPath}`);
		}

		const content = await this.vault.cachedRead(file);
		const contentHash = this.hashContent(content);
		const now = new Date().toISOString();
		const existing = await this.readSidecar(normalizedRawPath);
		const previousHash = existing?.contentHash ?? "";
		const changed = previousHash !== contentHash;
		const sourceVersion = changed ? (existing?.sourceVersion ?? 0) + 1 : (existing?.sourceVersion ?? 1);
		const projectId = project.slug;
		const docId = existing?.docId || this.buildDocId(projectId, normalizedRawPath);

		const next = await this.upsertSidecar(normalizedRawPath, {
			metaVersion: 1,
			docId,
			projectId,
			rawPath: normalizedRawPath,
			sourceUserId: source.sourceUserId ?? existing?.sourceUserId ?? "",
			sourceUserName: source.sourceUserName ?? existing?.sourceUserName ?? "",
			sourceType: source.sourceType ?? existing?.sourceType ?? "local_create",
			sourceRepo: source.sourceRepo ?? existing?.sourceRepo ?? "",
			sourceBranch: source.sourceBranch ?? existing?.sourceBranch ?? "",
			sourceCommit: source.sourceCommit ?? existing?.sourceCommit ?? "",
			sourceUpdatedAt: now,
			sourceVersion,
			contentHash,
			prevContentHash: changed ? previousHash : existing?.prevContentHash ?? "",
			lastIngestStatus: changed ? "pending" : existing?.lastIngestStatus ?? "pending",
		});

		return {
			meta: next,
			changed,
			previousHash,
		};
	}

	private buildDocId(projectId: string, rawPath: string): string {
		const normalized = normalizePath(rawPath).replace(/\//g, "__");
		return `${projectId}__${normalized}`;
	}

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf8").digest("hex");
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parentPath = normalizePath(path.posix.dirname(normalizePath(filePath)));
		if (!parentPath || parentPath === ".") {
			return;
		}
		const segments = parentPath.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) {
				continue;
			}
			if (existing instanceof TFile) {
				const backup = normalizePath(`${current}.legacy-file-${Date.now()}`);
				await this.vault.rename(existing, backup);
			}
			try {
				await this.vault.createFolder(current);
			} catch (error) {
				const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
				if (!message.includes("already exists")) {
					throw error;
				}
			}
		}
	}

	private async writeTextFile(filePath: string, content: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const existing = await this.resolveFileConflict(normalized);
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
			return;
		}
		try {
			await this.vault.create(normalized, content);
		} catch (error) {
			if (!this.isAlreadyExistsError(error)) {
				throw error;
			}
			const created = await this.resolveFileConflict(normalized);
			if (created instanceof TFile) {
				await this.vault.modify(created, content);
				return;
			}
			throw error;
		}
	}

	private async resolveFileConflict(filePath: string): Promise<TFile | null> {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		if (direct instanceof TFolder) {
			const backup = normalizePath(`${normalized}.legacy-folder-${Date.now()}`);
			await this.vault.rename(direct, backup);
			return null;
		}
		return this.getFileByPathRelaxed(normalized);
	}

	private getFileByPathRelaxed(filePath: string): TFile | null {
		const normalized = normalizePath(filePath);
		const direct = this.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		const lower = normalized.toLowerCase();
		return this.vault
			.getFiles()
			.find((item) => normalizePath(item.path).toLowerCase() === lower) ?? null;
	}

	private isAlreadyExistsError(error: unknown): boolean {
		const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
		return message.includes("already exists") || message.includes("eexist");
	}

	private isPathWithin(candidatePath: string, parentPath: string): boolean {
		const normalizedCandidate = normalizePath(candidatePath);
		const normalizedParent = normalizePath(parentPath);
		return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
	}
}
