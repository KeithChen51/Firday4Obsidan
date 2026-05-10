/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/tools/ToolPathResolver.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createResolver(mod, overrides = {}) {
	return new mod.ToolPathResolver({
		activeProjectRoot: "ProjectA",
		vaultFiles: [
			"ProjectA/workspace/subdir/example.html",
			"ProjectA/workspace/notes/unique.md",
			"ProjectA/workspace/one/duplicate.md",
			"ProjectA/workspace/two/duplicate.md",
			"ProjectA/raw/source.md",
			"OtherProject/workspace/example.html",
		],
		vaultFolders: [
			"ProjectA",
			"ProjectA/workspace",
			"ProjectA/workspace/subdir",
			"ProjectA/raw",
			"OtherProject",
			"OtherProject/workspace",
		],
		...overrides,
	});
}

test("read resolves active project workspace-relative path to canonical vault file", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const result = resolver.resolve({ intent: "read_file", path: "workspace/subdir/example.html" });

	assert.equal(result.ok, true);
	assert.equal(result.scope, "vault");
	assert.equal(result.targetPath, "ProjectA/workspace/subdir/example.html");
	assert.equal(result.resolvedPath, "ProjectA/workspace/subdir/example.html");
	assert.equal(result.displayPath, "ProjectA/workspace/subdir/example.html");
	assert.equal(result.projectRoot, "ProjectA");
	assert.deepEqual(result.candidates, ["ProjectA/workspace/subdir/example.html"]);
});

test("read preserves canonical active project path", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const result = resolver.resolve({ intent: "read_file", path: "ProjectA/workspace/subdir/example.html" });

	assert.equal(result.ok, true);
	assert.equal(result.targetPath, "ProjectA/workspace/subdir/example.html");
	assert.deepEqual(result.candidates, ["ProjectA/workspace/subdir/example.html"]);
});

test("read resolves a unique bare filename inside the active project", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const result = resolver.resolve({ intent: "read_file", path: "unique.md" });

	assert.equal(result.ok, true);
	assert.equal(result.targetPath, "ProjectA/workspace/notes/unique.md");
	assert.deepEqual(result.candidates, ["ProjectA/workspace/notes/unique.md"]);
});

test("read resolves Chinese canonical workspace-relative and bare filename paths inside active project", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod, {
		activeProjectRoot: "123",
		vaultFiles: [
			"123/workspace/FRIDAY 设计理念.md",
			"OtherProject/workspace/FRIDAY 设计理念.md",
		],
		vaultFolders: [
			"123",
			"123/workspace",
			"OtherProject",
			"OtherProject/workspace",
		],
	});

	const canonical = resolver.resolve({ intent: "read_file", path: "123/workspace/FRIDAY 设计理念.md" });
	const workspaceRelative = resolver.resolve({ intent: "read_file", path: "workspace/FRIDAY 设计理念.md" });
	const bare = resolver.resolve({ intent: "read_file", path: "FRIDAY 设计理念.md" });

	for (const result of [canonical, workspaceRelative, bare]) {
		assert.equal(result.ok, true);
		assert.equal(result.targetPath, "123/workspace/FRIDAY 设计理念.md");
		assert.deepEqual(result.candidates, ["123/workspace/FRIDAY 设计理念.md"]);
	}
});

test("read rejects paths that resolve outside the active project with boundary candidates", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod, {
		activeProjectRoot: "456",
		vaultFiles: [
			"123/workspace/FRIDAY 设计理念.md",
			"456/workspace/other.md",
		],
		vaultFolders: [
			"123",
			"123/workspace",
			"456",
			"456/workspace",
		],
	});

	const canonical = resolver.resolve({ intent: "read_file", path: "123/workspace/FRIDAY 设计理念.md" });
	const workspaceRelative = resolver.resolve({ intent: "read_file", path: "workspace/FRIDAY 设计理念.md" });
	const bare = resolver.resolve({ intent: "read_file", path: "FRIDAY 设计理念.md" });

	for (const result of [canonical, workspaceRelative, bare]) {
		assert.equal(result.ok, false);
		assert.equal(result.code, "project_boundary_mismatch");
		assert.equal(result.projectRoot, "456");
		assert.deepEqual(result.candidates, ["123/workspace/FRIDAY 设计理念.md"]);
		assert.equal(result.suggestedArgs, undefined);
		assert.match(result.reason, /active project boundary/i);
	}
	assert.equal(canonical.targetPath, "123/workspace/FRIDAY 设计理念.md");
	assert.equal(workspaceRelative.targetPath, "456/workspace/FRIDAY 设计理念.md");
	assert.equal(bare.targetPath, "FRIDAY 设计理念.md");
});

