# W1 Knowledge Wave Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete W1 by wiring context assembly, wiki retrieval, relation/capability indexes, and memory read/write into the runtime and skill harness.

**Architecture:** Keep the orchestration-skill model, but make the harness real: `ContextInputEnvelope + ContextAssembler + SemanticCompactor`, `WikiLookupService + knowledge provider`, `FileMemoryStore + MemoryPolicy`, and the missing `search_text` tool in the runtime.

**Tech Stack:** TypeScript, Obsidian Vault APIs, Node test runner (`node --test` + `jiti`), existing runtime/build pipeline.

---

### Task 1: Core W1 Unit Tests

**Files:**
- `tests/context-assembler.test.mjs`
- `tests/wiki-lookup.test.mjs`
- `tests/memory-policy.test.mjs`
- `tests/wiki-index-builders.test.mjs`
- `tests/memory-signal-extractor.test.mjs`

**Step 1: Write failing tests**
- Cover context budget trimming.
- Cover wiki lookup `direct_read` / `fallback`.
- Cover memory write threshold.
- Cover relation graph / capability index builders.

**Step 2: Run tests to verify failure**
Run: `node --test tests/context-assembler.test.mjs tests/wiki-lookup.test.mjs tests/memory-policy.test.mjs tests/wiki-index-builders.test.mjs tests/memory-signal-extractor.test.mjs`
Expected: FAIL before implementation.

### Task 2: Add W1 Core Modules

**Files:**
- `src/core/context/ContextAssembler.ts`
- `src/core/retrieval/WikiLookupService.ts`
- `src/core/retrieval/RelationGraphBuilder.ts`
- `src/core/retrieval/CapabilityIndexBuilder.ts`
- `src/core/memory/MemoryPolicy.ts`
- `src/core/memory/MemorySignalExtractor.ts`
- `src/core/memory/FileMemoryStore.ts`

**Step 1: Implement minimal behavior**
- Keep interfaces simple and deterministic.
- Prefer exact thresholds already locked in W1 docs.

**Step 2: Re-run unit tests**
Run: `node --test ...`
Expected: PASS.

### Task 3: Integrate Into Runtime

**Files:**
- `src/services/AgentRuntimeService.ts`
- `src/views/DailyBoardView.ts`
- `src/services/WikiIngestService.ts`

**Step 1: Add runtime usage**
- Inject assembled context and memory context.
- Persist memory signals after turns.
- Make `/skills` and `/skill` executable from the chat UI.
- Upgrade `compile-wiki` output to `Compiled Truth + Timeline`.
- Write `raw_relation_graph.json` and `raw_capability_index.json`.

**Step 2: Verify**
Run: `node --test tests/*.mjs`
Expected: PASS.

### Task 4: Finish Missing Harness Pieces

**Files:**
- `src/services/AgentRuntimeService.ts`
- `src/platform/tools/ToolManifestCatalog.ts`
- `src/services/ToolApprovalService.ts`
- `src/types/tools.ts` if needed

**Step 1: Add `search_text` runtime tool**
- Make it read-only and usable by builtin retrieval skills.
- Ensure tool policy / audit / summaries include it.

**Step 2: Run full gate**
Run: `npm run lint` and `npm run build`
Expected: PASS.
