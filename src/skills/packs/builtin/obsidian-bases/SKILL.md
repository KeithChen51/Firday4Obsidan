---
name: obsidian-bases
description: Create and edit Obsidian Bases configurations in `.base` files or embedded `base` code blocks with filters, formulas, properties, summaries, and views.
command: obsidian-bases
aliases: [obsidian-bases, bases, obsidian-base, database-view]
tags: [obsidian, bases, yaml, database, views]
trigger: Use when the task is about .base files, note databases, filtered views, formulas, or Bases configuration.
executionMode: agent_orchestrated
---

# Skill: obsidian-bases

Work on Obsidian Bases configurations, usually stored in `.base` files or embedded in `base` code blocks. Bases are YAML configurations for database-like note views.

## Main sections

```yaml
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
```

## What this skill is for

- Define global or per-view filters.
- Add computed formulas.
- Configure visible properties and display names.
- Build `table`, `cards`, `list`, or `map` views.
- Fix quoting and schema mistakes that break Bases rendering.

## Editing workflow

1. Determine whether you are editing a standalone `.base` file or a fenced ` ```base ` block.
2. Parse the YAML first.
3. Identify the top-level sections in use: `filters`, `formulas`, `properties`, `summaries`, and `views`.
4. Validate every reference before changing names:
   - `formula.X` must exist in `formulas`
   - view columns, order, and summaries must point to real properties or formulas
5. Preserve unrelated sections and existing view order unless the user asked for broader cleanup.

## Working rules

1. Output valid YAML only.
2. Quote strings that contain YAML-sensitive characters.
3. If a view references `formula.X`, define `X` in `formulas`.
4. Guard optional fields with `if()` in formulas.
5. After editing, validate both YAML syntax and formula or property references.
6. Prefer minimal edits over regenerating the whole base.
7. If you are editing an embedded `base` block, keep the surrounding Markdown fences intact.

## Common pitfalls

- Unquoted strings with `:` or other YAML-special characters.
- Mismatched quotes inside formulas.
- Treating date subtraction like a plain number instead of a duration.
- Referencing missing properties or formulas.
- Assuming every layout is available in every environment; some views depend on newer Obsidian versions or additional plugins.
