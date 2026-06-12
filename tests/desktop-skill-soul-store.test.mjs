/* eslint-env node */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const skillStorePath = path.join(projectRoot, "src/desktop/state/DesktopSkillStore.ts");
const soulStorePath = path.join(projectRoot, "src/desktop/state/DesktopSoulStateStore.ts");

async function loadModules() {
	return {
		skill: await jiti.import(skillStorePath),
		soul: await jiti.import(soulStorePath),
	};
}

async function withTempRoots(callback) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-desktop-skill-soul-store-"));
	try {
		const projectRootPath = path.join(tempRoot, "project");
		const globalSkillsRoot = path.join(tempRoot, "global-skills");
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(globalSkillsRoot, { recursive: true });
		return await callback({ tempRoot, projectRootPath, globalSkillsRoot });
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
}

async function writeSkillFile(root, folderName, frontmatter) {
	const skillRoot = path.join(root, folderName);
	await fs.mkdir(skillRoot, { recursive: true });
	await fs.writeFile(
		path.join(skillRoot, "SKILL.md"),
		[
			"---",
			`name: ${frontmatter.name}`,
			`description: ${frontmatter.description}`,
			"---",
			"",
			frontmatter.body ?? "Skill body.",
			"",
		].join("\n"),
		"utf8",
	);
	return skillRoot;
}

async function createDirectoryLink(target, linkPath) {
	try {
		await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
		return { ok: true };
	} catch (error) {
		if (["EPERM", "EACCES", "ENOTSUP", "EINVAL", "UNKNOWN"].includes(error?.code)) {
			return { ok: false, reason: `${error.code}: ${error.message}` };
		}
		throw error;
	}
}

test("desktop skill store lists project and global skills with deterministic summaries", async () => {
	const { skill } = await loadModules();

	await withTempRoots(async ({ projectRootPath, globalSkillsRoot }) => {
		const projectSkillPath = await writeSkillFile(
			path.join(projectRootPath, "FRIDAY", "skills"),
			"project-brief",
			{
				name: "Project Brief",
				description: "Summarize this project.",
			},
		);
		const globalSkillPath = await writeSkillFile(globalSkillsRoot, "global-review", {
			name: "Global Review",
			description: "Review a document.",
		});

		const store = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		const projectSkills = await store.listProjectSkills("desktop-project");
		const globalSkills = await store.listGlobalSkills();

		assert.deepEqual(projectSkills, [
			{
				id: "project-brief",
				name: "Project Brief",
				description: "Summarize this project.",
				scope: "project",
				enabled: true,
				sourcePath: path.join(projectSkillPath, "SKILL.md"),
			},
		]);
		assert.deepEqual(globalSkills, [
			{
				id: "global-review",
				name: "Global Review",
				description: "Review a document.",
				scope: "global",
				enabled: true,
				sourcePath: path.join(globalSkillPath, "SKILL.md"),
			},
		]);
	});
});

test("desktop skill store ignores project skills root symlink or junction escapes", async (t) => {
	const { skill } = await loadModules();

	await withTempRoots(async ({ tempRoot, projectRootPath, globalSkillsRoot }) => {
		const outsideSkillsRoot = path.join(tempRoot, "outside-skills");
		await writeSkillFile(outsideSkillsRoot, "outside-project-skill", {
			name: "Outside Project Skill",
			description: "Must not be exposed as a project skill.",
		});
		await fs.mkdir(path.join(projectRootPath, "FRIDAY"), { recursive: true });
		const link = await createDirectoryLink(outsideSkillsRoot, path.join(projectRootPath, "FRIDAY", "skills"));
		if (!link.ok) {
			t.skip(`directory symlink or junction unsupported: ${link.reason}`);
			return;
		}

		const store = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		assert.deepEqual(await store.listProjectSkills("desktop-project"), []);
	});
});

