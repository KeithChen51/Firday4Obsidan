# Unified Release-Branch Publishing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current source-branch release layout with a target-state-only publishing model where `main` holds source, `release` holds publishable trees, plugin updates read `plugin/latest.json`, official content reads `official/latest.json`, and future community channel repos publish `channel/latest.json`.

**Architecture:** Rename the existing plugin and official-content release outputs into namespaced publish trees, teach the runtime clients to read from the `release` branch instead of the source branch, and add first-class Gitee pipeline configs that build from `main` and update the `release` branch. Treat `CHANGELOG.md` as official-channel content only; plugin release feed keeps only summary release notes.

**Tech Stack:** TypeScript, Node.js scripts, Obsidian plugin runtime, simple-git, Node built-in test runner (`node --test`), Gitee Go YAML pipelines.

---

### Task 1: Lock The Target-State Publishing Contract With Failing Tests

**Files:**
- Create: `tests/release-branch-publishing-contract.test.mjs`
- Modify: `tests/release-script.test.mjs`
- Modify: `tests/plugin-update-service.test.mjs`
- Modify: `tests/plugin-update-studio-log.test.mjs`
- Modify: `tests/official-content-feed-release.test.mjs`
- Modify: `tests/plugin-update-settings-regression.test.mjs`

**Step 1: Add a release-tree contract test**

Create `tests/release-branch-publishing-contract.test.mjs` that locks:

- plugin feed path is `plugin/latest.json`
- plugin artifacts path is `plugin/artifacts/*`
- official content feed path is `official/latest.json`
- community channel convention is `channel/latest.json`
- source branch is not treated as a publish tree

**Step 2: Update plugin release tests to the new namespaced layout**

Modify:

- `tests/release-script.test.mjs`
- `tests/plugin-update-service.test.mjs`
- `tests/plugin-update-studio-log.test.mjs`

to assert:

- plugin update reads `plugin/latest.json`
- plugin artifacts are under `plugin/artifacts/`
- plugin artifacts no longer include `CHANGELOG.md`
- plugin update still does not write official-content files directly

**Step 3: Update official feed tests to the new namespaced layout**

Modify `tests/official-content-feed-release.test.mjs` to assert:

- official feed writes to `official/latest.json`
- channel manifests are under `official/channels/`
- blobs are under `official/files/`

**Step 4: Update settings copy contract**

Modify `tests/plugin-update-settings-regression.test.mjs` so update notices explicitly say:

- plugin updates replace plugin artifacts only
- full changelog lives in the official channel

**Step 5: Run the red baseline**

Run:

```bash
node --test tests/release-branch-publishing-contract.test.mjs tests/release-script.test.mjs tests/plugin-update-service.test.mjs tests/plugin-update-studio-log.test.mjs tests/official-content-feed-release.test.mjs tests/plugin-update-settings-regression.test.mjs
```

Expected:

- failures referencing old `release/latest.json`
- failures referencing `release/friday-obsidian-plugin/*`
- failures referencing `official-content/*`
- failures showing plugin artifacts still include changelog assumptions

**Step 6: Commit**

```bash
git add tests/release-branch-publishing-contract.test.mjs tests/release-script.test.mjs tests/plugin-update-service.test.mjs tests/plugin-update-studio-log.test.mjs tests/official-content-feed-release.test.mjs tests/plugin-update-settings-regression.test.mjs
git commit -m "test: lock unified release-branch publishing contract"
```

### Task 2: Move Plugin Release Output Into `plugin/` Namespace

**Files:**
- Modify: `scripts/release.mjs`
- Modify: `src/constants/update.ts`
- Modify: `tests/release-script.test.mjs`
- Modify: `tests/plugin-update-service.test.mjs`
- Modify: `tests/plugin-update-studio-log.test.mjs`
- Modify: `tests/plugin-update-settings-regression.test.mjs`

**Step 1: Write the smallest failing plugin-path test**

Add or narrow a test asserting:

- `PLUGIN_UPDATE_MANIFEST_PATH === "plugin/latest.json"`
- `PLUGIN_UPDATE_ARTIFACT_DIR === "plugin/artifacts"`

**Step 2: Run it to verify it fails**

Run:

```bash
node --test tests/release-branch-publishing-contract.test.mjs tests/plugin-update-service.test.mjs
```

Expected: FAIL on old `release/latest.json` and `release/friday-obsidian-plugin`

**Step 3: Update plugin release constants and script**

Modify:

- `src/constants/update.ts`
- `scripts/release.mjs`

so the release script writes:

- `plugin/latest.json`
- `plugin/artifacts/main.js`
- `plugin/artifacts/manifest.json`
- `plugin/artifacts/styles.css`

