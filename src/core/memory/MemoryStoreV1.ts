import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
import type { MemoryScope, MemoryWriteInput, MemoryWriteResult } from "./MemoryTypes";
import { getFridayUserRoot } from "../../services/LocalStateRootService";

export const LEGACY_GLOBAL_MEMORY_PATH = "F.R.I.D.A.Y/_runtime/memory/global.md";
export function getGlobalMemoryPath(userRoot = getFridayUserRoot()): string {
	return path.join(userRoot, "memory", "global.md");
}
export const GLOBAL_MEMORY_PATH = getGlobalMemoryPath();
const PROJECT_MEMORY_RELATIVE_PATH = ".friday/memory/project.md";
const GLOBAL_MEMORY_HEADER = "# Global Memory";
const PROJECT_MEMORY_HEADER = "# Project Memory";
const FACT_PREFIX = "- [fact] ";

function safeNormalizePath(value: string): string {
	const portable = value.replace(/\\/g, "/");
	if (typeof normalizePath === "function") {
		return normalizePath(portable);
	}
	return portable.replace(/\/{2,}/g, "/");
}

interface MemoryFileAdapter {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	ensureParent(path: string): Promise<void>;
}

interface MemoryStoreV1Options {
	vault?: Vault;
	fileAdapter?: MemoryFileAdapter;
	globalFileAdapter?: MemoryFileAdapter;
	projectFileAdapter?: MemoryFileAdapter;
	matchResolver?: (records: string[], query: string) => Promise<string[]>;
	globalLimit?: number;
	projectLimit?: number;
}

export function getProjectMemoryPath(projectRoot: string): string {
	return safeNormalizePath(`${projectRoot.trim()}/${PROJECT_MEMORY_RELATIVE_PATH}`);
}

export function formatMemoryRecord(text: string): string {
	return `${FACT_PREFIX}${text.trim()}`;
}

export class MemoryStoreV1 {
	private readonly globalFileAdapter: MemoryFileAdapter;
	private readonly projectFileAdapter: MemoryFileAdapter;
	private readonly matchResolver: (records: string[], query: string) => Promise<string[]>;
	private readonly globalLimit: number;
	private readonly projectLimit: number;

	constructor(options: MemoryStoreV1Options = {}) {
		const sharedAdapter = options.fileAdapter;
		this.globalFileAdapter = options.globalFileAdapter ?? sharedAdapter ?? this.createFsAdapter();
		this.projectFileAdapter = options.projectFileAdapter ?? sharedAdapter ?? this.createVaultAdapter(options.vault);
		this.matchResolver = options.matchResolver ?? ((records, query) => this.defaultMatchResolver(records, query));
		this.globalLimit = Math.max(16, options.globalLimit ?? 1400);
		this.projectLimit = Math.max(16, options.projectLimit ?? 2200);
	}

	private getAdapter(scope: MemoryScope): MemoryFileAdapter {
		return scope === "global" ? this.globalFileAdapter : this.projectFileAdapter;
	}

	resolvePath(scope: MemoryScope, projectRoot?: string): string {
		if (scope === "global") {
			return GLOBAL_MEMORY_PATH;
		}
		if (!projectRoot?.trim()) {
			return "";
		}
		return getProjectMemoryPath(projectRoot);
	}

	async readPromptContext(activeProjectRoot?: string): Promise<string> {
		const sections: string[] = [];
		for (const scope of ["global", "project"] as const) {
			const path = this.resolvePath(scope, activeProjectRoot);
			if (!path) {
				continue;
			}
			const adapter = this.getAdapter(scope);
			if (!(await adapter.exists(path))) {
				continue;
			}
			const content = (await adapter.read(path)).trim();
			if (!content) {
				continue;
			}
			sections.push(`[memory:${scope}]`);
			sections.push(content);
		}
		return sections.join("\n\n");
	}

