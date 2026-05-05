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

- If the user question can be answered directly, FRIDAY only needs a lightweight live state such as `FRIDAY 思考中`, then the final answer.
- If the question is decomposed into executable work, or enters memory lookup, tool calls, file changes, approval, or recovery, then show the step-by-step process.
- Inside the stepped process, memory, tool calls, evidence, mutations, and recovery details should be expandable/collapsible per step.
- Simple answers should not leave behind a completed "tool execution record" panel.
- Lifecycle cards are not a product surface. Task lifecycle records remain internal facts; the UI should not show bulky "task running / completed / final delivered" cards by default.

Visual and interaction direction:

- Quiet, dense, credible, like an internal Obsidian work record rather than a marketing page or standalone IDE.
- Collapsed view must answer: what state FRIDAY is in, what the key current activity is, and whether the user needs to act.
- Expanded view must answer: what it has inspected, what tools it called, why it stopped, what files/changes are involved, and what can happen next.
- Completed disclosure should feel like a replay summary, not temporary logs.
- Waiting approval, waiting user, failure, cancellation, safe stop, mutation conflict, and apply failure must all have clear but restrained states.
- Network retry/reconnect states from Batch M.1 must be visible as process states: requesting model, reconnecting, retrying after gateway instability, or transport retry exhausted.

## Answer, Process, and Artifact Display Contract

Batch L must redesign the answer area as three coordinated surfaces:

1. **Answer surface**
   - The final assistant answer is always the primary content.
   - For simple direct answers, this is the only persistent content.
   - The answer surface must not be pushed down by a completed lifecycle card.
   - Assistant answers should render as document flow, not as a large assistant bubble. User messages may keep the current bubble treatment.

2. **Process surface**
   - The process surface is temporary or secondary.
   - It appears only when it helps the user understand ongoing work, required action, recovery, or later audit.
   - It must be visually lighter than the answer and default to compact/collapsed states.
   - The process surface appears before the final answer when visible. If expanded, it opens in place before the answer body.

3. **Artifact surface**
   - The artifact surface appears after the final answer and shows concrete files created or changed by the turn.
   - It is result UI, not process UI. The process may say "changed 2 files," but clickable file cards and diff summaries belong here.
   - It is hidden when no file was created or modified.

Display rules:

| Situation | During answer | After answer |
| --- | --- | --- |
| Simple direct answer | Inline "FRIDAY 思考中" only | No process panel, no completed replay, no lifecycle card |
| Model-only answer with no tools/retries | Inline thinking only | No process panel |
| Tool/file/context work | Compact process strip with current action and Details toggle | Final answer first; collapsed replay entry below/near answer |
| Network retry/reconnect | Compact reconnecting row from M.1 trajectory facts | If recovered, replay remains collapsed; if exhausted, show compact recovery |
| Waiting approval/user | Compact action-required row, optionally expanded | Action-required row remains until resolved |
| Failure/recoverable stop | Compact recovery row with retry/resume action | Recovery row remains; final answer only if one exists |
| Mutation review | Compact review row with apply/reject | Review row remains until applied/rejected |

The implementation must explicitly suppress lifecycle-only cards:

- Do not render visible cards for `task_created`, `task_running`, `task_completed`, or "final answer delivered" unless they are attached to a meaningful user-facing state such as waiting, failure, recovery, mutation review, or replay.
- Do not show `completed_replay` for simple answers.
- Do not show a "process completed" card above the final answer.
- If a completed complex task has replay, show one small collapsed disclosure such as "Process replay" with a concise summary. It must default collapsed.

Identity and wording contract:

- Every FRIDAY answer row must show the FRIDAY icon.
- Do not render a separate bulky "FRIDAY" label above the process. The process disclosure row becomes the identity/header line.
- While generating a simple answer, show: `[FRIDAY icon] FRIDAY 思考中`.
- After a simple or model-only answer, the transient thinking row disappears; the final answer remains as document-flow content.
- For collapsed reasoning disclosure, use: `[FRIDAY icon] FRIDAY 的思路 {duration}s >`.
- For task-like work, use: `[FRIDAY icon] FRIDAY 的工作过程 {duration}s >`; expanded state uses the same label with an expanded affordance.
- Loading project rules, AGENTS instructions, skills, context reads, tool calls, model retries, and reconnection attempts all belong inside the expanded process disclosure.
- Reasoning/thinking details must be summarized, not rendered as raw chain-of-thought.

