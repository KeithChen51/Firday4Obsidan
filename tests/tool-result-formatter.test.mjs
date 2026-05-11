/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const formatterPath = path.join(projectRoot, "src/core/tools/ToolResultFormatter.ts");

function parseToolResult(text) {
	assert.ok(text.startsWith("TOOL_RESULT "), "model result keeps TOOL_RESULT prefix");
	return JSON.parse(text.slice("TOOL_RESULT ".length));
}

test("formatForModel preserves the legacy TOOL_RESULT payload shape", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const result = parseToolResult(formatForModel({
		ok: true,
		tool: "read",
		data: { path: "Project/a.md", content: "alpha" },
	}));

	assert.deepEqual(result, {
		ok: true,
		tool: "read",
		data: { path: "Project/a.md", content: "alpha" },
	});
});

test("formatForModel preserves failed recovery and trace metadata for model-facing output", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const result = parseToolResult(formatForModel({
		ok: false,
		tool: "read",
		status: "failed",
		failureClass: "transport_unstable",
		error: "Gateway timeout while reading Project/a.md",
		recovery: {
			recoverable: true,
			retryable: true,
			code: "transport_unstable",
			message: "Retry the read request",
			suggestedArgs: { path: "Project/a.md" },
			candidatePaths: ["Project/a.md", "Project/archive/a.md"],
		},
		trace: {
			inputPath: "Project/a.md",
			targetPath: "Project/a.md",
			resolvedPath: "Project/a.md",
			displayPath: "Project/a.md",
			projectRoot: "C:/Vault/Project",
		},
	}));

	assert.equal(result.ok, false);
	assert.equal(result.tool, "read");
	assert.equal(result.status, "failed");
	assert.equal(result.failureClass, "transport_unstable");
	assert.deepEqual(result.recovery, {
		recoverable: true,
		retryable: true,
		code: "transport_unstable",
		message: "Retry the read request",
		suggestedArgs: { path: "Project/a.md" },
		candidatePaths: ["Project/a.md", "Project/archive/a.md"],
	});
	assert.deepEqual(result.trace, {
		inputPath: "Project/a.md",
		targetPath: "Project/a.md",
		resolvedPath: "Project/a.md",
		displayPath: "Project/a.md",
		projectRoot: "C:/Vault/Project",
	});
});

test("formatForModel preserves denied recovery and trace metadata for model-facing output", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const result = parseToolResult(formatForModel({
		ok: false,
		tool: "write",
		status: "denied",
		failureClass: "invalid_input",
		error: "Path is outside the project",
		recovery: {
			recoverable: true,
			retryable: false,
			code: "workspace_boundary",
			message: "Use a project-relative path",
			suggestedArgs: { path: "Project/a.md" },
			candidatePaths: ["Project/a.md"],
		},
		trace: {
			inputPath: "../a.md",
			targetPath: "C:/Vault/Project/a.md",
			resolvedPath: "Project/a.md",
			displayPath: "Project/a.md",
			projectRoot: "C:/Vault/Project",
		},
	}));

	assert.equal(result.ok, false);
	assert.equal(result.tool, "write");
	assert.equal(result.status, "denied");
	assert.equal(result.failureClass, "invalid_input");
	assert.deepEqual(result.recovery, {
		recoverable: true,
		retryable: false,
		code: "workspace_boundary",
		message: "Use a project-relative path",
		suggestedArgs: { path: "Project/a.md" },
		candidatePaths: ["Project/a.md"],
	});
	assert.deepEqual(result.trace, {
		inputPath: "../a.md",
		targetPath: "C:/Vault/Project/a.md",
		resolvedPath: "Project/a.md",
		displayPath: "Project/a.md",
		projectRoot: "C:/Vault/Project",
	});
});

test("formatForModel compacts use_skill results for model-facing output only", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const result = parseToolResult(formatForModel({
		ok: true,
		tool: "use_skill",
		data: {
			command: "test-driven-development",
			summary: "Loaded skill test-driven-development",
			systemContext: "large private system context",
		},
	}));

	assert.deepEqual(result, {
		ok: true,
		tool: "use_skill",
		data: {
			command: "test-driven-development",
			summary: "Loaded skill test-driven-development",
		},
	});
});

test("formatForModel keeps memory results on their compact projection", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const result = parseToolResult(formatForModel({
		ok: true,
		tool: "memory",
		data: {
			ok: true,
			scope: "project",
			summary: "Memory updated",
			code: "updated",
			reason: "stored",
			raw: "do not expose",
		},
	}));

	assert.deepEqual(result, {
		ok: true,
		tool: "memory",
		data: {
			scope: "project",
			summary: "Memory updated",
			code: "updated",
			reason: "stored",
		},
	});
});

test("formatForModel caps oversized model-facing results", async () => {
	const { formatForModel } = await jiti.import(formatterPath);

	const output = formatForModel({
		ok: true,
		tool: "read",
		data: { content: "x".repeat(200) },
	}, { maxChars: 80 });

	assert.ok(output.length <= "TOOL_RESULT ".length + 83);
	assert.ok(output.endsWith("..."));
});

test("summarizeForTrace matches current runtime summaries for existing tools", async () => {
	const { summarizeForTrace } = await jiti.import(formatterPath);

	assert.equal(summarizeForTrace("read", { path: "Project/a.md", truncated: true }), "Read Project/a.md (truncated)");
	assert.equal(summarizeForTrace("ls", { items: ["a", "b"] }), "Listed 2 item(s)");
	assert.equal(summarizeForTrace("grep", { matches: [{}, {}, {}] }), "grep matched 3 result(s)");
	assert.equal(summarizeForTrace("search_text", { matches: [{}] }), "search_text matched 1 result(s)");
	assert.equal(summarizeForTrace("glob", { files: ["a.md"] }), "glob matched 1 file(s)");
	assert.equal(summarizeForTrace("memory", { summary: "Remembered" }), "Remembered");
	assert.equal(summarizeForTrace("write", { path: "Project/a.md", status: "pending_review" }), "已准备文件修改，确认后才会写入 Obsidian：Project/a.md");
	assert.equal(summarizeForTrace("delete", { path: "Project", deletedType: "folder" }), "Delete completed folder Project");
	assert.equal(summarizeForTrace("edit", { path: "Project/a.md", appliedEdits: 2 }), "Edited Project/a.md (2 replacement(s))");
	assert.equal(summarizeForTrace("exec", { exitCode: 0 }), "Exec completed (exit code 0)");
	assert.equal(summarizeForTrace("unknown_tool", {}), "unknown_tool completed");
});

test("summarizeForTrace uses prepared language for pending file mutations", async () => {
	const { formatFileMutationEventSummary, summarizeForTrace } = await jiti.import(formatterPath);

	const summaries = [
		summarizeForTrace("write", { path: "Project/new.md", type: "create", status: "pending_review" }),
		summarizeForTrace("write", { path: "Project/existing.md", type: "update", status: "pending_review" }),
		summarizeForTrace("edit", { path: "Project/edit.md", appliedEdits: 2, status: "pending_review" }),
		summarizeForTrace("delete", { path: "Project/delete.md", deletedType: "file", status: "pending_review" }),
	];

	assert.deepEqual(summaries, [
		"已准备文件创建，确认后才会写入 Obsidian：Project/new.md",
		"已准备文件更新，确认后才会写入 Obsidian：Project/existing.md",
		"已准备文件更新，确认后才会写入 Obsidian：Project/edit.md",
		"已准备文件删除，确认后才会写入 Obsidian：Project/delete.md",
	]);
	for (const summary of summaries) {
		assert.doesNotMatch(summary, /\b(completed|applied|created|modified|deleted)\b/i);
		assert.doesNotMatch(summary, /已创建|已修改|已删除/);
		assert.match(summary, /确认后才会写入 Obsidian/);
	}
	assert.equal(
		formatFileMutationEventSummary({ operation: "write", targetPath: "Project/new.md", changeType: "create", status: "applied" }),
		"已应用文件创建：Project/new.md",
	);
});
