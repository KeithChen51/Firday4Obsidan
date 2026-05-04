# Agent Process UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fully redesign FRIDAY's Agent process display in the Obsidian chat UI on top of Batch K's `AgentTrajectorySnapshot`, making the process visibility closer to mature Agent products such as Codex and Manus while staying Obsidian-native.

**Architecture:** Kernel v2 and trajectory projection remain the fact sources. Batch L only rebuilds the UI presentation layer: add a trajectory-to-process-view-model adapter, rewrite the renderer and CSS, and keep Daily Board consuming `AgentTrajectorySnapshot`. The existing `friday-runtime-card` DOM/CSS primary path may be replaced, but execution semantics must not move back into UI code.

**Tech Stack:** TypeScript, Obsidian DOM APIs, `AgentTrajectorySnapshot`, DailyBoardView, `styles.css`, Node test runner, DOM fake tests, static CSS/architecture tests.

---

## Counterpart Document

Chinese counterpart: `docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md`

If implementation changes tasks, file paths, acceptance criteria, out-of-scope boundaries, or UI information architecture, update both documents.

## Background

Batch K established the required foundation:

```text
Kernel v2
  -> AgentTrajectorySnapshot
  -> DailyBoardView
  -> renderAgentTrajectoryCard()
```

FRIDAY now has the fact source required for process UI. The current UI is still a minimum migration shape:

- `src/views/agentTrajectoryRenderer.ts` is still a simple card: title, summary, stage rail, latest 10 timeline items, and action buttons.
- `styles.css` still carries the old `friday-runtime-*` "tool execution summary" idea.
- Collapsed state only shows the last 3 pills, so users cannot quickly answer "what is happening, why did it stop, what do I need to do?"
- Expanded state lacks the information hierarchy mature Agents usually provide: current state, stage progress, action area, evidence/tools, failure recovery, completed replay.
- The visual layer works, but it does not yet feel like a credible long-running work Agent.

The user explicitly allowed replacing the current process UI. Batch L therefore is not incremental polish of the old card; it may rewrite the renderer, CSS, and UI tests.

Batch L should be implemented after Batch M.1. It consumes M.1 transport trajectory facts and renders reconnecting/retrying states, but it must not invent network state locally and must not claim checkpoint resume. If M.1 is not complete, Batch L must either stop or explicitly skip transport UI with a documented follow-up.

## Product Direction

Batch L should build an **Obsidian-native Agent process panel**, not a general Coding Agent console.

The Manus reference adds one core product rule: **not every answer should show a full process UI**.

Use Manus only as a structural reference for process disclosure. Do not encode the screenshot's concrete business content into FRIDAY's framework: no resume-specific sections, Notion-specific wording, contact-info concepts, or any other sample task details should become product concepts, types, labels, tests, or fixtures.

- If the user question can be answered directly, FRIDAY only needs a lightweight live state such as "FRIDAY is thinking", then the final answer.
- If the question is decomposed into executable work, or enters memory lookup, tool calls, file changes, approval, or recovery, then show the step-by-step process.
- Inside the stepped process, memory, tool calls, evidence, mutations, and recovery details should be expandable/collapsible per step.
- Simple answers should not leave behind a completed "tool execution record" panel.

Visual and interaction direction:

- Quiet, dense, credible, like an internal Obsidian work record rather than a marketing page or standalone IDE.
- Collapsed view must answer: what state FRIDAY is in, what the key current activity is, and whether the user needs to act.
- Expanded view must answer: what it has inspected, what tools it called, why it stopped, what files/changes are involved, and what can happen next.
- Completed disclosure should feel like a replay summary, not temporary logs.
- Waiting approval, waiting user, failure, cancellation, safe stop, mutation conflict, and apply failure must all have clear but restrained states.
- Network retry/reconnect states from Batch M.1 must be visible as process states: requesting model, reconnecting, retrying after gateway instability, or transport retry exhausted.

Do not pursue:

- Pixel-level Codex / Manus cloning.
- Large gradients, glassmorphism, decorative motion.
- Turning the Obsidian chat area into an IDE terminal.

## Mature Product References

Use Codex / Manus / opencode / hermes-agent for these principles:

