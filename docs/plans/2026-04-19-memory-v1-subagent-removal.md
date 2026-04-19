# Memory V1 And Subagent Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `subagent` completely from Friday and replace the legacy memory pipeline with a new explicit, two-layer `memory v1` system.

**Architecture:** Treat this as two coordinated refactors. First, collapse the runtime back to a single-agent execution model by removing `subagent` from tool manifests, prompts, settings, parser, traces, and UI. Second, delete the heuristic auto-memory pipeline and replace it with a single source-of-truth memory system: `global.md` plus per-project `project.md`, both injected each turn, both written only through an explicit `memory` tool, both governed by hard size limits and next-turn visibility.

**Tech Stack:** TypeScript, Obsidian API, Node built-in test runner (`node --test`), `jiti`, esbuild, npm.

---

### Task 1: Lock The Refactor With Failing Contract Tests

**Files:**
- Modify: `tests/tool-manifest-capability.test.mjs`
- Modify: `tests/prompt-context-engine.test.mjs`
- Modify: `tests/execution-gate.test.mjs`
- Modify: `tests/event-router.test.mjs`
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/i18n-parity.test.mjs`
- Create: `tests/memory-v1-store.test.mjs`
- Create: `tests/memory-tool-runtime-regression.test.mjs`

**Step 1: Write the failing subagent-removal assertions**

Add assertions that:
- `ToolManifestCatalog` no longer exposes `subagent`
- runtime prompt schema no longer advertises `type: "subagent"`
- `ExecutionGate` no longer references `enableSubagent` or `subagent_*` gate codes
- `EventRouter` no longer routes `memory.extraction_requested`
- settings/i18n no longer contain subagent-specific UI keys

**Step 2: Write the failing memory-v1 assertions**

Add assertions that:
- memory paths are `F.R.I.D.A.Y/_runtime/memory/global.md` and `<projectRoot>/.friday/memory/project.md`
- runtime prompt advertises `memory` tool arguments `action/scope/content/old_text`
- writes do not auto-apply to the current turn snapshot
- over-capacity writes fail with lightweight feedback

**Step 3: Run the focused tests to verify they fail**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/tool-manifest-capability.test.mjs tests/prompt-context-engine.test.mjs tests/execution-gate.test.mjs tests/event-router.test.mjs tests/agent-service-root-structure.test.mjs tests/i18n-parity.test.mjs tests/memory-v1-store.test.mjs tests/memory-tool-runtime-regression.test.mjs
```

Expected:
- Failures mentioning `subagent` still present
- Failures mentioning legacy memory paths / extraction behavior

**Step 4: Commit the red test baseline**

```bash
git add tests/tool-manifest-capability.test.mjs tests/prompt-context-engine.test.mjs tests/execution-gate.test.mjs tests/event-router.test.mjs tests/agent-service-root-structure.test.mjs tests/i18n-parity.test.mjs tests/memory-v1-store.test.mjs tests/memory-tool-runtime-regression.test.mjs
git commit -m "test: lock subagent removal and memory v1 contracts"
```

### Task 2: Remove Subagent From Contracts, Settings, And UI

**Files:**
- Modify: `src/platform/tools/ToolManifestCatalog.ts:1-28`
- Modify: `src/core/context/PromptContextEngine.ts:61-133`
- Modify: `src/core/execution/ExecutionGate.ts:1-75`
- Modify: `src/core/orchestrator/RuntimeEnvelopeParser.ts:1-120`
- Modify: `src/core/orchestrator/TurnOrchestrator.ts`
- Modify: `src/core/turn-state/TurnStateMachine.ts`
- Modify: `src/platform/runtime/CapabilityMatrix.ts`
- Modify: `src/settings/FridaySettingTab.ts:873-1001`
- Modify: `src/types/agent.ts:16-51`
- Modify: `src/types/settings.ts:133-164`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/views/DailyBoardView.ts`

**Step 1: Remove `subagent` from type contracts and default settings**

Delete:
- the `subagent` tool manifest
- `enableSubagent` / `maxSubagentDepth`
- `subagent_disabled` / `subagent_unsupported`
- `supportsSubagent`

**Step 2: Remove `subagent` from runtime prompt and parser**

Update the prompt schema so only `response` and `tool_call` remain. Remove parser support for `subagent` envelopes entirely.

**Step 3: Remove subagent-specific settings and UI strings**

Delete:
- settings toggles
- descriptive copy
- runtime activity labels
- DailyBoard subagent execution entries

**Step 4: Run the focused tests**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/tool-manifest-capability.test.mjs tests/prompt-context-engine.test.mjs tests/execution-gate.test.mjs tests/i18n-parity.test.mjs
```

Expected:
- PASS for subagent-removal assertions
- Remaining failures only from legacy memory behavior

**Step 5: Commit**

