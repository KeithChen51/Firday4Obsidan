/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/retrieval/WikiLookupService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("wiki lookup hits direct_read when index keyword resolves to page", async () => {
	const mod = await loadModule();
	const service = new mod.WikiLookupService();
	const result = service.lookup({
		query: "context compression",
		indexEntries: [
			{
				title: "Context Compression Strategy",
				summary: "Semantic Compactor preserves high-value information",
				wikiPath: "project/wiki/pages/context-compression-strategy.md",
				keywords: ["context", "compression", "semantic", "compactor"],
			},
		],
		documents: {
			"project/wiki/pages/context-compression-strategy.md": "# Context Compression Strategy\n\n## Compiled Truth\nSemantic Compactor keeps high-value facts.\n\n---\n\n## Timeline\n- item",
		},
		relationGraph: { nodes: [], edges: [] },
	});

	assert.equal(result.sourceMap.hitStep, "direct_read");
	assert.equal(result.sourceMap.sourceSection, "compiled_truth");
	assert.equal(result.summary.includes("Semantic Compactor"), true);
});

test("wiki lookup falls back to raw fragments when no index hit exists", async () => {
	const mod = await loadModule();
	const service = new mod.WikiLookupService();
	const result = service.lookup({
		query: "memory store",
		indexEntries: [],
		documents: {
			"project/raw/notes.md": "memory store keeps user preferences and constraints",
		},
		relationGraph: { nodes: [], edges: [] },
	});

	assert.equal(result.sourceMap.hitStep, "fallback");
	assert.equal(result.summary.includes("memory store"), true);
});
