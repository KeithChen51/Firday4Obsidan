# Tags Catalog

Shared dictionary for users and AI.

## Usage rules

1. Manual tags are authoritative.
2. Rule tags are applied when policy conditions match.
3. AI tags are optional hints and require evidence.
4. All tags should be lowercase and slash-namespaced.

## Tag dictionary

| tag | category | meaning | suggested zone | owner |
|---|---|---|---|---|
| `doc/meeting-note` | document type | Meeting note document | `archive_source` | project |
| `doc/spec` | document type | Spec or requirement doc | `archive_source` | project |
| `status/draft` | lifecycle | Work in progress draft | `workspace_draft` | user |
| `status/approved` | lifecycle | Approved and ready to archive | `archive_source` | user |
| `wiki/artifact` | system | Generated wiki artifact | `wiki_artifact` | system |
| `archive/candidate` | workflow | Candidate for archive routing | `archive_source` | rule |

## Evidence expectation for auto tags

When AI adds a tag, keep a trace:

- rule id or reason
- source path
- timestamp