Final answer and artifact layout:

```text
[FRIDAY icon] FRIDAY 的思路 6s >

Final answer body in document flow.

本次改动

[document icon] 2026-05-04-agent-process-ui-redesign-plan.md
文档 · MD                                      [打开 ˅]

[canvas icon] Project Map.canvas
画布 · Canvas                                  [打开 ˅]

2 个文件已修改  +298 -34
docs/plans/agent-process-ui-redesign-plan.md    +149 -17    [expand]
docs/maps/project-map.canvas                     +149 -17    [expand]
```

File artifact requirements:

- The section title is `本次改动` for created/modified/applied files.
- If the product later adds read-only references, they should use a separate label such as `参考文件`; do not mix read-only references into `本次改动`.
- Each file row must show type-aware metadata such as `文档 · MD` or `画布 · Canvas`.
- The primary action label is `打开`. It must open the target vault file inside the Obsidian workspace, not in the operating system file manager.
- `.md` files open as Markdown notes; `.canvas` files open as Obsidian Canvas files; other vault files should use Obsidian's native file opening path when supported.
- The dropdown may include `查看差异`, `在文件夹中定位`, and `复制 Obsidian 链接` if those actions are available.
- Pending mutation review is not a completed artifact. Before apply/reject, show it as `action_required` or mutation review UI. After apply/reject, show applied file results in `本次改动`.
- Artifact metadata must come from trajectory mutations, tool target paths, replay summaries, or explicit runtime result metadata. The renderer must not scan the vault or infer changes by itself.

Recommended presentation surface values:

```ts
export type AgentProcessSurface =
	| "hidden"
	| "inline_thinking"
	| "compact_live_process"
	| "expanded_live_process"
	| "action_required"
	| "compact_recovery"
	| "collapsed_completed_replay";
```

Recommended trigger reasons:

```ts
export type AgentProcessTriggerReason =
	| "tool_activity"
	| "context_activity"
	| "memory_activity"
	| "mutation_review"
	| "approval_required"
	| "user_input_required"
	| "transport_retry"
	| "failure_recovery"
	| "long_running"
	| "completed_audit";
```

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

The answer/result DOM should be separate from the process namespace:

```text
friday-ai-message-row is-assistant
  friday-ai-answer-flow
    friday-ai-answer-content
    friday-agent-artifacts
      friday-agent-artifacts-title        ("本次改动")
      friday-agent-artifact-card          (created/modified file)
        icon
        filename
        metadata                          ("文档 · MD", "画布 · Canvas")
        open button                       ("打开")
      friday-agent-artifact-diff-summary
        changed file rows
```

The process renderer may render the process disclosure, but file artifact cards should be rendered with the final answer or an explicit result-artifact renderer. Do not make file cards children of an expanded process step; otherwise they become audit logs instead of usable results.

UI must first distinguish three presentation modes:

```text
simple_thinking
  For direct-answer questions; only show a lightweight "FRIDAY 思考中" live state.

stepped_process
  For task-like work; show steps, tools, evidence, memory, mutations, approvals, and recovery.

completed_replay
  For replay after task completion; collapsed by default, expandable for key process details.
```

Collapsed state:

