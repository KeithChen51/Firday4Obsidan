export interface MentionScopeProjectInput {
	boundaryPath?: string;
	projectRootPath?: string;
	localPath?: string;
}

export function resolveMentionScopePrefixes(
	project: MentionScopeProjectInput | null | undefined,
	vaultPaths: string[],
): string[] {
	const candidates = [
		normalizeScopePath(project?.boundaryPath),
		normalizeScopePath(project?.projectRootPath),
		normalizeScopePath(extractVaultRelativeFromLocalPath(project?.localPath)),
	].filter(Boolean);
	if (candidates.length === 0) {
		return [];
	}

	const matching = candidates.filter((candidate) => hasScopedMatch(candidate, vaultPaths));
	if (matching.length > 0) {
		return unique(matching);
	}

	const fallback = candidates.find(Boolean);
	return fallback ? [fallback] : [];
}

export function isPathWithinMentionScope(pathValue: string, scopePrefixes: string[]): boolean {
	if (scopePrefixes.length === 0) {
		return true;
	}
	const normalized = normalizeScopePath(pathValue);
	return scopePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function hasScopedMatch(prefix: string, vaultPaths: string[]): boolean {
	return vaultPaths.some((pathValue) => isPathWithinMentionScope(pathValue, [prefix]));
}

function extractVaultRelativeFromLocalPath(localPath: string | undefined): string {
	const normalized = normalizeScopePath(localPath);
	if (!normalized) {
		return "";
	}
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

function normalizeScopePath(value: string | undefined): string {
	return String(value ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^[a-zA-Z]:\//, "")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
