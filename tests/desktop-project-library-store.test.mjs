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

const projectLibraryStorePath = path.join(projectRoot, "src/desktop/state/ProjectLibraryStore.ts");
const projectFileTreeReaderPath = path.join(projectRoot, "src/desktop/state/ProjectFileTreeReader.ts");

async function loadModules() {
	return {
		library: await jiti.import(projectLibraryStorePath),
		fileTree: await jiti.import(projectFileTreeReaderPath),
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

function flattenTree(entries) {
	const paths = [];
	for (const entry of entries) {
		paths.push(entry.path);
		if (entry.children) {
			paths.push(...flattenTree(entry.children));
		}
	}
	return paths;
}

function findTreeEntry(entries, targetPath) {
	for (const entry of entries) {
		if (entry.path === targetPath) {
			return entry;
		}
		if (entry.children) {
			const found = findTreeEntry(entry.children, targetPath);
			if (found) {
				return found;
			}
		}
	}
	return undefined;
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

async function createBrokenFileLinkOrSkip(t, targetPath, linkPath) {
	try {
		await fs.symlink(targetPath, linkPath, "file");
		return true;
	} catch (error) {
		if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error?.code)) {
			t.skip(`File symlinks are not available on this filesystem: ${error.code}`);
			return false;
		}
		throw error;
	}
}

function sequenceFactory(values) {
	let index = 0;
	return () => values[index++] ?? values.at(-1);
}

test("project file tree excludes FRIDAY internals, runtime cache, and configured ignored entries", async () => {
	const { fileTree } = await loadModules();

	await withTempProject("friday-desktop-file-tree-", async (projectRootPath) => {
		await fs.mkdir(path.join(projectRootPath, "docs"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "src"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "FRIDAY", "context"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "FRIDAY", "local"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "FRIDAY", "runtime"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, ".git"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "node_modules", "pkg"), { recursive: true });
		await fs.mkdir(path.join(projectRootPath, "scratch"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "docs", "brief.md"), "# Brief\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "src", "index.ts"), "export {};\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "FRIDAY", "context", "registry.json"), "{}\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "FRIDAY", "local", "cache.json"), "{}\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "FRIDAY", "runtime", "state.json"), "{}\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, ".git", "config"), "[core]\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "node_modules", "pkg", "index.js"), "\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "scratch", "ignored.md"), "# Ignored\n", "utf8");

		const reader = new fileTree.ProjectFileTreeReader(projectRootPath, {
			ignoredEntries: ["scratch"],
		});
		const entries = await reader.read();

		assert.deepEqual(flattenTree(entries), [
			"docs",
			"docs/brief.md",
			"src",
			"src/index.ts",
		]);
	});
});

test("project file tree skips broken symlinks without failing the whole tree", async (t) => {
	const { fileTree } = await loadModules();

	await withTempProject("friday-desktop-file-tree-broken-link-", async (projectRootPath) => {
		await fs.mkdir(path.join(projectRootPath, "docs"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "docs", "brief.md"), "# Brief\n", "utf8");
		if (!await createBrokenFileLinkOrSkip(
			t,
			path.join(projectRootPath, "missing-target.md"),
			path.join(projectRootPath, "broken-link.md"),
		)) {
			return;
		}

		const reader = new fileTree.ProjectFileTreeReader(projectRootPath);
		const entries = await reader.read();

		assert.deepEqual(flattenTree(entries), [
			"docs",
			"docs/brief.md",
		]);
	});
});

