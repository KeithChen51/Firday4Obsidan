/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

test("read accepts workspace path relative to active project", async () => {
	const result = await runAgentRuntimeScenario({
		name: "read active project workspace path",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/subdir/example.html": "<main>alpha</main>",
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "workspace/subdir/example.html" } } },
			{ assistant: "Read the active project file." },
		],
	});

	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/subdir/example.html");
	assert.match(result.modelRequests.at(-1).sanitizedText, /ProjectA\/workspace\/subdir\/example\.html/);
	assert.match(result.modelRequests.at(-1).sanitizedText, /alpha/);
});

test("read accepts the same canonical active project path", async () => {
	const result = await runAgentRuntimeScenario({
		name: "read canonical active project path",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/subdir/example.html": "<main>alpha</main>",
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "ProjectA/workspace/subdir/example.html" } } },
			{ assistant: "Read the canonical project file." },
		],
	});

	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/subdir/example.html");
	assert.match(result.modelRequests.at(-1).sanitizedText, /ProjectA\/workspace\/subdir\/example\.html/);
});

test("read resolves a unique bare filename within active project", async () => {
	const result = await runAgentRuntimeScenario({
		name: "read unique bare filename",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/notes/example.html": "<main>unique</main>",
			"OtherProject/workspace/example.html": "<main>other</main>",
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "example.html" } } },
			{ assistant: "Read the unique active project file." },
		],
	});

	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/notes/example.html");
	assert.match(result.modelRequests.at(-1).sanitizedText, /unique/);
	assert.doesNotMatch(result.modelRequests.at(-1).sanitizedText, /other/);
});

test("ambiguous bare filename fails with structured candidate paths", async () => {
	const result = await runAgentRuntimeScenario({
		name: "ambiguous bare filename",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/one/example.html": "one",
			"ProjectA/workspace/two/example.html": "two",
		},
		modelSteps: [
			{ tool: { name: "read", args: { path: "example.html" } } },
			{ assistant: "The filename is ambiguous." },
		],
	});

	assert.equal(result.traces[0].status, "failed");
	assert.match(result.traces[0].error, /not unique|ambiguous/i);
	const toolResultText = result.modelRequests.at(-1).sanitizedText;
	assert.match(toolResultText, /"code":"ambiguous_bare_filename"/);
	assert.match(toolResultText, /"candidatePaths":\["ProjectA\/workspace\/one\/example\.html","ProjectA\/workspace\/two\/example\.html"\]/);
	assert.match(toolResultText, /"suggestedArgs":\{"path":"ProjectA\/workspace\/one\/example\.html"\}/);
});

test("discovery tools scope empty and workspace paths to active project", async () => {
	const emptyResult = await runAgentRuntimeScenario({
		name: "list active project by empty path",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/subdir/example.html": "alpha",
			"OtherProject/workspace/other.html": "other",
		},
		modelSteps: [
			{ tool: { name: "ls", args: { path: "", recursive: true } } },
			{ assistant: "Listed active project." },
		],
	});
	const workspaceResult = await runAgentRuntimeScenario({
		name: "glob active project workspace path",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/subdir/example.html": "alpha",
			"OtherProject/workspace/example.html": "other",
		},
		modelSteps: [
			{ tool: { name: "glob", args: { path: "workspace", pattern: "*.html" } } },
			{ assistant: "Globbed active project workspace." },
		],
	});

	assert.equal(emptyResult.traces[0].status, "ok");
	assert.equal(emptyResult.traces[0].targetPath, "ProjectA");
	assert.match(emptyResult.modelRequests.at(-1).sanitizedText, /ProjectA\/workspace\/subdir\/example\.html/);
	assert.doesNotMatch(emptyResult.modelRequests.at(-1).sanitizedText, /OtherProject\/workspace\/other\.html/);
	assert.equal(workspaceResult.traces[0].status, "ok");
	assert.equal(workspaceResult.traces[0].targetPath, "ProjectA/workspace");
	assert.match(workspaceResult.modelRequests.at(-1).sanitizedText, /ProjectA\/workspace\/subdir\/example\.html/);
	assert.doesNotMatch(workspaceResult.modelRequests.at(-1).sanitizedText, /OtherProject\/workspace\/example\.html/);
});

