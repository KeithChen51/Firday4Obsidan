# Soul Legacy Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the remaining `Agent` compatibility shell so `Soul` becomes the only active concept and storage source in Friday.

**Architecture:** This is a cleanup pass, not a new feature. The current code already runs on `SoulStore`, `RuntimeStateStore`, and hybrid memory, but many APIs, settings fields, and UI entry points still proxy through legacy `Agent` shapes. The plan is to delete those compatibility layers in three passes: settings/types, plugin/runtime APIs, then final legacy store retirement. Migration and cleanup services stay until all old data paths are fully retired.

**Tech Stack:** TypeScript, Obsidian API, Node built-in test runner (`node --test`), npm.

---

### Task 1: Lock The Final Soul-Only Contract

**Files:**
- Modify: `tests/settings-native-groups-regression.test.mjs`
- Modify: `tests/daily-board-ui-regression.test.mjs`
- Modify: `tests/chat-composer-queue-regression.test.mjs`
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/registry-consistency.test.mjs`

**Step 1: Add the failing soul-only assertions**

Add assertions that:
- `settings.ts` no longer exposes `agents` / `activeAgentId`
- `plugin.ts` no longer exposes `getActiveAgent` / `setActiveAgent` / `createAgent`
- `FridaySettingTab` no longer reads `settings.agents`
- `DailyBoardView` no longer calls `getActiveAgent()`
- `AgentService` is no longer referenced by runtime/session/cleanup hot paths

**Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/agent-service-root-structure.test.mjs tests/registry-consistency.test.mjs
```

Expected:
- failures mentioning `settings.agents`, `activeAgentId`, `getActiveAgent`, or `AgentService`

**Step 3: Commit**

```bash
git add tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/agent-service-root-structure.test.mjs tests/registry-consistency.test.mjs
git commit -m "test: lock soul-only legacy convergence"
```

### Task 2: Remove Legacy Agent Fields From Settings And Plugin APIs

**Files:**
- Modify: `src/types/settings.ts`
- Modify: `src/types/plugin.ts`
- Modify: `src/main.ts`
- Modify: `src/types/agent.ts`

**Step 1: Drop legacy settings ownership**

Remove:
- `settings.agents`
- `settings.activeAgentId`

Keep migration logic only long enough to import old persisted values into `SoulStore` during startup.

**Step 2: Drop legacy plugin APIs**

Remove:
- `getActiveAgent()`
- `setActiveAgent()`
- `createAgent()`

Update all callers to:
- `getActiveSoul()`
- `setActiveSoul()`
- `createSoul()`

**Step 3: Run focused verification**

Run:

```bash
node --test tests/settings-native-groups-regression.test.mjs tests/chat-composer-queue-regression.test.mjs
```

Expected:
- no remaining references to legacy settings/API names

**Step 4: Commit**

```bash
git add src/types/settings.ts src/types/plugin.ts src/main.ts src/types/agent.ts tests/settings-native-groups-regression.test.mjs tests/chat-composer-queue-regression.test.mjs
git commit -m "refactor: remove legacy agent settings and api"
```

### Task 3: Make UI Read Souls Directly From SoulStore

**Files:**
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/views/DailyBoardView.ts`

**Step 1: Stop sourcing soul options from legacy `settings.agents`**

Update both settings and DailyBoard so they:
- list souls from `SoulStore`
- resolve active role from `activeSoulId`
- stop projecting through `AgentProfile`

**Step 2: Keep compatibility only in migration**

If a vault still has old `Agent` data, let `LegacyAgentMigrationService` import it first, then the UI reads only the new soul definitions.

**Step 3: Run focused verification**

Run:

```bash
node --test tests/daily-board-ui-regression.test.mjs tests/settings-native-groups-regression.test.mjs
```

Expected:
- UI no longer requires `settings.agents`

**Step 4: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/views/DailyBoardView.ts tests/daily-board-ui-regression.test.mjs tests/settings-native-groups-regression.test.mjs
git commit -m "refactor: source soul ui from soul store"
```

### Task 4: Shrink AgentService To Migration-Only Responsibility

**Files:**
- Modify: `src/services/AgentService.ts`
- Modify: `src/services/ConversationService.ts`
- Modify: `src/services/LegacyAgentMigrationService.ts`
- Modify: `src/services/LegacyAgentCleanupService.ts`

**Step 1: Restrict AgentService to legacy import/cleanup helpers**

`AgentService` should no longer be treated as a live service. Its only remaining role should be:
- legacy path discovery
- one-time migration support
- explicit cleanup support

**Step 2: Remove live runtime dependence**

Ensure runtime/session/tool paths do not depend on `AgentService` for any active flow, only for import/cleanup of old data.

**Step 3: Run focused verification**

Run:

```bash
node --test tests/agent-service-root-structure.test.mjs tests/conversation-service-soul-metadata.test.mjs tests/legacy-agent-migration.test.mjs tests/legacy-agent-cleanup.test.mjs
```

Expected:
- `AgentService` remains only as legacy boundary glue

**Step 4: Commit**

```bash
git add src/services/AgentService.ts src/services/ConversationService.ts src/services/LegacyAgentMigrationService.ts src/services/LegacyAgentCleanupService.ts tests/agent-service-root-structure.test.mjs tests/conversation-service-soul-metadata.test.mjs tests/legacy-agent-migration.test.mjs tests/legacy-agent-cleanup.test.mjs
git commit -m "refactor: shrink agent service to legacy boundary"
```

### Task 5: Final Verification And Decide Whether AgentService Can Be Deleted

**Files:**
- Modify: `tests/registry-consistency.test.mjs`
- Modify: `tests/main-root-index-recovery.test.mjs`
- Optional: delete `src/services/AgentService.ts` if no call sites remain

**Step 1: Re-scan the codebase**

Confirm whether these still exist in live code:
- `settings.agents`
- `activeAgentId`
- `getActiveAgent`
- `setActiveAgent`
- `createAgent`
- `agentFilePath`

If only migration/cleanup paths remain, decide whether `AgentService` should stay as a dedicated legacy helper or be inlined and removed.

**Step 2: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected:
- all tests pass
- build passes
- soul is the only active concept in runtime and UI

**Step 3: Commit**

```bash
git add .
git commit -m "refactor: finish soul legacy convergence"
```
