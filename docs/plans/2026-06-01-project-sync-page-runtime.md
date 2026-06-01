# Project Sync Page Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the live project sync page in line with the Native Kit project page preview.

**Architecture:** Keep `DailyBoardView` as the live sync page surface and preserve the existing sync orchestration path. Move primary actions into the decision area, make local changes the main content, and keep sync checks, update tree, collaboration, and ignore rules as collapsible functional sections that fall below the main content on narrow panes.

**Tech Stack:** TypeScript, Obsidian DOM helpers, CSS container/media queries, Node test runner.

---

### Task 1: Align Live Page Structure

**Files:**
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

**Steps:**
1. Move the visible **同步当前项目** action from the sync status fold into the command action area next to **重新检查** and branch selection.
2. Keep the refresh action as a secondary text action so users do not confuse it with sync.
3. Put function-card state labels inside each summary row, default sections collapsed.
4. Preserve existing `syncSingleProject(project)` behavior and disabled state when remote or conflict checks block sync.

### Task 2: Make Local Changes Actionable

**Files:**
- Modify: `src/views/DailyBoardView.ts`
- Modify: `styles.css`

**Steps:**
1. Render local changes as the primary lane with stable status chips, readable file paths, and action groups.
2. Add a **管理忽略** entry in the local changes header that opens/focuses the ignore rules section.
3. Add per-row ignore confirmation for untracked files/directories without implying per-file selective sync support.
4. Add a **显示全部** affordance for lists longer than the default visible count.

### Task 3: Improve Ignore Rules Management

**Files:**
- Modify: `src/features/sync/GitIgnoreService.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: GitIgnoreService tests

**Steps:**
1. Read existing `.gitignore` rules for display.
2. Show existing rules, ignore candidates, and a manual add input inside the ignore section.
3. Reuse `applyRule` for all writes and keep confirmation before writing.

### Task 4: Responsive Polish And Regression Coverage

**Files:**
- Modify: `styles.css`
- Modify: `tests/daily-board-ui-regression.test.mjs`
- Modify: `tests/native-kit-catalog-server.test.mjs` only if Kit/source parity assertions need adjustment.

**Steps:**
1. Fix branch menu overlap and keep the branch selector compact on narrow panes.
2. Ensure function-card details use smaller internal text than section titles.
3. Ensure the function card moves below local changes at narrow widths.
4. Run targeted Node tests, lint/build, and diff checks before claiming completion.