0. **Classify complexity first**: direct Q&A only shows a short thinking state; task-like work enters the process panel.
1. **The process is a readable trajectory**: users scan it instead of reading debug logs.
2. **Current state comes first**: live execution prioritizes "what is happening now" and "do I need to intervene?"
3. **Stages are navigation, not decoration**: the stage strip helps locate context / reasoning / tools / review / finalize.
4. **Tool calls have semantic summaries**: do not only show tool names; show target and result.
5. **Actions bind to state**: retry/cancel/apply/reject/continue appear near the relevant state.
6. **Failures include recovery**: failure is "what happened, whether it is retryable, what to do next," not just red text.
7. **Completed turns are reviewable**: completed disclosure rebuilds from replay and keeps key evidence.

## NOT in Scope

- Do not change Kernel v2, `AgentLoopController`, `AgentTaskManager`, `AgentReplayRecorder`, or `AgentMutationCoordinator` ownership.
- Do not change core `AgentTrajectorySnapshot` business semantics unless the UI needs a very small display helper field and tests prove it is necessary.
- Do not add Wiki/RAG/MCP/background/multi-agent.
- Do not add Build capability or turn FRIDAY into a general Coding Agent.
- Do not rewrite the global theme system.
- Do not hand-edit release artifacts; `release/` generated files are handled only by existing release/build flows.
- Do not introduce a new frontend framework, image assets, or network dependency.

## What Already Exists

| Capability | File | Batch L usage |
| --- | --- | --- |
| Trajectory contract | `src/core/trajectory/AgentTrajectory.ts` | Keep as UI input; do not change execution semantics. |
| Projection | `src/core/trajectory/AgentTrajectoryProjector.ts` | Do not rewrite; consume snapshot. |
| Live store | `src/core/trajectory/LiveTrajectoryStore.ts` | Do not rewrite; provides live snapshot. |
| Daily Board wiring | `src/views/DailyBoardView.ts` | Keep entry point; replace renderer output. |
| Current renderer | `src/views/agentTrajectoryRenderer.ts` | May be rewritten or replaced by a new process panel renderer. |
| Styles | `styles.css` | Add `friday-agent-process-*` namespace and gradually stop using old `friday-runtime-*` as the primary path. |
| Tests | `tests/daily-board-agent-trajectory-ui.test.mjs` | Update to the new UI contract. |
| Boundary tests | `tests/agent-trajectory-boundary.test.mjs` | Keep: UI must not re-own runtime phase switch. |

## UI Information Architecture

The target DOM can move to the `friday-agent-process-*` namespace:

```text
friday-agent-process
  header
    status mark
    title / current headline
    compact summary
    primary action slot
    expand toggle
  body
    stage nav
    current focus row
    timeline
      grouped event rows
    evidence strip
    mutation / review strip
    recovery panel
```

UI must first distinguish three presentation modes:

```text
simple_thinking
  For direct-answer questions; only show a lightweight "FRIDAY is thinking" live state.

stepped_process
  For task-like work; show steps, tools, evidence, memory, mutations, approvals, and recovery.

completed_replay
  For replay after task completion; collapsed by default, expandable for key process details.
```

Collapsed state:

```text
[status] Retrieving notes                  [Cancel] [Details]
        Read 2 files, organizing evidence
        Read: Notes/A.md  Search: project
```

Expanded state:

```text
FRIDAY is working
New evidence found; deciding the next step

Context -> Reasoning -> Tools -> Review -> Finalize

Current
  Reading Notes/today.md

Timeline
  ✓ Loaded project rules
  ✓ Reasoned step 1
  ✓ Searched current project
  → Reading Notes/today.md

Evidence
  Notes/today.md  project search  step 2

Action
  Cancel / Retry / Apply / Reject / Continue
```

Generic step group structure:

```text
✓ Step title generated from the current task        [collapse]
    Context or memory used                          [expand]
    Tool or evidence summary
    Result or next action summary

→ Next step title generated from the task           [expand]
    Context or memory used
```

Status priority:

1. waiting_for_approval / waiting_for_user
2. failed / cancelled / safe_stopped
3. running
4. completed
5. idle

## Visual Guidelines

Batch L's visual direction is **quiet operational Obsidian panel**:

