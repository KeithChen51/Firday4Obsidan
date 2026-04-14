/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/extensions/ConflictProposalBuilder.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("conflict proposal builder returns markdown and recommended strategy", async () => {
	const mod = await loadModule();
	const proposal = mod.buildConflictProposal({
		filePath: "src/app.ts",
		localSnippet: "const mode = 'safe';",
		remoteSnippet: "const mode = 'safe';",
	});

	assert.equal(proposal.recommendedStrategy, "ours");
	assert.equal(proposal.markdown.includes("# Fix Proposal"), true);
});
