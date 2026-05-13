/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const canvasModulePath = path.join(projectRoot, "src/core/obsidian-structure/canvas.ts");

async function loadCanvasModule() {
	return jiti.import(canvasModulePath);
}

test("canvas structure tools summarize nodes edges references and validation issues", async () => {
	const { summarizeCanvasDocument } = await loadCanvasModule();
	const summary = summarizeCanvasDocument(JSON.stringify({
		nodes: [
			{ id: "note-a", type: "file", x: 0, y: 0, width: 300, height: 200, file: "Notes/A.md" },
			{ id: "note-a", type: "text", x: 400, y: 0, width: 300, height: 120, text: "Duplicate id" },
			{ id: "group", type: "group", x: -40, y: -40, width: 760, height: 300, label: "Group" },
		],
		edges: [
			{ id: "edge-1", fromNode: "note-a", toNode: "missing-node" },
		],
	}), "Maps/Project.canvas", (vaultPath) => vaultPath === "Notes/A.md");

	assert.equal(summary.path, "Maps/Project.canvas");
	assert.equal(summary.nodeCount, 3);
	assert.equal(summary.edgeCount, 1);
	assert.deepEqual(summary.nodeTypes, { file: 1, group: 1, text: 1 });
	assert.deepEqual(summary.fileReferences, [{ file: "Notes/A.md", exists: true }]);
	assert.ok(summary.issues.some((issue) => issue.code === "duplicate_id"));
	assert.ok(summary.issues.some((issue) => issue.code === "missing_edge_target"));
});

test("canvas_apply preserves existing graph data while merging structured nodes and edges", async () => {
	const { applyCanvasDocument, validateCanvasDocument } = await loadCanvasModule();
	const existing = JSON.stringify({
		nodes: [
			{ id: "keep", type: "text", x: 0, y: 0, width: 250, height: 120, text: "Keep me", custom: "preserve" },
			{ id: "update", type: "file", x: 300, y: 0, width: 300, height: 200, file: "Old.md", color: "4" },
		],
		edges: [
			{ id: "old-edge", fromNode: "keep", toNode: "update", label: "old" },
		],
	}, null, 2);

	const result = applyCanvasDocument(existing, {
		mode: "update",
		nodes: [
			{ id: "update", type: "file", file: "New.md" },
			{ type: "text", text: "New node" },
		],
		edges: [
			{ fromNode: "keep", toNode: "update", label: "kept relationship" },
		],
	});
	const parsed = JSON.parse(result.content);

	assert.equal(parsed.nodes.length, 3);
	assert.equal(parsed.nodes.find((node) => node.id === "keep")?.custom, "preserve");
	assert.equal(parsed.nodes.find((node) => node.id === "update")?.file, "New.md");
	assert.equal(parsed.nodes.find((node) => node.id === "update")?.color, "4");
	assert.ok(parsed.nodes.some((node) => node.type === "text" && node.text === "New node" && node.id));
	assert.equal(parsed.edges.length, 2);
	assert.equal(validateCanvasDocument(result.content).ok, true);
});
