/* eslint-env node */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const nodeFileSystemHostPath = path.join(projectRoot, "src/desktop/host/node/NodeFileSystemHost.ts");
const importStorePath = path.join(projectRoot, "src/desktop/state/ImportStore.ts");
const runtimeStateStorePath = path.join(projectRoot, "src/desktop/state/DesktopRuntimeStateStore.ts");

async function loadModules() {
	return {
		fileSystemHost: await jiti.import(nodeFileSystemHostPath),
		importStore: await jiti.import(importStorePath),
		runtimeStateStore: await jiti.import(runtimeStateStorePath),
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

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

async function createDirectoryLinkOrSkip(t, targetPath, linkPath) {
	try {
		await fs.symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
		return true;
	} catch (error) {
		if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error?.code)) {
			t.skip(`Directory symlinks are not available on this filesystem: ${error.code}`);
			return false;
		}
		throw error;
	}
}

test("node filesystem host reads project files by relative path and rejects project escapes", async () => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-file-read-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const outsidePath = path.join(tempRoot, "outside.md");
		await fs.mkdir(path.join(projectRootPath, "notes"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "notes", "brief.md"), "# Brief\n", "utf8");
		await fs.writeFile(outsidePath, "# Outside\n", "utf8");

		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath);
		const result = await host.readProjectFile(context, "notes/brief.md");

		assert.equal(result.path, "notes/brief.md");
		assert.equal(result.content, "# Brief\n");
		assert.match(result.mtime, /^\d{4}-\d{2}-\d{2}T/);
		await assert.rejects(() => host.readProjectFile(context, "../outside.md"), /outside project root|relative project path/i);
		await assert.rejects(() => host.readProjectFile(context, outsidePath), /outside project root|relative project path/i);
	});
});

test("node filesystem host rejects project reads through a symlink that escapes the project root", async (t) => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-file-read-symlink-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const outsideRoot = path.join(tempRoot, "outside");
		const linkPath = path.join(projectRootPath, "linked");
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(outsideRoot, { recursive: true });
		await fs.writeFile(path.join(outsideRoot, "secret.md"), "# Outside\n", "utf8");
		if (!await createDirectoryLinkOrSkip(t, outsideRoot, linkPath)) {
			return;
		}

		const host = new fileSystemHost.NodeFileSystemHost();
		await assert.rejects(
			() => host.readProjectFile(createContext(projectRootPath), "linked/secret.md"),
			/outside project root|symlink/i,
		);
	});
});

test("node filesystem host rejects project writes through escaping symlink parents", async (t) => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-file-write-symlink-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const outsideRoot = path.join(tempRoot, "outside");
		const linkPath = path.join(projectRootPath, "linked");
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(outsideRoot, { recursive: true });
		await fs.writeFile(path.join(outsideRoot, "existing.md"), "# Existing\n", "utf8");
		if (!await createDirectoryLinkOrSkip(t, outsideRoot, linkPath)) {
			return;
		}

		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath);
		await assert.rejects(
			() => host.writeProjectFile(context, { path: "linked/existing.md", content: "# Changed\n" }),
			/outside project root|symlink/i,
		);
		await assert.rejects(
			() => host.writeProjectFile(context, { path: "linked/new.md", content: "# New\n" }),
			/outside project root|symlink/i,
		);
		assert.equal(await fs.readFile(path.join(outsideRoot, "existing.md"), "utf8"), "# Existing\n");
		await assert.rejects(() => fs.stat(path.join(outsideRoot, "new.md")), /ENOENT/);
	});
});

test("node filesystem host snapshots external imports into a conversation import directory", async () => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-import-file-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const sourceRoot = path.join(tempRoot, "external");
		const sourcePath = path.join(sourceRoot, "source-note.md");
		const sourceContent = "# External source\n";
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(sourceRoot, { recursive: true });
		await fs.writeFile(sourcePath, sourceContent, "utf8");

		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath, {
			conversationId: "conversation-imports",
			turnId: "turn-import",
		});
		const snapshot = await host.importExternalFileSnapshot(context, sourcePath);
		const expectedManagedPath = `FRIDAY/imports/conversation-imports/${snapshot.importId}/source-note.md`;
		const copiedPath = path.join(projectRootPath, expectedManagedPath);
		const metadataPath = path.join(projectRootPath, "FRIDAY", "imports", "conversation-imports", snapshot.importId, "import.json");
		const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));

		assert.match(snapshot.importId, /^import-/);
		assert.equal(snapshot.sourcePath, path.resolve(sourcePath));
		assert.equal(snapshot.managedPath, expectedManagedPath);
		assert.equal(snapshot.hash, sha256(sourceContent));
		assert.equal(snapshot.mimeType, "text/markdown");
		assert.equal(snapshot.createdTurnId, "turn-import");
		assert.equal(await fs.readFile(copiedPath, "utf8"), sourceContent);
		assert.deepEqual(metadata, {
			schemaVersion: 1,
			importId: snapshot.importId,
			sourcePath: path.resolve(sourcePath),
			managedPath: expectedManagedPath,
			originalFileName: "source-note.md",
			hash: sha256(sourceContent),
			mimeType: "text/markdown",
			createdTurnId: "turn-import",
			createdAt: metadata.createdAt,
		});
		assert.match(metadata.createdAt, /^\d{4}-\d{2}-\d{2}T/);
	});
});

