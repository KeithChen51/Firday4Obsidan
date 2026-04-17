import simpleGit from "simple-git";

export interface GitRuntimeStatus {
	available: boolean;
	version: string;
	error: string;
}

export async function probeGitRuntime(
	runVersionCommand: () => Promise<string> = async () => simpleGit().raw(["--version"]),
): Promise<GitRuntimeStatus> {
	try {
		const raw = (await runVersionCommand()).trim();
		const match = raw.match(/git version\s+(.+)$/i);
		return {
			available: true,
			version: match?.[1]?.trim() ?? raw,
			error: "",
		};
	} catch (error) {
		return {
			available: false,
			version: "",
			error: error instanceof Error ? error.message : String(error ?? ""),
		};
	}
}
