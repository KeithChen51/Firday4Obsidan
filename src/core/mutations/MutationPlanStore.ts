import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

import {
	cloneMutationPlan,
	hashMutationContent,
	type MutationContentPatch,
	type MutationContentBlob,
	MutationPlan,
	type MutationPlanItem,
	MutationPlanStatus,
	setMutationPlanStatus,
} from "./MutationPlan";

export interface MutationPlanStoreOptions {
	storePath?: string | (() => string);
	maxPersistedContentChars?: number;
}

const DEFAULT_MAX_PERSISTED_CONTENT_CHARS = 4096;

export class MutationPlanStore {
	private readonly plans = new Map<string, MutationPlan>();
	private loaded = false;

	constructor(private readonly options: MutationPlanStoreOptions = {}) {}

	async save(plan: MutationPlan): Promise<void> {
		await this.ensureLoaded();
		this.plans.set(plan.id, cloneMutationPlan(plan));
		await this.flush();
	}

	async get(planId: string): Promise<MutationPlan | undefined> {
		await this.ensureLoaded();
		const plan = this.plans.get(planId);
		return plan ? cloneMutationPlan(plan) : undefined;
	}

	async list(): Promise<MutationPlan[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.plans.values()]);
	}

	async getByTurnId(turnId: string): Promise<MutationPlan[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.plans.values()].filter((plan) => plan.turnId === turnId));
	}

	async getByConversationId(conversationId: string): Promise<MutationPlan[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.plans.values()].filter((plan) => plan.conversationId === conversationId));
	}

	async getPending(): Promise<MutationPlan[]> {
		await this.ensureLoaded();
		return this.cloneList([...this.plans.values()].filter((plan) => plan.status === "pending"));
	}

	async replace(plan: MutationPlan): Promise<void> {
		await this.save(plan);
	}

	async markStatus(planId: string, status: MutationPlanStatus): Promise<MutationPlan | undefined> {
		await this.ensureLoaded();
		const plan = this.plans.get(planId);
		if (!plan) {
			return undefined;
		}
		const next = setMutationPlanStatus(plan, status);
		this.plans.set(planId, next);
		await this.flush();
		return cloneMutationPlan(next);
	}

	private cloneList(plans: MutationPlan[]): MutationPlan[] {
		return plans.map((plan) => cloneMutationPlan(plan));
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		const filePath = this.resolveStorePath();
		if (!filePath) {
			return;
		}
		let raw = "";
		try {
			raw = await readFile(filePath, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		if (!raw.trim()) {
			return;
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return;
		}
		for (const item of parsed) {
			if (isMutationPlanLike(item)) {
				const plan = await this.hydratePersistedPlan(item);
				this.plans.set(plan.id, plan);
			}
		}
	}

	private async flush(): Promise<void> {
		const filePath = this.resolveStorePath();
		if (!filePath) {
			return;
		}
		await mkdir(path.dirname(filePath), { recursive: true });
		await this.resetBlobRoot(filePath);
		const plans = await Promise.all(this.cloneList([...this.plans.values()]).map((plan) => this.toPersistedPlan(plan)));
		await writeFile(filePath, `${JSON.stringify(plans, null, 2)}\n`, "utf8");
	}

	private resolveStorePath(): string {
		const storePath = this.options.storePath;
		if (!storePath) {
			return "";
		}
		return typeof storePath === "function" ? storePath() : storePath;
	}

	private async toPersistedPlan(plan: MutationPlan): Promise<MutationPlan> {
		return {
			...plan,
			items: await Promise.all(plan.items.map((item, index) => this.toPersistedItem(plan, item, index))),
		};
	}

	private async toPersistedItem(plan: MutationPlan, item: MutationPlanItem, itemIndex: number): Promise<MutationPlanItem> {
		if (item.changeType === "delete") {
			return {
				...item,
				before: "",
				after: "",
				proposedBlob: undefined,
				contentStorage: { before: "omitted", after: "omitted" },
			};
		}
		const maxChars = this.options.maxPersistedContentChars ?? DEFAULT_MAX_PERSISTED_CONTENT_CHARS;
		if (item.after.length <= maxChars) {
			return {
				...item,
				before: "",
				proposedBlob: undefined,
				contentStorage: { before: "omitted", after: "inline" },
			};
		}
		const proposedPatch = item.proposedPatch ?? buildReplaceRangePatch(item.before, item.after);
		if (proposedPatch && proposedPatch.insert.length <= maxChars) {
			return {
				...item,
				before: "",
				after: "",
				proposedPatch,
				proposedBlob: undefined,
				contentStorage: { before: "omitted", after: "patch" },
			};
		}
		const proposedBlob = await this.writeProposedBlob(plan.id, itemIndex, item.after, item.afterHash);
		return {
			...item,
			before: "",
			after: "",
			proposedPatch: undefined,
			proposedBlob,
			contentStorage: { before: "omitted", after: "blob" },
		};
	}

	private async hydratePersistedPlan(plan: MutationPlan): Promise<MutationPlan> {
		const next = cloneMutationPlan(plan);
		next.items = await Promise.all(next.items.map((item) => this.hydratePersistedItem(item)));
		return next;
	}

	private async hydratePersistedItem(item: MutationPlanItem): Promise<MutationPlanItem> {
		if (item.contentStorage?.after !== "blob" || !item.proposedBlob) {
			return item;
		}
		const content = await readFile(this.resolveBlobPath(item.proposedBlob.key), "utf8");
		const hash = hashMutationContent(content);
		if (hash !== item.proposedBlob.hash || hash !== item.afterHash) {
			throw new Error(`Persisted mutation blob hash mismatch for ${item.path}.`);
		}
		return {
			...item,
			after: content,
		};
	}

	private async writeProposedBlob(
		planId: string,
		itemIndex: number,
		content: string,
		expectedHash: string,
	): Promise<MutationContentBlob> {
		const actualHash = hashMutationContent(content);
		if (actualHash !== expectedHash) {
			throw new Error("Cannot persist mutation blob with mismatched content hash.");
		}
		const key = `${safePathSegment(planId)}/${itemIndex}-${safePathSegment(expectedHash)}.txt`;
		const blobPath = this.resolveBlobPath(key);
		await mkdir(path.dirname(blobPath), { recursive: true });
		await writeFile(blobPath, content, "utf8");
		return {
			key,
			hash: expectedHash,
			size: content.length,
		};
	}

	private resolveBlobPath(key: string): string {
		const filePath = this.resolveStorePath();
		const segments = key.split("/");
		if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
			throw new Error(`Invalid mutation blob key: ${key}`);
		}
		const blobRoot = this.resolveBlobRoot(filePath);
		const blobPath = path.resolve(blobRoot, ...segments);
		if (blobPath !== blobRoot && !blobPath.startsWith(`${blobRoot}${path.sep}`)) {
			throw new Error(`Invalid mutation blob key: ${key}`);
		}
		return blobPath;
	}

	private async resetBlobRoot(filePath: string): Promise<void> {
		const blobRoot = this.resolveBlobRoot(filePath);
		await rm(blobRoot, { recursive: true, force: true });
	}

	private resolveBlobRoot(filePath: string): string {
		if (!filePath) {
			throw new Error("Mutation plan blob storage requires a store path.");
		}
		const blobRoot = path.resolve(path.dirname(filePath), ".mutation-plan-blobs");
		if (blobRoot === path.parse(blobRoot).root) {
			throw new Error("Refusing to use filesystem root for mutation plan blob storage.");
		}
		return blobRoot;
	}
}

function buildReplaceRangePatch(before: string, after: string): MutationContentPatch | undefined {
	let prefix = 0;
	while (
		prefix < before.length &&
		prefix < after.length &&
		before.charCodeAt(prefix) === after.charCodeAt(prefix)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
	) {
		suffix += 1;
	}
	return {
		type: "replace_range",
		start: prefix,
		deleteCount: before.length - prefix - suffix,
		insert: after.slice(prefix, after.length - suffix),
	};
}

function isMutationPlanLike(value: unknown): value is MutationPlan {
	if (!value || typeof value !== "object") {
		return false;
	}
	const plan = value as Partial<MutationPlan>;
	return typeof plan.id === "string" &&
		typeof plan.agentId === "string" &&
		typeof plan.operation === "string" &&
		typeof plan.targetPath === "string" &&
		typeof plan.status === "string" &&
		Array.isArray(plan.items);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error);
}

function safePathSegment(value: string): string {
	const segment = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	return segment || "default";
}