test("node filesystem host does not snapshot files already inside the project", async () => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-import-project-file-", async (projectRootPath) => {
		const internalPath = path.join(projectRootPath, "notes", "brief.md");
		await fs.mkdir(path.dirname(internalPath), { recursive: true });
		await fs.writeFile(internalPath, "# Internal source\n", "utf8");

		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath, {
			conversationId: "conversation-internal-import",
			turnId: "turn-import",
		});

		await assert.rejects(
			() => host.importExternalFileSnapshot(context, internalPath),
			/project files are direct sources|inside project root/i,
		);
		await assert.rejects(
			() => fs.stat(path.join(projectRootPath, "FRIDAY", "imports", "conversation-internal-import")),
			/ENOENT/,
		);
	});
});

test("import store archives a conversation imports directory with the conversation", async () => {
	const { importStore } = await loadModules();

	await withTempProject("friday-desktop-import-archive-", async (projectRootPath) => {
		const importRoot = path.join(projectRootPath, "FRIDAY", "imports", "conversation-archive", "import-alpha");
		const sourcePath = path.join(importRoot, "source.md");
		await fs.mkdir(importRoot, { recursive: true });
		await fs.writeFile(sourcePath, "# Archived import\n", "utf8");

		const store = new importStore.ImportStore(projectRootPath);
		const archivedPath = await store.archiveConversationImports("conversation-archive");

		assert.equal(archivedPath, path.join(projectRootPath, "FRIDAY", "archive", "conversations", "conversation-archive", "imports"));
		await assert.rejects(() => fs.stat(path.join(projectRootPath, "FRIDAY", "imports", "conversation-archive")), /ENOENT/);
		assert.equal(
			await fs.readFile(path.join(projectRootPath, "FRIDAY", "archive", "conversations", "conversation-archive", "imports", "import-alpha", "source.md"), "utf8"),
			"# Archived import\n",
		);
	});
});

test("node filesystem host writes only FRIDAY managed files and uses an atomic replace", async () => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-managed-write-", async (projectRootPath) => {
		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath);
		const managedRelativePath = path.join("FRIDAY", "runtime", "conversations", "conversation-1", "state.json");

		await host.writeManagedFile(context, {
			path: managedRelativePath,
			content: "{\"status\":\"old\"}\n",
		});
		await host.writeManagedFile(context, {
			path: managedRelativePath,
			content: "{\"status\":\"new\"}\n",
			atomic: true,
		});

		assert.equal(
			await fs.readFile(path.join(projectRootPath, managedRelativePath), "utf8"),
			"{\"status\":\"new\"}\n",
		);
		assert.deepEqual(
			(await fs.readdir(path.dirname(path.join(projectRootPath, managedRelativePath)))).filter((entry) => entry.endsWith(".tmp")),
			[],
		);
		await assert.rejects(
			() => host.writeManagedFile(context, { path: "notes/owned.md", content: "no\n" }),
			/FRIDAY managed path|outside FRIDAY/i,
		);
		await assert.rejects(
			() => host.writeManagedFile(context, { path: path.join("FRIDAY", "..", "escape.md"), content: "no\n" }),
			/FRIDAY managed path|outside FRIDAY/i,
		);
	});
});

