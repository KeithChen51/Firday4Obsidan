export interface MentionScopeProjectInput {
	boundaryPath?: string;
}

export function resolveMentionScopePrefixes(
	project: MentionScopeProjectInput | null | undefined,
	vaultPaths: string[],
): string[] {
	const boundaryPath = normalizeScopePath(project?.boundaryPath);
	if (!boundaryPath) {
		return [];
	}

	if (hasScopedMatch(boundaryPath, vaultPaths)) {
		return [boundaryPath];
	}

	return [];
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

function normalizeScopePath(value: string | undefined): string {
	return String(value ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^[a-zA-Z]:\//, "")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

