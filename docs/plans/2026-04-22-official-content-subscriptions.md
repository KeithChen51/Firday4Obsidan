# Official Content Subscription Folder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert `F.R.I.D.A.Y/` into a pure official content subscription mount where `F.R.I.D.A.Y/` itself is the official channel and its first-level entries are subscribable columns, backed by a remote content feed that updates independently from plugin releases and guarded by a legacy safety gate that blocks destructive sync until historical root content has been migrated or explicitly taken over.

**Architecture:** Replace bundled `src/content/studio -> generated.ts -> AgentService.bootstrap()` publication with a generated remote content feed under `official/` plus a new `OfficialContentService` that owns startup/manual checks, dynamic official-column discovery, strict mirror apply for subscribed columns, deletion for unsubscribed columns, and root cleanup when no columns remain. Extend the existing `LegacyFridayRootMigrationService` into the gatekeeper for `F.R.I.D.A.Y` takeover so users are warned and blocked before legacy project/runtime/user files can be deleted by the new subscription semantics. This gate must be designed as a provider-agnostic guard for any future source that wants to write destructively into `F.R.I.D.A.Y/`, including later community channels.

**Tech Stack:** TypeScript, Obsidian API, simple-git, Node built-in test runner (`node --test`), npm scripts, local state helpers.

---

### Task 1: Lock The New Product Contract With Failing Tests

**Files:**
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/friday-root-cleanliness-regression.test.mjs`
- Create: `tests/official-content-feed-release.test.mjs`
- Create: `tests/official-content-settings-contract.test.mjs`
- Create: `tests/official-content-legacy-guard.test.mjs`

**Step 1: Add a feed-release contract test**

Create `tests/official-content-feed-release.test.mjs` that asserts the release generator contract:

- top-level directories under `src/content/studio` become official columns
- top-level `.md` files become official columns
- `README.md` is excluded
- root `CHANGELOG.md` is injected as `Changelog.md`

Assert output paths like:

```js
assert.match(source, /release\/official-content\/latest\.json/);
assert.match(source, /channels\/.+\.json/);
assert.match(source, /files\/.+\.md/);
```

**Step 2: Add a settings contract test**

Create `tests/official-content-settings-contract.test.mjs` that locks:

- `FridaySettings` has an `officialContent` section
- column subscriptions are stored by stable top-level entry ID
- there is a startup auto-check toggle and manual refresh flow
- newly discovered official columns default to subscribed unless the user has already stored an explicit toggle state

**Step 3: Add a legacy safety gate contract test**

Create `tests/official-content-legacy-guard.test.mjs` that asserts:

- any destructive content apply first scans `F.R.I.D.A.Y/`
- legacy top-level paths like `runtime`, `Agents`, `椤圭洰`, `涓汉`, `_閰嶇疆.md` block destructive apply
- blocked state still allows refreshing the remote catalog

**Step 4: Update root-structure regressions**

Modify:

- `tests/agent-service-root-structure.test.mjs`
- `tests/friday-root-cleanliness-regression.test.mjs`

to assert:

- `AgentService` no longer owns `STUDIO_CONTENT_SNAPSHOT` publication
- `F.R.I.D.A.Y/` remains reserved for official content only

**Step 5: Run tests to verify they fail**

Run:

```bash
node --test tests/agent-service-root-structure.test.mjs tests/friday-root-cleanliness-regression.test.mjs tests/official-content-feed-release.test.mjs tests/official-content-settings-contract.test.mjs tests/official-content-legacy-guard.test.mjs
```

Expected:

- failures showing official-content types and services do not exist yet
- failures showing `AgentService` still owns studio snapshot publication
- failures showing no legacy safety gate exists

**Step 6: Commit the red baseline**

```bash
git add tests/agent-service-root-structure.test.mjs tests/friday-root-cleanliness-regression.test.mjs tests/official-content-feed-release.test.mjs tests/official-content-settings-contract.test.mjs tests/official-content-legacy-guard.test.mjs
git commit -m "test: lock official content subscription contracts"
```

### Task 2: Generate Independent Official Content Release Artifacts

**Files:**
- Create: `scripts/generate-official-content-release.mjs`
- Modify: `package.json`
- Modify: `release/latest.json`
- Test: `tests/official-content-feed-release.test.mjs`

**Step 1: Create the new release generator**

Create `scripts/generate-official-content-release.mjs` that scans `src/content/studio` and emits:

- `official/latest.json`
- `official/channels/<channel-id>.json`
- `official/files/<hash>.md`

**Step 2: Implement official-column discovery rules**

The generator must:

- publish each top-level directory as a directory column
- publish each top-level `.md` file as a single-file column
- exclude `README.md`, `.keep`, and generated artifacts
- inject `Changelog.md` from repo-root `CHANGELOG.md`

**Step 3: Emit stable official-column metadata**

Each catalog entry should include at least:

```ts
{
  id: string;
  title: string;
  kind: "directory" | "file";
  path: string;
  version: string;
  manifestPath: string;
}
```

`id` must be derived from the published top-level path, not from mutable display copy.

The top-level `latest.json` should model `F.R.I.D.A.Y/` as the official channel/provider root, and list these entries as its columns.

**Step 4: Wire the script into build/release**

Update `package.json` so build/release workflows also generate the official content feed artifacts. Keep plugin artifact release metadata and content feed metadata as separate outputs.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/official-content-feed-release.test.mjs
```