- Use Obsidian CSS variables: `--background-secondary`, `--background-modifier-border`, `--text-muted`, `--interactive-accent`, and related variables.
- No broad gradients, glow, or decorative graphics.
- Border radius should stay within the existing Obsidian feel; do not nest cards inside the process panel.
- State colors should be restrained: running uses accent, waiting uses warning/accent, failed uses error, completed uses success or muted green.
- Text hierarchy should stay compact: title, summary, row title, meta.
- Action buttons use native Obsidian button styles; only one primary action, others ghost/secondary.
- Timeline rows must remain stable and not shift layout due to long text.
- On narrow panes: stage navigation may scroll horizontally, timeline stays single-column, action slot wraps.

## Interaction Guidelines

- Collapsed is the default and should not consume too much chat space.
- Live running collapsed view shows current focus + latest evidence.
- Expanded view shows the full process panel, but initially only a bounded number of rows; use progressive reveal such as "Show all" if needed.
- Completed disclosure is collapsed by default; users open it to inspect replay.
- Action buttons must come from `snapshot.actions`; renderer does not decide business availability.
- Disabled actions must have title/aria reason.
- Toggle must have `aria-expanded`.
- Process panel must be keyboard reachable; do not simulate buttons with divs.

## Suggested File Structure

The existing renderer may be replaced. Recommended minimal additions:

- Create: `src/views/agentProcessPanelViewModel.ts`
- Replace or heavily modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `styles.css`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Create: `tests/agent-process-panel-view-model.test.mjs`
- Create: `tests/agent-process-panel-style-regression.test.mjs`
- Read: `docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md`
- Read: `docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md`

Do not add more than two production logic files. Recommended flow:

```text
AgentTrajectorySnapshot
  -> buildAgentProcessPanelViewModel()
  -> renderAgentTrajectoryCard()
  -> styles.css
```

`buildAgentProcessPanelViewModel()` only organizes display:

- status label
- tone
- current item
- visible timeline
- evidence chips
- action groups
- empty/completed/waiting/failure display metadata

It must not:

- decide whether a tool can execute.
- infer whether retry/apply/reject is allowed.
- read files, read replay, or access runtime service.
- interpret `RuntimeProgressEvent.phase`.

## View Model Draft

```ts
export interface AgentProcessPanelViewModel {
	mode: "simple_thinking" | "stepped_process" | "completed_replay";
	status: AgentProcessStatusView;
	header: {
		label: string;
		headline: string;
		summary: string;
	};
	current: AgentProcessTimelineItemView | null;
	stages: AgentProcessStageView[];
	stepGroups: AgentProcessStepGroupView[];
	timeline: AgentProcessTimelineItemView[];
	evidence: AgentProcessEvidenceView[];
	mutations: AgentProcessMutationView[];
	actions: AgentProcessActionView[];
	recovery: AgentProcessRecoveryView | null;
	isEmpty: boolean;
}
```

Design principles:

- View model may group, truncate, sort, and generate display labels from `AgentTrajectoryItem`.
- View model must identify simple answer / stepped process / completed replay.
- Simple-answer live UI only shows lightweight thinking and does not render the full process panel.
- Stepped process organizes context/model/tool/mutation/approval/failure into expandable step groups.
- View model does not change snapshot facts.
- Renderer only renders the view model and avoids complex branching.
- Tests should cover view model states instead of relying on visual snapshots.

## Implementation Tasks

### Task L0: Preflight and visual baseline

**Files:**

- Read: `src/views/agentTrajectoryRenderer.ts`
- Read: `src/views/DailyBoardView.ts`
- Read: `styles.css`
- Read: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Read: `tests/agent-trajectory-boundary.test.mjs`

**Step 1: Confirm branch and cleanliness**

```powershell
git status --short --branch
git log --oneline -n 8
```

Expected: worktree clean before starting.

**Step 2: Run current UI/K trajectory gates**

```powershell
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs
```

Expected: all pass.

**Step 3: Inspect current runtime styles**

```powershell
Select-String -Path 'styles.css' -Pattern 'friday-runtime-card|friday-runtime-stage|friday-runtime-entry|friday-ai-runtime-preview'
```

Expected: identify old runtime CSS blocks to replace or deprecate.

### Task L1: Write view model tests

**Files:**

- Create: `tests/agent-process-panel-view-model.test.mjs`
- Create later: `src/views/agentProcessPanelViewModel.ts`

**Step 1: Add failing tests**

Cover:

