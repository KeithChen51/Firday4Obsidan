/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/utils/projectWorkspacePolicy.ts");
const boundaryServiceModulePath = path.join(projectRoot, "src/services/ProjectBoundaryService.ts");
const projectTypesPath = path.join(projectRoot, "src/types/project.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

async function loadBoundaryServiceModule() {
	return jiti.import(boundaryServiceModulePath);
}

function readProjectTypesSource() {
	return fs.readFileSync(projectTypesPath, "utf8");
}

test("agent draft writes default to project workspace", async () => {
	const mod = await loadModule();
	const resolved = mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "drafts/plan.md");
	assert.equal(resolved, "F.R.I.D.A.Y/项目/alpha/workspace/drafts/plan.md");
});

test("explicit project system paths stay inside the project root", async () => {
	const mod = await loadModule();
	assert.equal(
		mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "wiki/index.md"),
		"F.R.I.D.A.Y/项目/alpha/wiki/index.md",
	);
	assert.equal(
		mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "workspace/notes.md"),
		"F.R.I.D.A.Y/项目/alpha/workspace/notes.md",
	);
});

test("raw paths are detected as user-curated and blocked for agent writes", async () => {
	const mod = await loadModule();
	const rawPath = mod.resolveAgentWritableVaultPath("F.R.I.D.A.Y/项目/alpha", "raw/facts.md");
	assert.equal(rawPath, "F.R.I.D.A.Y/项目/alpha/raw/facts.md");
	assert.equal(mod.isProjectRawPath("F.R.I.D.A.Y/项目/alpha", rawPath), true);
	assert.equal(mod.isAgentWritableProjectPath("F.R.I.D.A.Y/项目/alpha", rawPath), false);
});

test("project boundary service resolves vault and absolute paths from boundaryPath", async () => {
	const mod = await loadBoundaryServiceModule();
	const settings = {
		activeProjectId: "alpha",
		projects: [
			{
				projectId: "alpha",
				projectName: "Alpha",
				boundaryPath: "Projects/alpha",
				gitState: "none",
				slug: "alpha",
				groupId: "default-group",
				gitRemote: "",
				autoSync: false,
				lastSyncAt: "",
			},
		],
	};
	const service = new mod.ProjectBoundaryService(() => settings, () => path.join("C:\\Vault"));
	const project = service.getActiveProject();

	assert.equal(project?.projectId, "alpha");
	assert.equal(service.getProjectBySlug("alpha")?.projectId, "alpha");
	assert.equal(service.getProjectVaultPath(project), "Projects/alpha");
	assert.equal(service.getProjectAbsolutePath(project), path.join("C:\\Vault", "Projects", "alpha"));
	assert.equal(service.getActiveProjectRoot(), "Projects/alpha");
});

test("project boundary service ignores legacy root fields when boundaryPath is present", async () => {
	const mod = await loadBoundaryServiceModule();
	const project = {
		projectId: "alpha",
		projectName: "Alpha",
		boundaryPath: "Projects/alpha",
		gitState: "none",
		slug: "alpha",
		groupId: "default-group",
		projectRootPath: "Legacy/root",
		localPath: "D:\\outside\\alpha",
		gitRemote: "",
		autoSync: false,
		lastSyncAt: "",
	};
	const service = new mod.ProjectBoundaryService(
		() => ({ activeProjectId: "alpha", projects: [project] }),
		() => "C:\\Vault",
	);

	assert.equal(service.getProjectVaultPath(project), "Projects/alpha");
	assert.equal(service.getProjectAbsolutePath(project), path.join("C:\\Vault", "Projects", "alpha"));
});

test("project entry runtime model no longer carries legacy path fields", async () => {
	const source = readProjectTypesSource();
	const match = source.match(/export interface ProjectEntry \{([\s\S]*?)\n\}/);
	assert.ok(match, "ProjectEntry interface should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /\bprojectRootPath\b/);
	assert.doesNotMatch(block, /\blocalPath\b/);
});

test("project groups use projectIds naming instead of legacy projectSlugs", async () => {
	const source = readProjectTypesSource();
	const match = source.match(/export interface ProjectGroupEntry \{([\s\S]*?)\n\}/);
	assert.ok(match, "ProjectGroupEntry interface should exist");
	const block = match[1] ?? "";
	assert.match(block, /\bprojectIds\b/);
	assert.doesNotMatch(block, /\bprojectSlugs\b/);
});
