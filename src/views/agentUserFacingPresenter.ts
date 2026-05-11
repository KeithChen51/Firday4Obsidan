import type { AgentTask, AgentTaskAction, AgentTaskStatus } from "../core/tasks/AgentTask";
import type { MutationApplyReason, MutationApplyReasonCode } from "../core/mutations/MutationApplier";

export interface UserFacingActionView {
	id: AgentTaskAction;
	label: string;
	tone: "primary" | "secondary" | "danger";
}

export interface UserFacingTaskView {
	title: string;
	statusLabel: string;
	summary: string;
	waitingText: string;
	mutationText: string;
	actions: UserFacingActionView[];
}

export function formatUserFacingTaskStatus(status: AgentTaskStatus): string {
	switch (status) {
		case "created":
		case "running":
			return "正在处理";
		case "waiting_for_approval":
			return "等待确认";
		case "waiting_for_user":
			return "等待你的补充";
		case "failed":
			return "运行遇到问题";
		case "cancelled":
			return "已停止";
		case "completed":
			return "已完成";
		default:
			return "正在处理";
	}
}

export function formatUserFacingTaskAction(action: AgentTaskAction): UserFacingActionView {
	switch (action) {
		case "cancel":
			return { id: action, label: "停止", tone: "secondary" };
		case "continue":
			return { id: action, label: "继续", tone: "primary" };
		case "apply":
			return { id: action, label: "应用修改", tone: "primary" };
		case "reject":
			return { id: action, label: "不应用", tone: "secondary" };
		case "resume":
			return { id: action, label: "恢复", tone: "primary" };
		case "retry":
			return { id: action, label: "重试", tone: "primary" };
		default:
			return { id: action, label: "继续", tone: "primary" };
	}
}

export function buildUserFacingTaskView(task: Pick<
	AgentTask,
	"title" | "status" | "summary" | "failureReason" | "waitingForApproval" | "waitingForUser" | "availableActions" | "pendingMutationCount"
>): UserFacingTaskView {
	const waitingText = productizeRuntimeText(
		task.waitingForUser?.prompt ||
		task.waitingForUser?.summary ||
		task.waitingForApproval?.summary ||
		"",
	);
	const summary = productizeRuntimeText(task.failureReason || task.summary) || waitingText || "FRIDAY 正在处理。";
	return {
		title: productizeRuntimeText(task.title) || "FRIDAY 工作",
		statusLabel: formatUserFacingTaskStatus(task.status),
		summary,
		waitingText,
		mutationText: task.pendingMutationCount > 0
			? `已准备好 ${task.pendingMutationCount} 个待应用的文件修改，确认后才会写入 Obsidian。`
			: "",
		actions: task.availableActions.map(formatUserFacingTaskAction),
	};
}

export function productizeRuntimeText(raw: string | undefined | null): string {
	const text = String(raw ?? "").trim();
	if (!text) {
		return "";
	}
	if (/Before snapshot mismatch/i.test(text)) {
		return formatMutationApplyReasonForUser({ code: "before_snapshot_mismatch" });
	}
	if (/Waiting for approval/i.test(text)) {
		return "等待你确认后继续";
	}
	if (/Waiting for user|Waiting for you/i.test(text)) {
		return "等待你的补充";
	}
	if (/Tool approval required|Allow once|Allow session|Allow always/i.test(text)) {
		return "需要你确认后继续";
	}
	if (/file change\(s\) pending review|Pending file changes|\b\d+\s+file changes?\s+pending review\b/i.test(text)) {
		return "已准备好待应用的文件修改，确认后才会写入 Obsidian。";
	}
	if (/Applied file creation/i.test(text)) {
		return "文件已创建。";
	}
	if (/Applied file update|Applied file change/i.test(text)) {
		return "文件已更新。";
	}
	if (/Applied file deletion/i.test(text)) {
		return "文件已删除。";
	}
	if (/Checkpoint resume skipped/i.test(text)) {
		return "这次恢复已跳过，FRIDAY 会重新检查后继续。";
	}
	if (/Checkpoint resume completed|Resuming from checkpoint/i.test(text)) {
		return "FRIDAY 正在恢复进度。";
	}
	if (/Checkpoint saved/i.test(text)) {
		return "FRIDAY 已保存当前进度。";
	}
	if (/\bcheckpoint\b|model_request|model request|View replay|\breplay\b|\bdebug\b|raw reasoning/i.test(text)) {
		return "";
	}
	return text;
}

export function productizeActionLabel(actionId: string, label: string): string {
	switch (actionId) {
		case "cancel":
			return "停止";
		case "continue":
			return "继续";
		case "resume":
			return "恢复";
		case "retry":
			return "重试";
		case "apply":
			return "应用修改";
		case "approve":
			return "允许执行";
		case "reject":
			return "拒绝";
		case "view_changes":
			return "查看改动";
		case "view_replay":
			return "";
		default:
			return productizeRuntimeText(label) || label;
	}
}

export function formatMutationApplyReasonForUser(
	reason: MutationApplyReason | MutationApplyReasonCode | undefined | null,
): string {
	const code = typeof reason === "string" ? reason : reason?.code;
	switch (code) {
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
