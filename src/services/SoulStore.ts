import { readFile, writeFile } from "fs/promises";
import path from "path";
import { LocalStateRootService } from "./LocalStateRootService";
import { SoulDefinition, SoulState, SoulSummary } from "../types/soul";

interface SoulRegistryEntry {
	id: string;
	name: string;
	summary: string;
	builtIn: boolean;
	editable: boolean;
	archived: boolean;
	updatedAt: string;
}

function slugifySoulName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "soul";
}

export class SoulStore {
	constructor(private readonly localStateRootService: LocalStateRootService) {}

	getSoulsRoot(): string {
		return this.localStateRootService.resolve("souls");
	}

	getRegistryPath(): string {
		return this.localStateRootService.resolve("souls", "registry.json");
	}

	getStatePath(): string {
		return this.localStateRootService.resolve("souls", "state.json");
	}

	getDefinitionsRoot(): string {
		return this.localStateRootService.resolve("souls", "definitions");
	}

	getDefinitionPath(id: string): string {
		return path.join(this.getDefinitionsRoot(), `${id}.json`);
	}

	async listSouls(): Promise<SoulSummary[]> {
		const registry = await this.readRegistry();
		const items = await Promise.all(registry.map((entry) => this.getSoul(entry.id)));
		return items.filter((item): item is SoulSummary => Boolean(item));
	}

	async getSoul(id: string): Promise<SoulSummary | null> {
		try {
			const raw = await readFile(this.getDefinitionPath(id), "utf8");
			return JSON.parse(raw) as SoulDefinition;
		} catch {
			return null;
		}
	}

	async createSoul(input: { id?: string; name: string; summary: string; description?: string }): Promise<SoulSummary> {
		await this.ensureBaseLayout();
		const now = new Date().toISOString();
		const id = this.ensureUniqueId(input.id || slugifySoulName(input.name));
		const soul: SoulDefinition = {
			id,
			name: input.name.trim() || "Untitled Soul",
			summary: input.summary.trim(),
			description: input.description?.trim() || input.summary.trim(),
			rolePrompt: input.description?.trim() || input.summary.trim(),
			tonePrompt: "",
			behaviorRules: [],
			antiPatterns: [],
			presetRefs: [],
			tags: [],
			builtIn: false,
			editable: true,
			archived: false,
			createdAt: now,
			updatedAt: now,
		};
		await this.writeSoul(soul);
		return soul;
	}

	async setActiveSoul(id: string): Promise<void> {
		await this.ensureBaseLayout();
		const state = await this.readState();
		state.activeSoulId = id;
		state.lastUsedSoulId = id;
		state.recentlyUsedSoulIds = [id, ...state.recentlyUsedSoulIds.filter((item) => item !== id)].slice(0, 8);
		await writeFile(this.getStatePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
	}

	async updateSoul(id: string, updates: Partial<SoulDefinition>): Promise<SoulSummary> {
		await this.ensureBaseLayout();
		const existing = await this.getSoul(id);
		if (!existing) {
			throw new Error(`Soul not found: ${id}`);
		}
		const next: SoulDefinition = {
			...(existing as SoulDefinition),
			...updates,
			id,
			updatedAt: new Date().toISOString(),
		};
		await this.writeSoul(next);
		return next;
	}

	private async ensureBaseLayout(): Promise<void> {
		await this.localStateRootService.ensureBaseLayout();
	}

	private async readRegistry(): Promise<SoulRegistryEntry[]> {
		await this.ensureBaseLayout();
		try {
			const raw = await readFile(this.getRegistryPath(), "utf8");
			return JSON.parse(raw) as SoulRegistryEntry[];
		} catch {
			return [];
		}
	}

	private async readState(): Promise<SoulState> {
		try {
			const raw = await readFile(this.getStatePath(), "utf8");
			return JSON.parse(raw) as SoulState;
		} catch {
			return {
				activeSoulId: "",
				lastUsedSoulId: "",
				recentlyUsedSoulIds: [],
			};
		}
	}

	private async writeSoul(soul: SoulDefinition): Promise<void> {
		await writeFile(this.getDefinitionPath(soul.id), `${JSON.stringify(soul, null, 2)}\n`, "utf8");
		const registry = await this.readRegistry();
		const nextEntry: SoulRegistryEntry = {
			id: soul.id,
			name: soul.name,
			summary: soul.summary,
			builtIn: soul.builtIn,
			editable: soul.editable,
			archived: soul.archived,
			updatedAt: soul.updatedAt,
		};
		const nextRegistry = [...registry.filter((entry) => entry.id !== soul.id), nextEntry].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		await writeFile(this.getRegistryPath(), `${JSON.stringify(nextRegistry, null, 2)}\n`, "utf8");
	}

	private ensureUniqueId(baseId: string): string {
		return slugifySoulName(baseId);
	}
}
