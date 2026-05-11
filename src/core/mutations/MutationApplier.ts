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

export type MutationApplyReasonCode =
	| "not_pending"
	| "invalid_path"
	| "before_snapshot_mismatch"
	| "resolved_content_failed"
	| "apply_exception"
	| "already_applied";

export interface MutationApplyReason {
	code: MutationApplyReasonCode;
	path?: string;
	detail?: string;
}

export interface MutationApplyResult {
	status: MutationApplyStatus;
	plan: MutationPlan;
	reason?: string;
	reasonCode?: MutationApplyReasonCode;
	reasonDetail?: MutationApplyReason;
}

export class MutationApplier {
	constructor(
		private readonly vault: MutationVaultPort,
		private readonly options: MutationApplierOptions = {},
	) {}

	async apply(plan: MutationPlan): Promise<MutationApplyResult> {
		if (plan.status !== "pending") {
			return this.failed(plan, {
				code: "not_pending",
				detail: `Mutation plan is not pending: ${plan.status}.`,
			});
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
				reason: formatMutationApplyReason(conflict),
				reasonCode: conflict.code,
				reasonDetail: conflict,
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
			return this.failed(plan, {
				code: "apply_exception",
				detail: error instanceof Error ? error.message : String(error ?? "Mutation apply failed."),
			});
		}

		return {
			status: "applied",
			plan: setMutationPlanStatus(plan, "applied"),
		};
	}

	async reject(plan: MutationPlan): Promise<MutationApplyResult> {
		if (plan.status === "applied") {
			return this.failed(plan, {
				code: "already_applied",
				detail: "Mutation plan is already applied.",
			});
		}
		return {
			status: "rejected",
			plan: setMutationPlanStatus(plan, "rejected"),
		};
	}

	private failed(plan: MutationPlan, reason: MutationApplyReason): MutationApplyResult {
		return {
			status: "failed",
			plan: cloneMutationPlan(plan),
			reason: formatMutationApplyReason(reason),
			reasonCode: reason.code,
			reasonDetail: reason,
		};
	}

	private validatePlanPaths(plan: MutationPlan): MutationApplyReason | null {
		const paths = [plan.targetPath, ...plan.items.map((item) => item.path)];
		for (const filePath of paths) {
			const error = this.validatePath(filePath, plan);
			if (error) {
				return error;
			}
		}
		return null;
	}

	private validatePath(filePath: string, plan: MutationPlan): MutationApplyReason | null {
		const rawPath = String(filePath ?? "");
		const normalized = rawPath.replace(/\\/g, "/");
		if (!normalized.trim()) {
			return { code: "invalid_path", detail: "Invalid path: empty mutation path." };
		}
		if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
			return { code: "invalid_path", path: rawPath, detail: `Invalid path: ${rawPath}` };
		}
		if (normalized.split("/").some((segment) => segment === "..")) {
			return { code: "invalid_path", path: rawPath, detail: `Invalid path: ${rawPath}` };
		}
		const decision = this.options.validatePath?.(normalized, plan);
		if (decision === false) {
			return { code: "invalid_path", path: rawPath, detail: `Invalid path: ${rawPath}` };
		}
		if (typeof decision === "string") {
			return { code: "invalid_path", path: rawPath, detail: decision };
		}
		return null;
	}

	private async findConflict(plan: MutationPlan): Promise<MutationApplyReason | null> {
		const snapshot = cloneMutationPlan(plan);
		for (const item of snapshot.items) {
			const currentContent = await this.vault.read(item.path, snapshot);
			const currentHash = hashMutationContent(currentContent ?? "");
			if (currentHash !== item.beforeHash) {
				return { code: "before_snapshot_mismatch", path: item.path };
			}
		}
		return null;
	}

	private async resolveProposedContent(
		plan: MutationPlan,
		item: MutationPlan["items"][number],
	): Promise<{ ok: true; content: string } | { ok: false; reason: MutationApplyReason }> {
		if (item.proposedPatch) {
			const currentContent = await this.vault.read(item.path, plan) ?? "";
			const content = applyReplaceRangePatch(currentContent, item.proposedPatch);
			if (hashMutationContent(content) !== item.afterHash) {
				return {
					ok: false,
					reason: {
						code: "resolved_content_failed",
						path: item.path,
						detail: `Stored mutation patch no longer reconstructs proposed content for ${item.path}.`,
					},
				};
			}
			return { ok: true, content };
		}
		if (item.contentStorage?.after === "omitted") {
			return {
				ok: false,
				reason: {
					code: "resolved_content_failed",
					path: item.path,
					detail: `Proposed content was omitted from persisted mutation plan for ${item.path}.`,
				},
			};
		}
		if (hashMutationContent(item.after) !== item.afterHash) {
			return {
				ok: false,
				reason: {
					code: "resolved_content_failed",
					path: item.path,
					detail: `Stored proposed content hash mismatch for ${item.path}.`,
				},
			};
		}
		return { ok: true, content: item.after };
	}
}

function applyReplaceRangePatch(content: string, patch: NonNullable<MutationPlan["items"][number]["proposedPatch"]>): string {
	return `${content.slice(0, patch.start)}${patch.insert}${content.slice(patch.start + patch.deleteCount)}`;
}

function formatMutationApplyReason(reason: MutationApplyReason): string {
	switch (reason.code) {
		case "before_snapshot_mismatch":
			return "文件已在确认前发生变化，FRIDAY 需要重新检查这次修改。";
		case "invalid_path":
			return "这个文件位置不在当前可处理范围内。";
		case "not_pending":
			return "这次修改已经不在待确认状态。";
		case "already_applied":
			return "这次修改已经应用过。";
		case "resolved_content_failed":
			return "这次修改暂时无法应用，FRIDAY 需要重新检查。";
		case "apply_exception":
			return "修改暂时未能写入 Obsidian。";
		default:
			return "这次修改暂时无法应用，FRIDAY 需要重新检查。";
	}
}