test("desktop skill store persists project and global enabled state and tolerates corrupt state json", async () => {
	const { skill } = await loadModules();

	await withTempRoots(async ({ projectRootPath, globalSkillsRoot }) => {
		await writeSkillFile(path.join(projectRootPath, "FRIDAY", "skills"), "project-brief", {
			name: "Project Brief",
			description: "Summarize this project.",
		});
		await writeSkillFile(globalSkillsRoot, "global-review", {
			name: "Global Review",
			description: "Review a document.",
		});

		const store = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		const disabled = await store.setSkillEnabled("desktop-project", "project-brief", false);
		assert.equal(disabled.enabled, false);
		const disabledGlobal = await store.setSkillEnabled("desktop-project", "global-review", false);
		assert.equal(disabledGlobal.scope, "global");
		assert.equal(disabledGlobal.enabled, false);

		const restoredStore = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		assert.equal((await restoredStore.listProjectSkills("desktop-project"))[0].enabled, false);
		assert.equal((await restoredStore.listGlobalSkills())[0].enabled, false);

		const reenabledGlobal = await restoredStore.setSkillEnabled("desktop-project", "global-review", true);
		assert.equal(reenabledGlobal.scope, "global");
		assert.equal(reenabledGlobal.enabled, true);
		const rerestoredStore = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		assert.equal((await rerestoredStore.listGlobalSkills())[0].enabled, true);

		await fs.writeFile(path.join(projectRootPath, "FRIDAY", "state", "desktop-skills.json"), "{not json", "utf8");
		const tolerantStore = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		assert.equal((await tolerantStore.listProjectSkills("desktop-project"))[0].enabled, true);
	});
});

test("desktop skill and soul stores refuse state writes through symlink or junction escapes", async (t) => {
	const { skill, soul } = await loadModules();

	await withTempRoots(async ({ tempRoot, projectRootPath, globalSkillsRoot }) => {
		await writeSkillFile(path.join(projectRootPath, "FRIDAY", "skills"), "project-brief", {
			name: "Project Brief",
			description: "Summarize this project.",
		});
		const outsideStateRoot = path.join(tempRoot, "outside-state");
		await fs.mkdir(outsideStateRoot, { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "FRIDAY"), { recursive: true });
		const link = await createDirectoryLink(outsideStateRoot, path.join(projectRootPath, "FRIDAY", "state"));
		if (!link.ok) {
			t.skip(`directory symlink or junction unsupported: ${link.reason}`);
			return;
		}

		const skillStore = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		await assert.rejects(
			() => skillStore.setSkillEnabled("desktop-project", "project-brief", false),
			/FRIDAY state directory resolves outside project root|state directory/i,
		);
		await assert.rejects(() => fs.stat(path.join(outsideStateRoot, "desktop-skills.json")), /ENOENT/);

		const soulStore = new soul.DesktopSoulStateStore(projectRootPath);
		await assert.rejects(
			() => soulStore.saveBasicState({
				activeSoulId: "friday-basic",
				lastUsedSoulId: "friday-basic",
				recentlyUsedSoulIds: ["friday-basic"],
			}),
			/FRIDAY state directory resolves outside project root|state directory/i,
		);
		await assert.rejects(() => fs.stat(path.join(outsideStateRoot, "desktop-soul-state.json")), /ENOENT/);
	});
});

test("desktop skill store rejects ambiguous enabled updates for duplicate project and global skill ids", async () => {
	const { skill } = await loadModules();

	await withTempRoots(async ({ projectRootPath, globalSkillsRoot }) => {
		await writeSkillFile(path.join(projectRootPath, "FRIDAY", "skills"), "shared-skill", {
			name: "Shared Skill",
			description: "Project copy.",
		});
		await writeSkillFile(globalSkillsRoot, "shared-skill", {
			name: "Shared Skill",
			description: "Global copy.",
		});

		const store = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		await assert.rejects(
			() => store.setSkillEnabled("desktop-project", "shared-skill", false),
			/ambiguous skill id|duplicate/i,
		);

		const disabledGlobal = await store.setScopedSkillEnabled("desktop-project", "shared-skill", "global", false);
		assert.equal(disabledGlobal.scope, "global");
		assert.equal(disabledGlobal.enabled, false);

		const restoredStore = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		const restoredProject = (await restoredStore.listProjectSkills("desktop-project")).find((item) => item.id === "shared-skill");
		const restoredGlobal = (await restoredStore.listGlobalSkills()).find((item) => item.id === "shared-skill");
		assert.equal(restoredProject.enabled, true);
		assert.equal(restoredGlobal.enabled, false);
	});
});