test("read rejects ambiguous bare filenames with candidate paths", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const result = resolver.resolve({ intent: "read_file", path: "duplicate.md" });

	assert.equal(result.ok, false);
	assert.equal(result.code, "ambiguous_bare_filename");
	assert.deepEqual(result.candidates, [
		"ProjectA/workspace/one/duplicate.md",
		"ProjectA/workspace/two/duplicate.md",
	]);
	assert.deepEqual(result.suggestedArgs, { path: "ProjectA/workspace/one/duplicate.md" });
});

test("discovery empty and workspace paths resolve inside active project", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const emptyResult = resolver.resolve({ intent: "search", path: "" });
	const workspaceResult = resolver.resolve({ intent: "read_directory", path: "workspace/subdir" });

	assert.equal(emptyResult.ok, true);
	assert.equal(emptyResult.targetPath, "ProjectA");
	assert.equal(workspaceResult.ok, true);
	assert.equal(workspaceResult.targetPath, "ProjectA/workspace/subdir");
});

test("search resolves a unique bare filename inside the active project", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const result = resolver.resolve({ intent: "search", path: "unique.md" });

	assert.equal(result.ok, true);
	assert.equal(result.targetPath, "ProjectA/workspace/notes/unique.md");
	assert.deepEqual(result.candidates, ["ProjectA/workspace/notes/unique.md"]);
});

test("writes default to project workspace and deny raw with workspace suggestion", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);

	const writeResult = resolver.resolve({ intent: "write_file", path: "drafts/new.md" });
	const rawResult = resolver.resolve({ intent: "edit_file", path: "raw/source.md" });

	assert.equal(writeResult.ok, true);
	assert.equal(writeResult.targetPath, "ProjectA/workspace/drafts/new.md");
	assert.equal(rawResult.ok, false);
	assert.equal(rawResult.code, "project_raw_write_denied");
	assert.deepEqual(rawResult.candidates, ["ProjectA/workspace/source.md"]);
	assert.deepEqual(rawResult.suggestedArgs, { path: "ProjectA/workspace/source.md" });
});

test("write keeps active project workspace-relative target despite outside matching files", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod, {
		activeProjectRoot: "456",
		vaultFiles: [
			"123/workspace/FRIDAY 设计理念.md",
			"456/workspace/other.md",
		],
		vaultFolders: [
			"123",
			"123/workspace",
			"456",
			"456/workspace",
		],
	});

	const result = resolver.resolve({ intent: "write_file", path: "workspace/FRIDAY 设计理念.md" });

	assert.equal(result.ok, true);
	assert.equal(result.targetPath, "456/workspace/FRIDAY 设计理念.md");
	assert.notEqual(result.code, "project_boundary_mismatch");
});

test("whole-vault project writes still default generated paths to workspace", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod, {
		activeProjectRoot: "/",
		vaultFiles: ["workspace/existing.md"],
		vaultFolders: ["workspace"],
	});

	const result = resolver.resolve({ intent: "write_file", path: "drafts/new.md" });

	assert.equal(result.ok, true);
	assert.equal(result.targetPath, "workspace/drafts/new.md");
});

test("absolute paths are external and external writes are denied", async () => {
	const mod = await loadModule();
	const resolver = createResolver(mod);
	const absolutePath = process.platform === "win32" ? "C:\\outside\\file.md" : "/tmp/outside/file.md";

	const readResult = resolver.resolve({ intent: "read_file", path: absolutePath });
	const writeResult = resolver.resolve({ intent: "write_file", path: absolutePath });

	assert.equal(readResult.ok, true);
	assert.equal(readResult.scope, "external");
	assert.equal(writeResult.ok, false);
	assert.equal(writeResult.scope, "external");
	assert.equal(writeResult.code, "external_write_denied");
});
