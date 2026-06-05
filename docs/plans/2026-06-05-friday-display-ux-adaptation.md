# FRIDAY Display UX Adaptation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make FRIDAY plugin surfaces reliable at Windows 150% display scaling, narrow Obsidian panes, and constrained settings modal widths without losing the Obsidian-native visual contract.

**Architecture:** Treat component/container width as the primary adaptation signal. Keep the workbench and sync page on container queries, add the same discipline to settings and Soul Lab, then reduce fragile duplicated CSS that can make old visual rules reappear.

**Tech Stack:** Obsidian plugin UI, TypeScript, scoped CSS in `styles.css`, Node test runner regression tests in `tests/*.mjs`.

---

## Success Criteria

- Settings surfaces adapt from their own available width, not only from viewport width.
- Soul Lab cards, suggestion panel, QR modal, and URL copy row remain readable and actionable in narrow settings panes.
- Workbench chrome keeps controls reachable at narrow pane widths and high display scaling.
- Branch names, session selection, and mention-token remove affordances do not create hidden or ambiguous interactions.
- Duplicate CSS definitions for core live components are either consolidated or guarded by tests so obsolete visual rules do not reassert.
- Verification includes targeted UI regression tests, TypeScript checking, and `git diff --check`.

## Coordination Rules

- Do not revert unrelated dirty work in the checkout.
- Run TDD for each behavior change: write/adjust regression test first, run it to see the expected failure, then implement.
- Do not dispatch multiple implementation agents that write `styles.css` at the same time.
- Parallel agents may do read-only exploration in separate areas.
- Implementation agents must declare changed files in their final summary.
- The controller integrates results, resolves conflicts, and runs final verification.

## Subagent Roster

### Explorer A: Settings and Soul Lab Responsiveness

**Type:** read-only explorer.

**Question:** Which settings and Soul Lab selectors still depend on viewport media queries or fixed dimensions, and what exact tests should fail before fixing them?

**Files to inspect:**
- `src/settings/FridaySettingTab.ts`
- `src/settings/sections/SoulSettingsSection.ts`
- `src/ui/obsidian-native/SettingsKit.ts`
- `styles.css`
- `tests/settings-project-ui-regression.test.mjs`
- `tests/soul-lab-template-regression.test.mjs`

**Return:** Exact selectors, proposed test assertions, and likely CSS changes. No file edits.

### Explorer B: CSS Duplication and Visual Rule Drift

**Type:** read-only explorer.

**Question:** Which high-risk selectors have multiple top-level definitions, especially session drawer/item and mention dropdown, and which definitions are obsolete after Native Kit correction?

**Files to inspect:**
- `styles.css`
- `tests/design-guidelines-regression.test.mjs`
- `tests/daily-board-ui-regression.test.mjs`
- `tests/native-kit-catalog-server.test.mjs`

**Return:** Consolidation map with line references and tests that should guard against reintroduction. No file edits.

### Explorer C: Daily Board Micro-Interaction Risks

**Type:** read-only explorer.

**Question:** Which visible interactions still risk clipping, ambiguous selection, missing labels, or too-small hit areas in the live workbench?

**Files to inspect:**
- `src/views/DailyBoardView.ts`
- `src/views/components/MentionComposer.ts`
- `src/core/editor/mention/MentionComposerDocument.ts`
- `styles.css`
- `tests/daily-board-ui-regression.test.mjs`
- `tests/mention-token-remove-width-regression.test.mjs`

**Return:** Exact behavior gaps and test changes. No file edits.

---

## Task 1: Settings Container Adaptation

**Owner:** Worker 1.

**Files:**
- Modify: `styles.css`
- Modify: `tests/settings-project-ui-regression.test.mjs`
- Optionally modify: `src/settings/FridaySettingTab.ts`
- Optionally modify: `src/ui/obsidian-native/SettingsKit.ts`

**Step 1: Write failing tests**

Add tests that require settings UI to expose a settings-level container and container-query adaptation. The test should check for:

- A settings root or reusable settings group selector with `container-type: inline-size`.
- Container-query rules that stack `.friday-native-settings-group .setting-item` controls by container width.
- Project editor inputs and controls retaining `min-width: 0` inside that container-based narrow state.

Run:

```powershell
node --test tests\settings-project-ui-regression.test.mjs
```

Expected: FAIL because settings adaptation is currently viewport-media based.

**Step 2: Implement minimal CSS/DOM support**

Prefer CSS-only if possible:

- Add `container-type: inline-size` to the narrowest stable settings wrapper or reusable group.
- Add container-query equivalents for the existing `@media (max-width: 640px)` settings stacking rules.
- Keep existing media queries as a fallback.

If a root class is needed, add one in `FridaySettingTab.display()` after `containerEl.empty()`.

**Step 3: Verify**

Run:

```powershell
node --test tests\settings-project-ui-regression.test.mjs
```

Expected: PASS.

---

## Task 2: Soul Lab Narrow-Container and Modal Resilience

**Owner:** Worker 2, after Task 1 finishes if both need `styles.css`.