- simple answer running snapshot returns `mode: "simple_thinking"` and no heavy step panel.
- running snapshot exposes current item, compact summary, cancel action.
- waiting approval snapshot prioritizes approval state and action/reason.
- failed snapshot exposes recovery panel and retry action when retryable.
- transport retry snapshot exposes reconnecting state, attempt/backoff summary, and no false checkpoint-resume claim.
- completed snapshot exposes replay-style summary and evidence strip.
- mutation conflict/apply_failed snapshot exposes review/mutation strip.
- tool/memory/context-rich task snapshot returns `mode: "stepped_process"` and step groups.
- long timeline is grouped/truncated deterministically.

**Step 2: Run failure**

```powershell
node --test tests/agent-process-panel-view-model.test.mjs
```

Expected: FAIL because file does not exist.

### Task L2: Implement `agentProcessPanelViewModel`

**Files:**

- Create: `src/views/agentProcessPanelViewModel.ts`
- Modify: `tests/agent-process-panel-view-model.test.mjs`

**Step 1: Implement pure view model builder**

Suggested API:

```ts
export function buildAgentProcessPanelViewModel(
	snapshot: AgentTrajectorySnapshot | null,
	options?: {
		maxCollapsedItems?: number;
		maxExpandedItems?: number;
	}
): AgentProcessPanelViewModel;
```

**Step 2: Derive display sections**

Derive:

- `mode`
- `status.tone`
- `header.label`
- `current`
- `stages`
- `stepGroups`
- `timeline`
- `evidence`
- `mutations`
- `actions`
- `recovery`

**Step 3: Preserve action authority**

Copy `snapshot.actions`; do not decide business availability in renderer.

**Step 4: Run tests**

```powershell
node --test tests/agent-process-panel-view-model.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/views/agentProcessPanelViewModel.ts tests/agent-process-panel-view-model.test.mjs
git commit -m "feat: add agent process panel view model"
```

### Task L3: Rewrite renderer around process panel

**Files:**

- Modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`

**Step 1: Replace runtime-card DOM**

Primary classes should become:

- `friday-agent-process`
- `friday-agent-process-thinking`
- `friday-agent-process-header`
- `friday-agent-process-status`
- `friday-agent-process-current`
- `friday-agent-process-step`
- `friday-agent-process-stages`
- `friday-agent-process-timeline`
- `friday-agent-process-evidence`
- `friday-agent-process-mutations`
- `friday-agent-process-actions`
- `friday-agent-process-recovery`

Old `friday-runtime-card` classes may remain only as temporary compatibility if tests prove needed, but they should not be the primary DOM contract.

**Step 2: Render collapsed state**

Collapsed view must render:

- status mark
- headline
- summary
- current item or latest meaningful item
- primary available action if present
- details toggle

For `simple_thinking`, collapsed view should render only a lightweight thinking row and should not show stage navigation, evidence, mutation strip, or completed replay.

**Step 3: Render expanded state**

Expanded view must render:

- stage navigation
- current focus row
- collapsible step groups
- timeline rows
- evidence strip when evidence exists
- mutation/review strip when mutations exist
- recovery panel when failure exists
- transport/reconnecting row when transport items exist
- action row

**Step 4: Add accessibility attributes**

- Toggle: `aria-expanded`
- Buttons: `type="button"`
- Disabled buttons: `title` and `aria-disabled` or `disabled`
- Process panel: `data-status`

**Step 5: Run tests**

```powershell
node --test tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/views/agentTrajectoryRenderer.ts tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "refactor: redesign agent process renderer"
```

### Task L4: Replace process UI styles

**Files:**

- Modify: `styles.css`
- Create: `tests/agent-process-panel-style-regression.test.mjs`

**Step 1: Write style regression tests**

Tests should assert:

- new `friday-agent-process-*` classes exist.
- lightweight `friday-agent-process-thinking` exists.
- no nested card pattern is introduced for process panel.
- process panel uses Obsidian variables.
- reduced motion media query exists if transitions are added.
- old `friday-runtime-card` is not required by renderer tests.

**Step 2: Implement CSS**

CSS should cover:

- compact header layout
- status tones
- stage navigation
- timeline rows and current row
- evidence/mutation chips
- recovery panel
- action row
- responsive narrow width layout
- focus-visible states
- reduced motion

**Step 3: Avoid visual anti-patterns**

Do not add:

- nested cards
- decorative blobs
- large gradients
- glassmorphism
- excessive shadows
- hero-scale text

**Step 4: Run style tests**

```powershell
node --test tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add styles.css tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "style: redesign agent process panel"
```

### Task L5: Wire DailyBoard details and action behavior

**Files:**

- Modify: `src/views/DailyBoardView.ts`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`

