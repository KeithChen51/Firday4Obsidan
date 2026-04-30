import {
	cloneMutationPlan,
	hashMutationContent,
	MutationApplyStatus,
	MutationPlan,
	setMutationPlanStatus,
} from "./MutationPlan";

export interface MutationVaultPort {
	read(path: string, plan: MutationPlan): Promise<string | null>;
	write(path: string, content: string, plan: MutationPlan): Promise<void>;
	delete(path: string, plan: MutationPlan): Promise<void>;
}

export interface MutationApplierOptions {
	validatePath?: (path: string, plan: MutationPlan) => boolean | string;
}

export interface MutationApplyResult {
	status: MutationApplyStatus;
	plan: MutationPlan;
	reason?: string;
}

export class MutationApplier {
	constructor(
		private readonly vault: MutationVaultPort,
		private readonly options: MutationApplierOptions = {},
	) {}

	async apply(plan: MutationPlan): Promise<MutationApplyResult> {
		if (plan.status !== "pending") {
			return this.failed(plan, `Mutation plan is not pending: ${plan.status}.`);
		}

		const pathError = this.validatePlanPaths(plan);
		if (pathError) {
			return this.failed(plan, pathError);
		}

		const conflict = await this.findConflict(plan);
		if (conflict) {
			return {
				status: "conflicted",
				plan: setMutationPlanStatus(plan, "conflicted"),
				reason: conflict,
			};
		}

		try {
			for (const item of plan.items) {
				if (item.changeType === "delete") {
					await this.vault.delete(item.path, plan);
					continue;
				}
				const resolvedContent = await this.resolveProposedContent(plan, item);
				if (!resolvedContent.ok) {
					return this.failed(plan, resolvedContent.reason);
				}
				await this.vault.write(item.path, resolvedContent.content, plan);
			}
		} catch (error) {
			return this.failed(plan, error instanceof Error ? error.message : String(error ?? "Mutation apply failed."));
		}

		return {
			status: "applied",
			plan: setMutationPlanStatus(plan, "applied"),
		};
	}

	async reject(plan: MutationPlan): Promise<MutationApplyResult> {
		if (plan.status === "applied") {
			return this.failed(plan, "Mutation plan is already applied.");
		}
		return {
			status: "rejected",
			plan: setMutationPlanStatus(plan, "rejected"),
		};
	}

	private failed(plan: MutationPlan, reason: string): MutationApplyResult {
		return {
			status: "failed",
			plan: cloneMutationPlan(plan),
			reason,
		};
	}

	private validatePlanPaths(plan: MutationPlan): string {
		const paths = [plan.targetPath, ...plan.items.map((item) => item.path)];
		for (const filePath of paths) {
			const error = this.validatePath(filePath, plan);
			if (error) {
				return error;
			}
		}
		return "";
	}

	private validatePath(filePath: string, plan: MutationPlan): string {
		const rawPath = String(filePath ?? "");
		const normalized = rawPath.replace(/\\/g, "/");
		if (!normalized.trim()) {
			return "Invalid path: empty mutation path.";
		}
		if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
			return `Invalid path: ${rawPath}`;
		}
		if (normalized.split("/").some((segment) => segment === "..")) {
			return `Invalid path: ${rawPath}`;
		}
		const decision = this.options.validatePath?.(normalized, plan);
		if (decision === false) {
			return `Invalid path: ${rawPath}`;
		}
		if (typeof decision === "string") {
			return decision;
		}
		return "";
	}

	private async findConflict(plan: MutationPlan): Promise<string> {
		const snapshot = cloneMutationPlan(plan);
		for (const item of snapshot.items) {
			const currentContent = await this.vault.read(item.path, snapshot);
			const currentHash = hashMutationContent(currentContent ?? "");
			if (currentHash !== item.beforeHash) {
				return `Before snapshot mismatch for ${item.path}.`;
			}
		}
		return "";
	}

	private async resolveProposedContent(
		plan: MutationPlan,
		item: MutationPlan["items"][number],
	): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
		if (item.proposedPatch) {
			const currentContent = await this.vault.read(item.path, plan) ?? "";
			const content = applyReplaceRangePatch(currentContent, item.proposedPatch);
			if (hashMutationContent(content) !== item.afterHash) {
				return {
					ok: false,
					reason: `Stored mutation patch no longer reconstructs proposed content for ${item.path}.`,
				};
			}
			return { ok: true, content };
		}
		if (item.contentStorage?.after === "omitted") {
			return {
				ok: false,
				reason: `Proposed content was omitted from persisted mutation plan for ${item.path}.`,
			};
		}
		if (hashMutationContent(item.after) !== item.afterHash) {
			return {
				ok: false,
				reason: `Stored proposed content hash mismatch for ${item.path}.`,
			};
		}
		return { ok: true, content: item.after };
	}
}

function applyReplaceRangePatch(content: string, patch: NonNullable<MutationPlan["items"][number]["proposedPatch"]>): string {
	return `${content.slice(0, patch.start)}${patch.insert}${content.slice(patch.start + patch.deleteCount)}`;
}
