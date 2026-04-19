---
name: json-canvas
description: Create and edit Obsidian JSON Canvas files with spec-valid nodes, edges, groups, labels, colors, and safe editing of existing canvas graphs.
command: json-canvas
aliases: [json-canvas, canvas, obsidian-canvas]
tags: [obsidian, canvas, graph, layout]
trigger: Use when the task is about .canvas files, visual boards, flowcharts, mind maps, or canvas node or edge editing.
executionMode: agent_orchestrated
---

# Skill: json-canvas

Operate on Obsidian `.canvas` files, which are JSON documents with top-level `nodes` and `edges` arrays.

## Base structure

```json
{
  "nodes": [],
  "edges": []
}
```

## Core rules

### Required validity rules

1. The top level should contain `nodes` and `edges` arrays.
2. Every node and edge ID must be unique strings.
3. Preserve existing IDs when editing an existing canvas. Create new IDs only for new nodes or edges.
4. Every `fromNode` and `toNode` in edges must reference an existing node ID.
5. `fromSide` and `toSide` may only use `top`, `right`, `bottom`, or `left`.
6. `fromEnd` and `toEnd` may only use `none` or `arrow`.
7. Preserve node order unless you intentionally want to change z-index, because array order controls stacking.

### Layout and readability suggestions

1. Keep layout readable: avoid overlap and use consistent spacing.
2. Prefer minimal edits over full regeneration when updating an existing canvas.

## Common operations

### Create a canvas
- Initialize empty `nodes` and `edges`.
- Add nodes with `id`, `type`, `x`, `y`, `width`, and `height`.
- Add edges that connect valid node IDs.

### Edit a canvas
- Parse JSON first.
- Locate target nodes or edges by `id`.
- Preserve unknown fields and unrelated nodes or edges.
- Modify attributes like text, file, subpath, URL, position, color, label, grouping, or edge endpoints.
- Re-validate references and enum values after every change.

## Important node types

- `text`: markdown-capable text block
- `file`: vault file reference
- `link`: external URL
- `group`: visual grouping container

## Common fields worth preserving

- File nodes may use `file` and optional `subpath`.
- Group nodes may use `label`, `background`, and `backgroundStyle`.
- Edges may use `label`, `color`, `fromSide`, `toSide`, `fromEnd`, and `toEnd`.
- Colors may be hex strings or preset color strings such as `"1"` to `"6"`.

## Validation checklist

- JSON parses successfully.
- No duplicate IDs.
- All edge references resolve.
- Required fields exist for each node type.
- Unknown fields are preserved unless intentionally removed.
