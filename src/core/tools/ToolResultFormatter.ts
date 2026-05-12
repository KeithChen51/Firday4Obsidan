import type { ToolResultFormatOptions, ToolResultPayload } from "./ToolResultContract";

export const DEFAULT_MAX_MODEL_RESULT_CHARS = 5000;

export interface ToolResultChannels {
	modelContent: string;
	traceSummary: string;
	userFallback: string;
}

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

export function formatToolResultChannels(payload: ToolResultPayload, options: ToolResultFormatOptions = {}): ToolResultChannels {
	return {
		modelContent: formatForModel(payload, options),
		traceSummary: summarizePayloadForTrace(payload),
		userFallback: summarizeForUserFallback(payload),
	};
}

export function summarizeForUserFallback(payload: ToolResultPayload | null | undefined): string {
	if (!payload) {
		return "";
	}
	if (!payload.ok) {
		return `I couldn't complete the ${payload.tool} step. Check the process details for the error and recovery suggestions.`;
	}
	if (payload.tool === "read") {
		const data = payload.data as { path?: string; content?: string } | undefined;
		const path = data?.path?.trim();
		if (!path) {
			return "";
		}
		const content = typeof data?.content === "string" ? truncateText(data.content.trim(), 320) : "";
		return content
			? `I read ${path}. Here is the relevant excerpt:\n${content}`
			: `I read ${path}, but the file is empty.`;
	}
	if (payload.tool === "ls" || payload.tool === "list_files") {
		const data = payload.data as { path?: string; items?: string[] } | undefined;
		const items = normalizeStringList(data?.items);
		const scope = data?.path?.trim() || "the current project";
		if (items.length === 0) {
			return `${scope} has no visible items.`;
		}
		return `${scope} contains ${items.length} visible ${plural(items.length, "item")}:\n${formatPreviewList(items)}`;
	}
	if (payload.tool === "grep" || payload.tool === "search_text") {
		const data = payload.data as { matches?: unknown[] } | undefined;
		const count = Array.isArray(data?.matches) ? data.matches.length : 0;
		if (count === 0) {
			return "I did not find matching text.";
		}
		return `I found ${count} text ${plural(count, "match")}. Narrow the search or choose a file to inspect next.`;
	}
	if (payload.tool === "glob") {
		const data = payload.data as { files?: string[] } | undefined;
		const files = normalizeStringList(data?.files);
		if (files.length === 0) {
			return "I did not find matching files.";
		}
		return `I found ${files.length} matching ${plural(files.length, "file")}:\n${formatPreviewList(files)}`;
	}
	if (payload.tool === "exec") {
		return "The command finished. Check the process details for command output and exit status.";
	}
	if (payload.tool === "memory") {
		const data = payload.data as { summary?: string } | undefined;
		return data?.summary?.trim() || "Memory was updated.";
	}
	if (payload.tool === "use_skill") {
		const data = payload.data as { command?: string; summary?: string } | undefined;
		return data?.summary?.trim() || `Loaded skill ${data?.command ?? ""}`.trim();
	}
	if (payload.tool === "write" || payload.tool === "edit" || payload.tool === "delete") {
		return "File changes are prepared for review before anything is written to Obsidian.";
	}
	return "I completed the tool step, but the model did not provide a user-facing final answer. Check the process details for the tool output.";
}

function summarizePayloadForTrace(payload: ToolResultPayload): string {
	if (!payload.ok) {
		return payload.status === "denied" ? `${payload.tool} blocked` : `${payload.tool} failed`;
	}
	return summarizeForTrace(payload.tool, payload.data);
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

function normalizeStringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function plural(count: number, singular: string): string {
	if (singular === "match") {
		return count === 1 ? "match" : "matches";
	}
	return count === 1 ? singular : `${singular}s`;
}

function formatPreviewList(items: string[]): string {
	const preview = items.slice(0, 8).map((item) => `- ${item}`).join("\n");
	const remaining = items.length - 8;
	return remaining > 0 ? `${preview}\n- ${remaining} more omitted` : preview;
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
