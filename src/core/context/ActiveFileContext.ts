export type ActiveFileContextMode = "none" | "explicit_mention" | "deictic_reference" | "command";

export interface ActiveFileContext {
	mode: ActiveFileContextMode;
	path?: string;
	includeContent: boolean;
	reason: string;
}

export interface ActiveFileContextPolicyInput {
	userPrompt?: string;
	activeFilePath?: string;
	hasExplicitActiveNoteMention?: boolean;
	commandRequiresActiveFile?: boolean;
	commandReason?: string;
	commandIncludeContent?: boolean;
}

export const ACTIVE_FILE_CONTEXT_NONE: ActiveFileContext = {
	mode: "none",
	includeContent: false,
	reason: "未显式绑定当前文件",
};

const ACTIVE_FILE_DEICTIC_PATTERN =
	/(当前\s*(?:打开的?)?\s*(?:文档|文件|笔记|note|file)|这个\s*(?:文档|文件|笔记)|这篇\s*(?:文档|文件|笔记)|打开的\s*(?:文档|文件|笔记)|active\s+(?:note|file|document)|current\s+(?:note|file|document))/i;

export function resolveActiveFileContextPolicy(input: ActiveFileContextPolicyInput): ActiveFileContext {
	const activePath = normalizeActiveFilePath(input.activeFilePath);
	if (!activePath) {
		return { ...ACTIVE_FILE_CONTEXT_NONE };
	}
	if (input.commandRequiresActiveFile) {
		return {
			mode: "command",
			path: activePath,
			includeContent: Boolean(input.commandIncludeContent),
			reason: normalizeReason(input.commandReason, "命令指定"),
		};
	}
	if (input.hasExplicitActiveNoteMention) {
		return {
			mode: "explicit_mention",
			path: activePath,
			includeContent: true,
			reason: "@ 当前笔记",
		};
	}
	if (containsActiveFileDeicticReference(input.userPrompt ?? "")) {
		return {
			mode: "deictic_reference",
			path: activePath,
			includeContent: false,
			reason: "用户明确指代当前文档",
		};
	}
	return { ...ACTIVE_FILE_CONTEXT_NONE };
}

export function normalizeActiveFileContext(input: ActiveFileContext | null | undefined): ActiveFileContext {
	if (!input || input.mode === "none") {
		return { ...ACTIVE_FILE_CONTEXT_NONE };
	}
	const activePath = normalizeActiveFilePath(input.path);
	if (!activePath) {
		return { ...ACTIVE_FILE_CONTEXT_NONE };
	}
	return {
		mode: input.mode,
		path: activePath,
		includeContent: Boolean(input.includeContent),
		reason: normalizeReason(input.reason, defaultReasonForMode(input.mode)),
	};
}

export function hasAuthorizedActiveFileContext(
	input: ActiveFileContext | null | undefined,
): input is ActiveFileContext & { path: string } {
	const normalized = normalizeActiveFileContext(input);
	return normalized.mode !== "none" && Boolean(normalized.path);
}

export function containsActiveFileDeicticReference(prompt: string): boolean {
	return ACTIVE_FILE_DEICTIC_PATTERN.test(prompt);
}

function normalizeActiveFilePath(value: string | undefined): string {
	return String(value ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "");
}

function normalizeReason(value: string | undefined, fallback: string): string {
	return value?.trim() || fallback;
}

function defaultReasonForMode(mode: ActiveFileContextMode): string {
	switch (mode) {
		case "explicit_mention":
			return "@ 当前笔记";
		case "deictic_reference":
			return "用户明确指代当前文档";
		case "command":
			return "命令指定";
		case "none":
		default:
			return ACTIVE_FILE_CONTEXT_NONE.reason;
	}
}