test("registering project files writes metadata only and marks file tree entries as already checked", async () => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-", async (projectRootPath) => {
		const projectFilePath = path.join(projectRootPath, "docs", "brief.md");
		await fs.mkdir(path.dirname(projectFilePath), { recursive: true });
		await fs.writeFile(projectFilePath, "# Brief\n", "utf8");

		const store = new library.ProjectLibraryStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:00.000Z"),
			idFactory: () => "context-brief",
		});
		const context = createContext(projectRootPath);
		const item = await store.registerProjectFile(context, {
			path: "docs/brief.md",
			description: "项目背景资料",
			enabled: true,
		});

		assert.deepEqual(item, {
			id: "context-brief",
			path: "docs/brief.md",
			title: "brief.md",
			description: "项目背景资料",
			enabled: true,
			metadata: {
				sourceType: "project_file",
				summary: { status: "pending" },
				createdAt: "2026-06-12T00:00:00.000Z",
				updatedAt: "2026-06-12T00:00:00.000Z",
			},
		});

		assert.equal(await fs.readFile(projectFilePath, "utf8"), "# Brief\n");
		assert.deepEqual(await fs.readdir(path.join(projectRootPath, "FRIDAY", "context")), ["registry.json"]);
		assert.deepEqual(await store.listContextItems("desktop-project"), [item]);

		const tree = await store.readProjectFileTree("desktop-project");
		assert.equal(findTreeEntry(tree, "docs/brief.md")?.contextItemId, "context-brief");
	});
});

test("project library rejects duplicate id and path conflicts without corrupting registry", async () => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-uniqueness-", async (projectRootPath) => {
		await fs.mkdir(path.join(projectRootPath, "docs"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "docs", "alpha.md"), "# Alpha\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "docs", "beta.md"), "# Beta\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "docs", "gamma.md"), "# Gamma\n", "utf8");

		const store = new library.ProjectLibraryStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:00.000Z"),
			idFactory: sequenceFactory(["context-alpha", "context-beta", "context-unused"]),
		});
		const context = createContext(projectRootPath);
		const alpha = await store.registerProjectFile(context, { path: "docs/alpha.md" });
		const beta = await store.registerProjectFile(context, { path: "docs/beta.md" });

		await assert.rejects(
			() => store.registerContextItem(context, {
				id: "context-beta",
				path: "docs/alpha.md",
				enabled: true,
			}),
			/id.*path|path.*id|conflict|different/i,
		);
		await assert.rejects(
			() => store.registerContextItem(context, {
				id: "context-alpha",
				path: "docs/gamma.md",
				enabled: true,
			}),
			/id.*path|path.*id|conflict|different/i,
		);
		await assert.rejects(
			() => store.updateContextItem(context, {
				...alpha,
				path: "docs/beta.md",
			}),
			/already registered|conflict|different/i,
		);

		assert.deepEqual(await store.listContextItems("desktop-project"), [alpha, beta]);
	});
});

test("project library protects system metadata while preserving caller extra metadata", async () => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-metadata-", async (projectRootPath) => {
		await fs.mkdir(path.join(projectRootPath, "docs"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "docs", "brief.md"), "# Brief\n", "utf8");

		const clockValues = [
			new Date("2026-06-12T00:00:00.000Z"),
			new Date("2026-06-12T00:00:01.000Z"),
		];
		const store = new library.ProjectLibraryStore(projectRootPath, {
			clock: sequenceFactory(clockValues),
			idFactory: () => "context-brief",
		});
		const context = createContext(projectRootPath);
		const created = await store.registerProjectFile(context, {
			path: "docs/brief.md",
			metadata: {
				sourceType: "external_import",
				createdAt: "spoof-created",
				updatedAt: "spoof-updated",
				summary: { status: "complete", text: "spoof summary" },
				custom: "kept",
			},
		});

		assert.deepEqual(created.metadata, {
			custom: "kept",
			sourceType: "project_file",
			summary: { status: "pending" },
			createdAt: "2026-06-12T00:00:00.000Z",
			updatedAt: "2026-06-12T00:00:00.000Z",
		});

		const updated = await store.updateContextItem(context, {
			...created,
			description: "更新后的说明",
			metadata: {
				sourceType: "external_import",
				createdAt: "spoof-created-again",
				updatedAt: "spoof-updated-again",
				summary: { status: "complete", text: "spoof update summary" },
				custom: "changed",
				extra: "survives",
			},
		});

		assert.deepEqual(updated.metadata, {
			custom: "changed",
			extra: "survives",
			sourceType: "project_file",
			summary: { status: "pending" },
			createdAt: "2026-06-12T00:00:00.000Z",
			updatedAt: "2026-06-12T00:00:01.000Z",
		});
	});
});

