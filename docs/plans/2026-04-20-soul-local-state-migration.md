# Soul Local State Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Friday's legacy `Agent`-centered vault state with a `Soul` concept layer plus a dedicated local state store for soul definitions, sessions, approvals, and other runtime-only state.

**Architecture:** Treat this as a staged migration, not a rename. First, lock the target contract with failing tests. Then introduce `Soul` types and a compatibility layer in settings/main. Next, create new local state stores (`SoulStore` and `RuntimeStateStore`) and move approvals and sessions off `AgentService`. After that, add a one-time automatic migration on upgrade, then switch the settings UI and DailyBoard from `Agent` language to `Soul`. Finish with a user-visible cleanup action that removes legacy Agent runtime data from `F.R.I.D.A.Y` after migration has succeeded.

**Tech Stack:** TypeScript, Obsidian API, Node built-in test runner (`node --test`), npm, local JSON/JSONL file storage.

---

### Task 1: Lock The Soul Migration Contract With Failing Tests

**Files:**
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/settings-native-groups-regression.test.mjs`
- Modify: `tests/daily-board-ui-regression.test.mjs`
- Modify: `tests/chat-composer-queue-regression.test.mjs`
- Create: `tests/soul-store.test.mjs`
- Create: `tests/runtime-state-store.test.mjs`
- Create: `tests/conversation-service-soul-metadata.test.mjs`

**Step 1: Write the failing `Soul` contract assertions**

Add assertions that:
- `settings.ts` will expose `activeSoulId`
- the settings UI will render `Soul` wording instead of `Agent`
- DailyBoard will switch agent-selection/session-loading logic to `Soul`
- chat toolbar persistence will stop calling `writeAgentProfile(activeAgent)`

Use assertions like:

```js
assert.match(source, /activeSoulId/);
assert.doesNotMatch(source, /activeAgentId/);
assert.match(source, /settings\.soul\./);
```

**Step 2: Write the failing local-state storage assertions**

Cover:
- `SoulStore` uses a dedicated local state root instead of `F.R.I.D.A.Y/Agents`
- `RuntimeStateStore` exposes `sessions/`, `approvals/`, and `souls/` layout
- `ConversationService` session meta includes `soulId`

Use a minimal target shape like:

```ts
interface ConversationMeta {
  sessionId: string;
  projectId?: string;
  soulId: string;
  title?: string;
  ts: string;
}
```

**Step 3: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/agent-service-root-structure.test.mjs tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/soul-store.test.mjs tests/runtime-state-store.test.mjs tests/conversation-service-soul-metadata.test.mjs
```

Expected:
- failures mentioning missing `Soul` types / UI copy
- failures mentioning legacy `AgentService` / `activeAgentId` / session metadata shape

**Step 4: Commit the red baseline**

```bash
git add tests/agent-service-root-structure.test.mjs tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/soul-store.test.mjs tests/runtime-state-store.test.mjs tests/conversation-service-soul-metadata.test.mjs
git commit -m "test: lock soul migration contracts"
```

### Task 2: Introduce Soul Types And Settings Compatibility

**Files:**
- Create: `src/types/soul.ts`
- Modify: `src/types/agent.ts`
- Modify: `src/types/settings.ts`
- Modify: `src/types/plugin.ts`
- Modify: `src/main.ts`
- Test: `tests/soul-store.test.mjs`

**Step 1: Add the new `Soul` types**

Create `src/types/soul.ts` with a minimal first-pass model:

```ts
export interface SoulSummary {
  id: string;
  name: string;
  summary: string;
  description: string;
  presetRefs: string[];
  builtIn: boolean;
  editable: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SoulState {
  activeSoulId: string;
  lastUsedSoulId: string;
  recentlyUsedSoulIds: string[];
}
```

**Step 2: Add compatibility fields in settings**

Update `src/types/settings.ts` so the canonical setting becomes `activeSoulId`, while legacy `agents[]` / `activeAgentId` can still be read during migration. Do not delete the old fields in the same commit; instead mark them as migration-only.

**Step 3: Add `Soul`-aware plugin APIs in `main.ts`**

Implement bridge methods such as:

```ts
getActiveSoul(): SoulSummary | null
setActiveSoul(soulId: string): Promise<void>
createSoul(input: { name: string; summary: string }): Promise<SoulSummary>
```

Keep the old `getActiveAgent` / `setActiveAgent` methods temporarily as compatibility shims that delegate to the new path.

