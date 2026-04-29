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
const modulePath = path.join(projectRoot, "src/services/LegacyFridayRootMigrationService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createProjectEntry(projectId, boundaryPath) {
	return {
		projectId,
		projectName: projectId,
		boundaryPath,
		gitState: "none",
		slug: projectId,
		groupId: "default-group",
		gitRemote: "",
		autoSync: false,
		lastSyncAt: "",
	};
}

test("legacy friday root migration service inventories registered legacy projects importable folders and visible mirror files", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-legacy-root-scan-"));

	try {
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "项目", "existing", "raw"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "个人", "private-notes", "wiki"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "Agents", "_global"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "runtime"), { recursive: true });
		await fs.writeFile(path.join(vaultRoot, "F.R.I.D.A.Y", "_配置.md"), "---\nversion: 7\n---\n");

		const settings = {
			projects: [createProjectEntry("existing", "F.R.I.D.A.Y/项目/existing")],
		};
		const service = new mod.LegacyFridayRootMigrationService(vaultRoot, "F.R.I.D.A.Y", () => settings);
		const report = await service.scan();

		assert.equal(report.registeredLegacyProjects.length, 1);
		assert.equal(report.registeredLegacyProjects[0]?.projectId, "existing");
		assert.ok(report.importableLegacyProjects.some((item) => item.folderPath === "F.R.I.D.A.Y/个人/private-notes"));
		assert.equal(report.hasLegacyAgentData, true);
		assert.equal(report.hasObsoleteVisibleConfigMirror, true);
		assert.ok(report.cleanupCandidates.includes("F.R.I.D.A.Y/_配置.md"));
		assert.ok(report.cleanupCandidates.includes("F.R.I.D.A.Y/runtime"));
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("legacy friday root migration service imports a legacy project in place and detects local git state", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-legacy-root-import-"));

	try {
		const legacyProjectRoot = path.join(vaultRoot, "F.R.I.D.A.Y", "项目", "demo-repo");
		await fs.mkdir(legacyProjectRoot, { recursive: true });
		execFileSync("git", ["init"], { cwd: legacyProjectRoot, stdio: "ignore" });

		const service = new mod.LegacyFridayRootMigrationService(vaultRoot, "F.R.I.D.A.Y", () => ({ projects: [] }));
		const entry = await service.importLegacyProject("F.R.I.D.A.Y/项目/demo-repo");

		assert.equal(entry.projectId, "demo-repo");
		assert.equal(entry.boundaryPath, "F.R.I.D.A.Y/项目/demo-repo");
		assert.equal(entry.gitState, "git_local");
		assert.equal(entry.gitRemote, "");
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("legacy friday root migration service cleanup removes only obsolete mirror and empty legacy folders", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-legacy-root-cleanup-"));

	try {
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "项目", "existing", "raw"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "Agents", "_global"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "个人"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "runtime"), { recursive: true });
		await fs.writeFile(path.join(vaultRoot, "F.R.I.D.A.Y", "_配置.md"), "---\nversion: 7\n---\n");

		const settings = {
			projects: [createProjectEntry("existing", "F.R.I.D.A.Y/项目/existing")],
		};
		const service = new mod.LegacyFridayRootMigrationService(vaultRoot, "F.R.I.D.A.Y", () => settings);
		const result = await service.cleanupVisibleLegacyArtifacts();

		assert.ok(result.removedPaths.includes("F.R.I.D.A.Y/_配置.md"));
		assert.ok(result.removedPaths.includes("F.R.I.D.A.Y/runtime"));
		assert.ok(result.removedPaths.includes("F.R.I.D.A.Y/个人"));
		await assert.rejects(fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y", "_配置.md")));
		await assert.rejects(fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y", "runtime")));
		await assert.rejects(fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y", "个人")));
		await fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y", "Agents"));
		await fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y", "项目", "existing"));
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});

test("legacy friday root migration service archives the visible Friday root with a unique legacy folder name", async () => {
	const mod = await loadModule();
	const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-legacy-root-archive-"));

	try {
		await fs.mkdir(path.join(vaultRoot, "F.R.I.D.A.Y", "项目", "existing"), { recursive: true });
		await fs.mkdir(path.join(vaultRoot, "旧版本F.R.I.D.A.Y文件夹"), { recursive: true });

		const service = new mod.LegacyFridayRootMigrationService(vaultRoot, "F.R.I.D.A.Y", () => ({ projects: [] }));
		const result = await service.archiveVisibleLegacyRoot();

		assert.equal(result.archivedPath, "旧版本F.R.I.D.A.Y文件夹 1");
		await assert.rejects(fs.stat(path.join(vaultRoot, "F.R.I.D.A.Y")));
		await fs.stat(path.join(vaultRoot, "旧版本F.R.I.D.A.Y文件夹 1", "项目", "existing"));
		await fs.stat(path.join(vaultRoot, "旧版本F.R.I.D.A.Y文件夹"));
	} finally {
		await fs.rm(vaultRoot, { recursive: true, force: true });
	}
});
