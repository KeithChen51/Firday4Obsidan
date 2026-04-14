# Tag Policy Repository

This folder is the canonical template for project tag rules and tag definitions.

Runtime target path in project wiki:

`wiki/_governance/tag-policy/`

## Files

- `tag-policy.schema.json`: JSON schema for machine-validated policy files.
- `tag-policy.json`: starter policy file for rule-driven tagging and archive routing.
- `tag-policy.rules.md`: human-readable rule guide for PM/analyst editing.
- `tags-catalog.md`: tag dictionary that users and AI can read together.

## Execution contract

- User tags are highest priority and must not be overwritten by AI.
- Rule tags are applied only when a deterministic rule is matched.
- AI inferred tags are advisory unless rule and permission gates allow auto-apply.
- Auto archive runs only if `autoArchiveFromTagRules=true`.
- Archive actions may include `move + rename`.

## Sync model

Source of truth is file-based in the project wiki folder.
The app should read from and write back to this repository path, not an in-memory-only config.

