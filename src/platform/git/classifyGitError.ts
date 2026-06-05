export type GitErrorKind = "offline" | "blocked" | "failed";

export type GitExternalCondition =
	| "network_unavailable"
	| "remote_unreachable"
	| "auth_required"
	| "permission_denied"
	| "remote_updated"
	| "branch_untracked"
	| "branch_missing"
	| "remote_policy_blocked"
	| "remote_file_rejected"
	| "content_conflict"
	| "stash_restore_conflict"
	| "git_runtime_unavailable"
	| "local_filesystem_blocked"
	| "repository_state_blocked"
	| "remote_service_unavailable"
	| "unknown_external";

export interface ClassifiedGitError {
	kind: GitErrorKind;
	condition: GitExternalCondition;
	messageKey: string;
	recoveryActionKey: string;
	technicalMessage: string;
	shouldAutoRetry: boolean;
}

export const GIT_ERROR_MESSAGE_KEYS: Record<GitExternalCondition, string> = {
	network_unavailable: "projects.sync.safeMessage.networkUnavailable",
	remote_unreachable: "projects.sync.safeMessage.remoteUnreachable",
	auth_required: "projects.sync.safeMessage.authRequired",
	permission_denied: "projects.sync.safeMessage.permissionDenied",
	remote_updated: "projects.sync.safeMessage.remoteUpdated",
	branch_untracked: "projects.sync.safeMessage.branchUntracked",
	branch_missing: "projects.sync.safeMessage.branchMissing",
	remote_policy_blocked: "projects.sync.safeMessage.remotePolicyBlocked",
	remote_file_rejected: "projects.sync.safeMessage.remoteFileRejected",
	content_conflict: "projects.sync.safeMessage.contentConflict",
	stash_restore_conflict: "projects.sync.safeMessage.stashRestoreConflict",
	git_runtime_unavailable: "projects.sync.safeMessage.gitRuntimeUnavailable",
	local_filesystem_blocked: "projects.sync.safeMessage.localFilesystemBlocked",
	repository_state_blocked: "projects.sync.safeMessage.repositoryStateBlocked",
	remote_service_unavailable: "projects.sync.safeMessage.remoteServiceUnavailable",
	unknown_external: "projects.sync.safeMessage.unknownExternal",
};

export const GIT_ERROR_RECOVERY_ACTION_KEYS: Record<GitExternalCondition, string> = {
	network_unavailable: "projects.sync.safeRecovery.networkUnavailable",
	remote_unreachable: "projects.sync.safeRecovery.remoteUnreachable",
	auth_required: "projects.sync.safeRecovery.authRequired",
	permission_denied: "projects.sync.safeRecovery.permissionDenied",
	remote_updated: "projects.sync.safeRecovery.remoteUpdated",
	branch_untracked: "projects.sync.safeRecovery.branchUntracked",
	branch_missing: "projects.sync.safeRecovery.branchMissing",
	remote_policy_blocked: "projects.sync.safeRecovery.remotePolicyBlocked",
	remote_file_rejected: "projects.sync.safeRecovery.remoteFileRejected",
	content_conflict: "projects.sync.safeRecovery.contentConflict",
	stash_restore_conflict: "projects.sync.safeRecovery.stashRestoreConflict",
	git_runtime_unavailable: "projects.sync.safeRecovery.gitRuntimeUnavailable",
	local_filesystem_blocked: "projects.sync.safeRecovery.localFilesystemBlocked",
	repository_state_blocked: "projects.sync.safeRecovery.repositoryStateBlocked",
	remote_service_unavailable: "projects.sync.safeRecovery.remoteServiceUnavailable",
	unknown_external: "projects.sync.safeRecovery.unknownExternal",
};

export const REMOTE_UPDATED_BEFORE_PUSH_MESSAGE_KEY = GIT_ERROR_MESSAGE_KEYS.remote_updated;
export const REMOTE_UPDATED_BEFORE_PUSH_ERROR =
	"Updates were rejected because the remote contains work that you do not have locally.";

type TranslateGitErrorKey = (key: string) => string;