**Files:**
- Modify: `styles.css`
- Modify: `tests/soul-lab-template-regression.test.mjs`
- Optionally modify: `src/settings/FridaySettingTab.ts`

**Step 1: Write failing tests**

Add tests that require:

- Soul Lab intro/series/suggestion panel to have container-query stacking, not only `@media (max-width: 720px)`.
- Suggestion modal to avoid a hard `min-width` that can exceed narrow modal content.
- QR image sizing to use `min()`/`clamp()` or equivalent bounded sizing instead of a fixed 220px-only size.
- URL row and copy button stack cleanly in narrow containers.

Run:

```powershell
node --test tests\soul-lab-template-regression.test.mjs
```

Expected: FAIL on missing container-query/bounded-size assertions.

**Step 2: Implement minimal CSS**

- Add container-type to a Soul Lab wrapper or relevant groups.
- Add `@container` rules for the same selectors currently handled by viewport media.
- Bound QR image and QR panel sizes with container-safe sizing.
- Keep actions and URL row full-width when narrow.

**Step 3: Verify**

Run:

```powershell
node --test tests\soul-lab-template-regression.test.mjs
```

Expected: PASS.

---

## Task 3: Daily Board Clipping, Labels, and Hit Areas

**Owner:** Worker 3.

**Files:**
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/core/editor/mention/MentionComposerDocument.ts`
- Modify: `styles.css`
- Modify: `tests/daily-board-ui-regression.test.mjs`
- Modify: `tests/mention-token-remove-width-regression.test.mjs`

**Step 1: Write failing tests**

Add tests that require:

- Current branch text has a `title` or equivalent full-value affordance when visually truncated.
- Session management checkbox has an `aria-label` including the session title.
- Inline mention token remove button keeps a small visual glyph but has a larger comfortable hit area.

Run:

```powershell
node --test tests\daily-board-ui-regression.test.mjs tests\mention-token-remove-width-regression.test.mjs
```

Expected: FAIL on missing affordances.

**Step 2: Implement minimal code/CSS**

- Set `title` on the current branch element when rendering and when status refresh changes branch.
- Add checkbox `aria-label` in session management mode.
- Increase the remove button clickable box while preserving compact visual treatment.

**Step 3: Verify**

Run:

```powershell
node --test tests\daily-board-ui-regression.test.mjs tests\mention-token-remove-width-regression.test.mjs
```

Expected: PASS.

---

## Task 4: CSS Source-of-Truth Cleanup

**Owner:** Worker 4, after Tasks 1-3 have landed.

**Files:**
- Modify: `styles.css`
- Modify: `tests/design-guidelines-regression.test.mjs`
- Modify: `tests/daily-board-ui-regression.test.mjs`

**Step 1: Write failing tests**

Extend the existing "core design selectors have one source of truth" guard to cover:

- `.friday-ai-session-drawer`
- `.friday-ai-session-item`
- `.friday-mention-dropdown`

Run:

```powershell
node --test tests\design-guidelines-regression.test.mjs tests\daily-board-ui-regression.test.mjs
```

Expected: FAIL because the selectors currently have multiple top-level definitions.

**Step 2: Consolidate carefully**

- Preserve final Native Kit live visual behavior.
- Remove or merge obsolete earlier definitions.
- Keep specificity sufficient for live workbench rules without `!important` expansion.

**Step 3: Verify**

Run:

```powershell
node --test tests\design-guidelines-regression.test.mjs tests\daily-board-ui-regression.test.mjs
```

Expected: PASS.

---

## Task 5: Final Integration and Verification

**Owner:** Controller.

**Files:**
- Review all touched files.

**Step 1: Run targeted UI tests**

```powershell
node --test tests\daily-board-ui-regression.test.mjs tests\settings-project-ui-regression.test.mjs tests\soul-lab-template-regression.test.mjs tests\design-guidelines-regression.test.mjs tests\mention-token-remove-width-regression.test.mjs
```

Expected: PASS.

**Step 2: Run broader checks**

```powershell
npx tsc -noEmit -skipLibCheck
git diff --check
```

Expected: TypeScript exits 0. `git diff --check` has no whitespace errors; line-ending warnings are acceptable only if they are the existing Windows LF/CRLF warnings already observed.

**Step 3: Review final diff**

```powershell
git diff -- src/settings src/ui src/views src/core/editor/mention styles.css tests docs/plans
```

Expected: Only display UX, accessibility, regression tests, and this plan are changed.

## Execution Order

1. Dispatch Explorer A, B, and C in parallel.
2. While explorers run, write the plan and inspect current dirty-file overlap.
3. Start Worker 1 after plan is stable.
4. Start Worker 2 only after Worker 1's `styles.css` changes are integrated.
5. Worker 3 can run in parallel with Worker 1 only if Worker 3 avoids the same `styles.css` blocks; otherwise run after Worker 1.
6. Run Worker 4 last because it depends on the final selector shape.
7. Controller performs final verification and reports remaining risk.
