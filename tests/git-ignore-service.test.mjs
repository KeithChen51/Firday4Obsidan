/* eslint-env node */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/sync/GitIgnoreService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createProject(repoRoot) {
	return {
		projectId: "alpha",
		projectName: "Alpha",
		boundaryPath: "Projects/alpha",
		gitState: "git_local",
		slug: "alpha",
		groupId: "default-group",
		projectRootPath: "Projects/alpha",
		localPath: repoRoot,
		gitRemote: "",
		autoSync: false,
		lastSyncAt: "",
	};
}

test("git ignore service lists untracked file and directory candidates", async () => {
	const mod = await loadModule();
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-ignore-"));
	try {
		execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
		await fs.mkdir(path.join(repoRoot, "cache"), { recursive: true });
		await fs.writeFile(path.join(repoRoot, "cache", "tmp.txt"), "x", "utf8");
		await fs.writeFile(path.join(repoRoot, "draft.md"), "y", "utf8");

		const service = new mod.GitIgnoreService();
		const candidates = await service.listCandidates(createProject(repoRoot));

		assert.ok(candidates.some((item) => item.path === "draft.md" && item.kind === "file"));
		assert.ok(candidates.some((item) => item.path === "cache/" && item.kind === "directory"));
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});

test("git ignore service appends unique rules into shared gitignore", async () => {
	const mod = await loadModule();
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-ignore-apply-"));
	try {
		execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
		await fs.writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");
		const service = new mod.GitIgnoreService();

		await service.applyRule(createProject(repoRoot), "cache/");
		await service.applyRule(createProject(repoRoot), "cache/");

		const content = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
		assert.match(content, /node_modules\//);
		assert.equal(content.split("cache/").length - 1, 1);
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});