test("project library rejects absolute paths, path escapes, missing files, and symlink escapes", async (t) => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-boundary-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const outsideRoot = path.join(tempRoot, "outside");
		const outsideFilePath = path.join(outsideRoot, "outside.md");
		const linkPath = path.join(projectRootPath, "linked");
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(outsideRoot, { recursive: true });
		await fs.writeFile(outsideFilePath, "# Outside\n", "utf8");
		if (!await createDirectoryLinkOrSkip(t, outsideRoot, linkPath)) {
			return;
		}

		const store = new library.ProjectLibraryStore(projectRootPath);
		const context = createContext(projectRootPath);

		await assert.rejects(
			() => store.registerProjectFile(context, { path: path.resolve(projectRootPath, "notes.md") }),
			/relative project path/i,
		);
		await assert.rejects(
			() => store.registerProjectFile(context, { path: "../outside/outside.md" }),
			/outside project root|path escape/i,
		);
		await assert.rejects(
			() => store.registerProjectFile(context, { path: "missing.md" }),
			/must exist/i,
		);
		await assert.rejects(
			() => store.registerProjectFile(context, { path: "linked/outside.md" }),
			/outside project root|symlink/i,
		);
	});
});

test("external resources are snapshotted first and returned as pending metadata without registration", async () => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-import-", async (tempRoot) => {
		const projectRootPath = path.join(tempRoot, "project");
		const externalRoot = path.join(tempRoot, "external");
		const externalPath = path.join(externalRoot, "source-note.md");
		await fs.mkdir(projectRootPath, { recursive: true });
		await fs.mkdir(externalRoot, { recursive: true });
		await fs.writeFile(externalPath, "# External\n", "utf8");

		const store = new library.ProjectLibraryStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:01.000Z"),
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-import",
			turnId: "turn-import",
		});
		const result = await store.prepareExternalImport(context, externalPath);

		assert.match(result.snapshot.importId, /^import-/);
		assert.equal(result.snapshot.sourcePath, path.resolve(externalPath));
		assert.match(result.snapshot.managedPath, /^FRIDAY\/imports\/conversation-import\/import-.+\/source-note\.md$/);
		assert.equal(result.pendingItem.path, result.snapshot.managedPath);
		assert.equal(result.pendingItem.title, "source-note.md");
		assert.equal(result.pendingItem.enabled, true);
		assert.equal(result.pendingItem.metadata.sourceType, "external_import");
		assert.equal(result.pendingItem.metadata.importId, result.snapshot.importId);
		assert.equal(await fs.readFile(path.join(projectRootPath, result.snapshot.managedPath), "utf8"), "# External\n");
		assert.deepEqual(await store.listContextItems("desktop-project"), []);
	});
});

test("project library full-view model exposes left file tree and right registered items with descriptions", async () => {
	const { library } = await loadModules();

	await withTempProject("friday-desktop-project-library-view-", async (projectRootPath) => {
		await fs.mkdir(path.join(projectRootPath, "docs"), { recursive: true });
		await fs.writeFile(path.join(projectRootPath, "docs", "brief.md"), "# Brief\n", "utf8");
		await fs.writeFile(path.join(projectRootPath, "docs", "meeting.md"), "# Meeting\n", "utf8");

		const store = new library.ProjectLibraryStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:02.000Z"),
			idFactory: () => "context-meeting",
		});
		await store.registerProjectFile(createContext(projectRootPath), {
			path: "docs/meeting.md",
			description: "会议记录",
		});

		const view = await store.readLibraryView("desktop-project");

		assert.deepEqual(Object.keys(view).sort(), ["fileTree", "registeredItems", "schemaVersion"]);
		assert.deepEqual(flattenTree(view.fileTree), [
			"docs",
			"docs/brief.md",
			"docs/meeting.md",
		]);
		assert.equal(findTreeEntry(view.fileTree, "docs/meeting.md")?.contextItemId, "context-meeting");
		assert.deepEqual(view.registeredItems.map((item) => ({
			id: item.id,
			path: item.path,
			description: item.description,
		})), [
			{
				id: "context-meeting",
				path: "docs/meeting.md",
				description: "会议记录",
			},
		]);
	});
});
