/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const validationModulePath = path.join(projectRoot, "src/core/obsidian-structure/validation.ts");

async function loadValidationModule() {
	return jiti.import(validationModulePath);
}

test("validateOutputDocument dispatches canvas and markdown checks by extension", async () => {
	const { validateOutputDocument } = await loadValidationModule();
	const canvas = validateOutputDocument("Maps/A.canvas", JSON.stringify({
		nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 100, text: "A" }],
		edges: [{ id: "edge", fromNode: "a", toNode: "missing" }],
	}), () => false);
	const markdown = validateOutputDocument("Notes/A.md", "See [[Missing Note]].", () => false);

	assert.equal(canvas.ok, false);
	assert.ok(canvas.items.some((item) => item.code === "missing_edge_target"));
	assert.equal(markdown.ok, false);
	assert.ok(markdown.items.some((item) => item.code === "missing_wikilink"));
});

test("validateOutputs batches paths and reports missing files without shell execution", async () => {
	const { validateOutputs } = await loadValidationModule();
	const docs = new Map([
		["Notes/A.md", "See [[Notes/B]]."],
		["Notes/B.md", "# B"],
		["Maps/A.canvas", JSON.stringify({ nodes: [], edges: [] })],
	]);
	const result = validateOutputs(["Notes/A.md", "Maps/A.canvas", "Missing.md"], {
		read: (targetPath) => docs.get(targetPath) ?? null,
		exists: (targetPath) => docs.has(targetPath),
	});

	assert.equal(result.ok, false);
	assert.equal(result.results.length, 3);
	assert.ok(result.results.find((item) => item.path === "Missing.md")?.items.some((issue) => issue.code === "file_missing"));
	assert.equal(result.results.find((item) => item.path === "Maps/A.canvas")?.ok, true);
});
