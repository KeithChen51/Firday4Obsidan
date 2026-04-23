import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_RELEASE_BRANCH = "release";
const PRESERVED_NAMES = new Set([".git"]);

function parseArgs(argv) {
	const roots = [];
	let projectRoot = DEFAULT_PROJECT_ROOT;
	let releaseBranch = DEFAULT_RELEASE_BRANCH;
	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === "--project-root") {
			projectRoot = path.resolve(argv[index + 1] ?? DEFAULT_PROJECT_ROOT);
			index += 1;
			continue;
		}
		if (current === "--branch") {
			releaseBranch = argv[index + 1] ?? DEFAULT_RELEASE_BRANCH;
			index += 1;
			continue;
		}
		roots.push(current);
	}
	return {
		projectRoot,
		releaseBranch,
		publishRoots: roots.length > 0 ? roots : ["plugin", "official"],
	};
}

function runGit(baseDir, args, { allowFailure = false } = {}) {
	const result = spawnSync("git", args, {
		cwd: baseDir,
		encoding: "utf8",
		stdio: "pipe",
	});
	if (result.status !== 0 && !allowFailure) {
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
		throw new Error(output || `git ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
	}
	return result;
}

function hasLocalBranch(baseDir, branch) {
	const result = runGit(baseDir, ["show-ref", "--verify", `refs/heads/${branch}`], { allowFailure: true });
	return result.status === 0;
}

function hasRemoteBranch(baseDir, branch) {
	const result = runGit(baseDir, ["ls-remote", "--exit-code", "--heads", "origin", branch], { allowFailure: true });
	return result.status === 0;
}

async function ensurePublishRoots(projectRoot, publishRoots) {
	for (const rootName of publishRoots) {
		const absolute = path.join(projectRoot, rootName);
		if (!fs.existsSync(absolute)) {
			throw new Error(`Missing publish root: ${rootName}`);
		}
	}
}

async function copyPublishRoots(projectRoot, worktreePath, publishRoots) {
	for (const rootName of publishRoots) {
		await cp(path.join(projectRoot, rootName), path.join(worktreePath, rootName), { recursive: true });
	}
}

async function clearWorktreeRoot(worktreePath) {
	const entries = await fs.promises.readdir(worktreePath, { withFileTypes: true });
	for (const entry of entries) {
		if (PRESERVED_NAMES.has(entry.name)) {
			continue;
		}
		await rm(path.join(worktreePath, entry.name), { recursive: true, force: true });
	}
}

function isCleanWorktree(baseDir) {
	const result = runGit(baseDir, ["status", "--porcelain"]);
	return (result.stdout ?? "").trim() === "";
}

export async function publishReleaseBranch({
	projectRoot = DEFAULT_PROJECT_ROOT,
	releaseBranch = DEFAULT_RELEASE_BRANCH,
	publishRoots = ["plugin", "official"],
} = {}) {
	await ensurePublishRoots(projectRoot, publishRoots);
	const worktreePath = await mkdtemp(path.join(os.tmpdir(), "friday-release-worktree-"));
	let worktreeReady = false;

	try {
		runGit(projectRoot, ["fetch", "origin", releaseBranch], { allowFailure: true });
		if (hasLocalBranch(projectRoot, releaseBranch)) {
			runGit(projectRoot, ["worktree", "add", "--force", worktreePath, releaseBranch]);
		} else if (hasRemoteBranch(projectRoot, releaseBranch)) {
			runGit(projectRoot, ["worktree", "add", "--force", "-b", releaseBranch, worktreePath, `origin/${releaseBranch}`]);
		} else {
			runGit(projectRoot, ["worktree", "add", "--force", "-b", releaseBranch, worktreePath, "HEAD"]);
		}
		worktreeReady = true;

		await clearWorktreeRoot(worktreePath);
		await copyPublishRoots(projectRoot, worktreePath, publishRoots);

		runGit(worktreePath, ["add", "."]);
		if (isCleanWorktree(worktreePath)) {
			return { changed: false, worktreePath, releaseBranch };
		}

		runGit(worktreePath, ["commit", "-m", `chore: publish ${publishRoots.join(", ")} release trees`]);
		runGit(worktreePath, ["push", "-u", "origin", releaseBranch]);
		return { changed: true, worktreePath, releaseBranch };
	} finally {
		if (worktreeReady) {
			runGit(projectRoot, ["worktree", "remove", "--force", worktreePath], { allowFailure: true });
		}
		await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { projectRoot, releaseBranch, publishRoots } = parseArgs(process.argv.slice(2));
	publishReleaseBranch({ projectRoot, releaseBranch, publishRoots })
		.then((result) => {
			if (result.changed) {
				console.log(`Published ${publishRoots.join(", ")} to ${releaseBranch}`);
				return;
			}
			console.log(`No release-tree changes to publish for ${publishRoots.join(", ")}`);
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error ?? "Unknown publish failure"));
			process.exitCode = 1;
		});
}
