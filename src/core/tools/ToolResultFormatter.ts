import type { ToolResultFormatOptions, ToolResultPayload } from "./ToolResultContract";

export const DEFAULT_MAX_MODEL_RESULT_CHARS = 5000;

export function formatForModel(payload: ToolResultPayload, options: ToolResultFormatOptions = {}): string {
	const maxChars = options.maxChars ?? DEFAULT_MAX_MODEL_RESULT_CHARS;
	if (payload.tool === "use_skill" && payload.ok) {
		const data = payload.data as { command?: string; summary?: string } | undefined;
		const summary = data?.summary?.trim() || `Loaded skill ${data?.command ?? ""}`.trim();
		return `TOOL_RESULT ${safeStringify({
			ok: true,
			tool: "use_skill",
			data: { command: data?.command, summary },
		}, maxChars)}`;
	}
	if (payload.tool === "memory" && payload.data && typeof payload.data === "object") {
		const data = payload.data as { ok?: boolean; scope?: string; summary?: string; code?: string; reason?: string };
		return `TOOL_RESULT ${safeStringify({
			ok: Boolean(data.ok),
			tool: "memory",
			data: {
				scope: data.scope,
				summary: data.summary,
				code: data.code,
				reason: data.reason,
			},
		}, maxChars)}`;
	}
	return `TOOL_RESULT ${safeStringify(payload, maxChars)}`;
}

export function summarizeForTrace(tool: string, data: unknown): string {
	if (tool === "use_skill") {
		const payload = data as { command?: string; summary?: string } | undefined;
		return payload?.summary?.trim() || `Loaded skill ${payload?.command ?? ""}`.trim();
	}
	if (tool === "read") {
		const payload = data as { path?: string; truncated?: boolean };
		return `Read ${payload.path ?? ""}${payload.truncated ? " (truncated)" : ""}`.trim();
	}
	if (tool === "memory") {
		const payload = data as { summary?: string } | undefined;
		return payload?.summary?.trim() || "Memory updated";
	}
	if (tool === "ls") {
		const payload = data as { items?: unknown[] };
		return `Listed ${payload.items?.length ?? 0} item(s)`;
	}
	if (tool === "grep") {
		const payload = data as { matches?: unknown[] };
		return `grep matched ${payload.matches?.length ?? 0} result(s)`;
	}
	if (tool === "search_text") {
		const payload = data as { matches?: unknown[] };
		return `search_text matched ${payload.matches?.length ?? 0} result(s)`;
	}
	if (tool === "glob") {
		const payload = data as { files?: unknown[] };
		return `glob matched ${payload.files?.length ?? 0} file(s)`;
	}
	if (tool === "compile_wiki") {
		const payload = data as {
			projectId?: string;
			requested?: number;
			processed?: number;
			succeeded?: number;
			failed?: number;
			updatedDocs?: string[];
			updatedIndex?: string;
			updatedLog?: string;
		};
		const updatedDocs = Array.isArray(payload.updatedDocs) ? payload.updatedDocs.length : 0;
		const indexState = payload.updatedIndex ? "index updated" : "index unchanged";
		const logState = payload.updatedLog ? "log updated" : "log unchanged";
		return `Wiki compile ${payload.projectId ?? ""} (requested ${payload.requested ?? 0}, processed ${payload.processed ?? 0}, success ${payload.succeeded ?? 0}, failed ${payload.failed ?? 0}, docs ${updatedDocs}, ${indexState}, ${logState})`.trim();
	}
	if (tool === "write") {
		const payload = data as { path?: string; status?: string; type?: string; changeType?: string };
		if (isPendingFileMutationStatus(payload.status)) {
			return formatPendingFileMutationSummary({
				operation: "write",
				targetPath: payload.path,
				changeType: payload.changeType ?? payload.type,
			});
		}
		return `Write completed ${payload.path ?? ""}`.trim();
	}
	if (tool === "delete") {
		const payload = data as { path?: string; deletedType?: string; status?: string };
		const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
		if (isPendingFileMutationStatus(payload.status)) {
			return formatPendingFileMutationSummary({
				operation: "delete",
				targetPath: payload.path,
				changeType: "delete",
			});
		}
		return `Delete completed ${targetLabel} ${payload.path ?? ""}`.trim();
	}
	if (tool === "edit") {
		const payload = data as { path?: string; appliedEdits?: number; status?: string };
		if (isPendingFileMutationStatus(payload.status)) {
			return formatPendingFileMutationSummary({
				operation: "edit",
				targetPath: payload.path,
				changeType: "update",
			});
		}
		return `Edited ${payload.path ?? ""} (${payload.appliedEdits ?? 0} replacement(s))`.trim();
	}
	if (tool === "exec") {
		const payload = data as { exitCode?: number; timedOut?: boolean; routedToDelete?: boolean; path?: string; deletedType?: string };
		if (payload.routedToDelete) {
			const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
			return `Exec redirected to native delete (${targetLabel} ${payload.path ?? ""})`.trim();
		}
		const status = payload.timedOut ? "timed out" : `exit code ${payload.exitCode ?? "?"}`;
		return `Exec completed (${status})`;
	}
	return `${tool} completed`;
}

export interface FileMutationSummaryInput {
	operation?: string;
	targetPath?: string;
	changeType?: string;
	status?: string;
	itemCount?: number;
	reason?: string;
}

export function isPendingFileMutationStatus(status: string | undefined): boolean {
	if (status === undefined) {
		return false;
	}
	const normalized = status.trim().toLowerCase();
	return !normalized || normalized === "pending" || normalized === "pending_review" || normalized === "planned";
}

export function formatPendingFileMutationSummary(input: FileMutationSummaryInput): string {
	return withTarget(`已准备${fileMutationLabel(input)}，确认后才会写入 Obsidian`, input.targetPath);
}

export function formatFileMutationEventSummary(input: FileMutationSummaryInput): string {
	const normalizedStatus = (input.status ?? "pending").trim().toLowerCase();
	if (isPendingFileMutationStatus(normalizedStatus)) {
		return formatPendingFileMutationSummary(input);
	}
	const label = fileMutationLabel(input);
	if (normalizedStatus === "applied" || normalizedStatus === "accepted") {
		return withTarget(`已应用${label}`, input.targetPath);
	}
	if (normalizedStatus === "rejected") {
		return withTarget(`已取消${label}，文件未被写入`, input.targetPath);
	}
	if (normalizedStatus === "conflicted") {
		return withTarget(`${label}需要重新确认，文件已在外部变化`, input.targetPath);
	}
	if (normalizedStatus === "apply_failed") {
		return withTarget(`${label}未能应用`, input.targetPath);
	}
	return withTarget(`已确认${label}`, input.targetPath);
}

function fileMutationLabel(input: FileMutationSummaryInput): string {
	const operation = (input.operation ?? "").trim().toLowerCase();
	const changeType = (input.changeType ?? "").trim().toLowerCase();
	if (changeType === "create") {
		return "文件创建";
	}
	if (changeType === "delete" || operation === "delete") {
		return "文件删除";
	}
	if (changeType === "update" || operation === "edit") {
		return "文件更新";
	}
	return "文件修改";
}

function withTarget(summary: string, targetPath: string | undefined): string {
	const target = targetPath?.trim();
	return target ? `${summary}：${target}` : summary;
}

function safeStringify(value: unknown, maxChars: number): string {
	let raw = "";
	try {
		raw = JSON.stringify(value);
	} catch {
		raw = String(value ?? "");
	}
	return truncateText(raw, maxChars);
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}...`;
}