```text
[FRIDAY icon] FRIDAY 的工作过程 58s >        [Cancel]
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
- Lifecycle cards should be removed from the primary path. The replacement should be a compact row/strip/disclosure, not another large card.
- State colors should be restrained: running uses accent, waiting uses warning/accent, failed uses error, completed uses success or muted green.
- Text hierarchy should stay compact: title, summary, row title, meta.
- Action buttons use native Obsidian button styles; only one primary action, others ghost/secondary.
- Timeline rows must remain stable and not shift layout due to long text.
- On narrow panes: stage navigation may scroll horizontally, timeline stays single-column, action slot wraps.

## Interaction Guidelines

- Collapsed is the default and should not consume too much chat space.
- Hidden is the default for simple completed answers.
- Inline thinking is allowed only while a simple answer is being generated; it disappears after completion.
- Live running collapsed view shows current focus + latest evidence.
- Expanded view shows the full process panel, but initially only a bounded number of rows; use progressive reveal such as "Show all" if needed.
- Completed disclosure is collapsed by default and only exists for complex work with meaningful replay.
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
- process visibility gates
- completed replay visibility gates
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
	surface: AgentProcessSurface;
	shouldRenderProcessPanel: boolean;
	shouldRenderLifecycleCard: false;
	shouldRenderCompletedReplay: boolean;
	completedReplayDefaultExpanded: false;
	triggerReasons: AgentProcessTriggerReason[];
	status: AgentProcessStatusView;
	header: {
		label: string;
		headline: string;
		summary: string;
		icon: "friday";
		disclosureLabel: "FRIDAY 思考中" | "FRIDAY 的思路 {duration}s" | "FRIDAY 的工作过程 {duration}s";
	};
	current: AgentProcessTimelineItemView | null;
	stages: AgentProcessStageView[];
	stepGroups: AgentProcessStepGroupView[];
	timeline: AgentProcessTimelineItemView[];
	evidence: AgentProcessEvidenceView[];
	mutations: AgentProcessMutationView[];
	resultArtifacts: AgentResultArtifactView[];
	diffSummary: AgentResultDiffSummaryView | null;
	actions: AgentProcessActionView[];
	recovery: AgentProcessRecoveryView | null;
	isEmpty: boolean;
}

export interface AgentResultArtifactView {
	id: string;
	path: string;
	name: string;
	kind: "markdown" | "canvas" | "other";
	status: "created" | "modified" | "applied" | "conflicted" | "failed";
	metadataLabel: string; // e.g. "文档 · MD", "画布 · Canvas"
	openLabel: "打开";
	canOpenInWorkspace: boolean;
}

export interface AgentResultDiffSummaryView {
	fileCount: number;
	additions?: number;
	deletions?: number;
	files: Array<{
		path: string;
		additions?: number;
		deletions?: number;
	}>;
}
```

Design principles:

- View model may group, truncate, sort, and generate display labels from `AgentTrajectoryItem`.
- View model must identify simple answer / stepped process / completed replay.
- Simple-answer live UI only shows lightweight thinking and does not render the full process panel.
- Simple-answer completed UI renders no process surface and no completed replay.
- Lifecycle-only task events do not create visible lifecycle cards.
- Completed replay is shown only when trigger reasons prove meaningful work happened.
- Stepped process organizes context/model/tool/mutation/approval/failure into expandable step groups.
- File artifact display is result metadata, not process metadata. It belongs in `resultArtifacts` / `diffSummary` and renders after the answer body.
- `resultArtifacts` must be derived from existing trajectory/runtime facts; the view model may classify file type by extension, but it must not touch the vault.
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
- simple answer completed snapshot returns `surface: "hidden"`, `shouldRenderProcessPanel: false`, and `shouldRenderCompletedReplay: false`.
- lifecycle-only task events do not render visible lifecycle cards.
- running snapshot exposes current item, compact summary, cancel action.
- tool/file/context work returns `surface: "compact_live_process"` by default.
- tool/file/mutation work returns `resultArtifacts` for created/modified/applied vault files and a diff summary when counts are available.
- file artifact type labels classify `.md` as `文档 · MD`, `.canvas` as `画布 · Canvas`, and unsupported extensions as `文件`.
- waiting approval snapshot prioritizes approval state and action/reason.
- failed snapshot exposes recovery panel and retry action when retryable.
- transport retry snapshot exposes reconnecting state, attempt/backoff summary, and no false checkpoint-resume claim.
- completed complex task snapshot exposes collapsed replay summary and evidence strip, with final answer priority preserved.
- mutation conflict/apply_failed snapshot exposes review/mutation strip.
- pending mutation review does not render as completed `本次改动` artifacts until apply/reject has resolved it.
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

- `surface`
- `shouldRenderProcessPanel`
- `shouldRenderLifecycleCard`
- `shouldRenderCompletedReplay`
- `completedReplayDefaultExpanded`
- `triggerReasons`
- `mode`
- `status.tone`
- `header.label`
- `header.disclosureLabel`
- `current`
- `stages`
- `stepGroups`
- `timeline`
- `evidence`
- `mutations`
- `resultArtifacts`
- `diffSummary`
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
- `friday-agent-process-strip`
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
- `friday-ai-answer-flow`
- `friday-agent-artifacts`
- `friday-agent-artifact-card`
- `friday-agent-artifact-diff-summary`