test("desktop skill store builds composer references without executing or promoting skills", async () => {
	const { skill } = await loadModules();

	await withTempRoots(async ({ projectRootPath, globalSkillsRoot }) => {
		const projectSkillRoot = await writeSkillFile(
			path.join(projectRootPath, "FRIDAY", "skills"),
			"project-brief",
			{
				name: "Project Brief",
				description: "Summarize this project.",
			},
		);
		await writeSkillFile(globalSkillsRoot, "global-review", {
			name: "Global Review",
			description: "Review a document.",
		});

		const store = new skill.DesktopSkillStore(projectRootPath, { globalSkillsRoot });
		const promotion = await store.markProjectSkillPromotable("desktop-project", "project-brief", true);
		const reference = await store.buildComposerSkillReference("desktop-project", "project-brief", "project");

		assert.deepEqual(promotion, {
			projectId: "desktop-project",
			skillId: "project-brief",
			promotableToGlobal: true,
		});
		assert.deepEqual(reference, {
			skillId: "project-brief",
			scope: "project",
			label: "Project Brief",
			referenceText: "@Project Brief",
			sourcePath: path.join(projectSkillRoot, "SKILL.md"),
		});
		await assert.rejects(() => fs.stat(path.join(globalSkillsRoot, "project-brief")), /ENOENT/);
		assert.equal(store.getExecutionCountForTest(), 0);
	});
});

test("desktop soul state store tolerates corrupt state json as missing state", async () => {
	const { soul } = await loadModules();

	await withTempRoots(async ({ projectRootPath }) => {
		const statePath = path.join(projectRootPath, "FRIDAY", "state", "desktop-soul-state.json");
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		await fs.writeFile(statePath, "{not json", "utf8");

		const store = new soul.DesktopSoulStateStore(projectRootPath);
		assert.equal(await store.restoreBasicState(), null);
	});
});

test("desktop soul state store restores only the basic profile state", async () => {
	const { soul } = await loadModules();

	await withTempRoots(async ({ projectRootPath }) => {
		const statePath = path.join(projectRootPath, "FRIDAY", "state", "desktop-soul-state.json");
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		await fs.writeFile(
			statePath,
			`${JSON.stringify({
				activeSoulId: "friday-basic",
				lastUsedSoulId: "friday-basic",
				recentlyUsedSoulIds: ["friday-basic", "archive"],
				profile: {
					id: "friday-basic",
					name: "FRIDAY Basic",
					summary: "Default desktop profile",
					tonePreset: "balanced",
					rolePrompt: "You are FRIDAY.",
					behaviorRules: ["advanced loop rule"],
					agentLoop: { editable: true },
				},
			}, null, 2)}\n`,
			"utf8",
		);

		const store = new soul.DesktopSoulStateStore(projectRootPath);
		const restored = await store.restoreBasicState();

		assert.deepEqual(restored, {
			activeSoulId: "friday-basic",
			lastUsedSoulId: "friday-basic",
			recentlyUsedSoulIds: ["friday-basic", "archive"],
			profile: {
				id: "friday-basic",
				name: "FRIDAY Basic",
				summary: "Default desktop profile",
				tonePreset: "balanced",
			},
		});
		assert.equal("rolePrompt" in restored.profile, false);
		assert.equal("behaviorRules" in restored.profile, false);
		assert.equal("agentLoop" in restored.profile, false);
	});
});
