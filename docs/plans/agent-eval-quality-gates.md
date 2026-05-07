# Agent Eval Quality Gates

Batch E adds a deterministic eval layer on top of the Agent Runtime Harness. These gates are intentionally local-only: no real model calls, no network, no MCP/RAG/wiki expansion.

## Required Commands

```bash
node --test tests/token-budget.test.mjs
node --test tests/tool-boundary-filter.test.mjs
node --test tests/context-assembler-token-budget.test.mjs
node --test tests/agent-eval-runner.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
npm test
```

## Scenario Coverage

The data-driven suite in `tests/evals/agent-scenarios.json` must cover these current core scenario IDs:

1. `read-one-file-cites-evidence` - Read one file and cite evidence.
2. `grep-then-read-match` - Search text, then read the matched file.
3. `file-missing-clear-failure` - Missing file failure with a clear final answer.
4. `project-relative-read-resolves-workspace-path` - Project-relative `workspace/...` reads normalize to the active project root.
5. `bare-filename-resolves-unique-active-project-file` - A unique bare filename resolves within the active project only.
6. `ambiguous-bare-filename-returns-candidates` - Ambiguous bare filenames fail with candidate paths and suggested args.
7. `raw-write-denied-with-workspace-suggestion` - Generated writes under `raw/` are denied with a `workspace/` recovery suggestion.
8. `repeated-invalid-path-does-not-loop` - Repeated identical failed tool calls produce loop-prevention recovery instead of burning iterations.
9. `write-request-creates-mutation-plan` - Write request creates a pending mutation plan.
10. `reject-mutation-keeps-file-unchanged` - Rejecting a mutation leaves files unchanged.
11. `edit-conflict-becomes-conflicted` - External edits produce a conflicted mutation.
12. `delete-creates-single-mutation-review` - Delete creates one high-risk mutation review.
13. `organize-mode-plans-links-and-tags` - Organize mode proposes links/tags/frontmatter as reviewable mutations.
14. `review-mode-detects-structure-issues` - Review mode detects duplicate structure and missing sources.
15. `debug-profile-allows-exec` - Debug profile exposes allowlisted `exec`.
16. `normal-mode-hides-exec` - Normal modes hide `exec`.
17. `retryable-transport-no-prompt-fallback` - Retryable native transport failure does not fallback to prompt mode.
18. `oversized-context-triggers-compaction` - Oversized context triggers compaction and records trimmed channels.
19. `dirty-tool-history-is-repaired-before-model-request` - Dirty tool-call history is repaired before the next model request.
20. `tool-iteration-limit-safe-stop` - Tool iteration limit safe-stops the turn.

## Pass Criteria

- Eval scenarios must be scripted and reproducible through `runAgentRuntimeScenario`.
- Eval assertions must inspect runtime outputs, persisted turn events, mutation state, and model request shape where applicable.
- Context budget must report approximate token usage rather than raw character length.
- Final model requests must use the budgeted compact context package instead of duplicating raw wiki, memory, mention, or skill context.
- Eval diagnostics must expose sanitized model request text, approximate token counts, and native tool-boundary violations for assertions.
- Tool-call history sent back to the model must not contain orphan, duplicate, or dangling native tool boundaries.
- Path recovery scenarios must assert canonical `trace.targetPath`, replay `recoveryTimeline`, and replay `loopPreventionTimeline` entries rather than relying only on final assistant text.
- Failure scenarios must remain diagnosable through replay events.
- The suite must not introduce real network calls or shell execution outside the governed fake harness.

## Adding or Updating Scenarios

Every runtime-facing change must decide whether it changes the core eval suite or adds supplemental coverage:

- Add or update a core scenario when introducing a new default tool, user-visible agent mode, mutation operation, approval path, context source, replay terminal state, or model-request boundary rule.
- Add a supplemental scenario when the behavior is optional, debug-only, provider-specific, legacy migration-only, or a narrow regression that does not change the Obsidian knowledge-work contract.
- A new tool scenario must assert tool visibility, policy/approval outcome, trace status, relevant replay events, and whether the final vault files changed.
- A new mutation scenario must assert pending/applied/rejected/conflicted state, target path, operation, risk level when relevant, event-log timeline, and final file contents.
- A new mode scenario must assert the exposed tool surface and at least one representative ask/research/write/organize/review behavior for that mode.
- A new context or prompt-boundary scenario must assert sanitized model request diagnostics, approximate token budget, and absence of raw oversized sentinel content.
- Scenario IDs should be stable kebab-case strings. Do not rename existing core IDs unless the behavior itself has intentionally changed.
- Keep `tests/evals/agent-scenarios.json` deterministic: scripted model steps only, fake vault/files only, no real network, no real model, and no real shell execution beyond the governed fake harness.
- If a behavior is intentionally out of scope, record it in **Known Non-Goals** instead of adding a placeholder scenario that cannot fail meaningfully.

Core scenarios are the minimum release gate for the Obsidian-native knowledge-work agent surface. Supplemental scenarios may be added for specific regressions, but they must not weaken or replace the core 20 scenario coverage above.

## Known Non-Goals

- No Build mode.
- No Wiki/RAG/MCP/background agent/multi-agent expansion.
- No real model benchmark scoring.
- No broad runtime rewrite before harness coverage.
