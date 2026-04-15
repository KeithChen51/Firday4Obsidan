export type GitErrorKind = "offline" | "blocked" | "failed";

export interface ClassifiedGitError {
	kind: GitErrorKind;
	message: string;
}

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

	if (
		normalized.includes("stash pop recovery failed") ||
		normalized.includes("restore failed") ||
		normalized.includes("unmerged")
	) {
		return { kind: "blocked", message };
	}

	return { kind: "failed", message };
}
