/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const diffPreviewPath = path.join(projectRoot, "src/views/mutationDiffPreview.ts");

async function loadModule() {
	return jiti.import(diffPreviewPath);
}

test("buildMutationDiffPreview returns reviewable changed lines without unchanged file bodies", async () => {
	const { buildMutationDiffPreview } = await loadModule();
	const preview = buildMutationDiffPreview({
		before: "alpha\nbeta\ngamma",
		after: "alpha\nBETTER\ngamma\nnew line",
		maxLines: 4,
		maxLineChars: 40,
	});

	assert.deepEqual(preview.lines, [
		{ kind: "remove", text: "beta" },
		{ kind: "add", text: "BETTER" },
		{ kind: "add", text: "new line" },
	]);
	assert.equal(preview.truncated, false);
});

test("buildMutationDiffPreview bounds long previews for vault-content privacy", async () => {
	const { buildMutationDiffPreview } = await loadModule();
	const preview = buildMutationDiffPreview({
		before: "one\ntwo\nthree\nfour",
		after: "ONE\nTWO\nTHREE\nFOUR",
		maxLines: 3,
		maxLineChars: 3,
	});

	assert.deepEqual(preview.lines, [
		{ kind: "remove", text: "one" },
		{ kind: "add", text: "ONE" },
		{ kind: "remove", text: "two" },
	]);
	assert.equal(preview.truncated, true);
	assert.equal(preview.omittedLineCount, 5);
});