and stops copying `CHANGELOG.md` into plugin artifacts.

**Step 4: Keep plugin feed summary-only**

Ensure `plugin/latest.json` still exposes concise `releaseNotes`, but no plugin artifact references to full changelog remain.

**Step 5: Run focused verification**

Run:

```bash
node --test tests/release-script.test.mjs tests/plugin-update-service.test.mjs tests/plugin-update-studio-log.test.mjs tests/plugin-update-settings-regression.test.mjs
```

Expected:

- plugin release paths pass
- plugin update client reads the new namespaced feed
- plugin artifacts no longer include changelog payloads

**Step 6: Commit**

```bash
git add scripts/release.mjs src/constants/update.ts tests/release-script.test.mjs tests/plugin-update-service.test.mjs tests/plugin-update-studio-log.test.mjs tests/plugin-update-settings-regression.test.mjs
git commit -m "feat: namespace plugin release artifacts under plugin"
```

### Task 3: Move Official Content Release Output Into `official/` Namespace

**Files:**
- Modify: `scripts/generate-official-content-release.mjs`
- Modify: `src/services/OfficialContentService.ts`
- Modify: `src/constants/officialContent.ts`
- Modify: `tests/official-content-feed-release.test.mjs`
- Modify: `tests/official-content-settings-contract.test.mjs`
- Modify: `CHANGELOG.md`

**Step 1: Add a failing official-path assertion**

Write or narrow a test asserting:

- official feed path is `official/latest.json`
- official manifests are under `official/channels/`
- official blobs are under `official/files/`

**Step 2: Run to verify it fails**

Run:

```bash
node --test tests/official-content-feed-release.test.mjs tests/official-content-settings-contract.test.mjs
```

Expected: FAIL on current `official-content/*` paths

**Step 3: Rename generator output**

Modify `scripts/generate-official-content-release.mjs` so it emits:

- `official/latest.json`
- `official/channels/official.json`
- `official/files/<hash>.md`

while still injecting repo-root `CHANGELOG.md` as the official `Changelog` column.

**Step 4: Update runtime client**

Modify `src/services/OfficialContentService.ts` and related constants so runtime fetches the new official paths from the `release` branch layout.

**Step 5: Run focused verification**

Run:

```bash
node --test tests/official-content-feed-release.test.mjs tests/official-content-settings-contract.test.mjs tests/official-content-legacy-guard.test.mjs
```

Expected:

- official feed paths pass
- settings/runtime references use `official/latest.json`
- changelog remains an official column

**Step 6: Commit**

```bash
git add scripts/generate-official-content-release.mjs src/services/OfficialContentService.ts src/constants/officialContent.ts tests/official-content-feed-release.test.mjs tests/official-content-settings-contract.test.mjs CHANGELOG.md
git commit -m "feat: namespace official release artifacts under official"
```

### Task 4: Add Community Channel Protocol Constants And Validation

**Files:**
- Create: `src/constants/communityChannel.ts`
- Create: `tests/community-channel-release-contract.test.mjs`
- Modify: `src/types/officialContent.ts`
- Modify: `tests/release-branch-publishing-contract.test.mjs`

**Step 1: Write the failing community protocol test**

Create `tests/community-channel-release-contract.test.mjs` asserting:

- one repository maps to one channel
- default community entry path is `channel/latest.json`
- default branch is `release`
- subscriber config can be just `repoUrl`

**Step 2: Run it to verify it fails**

Run:

```bash
node --test tests/community-channel-release-contract.test.mjs
```

Expected: FAIL because community protocol constants/types do not exist yet

**Step 3: Add the protocol constants and types**

Create `src/constants/communityChannel.ts` and extend `src/types/officialContent.ts` with the minimum shared source descriptor types needed for:

- official built-in source
- community source with repoUrl only

**Step 4: Run focused verification**

Run:

```bash
node --test tests/community-channel-release-contract.test.mjs tests/release-branch-publishing-contract.test.mjs
```

Expected:

- default community entry path passes
- “one repository = one channel” passes

**Step 5: Commit**

```bash
git add src/constants/communityChannel.ts src/types/officialContent.ts tests/community-channel-release-contract.test.mjs tests/release-branch-publishing-contract.test.mjs
git commit -m "feat: define community channel release protocol"
```

### Task 5: Add Gitee Go Pipelines For Source-To-Release Publishing

**Files:**
- Create: `.workflow/app-release-publish.yml`
- Create: `docs/plans/2026-04-23-community-channel-release-example.md`
- Create: `tests/gitee-release-pipeline-contract.test.mjs`
- Modify: `package.json`