**Step 1: Keep DailyBoard thin**

DailyBoard should still only pass:

- snapshot
- expanded
- action handler
- translator
- avatar renderer

It should not build display sections itself.

**Step 2: Improve expansion behavior**

Requirements:

- live running defaults collapsed unless user expanded.
- waiting/failure states may auto-expand only if existing UX supports it without surprise; otherwise show action prominently collapsed.
- completed disclosure remains collapsed by default.

**Step 3: Preserve action plumbing**

`handleTrajectoryAction()` should remain the only DailyBoard action bridge.

**Step 4: Run tests**

```powershell
node --test tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/views/DailyBoardView.ts tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "refactor: keep daily board process ui snapshot-driven"
```

### Task L6: Regression and full verification

**Files:**

- No required code changes.

**Step 1: Run focused suite**

```powershell
node --test tests/agent-process-panel-view-model.test.mjs tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: PASS.

**Step 2: Run integration gates**

```powershell
node --test tests/daily-board-agent-task-ui-regression.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: PASS.

**Step 3: Run lint/full suite**

```powershell
npm run lint
npm test
git diff --check
git status --short --branch
```

Expected:

- lint passes.
- full tests pass.
- no whitespace errors.
- no unexpected release artifacts or generated files remain dirty.

## Acceptance Criteria

Batch L is complete only when:

- Process UI primary DOM uses the new process panel structure, not the old runtime-card structure.
- DailyBoard still consumes `AgentTrajectorySnapshot`; no runtime phase switch returns.
- Renderer may be fully rewritten, but it remains snapshot-driven.
- Simple direct-answer turns show only lightweight "FRIDAY is thinking" live state and do not leave a heavy completed process panel.
- Task-like turns show a stepped process with collapsible groups for memory/context/tools/evidence/mutations.
- Manus-derived structure remains generic: no resume, Notion, contact-info, or other screenshot sample content is hard-coded into product labels, types, tests, or fixtures.
- Collapsed view clearly shows status, current activity, summary, and available primary action.
- Expanded view shows stage navigation, current focus, timeline, evidence, mutation/review, recovery, and actions.
- Waiting approval/user, failed, cancelled, safe_stopped, completed, and running states have explicit visual coverage.
- Network reconnecting/retrying/exhausted transport states from Batch M.1 have explicit visual and test coverage.
- Retry/cancel/continue/apply/reject/view replay actions render from `snapshot.actions`.
- CSS is Obsidian-native, responsive, accessible, and avoids nested card/decorative patterns.
- Existing Kernel v2, trajectory, DailyBoard task UI, and replay tests continue to pass.

## Test Matrix

```text
Behavior / UI area                         Required test
-----------------------------------------  ----------------------------------------------
Snapshot -> process view model             tests/agent-process-panel-view-model.test.mjs
Simple answer thinking mode                tests/agent-process-panel-view-model.test.mjs
Running collapsed state                    tests/daily-board-agent-trajectory-ui.test.mjs
Waiting approval prominent state           tests/daily-board-agent-trajectory-ui.test.mjs
Failed recovery panel                      tests/daily-board-agent-trajectory-ui.test.mjs
Network reconnecting state                 tests/agent-process-panel-view-model.test.mjs + tests/daily-board-agent-trajectory-ui.test.mjs
Completed replay disclosure                tests/daily-board-agent-trajectory-ui.test.mjs
Collapsible step groups                     tests/daily-board-agent-trajectory-ui.test.mjs
Mutation conflict/apply_failed strip        tests/agent-process-panel-view-model.test.mjs
Action rendering from snapshot.actions      tests/daily-board-agent-trajectory-ui.test.mjs
CSS namespace and Obsidian variables        tests/agent-process-panel-style-regression.test.mjs
No UI-owned runtime phase switch            tests/agent-trajectory-boundary.test.mjs
Kernel/trajectory regression                existing Batch K focused suite
```

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Simple answer gets heavy process panel | chat feels noisy and overbuilt | simple thinking mode test |
| Task work lacks step grouping | user cannot follow multi-step work | step group rendering test |
| Renderer reintroduces business logic | UI and Kernel disagree on actions | action test + boundary review |
| Collapsed view hides approval need | user misses required action | waiting approval collapsed test |
| Failed state lacks recovery | user sees error but no next step | failed recovery panel test |
| Completed replay looks like live running | user cannot distinguish history from current work | completed variant test |
| Long timeline overwhelms chat | poor scanability | truncation/grouping test |
| CSS breaks narrow panes | Obsidian side panes become unusable | responsive CSS test |
| Old runtime classes remain primary contract | redesign is superficial | DOM contract test |

## Development Prompt

Use this in a new implementation window:

```text
You are working in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule.

Goal: implement Batch L: Agent Process UI Redesign.

Read first:
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

Key requirements:
- This batch may replace the current process UI; do not merely polish the old friday-runtime-card.
- Follow the Manus structural reference only: simple direct answers show lightweight "FRIDAY is thinking"; task-like work shows expandable/collapsible steps. Do not copy or encode the screenshot's concrete resume/Notion/contact-info content.
- Only rebuild the trajectory-driven presentation layer.
- Do not change Kernel v2 ownership and do not reinterpret RuntimeProgressEvent.phase.
- DailyBoard continues to pass only AgentTrajectorySnapshot, expanded state, action handler, translator, and avatar renderer.
- You may add src/views/agentProcessPanelViewModel.ts.
- You may rewrite src/views/agentTrajectoryRenderer.ts.
- You may add friday-agent-process-* CSS and make it the primary DOM/CSS contract.
- Must support step groups: each execution step can expand/collapse memory, tool calls, evidence, and mutation details.
- Must render Batch M.1 transport trajectory facts as reconnecting/retrying/exhausted process states. Do not claim checkpoint resume in Batch L.
- Do not add Wiki/RAG/MCP/Build/background/multi-agent.
- Do not pixel-clone Codex/Manus; build an Obsidian-native process panel.

Before starting, run:
git status --short --branch
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs

Use TDD task by task: write failing test, implement, run focused test, commit.

When done, run:
node --test tests/agent-process-panel-view-model.test.mjs tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

Final output:
- changed files;
- how UI information architecture changed;
- whether it remains snapshot-driven;
- test results;
- remaining risks.
```

## Review Prompt

Use this in a separate verification window:

```text
You are doing read-only verification in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule. Do not change code unless I explicitly ask you to fix something.

Goal: verify whether Batch L: Agent Process UI Redesign is complete.

Acceptance source:
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md

Check:
1. src/views/agentProcessPanelViewModel.ts or an equivalent view model layer exists.
2. src/views/agentTrajectoryRenderer.ts changed from the old runtime-card mini card into a new process panel renderer.
3. The primary DOM/CSS contract is friday-agent-process-*, not friday-runtime-card.
4. DailyBoardView still only passes snapshot/expanded/action/translator/avatar and does not reinterpret RuntimeProgressEvent.phase.
5. Collapsed view shows status/current activity/summary/primary action.
6. Simple direct answers only show lightweight thinking state and do not leave a heavy completed process panel.
7. Task-like work shows expandable/collapsible step groups, and each step can contain memory, tool calls, evidence, and mutation details. Verify the implementation does not hard-code Manus screenshot sample content such as resume sections, Notion labels, contact info, or work-experience wording.
8. Expanded view shows stage/current/timeline/evidence/mutation/recovery/actions.
9. Network reconnecting/retrying/exhausted states from Batch M.1 are rendered from trajectory items, not locally inferred from UI timers.
10. waiting approval/user, failed, cancelled, safe_stopped, completed, running have test coverage.
11. Actions still come from snapshot.actions; renderer does not decide business availability.
12. CSS is Obsidian-native, responsive, accessible, and has no nested card/decorative blob/glassmorphism.
13. No Wiki/RAG/MCP/Build/background/multi-agent work was mixed in.

Run:
git status --short --branch
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts | Select-String -Pattern 'buildRuntimeExecutionState|RuntimeExecutionState|case "tool_call"|case "model_request"'
Select-String -Path 'src\views\agentTrajectoryRenderer.ts','styles.css' -Pattern 'friday-agent-process|friday-runtime-card'
node --test tests/agent-process-panel-view-model.test.mjs tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check

Output format:
Verdict: PASS / PASS_WITH_CONCERNS / FAIL
Branch / HEAD:
Worktree:
Evidence:
UI contract:
Test results:
P0 issues:
P1 issues:
P2 issues:
Conclusion:
```