test("node filesystem host rejects managed writes through symlinks escaping FRIDAY", async (t) => {
	const { fileSystemHost } = await loadModules();

	await withTempProject("friday-desktop-managed-write-symlink-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const outsideRoot = path.join(tempRoot, "outside");
		const linkPath = path.join(projectRootPath, "FRIDAY", "runtime", "linked");
		await fs.mkdir(path.dirname(linkPath), { recursive: true });
		await fs.mkdir(outsideRoot, { recursive: true });
		await fs.writeFile(path.join(outsideRoot, "existing.json"), "{\"status\":\"outside\"}\n", "utf8");
		if (!await createDirectoryLinkOrSkip(t, outsideRoot, linkPath)) {
			return;
		}

		const host = new fileSystemHost.NodeFileSystemHost();
		const context = createContext(projectRootPath);
		await assert.rejects(
			() => host.writeManagedFile(context, {
				path: "FRIDAY/runtime/linked/existing.json",
				content: "{\"status\":\"changed\"}\n",
			}),
			/outside FRIDAY|FRIDAY managed path|symlink/i,
		);
		await assert.rejects(
			() => host.writeManagedFile(context, {
				path: "FRIDAY/runtime/linked/new.json",
				content: "{\"status\":\"new\"}\n",
			}),
			/outside FRIDAY|FRIDAY managed path|symlink/i,
		);
		assert.equal(await fs.readFile(path.join(outsideRoot, "existing.json"), "utf8"), "{\"status\":\"outside\"}\n");
		await assert.rejects(() => fs.stat(path.join(outsideRoot, "new.json")), /ENOENT/);
	});
});

test("desktop runtime state store persists conversation, turn, trace, reference, artifact, and workspace state", async () => {
	const { runtimeStateStore } = await loadModules();

	await withTempProject("friday-desktop-runtime-state-", async (projectRootPath) => {
		const store = new runtimeStateStore.DesktopRuntimeStateStore(projectRootPath);
		const context = createContext(projectRootPath, {
			conversationId: "conversation-state",
			turnId: "turn-state",
		});

		await store.saveConversation({
			id: "conversation-state",
			projectId: "desktop-project",
			title: "State test",
			createdAt: "2026-06-12T00:00:00.000Z",
			updatedAt: "2026-06-12T00:00:01.000Z",
		});
		await store.saveTurn(context, {
			id: "turn-state",
			conversationId: "conversation-state",
			role: "user",
			content: "Read the brief.",
			createdAt: "2026-06-12T00:00:02.000Z",
		});
		await store.saveTrace(context, {
			event: "file_read",
			path: "notes/brief.md",
		});
		await store.saveReference(context, {
			id: "reference-1",
			conversationId: "conversation-state",
			turnId: "turn-state",
			targetUri: "project://notes/brief.md",
			source: "mention",
		});
		await store.saveArtifact(context, {
			id: "artifact-1",
			conversationId: "conversation-state",
			path: "FRIDAY/artifacts/conversation-state/artifact-1.md",
		});
		await store.saveWorkspaceState("desktop-project", {
			activeProjectId: "stale-project",
			activeConversationId: "conversation-state",
			activeArtifactId: "artifact-1",
			layout: {
				view: "conversation",
			},
			resourcePanelState: {
				tab: "artifacts",
			},
		});

		const conversation = JSON.parse(
			await fs.readFile(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-state", "conversation.json"), "utf8"),
		);
		const turns = await fs.readFile(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-state", "turns.jsonl"), "utf8");
		const traces = await fs.readFile(path.join(projectRootPath, "FRIDAY", "traces", "conversation-state.jsonl"), "utf8");
		const references = await fs.readFile(path.join(projectRootPath, "FRIDAY", "references", "conversation-state.jsonl"), "utf8");
		const artifacts = await fs.readFile(path.join(projectRootPath, "FRIDAY", "artifacts", "conversation-state.jsonl"), "utf8");
		const workspaceState = await store.restoreWorkspaceState("desktop-project");

		assert.equal(conversation.id, "conversation-state");
		assert.equal(JSON.parse(turns.trim()).id, "turn-state");
		assert.deepEqual(JSON.parse(traces.trim()), {
			conversationId: "conversation-state",
			turnId: "turn-state",
			recordedAt: JSON.parse(traces.trim()).recordedAt,
			event: "file_read",
			path: "notes/brief.md",
		});
		assert.equal(JSON.parse(references.trim()).id, "reference-1");
		assert.equal(JSON.parse(artifacts.trim()).id, "artifact-1");
		assert.equal(workspaceState.activeProjectId, "desktop-project");
		assert.equal(workspaceState.activeConversationId, "conversation-state");
		assert.equal(workspaceState.activeArtifactId, "artifact-1");
		assert.deepEqual(workspaceState.layout, { view: "conversation" });
		assert.deepEqual(workspaceState.resourcePanelState, { tab: "artifacts" });
	});
});
