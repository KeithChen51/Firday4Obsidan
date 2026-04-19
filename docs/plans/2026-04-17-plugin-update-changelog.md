# Plugin Update Changelog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mirror user-facing plugin release notes into `F.R.I.D.A.Y/runtime` whenever a plugin version update is applied.

**Architecture:** Keep `CHANGELOG.md` in the source repo as the human-maintained source of truth. Export the current version's release notes into `release/latest.json`, and during update application also mirror the repository changelog into a Vault runtime markdown file.

**Tech Stack:** TypeScript, Node.js release script, Obsidian vault adapter, node:test

---

### Task 1: Lock release metadata behavior with tests

**Files:**
- Modify: `tests/release-script.test.mjs`

**Step 1: Write the failing test**

Add a test that provides a temp-root `CHANGELOG.md`, runs `syncReleaseArtifacts`, and asserts `release/latest.json` includes the current version's `releaseNotes`.

**Step 2: Run test to verify it fails**

Run: `node --test tests/release-script.test.mjs`
Expected: FAIL because `release/latest.json` does not yet include parsed release notes.

### Task 2: Lock update mirroring behavior with tests

**Files:**
- Modify: `tests/plugin-update-service.test.mjs`

**Step 1: Write the failing test**

Add a test that applies an update from a mocked git release client and asserts `F.R.I.D.A.Y/runtime/plugin-update-log.md` is written with changelog content.

**Step 2: Run test to verify it fails**

Run: `node --test tests/plugin-update-service.test.mjs`
Expected: FAIL because the update service does not yet fetch or mirror changelog content.

### Task 3: Implement changelog export and vault mirroring

**Files:**
- Create: `CHANGELOG.md`
- Modify: `scripts/release.mjs`
- Modify: `src/constants/update.ts`
- Modify: `src/services/PluginUpdateService.ts`

**Step 1: Add changelog source**

Create a descending `CHANGELOG.md` with the current plugin version at the top.

**Step 2: Export current release notes**

Parse the current manifest version section from `CHANGELOG.md` and write it into `release/latest.json` as `releaseNotes`.

**Step 3: Mirror changelog after update**

Fetch `CHANGELOG.md` during update application and write it to `F.R.I.D.A.Y/runtime/plugin-update-log.md`.

### Task 4: Verify behavior

**Files:**
- Test: `tests/release-script.test.mjs`
- Test: `tests/plugin-update-service.test.mjs`

**Step 1: Run targeted tests**

Run: `node --test tests/release-script.test.mjs tests/plugin-update-service.test.mjs`
Expected: PASS

**Step 2: Run broader regression checks**

Run: `npm test`
Expected: PASS
