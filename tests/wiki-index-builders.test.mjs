/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const relationModulePath = path.join(projectRoot, "src/core/retrieval/RelationGraphBuilder.ts");
const capabilityModulePath = path.join(projectRoot, "src/core/retrieval/CapabilityIndexBuilder.ts");

async function loadModules() {
	const relation = await jiti.import(relationModulePath);
	const capability = await jiti.import(capabilityModulePath);
	return { relation, capability };
}

test("relation graph builder captures wikilinks", async () => {
	const { relation } = await loadModules();
	const graph = relation.buildRelationGraph([
		{
			title: "Page A",
			wikiPath: "project/wiki/pages/a.md",
			keywords: ["alpha"],
			content: "# A\n\n## Compiled Truth\nSee [[Page B]]",
		},
		{
			title: "Page B",
			wikiPath: "project/wiki/pages/b.md",
			keywords: ["beta"],
			content: "# B",
		},
	]);

	assert.equal(graph.edges.length, 1);
	assert.equal(graph.edges[0].label, "wikilink");
});

test("capability index builder sorts entries stably by score", async () => {
	const { capability } = await loadModules();
	const index = capability.buildCapabilityIndex([
		{
			id: "a",
			title: "A",
			summary: "high impact repeated dependency",
			keywords: ["impact", "impact", "dependency"],
			links: 3,
		},
		{
			id: "b",
			title: "B",
			summary: "small note",
			keywords: ["note"],
			links: 0,
		},
	]);

	assert.equal(index[0].id, "a");
	assert.equal(index[0].score >= index[1].score, true);
});