Old `friday-runtime-card` classes may remain only as temporary compatibility if tests prove needed, but they should not be the primary DOM contract.

**Step 2: Render hidden and inline states**

If `surface === "hidden"`:

- render nothing for process UI.
- render no lifecycle card.
- render no completed replay.

If `surface === "inline_thinking"`:

- render only a single lightweight thinking row.
- the row must include the FRIDAY icon and the label `FRIDAY 思考中`.
- do not render stage navigation, evidence, mutation strip, completed replay, or lifecycle card.
- remove this row once the answer is complete.

**Step 3: Render compact process state**

Compact process view must render:

- status mark
- FRIDAY icon
- disclosure label (`FRIDAY 的思路 {duration}s >` or `FRIDAY 的工作过程 {duration}s >`)
- headline
- summary
- current item or latest meaningful item
- primary available action if present
- details toggle

It should be a strip/row/disclosure, not a bulky card.

The compact process header replaces the old separate FRIDAY wordmark for process UI. Do not render both a standalone FRIDAY label and `FRIDAY 的思路...` in the same process header.

**Step 4: Render expanded state**

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

**Step 5: Render completed replay only when meaningful**

Completed replay must:

- never appear for simple answers.
- never appear above the final answer.
- default collapsed.
- show a small replay summary only for meaningful complex work.

**Step 6: Render result artifacts after the final answer**

The final answer renderer or DailyBoard wrapper must render `view.resultArtifacts` after the answer body:

- title: `本次改动`
- file cards for created/modified/applied vault files.
- type metadata: `文档 · MD`, `画布 · Canvas`, or a restrained fallback.
- primary `打开` button.
- optional compact diff summary with additions/deletions when available.
- no artifact section for simple answers with no changed files.
- no pending mutation review artifacts before apply/reject resolves.

**Step 7: Add accessibility attributes**

- Toggle: `aria-expanded`
- Buttons: `type="button"`
- Disabled buttons: `title` and `aria-disabled` or `disabled`
- Process panel: `data-status`
- File open buttons: `aria-label` includes the filename.

**Step 8: Run tests**

```powershell
node --test tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
```

Expected: PASS.

**Step 9: Commit**

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
- compact `friday-agent-process-strip` or equivalent row/disclosure class exists.
- assistant answer document-flow classes exist and do not require the old large assistant bubble for FRIDAY answers.
- `friday-agent-artifacts`, `friday-agent-artifact-card`, and `friday-agent-artifact-diff-summary` exist.
- no nested card pattern is introduced for process panel.
- no bulky lifecycle-card primary path remains.
- process panel uses Obsidian variables.
- reduced motion media query exists if transitions are added.
- old `friday-runtime-card` is not required by renderer tests.

**Step 2: Implement CSS**

CSS should cover:

- hidden/no-process state with no reserved whitespace.
- inline thinking row.
- assistant answer document flow without a large assistant bubble.
- compact process strip.
- compact header layout
- status tones
- stage navigation
- timeline rows and current row
- evidence/mutation chips
- recovery panel
- action row
- result artifact file cards and compact diff summary
- responsive narrow width layout
- focus-visible states
- reduced motion

**Step 3: Avoid visual anti-patterns**

Do not add:

- nested cards
- bulky lifecycle cards for normal running/completed states
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
- artifact open handler, if result artifacts are rendered outside the process renderer

It should not build display sections itself.

**Step 2: Improve expansion behavior**

Requirements:

- simple completed answers render no process UI.
- lifecycle-only task records do not render visible cards.
- live running defaults collapsed unless user expanded.
- waiting/failure states may auto-expand only if existing UX supports it without surprise; otherwise show action prominently collapsed.
- completed disclosure remains collapsed by default and only appears for complex work.
- final answer remains visually primary over completed replay.
- FRIDAY assistant answers render as document flow, while user messages may remain bubbles.
- result artifacts render after the final answer, never above it.

**Step 3: Preserve action plumbing**

`handleTrajectoryAction()` should remain the only DailyBoard action bridge.

**Step 4: Wire file artifact opening**

Requirements:

- `打开` resolves the artifact path as a vault path.
- If the file exists, open it in the Obsidian workspace through the app/workspace/vault APIs, not through the OS shell.
- `.md` and `.canvas` must both be covered by tests.
- Missing files should show a restrained notice or disabled state; do not throw from the click handler.
- The renderer may receive an `onOpenArtifact(path)` callback; it must not import Obsidian APIs directly unless the renderer already has that boundary.