test("write without project segment defaults to active project workspace", async () => {
	const result = await runAgentRuntimeScenario({
		name: "write defaults to active project workspace",
		projectRoot: "ProjectA",
		files: {},
		modelSteps: [
			{ tool: { name: "write", args: { path: "drafts/new.md", content: "new note", mode: "create" } } },
			{ assistant: "Prepared write." },
		],
	});

	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/drafts/new.md");
	assert.equal(result.pendingMutations[0].targetPath, "ProjectA/workspace/drafts/new.md");
});

test("raw write under active project is denied with workspace recovery metadata", async () => {
	const result = await runAgentRuntimeScenario({
		name: "raw write denied",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/raw/source.md": "curated",
		},
		modelSteps: [
			{ tool: { name: "write", args: { path: "raw/source.md", content: "changed", mode: "update" } } },
			{ assistant: "Raw writes are blocked." },
		],
	});

	assert.equal(result.traces[0].status, "failed");
	assert.match(result.traces[0].error, /raw/i);
	const toolResultText = result.modelRequests.at(-1).sanitizedText;
	assert.match(toolResultText, /"code":"project_raw_write_denied"/);
	assert.match(toolResultText, /"candidatePaths":\["ProjectA\/workspace\/source\.md"\]/);
	assert.match(toolResultText, /"suggestedArgs":\{"path":"ProjectA\/workspace\/source\.md"\}/);
	assert.deepEqual(result.files, { "ProjectA/raw/source.md": "curated" });
});

test("missing workspace-relative read preserves original input and suggests canonical candidate", async () => {
	const result = await runAgentRuntimeScenario({
		name: "missing workspace-relative read recovery",
		projectRoot: "ProjectA",
		files: {},
		modelSteps: [
			{ tool: { name: "read", args: { path: "workspace/missing.md" } } },
			{ assistant: "The file is missing." },
		],
	});

	assert.equal(result.traces[0].status, "failed");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/missing.md");
	const toolResultText = result.modelRequests.at(-1).sanitizedText;
	assert.match(toolResultText, /"inputPath":"workspace\/missing\.md"/);
	assert.match(toolResultText, /"targetPath":"ProjectA\/workspace\/missing\.md"/);
	assert.match(toolResultText, /"code":"vault_file_not_found"/);
	assert.match(toolResultText, /"recoverable":true/);
	assert.match(toolResultText, /"retryable":false/);
	assert.match(toolResultText, /"candidatePaths":\["ProjectA\/workspace\/missing\.md"\]/);
	assert.match(toolResultText, /"suggestedArgs":\{"path":"ProjectA\/workspace\/missing\.md"\}/);
});

test("grep resolves a unique bare filename within active project", async () => {
	const result = await runAgentRuntimeScenario({
		name: "grep unique bare filename",
		projectRoot: "ProjectA",
		files: {
			"ProjectA/workspace/notes/example.html": "<main>needle</main>",
			"OtherProject/workspace/example.html": "<main>other needle</main>",
		},
		modelSteps: [
			{ tool: { name: "grep", args: { path: "example.html", pattern: "needle", flags: "i" } } },
			{ assistant: "Found the match." },
		],
	});

	assert.equal(result.traces[0].status, "ok");
	assert.equal(result.traces[0].targetPath, "ProjectA/workspace/notes/example.html");
	const toolResultText = result.modelRequests.at(-1).sanitizedText;
	assert.match(toolResultText, /ProjectA\/workspace\/notes\/example\.html/);
	assert.match(toolResultText, /needle/);
	assert.doesNotMatch(toolResultText, /OtherProject\/workspace\/example\.html/);
});