	async write(input: MemoryWriteInput): Promise<MemoryWriteResult> {
		const path = this.resolvePath(input.scope, input.projectRoot);
		if (!path) {
			return {
				ok: false,
				code: "missing_project",
				scope: input.scope,
				path: "",
				summary: "Memory write skipped.",
				reason: "Project memory requires an active project root.",
			};
		}

		if (input.action === "add" || input.action === "replace") {
			if (!input.content?.trim()) {
				return this.invalidResult(input.scope, path, "content is required.");
			}
		}
		if (input.action === "replace" || input.action === "remove") {
			if (!input.oldText?.trim()) {
				return this.invalidResult(input.scope, path, "old_text is required.");
			}
		}

		const adapter = this.getAdapter(input.scope);
		await adapter.ensureParent(path);
		const raw = (await adapter.exists(path))
			? await adapter.read(path)
			: this.renderFile(input.scope, []);
		const records = this.extractRecords(raw);
		const limit = input.scope === "global" ? this.globalLimit : this.projectLimit;

		if (input.action === "add") {
			const nextRecord = formatMemoryRecord(input.content ?? "");
			if (records.includes(nextRecord)) {
				return {
					ok: true,
					code: "duplicate",
					scope: input.scope,
					path,
					summary: `Memory unchanged; duplicate ${input.scope} fact already exists.`,
					appliesOnNextTurn: true,
				};
			}
			const nextRecords = [...records, nextRecord];
			return this.commitIfWithinLimit(input.scope, path, nextRecords, limit, `Added ${input.scope} memory; applies next turn.`);
		}

		const matches = await this.matchResolver(records, input.oldText ?? "");
		if (matches.length === 0) {
			return {
				ok: false,
				code: "not_found",
				scope: input.scope,
				path,
				summary: "Memory write failed.",
				reason: "No existing memory entry matched old_text.",
			};
		}
		if (matches.length > 1) {
			return {
				ok: false,
				code: "ambiguous_match",
				scope: input.scope,
				path,
				summary: "Memory write failed.",
				reason: "old_text matched multiple entries. Narrow the match and retry.",
				matches: matches.map((item) => this.preview(item)),
			};
		}

		const matched = matches[0];
		if (!matched) {
			return {
				ok: false,
				code: "not_found",
				scope: input.scope,
				path,
				summary: "Memory write failed.",
				reason: "No existing memory entry matched old_text.",
			};
		}

		if (input.action === "remove") {
			const nextRecords = records.filter((item) => item !== matched);
			await adapter.write(path, this.renderFile(input.scope, nextRecords));
			return {
				ok: true,
				code: "written",
				scope: input.scope,
				path,
				summary: `Removed ${input.scope} memory; applies next turn.`,
				appliesOnNextTurn: true,
			};
		}

		const replacement = formatMemoryRecord(input.content ?? "");
		const nextRecords = records.map((item) => (item === matched ? replacement : item));
		return this.commitIfWithinLimit(input.scope, path, nextRecords, limit, `Updated ${input.scope} memory; applies next turn.`);
	}

	private async commitIfWithinLimit(
		scope: MemoryScope,
		path: string,
		records: string[],
		limit: number,
		summary: string,
	): Promise<MemoryWriteResult> {
		const rendered = this.renderFile(scope, records);
		if (rendered.length > limit) {
			return {
				ok: false,
				code: "capacity_exceeded",
				scope,
				path,
				summary: "Memory write failed.",
				reason: `${scope} memory exceeds limit ${limit} characters; replace or remove entries before retrying.`,
				currentSize: rendered.length,
				limit,
			};
		}
		await this.getAdapter(scope).write(path, rendered);
		return {
			ok: true,
			code: "written",
			scope,
			path,
			summary,
			currentSize: rendered.length,
			limit,
			appliesOnNextTurn: true,
		};
	}

	private renderFile(scope: MemoryScope, records: string[]): string {
		const header = scope === "global" ? GLOBAL_MEMORY_HEADER : PROJECT_MEMORY_HEADER;
		return `${header}\n\n${records.join("\n")}${records.length ? "\n" : ""}`;
	}

	private extractRecords(raw: string): string[] {
		return raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.startsWith(FACT_PREFIX));
	}

	private preview(value: string): string {
		return value.length > 120 ? `${value.slice(0, 120)}...` : value;
	}

	private async defaultMatchResolver(records: string[], query: string): Promise<string[]> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return [];
		}
		return records.filter((record) => record.toLowerCase().includes(needle));
	}

	private invalidResult(scope: MemoryScope, path: string, reason: string): MemoryWriteResult {
		return {
			ok: false,
			code: "invalid_input",
			scope,
			path,
			summary: "Memory write failed.",
			reason,
		};
	}

	private createVaultAdapter(vault?: Vault): MemoryFileAdapter {
		if (!vault) {
			throw new Error("MemoryStoreV1 requires either a vault or a projectFileAdapter.");
		}
		return {
			read: async (filePath: string) => {
				const existing = vault.getAbstractFileByPath(safeNormalizePath(filePath));
				if (existing instanceof TFile) {
					return vault.cachedRead(existing);
				}
				return "";
			},
			write: async (filePath: string, content: string) => {
				const normalized = safeNormalizePath(filePath);
				const existing = vault.getAbstractFileByPath(normalized);
				if (existing instanceof TFile) {
					await vault.modify(existing, content);
					return;
				}
				await vault.create(normalized, content);
			},
			exists: async (filePath: string) => vault.getAbstractFileByPath(safeNormalizePath(filePath)) instanceof TFile,
			ensureParent: async (filePath: string) => {
				const parentPath = safeNormalizePath(filePath.split("/").slice(0, -1).join("/"));
				if (!parentPath) {
					return;
				}
				const segments = parentPath.split("/");
				let current = "";
				for (const segment of segments) {
					current = current ? `${current}/${segment}` : segment;
					const existing = vault.getAbstractFileByPath(current);
					if (existing instanceof TFolder) {
						continue;
					}
					if (existing instanceof TFile) {
						await vault.rename(existing, `${current}.legacy-file-${Date.now()}`);
					}
					if (!vault.getAbstractFileByPath(current)) {
						await vault.createFolder(current);
					}
				}
			},
		};
	}

	private createFsAdapter(): MemoryFileAdapter {
		return {
			read: async (filePath: string) => {
				try {
					return await readFile(filePath, "utf8");
				} catch {
					return "";
				}
			},
			write: async (filePath: string, content: string) => {
				await writeFile(filePath, content, "utf8");
			},
			exists: async (filePath: string) => {
				try {
					await readFile(filePath, "utf8");
					return true;
				} catch {
					return false;
				}
			},
			ensureParent: async (filePath: string) => {
				await mkdir(path.dirname(filePath), { recursive: true });
			},
		};
	}
}
