# Tag Policy Rules

This document is the human-editable companion to `tag-policy.json`.

## Current policy

- `policyId`: `default-tag-policy`
- `autoArchiveFromTagRules`: `false` (suggestion mode)
- `sourcePriority`: `manual > rule > ai`

## Rule writing checklist

1. Keep deterministic rules for auto archive.
2. Use clear `when` conditions:
   - zone
   - path prefix
   - frontmatter key/value
3. Use explicit `then` actions:
   - tags to add
   - target zone
   - move target path
   - rename template
4. Set `emitSuggestionOnly=true` if confidence is not guaranteed.

## Rule table

| id | enabled | deterministic | when | then |
|---|---|---|---|---|
| meeting-note-to-archive | true | true | `workspace_draft` + `docType=meeting_note` + `workspace/meetings/` | add tags + move to archive + rename |
| wiki-artifact-guard | true | true | `wiki_artifact` | mark as wiki artifact, suggestion only |

## Conflict handling

- If more than one deterministic rule matches with incompatible targets, do not auto archive.
- Emit `TAG_POLICY_CONFLICT`.
- Generate archive suggestion instead of writing files.