```bash
git add src/platform/tools/ToolManifestCatalog.ts src/core/context/PromptContextEngine.ts src/core/execution/ExecutionGate.ts src/core/orchestrator/RuntimeEnvelopeParser.ts src/core/orchestrator/TurnOrchestrator.ts src/core/turn-state/TurnStateMachine.ts src/platform/runtime/CapabilityMatrix.ts src/settings/FridaySettingTab.ts src/types/agent.ts src/types/settings.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts src/views/DailyBoardView.ts tests/tool-manifest-capability.test.mjs tests/prompt-context-engine.test.mjs tests/execution-gate.test.mjs tests/i18n-parity.test.mjs
git commit -m "refactor: remove subagent from Friday runtime"
```

### Task 3: Remove The Legacy Auto-Memory Pipeline

**Files:**
- Modify: `src/services/AgentRuntimeService.ts:430-618`
- Modify: `src/core/execution/EventRouter.ts`
- Modify: `src/core/execution/RuntimeEvent.ts`
- Modify: `src/services/AgentService.ts:200-214`
- Modify: `src/skills/packs/builtin/index.ts`
- Modify: `src/skills/packs/builtin/markdown.ts`
- Delete: `src/platform/capability/MemoryPersistCapability.ts`
- Delete: `src/core/memory/MemoryPolicy.ts`
- Delete: `src/core/memory/MemorySignalExtractor.ts`
- Modify: `tests/event-router.test.mjs`
- Modify: `tests/agent-service-root-structure.test.mjs`
- Delete: `tests/memory-policy.test.mjs`
- Delete: `tests/memory-signal-extractor.test.mjs`

**Step 1: Remove the auto-memory event path**

Delete:
- `memory.extraction_requested`
- `dispatchRuntimeEvent()` memory branch
- built-in `maintain-memory` skill behavior

**Step 2: Stop seeding legacy memory files**

Update `AgentService` so it no longer provisions:
- `facts.md`
- `preferences.md`

Do not auto-delete existing vault files; simply stop creating or reading them.

**Step 3: Remove obsolete code and tests**

Delete the legacy memory extractor/policy/capability files and the tests that only cover that pipeline.

**Step 4: Run targeted tests**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/event-router.test.mjs tests/agent-service-root-structure.test.mjs
```

Expected:
- PASS
- No imports of deleted legacy memory modules remain

**Step 5: Commit**

```bash
git add src/services/AgentRuntimeService.ts src/core/execution/EventRouter.ts src/core/execution/RuntimeEvent.ts src/services/AgentService.ts src/skills/packs/builtin/index.ts src/skills/packs/builtin/markdown.ts tests/event-router.test.mjs tests/agent-service-root-structure.test.mjs
git rm src/platform/capability/MemoryPersistCapability.ts src/core/memory/MemoryPolicy.ts src/core/memory/MemorySignalExtractor.ts tests/memory-policy.test.mjs tests/memory-signal-extractor.test.mjs
git commit -m "refactor: remove legacy auto-memory pipeline"
```

### Task 4: Implement Memory V1 Store And Path Resolution

**Files:**
- Create: `src/core/memory/MemoryStoreV1.ts`
- Create: `src/core/memory/MemoryTypes.ts`
- Modify: `src/services/AgentRuntimeService.ts:1117-1182`
- Modify: `src/services/AgentService.ts`
- Test: `tests/memory-v1-store.test.mjs`

**Step 1: Write the failing store test**

Cover:
- `global.md` path resolution
- `project.md` path resolution under active project root
- fixed Markdown record format `- [fact] ...`
- size-limit rejection
- unique-match enforcement for `replace/remove`

**Step 2: Implement the minimal store**

`MemoryStoreV1` should expose operations similar to:

```ts
type MemoryScope = "global" | "project";
type MemoryAction = "add" | "replace" | "remove";

interface MemoryWriteResult {
  ok: boolean;
  scope: MemoryScope;
  reason?: string;
  summary?: string;
}
```

Use only:
- `F.R.I.D.A.Y/_runtime/memory/global.md`
- `<projectRoot>/.friday/memory/project.md`

**Step 3: Wire runtime reads to the new store**

Replace `loadMemoryContext()` so it reads the two v1 files and truncates them into the prompt as a stable snapshot.

**Step 4: Run the focused tests**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/memory-v1-store.test.mjs tests/prompt-context-engine.test.mjs
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/core/memory/MemoryStoreV1.ts src/core/memory/MemoryTypes.ts src/services/AgentRuntimeService.ts src/services/AgentService.ts tests/memory-v1-store.test.mjs tests/prompt-context-engine.test.mjs
git commit -m "feat: add memory v1 store and prompt loading"
```

### Task 5: Add The Explicit `memory` Tool To Runtime

