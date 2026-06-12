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

const artifactStorePath = path.join(projectRoot, "src/desktop/state/ArtifactStore.ts");
const canvasStateStorePath = path.join(projectRoot, "src/desktop/state/CanvasStateStore.ts");

async function loadModules() {
	return {
		artifact: await jiti.import(artifactStorePath),
		canvas: await jiti.import(canvasStateStorePath),
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

function createContext(projectRootPath, overrides = {}) {
	return {
		projectId: "desktop-project",
		conversationId: "conversation-1",
		turnId: "turn-1",
		permissionMode: "standard",
		projectRoot: projectRootPath,
		...overrides,
	};
}

function sequenceFactory(values) {
	let index = 0;
	return () => values[index++] ?? values.at(-1);
}

test("generated artifacts create managed manifest and version files under FRIDAY artifacts", async () => {
	const { artifact } = await loadModules();

	await withTempProject("friday-desktop-artifact-generated-", async (projectRootPath) => {
		const store = new artifact.ArtifactStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:00.000Z"),
			idFactory: () => "artifact-html-report",
			versionIdFactory: () => "version-initial",
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-artifacts",
			turnId: "turn-create-html",
		});

		const manifest = await store.createGeneratedArtifact(context, {
			artifactType: "html",
			title: "桌面端产品规划",
			renderable: true,
			source: {
				kind: "friday_generated",
				turnId: "turn-create-html",
			},
			files: [
				{
					path: "index.html",
					content: "<h1>FRIDAY Desktop</h1>",
					contentType: "text/html",
				},
			],
			metadata: {
				status: "draft",
			},
		});

		const artifactRoot = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-html-report");
		const manifestPath = path.join(artifactRoot, "artifact.json");
		const managedFilePath = path.join(artifactRoot, "files", "version-initial", "index.html");
		const persisted = JSON.parse(await fs.readFile(manifestPath, "utf8"));

		assert.equal(manifest.id, "artifact-html-report");
		assert.equal(manifest.artifactId, "artifact-html-report");
		assert.equal(manifest.projectId, "desktop-project");
		assert.equal(manifest.conversationId, "conversation-artifacts");
		assert.equal(manifest.createdTurnId, "turn-create-html");
		assert.equal(manifest.updatedTurnId, "turn-create-html");
		assert.equal(manifest.artifactType, "html");
		assert.equal(manifest.title, "桌面端产品规划");
		assert.equal(manifest.renderable, true);
		assert.equal(manifest.currentVersionId, "version-initial");
		assert.equal(manifest.storageMode, "managed_file");
		assert.deepEqual(manifest.source, {
			kind: "friday_generated",
			turnId: "turn-create-html",
		});
		assert.equal(manifest.versions.length, 1);
		assert.equal(manifest.versions[0].versionId, "version-initial");
		assert.equal(manifest.versions[0].createdTurnId, "turn-create-html");
		assert.equal(manifest.versions[0].files[0].path, "index.html");
		assert.equal(manifest.versions[0].files[0].managedPath, "FRIDAY/artifacts/artifact-html-report/files/version-initial/index.html");
		assert.equal(manifest.createdAt, "2026-06-12T00:00:00.000Z");
		assert.equal(manifest.updatedAt, "2026-06-12T00:00:00.000Z");
		assert.deepEqual(manifest.metadata, { status: "draft" });
		assert.deepEqual(persisted, manifest);
		assert.equal(await fs.readFile(managedFilePath, "utf8"), "<h1>FRIDAY Desktop</h1>");
	});
});

test("opening existing project renderable files creates reference wrappers without copying project files", async () => {
	const { artifact } = await loadModules();

	await withTempProject("friday-desktop-artifact-wrapper-", async (projectRootPath) => {
		const projectFilePath = path.join(projectRootPath, "docs", "existing-plan.md");
		await fs.mkdir(path.dirname(projectFilePath), { recursive: true });
		await fs.writeFile(projectFilePath, "# Existing plan\n", "utf8");

		const store = new artifact.ArtifactStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:01.000Z"),
			idFactory: () => "artifact-existing-plan",
			versionIdFactory: () => "version-project-file",
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-wrapper",
			turnId: "turn-open-existing-file",
		});

		const manifest = await store.openProjectFileArtifact(context, {
			projectFilePath: "docs/existing-plan.md",
			artifactType: "markdown",
			title: "Existing plan",
			renderable: true,
		});

		assert.equal(manifest.storageMode, "project_file_reference");
		assert.equal(manifest.currentVersionId, "version-project-file");
		assert.deepEqual(manifest.source, {
			kind: "project_file",
			projectRelativePath: "docs/existing-plan.md",
		});
		assert.equal(manifest.versions[0].files[0].projectRelativePath, "docs/existing-plan.md");
		assert.equal(manifest.versions[0].files[0].managedPath, undefined);
		assert.equal(await fs.readFile(projectFilePath, "utf8"), "# Existing plan\n");

		const artifactRoot = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-existing-plan");
		const artifactEntries = await fs.readdir(artifactRoot);
		assert.deepEqual(artifactEntries, ["artifact.json"]);
		await assert.rejects(() => fs.stat(path.join(artifactRoot, "files")), /ENOENT/);
	});
});

