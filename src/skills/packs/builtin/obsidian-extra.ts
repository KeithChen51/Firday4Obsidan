export const BUILTIN_OBSIDIAN_CLI_MARKDOWN = `---
name: obsidian-cli
description: Interact with a running Obsidian app through the Obsidian CLI for vault operations, plugin reload, debugging, screenshots, and DOM inspection.
command: obsidian-cli
aliases: [obsidian-cli, obsidian, vault-cli, plugin-dev, obsidian-dev]
tags: [obsidian, vault, cli, plugin, debug]
trigger: Use when the task is about operating a live Obsidian vault or debugging an Obsidian plugin/theme.
executionMode: agent_orchestrated
---

# Skill: obsidian-cli

Use the \`obsidian\` CLI to control a running Obsidian instance. This skill is for live vault interaction and plugin development, not for general shell usage.

## Preconditions

1. Obsidian must already be open.
2. Target the current vault by default, or pass \`vault="<name>"\` explicitly when needed.
3. Prefer \`path=\` for exact vault-relative paths and \`file=\` for wikilink-style note lookup.
4. Live command execution also requires the runtime to expose shell/exec capability.

## What this skill is for

- Read, create, append, and search notes in a live vault.
- Inspect backlinks, tags, properties, daily notes, and tasks.
- Reload plugins after code changes.
- Check runtime errors, console output, screenshots, DOM state, CSS values, and mobile emulation during plugin/theme debugging.

## Core command patterns

\`\`\`bash
obsidian help
obsidian read file="My Note"
obsidian create name="New Note" content="# Hello" silent
obsidian append file="My Note" content="New line"
obsidian search query="semantic compactor" limit=10
obsidian property:set file="My Note" name="status" value="done"
obsidian backlinks file="My Note"
obsidian daily:read
obsidian daily:append content="- [ ] Follow up"
\`\`\`

## Plugin and theme development loop

1. Reload the plugin after code changes:
   \`\`\`bash
   obsidian plugin:reload id=<plugin-id>
   \`\`\`
2. Check runtime errors:
   \`\`\`bash
   obsidian dev:errors
   \`\`\`
3. Inspect the rendered result:
   \`\`\`bash
   obsidian dev:screenshot path=artifacts/obsidian-ui.png
   obsidian dev:dom selector=".workspace-leaf" text
   obsidian dev:css selector=".workspace-leaf" prop=background-color
   \`\`\`
4. Review console output:
   \`\`\`bash
   obsidian dev:console level=error
   \`\`\`

## Syntax rules

- Parameters use \`key=value\`.
- Flags such as \`silent\`, \`overwrite\`, and \`--copy\` do not take values.
- Escape multiline content with \`\\n\`.

## Guardrails

- Prefer the most specific command over broad shell access.
- When a task needs live Obsidian state, use this skill instead of guessing from files alone.
- After any plugin reload, verify with \`dev:errors\` and one visual or DOM check before concluding success.
- If exec/shell is not available in the current runtime, use this skill to plan commands and explain that live CLI execution is currently unavailable.
`;

export const BUILTIN_OBSIDIAN_MARKDOWN_MARKDOWN = `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, frontmatter properties, tags, comments, and note-safe internal linking.
command: obsidian-markdown
aliases: [obsidian-markdown, markdown, wikilink, callout, frontmatter]
tags: [obsidian, markdown, notes, wikilink, frontmatter]
trigger: Use when editing .md files for Obsidian notes or when the task mentions wikilinks, embeds, callouts, tags, or note properties.
executionMode: agent_orchestrated
---

# Skill: obsidian-markdown

Generate valid Obsidian Flavored Markdown. Standard Markdown still applies, but this skill focuses on Obsidian-specific syntax and note hygiene.

## Prefer these constructs

### Frontmatter
\`\`\`yaml
---
title: Project Alpha
tags:
  - project
  - active
aliases:
  - Alpha
---
\`\`\`

### Wikilinks
\`\`\`markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
![[Embedded Note]]
\`\`\`

### Callouts
\`\`\`markdown
> [!note]
> Important context.

> [!warning]- Collapsed
> Hidden by default.
\`\`\`

### Tags and comments
\`\`\`markdown
#project/active

Visible text %%hidden comment%%
\`\`\`

## Working rules

1. Use \`[[wikilinks]]\` for internal vault notes.
2. Use normal Markdown links only for external URLs.
3. Keep note metadata in frontmatter when it is structured and queryable.
4. Validate embeds, headings, and block refs so links survive note renames.
5. When creating a note, ensure the result renders correctly in reading view.

## Typical workflow

1. Add frontmatter if the note needs metadata.
2. Write the body in normal Markdown.
3. Replace internal references with wikilinks.
4. Add callouts or embeds where Obsidian rendering matters.
5. Verify the final syntax is valid for Obsidian, not just generic Markdown.
`;

