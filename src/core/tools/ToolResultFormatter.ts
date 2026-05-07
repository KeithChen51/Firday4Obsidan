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
		const payload = data as { path?: string; status?: string };
		return `${payload.status === "pending_review" ? "Write planned" : "Write completed"} ${payload.path ?? ""}`.trim();
	}
	if (tool === "delete") {
		const payload = data as { path?: string; deletedType?: string; status?: string };
		const targetLabel = payload.deletedType === "folder" ? "folder" : "file";
		return `${payload.status === "pending_review" ? "Delete planned" : "Delete completed"} ${targetLabel} ${payload.path ?? ""}`.trim();
	}
	if (tool === "edit") {
		const payload = data as { path?: string; appliedEdits?: number; status?: string };
		const verb = payload.status === "pending_review" ? "Edit planned" : "Edited";
		return `${verb} ${payload.path ?? ""} (${payload.appliedEdits ?? 0} replacement(s))`.trim();
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