test("artifact listing is scoped to the current conversation", async () => {
	const { artifact } = await loadModules();

	await withTempProject("friday-desktop-artifact-list-", async (projectRootPath) => {
		const store = new artifact.ArtifactStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:02.000Z"),
			idFactory: sequenceFactory(["artifact-a-1", "artifact-b-1", "artifact-a-2"]),
			versionIdFactory: sequenceFactory(["version-a-1", "version-b-1", "version-a-2"]),
		});

		await store.createGeneratedArtifact(createContext(projectRootPath, {
			conversationId: "conversation-a",
			turnId: "turn-a-1",
		}), {
			artifactType: "markdown",
			title: "A one",
			files: [{ path: "a.md", content: "A one" }],
		});
		await store.createGeneratedArtifact(createContext(projectRootPath, {
			conversationId: "conversation-b",
			turnId: "turn-b-1",
		}), {
			artifactType: "markdown",
			title: "B one",
			files: [{ path: "b.md", content: "B one" }],
		});
		await store.createGeneratedArtifact(createContext(projectRootPath, {
			conversationId: "conversation-a",
			turnId: "turn-a-2",
		}), {
			artifactType: "html",
			title: "A two",
			files: [{ path: "a.html", content: "<p>A two</p>" }],
		});

		const conversationAArtifacts = await store.listConversationArtifacts("conversation-a");
		assert.deepEqual(conversationAArtifacts.map((item) => item.id), ["artifact-a-1", "artifact-a-2"]);
		assert.deepEqual(conversationAArtifacts.map((item) => item.title), ["A one", "A two"]);
		assert.deepEqual((await store.listConversationArtifacts("conversation-b")).map((item) => item.id), ["artifact-b-1"]);
	});
});

test("artifact reads reject persisted managed and project reference paths that escape their boundary", async () => {
	const { artifact } = await loadModules();

	await withTempProject("friday-desktop-artifact-path-boundary-", async (projectRootPath) => {
		const outsideManagedPath = path.resolve(projectRootPath, "..", `${path.basename(projectRootPath)}-outside-managed.txt`);
		const outsideProjectFilePath = path.resolve(projectRootPath, "..", `${path.basename(projectRootPath)}-outside-project.md`);
		await fs.writeFile(outsideManagedPath, "outside managed", "utf8");
		await fs.writeFile(outsideProjectFilePath, "outside project", "utf8");
		try {
			const store = new artifact.ArtifactStore(projectRootPath, {
				clock: () => new Date("2026-06-12T00:00:04.000Z"),
				idFactory: sequenceFactory(["artifact-managed-escape", "artifact-project-escape"]),
				versionIdFactory: sequenceFactory(["version-managed-escape", "version-project-escape"]),
			});
			const context = createContext(projectRootPath, {
				conversationId: "conversation-boundary",
				turnId: "turn-boundary",
			});
			const managed = await store.createGeneratedArtifact(context, {
				artifactType: "html",
				title: "Managed escape",
				files: [
					{
						path: "index.html",
						content: "<p>inside</p>",
					},
				],
			});
			const managedManifestPath = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-managed-escape", "artifact.json");
			const managedManifest = JSON.parse(await fs.readFile(managedManifestPath, "utf8"));
			managedManifest.versions[0].files[0].managedPath = `../${path.basename(outsideManagedPath)}`;
			await fs.writeFile(managedManifestPath, `${JSON.stringify(managedManifest, null, 2)}\n`, "utf8");

			await assert.rejects(
				() => store.readArtifactVersionFile(context, managed.id, managed.currentVersionId, "index.html"),
				/artifact path|escapes|invalid/i,
			);

			const projectFilePath = path.join(projectRootPath, "docs", "inside.md");
			await fs.mkdir(path.dirname(projectFilePath), { recursive: true });
			await fs.writeFile(projectFilePath, "# Inside\n", "utf8");
			const wrapped = await store.openProjectFileArtifact(context, {
				projectFilePath: "docs/inside.md",
				artifactType: "markdown",
				title: "Project escape",
			});
			const wrapperManifestPath = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-project-escape", "artifact.json");
			const wrapperManifest = JSON.parse(await fs.readFile(wrapperManifestPath, "utf8"));
			wrapperManifest.versions[0].files[0].projectRelativePath = `../${path.basename(outsideProjectFilePath)}`;
			await fs.writeFile(wrapperManifestPath, `${JSON.stringify(wrapperManifest, null, 2)}\n`, "utf8");

			await assert.rejects(
				() => store.readArtifactVersionFile(context, wrapped.id, wrapped.currentVersionId, "inside.md"),
				/project file path|escapes|invalid/i,
			);
		} finally {
			await fs.rm(outsideManagedPath, { force: true });
			await fs.rm(outsideProjectFilePath, { force: true });
		}
	});
});