export function formatClassifiedGitError(
	classified: Pick<ClassifiedGitError, "messageKey" | "recoveryActionKey">,
	translateKey: TranslateGitErrorKey,
): string {
	const message = translateKey(classified.messageKey).trim();
	const recoveryAction = translateKey(classified.recoveryActionKey).trim();
	const separator = /[。！？]$/.test(message) ? "" : " ";
	return recoveryAction && recoveryAction !== message
		? `${message}${separator}${recoveryAction}`
		: message;
}

export function classifyGitError(error: unknown): ClassifiedGitError {
	const message = String(error ?? "");
	const normalized = message.toLowerCase();

	if (isNetworkUnavailable(normalized)) {
		return safeGitError(
			"offline",
			"network_unavailable",
			message,
			false,
		);
	}

	if (isGitRuntimeUnavailable(normalized)) {
		return safeGitError(
			"failed",
			"git_runtime_unavailable",
			message,
			false,
		);
	}

	if (isLocalFilesystemBlocked(normalized)) {
		return safeGitError(
			"failed",
			"local_filesystem_blocked",
			message,
			false,
		);
	}

	if (isRemoteServiceUnavailable(normalized)) {
		return safeGitError(
			"blocked",
			"remote_service_unavailable",
			message,
			false,
		);
	}

	if (isAuthRequired(normalized)) {
		return safeGitError(
			"blocked",
			"auth_required",
			message,
			false,
		);
	}

	if (isPermissionDenied(normalized)) {
		return safeGitError(
			"blocked",
			"permission_denied",
			message,
			false,
		);
	}

	if (isRemoteUnreachable(normalized)) {
		return safeGitError(
			"blocked",
			"remote_unreachable",
			message,
			false,
		);
	}

	if (isBranchMissing(normalized)) {
		return safeGitError(
			"blocked",
			"branch_missing",
			message,
			true,
		);
	}

	if (isBranchUntracked(normalized)) {
		return safeGitError(
			"blocked",
			"branch_untracked",
			message,
			true,
		);
	}

	if (isNonFastForwardGitError(message)) {
		return safeGitError(
			"blocked",
			"remote_updated",
			message,
			true,
		);
	}

	if (isRemotePolicyBlocked(normalized)) {
		return safeGitError(
			"blocked",
			"remote_policy_blocked",
			message,
			false,
		);
	}

	if (isRemoteFileRejected(normalized)) {
		return safeGitError(
			"blocked",
			"remote_file_rejected",
			message,
			false,
		);
	}

	if (
		normalized.includes("stash pop recovery failed") ||
		normalized.includes("restore failed")
	) {
		return safeGitError(
			"blocked",
			"stash_restore_conflict",
			message,
			true,
		);
	}

	if (isContentConflict(normalized)) {
		return safeGitError(
			"blocked",
			"content_conflict",
			message,
			true,
		);
	}

	if (isRepositoryStateBlocked(normalized)) {
		return safeGitError(
			"blocked",
			"repository_state_blocked",
			message,
			false,
		);
	}

	return safeGitError(
		"failed",
		"unknown_external",
		message,
		false,
	);
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

function safeGitError(
	kind: GitErrorKind,
	condition: GitExternalCondition,
	technicalMessage: string,
	shouldAutoRetry: boolean,
): ClassifiedGitError {
	return {
		kind,
		condition,
		messageKey: GIT_ERROR_MESSAGE_KEYS[condition],
		recoveryActionKey: GIT_ERROR_RECOVERY_ACTION_KEYS[condition],
		technicalMessage,
		shouldAutoRetry,
	};
}

function isNetworkUnavailable(normalized: string): boolean {
	return (
		normalized.includes("could not resolve host") ||
		normalized.includes("failed to connect") ||
		normalized.includes("network is unreachable") ||
		normalized.includes("connection timed out") ||
		normalized.includes("timed out") ||
		normalized.includes("connection reset") ||
		normalized.includes("connection refused") ||
		normalized.includes("ssl connect error")
	);
}

function isRemoteUnreachable(normalized: string): boolean {
	return (
		normalized.includes("repository not found") ||
		normalized.includes("repository '") && normalized.includes("not found") ||
		normalized.includes("does not appear to be a git repository") ||
		normalized.includes("could not read from remote repository") ||
		normalized.includes("remote repository not found") ||
		normalized.includes("the project you were looking for could not be found")
	);
}

function isAuthRequired(normalized: string): boolean {
	return (
		normalized.includes("authentication failed") ||
		normalized.includes("could not read username") ||
		normalized.includes("terminal prompts disabled") ||
		normalized.includes("invalid username or password") ||
		normalized.includes("bad credentials") ||
		normalized.includes("401") ||
		normalized.includes("unauthorized")
	);
}

function isPermissionDenied(normalized: string): boolean {
	return (
		normalized.includes("permission to") && normalized.includes("denied") ||
		normalized.includes("permission denied") ||
		normalized.includes("forbidden") ||
		normalized.includes("403")
	);
}

function isBranchUntracked(normalized: string): boolean {
	return (
		normalized.includes("no tracking information") ||
		normalized.includes("has no upstream branch") ||
		normalized.includes("set the upstream") ||
		normalized.includes("set-upstream")
	);
}

function isBranchMissing(normalized: string): boolean {
	return (
		normalized.includes("requested upstream branch") && normalized.includes("does not exist") ||
		normalized.includes("couldn't find remote ref") ||
		normalized.includes("could not find remote ref") ||
		normalized.includes("invalid upstream")
	);
}

function isRemotePolicyBlocked(normalized: string): boolean {
	return (
		normalized.includes("protected branch") ||
		normalized.includes("pre-receive hook declined") ||
		normalized.includes("protected branch update failed") ||
		normalized.includes("changes must be made through a pull request") ||
		normalized.includes("branch protection") ||
		normalized.includes("push declined due to repository rule")
	);
}

function isRemoteFileRejected(normalized: string): boolean {
	return (
		normalized.includes("exceeds github's file size limit") ||
		normalized.includes("large files detected") ||
		normalized.includes("file size limit") ||
		normalized.includes("git lfs") ||
		normalized.includes("secret scanning") ||
		normalized.includes("repository rule violations") ||
		normalized.includes("quota exceeded")
	);
}

function isContentConflict(normalized: string): boolean {
	return (
		normalized.includes("conflict (content)") ||
		normalized.includes("merge conflict") ||
		normalized.includes("automatic merge failed") ||
		normalized.includes("unmerged files") ||
		normalized.includes("unmerged")
	);
}

function isGitRuntimeUnavailable(normalized: string): boolean {
	return (
		normalized.includes("git: command not found") ||
		normalized.includes("git is not recognized") ||
		normalized.includes("unable to find git") ||
		normalized.includes("current environment") && normalized.includes("git")
	);
}

function isLocalFilesystemBlocked(normalized: string): boolean {
	return (
		normalized.includes("enospc") ||
		normalized.includes("no space left") ||
		normalized.includes("eacces") ||
		normalized.includes("eperm") ||
		normalized.includes("read-only file system") ||
		normalized.includes("ebusy") ||
		normalized.includes("resource busy")
	);
}

function isRepositoryStateBlocked(normalized: string): boolean {
	return (
		normalized.includes("index.lock") ||
		normalized.includes("another git process") ||
		normalized.includes("not concluded your merge") ||
		normalized.includes("rebase-merge") ||
		normalized.includes("rebase in progress") ||
		normalized.includes("detached head")
	);
}

function isRemoteServiceUnavailable(normalized: string): boolean {
	return (
		normalized.includes("429") ||
		normalized.includes("too many requests") ||
		normalized.includes("rate limit") ||
		normalized.includes("500") ||
		normalized.includes("502") ||
		normalized.includes("503") ||
		normalized.includes("504") ||
		normalized.includes("internal server error") ||
		normalized.includes("service unavailable") ||
		normalized.includes("bad gateway") ||
		normalized.includes("gateway timeout")
	);
}
