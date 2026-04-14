/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/retrieval/WikiKnowledgeProvider.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("wiki knowledge provider builds context from wiki index and docs", async () => {
	const mod = await loadModule();
	const provider = new mod.WikiKnowledgeProvider();
	const context = provider.buildContext("context compression", {
		indexEntries: [
			{
				title: "Context Compression Strategy",
				summary: "Semantic Compactor preserves signal",
				wikiPath: "project/wiki/pages/context-compression-strategy.md",
				keywords: ["context", "compression", "semantic", "compactor"],
			},
		],
		documents: {
			"project/wiki/pages/context-compression-strategy.md": "# Context Compression Strategy\n\n## Compiled Truth\nSemantic Compactor preserves signal.\n\n## Timeline\n- item",
		},
		relationGraph: { nodes: [], edges: [] },
	});

	assert.equal(context.includes("hitStep=direct_read"), true);
	assert.equal(context.includes("Semantic Compactor"), true);
});
