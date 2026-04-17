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

test("project editor service keeps Chinese project names when building default project root path", async () => {
	const mod = await loadModule();
	const root = mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "胖东来白板");
	assert.equal(root, "F.R.I.D.A.Y/项目/胖东来白板");
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

test("project editor service auto-generates project id when creating a project without manual id", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-project-editor-auto-id-"));

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
				async prepareRepository() {},
			},
			draft: {
				groupId: "default-group",
				mode: "local_only",
				projectId: "",
				projectName: "胖东来白板",
				boundaryPath: "",
				gitRemote: "",
				autoSync: false,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.match(entry.projectId, /^project-/);
		assert.equal(entry.slug, entry.projectId);
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
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
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service allows local_only projects to leave boundaryPath empty for whole-vault scope", async () => {
	const mod = await loadModule();
	assert.doesNotThrow(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "整个仓库项目",
				boundaryPath: "",
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service rejects git remote for local_only mode", async () => {
	const mod = await loadModule();
	assert.throws(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "",
				gitRemote: "https://example.com/demo.git",
				autoSync: false,
			},
			new Set(),
		);
	}, /local_only/i);
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
		assert.equal(syncCalls.length, 0);

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

test("project editor service rejects remote binding during register_existing_dir when target is not a git repository root", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-register-existing-"));

	try {
		const plainDir = path.join(vaultRoot, "projects", "plain");
		await fs.mkdir(plainDir, { recursive: true });

		await assert.rejects(
			mod.submitProjectDraft({
				app: {
					vault: {
						adapter: {
							basePath: vaultRoot,
						},
					},
				},
				syncService: {
					async prepareRepository() {
						throw new Error("prepareRepository should not run for invalid register_existing_dir remote binding");
					},
				},
				draft: {
					groupId: "default-group",
					mode: "register_existing_dir",
					projectId: "plain",
					projectName: "Plain",
					boundaryPath: "projects/plain",
					gitRemote: "https://example.com/demo.git",
					autoSync: true,
				},
				existingProjectIds: new Set(),
				fridayRoot: "F.R.I.D.A.Y",
				currentUserId: "keith",
			}),
			/cannot bind a remote|register_existing_dir/i,
		);
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("project editor service rejects remote bootstrap into a non-empty target directory", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-remote-bootstrap-non-empty-"));

	try {
		const nonEmptyDir = path.join(vaultRoot, "projects", "occupied");
		await fs.mkdir(nonEmptyDir, { recursive: true });
		await fs.writeFile(path.join(nonEmptyDir, "README.md"), "# existing");

		await assert.rejects(
			mod.submitProjectDraft({
				app: {
					vault: {
						adapter: {
							basePath: vaultRoot,
						},
					},
				},
				syncService: {
					async prepareRepository() {
						throw new Error("prepareRepository should not run for invalid remote bootstrap target");
					},
				},
				draft: {
					groupId: "default-group",
					mode: "remote_bootstrap",
					projectId: "occupied",
					projectName: "Occupied",
					boundaryPath: "projects/occupied",
					gitRemote: "https://example.com/demo.git",
					autoSync: true,
				},
				existingProjectIds: new Set(),
				fridayRoot: "F.R.I.D.A.Y",
				currentUserId: "keith",
			}),
			/Remote bootstrap target must be empty/i,
		);
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("remote bootstrap defaults derive project identity from repository name", async () => {
	const mod = await loadModule();
	const defaults = mod.buildRemoteBootstrapDefaults("F.R.I.D.A.Y", "https://example.com/team/demo-repo.git");
	assert.equal(defaults.projectId, "demo-repo");
	assert.equal(defaults.projectName, "demo-repo");
	assert.equal(defaults.boundaryPath, mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "demo-repo"));
});
