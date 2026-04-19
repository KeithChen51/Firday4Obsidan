# Studio Source Of Truth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `F.R.I.D.A.Y/来自制作组` as an authoritative snapshot generated from `src/content/studio` plus repo-root `CHANGELOG.md`, so user-local Studio content is fully rewritten to match the bundled source after plugin load.

**Architecture:** Replace the current flat Studio file export with a generated snapshot manifest that includes directories and files. Rework `AgentService` to reconcile the entire Studio tree from that snapshot, and remove update-service-only changelog special casing so bootstrap becomes the single publication path.

**Tech Stack:** TypeScript, Node.js generator scripts, Obsidian Vault APIs, node:test

---

### Task 1: Lock generator behavior with failing tests

**Files:**
- Modify: `tests/studio-content-source.test.mjs`

**Step 1: Write the failing test**

Add assertions that the generated module exports:

- directory entries for `从这里开始 · Start Here`
- directory entries for `幕后笔记 · Behind the Build`
- directory entries for `幕后笔记 · Behind the Build/Study with F.R.I.D.A.Y`
- a file entry for `迭代手记.md`

Also assert the injected changelog content starts with `# 迭代手记 · Changelog`.

**Step 2: Run test to verify it fails**

Run: `node --test tests/studio-content-source.test.mjs`
Expected: FAIL because the generated module currently exposes only markdown files and no injected changelog snapshot entry.

### Task 2: Lock runtime publication strategy with failing tests

**Files:**
- Modify: `tests/agent-service-root-structure.test.mjs`
- Modify: `tests/plugin-update-studio-log.test.mjs`
- Modify: `tests/plugin-update-service.test.mjs`

**Step 1: Write the failing tests**

Add assertions that:

- `AgentService` uses a full Studio snapshot reconcile path instead of `getStudioNotesRoot()` / `getStudioStartHerePath()`-style fixed child targeting.
- `PluginUpdateService` no longer writes `F.R.I.D.A.Y/来自制作组/迭代手记.md` directly.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/agent-service-root-structure.test.mjs tests/plugin-update-studio-log.test.mjs tests/plugin-update-service.test.mjs`
Expected: FAIL because runtime and update code still contain fixed-path Studio assumptions.

### Task 3: Implement snapshot generation

**Files:**
- Modify: `scripts/generate-studio-content.mjs`
- Modify: `src/content/studio/generated.ts`
- Create: `src/content/studio/幕后笔记 · Behind the Build/Study with F.R.I.D.A.Y/.keep`

**Step 1: Generate directory and file entries**

Change the generator to emit a full snapshot manifest with `kind`, `relativePath`, and `content` where applicable.

**Step 2: Inject changelog file**

Read repo-root `CHANGELOG.md`, normalize its H1 to `# 迭代手记 · Changelog`, and publish it as `迭代手记.md`.

**Step 3: Preserve empty directory intent**

Track empty directories through `.keep`, but do not publish `.keep` into the runtime snapshot.

### Task 4: Implement authoritative runtime reconcile

**Files:**
- Modify: `src/services/AgentService.ts`
- Modify: `src/constants/paths.ts`

**Step 1: Remove fixed Studio child assumptions**

Collapse Studio runtime writes onto one authoritative snapshot sync entrypoint rooted at `PRIMARY_PATHS.studio`.

**Step 2: Reconcile the Studio tree**

Delete extraneous files/directories under `F.R.I.D.A.Y/来自制作组`, then recreate snapshot directories and files from generated source.

### Task 5: Remove update-path special casing

**Files:**
- Modify: `src/services/PluginUpdateService.ts`
- Modify: `src/constants/update.ts`
- Modify: `src/main.ts`

**Step 1: Stop direct Vault changelog mirroring**

Remove the direct Studio changelog write path from update application and startup backfill.

**Step 2: Keep plugin update focused on plugin artifacts**

Let the updated plugin bootstrap republish the Studio snapshot on load.

### Task 6: Verify behavior

**Files:**
- Test: `tests/studio-content-source.test.mjs`
- Test: `tests/agent-service-root-structure.test.mjs`
- Test: `tests/plugin-update-studio-log.test.mjs`
- Test: `tests/plugin-update-service.test.mjs`

**Step 1: Run targeted tests**

Run: `node --test tests/studio-content-source.test.mjs tests/agent-service-root-structure.test.mjs tests/plugin-update-studio-log.test.mjs tests/plugin-update-service.test.mjs`
Expected: PASS

**Step 2: Run full regression suite**

Run: `npm test`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS
