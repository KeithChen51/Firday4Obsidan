const PROJECT_SYSTEM_SEGMENTS = new Set(["workspace", "wiki", "memory", ".friday", "raw"]);

function normalizeVaultPath(value: string): string {
	return (value || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function trimSlashes(value: string): string {
	return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function getProjectWorkspaceRoot(projectRoot: string): string {
	const normalizedRoot = trimSlashes(normalizeVaultPath(projectRoot || ""));
	return normalizedRoot ? normalizeVaultPath(`${normalizedRoot}/workspace`) : "workspace";
}

export function isProjectRawPath(projectRoot: string, targetPath: string): boolean {
	const normalizedRoot = trimSlashes(normalizeVaultPath(projectRoot || ""));
	const normalizedTarget = trimSlashes(normalizeVaultPath(targetPath || ""));
	if (!normalizedRoot || !normalizedTarget) {
		return false;
	}
	const rawRoot = normalizeVaultPath(`${normalizedRoot}/raw`);
	return normalizedTarget === rawRoot || normalizedTarget.startsWith(`${rawRoot}/`);
}

export function isAgentWritableProjectPath(projectRoot: string, targetPath: string): boolean {
	const normalizedRoot = trimSlashes(normalizeVaultPath(projectRoot || ""));
	const normalizedTarget = trimSlashes(normalizeVaultPath(targetPath || ""));
	if (!normalizedRoot || !normalizedTarget) {
		return false;
	}
	return (
		(normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)) &&
		!isProjectRawPath(normalizedRoot, normalizedTarget)
	);
}

export function resolveAgentWritableVaultPath(projectRoot: string, inputPath: string): string {
	const normalizedRoot = trimSlashes(normalizeVaultPath(projectRoot || ""));
	const normalizedInput = trimSlashes(normalizeVaultPath(inputPath || ""));
	if (!normalizedRoot) {
		return normalizedInput;
	}
	if (!normalizedInput) {
		return getProjectWorkspaceRoot(normalizedRoot);
	}
	if (normalizedInput === normalizedRoot || normalizedInput.startsWith(`${normalizedRoot}/`)) {
		return normalizedInput;
	}
	const firstSegment = normalizedInput.split("/")[0] ?? "";
	if (PROJECT_SYSTEM_SEGMENTS.has(firstSegment)) {
		return normalizeVaultPath(`${normalizedRoot}/${normalizedInput}`);
	}
	return normalizeVaultPath(`${getProjectWorkspaceRoot(normalizedRoot)}/${normalizedInput}`);
}
