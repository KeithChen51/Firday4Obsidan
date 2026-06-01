export type GitErrorKind = "offline" | "blocked" | "failed";

export interface ClassifiedGitError {
	kind: GitErrorKind;
	message: string;
}

export const REMOTE_UPDATED_BEFORE_PUSH_MESSAGE =
	"Remote has new commits that are not local. Pull remote updates, resolve any conflicts, then sync again.";

export function classifyGitError(error: unknown): ClassifiedGitError {
	const message = String(error ?? "");
	const normalized = message.toLowerCase();

	if (
		normalized.includes("could not resolve host") ||
		normalized.includes("failed to connect") ||
		normalized.includes("network") ||
		normalized.includes("timed out") ||
		normalized.includes("ls-remote")
	) {
		return { kind: "offline", message };
	}

	if (
		normalized.includes("authentication") ||
		normalized.includes("permission denied") ||
		normalized.includes("403") ||
		normalized.includes("401")
	) {
		return { kind: "blocked", message };
	}

	if (isNonFastForwardGitError(message)) {
		return { kind: "blocked", message: REMOTE_UPDATED_BEFORE_PUSH_MESSAGE };
	}

	if (
		normalized.includes("stash pop recovery failed") ||
		normalized.includes("restore failed") ||
		normalized.includes("unmerged")
	) {
		return { kind: "blocked", message };
	}

	return { kind: "failed", message };
}

export function isNonFastForwardGitError(error: unknown): boolean {
	const normalized = String(error ?? "").toLowerCase();
	return (
		normalized.includes("fetch first") ||
		normalized.includes("non-fast-forward") ||
		normalized.includes("remote contains work that you do not") ||
		(normalized.includes("updates were rejected") && normalized.includes("have locally")) ||
		(normalized.includes("failed to push some refs") && normalized.includes("fetch"))
	);
}