test("artifact reads skip malformed manifests without stable identity or with mismatched storage ids", async () => {
	const { artifact } = await loadModules();

	await withTempProject("friday-desktop-artifact-malformed-manifest-", async (projectRootPath) => {
		const store = new artifact.ArtifactStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:05.000Z"),
		});
		const missingIdentityRoot = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-missing-identity");
		const mismatchedRoot = path.join(projectRootPath, "FRIDAY", "artifacts", "artifact-folder-id");
		await fs.mkdir(missingIdentityRoot, { recursive: true });
		await fs.mkdir(mismatchedRoot, { recursive: true });
		await fs.writeFile(
			path.join(missingIdentityRoot, "artifact.json"),
			`${JSON.stringify({
				schemaVersion: 1,
				artifactType: "html",
				title: "Missing identity",
			}, null, 2)}\n`,
			"utf8",
		);
		await fs.writeFile(
			path.join(mismatchedRoot, "artifact.json"),
			`${JSON.stringify({
				schemaVersion: 1,
				id: "artifact-different-id",
				artifactId: "artifact-different-id",
				projectId: "desktop-project",
				conversationId: "conversation-malformed",
				createdTurnId: "turn-malformed",
				updatedTurnId: "turn-malformed",
				artifactType: "html",
				renderable: true,
				storageMode: "managed_file",
				source: {},
				versions: [],
				createdAt: "2026-06-12T00:00:05.000Z",
				updatedAt: "2026-06-12T00:00:05.000Z",
				metadata: {},
			}, null, 2)}\n`,
			"utf8",
		);

		assert.equal(await store.readArtifactManifest("artifact-missing-identity"), null);
		assert.equal(await store.readArtifactManifest("artifact-folder-id"), null);
		assert.deepEqual(await store.listConversationArtifacts("conversation-malformed"), []);
	});
});

test("canvas state restores active artifact and tab order for each conversation", async () => {
	const { canvas } = await loadModules();

	await withTempProject("friday-desktop-canvas-state-", async (projectRootPath) => {
		const store = new canvas.CanvasStateStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:03.000Z"),
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-canvas",
			turnId: "turn-canvas",
		});

		await store.saveConversationCanvasState(context, {
			activeArtifactId: "artifact-2",
			tabs: [
				{ artifactId: "artifact-1" },
				{ artifactId: "artifact-2" },
				{ artifactId: "artifact-3", pinned: true },
			],
			layout: {
				splitDirection: "horizontal",
				splitRatio: 0.64,
			},
		});
		await store.saveConversationCanvasState(createContext(projectRootPath, {
			conversationId: "conversation-other",
			turnId: "turn-other",
		}), {
			activeArtifactId: "artifact-other",
			tabs: [{ artifactId: "artifact-other" }],
		});

		const restored = await store.restoreConversationCanvasState("conversation-canvas");
		assert.equal(restored.projectId, "desktop-project");
		assert.equal(restored.conversationId, "conversation-canvas");
		assert.equal(restored.activeArtifactId, "artifact-2");
		assert.deepEqual(restored.tabOrder, ["artifact-1", "artifact-2", "artifact-3"]);
		assert.deepEqual(restored.tabs, [
			{ artifactId: "artifact-1" },
			{ artifactId: "artifact-2" },
			{ artifactId: "artifact-3", pinned: true },
		]);
		assert.deepEqual(restored.layout, {
			splitDirection: "horizontal",
			splitRatio: 0.64,
		});
		assert.equal(restored.updatedAt, "2026-06-12T00:00:03.000Z");

		const persisted = JSON.parse(
			await fs.readFile(path.join(projectRootPath, "FRIDAY", "state", "canvas-state.json"), "utf8"),
		);
		assert.deepEqual(Object.keys(persisted.conversations).sort(), ["conversation-canvas", "conversation-other"]);
		assert.deepEqual(persisted.conversations["conversation-canvas"], restored);
	});
});
