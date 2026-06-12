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

const hostPath = path.join(projectRoot, "src/desktop/host/node/DesktopProjectHost.ts");
const manifestStorePath = path.join(projectRoot, "src/desktop/state/ProjectManifestStore.ts");
const workspaceStateStorePath = path.join(projectRoot, "src/desktop/state/WorkspaceStateStore.ts");

const fridayDirectories = [
	"context",
	"artifacts",
	"imports",
	"archive",
	"skills",
	"conversations",
	"traces",
	"references",
	"state",
	"runtime",
	"local",
];

async function loadModules() {
	return {
		host: await jiti.import(hostPath),
		manifestStore: await jiti.import(manifestStorePath),
		workspaceStateStore: await jiti.import(workspaceStateStorePath),
	};
}

async function withTempProject(prefix, callback) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		return await callback(tempRoot);
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
}

test("desktop project host initializes FRIDAY layout and project manifest", async () => {
	const { host } = await loadModules();

	await withTempProject("friday-desktop-project-init-", async (tempRoot) => {
		const projectHost = new host.DesktopProjectHost();
		const session = await projectHost.initializeProject(tempRoot, {
			projectId: "alpha-project",
			name: "Alpha Project",
		});
		const manifest = session.manifest;

		assert.equal(manifest.schemaVersion, 1);
		assert.equal(manifest.projectId, "alpha-project");
		assert.equal(manifest.name, "Alpha Project");
		assert.equal(manifest.rootPath, tempRoot);
		assert.equal(manifest.defaultPermissionMode, "standard");
		assert.equal(manifest.gitProfile.isRepository, false);
		assert.deepEqual(session.project, {
			id: "alpha-project",
			name: "Alpha Project",
			root: tempRoot,
			manifestPath: path.join(tempRoot, "FRIDAY", "project.json"),
		});
		assert.equal(session.workspaceState, null);

		const manifestPath = path.join(tempRoot, "FRIDAY", "project.json");
		const rawManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
		assert.deepEqual(rawManifest, manifest);

		for (const directoryName of fridayDirectories) {
			const stat = await fs.stat(path.join(tempRoot, "FRIDAY", directoryName));
			assert.equal(stat.isDirectory(), true, `${directoryName} should be initialized`);
		}

		assert.deepEqual(await projectHost.getActiveProject(), {
			id: "alpha-project",
			name: "Alpha Project",
			root: tempRoot,
			manifestPath,
		});
	});
});

test("desktop project host reopens an existing project and restores workspace state without moving arbitrary files", async () => {
	const { host, workspaceStateStore } = await loadModules();

	await withTempProject("friday-desktop-project-reopen-", async (tempRoot) => {
		const notesDir = path.join(tempRoot, "notes");
		const notePath = path.join(notesDir, "brief.md");
		await fs.mkdir(notesDir, { recursive: true });
		await fs.writeFile(notePath, "# Existing project file\n", "utf8");

		const projectHost = new host.DesktopProjectHost();
		const firstSession = await projectHost.initializeProject(tempRoot, {
			projectId: "existing-project",
			name: "Existing Project",
		});
		const firstManifest = firstSession.manifest;
		const manifestPath = path.join(tempRoot, "FRIDAY", "project.json");
		const firstRaw = await fs.readFile(manifestPath, "utf8");

		const workspaceState = {
			activeProjectId: "existing-project",
			activeConversationId: "conversation-42",
			activeArtifactId: "artifact-7",
			layout: {
				view: "project-home",
				sidebar: "library",
			},
			resourcePanelState: {
				open: true,
				tab: "artifacts",
			},
		};
		await new workspaceStateStore.WorkspaceStateStore(tempRoot).save(workspaceState);

		const reopenedHost = new host.DesktopProjectHost();
		const reopenedSession = await reopenedHost.initializeProject(tempRoot, {
			projectId: "should-not-replace",
			name: "Should Not Replace",
		});
		const reopenedRaw = await fs.readFile(manifestPath, "utf8");

		assert.deepEqual(reopenedSession.manifest, firstManifest);
		assert.deepEqual(reopenedSession.project, {
			id: "existing-project",
			name: "Existing Project",
			root: tempRoot,
			manifestPath,
		});
		assert.equal(reopenedSession.workspaceState.activeProjectId, "existing-project");
		assert.equal(reopenedSession.workspaceState.activeConversationId, "conversation-42");
		assert.equal(reopenedSession.workspaceState.activeArtifactId, "artifact-7");
		assert.deepEqual(reopenedSession.workspaceState.layout, workspaceState.layout);
		assert.deepEqual(reopenedSession.workspaceState.resourcePanelState, workspaceState.resourcePanelState);
		assert.equal(reopenedRaw, firstRaw);
		assert.equal(await fs.readFile(notePath, "utf8"), "# Existing project file\n");
	});
});