export const BUILTIN_JSON_CANVAS_MARKDOWN = `---
name: json-canvas
description: Create and edit Obsidian JSON Canvas files with nodes, edges, groups, IDs, layout, and graph integrity checks.
command: json-canvas
aliases: [json-canvas, canvas, obsidian-canvas]
tags: [obsidian, canvas, graph, layout]
trigger: Use when the task is about .canvas files, visual boards, flowcharts, mind maps, or canvas node/edge editing.
executionMode: agent_orchestrated
---

# Skill: json-canvas

Operate on Obsidian \`.canvas\` files, which are JSON documents with top-level \`nodes\` and \`edges\` arrays.

## Base structure

\`\`\`json
{
  "nodes": [],
  "edges": []
}
\`\`\`

## Core rules

1. Every node and edge ID must be unique.
2. Node IDs should be 16-character lowercase hex strings.
3. Every \`fromNode\` and \`toNode\` in edges must reference an existing node ID.
4. Keep layout readable: avoid overlap and use consistent spacing.

## Common operations

### Create a canvas
- Initialize empty \`nodes\` and \`edges\`.
- Add nodes with \`id\`, \`type\`, \`x\`, \`y\`, \`width\`, and \`height\`.
- Add edges that connect valid node IDs.

### Edit a canvas
- Parse JSON first.
- Locate target nodes/edges by \`id\`.
- Modify attributes like text, file, URL, position, color, label, or grouping.
- Re-validate references after every change.

## Important node types

- \`text\`: markdown-capable text block
- \`file\`: vault file reference
- \`link\`: external URL
- \`group\`: visual grouping container

## Validation checklist

- JSON parses successfully.
- No duplicate IDs.
- All edge references resolve.
- Required fields exist for each node type.
- Side values use only \`top/right/bottom/left\`.
`;

export const BUILTIN_OBSIDIAN_BASES_MARKDOWN = `---
name: obsidian-bases
description: Create and edit Obsidian .base files with YAML schema, filters, formulas, summaries, and table/cards/list/map views.
command: obsidian-bases
aliases: [obsidian-bases, bases, obsidian-base, database-view]
tags: [obsidian, bases, yaml, database, views]
trigger: Use when the task is about .base files, note databases, filtered views, formulas, or Bases configuration.
executionMode: agent_orchestrated
---

# Skill: obsidian-bases

Work on Obsidian \`.base\` files, which are YAML configurations for database-like note views.

## Main sections

\`\`\`yaml
filters:
  and: []

formulas:
  total: "price * quantity"

properties:
  status:
    displayName: "Status"

summaries:
  average_score: "values.mean()"

views:
  - type: table
    name: "Active"
    order:
      - file.name
      - status
\`\`\`

## What this skill is for

- Define global or per-view filters.
- Add computed formulas.
- Configure visible properties and display names.
- Build \`table\`, \`cards\`, \`list\`, or \`map\` views.
- Fix quoting and schema mistakes that break Bases rendering.

## Working rules

1. Output valid YAML only.
2. Quote strings that contain YAML-sensitive characters.
3. If a view references \`formula.X\`, define \`X\` in \`formulas\`.
4. Guard optional fields with \`if()\` in formulas.
5. After editing, validate both YAML syntax and formula/property references.

## Common pitfalls

- Unquoted strings with \`:\` or other YAML-special characters.
- Mismatched quotes inside formulas.
- Treating date subtraction like a plain number instead of a duration.
- Referencing missing properties or formulas.
`;
