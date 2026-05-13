---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, Markdown-style internal links, embeds, callouts, properties, tags, comments, and safe note-link editing.
command: obsidian-markdown
aliases: [obsidian-markdown, obsidian-note, wikilink, callout, note-properties]
tags: [obsidian, notes, wikilink, callout, embeds, properties]
trigger: Use when editing .md files that are meant for Obsidian notes, or when the task explicitly mentions wikilinks, embeds, callouts, note properties, or Obsidian-specific Markdown behavior.
executionMode: agent_orchestrated
---

# Skill: obsidian-markdown

Generate valid Obsidian Flavored Markdown. Standard Markdown still applies, but this skill focuses on Obsidian-specific syntax and safe editing behavior for existing notes.

## FRIDAY tool usage

- Use `markdown_outline` before structural edits so you can inspect headings, frontmatter, wikilinks, embeds, and Markdown links.
- Use `frontmatter_update` for note properties instead of rewriting the whole note.
- Use `markdown_insert_reference` for wikilinks, embeds, and local Markdown links.
- Use `validate_markdown` after changing one note, or `validate_outputs` when checking several generated files.
- Use write/edit only as a low-level fallback when the structured Markdown tools cannot express the requested change.

## Prefer these constructs

### Frontmatter
```yaml
---
title: Project Alpha
tags:
  - project
  - active
aliases:
  - Alpha
---
```

### Wikilinks
```markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
![[Embedded Note]]
```

### Markdown-style internal links
```markdown
[Note Name](Note%20Name.md)
[Section](Note%20Name.md#Heading)
```

### Callouts
```markdown
> [!note]
> Important context.

> [!warning]- Collapsed
> Hidden by default.
```

### Tags and comments
```markdown
#project/active

Visible text %%hidden comment%%
```

## Working rules

1. Prefer the existing internal link style when editing an established note.
2. For new Obsidian-native notes, prefer `[[wikilinks]]` by default, but remember Markdown-style internal links are also valid.
3. Use normal Markdown links for external URLs, and only use them for internal notes when interoperability or existing style matters.
4. Keep note metadata in frontmatter when it is structured and queryable.
5. Validate embeds, headings, and block refs so links survive note renames.
6. Do not invent headings, block refs, note names, or embeds that do not exist.
7. Do not mass-convert internal Markdown links to wikilinks unless the user explicitly asks.

## Editing guardrails

1. Add frontmatter only when the note needs structured metadata.
2. Preserve existing note structure and link style unless there is a clear reason to change it.
3. Add callouts or embeds only when they improve the note, not just because the syntax exists.
4. Verify the final syntax is valid for Obsidian, not just generic Markdown.
