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
	const root = mod.buildDefaultProjectRootPath("F.R.I.D.A.Y", "胖东来白衬衫");
	assert.equal(root, "F.R.I.D.A.Y/项目/胖东来白衬衫");
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
	}, /项目 ID 只能使用小写字母、数字或连字符。/);
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
				projectName: "胖东来白衬衫",
				boundaryPath: "projects/pangdonglai",
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
				projectName: "胖东来白衬衫",
				boundaryPath: "F.R.I.D.A.Y/项目/alpha",
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
		);
	});
});

test("project editor service requires a Vault directory for local_only mode", async () => {
	const mod = await loadModule();
	assert.throws(() => {
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
	}, /Project root is required/i);
});

test("project editor service allows git remote for local_only mode", async () => {
	const mod = await loadModule();
	assert.doesNotThrow(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "projects/alpha",
				gitRemote: "https://example.com/demo.git",
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
				projectName: "胖东来白衬衫",
				boundaryPath: "projects/alpha-project",
				gitRemote: "",
				autoSync: true,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.equal(entry.projectId, "alpha-project");
		assert.equal(entry.projectName, "胖东来白衬衫");
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
		assert.equal(localState.gitRemote, "");

		execFileSync("git", ["remote", "add", "origin", "https://example.com/demo.git"], { cwd: repoRoot, stdio: "ignore" });
		const remoteState = await mod.detectProjectGitState(repoRoot);
		assert.equal(remoteState.gitState, "git_remote_bound");
		assert.equal(remoteState.repositoryRoot, repoRoot);
		assert.equal(remoteState.detectedParentRepository, false);
		assert.equal(remoteState.gitRemote, "https://example.com/demo.git");

		const nestedState = await mod.detectProjectGitState(nestedPath);
		assert.equal(nestedState.gitState, "none");
		assert.equal(nestedState.repositoryRoot, repoRoot);
		assert.equal(nestedState.detectedParentRepository, true);
		assert.equal(nestedState.gitRemote, "");
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
});

test("project editor service rejects Vault-external absolute paths for local and remote modes", async () => {
	const mod = await loadModule();
	for (const mode of ["local_only", "remote_bootstrap"]) {
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

test("project editor service rejects new project roots inside the Friday workspace", async () => {
	const mod = await loadModule();
	for (const mode of ["local_only", "remote_bootstrap"]) {
		for (const boundaryPath of ["F.R.I.D.A.Y", "F.R.I.D.A.Y/项目/alpha", "Friday/Projects/alpha"]) {
			assert.throws(() => {
				mod.validateProjectDraft(
					{
						groupId: "default-group",
						mode,
						projectId: "alpha",
						projectName: "Alpha",
						boundaryPath,
						gitRemote: mode === "remote_bootstrap" ? "https://example.com/demo.git" : "",
						autoSync: false,
					},
					new Set(),
					"",
					"F.R.I.D.A.Y",
				);
			}, /F\.R\.I\.D\.A\.Y|Friday workspace|Friday-managed/i);
		}
	}
});

test("project editor service still allows editing an existing legacy Friday-managed project root", async () => {
	const mod = await loadModule();
	assert.doesNotThrow(() => {
		mod.validateProjectDraft(
			{
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "F.R.I.D.A.Y/椤圭洰/alpha",
				gitRemote: "",
				autoSync: false,
			},
			new Set(),
			"alpha",
			"F.R.I.D.A.Y",
			"F.R.I.D.A.Y/椤圭洰/alpha",
		);
	});
});

test("project editor service fills git remote from an existing local repository root", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-existing-local-repo-"));

	try {
		const repoDir = path.join(vaultRoot, "projects", "alpha");
		await fs.mkdir(repoDir, { recursive: true });
		execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["remote", "add", "origin", "https://example.com/existing.git"], { cwd: repoDir, stdio: "ignore" });

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
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "projects/alpha",
				gitRemote: "",
				autoSync: false,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.equal(entry.gitState, "git_remote_bound");
		assert.equal(entry.gitRemote, "https://example.com/existing.git");
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("project editor service initializes git when local_only mode provides a remote", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-local-init-"));
	let prepareCalls = 0;

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
					prepareCalls += 1;
					const targetDir = path.join(vaultRoot, ...project.boundaryPath.split("/"));
					execFileSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
					execFileSync("git", ["remote", "add", "origin", project.gitRemote], { cwd: targetDir, stdio: "ignore" });
				},
			},
			draft: {
				groupId: "default-group",
				mode: "local_only",
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "projects/alpha",
				gitRemote: "https://example.com/demo.git",
				autoSync: true,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.equal(prepareCalls, 1);
		assert.equal(entry.gitState, "git_remote_bound");
		assert.equal(entry.gitRemote, "https://example.com/demo.git");
		assert.equal(entry.autoSync, true);
		await fs.stat(path.join(vaultRoot, "projects", "alpha", ".git"));
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("project editor service rejects binding a remote inside a parent repository", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-parent-repo-"));

	try {
		const repoRoot = path.join(vaultRoot, "projects", "repo-root");
		const nestedDir = path.join(repoRoot, "nested");
		await fs.mkdir(nestedDir, { recursive: true });
		execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });

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
						throw new Error("prepareRepository should not run when the selected directory is inside a parent repo");
					},
				},
				draft: {
					groupId: "default-group",
					mode: "local_only",
					projectId: "nested",
					projectName: "Nested",
					boundaryPath: "projects/repo-root/nested",
					gitRemote: "https://example.com/demo.git",
					autoSync: false,
				},
				existingProjectIds: new Set(),
				fridayRoot: "F.R.I.D.A.Y",
				currentUserId: "keith",
			}),
			/parent git repository|repository root/i,
		);
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("project editor service derives a valid slug from project name when hidden projectId is invalid", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-project-editor-hidden-id-"));

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
				projectId: "Bad Slug",
				projectName: "Alpha Project",
				boundaryPath: "projects/alpha-project",
				gitRemote: "",
				autoSync: false,
			},
			existingProjectIds: new Set(),
			fridayRoot: "F.R.I.D.A.Y",
			currentUserId: "keith",
		});

		assert.equal(entry.projectId, "alpha-project");
		assert.equal(entry.slug, "alpha-project");
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
	assert.equal(defaults.boundaryPath, "");
});

test("remote bootstrap defaults sanitize repository names into valid hidden slugs", async () => {
	const mod = await loadModule();
	const defaults = mod.buildRemoteBootstrapDefaults("F.R.I.D.A.Y", "https://example.com/team/next_gen.git");
	assert.equal(defaults.projectId, "next-gen");
	assert.equal(defaults.projectName, "next_gen");
	assert.equal(defaults.boundaryPath, "");
});
