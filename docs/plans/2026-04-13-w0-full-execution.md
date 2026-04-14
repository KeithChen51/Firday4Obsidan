# W0 Full Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete W0 baseline by landing core runtime skeleton (`core + platform`), dual-layer policy merge with session overrides, STEP/tool audit persistence, Win/Mac runtime profile, and passing quality gates.

**Architecture:** Keep existing runtime behavior stable while inserting a thin orchestration/governance layer: `TurnStateMachine + TurnOrchestrator + ToolGovernor + PolicyResolver + AuditStores + RuntimeProfile`. Reuse current runtime tool handlers and wire the new layer around them.

**Tech Stack:** TypeScript (Obsidian plugin), Node test runner (`node --test` + `jiti`), existing build pipeline (`tsc + esbuild`).

---

### Task 1: Add Failing Core Tests

**Files:**
- Create: `tests/policy-resolver-core.test.mjs`
- Create: `tests/tool-governor.test.mjs`
- Create: `tests/runtime-profile.test.mjs`

**Step 1: Write failing tests**
- Validate `project > global` merge and session override priority.
- Validate tool failure classification and fallback decision.
- Validate runtime profile mapping for win/mac/unsupported.

**Step 2: Run tests to verify failure**
Run: `node --test tests/policy-resolver-core.test.mjs tests/tool-governor.test.mjs tests/runtime-profile.test.mjs`
Expected: FAIL (modules not implemented yet).

### Task 2: Implement Core and Platform Modules

**Files:**
- Create: `src/core/security/policy-resolver/types.ts`
- Create: `src/core/security/policy-resolver/PolicyResolverCore.ts`
- Create: `src/core/session-control/SessionOverrideAdapter.ts`
- Create: `src/core/tool-governor/ToolGovernor.ts`
- Create: `src/core/turn-state/TurnStateMachine.ts`
- Create: `src/core/orchestrator/TurnOrchestrator.ts`
- Create: `src/platform/runtime/RuntimeProfile.ts`
- Create: `src/platform/tools/ToolRunAuditStore.ts`
- Create: `src/platform/tools/StepTraceStore.ts`

**Step 1: Implement minimal code to satisfy tests**
- Add resolver/governor/profile logic.
- Add audit store append helpers.

**Step 2: Re-run tests**
Run: `node --test tests/policy-resolver-core.test.mjs tests/tool-governor.test.mjs tests/runtime-profile.test.mjs`
Expected: PASS.

### Task 3: Integrate New Layer into AgentRuntimeService

**Files:**
- Modify: `src/services/AgentRuntimeService.ts`

**Step 1: Write/extend failing integration test**
- Validate run result carries `STEP_*` traces and tool traces have `runId/status/failureClass` persisted fields.

**Step 2: Implement integration**
- Insert orchestrator + state machine hooks.
- Insert policy resolver check before tool execution.
- Insert tool governor failure classification.
- Persist `tool_runs` + `step_traces` via audit stores.

**Step 3: Verify**
Run: focused tests + `npm run build`.
Expected: PASS.

### Task 4: Enforce W0 Gate Commands

**Files:**
- Modify: `eslint.config.mts` (if needed for stable baseline)
- Modify: `package.json` (if needed for explicit gate command)

**Step 1: Run full gate**
Run: `npm run lint && npm run build`
Expected: PASS.