Expected:

- all discovery rules pass
- new top-level directories would automatically become official columns

**Step 6: Commit**

```bash
git add scripts/generate-official-content-release.mjs package.json release/latest.json tests/official-content-feed-release.test.mjs
git commit -m "feat: generate official content release artifacts"
```

### Task 3: Add Official Content Domain Types And Settings Migration

**Files:**
- Create: `src/types/officialContent.ts`
- Create: `src/constants/officialContent.ts`
- Modify: `src/types/settings.ts`
- Modify: `src/types/plugin.ts`
- Modify: `src/main.ts`
- Test: `tests/official-content-settings-contract.test.mjs`

**Step 1: Define remote manifest and local subscription types**

Create `src/types/officialContent.ts` with:

- catalog types
- per-channel manifest types
- local column subscription summary types
- blocked-state types for the legacy safety gate

**Step 2: Add `officialContent` to settings**

Extend `FridaySettings` with an `officialContent` section that stores:

- `checkOnStartup`
- `startupDelayMs`
- `lastCheckedAt`
- `lastCatalogVersion`
- `catalog`
- `channels`

Default newly discovered official columns to subscribed.

**Step 3: Migrate old settings safely**

Update `main.ts` settings migration so:

- existing users get default `officialContent` settings
- no legacy studio path assumptions are copied into the new state
- existing explicit per-column subscribe or unsubscribe choices are preserved during migration and future catalog refreshes

**Step 4: Expose the new service on the plugin API**

Extend `src/types/plugin.ts` so the settings UI and startup flow can call the new official content service without reaching into implementation internals.

At the same time, update settings-section definitions so:

- the standalone `slash` settings section is removed from visible navigation
- a new `subscriptions` settings section replaces it
- existing slash command runtime support may remain internal for now, but it is no longer a first-class user-facing settings area

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/official-content-settings-contract.test.mjs
```

Expected:

- settings schema passes
- migration preserves existing user settings while adding official-content defaults

**Step 6: Commit**

```bash
git add src/types/officialContent.ts src/constants/officialContent.ts src/types/settings.ts src/types/plugin.ts src/main.ts tests/official-content-settings-contract.test.mjs
git commit -m "feat: add official content domain settings"
```

### Task 4: Remove Bundled Studio Runtime Ownership From AgentService

**Files:**
- Modify: `src/services/AgentService.ts`
- Modify: `src/content/studio/generated.ts`
- Modify: `tests/agent-service-root-structure.test.mjs`

**Step 1: Stop publishing `F.R.I.D.A.Y/` from `AgentService`**

Remove runtime ownership of studio content from `AgentService.bootstrap()`.

After this task:

- `AgentService` may still handle legacy `Agents` compatibility
- `AgentService` must no longer create, reconcile, or rewrite `F.R.I.D.A.Y/鏉ヨ嚜鍒朵綔缁刞

**Step 2: Narrow or retire bundled studio generation**

If `src/content/studio/generated.ts` remains in the tree, it must no longer be the runtime source of truth for `F.R.I.D.A.Y/`. Either:

- remove runtime consumption entirely, or
- keep it only as an internal build helper with no startup apply path

**Step 3: Run the focused tests**

Run:

```bash
node --test tests/agent-service-root-structure.test.mjs
```

Expected:

- `AgentService` no longer references `STUDIO_CONTENT_SNAPSHOT`
- legacy agent compatibility still works

**Step 4: Commit**

```bash
git add src/services/AgentService.ts src/content/studio/generated.ts tests/agent-service-root-structure.test.mjs
git commit -m "refactor: remove bundled studio runtime ownership"
```

### Task 5: Implement OfficialContentService Fetch, Catalog Refresh, And Strict Channel Apply

**Files:**
- Create: `src/services/OfficialContentService.ts`
- Modify: `src/main.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Test: `tests/official-content-settings-contract.test.mjs`
- Test: `tests/official-content-feed-release.test.mjs`

**Step 1: Implement remote fetch**

`OfficialContentService` must:

- reuse the same Git runtime and credential model already used for plugin updates
- fetch `official/latest.json`
- fetch per-channel manifests on demand
- read remote file blobs for subscribed channels

**Step 2: Implement startup and manual refresh flows**

Add methods such as:

```ts
refreshCatalog(): Promise<OfficialContentCatalog>
applySubscriptions(): Promise<OfficialContentApplyResult>
runStartupCheck(): Promise<void>
```

Wire `main.ts` so startup checks happen on plugin `onload`, with delay controlled by `officialContent.startupDelayMs`.

**Step 3: Implement strict official-column semantics**

For subscribed columns:

- create missing files
- overwrite changed files
- delete removed or extraneous files under the column root

For unsubscribed columns:

- delete the corresponding top-level column path

If no columns remain subscribed and `F.R.I.D.A.Y/` becomes empty:

- delete `F.R.I.D.A.Y/`

**Step 4: Add dynamic settings UI**

Replace the current slash-command-facing slot in settings navigation with a new `subscriptions` section, then render a dynamic official-column list there.

The UI should be framed as 鈥滆闃呴閬?/ Subscriptions鈥? not 鈥渟tudio鈥?or 鈥渟lash commands鈥?

Inside this section, replace hardcoded 鈥滃埗浣滅粍鈥?assumptions with a dynamic official-column list:

- startup auto-check toggle
- manual refresh button
- last checked status
- per-column subscribe toggle

Newly discovered official columns must render as subscribed by default, while an explicit user unsubscribe must remain sticky across future refreshes.

Structure the list as provider-aware even in v1:

- 瀹樻柟棰戦亾
  - column toggles...

Do not implement community subscriptions yet, but keep the section title and layout compatible with future community providers.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/official-content-settings-contract.test.mjs tests/official-content-feed-release.test.mjs
```

