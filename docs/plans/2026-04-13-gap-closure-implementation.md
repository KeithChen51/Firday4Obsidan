# Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining W1/W2/W3 gaps that are still missing against the ledger and development plans.

**Architecture:** Keep the existing runtime/workbench architecture, but add the missing product surfaces and persistence loops around it. The core changes are: make edit actions emit reviewable `EditPlan` records with rollback, make conflict proposals approval-driven and actionable, expose effective tool policy and session override state in UI, and persist a real quality report ledger instead of only raw audit logs.

**Tech Stack:** TypeScript, Obsidian plugin runtime, node:test, existing Friday runtime/workbench services.

---

### Task 1: Add pure helpers and failing tests for the missing governance and ledger contracts

**Files:**
- Create: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\core\security\policy-resolver\PolicyMatrix.ts`
- Create: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\platform\quality\QualityLedger.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\tests\workbench-state-store.test.mjs`
- Create: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\tests\policy-matrix.test.mjs`
- Create: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\tests\quality-ledger.test.mjs`

**Step 1: Write failing tests**

- `policy-matrix.test.mjs` should verify `session > project > global` effective policy precedence and per-tool explanation rows.
- `quality-ledger.test.mjs` should verify a quality report ledger entry appends with timestamp and gate summary.
- `workbench-state-store.test.mjs` should verify conflict proposal replacement/status mutation and edit plan replacement.

**Step 2: Run tests to verify they fail**

Run:

```powershell
node --test tests/policy-matrix.test.mjs tests/quality-ledger.test.mjs tests/workbench-state-store.test.mjs
```

Expected: failures because helper modules and richer store behavior do not exist yet.

**Step 3: Write minimal implementation**

- `PolicyMatrix.ts`: build rows for known tools with `globalEffect`, `projectEffect`, `sessionEffect`, `effectiveEffect`, `effectiveSource`.
- `QualityLedger.ts`: serialize ledger entries and append content.
- `WorkbenchStateStore.ts`: support replacing conflict proposals and edit plans while preserving status.

**Step 4: Re-run the focused tests**

Run:

```powershell
node --test tests/policy-matrix.test.mjs tests/quality-ledger.test.mjs tests/workbench-state-store.test.mjs
```

Expected: PASS.

### Task 2: Wire EditPlan into runtime write/edit/delete and expose accept/reject/rollback

**Files:**
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\services\AgentRuntimeService.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\features\workbench\WorkbenchStateStore.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\main.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\views\DailyBoardView.ts`

**Step 1: Write failing test coverage first**

- Extend `workbench-state-store.test.mjs` for edit plan replacement and retrieval semantics.
- If needed, add a focused pure helper test for edit plan rollback mapping.

**Step 2: Run focused test**

```powershell
node --test tests/workbench-state-store.test.mjs tests/edit-plan.test.mjs
```

Expected: failure for the new review/rollback expectations.

**Step 3: Write minimal implementation**

- Inject `WorkbenchStateStore` into `AgentRuntimeService`.
- After `write/edit/delete`, record an `EditPlanRecord` containing `agentId`, `tool`, `path`, `before`, `after`, and applied status.
- Add runtime methods to accept, reject, and rollback an edit plan.
- Render edit plans on the `Checks` page with explicit `Accept / Reject / Rollback` actions.

**Step 4: Re-run focused tests and build**

```powershell
node --test tests/workbench-state-store.test.mjs tests/edit-plan.test.mjs
npm run build
```

Expected: PASS.

### Task 3: Turn conflict proposals into an approval-driven apply/reject flow

**Files:**
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\features\workbench\WorkbenchStateStore.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\views\DailyBoardView.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\services\SyncService.ts`

**Step 1: Add/extend failing test**

- Extend `workbench-state-store.test.mjs` to assert proposal status transitions.

**Step 2: Run focused test**

```powershell
node --test tests/workbench-state-store.test.mjs tests/conflict-proposal-builder.test.mjs
```

Expected: failure for the new proposal lifecycle expectation.

**Step 3: Write minimal implementation**

- Store proposal status (`pending/applied/rejected`) and applied strategy.
- In the `Checks` page, render proposal actions: `Apply recommended`, `Use ours`, `Use theirs`, `Reject`.
- When applied, call `SyncService.resolveConflict(...)`, refresh sync status, and keep finalization explicit.

**Step 4: Re-run focused tests**

```powershell
node --test tests/workbench-state-store.test.mjs tests/conflict-proposal-builder.test.mjs
```

Expected: PASS.

### Task 4: Expose policy governance UI and quality report ledger

**Files:**
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\core\session-control\SessionOverrideAdapter.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\services\AgentRuntimeService.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\settings\FridaySettingTab.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\views\DailyBoardView.ts`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\src\types\settings.ts`

**Step 1: Use the new failing tests from Task 1**

Run:

```powershell
node --test tests/policy-matrix.test.mjs tests/quality-ledger.test.mjs
```

Expected: failure until UI/state integrations are added.

**Step 2: Write minimal implementation**

- Add session override listing on `SessionOverrideAdapter`.
- Add runtime policy matrix snapshot methods on `AgentRuntimeService`.
- Add project policy editor in settings with scope explanation and per-tool `inherit/allow/ask/deny`.
- Add session override controls in the workbench chat area and/or checks area.
- Append each generated quality report to a ledger file under `F.R.I.D.A.Y/runtime/`.

**Step 3: Re-run focused tests**

```powershell
node --test tests/policy-matrix.test.mjs tests/quality-ledger.test.mjs
```

Expected: PASS.

### Task 5: Run full verification and sync the rebuilt plugin to the Vault runtime

**Files:**
- Modify: `C:\Own Docm\Coding\Friday - Ob\Friday-beta-evm\.obsidian\plugins\friday-obsidian-plugin\main.js`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Friday-beta-evm\.obsidian\plugins\friday-obsidian-plugin\manifest.json`
- Modify: `C:\Own Docm\Coding\Friday - Ob\Friday-beta-evm\.obsidian\plugins\friday-obsidian-plugin\styles.css`

**Step 1: Run the full gate**

```powershell
node --test tests/*.mjs
npm run lint
npm run build
```

Expected: all green, with fresh evidence.

**Step 2: Sync the built plugin**

Copy the latest `main.js`, `manifest.json`, and `styles.css` from `Firday4Obsidan-upload` to the Vault plugin directory.

**Step 3: Verify sync**

Compare hashes or file timestamps for the three plugin artifacts.
