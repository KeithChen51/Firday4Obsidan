/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const markdownModulePath = path.join(projectRoot, "src/core/obsidian-structure/markdown.ts");

async function loadMarkdownModule() {
	return jiti.import(markdownModulePath);
}

test("markdown_outline extracts frontmatter headings wikilinks embeds and markdown links", async () => {
	const { outlineMarkdown } = await loadMarkdownModule();
	const outline = outlineMarkdown(`---
title: Project Alpha
tags:
  - project
---

# Project Alpha

See [[Related Note|related]] and ![[Diagram.canvas]].

## Decisions

[External](https://example.com) and [Local](Notes/B.md#Context).
`);

	assert.deepEqual(outline.frontmatter, { title: "Project Alpha", tags: ["project"] });
	assert.deepEqual(outline.headings.map((heading) => [heading.depth, heading.text]), [
		[1, "Project Alpha"],
		[2, "Decisions"],
	]);
	assert.deepEqual(outline.wikilinks.map((link) => link.target), ["Related Note", "Diagram.canvas"]);
	assert.deepEqual(outline.embeds.map((embed) => embed.target), ["Diagram.canvas"]);
	assert.deepEqual(outline.markdownLinks.map((link) => link.target), ["https://example.com", "Notes/B.md#Context"]);
});

test("frontmatter_update safely changes YAML without rewriting the note body", async () => {
	const { updateFrontmatter } = await loadMarkdownModule();
	const updated = updateFrontmatter(`---
title: Old
status: draft
tags:
  - old
---

# Body

Keep this body.
`, {
		set: {
			title: "New",
			tags: ["new", "project"],
		},
		remove: ["status"],
	});

	assert.match(updated, /^---\n/);
	assert.match(updated, /title: New/);
	assert.match(updated, /tags:\n {2}- new\n {2}- project/);
	assert.doesNotMatch(updated, /status:/);
	assert.match(updated, /# Body\n\nKeep this body\./);
});

test("markdown_insert_reference inserts under a heading and avoids duplicates by default", async () => {
	const { insertMarkdownReference } = await loadMarkdownModule();
	const initial = "# Note\n\n## Links\n\n- [[Existing]]\n";
	const inserted = insertMarkdownReference(initial, {
		reference: "- [[New Reference]]",
		placement: "after_heading",
		heading: "Links",
	});
	const deduped = insertMarkdownReference(inserted, {
		reference: "- [[New Reference]]",
		placement: "after_heading",
		heading: "Links",
	});

	assert.match(inserted, /## Links\n\n- \[\[New Reference\]\]\n- \[\[Existing\]\]/);
	assert.equal((deduped.match(/\[\[New Reference\]\]/g) ?? []).length, 1);
});

test("validate_markdown reports unresolved wikilinks embeds and local markdown links", async () => {
	const { validateMarkdownDocument } = await loadMarkdownModule();
	const result = validateMarkdownDocument("Notes/A.md", [
		"See [[Known Note]], [[Missing Note]], ![[Missing Image.png]], and [Broken](Missing.md).",
	].join("\n"), (target) => target === "Known Note.md");

	assert.equal(result.ok, false);
	assert.ok(result.items.some((item) => item.code === "missing_wikilink" && item.target === "Missing Note"));
	assert.ok(result.items.some((item) => item.code === "missing_embed" && item.target === "Missing Image.png"));
	assert.ok(result.items.some((item) => item.code === "missing_markdown_link" && item.target === "Missing.md"));
});