Expected:

- startup/manual refresh flows are wired
- settings render channels dynamically
- strict channel apply semantics pass for subscribed/unsubscribed channels

**Step 6: Commit**

```bash
git add src/services/OfficialContentService.ts src/main.ts src/settings/FridaySettingTab.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts tests/official-content-settings-contract.test.mjs tests/official-content-feed-release.test.mjs
git commit -m "feat: add official content subscription service"
```

### Task 6: Extend LegacyFridayRootMigrationService Into A Safety Gate

**Files:**
- Modify: `src/services/LegacyFridayRootMigrationService.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/main.ts`
- Test: `tests/official-content-legacy-guard.test.mjs`
- Test: `tests/friday-root-cleanliness-regression.test.mjs`

**Step 1: Add provider-agnostic blocking-path detection**

Extend `LegacyFridayRootMigrationService` so it can answer:

- which top-level paths under `F.R.I.D.A.Y/` are not current official-column roots
- whether destructive official-content apply is safe
- which legacy items are blocking takeover

Do not hardcode this only to the first-party official source. The API should be capable of receiving the current allowed top-level ownership set from any provider/source that wants to mutate `F.R.I.D.A.Y/`.

At minimum, block on:

- `runtime/`
- `Agents/`
- `椤圭洰/`
- `涓汉/`
- visible config mirrors
- unknown top-level files/folders not owned by the current official-column set

**Step 2: Block destructive apply while still allowing catalog refresh**

When blocking paths exist:

- `OfficialContentService.refreshCatalog()` must still work
- `OfficialContentService.applySubscriptions()` must return a blocked result and skip filesystem mutations

Keep the naming and return types generic enough that a future community subscription service can reuse the same guard instead of introducing a second destructive-write policy.

**Step 3: Surface a strong warning in settings and startup notice**

The UI must clearly state:

- there is historical content under `F.R.I.D.A.Y/`
- subscribed content updates may delete user files if takeover continues without migration
- the user should migrate or clean up first

**Step 4: Add an explicit takeover action**

Provide a destructive, double-confirmed action such as:

```text
纭鐢卞畼鏂归閬撴帴绠?F.R.I.D.A.Y
```

This action is the only path that may intentionally remove remaining blocking top-level paths when the user chooses not to migrate them.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/official-content-legacy-guard.test.mjs tests/friday-root-cleanliness-regression.test.mjs
```

Expected:

- blocking paths prevent destructive apply
- catalog refresh still succeeds
- explicit takeover path is the only destructive override

**Step 6: Commit**

```bash
git add src/services/LegacyFridayRootMigrationService.ts src/settings/FridaySettingTab.ts src/main.ts tests/official-content-legacy-guard.test.mjs tests/friday-root-cleanliness-regression.test.mjs
git commit -m "feat: add legacy safety gate for official content takeover"
```

### Task 7: Verify End-To-End, Update Release Notes, And Clean Up Contracts

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/friday-root-cleanliness-regression.test.mjs`
- Modify: `tests/plugin-update-service.test.mjs`

**Step 1: Update release notes**

Document that:

- `F.R.I.D.A.Y/` is now the local mount for the official channel
- official content updates are independent from plugin version updates
- official columns are discovered dynamically from remote feed metadata
- newly discovered official columns default to subscribed, while user opt-out remains respected
- legacy root content blocks destructive apply until migrated or explicitly taken over

**Step 2: Verify plugin update separation**

Update regression tests so plugin update behavior no longer claims it rebuilds bundled studio content. Plugin updates should update plugin artifacts only; official content updates should go through the new content feed path.

**Step 3: Run full verification**

Run:

```bash
npm run test
npm run build
```

Expected:

- all tests pass
- build passes
- `F.R.I.D.A.Y/` has only official-column ownership paths
- startup check, manual refresh, dynamic official columns, and legacy blocking all behave as documented

**Step 4: Commit**

```bash
git add CHANGELOG.md tests/agent-service-root-structure.test.mjs tests/friday-root-cleanliness-regression.test.mjs tests/plugin-update-service.test.mjs
git commit -m "chore: finalize official content subscription flow"
```