test("desktop project host treats the selected folder as authoritative over stale manifest rootPath", async () => {
	const { host } = await loadModules();

	await withTempProject("friday-desktop-stale-manifest-root-", async (tempRoot) => {
		const staleRoot = path.join(os.tmpdir(), "friday-stale-copied-root");
		const fridayRoot = path.join(tempRoot, "FRIDAY");
		const manifestPath = path.join(fridayRoot, "project.json");
		await fs.mkdir(fridayRoot, { recursive: true });
		await fs.writeFile(
			manifestPath,
			`${JSON.stringify({
				schemaVersion: 1,
				projectId: "copied-project",
				name: "Copied Project",
				rootPath: staleRoot,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				defaultPermissionMode: "standard",
				gitProfile: { isRepository: false },
			}, null, 2)}\n`,
			"utf8",
		);

		const projectHost = new host.DesktopProjectHost();
		const session = await projectHost.initializeProject(tempRoot);

		assert.equal(session.manifest.rootPath, tempRoot);
		assert.equal(session.project.root, tempRoot);
		assert.equal(await projectHost.getProjectRoot("copied-project"), tempRoot);
	});
});

test("workspace state store persists and restores project workspace state", async () => {
	const { workspaceStateStore } = await loadModules();

	await withTempProject("friday-desktop-workspace-state-", async (tempRoot) => {
		const store = new workspaceStateStore.WorkspaceStateStore(tempRoot);
		assert.equal(await store.restore(), null);

		const state = {
			activeProjectId: "alpha-project",
			activeConversationId: "conversation-1",
			activeArtifactId: "artifact-1",
			layout: {
				view: "conversation",
				split: [0.62, 0.38],
			},
			resourcePanelState: {
				open: true,
				tab: "references",
			},
		};

		await store.save(state);

		const restored = await store.restore();
		assert.equal(restored.activeProjectId, "alpha-project");
		assert.equal(restored.activeConversationId, "conversation-1");
		assert.equal(restored.activeArtifactId, "artifact-1");
		assert.deepEqual(restored.layout, state.layout);
		assert.deepEqual(restored.resourcePanelState, state.resourcePanelState);
		assert.match(restored.lastOpenedAt, /^\d{4}-\d{2}-\d{2}T/);

		const persisted = JSON.parse(
			await fs.readFile(path.join(tempRoot, "FRIDAY", "state", "workspace-state.json"), "utf8"),
		);
		assert.deepEqual(persisted, restored);
	});
});

test("workspace state store saveWorkspaceState uses method projectId as the active project source of truth", async () => {
	const { workspaceStateStore } = await loadModules();

	await withTempProject("friday-desktop-workspace-state-project-id-", async (tempRoot) => {
		const store = new workspaceStateStore.WorkspaceStateStore(tempRoot);

		await store.saveWorkspaceState("canonical-project", {
			activeProjectId: "stale-project",
			activeConversationId: "conversation-1",
			layout: {
				view: "project-home",
			},
		});

		const restored = await store.restore();
		assert.equal(restored.activeProjectId, "canonical-project");
		assert.equal(restored.activeConversationId, "conversation-1");
		assert.deepEqual(restored.layout, { view: "project-home" });

		const persisted = JSON.parse(
			await fs.readFile(path.join(tempRoot, "FRIDAY", "state", "workspace-state.json"), "utf8"),
		);
		assert.equal(persisted.activeProjectId, "canonical-project");
	});
});

test("project manifest store reads missing manifests as null and preserves stable manifests", async () => {
	const { manifestStore } = await loadModules();

	await withTempProject("friday-desktop-manifest-store-", async (tempRoot) => {
		const store = new manifestStore.ProjectManifestStore(tempRoot);
		assert.equal(await store.read(), null);

		const first = await store.initialize({
			projectId: "stable-project",
			name: "Stable Project",
		});
		const second = await store.initialize({
			projectId: "replacement-project",
			name: "Replacement Project",
		});

		assert.deepEqual(second, first);
		assert.equal(second.projectId, "stable-project");
		assert.equal(second.name, "Stable Project");
	});
});