**Step 1: Write a failing pipeline contract test**

Create `tests/gitee-release-pipeline-contract.test.mjs` that asserts:

- there is an app pipeline under `/.workflow/`
- it runs from the source branch
- it publishes into the `release` branch
- it runs plugin and official release generators

**Step 2: Run to verify it fails**

Run:

```bash
node --test tests/gitee-release-pipeline-contract.test.mjs
```

Expected: FAIL because no `.workflow` file exists yet

**Step 3: Add the application pipeline**

Create `.workflow/app-release-publish.yml` that:

- checks out source from `main`
- runs `npm ci`
- runs `npm run test`
- runs `npm run build`
- exports `plugin/` and `official/`
- updates the `release` branch with publish-tree-only contents

Do not model the pipeline as building from `release` itself.

**Step 4: Add a community example**

Create `docs/plans/2026-04-23-community-channel-release-example.md` with a minimal example layout and Gitee Go notes for third-party channel authors.

**Step 5: Run focused verification**

Run:

```bash
node --test tests/gitee-release-pipeline-contract.test.mjs
```

Expected:

- pipeline file exists
- source-to-release behavior is encoded in YAML

**Step 6: Commit**

```bash
git add .workflow/app-release-publish.yml docs/plans/2026-04-23-community-channel-release-example.md tests/gitee-release-pipeline-contract.test.mjs package.json
git commit -m "feat: add gitee release publishing pipeline"
```

### Task 6: Retire Source-Branch Release Assumptions In Runtime And Docs

**Files:**
- Modify: `src/services/PluginUpdateService.ts`
- Modify: `src/services/OfficialContentService.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `README.md`

**Step 1: Write a failing source-branch regression**

Extend existing tests to assert:

- runtime no longer points at `master` as the publish source
- settings copy describes plugin updates and official content as release-branch publish trees

**Step 2: Run to verify it fails**

Run:

```bash
node --test tests/plugin-update-service.test.mjs tests/official-content-settings-contract.test.mjs tests/plugin-update-settings-regression.test.mjs
```

Expected: FAIL on old source-branch assumptions

**Step 3: Switch runtime fetch assumptions**

Modify:

- `src/services/PluginUpdateService.ts`
- `src/services/OfficialContentService.ts`
- `src/settings/FridaySettingTab.ts`
- locale files

so they explicitly read from:

- `branch = release`
- `plugin/latest.json`
- `official/latest.json`

**Step 4: Update user-facing docs**

Modify `README.md` to explain:

- `main` is the source branch
- `release` is the publish branch
- plugin update feed and official content feed are separate namespaces under the same publish tree

**Step 5: Run focused verification**

Run:

```bash
node --test tests/plugin-update-service.test.mjs tests/official-content-settings-contract.test.mjs tests/plugin-update-settings-regression.test.mjs
```

Expected:

- runtime constants and client behavior pass
- UI copy no longer references source-branch feeds

**Step 6: Commit**

```bash
git add src/services/PluginUpdateService.ts src/services/OfficialContentService.ts src/settings/FridaySettingTab.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts README.md
git commit -m "refactor: point runtime to release-branch publish trees"
```

### Task 7: Full Verification And Publish-Tree Sanity Check

**Files:**
- Modify: `CHANGELOG.md`
- Modify: generated files under `plugin/` and `official/` output roots as needed by scripts

**Step 1: Regenerate publish trees**

Run:

```bash
npm run test
npm run build
```

Expected:

- all tests pass
- build passes
- generated publish outputs match the new `plugin/` and `official/` namespaces

**Step 2: Inspect the final publish-tree shape**

Run:

```bash
git status --short
```

Expected relevant output:

- namespaced publish artifacts under `plugin/` and `official/`
- no root-level `release/latest.json`
- no plugin `CHANGELOG.md` artifact

**Step 3: Commit the final generated outputs**

```bash
git add CHANGELOG.md
git add plugin official .workflow src tests docs README.md package.json
git commit -m "chore: finalize unified release-branch publishing"
```

### Task 8: Optional Follow-Up Execution Track For Community Repo Template

**Files:**
- Create later in a separate task/repo: community channel template repository

**Step 1: Stop**

Do not implement the community template repo in this pass.

**Step 2: Document the next unit of work**

Record that the next session can extract:

- a reusable `generate-channel-release` script
- a minimal community repo template
- a sample `channel/latest.json` consumer contract

**Step 3: Commit only if documentation changed**

```bash
git add docs/plans/2026-04-23-community-channel-release-example.md
git commit -m "docs: outline community channel template follow-up"
```