**Step 5: Run tests**

```powershell
node --test tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs
```

Expected: PASS.

**Step 6: Commit**

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
- Simple direct-answer turns show only lightweight `FRIDAY 思考中` live state and do not leave a heavy completed process panel.
- Every FRIDAY answer/process row shows the FRIDAY icon.
- Collapsed process wording follows the approved labels: `FRIDAY 的思路 {duration}s >` for reasoning-only answers and `FRIDAY 的工作过程 {duration}s >` for task-like work.
- FRIDAY assistant answers render as document-flow content, not as a large assistant bubble.
- Simple completed answers render no persistent process UI, no completed replay, and no lifecycle card.
- Lifecycle-only task records such as running/completed/final-delivered do not create visible cards by themselves.
- Task-like turns show a stepped process with collapsible groups for memory/context/tools/evidence/mutations.
- Manus-derived structure remains generic: no resume, Notion, contact-info, or other screenshot sample content is hard-coded into product labels, types, tests, or fixtures.
- Collapsed view clearly shows status, current activity, summary, and available primary action.
- Expanded view shows stage navigation, current focus, timeline, evidence, mutation/review, recovery, and actions.
- Waiting approval/user, failed, cancelled, safe_stopped, completed, and running states have explicit visual coverage.
- Network reconnecting/retrying/exhausted transport states from Batch M.1 have explicit visual and test coverage.
- Completed replay is a secondary collapsed audit entry for complex work only; final answers keep visual priority.
- Created/modified/applied files render after the answer in a `本次改动` artifact section.
- File artifact cards include type-aware labels such as `文档 · MD` and `画布 · Canvas`.
- File `打开` actions open vault files inside the Obsidian workspace and cover both `.md` and `.canvas`.
- Pending mutation review is not shown as a completed artifact until apply/reject resolves.
- Retry/cancel/continue/apply/reject/view replay actions render from `snapshot.actions`.
- CSS is Obsidian-native, responsive, accessible, and avoids nested card/decorative patterns.
- Existing Kernel v2, trajectory, DailyBoard task UI, and replay tests continue to pass.

## Test Matrix