**Step 4: Run the focused tests**

Run:

```bash
node --test tests/settings-native-groups-regression.test.mjs tests/soul-store.test.mjs
```

Expected:
- `Soul` type and settings compatibility assertions pass
- remaining failures limited to storage/UI migration work

**Step 5: Commit**

```bash
git add src/types/soul.ts src/types/agent.ts src/types/settings.ts src/types/plugin.ts src/main.ts tests/settings-native-groups-regression.test.mjs tests/soul-store.test.mjs
git commit -m "feat: introduce soul types and settings compatibility"
```

### Task 3: Add A Dedicated Local State Root With Soul And Runtime Stores

**Files:**
- Create: `src/services/LocalStateRootService.ts`
- Create: `src/services/SoulStore.ts`
- Create: `src/services/RuntimeStateStore.ts`
- Modify: `src/main.ts`
- Modify: `src/services/AgentService.ts`
- Test: `tests/soul-store.test.mjs`
- Test: `tests/runtime-state-store.test.mjs`
- Test: `tests/agent-service-root-structure.test.mjs`

**Step 1: Introduce a single local-state root resolver**

Create `LocalStateRootService` so every non-vault runtime path goes through one place:

```ts
export class LocalStateRootService {
  resolve(...parts: string[]): string
  ensureBaseLayout(): Promise<void>
}
```

Do not hardcode runtime folders from multiple call sites.

**Step 2: Implement `SoulStore`**

Use a layout like:

```text
<local-root>/
  souls/
    registry.json
    state.json
    definitions/
      default.json
```

Implement minimal operations:

```ts
listSouls(): Promise<SoulSummary[]>
getSoul(id: string): Promise<SoulSummary | null>
createSoul(input): Promise<SoulSummary>
setActiveSoul(id: string): Promise<void>
```

**Step 3: Implement `RuntimeStateStore`**

Use a layout like:

```text
<local-root>/
  sessions/
  approvals/
  snapshots/
```

Expose path helpers and basic read/write helpers for sessions and approval stores.

**Step 4: Shrink `AgentService` responsibilities**

