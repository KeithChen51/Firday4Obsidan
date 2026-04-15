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
const modulePath = path.join(projectRoot, "src/features/workbench/ProjectEditorService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("project editor service builds default project root path from project id", async () => {
	const mod = await loadModule();
	const root = mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "alpha-project");
	assert.equal(root, "F.R.I.D.A.Y/项目/alpha-project");
});

test("project editor service rejects invalid project id", async () => {
	const mod = await loadModule();
	assert.throws(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "Bad Slug",
				projectName: "坏项目",
				boundaryPath: "F.R.I.D.A.Y/项目/bad",
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service allows Chinese project name without git credential fields", async () => {
	const mod = await loadModule();
	assert.doesNotThrow(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "胖东来白板",
				boundaryPath: "F.R.I.D.A.Y/项目/alpha",
				gitRemote: "https://example.com/repo.git",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service returns unified project model without pre-generating scaffold files", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-project-editor-"));
	const syncCalls = [];

	try {
		const entry = await mod.submitProjectDraft({
			app: {
				vault: {
					adapter: {
						basePath: vaultRoot,
					},
				},
			},
			syncService: {
				async prepareRepository(project) {
					syncCalls.push(project);
				},
			},
			draft: {
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha-project",
				projectName: "胖东来白板",
				boundaryPath: "projects/alpha-project",
				gitRemote: "",
				autoSync: true,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.equal(entry.projectId, "alpha-project");
		assert.equal(entry.projectName, "胖东来白板");
		assert.equal(entry.boundaryPath, "projects/alpha-project");
		assert.equal(entry.gitState, "none");
		assert.equal(entry.slug, "alpha-project");
		assert.equal("projectRootPath" in entry, false);
		assert.equal("localPath" in entry, false);
		assert.equal(entry.autoSync, false);
		assert.equal(syncCalls.length, 1);

		const projectDir = path.join(vaultRoot, "projects", "alpha-project");
		const rawDir = path.join(projectDir, "raw");
		const workspaceDir = path.join(projectDir, "workspace");
		const wikiDir = path.join(projectDir, "wiki");
		const projectMeta = path.join(projectDir, "_项目.md");
		const membersMeta = path.join(projectDir, "_成员.md");

		await assert.rejects(fs.stat(rawDir));
		await assert.rejects(fs.stat(workspaceDir));
		await assert.rejects(fs.stat(wikiDir));
		await assert.rejects(fs.stat(projectMeta));
		await assert.rejects(fs.stat(membersMeta));
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("project editor service detects git state for repo root, remote-bound repo, and nested folder", async () => {
	const mod = await loadModule();
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-git-state-"));
	const repoRoot = path.join(tempRoot, "repo");
	const nestedPath = path.join(repoRoot, "nested");

	try {
		await fs.mkdir(nestedPath, { recursive: true });
		execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });

		const localState = await mod.detectProjectGitState(repoRoot);
		assert.equal(localState.gitState, "git_local");
		assert.equal(localState.repositoryRoot, repoRoot);
		assert.equal(localState.detectedParentRepository, false);

		execFileSync("git", ["remote", "add", "origin", "https://example.com/demo.git"], { cwd: repoRoot, stdio: "ignore" });
		const remoteState = await mod.detectProjectGitState(repoRoot);
		assert.equal(remoteState.gitState, "git_remote_bound");
		assert.equal(remoteState.repositoryRoot, repoRoot);
		assert.equal(remoteState.detectedParentRepository, false);

		const nestedState = await mod.detectProjectGitState(nestedPath);
		assert.equal(nestedState.gitState, "none");
		assert.equal(nestedState.repositoryRoot, repoRoot);
		assert.equal(nestedState.detectedParentRepository, true);
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test("project editor service rejects Vault-external absolute paths for register and bootstrap modes", async () => {
	const mod = await loadModule();
	for (const mode of ["register_existing_dir", "remote_bootstrap"]) {
		assert.throws(() => {
			mod.validateProjectDraft(
				{
					groupId: "default-group",
					mode,
					projectId: "alpha",
					projectName: "Alpha",
					boundaryPath: "C:\\outside\\alpha",
					gitRemote: mode === "remote_bootstrap" ? "https://example.com/demo.git" : "",
					autoSync: false,
				},
				new Set(),
			);
		}, /Vault-relative path/);
	}
});

test("remote bootstrap defaults derive project identity from repository name", async () => {
	const mod = await loadModule();
	const defaults = mod.buildRemoteBootstrapDefaults("F.R.I.D.A.Y", "https://example.com/team/demo-repo.git");
	assert.equal(defaults.projectId, "demo-repo");
	assert.equal(defaults.projectName, "demo-repo");
	assert.equal(defaults.boundaryPath, mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "demo-repo"));
});