```text
Behavior / UI area                         Required test
-----------------------------------------  ----------------------------------------------
Snapshot -> process view model             tests/agent-process-panel-view-model.test.mjs
Simple answer thinking mode                tests/agent-process-panel-view-model.test.mjs
Simple completed answer hidden process      tests/agent-process-panel-view-model.test.mjs + tests/daily-board-agent-trajectory-ui.test.mjs
Lifecycle-only cards suppressed             tests/agent-process-panel-view-model.test.mjs + tests/daily-board-agent-trajectory-ui.test.mjs
Running collapsed state                    tests/daily-board-agent-trajectory-ui.test.mjs
Waiting approval prominent state           tests/daily-board-agent-trajectory-ui.test.mjs
Failed recovery panel                      tests/daily-board-agent-trajectory-ui.test.mjs
Network reconnecting state                 tests/agent-process-panel-view-model.test.mjs + tests/daily-board-agent-trajectory-ui.test.mjs
Completed replay disclosure                tests/daily-board-agent-trajectory-ui.test.mjs
Collapsible step groups                     tests/daily-board-agent-trajectory-ui.test.mjs
Mutation conflict/apply_failed strip        tests/agent-process-panel-view-model.test.mjs
Action rendering from snapshot.actions      tests/daily-board-agent-trajectory-ui.test.mjs
FRIDAY icon and approved process wording    tests/daily-board-agent-trajectory-ui.test.mjs
Assistant answer document-flow layout        tests/daily-board-agent-trajectory-ui.test.mjs + tests/agent-process-panel-style-regression.test.mjs
Result artifact view model                  tests/agent-process-panel-view-model.test.mjs
File artifact cards and diff summary         tests/daily-board-agent-trajectory-ui.test.mjs + tests/agent-process-panel-style-regression.test.mjs
Open .md/.canvas in Obsidian workspace       tests/daily-board-agent-trajectory-ui.test.mjs
CSS namespace and Obsidian variables        tests/agent-process-panel-style-regression.test.mjs
No UI-owned runtime phase switch            tests/agent-trajectory-boundary.test.mjs
Kernel/trajectory regression                existing Batch K focused suite
```

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Simple answer gets heavy process panel | chat feels noisy and overbuilt | simple thinking mode test |
| Lifecycle cards dominate normal answers | every answer feels like a task wrapper | lifecycle suppression test |
| Task work lacks step grouping | user cannot follow multi-step work | step group rendering test |
| Renderer reintroduces business logic | UI and Kernel disagree on actions | action test + boundary review |
| Collapsed view hides approval need | user misses required action | waiting approval collapsed test |
| Failed state lacks recovery | user sees error but no next step | failed recovery panel test |
| Completed replay looks like live running | user cannot distinguish history from current work | completed variant test |
| Completed replay appears above final answer | final answer loses visual priority | answer priority DOM/order test |
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
- Lifecycle cards are too bulky and must not remain as the default display. Replace them with hidden/inline/compact strip/collapsed disclosure surfaces.
- Follow the Manus structural reference only: simple direct answers show lightweight `FRIDAY 思考中`; task-like work shows expandable/collapsible steps. Do not copy or encode the screenshot's concrete resume/Notion/contact-info content.
- Simple completed answers must render no persistent process UI and no completed replay.
- Final answers must remain visually primary; completed replay is collapsed and secondary for complex work only.
- Only rebuild the trajectory-driven presentation layer.
- Do not change Kernel v2 ownership and do not reinterpret RuntimeProgressEvent.phase.
- DailyBoard continues to pass only AgentTrajectorySnapshot, expanded state, action handler, translator, and avatar renderer.
- You may add src/views/agentProcessPanelViewModel.ts.
- You may rewrite src/views/agentTrajectoryRenderer.ts.
- You may add friday-agent-process-* CSS and make it the primary DOM/CSS contract.
- Must support step groups: each execution step can expand/collapse memory, tool calls, evidence, and mutation details.
- Must render Batch M.1 transport trajectory facts as reconnecting/retrying/exhausted process states. Do not claim checkpoint resume in Batch L.
- Must show the FRIDAY icon on FRIDAY answer/process rows.
- Use the approved process labels: `FRIDAY 思考中`, `FRIDAY 的思路 {duration}s >`, and `FRIDAY 的工作过程 {duration}s >`.
- FRIDAY assistant answers should render as document flow, not as large assistant bubbles. User messages may remain bubbles.
- Render concrete created/modified/applied files after the final answer in a `本次改动` artifact section.
- File artifact cards must support `.md` and `.canvas`, show `文档 · MD` / `画布 · Canvas`, and open the vault file inside the Obsidian workspace through Obsidian APIs.
- Do not render pending mutation review as a completed file artifact before apply/reject resolves.
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
7. Simple completed answers render no persistent process UI, no completed replay, and no lifecycle card.
8. Lifecycle-only task records do not create visible running/completed/final-delivered cards.
9. Task-like work shows expandable/collapsible step groups, and each step can contain memory, tool calls, evidence, and mutation details. Verify the implementation does not hard-code Manus screenshot sample content such as resume sections, Notion labels, contact info, or work-experience wording.
10. FRIDAY icon and approved process labels render correctly: `FRIDAY 思考中`, `FRIDAY 的思路 {duration}s >`, `FRIDAY 的工作过程 {duration}s >`.
11. FRIDAY assistant answers render as document flow, not as a large assistant bubble.
12. Expanded view shows stage/current/timeline/evidence/mutation/recovery/actions.
13. Network reconnecting/retrying/exhausted states from Batch M.1 are rendered from trajectory items, not locally inferred from UI timers.
14. Completed replay is collapsed, secondary, and never above the final answer.
15. `本次改动` renders after the answer for created/modified/applied files only.
16. File artifact cards show type-aware labels, compact diff summaries, and `打开` actions.
17. `打开` opens `.md` and `.canvas` vault files in the Obsidian workspace, not in the OS file manager.
18. waiting approval/user, failed, cancelled, safe_stopped, completed, running have test coverage.
19. Actions still come from snapshot.actions; renderer does not decide business availability.
20. CSS is Obsidian-native, responsive, accessible, and has no nested card/decorative blob/glassmorphism.
21. No Wiki/RAG/MCP/Build/background/multi-agent work was mixed in.

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