Stop treating `AgentService` as the global runtime-state owner. Keep only vault-facing responsibilities that still matter during transition, such as presets and global knowledge scaffolding. It should no longer be the path source for sessions or approval files.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/soul-store.test.mjs tests/runtime-state-store.test.mjs tests/agent-service-root-structure.test.mjs
```

Expected:
- new store tests pass
- `AgentService` tests reflect reduced scope

**Step 6: Commit**

```bash
git add src/services/LocalStateRootService.ts src/services/SoulStore.ts src/services/RuntimeStateStore.ts src/main.ts src/services/AgentService.ts tests/soul-store.test.mjs tests/runtime-state-store.test.mjs tests/agent-service-root-structure.test.mjs
git commit -m "feat: add soul and runtime local state stores"
```

### Task 4: Move Approval Storage Off Agent Paths

**Files:**
- Modify: `src/services/ToolApprovalService.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/main.ts`
- Test: `tests/approval-queue.test.mjs`
- Test: `tests/runtime-state-store.test.mjs`

**Step 1: Replace `agentId`-rooted approval storage**

Refactor `ToolApprovalService` so its persisted rules live under `RuntimeStateStore`, not `AgentService.getAgentToolApprovalPath(agentId)`.

A minimal shape is:

```ts
interface ApprovalStoreKey {
  projectId?: string;
  scope: "global" | "project";
}
```

First version can keep one global store if project-specific approval partitioning is not yet needed. Do not retain `tool-approval-rules.json` under `Agents/<id>/memory`.

**Step 2: Update runtime call sites**

Wire `AgentRuntimeService` and plugin bootstrap so they instantiate `ToolApprovalService` with the new runtime state store dependency.

**Step 3: Run the focused tests**

Run:

```bash
node --test tests/approval-queue.test.mjs tests/runtime-state-store.test.mjs
```

Expected:
- PASS
- no approval storage path depends on `AgentService`

**Step 4: Commit**

```bash
git add src/services/ToolApprovalService.ts src/services/AgentRuntimeService.ts src/main.ts tests/approval-queue.test.mjs tests/runtime-state-store.test.mjs
git commit -m "refactor: move tool approvals to runtime state store"
```

### Task 5: Migrate Conversations To Unified Sessions With `soulId` Metadata

**Files:**
- Modify: `src/services/ConversationService.ts`
- Modify: `src/main.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/types/plugin.ts`
- Test: `tests/conversation-service-soul-metadata.test.mjs`
- Test: `tests/daily-board-ui-regression.test.mjs`

**Step 1: Change session storage layout**

Move `ConversationService` off `getAgentSessionsRoot(agentId)` and into `RuntimeStateStore` session paths.

Use a meta line shape like:

```json
{"type":"meta","sessionId":"...","projectId":"...","soulId":"default","title":"","ts":"..."}
```

Keep the message rows unchanged except for any necessary compatibility fields.

**Step 2: Add compatibility reads**

During migration, allow `ConversationService` to read legacy `Agents/<id>/sessions/*.jsonl` if no migrated session exists yet. Do not keep dual-write behavior once the new path is active.

**Step 3: Switch DailyBoard to `Soul` state**

Replace:
- `switchAgent`
- `getActiveAgent`
- `listSessions(activeAgent.id, ...)`
- `saveSession(activeAgent.id, ...)`

with `Soul`-aware calls that pass `soulId` metadata rather than deriving a directory root from the soul.

**Step 4: Run the focused tests**

Run:

```bash
node --test tests/conversation-service-soul-metadata.test.mjs tests/daily-board-ui-regression.test.mjs
```

Expected:
- session metadata contains `soulId`
- DailyBoard no longer assumes sessions are grouped by `agentId` path

**Step 5: Commit**

```bash
git add src/services/ConversationService.ts src/main.ts src/views/DailyBoardView.ts src/types/plugin.ts tests/conversation-service-soul-metadata.test.mjs tests/daily-board-ui-regression.test.mjs
git commit -m "refactor: move sessions to soul-aware runtime storage"
```

### Task 6: Add One-Time Automatic Migration On Upgrade

**Files:**
- Modify: `src/main.ts`
- Modify: `src/services/SoulStore.ts`
- Modify: `src/services/RuntimeStateStore.ts`
- Modify: `src/services/ConversationService.ts`
- Modify: `src/services/ToolApprovalService.ts`
- Create: `src/services/LegacyAgentMigrationService.ts`
- Create: `tests/legacy-agent-migration.test.mjs`
- Modify: `tests/main-root-index-recovery.test.mjs`

**Step 1: Add a dedicated legacy migration service**

Create `LegacyAgentMigrationService` responsible for:
- detecting old `settings.agents[]` / `activeAgentId`
- importing `profile.json` / `agent.md` into `SoulStore`
- importing legacy sessions into the new unified session store
- importing legacy approval rules into the new approval store
- recording migration completion state

**Step 2: Make startup migration automatic and idempotent**

Plugin bootstrap should:
- run the migration once on first upgraded startup
- skip cleanly on subsequent starts if migration is already complete
- never create duplicate souls, duplicate sessions, or duplicate approval rules

Expected behavior:
- user upgrades and can keep working immediately
- new runtime writes only hit the new storage
- legacy storage becomes read-only fallback at most

**Step 3: Run the focused tests**

Run:

```bash
node --test tests/legacy-agent-migration.test.mjs tests/main-root-index-recovery.test.mjs
```

Expected:
- migration runs once
- rerunning bootstrap is a no-op
- no dual-write back into `F.R.I.D.A.Y/Agents`

**Step 4: Commit**

```bash
git add src/main.ts src/services/SoulStore.ts src/services/RuntimeStateStore.ts src/services/ConversationService.ts src/services/ToolApprovalService.ts src/services/LegacyAgentMigrationService.ts tests/legacy-agent-migration.test.mjs tests/main-root-index-recovery.test.mjs
git commit -m "feat: add automatic soul migration on upgrade"
```

### Task 7: Replace Agent UI And Settings Flows With Soul

**Files:**
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/main.ts`
- Test: `tests/settings-native-groups-regression.test.mjs`
- Test: `tests/daily-board-ui-regression.test.mjs`
- Test: `tests/chat-composer-queue-regression.test.mjs`
- Test: `tests/i18n-parity.test.mjs`

**Step 1: Rename the concept layer**

Update UI copy, setting keys, and control labels from `Agent` to `Soul`.

Display only user-facing soul fields:
- name
- summary
- description
- preset references
- style / behavior rules

Do not expose storage paths, approval files, or session directories in settings UI.

**Step 2: Update persistence flows**

Replace direct `agentService.writeAgentProfile(activeAgent)` style writes with `SoulStore` update calls.

For example:

```ts
await this.plugin.soulStore.updateSoul(activeSoul.id, {
  preferredModel: parsed?.model ?? "",
});
```

**Step 3: Run the focused tests**

Run:

```bash
node --test tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/i18n-parity.test.mjs
```

Expected:
- PASS
- UI sources no longer require `settings.agents` or `activeAgentId`

**Step 4: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/views/DailyBoardView.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts src/main.ts tests/settings-native-groups-regression.test.mjs tests/daily-board-ui-regression.test.mjs tests/chat-composer-queue-regression.test.mjs tests/i18n-parity.test.mjs
git commit -m "refactor: switch Friday UI from agent to soul"
```

### Task 8: Add The Cleanup Action For Legacy Agent Data

**Files:**
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/main.ts`
- Create: `src/services/LegacyAgentCleanupService.ts`
- Modify: `src/services/AgentService.ts`
- Create: `tests/legacy-agent-cleanup.test.mjs`
- Modify: `tests/settings-native-groups-regression.test.mjs`

**Step 1: Add a cleanup service with explicit scope**

Create a `LegacyAgentCleanupService` that removes only migrated legacy Agent runtime data. The cleanup action must not mean “delete all of `F.R.I.D.A.Y`”.

Default deletion scope:
- `F.R.I.D.A.Y/Agents/<id>/sessions`
- `F.R.I.D.A.Y/Agents/<id>/snapshots`
- `F.R.I.D.A.Y/Agents/<id>/memory`
- `F.R.I.D.A.Y/Agents/<id>/profile.json`
- `F.R.I.D.A.Y/Agents/<id>/agent.md`

**Step 2: Backup ambiguous legacy knowledge files before delete**

For files such as:
- `knowledge/project_context.md`
- `knowledge/decision_log.md`
- `knowledge/lessons_learned.md`

do not hard-delete them blindly. First back them up into local state backup storage, or explicitly preserve them when no safe mapping exists.

**Step 3: Expose the cleanup action in settings**

In the `Soul`/migration-related settings area, show a button such as:

```text
迁移并清理旧 Agent 数据
```

Only render it when:
- automatic migration has completed successfully
- legacy Agent data still exists

**Step 4: Run the focused tests**

Run:

```bash
node --test tests/legacy-agent-cleanup.test.mjs tests/settings-native-groups-regression.test.mjs
```

Expected:
- cleanup button appears only after successful migration
- cleanup removes legacy runtime data
- ambiguous old knowledge files are backed up or preserved, not silently lost

**Step 5: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/main.ts src/services/LegacyAgentCleanupService.ts src/services/AgentService.ts tests/legacy-agent-cleanup.test.mjs tests/settings-native-groups-regression.test.mjs
git commit -m "feat: add legacy agent cleanup action"
```

### Task 9: Finalize Legacy Migration And Verify No Core Flow Depends On `F.R.I.D.A.Y/Agents`

**Files:**
- Modify: `src/services/AgentService.ts`
- Modify: `src/main.ts`
- Modify: `src/services/ConversationService.ts`
- Modify: `src/services/ToolApprovalService.ts`
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/registry-consistency.test.mjs`
- Modify: `tests/main-root-index-recovery.test.mjs`

**Step 1: Reduce legacy `AgentService` to a compatibility shim or retire it**

At this point, no main flow should depend on:
- `getAgentsRoot()`
- `getAgentSessionsRoot()`
- `getAgentToolApprovalPath()`
- `agentFilePath`

If `AgentService` still exists after this task, it should only support one-time import or vault-facing user assets, not current runtime state.

**Step 2: Verify bootstrap and migration behavior**

Ensure plugin startup does:
- detect legacy agent data if present
- import it once into `SoulStore` / `RuntimeStateStore`
- mark migration complete
- stop writing new runtime data into `F.R.I.D.A.Y/Agents`
- expose cleanup only after successful migration
- leave no legacy runtime data after explicit cleanup

**Step 3: Run full verification**

Run:

```bash
node --test
npm run build
```

Expected:
- all tests pass
- build passes
- grep/inspection confirms no core runtime storage still points at `F.R.I.D.A.Y/Agents`

**Step 4: Commit**

```bash
git add src/services/AgentService.ts src/main.ts src/services/ConversationService.ts src/services/ToolApprovalService.ts tests/agent-service-root-structure.test.mjs tests/registry-consistency.test.mjs tests/main-root-index-recovery.test.mjs
git commit -m "refactor: finalize soul local state migration"
```