**Files:**
- Modify: `src/platform/tools/ToolManifestCatalog.ts`
- Modify: `src/core/capability/CapabilityRegistry.ts`
- Modify: `src/core/context/PromptContextEngine.ts:74-109`
- Modify: `src/services/AgentRuntimeService.ts:1554-1580`
- Modify: `src/services/AgentRuntimeService.ts:2660-2750`
- Modify: `src/core/tool-governor/CapabilityResolver.ts`
- Test: `tests/tool-manifest-capability.test.mjs`
- Test: `tests/memory-tool-runtime-regression.test.mjs`

**Step 1: Write the failing runtime tool tests**

Add assertions that:
- `memory` appears in the manifest catalog
- runtime prompt documents `memory`
- tool execution supports `add/replace/remove`
- successful writes report “applies next turn”
- failures return lightweight feedback only

**Step 2: Implement the tool definition**

Add a `memory` manifest and prompt schema with:

```json
{
  "action": "add|replace|remove",
  "scope": "global|project",
  "content": "...",
  "old_text": "..."
}
```

**Step 3: Route the tool to `MemoryStoreV1`**

In `AgentRuntimeService`, add a `toolMemory()` handler and make sure:
- writes happen immediately
- current turn snapshot is not mutated
- next turn sees updated memory

**Step 4: Run the focused tests**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/tool-manifest-capability.test.mjs tests/memory-tool-runtime-regression.test.mjs tests/prompt-context-engine.test.mjs
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/platform/tools/ToolManifestCatalog.ts src/core/capability/CapabilityRegistry.ts src/core/context/PromptContextEngine.ts src/services/AgentRuntimeService.ts src/core/tool-governor/CapabilityResolver.ts tests/tool-manifest-capability.test.mjs tests/memory-tool-runtime-regression.test.mjs tests/prompt-context-engine.test.mjs
git commit -m "feat: add explicit memory tool for memory v1"
```

### Task 6: Clean Up Runtime Copy, Built-In Skill Surfaces, And Regressions

**Files:**
- Modify: `src/settings/FridaySettingTab.ts:873-1001`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `tests/i18n-parity.test.mjs`
- Modify: `tests/native-tool-call-history-regression.test.mjs`
- Modify: `tests/skill-runtime-routing-regression.test.mjs`

**Step 1: Update runtime copy**

Make the UI and copy reflect the new reality:
- runtime tool descriptions should list `memory`, not `subagent`
- remove dead subagent settings/copy
- ensure any memory-specific runtime copy explains “next turn visibility”

**Step 2: Verify skill/runtime interaction**

Ensure the runtime still supports `use_skill`, but `maintain-memory` is no longer treated as a special built-in path.

**Step 3: Run the broad regression slice**

Run:

```bash
node scripts/generate-builtin-skill-markdown.mjs
node scripts/generate-studio-content.mjs
node --test tests/tool-manifest-capability.test.mjs tests/prompt-context-engine.test.mjs tests/execution-gate.test.mjs tests/event-router.test.mjs tests/agent-service-root-structure.test.mjs tests/i18n-parity.test.mjs tests/native-tool-call-history-regression.test.mjs tests/skill-runtime-routing-regression.test.mjs tests/memory-v1-store.test.mjs tests/memory-tool-runtime-regression.test.mjs
```

Expected:
- PASS

**Step 4: Run the project test suite**

Run:

```bash
npm test
```

Expected:
- Full suite passes

**Step 5: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts src/views/DailyBoardView.ts tests/i18n-parity.test.mjs tests/native-tool-call-history-regression.test.mjs tests/skill-runtime-routing-regression.test.mjs
git commit -m "chore: finish memory v1 rollout and remove subagent surfaces"
```

### Task 7: Sync The Design Docs With What Shipped

**Files:**
- Modify: `FRIDAY开发灵感/friday-对标Hermes的工具与记忆优化方向-2026-04-19.md`
- Modify: `FRIDAY开发灵感/friday-memory-v1与subagent下线设计决议-2026-04-19.md`
- Create: `docs/plans/2026-04-19-memory-v1-subagent-removal-implementation-notes.md` (optional, only if needed during rollout)

**Step 1: Re-read the shipped implementation**

Check the final behavior matches the decision docs:
- subagent is gone
- memory v1 is explicit-write only
- global/project paths are correct
- next-turn visibility is documented

**Step 2: Update any drift in the architecture notes**

Keep the design docs aligned with the real implementation if naming or path choices changed slightly during coding.

**Step 3: Run a final docs sanity check**

Run:

```bash
node --test tests/i18n-parity.test.mjs
```

Expected:
- PASS

**Step 4: Commit**

```bash
git add FRIDAY开发灵感/friday-对标Hermes的工具与记忆优化方向-2026-04-19.md FRIDAY开发灵感/friday-memory-v1与subagent下线设计决议-2026-04-19.md docs/plans/2026-04-19-memory-v1-subagent-removal.md
git commit -m "docs: sync memory v1 and subagent removal design"
```

Plan complete and saved to `docs/plans/2026-04-19-memory-v1-subagent-removal.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration

2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
