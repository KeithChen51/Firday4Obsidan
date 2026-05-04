# Agent Trajectory Projection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Agent work trajectory projection layer so FRIDAY's Obsidian chat process UI is driven by Kernel v2 execution trajectory rather than Daily Board-local progress event assembly.

**Architecture:** Kernel v2 remains the owner of execution, task, replay, mutation approval, and resume state. Batch K adds a UI-facing but non-DailyBoard-specific trajectory projection model that converts live progress, kernel replay, task lifecycle, mutation review, and failure information into `AgentTrajectorySnapshot`. Daily Board renders snapshots and no longer directly interprets `RuntimeProgressEvent` phase semantics.

**Tech Stack:** TypeScript, Obsidian plugin DOM APIs, Kernel v2 contracts, `AgentReplayRecorder`, `TurnReplayReader`, `AgentTaskManager`, `AgentMutationCoordinator`, `DailyBoardView`, Node test runner.

---

## Counterpart Document

Chinese counterpart: `docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md`

If implementation changes tasks, acceptance criteria, file paths, or out-of-scope boundaries, update both documents so English-reading agents do not receive a different plan.

## Background Diagnosis

FRIDAY can now start addressing the chat process UI, but this is not only a visual UI problem. The current code already has several low-level materials required by a mature process UI:

- `src/core/agent-kernel/AgentLoopController.ts` owns the default model/tool loop.
- `src/core/agent-kernel/AgentTaskManager.ts` manages Kernel v2 task state.
- `src/core/agent-kernel/AgentReplayRecorder.ts` records the Kernel event stream.
- `src/core/runtime/TurnReplayReader.ts` summarizes replay, tool, approval, mutation, and task timelines.
- `src/core/agent-kernel/AgentMutationCoordinator.ts` manages the review-first mutation lifecycle.
- `src/core/agent-kernel/AgentResumeController.ts` manages retry/continue at the Kernel boundary.
- `src/services/ObsidianAgentStateAdapter.ts` composes task/replay/mutation/resume into the Obsidian runtime adapter.

The UI is still not using a mature Agent process model:

- `src/views/DailyBoardView.ts` still interprets `RuntimeProgressEvent.phase` inside `buildRuntimeExecutionState(event, previous)`.
- Live state and completed disclosure are not rebuilt from the same replay/projection model.
- Process information lacks a unified identity model for `turnId`, `taskId`, `traceId`, approval, mutation, failure, and recovery actions.
- Visually, the UI can show stages and tool pills, but architecturally it is not yet the Codex / Manus pattern where the execution trajectory is the fact source and the UI only renders it.

Batch K closes this projection gap.

## Mature Product Alignment Criteria

Use Codex, Manus, opencode, and hermes-agent as references for information structure, not pixel-level appearance:

1. Single trajectory source: what the Agent did, what it is doing, why it stopped, and who must act next should come from one trajectory, not scattered task/progress/replay/mutation state.
2. Live and replay isomorphism: what the user sees during execution should be reconstructable after completion, refresh, or resume from the same snapshot class.
3. Explicit recoverable states: waiting for approval, waiting for user, retryable failure, cancellation, safe stop, and pending mutation must be first-class snapshot states.
4. Explainable tools and evidence: UI should reliably show tool name, target file, summary, and result status without exposing private raw payloads.
5. UI does not own execution semantics: Daily Board should not know how each runtime phase advances Agent state; it should render a projection.
6. Obsidian-native: FRIDAY remains focused on Obsidian work in the short term. Build ability and general Coding Agent parity are not required for this batch.

## NOT in Scope

- No Wiki/RAG/MCP/background/multi-agent features.
- No attempt to turn FRIDAY into a general Coding Agent.
- No new Build/test-runner execution capability.
- No full visual redesign, theme system rewrite, or Codex/Manus pixel clone.
- No removal of the remaining legacy runtime compatibility shell; legacy retirement continues through the retirement checklist.
- No broader Obsidian vault permissions and no new network behavior.
- No change to existing approval, apply/reject, retry/cancel/continue business semantics.

## What Already Exists

| Sub-problem | Existing capability | Batch K handling |
| --- | --- | --- |
| Execution loop | `AgentLoopController` | Consume events/progress only; do not rewrite the loop. |
| Execution identity | `AgentExecutionContext` with `turnId/taskId/traceId/budget` | Snapshot must preserve identity. |
| Replay recording | `AgentReplayRecorder` + `TurnEventLog` | Rebuild completed/reload UI from replay projection. |
| Replay summary | `TurnReplayReader.readSummary()` | Projector supports summary first, raw event records later if needed. |
| Task lifecycle | `AgentTaskManager` | Project task status into snapshot status/actions. |
| Mutation review | `AgentMutationCoordinator` | Project mutation timeline as pending/applied/rejected/conflicted. |
| Resume/retry | `AgentResumeController` | Expose retry/continue/cancel through action model. |
| Current UI | `DailyBoardView.renderRuntimeExecutionCard()` | Preserve visual skeleton; replace data source and view model. |

## Current Breakpoint

```text
+-------------------+       +-------------------------+
| Kernel v2 events  | ----> | replay/task/mutation    |
+-------------------+       +-------------------------+
          |
          | also emits RuntimeProgressEvent
          v
+-------------------+       +-------------------------+
| DailyBoardView    | ----> | RuntimeExecutionState   |
| phase switch      |       | UI-local only           |
+-------------------+       +-------------------------+
```

The problematic boundary is that Daily Board owns the interpretation from phase to process state. Mature Agent UIs should not do that.

Target after Batch K:

```text
Live path
---------
AgentKernel / AgentLoopController
  -> RuntimeProgressEvent and AgentTurnEvent evidence
  -> LiveTrajectoryStore
  -> AgentTrajectoryProjector
  -> AgentTrajectorySnapshot
  -> DailyBoard trajectory renderer

Replay path
-----------
TurnEventLog
  -> TurnReplayReader
  -> TurnReplaySummary
  -> AgentTrajectoryProjector
  -> AgentTrajectorySnapshot
  -> DailyBoard completed disclosure
```

## Target Architecture

Add the projection layer under `src/core/trajectory/`.

Reasons:

- It is not Kernel execution core, so `src/core/agent-kernel/` should not keep growing.
- It is not Daily Board-private UI logic, so other Obsidian views or task panels can reuse it later.
- It is pure TypeScript data projection and easy to test independently with the Node test runner.

Keep production files to this small set:

- Create: `src/core/trajectory/AgentTrajectory.ts`
- Create: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Create: `src/core/trajectory/LiveTrajectoryStore.ts`
- Create: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`

Do not create one service per event type. Batch K should have only two real logic units: the projector and the live store. The renderer is UI extraction, not a business logic owner.

## Data Model Draft

`src/core/trajectory/AgentTrajectory.ts` should define a stable UI-neutral contract:

```ts
export type AgentTrajectoryStatus =
	| "idle"
	| "running"
	| "waiting_for_approval"
	| "waiting_for_user"
	| "completed"
	| "failed"
	| "cancelled"
	| "safe_stopped";

export type AgentTrajectoryItemKind =
	| "context"
	| "model"
	| "tool"
	| "approval"
	| "mutation"
	| "task"
	| "failure"
	| "final"
	| "system";

export type AgentTrajectoryItemStatus =
	| "pending"
	| "running"
	| "ok"
	| "failed"
	| "denied"
	| "waiting"
	| "cancelled";

export interface AgentTrajectoryIdentity {
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId?: string;
	agentId?: string;
}

export interface AgentTrajectoryStage {
	key: "context" | "reasoning" | "tools" | "review" | "finalize";
	label: string;
	status: AgentTrajectoryItemStatus;
	itemIds: string[];
}

export interface AgentTrajectoryItem {
	id: string;
	kind: AgentTrajectoryItemKind;
	title: string;
	detail: string;
	status: AgentTrajectoryItemStatus;
	at?: string;
	step?: number;
	tool?: string;
	targetPath?: string;
	evidenceRef?: string;
	actionRef?: string;
	rawEventType?: string;
}

export interface AgentTrajectoryAction {
	id: "retry" | "cancel" | "continue" | "approve" | "reject" | "apply" | "view_replay";
	label: string;
	enabled: boolean;
	reason?: string;
	targetId?: string;
}

export interface AgentTrajectoryMutation {
	id: string;
	event: "planned" | "applied" | "rejected" | "conflicted" | "apply_failed";
	operation: string;
	targetPath: string;
	status: string;
	summary: string;
	reason: string;
}

export interface AgentTrajectoryFailure {
	class: "model" | "tool" | "approval" | "mutation" | "runtime" | "cancelled" | "unknown";
	message: string;
	retryable: boolean;
	recoverable: boolean;
}

export interface AgentTrajectorySnapshot {
	identity: AgentTrajectoryIdentity;
	status: AgentTrajectoryStatus;
	headline: string;
	summary: string;
	stages: AgentTrajectoryStage[];
	items: AgentTrajectoryItem[];
	actions: AgentTrajectoryAction[];
	mutations: AgentTrajectoryMutation[];
	failure?: AgentTrajectoryFailure;
	privacy: {
		redacted: boolean;
		source: "live" | "replay" | "mixed";
	};
}
```

Names may be adjusted during implementation, but these constraints are mandatory:

- Snapshot must not expose complete prompts, raw model responses, or unredacted file content.
- `identity.turnId` is required; `taskId` and `traceId` must be preserved when present.
- `status` must express waiting/failure/cancel/safe stop, not only running/completed.
- `items` must have deterministic ordering so replay rebuilds do not shuffle.
- `actions` must be derived from state, not guessed by UI string matching.

## Event Mapping Rules

`AgentTrajectoryProjector` must support at least two input shapes:

```ts
projectRuntimeProgress(events: RuntimeProgressEvent[]): AgentTrajectorySnapshot
projectReplaySummary(summary: TurnReplaySummary): AgentTrajectorySnapshot
```

Later it can grow:

```ts
projectTurnEvents(events: TurnEventRecord[]): AgentTrajectorySnapshot
```

Batch K does not require full raw `TurnEventRecord[]` projection if `TurnReplayReader` summary is enough for the completed path. Starting from summary is the smaller scope. The live path must still converge on the same snapshot contract.

Minimum mapping:

| Source | Snapshot mapping |
| --- | --- |
| `RuntimeProgressEvent.phase = "start"` | status `running`, context stage running |
| `phase = "context"` | context item running/ok |
| `phase = "model_request"` | reasoning stage running, model item running |
| `phase = "model_response"` | model item ok |
| `phase = "tool_approval"` | status `waiting_for_approval` or tools/review waiting |
| `phase = "tool_call"` | tool item running |
| `phase = "tool_result" + ok` | tool item ok |
| `phase = "tool_result" + failed` | tool item failed, optional failure |
| `phase = "fallback"` | system/failure item, status still running unless terminal |
| `phase = "done"` | finalize stage ok, status completed/safe_stopped when final result says so |
| `phase = "error"` | status failed, failure item |
| `TurnReplaySummary.toolCalls` | replay tool items |
| `TurnReplaySummary.approvals` | approval item/action summary |
| `TurnReplaySummary.mutationTimeline` | mutation items + mutation list |
| `TurnReplaySummary.taskTimeline` | task status, waiting/failure/cancel/completed |
| `TurnReplaySummary.errors` | failure summary |
| `TurnReplaySummary.terminalStatus` | final snapshot status |

## Implementation Tasks

### Task K0: Preflight and baseline

**Files:**

- Read: `src/core/agent-kernel/AgentLoopController.ts`
- Read: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Read: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Read: `src/core/runtime/TurnReplayReader.ts`
- Read: `src/views/DailyBoardView.ts`
- Read: `tests/daily-board-agent-task-ui-regression.test.mjs`

**Step 1: Confirm worktree and branch**

Run:

```powershell
git status --short --branch
git log --oneline -n 8
```

Expected: the active worktree, branch, and uncommitted state are known.

**Step 2: Run Kernel v2 gate tests**

Run:

```powershell
node --test tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: all pass. If they fail, stop and fix the Kernel v2 regression before Batch K.

**Step 3: Locate current UI ownership**

Run:

```powershell
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts |
  Select-String -Pattern 'RuntimeProgressEvent|buildRuntimeExecutionState|renderRuntimeExecutionCard|RuntimeExecutionState'
```

Expected: `DailyBoardView.ts` is the primary owner of current process UI mapping.

**Step 4: Commit preflight only if needed**

Do not commit if no files changed.

### Task K1: Write failing projector tests

**Files:**

- Create: `tests/agent-trajectory-projector.test.mjs`
- Create later: `src/core/trajectory/AgentTrajectory.ts`
- Create later: `src/core/trajectory/AgentTrajectoryProjector.ts`

**Step 1: Add tests before implementation**

Cover at least:

1. live progress maps context -> model -> tool -> done into ordered stages/items.
2. failed tool result creates failed tool item and failure summary.
3. approval event creates waiting state and approval item.
4. replay summary with tool/mutation/task timeline becomes completed snapshot.
5. replay summary with failed/cancelled/safe_stopped terminal status maps correctly.
6. snapshot preserves `turnId`, `taskId`, `traceId`, `conversationId`.

**Step 2: Run test to verify failure**

Run:

```powershell
node --test tests/agent-trajectory-projector.test.mjs
```

Expected: FAIL because trajectory modules do not exist.

### Task K2: Define trajectory contracts

**Files:**

- Create: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `tests/agent-trajectory-projector.test.mjs`

**Step 1: Implement the type contract**

Add types equivalent to the data model in this plan. Keep the file type-only where possible.

**Step 2: Keep labels out of core business logic**

Use stable semantic labels in core where needed, but do not call Obsidian UI translation helpers from `src/core/trajectory`.

**Step 3: Run tests**

Run:

```powershell
node --test tests/agent-trajectory-projector.test.mjs
```

Expected: still FAIL because projector is not implemented.

### Task K3: Implement `AgentTrajectoryProjector`

**Files:**

- Create: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Modify: `tests/agent-trajectory-projector.test.mjs`

**Step 1: Implement default snapshot builder**

Create:

```ts
export function createEmptyTrajectorySnapshot(identity: Partial<AgentTrajectoryIdentity> = {}): AgentTrajectorySnapshot
```

**Step 2: Implement live progress projection**

Create:

```ts
export function projectRuntimeProgress(events: RuntimeProgressEvent[]): AgentTrajectorySnapshot
```

Rules:

- The function is pure.
- Input order determines timeline order.
- Duplicate progress events update existing items when they refer to the same step/tool/target.
- Output retains safe summaries only, not raw payloads.

**Step 3: Implement replay summary projection**

Create:

```ts
export function projectReplaySummary(summary: TurnReplaySummary): AgentTrajectorySnapshot
```

Rules:

- Use `summary.toolCalls`, `summary.mutationTimeline`, `summary.taskTimeline`, `summary.errors`, `summary.terminalStatus`.
- If task timeline has `waiting_for_approval`, snapshot status must be `waiting_for_approval` even when the turn terminal event is open.
- If mutation timeline has conflict/apply_failed, surface mutation failure.

**Step 4: Run tests**

Run:

```powershell
node --test tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/core/trajectory/AgentTrajectory.ts src/core/trajectory/AgentTrajectoryProjector.ts tests/agent-trajectory-projector.test.mjs
git commit -m "feat: add agent trajectory projector"
```

### Task K4: Add live trajectory store

**Files:**

- Create: `src/core/trajectory/LiveTrajectoryStore.ts`
- Create: `tests/agent-trajectory-live-store.test.mjs`

**Step 1: Write failing tests**

Test:

- appending progress events updates current snapshot.
- starting a new `turnId` resets live history.
- completing a turn freezes completed snapshot.
- error/cancel clears running status but keeps replayable items.
- store does not mutate previously returned snapshots.

**Step 2: Run failing test**

```powershell
node --test tests/agent-trajectory-live-store.test.mjs
```

Expected: FAIL because store does not exist.

**Step 3: Implement store**

Suggested API:

```ts
export class LiveTrajectoryStore {
	appendProgress(event: RuntimeProgressEvent): AgentTrajectorySnapshot;
	completeFromProgress(event?: RuntimeProgressEvent): AgentTrajectorySnapshot | null;
	reset(): void;
	getSnapshot(): AgentTrajectorySnapshot | null;
	getCompletedSnapshot(): AgentTrajectorySnapshot | null;
}
```

Implementation should delegate projection to `projectRuntimeProgress`.

**Step 4: Run tests**

```powershell
node --test tests/agent-trajectory-live-store.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/core/trajectory/LiveTrajectoryStore.ts tests/agent-trajectory-live-store.test.mjs
git commit -m "feat: add live agent trajectory store"
```

### Task K5: Extract trajectory renderer

**Files:**

- Create: `src/views/agentTrajectoryRenderer.ts`
- Create or modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Modify later: `src/views/DailyBoardView.ts`

**Step 1: Write renderer tests**

Test with DOM stubs or the existing Daily Board test style:

- collapsed renderer shows headline and last 3 trajectory items.
- expanded renderer shows stage rail and up to 10 timeline items.
- waiting approval snapshot exposes waiting state visually.
- failed snapshot exposes failure summary.
- empty snapshot renders nothing or a stable placeholder according to existing UI behavior.

**Step 2: Implement renderer without changing DailyBoard yet**

Renderer should accept:

```ts
renderAgentTrajectoryCard({
	containerEl,
	snapshot,
	variant,
	expanded,
	onToggle,
	translate,
	renderAssistantAvatar,
})
```

Keep it Obsidian DOM-compatible and avoid framework dependencies.

**Step 3: Preserve existing visual skeleton**

Reuse existing CSS classes where reasonable:

- `friday-ai-runtime-preview`
- `friday-runtime-card`
- `friday-runtime-stage-rail`
- `friday-runtime-timeline`
- `friday-runtime-pill`

Do not do a full visual redesign in this task.

**Step 4: Run tests**

```powershell
node --test tests/daily-board-agent-trajectory-ui.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/views/agentTrajectoryRenderer.ts tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "feat: render agent trajectory cards"
```

### Task K6: Refactor DailyBoard live process UI to consume trajectory

**Files:**

- Modify: `src/views/DailyBoardView.ts`
- Modify: `tests/daily-board-agent-task-ui-regression.test.mjs`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`

**Step 1: Replace UI-local process state**

Change Daily Board fields from `RuntimeExecutionState`-centric to `AgentTrajectorySnapshot`-centric. Compatibility aliases may remain temporarily, but the primary state should be:

```ts
private aiRuntimeTrajectoryStore = new LiveTrajectoryStore();
private aiRuntimeTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
private aiLastCompletedTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
```

**Step 2: Update progress handler**

`handleRuntimeProgress(event)` should:

1. append event to `LiveTrajectoryStore`;
2. assign `aiRuntimeTrajectorySnapshot`;
3. assign `aiLastCompletedTrajectorySnapshot` on terminal progress;
4. render the board.

It should not contain a large switch over runtime phases.

**Step 3: Replace render entry points**

`renderRuntimeExecutionPreview()` and `renderCompletedRuntimeDisclosure()` should call `renderAgentTrajectoryCard()`.

**Step 4: Remove or quarantine old mapping**

Remove these methods if tests pass:

- `buildRuntimeExecutionState`
- `setRuntimeStageStatus`
- `upsertRuntimeEntry`
- `updateRuntimeEntry`
- `completeActiveContextEntry`
- `stageHasEntries`
- `hasSuccessfulToolEntry`
- `buildRuntimeEntryKey`
- `buildRuntimeEntryLabel`
- `buildContextHeading`
- `buildContextEntryLabel`

If removal is too large for this batch, mark them deprecated and ensure no production call path uses them.

**Step 5: Run focused tests**

```powershell
node --test tests/daily-board-agent-task-ui-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/views/DailyBoardView.ts tests/daily-board-agent-task-ui-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "refactor: render daily board process from agent trajectory"
```

### Task K7: Wire completed replay disclosure to trajectory projection

**Files:**

- Modify: `src/views/DailyBoardView.ts`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Possibly modify: `tests/turn-replay-reader.test.mjs`

**Step 1: Identify completed replay source**

Find where completed runtime state is currently copied or cloned after a turn. Replace the final disclosure source with:

```ts
const summary = await turnReplayReader.readSummary(ref);
const snapshot = projectReplaySummary(summary);
```

If the view cannot access `TurnReplayReader` directly without awkward coupling, add a narrow method to the existing runtime/facade layer instead of importing storage concerns into the view.

**Step 2: Add tests**

Tests must prove:

- completed disclosure can be rebuilt from replay summary after live store reset.
- tool/mutation/task events appear in completed trajectory.
- failed/cancelled replay renders failed/cancelled state.

**Step 3: Run focused tests**

```powershell
node --test tests/turn-replay-reader.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src/views/DailyBoardView.ts tests/daily-board-agent-trajectory-ui.test.mjs tests/turn-replay-reader.test.mjs
git commit -m "feat: rebuild completed process UI from trajectory replay"
```

### Task K8: Surface actions from trajectory state

**Files:**

- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/agentTaskPanelActions.ts` only if action callback plumbing needs a stable action ID.
- Modify: `tests/agent-trajectory-projector.test.mjs`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`

**Step 1: Add action tests**

Cover:

- running snapshot enables cancel.
- failed retryable snapshot enables retry.
- waiting approval snapshot exposes approve/reject or points to existing approval controls.
- pending mutation exposes apply/reject.
- completed snapshot exposes view replay only if such control already exists.

**Step 2: Implement action derivation in projector**

Action availability must be derived from snapshot status, task timeline, mutation timeline, and failure recoverability.

**Step 3: Render actions without duplicating business logic**

Renderer can display buttons, but it must not decide whether retry/apply/reject is allowed. That comes from `snapshot.actions`.

**Step 4: Run tests**

```powershell
node --test tests/agent-trajectory-projector.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/core/trajectory/AgentTrajectoryProjector.ts src/views/agentTrajectoryRenderer.ts src/views/agentTaskPanelActions.ts tests/agent-trajectory-projector.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
git commit -m "feat: expose trajectory-driven agent actions"
```

### Task K9: Static boundary and cleanup

**Files:**

- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Modify or create: `tests/agent-trajectory-boundary.test.mjs`
- Modify: `docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md`
- Modify: `docs/plans/2026-05-04-agent-trajectory-projection-plan.md`

**Step 1: Add static boundary test**

Create a test that fails if `DailyBoardView.ts` owns the old large phase switch again:

```js
assert.doesNotMatch(source, /private buildRuntimeExecutionState\(/);
assert.doesNotMatch(source, /case "model_request"/);
assert.match(source, /renderAgentTrajectoryCard/);
```

Use careful assertions so the test blocks architectural regression without overfitting to formatting.

**Step 2: Search for leftover UI-owned mapping**

Run:

```powershell
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts |
  Select-String -Pattern 'buildRuntimeExecutionState|RuntimeExecutionState|case "tool_call"|case "model_request"'
```

Expected: no production UI phase mapping remains, or only explicit compatibility code with comments and tests.

**Step 3: Update docs if implementation deviated**

If actual file names or APIs differ, update both Chinese and English plan docs.

**Step 4: Commit**

```powershell
git add tests/agent-trajectory-boundary.test.mjs docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md docs/plans/2026-05-04-agent-trajectory-projection-plan.md
git commit -m "test: lock agent trajectory ui boundary"
```

### Task K10: Full verification

**Files:**

- No required code changes.

**Step 1: Run focused suite**

```powershell
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/turn-replay-reader.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: all pass.

**Step 2: Run lint and full tests**

```powershell
npm run lint
npm test
git diff --check
git status --short --branch
```

Expected:

- lint passes.
- full test suite passes.
- `git diff --check` has no whitespace errors.
- worktree only contains intended Batch K changes.

**Step 3: Commit final cleanup if needed**

```powershell
git add src tests docs
git commit -m "chore: verify agent trajectory projection"
```

Only commit if real cleanup changes exist after prior commits.

## Acceptance Criteria

Batch K is complete only when:

- `src/views/DailyBoardView.ts` no longer uses `RuntimeProgressEvent.phase` as the primary fact source for process UI.
- live process UI and completed disclosure both consume `AgentTrajectorySnapshot`.
- replay summary can rebuild completed trajectory after the live store is lost.
- snapshot preserves `turnId`, `taskId`, `traceId`, and `conversationId`.
- waiting approval, waiting user, failed, cancelled, safe stopped, mutation conflict, and mutation apply failed can all be represented by snapshot.
- renderer does not decide whether business actions are allowed; it only renders `snapshot.actions`.
- no Wiki/RAG/MCP/Build/background/multi-agent feature is introduced.
- Kernel v2 default path, legacy retirement, task, replay, mutation, and resume tests still pass.

## Test Matrix

```text
New data flow / branch                         Required test
---------------------------------------------  -----------------------------------------
RuntimeProgressEvent[] -> trajectory snapshot  tests/agent-trajectory-projector.test.mjs
TurnReplaySummary -> trajectory snapshot       tests/agent-trajectory-projector.test.mjs
Live turn reset and completed freeze           tests/agent-trajectory-live-store.test.mjs
DailyBoard collapsed/expanded rendering        tests/daily-board-agent-trajectory-ui.test.mjs
Waiting approval rendering/actions             tests/daily-board-agent-trajectory-ui.test.mjs
Mutation pending/applied/rejected/conflict      tests/agent-trajectory-projector.test.mjs
Replay rebuild after live reset                tests/daily-board-agent-trajectory-ui.test.mjs
UI boundary does not own phase switch           tests/agent-trajectory-boundary.test.mjs
Kernel v2 default path unchanged               tests/agent-kernel-v2-default-path.test.mjs
Legacy runtime remains non-default             tests/agent-kernel-legacy-retirement.test.mjs
```

## Production Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| duplicate progress events | duplicated timeline, UI jitter | projector/live store de-dupe test |
| new turn starts without clearing old snapshot | UI mixes previous turn into current turn | live store reset test |
| completed replay lacks events | completed process is empty or falsely successful | replay empty/open/failed test |
| mutation apply failed | user thinks a file change succeeded | mutation failure snapshot test |
| approval waiting maps to running | user does not know action is required | waiting approval UI test |
| error payload contains sensitive text | UI leaks prompt or file content | safe summary projector test |
| DailyBoard adds phase switch again | architecture regresses | static boundary test |

## Development Prompt

Use this in a new implementation window:

```text
You are working in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule.

Goal: implement Batch K: Agent Trajectory Projection.

Read and execute the plan:
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

Constraints:
- Build the trajectory projection model first, then refactor DailyBoard UI.
- Do not add Wiki/RAG/MCP/Build/background/multi-agent.
- Do not clone Codex/Manus pixel-level UI.
- Do not break Kernel v2 default path, legacy retirement, task/replay/mutation/resume.
- Use TDD: write each failing test first, then implement, then run focused tests.
- Keep production additions small: src/core/trajectory/AgentTrajectory.ts, AgentTrajectoryProjector.ts, LiveTrajectoryStore.ts, src/views/agentTrajectoryRenderer.ts.
- DailyBoardView should ultimately render AgentTrajectorySnapshot, not switch on RuntimeProgressEvent.phase.

Before starting, run:
git status --short --branch
node --test tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs

When done, run:
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/turn-replay-reader.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

Implement task-by-task with commits. Final output must include changed files, test results, and remaining risks.
```

## Review Prompt

Use this in a separate verification window:

```text
You are doing read-only verification in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule. Do not change code unless I explicitly ask you to fix something.

Goal: verify whether Batch K: Agent Trajectory Projection is complete.

Acceptance source:
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

Check:
1. src/core/trajectory/AgentTrajectory.ts, AgentTrajectoryProjector.ts, and LiveTrajectoryStore.ts exist.
2. A renderer extraction exists, for example src/views/agentTrajectoryRenderer.ts.
3. DailyBoardView mainly consumes AgentTrajectorySnapshot instead of continuing to interpret RuntimeProgressEvent.phase through buildRuntimeExecutionState(event, previous).
4. live process UI and completed disclosure use the same trajectory snapshot contract.
5. completed/reload path can rebuild trajectory from TurnReplayReader/TurnReplaySummary.
6. waiting approval, waiting user, failed, cancelled, safe_stopped, mutation conflict/apply_failed have projector tests.
7. renderer only renders snapshot.actions and does not decide whether retry/apply/reject is allowed.
8. no Wiki/RAG/MCP/Build/background/multi-agent work was mixed in.
9. Kernel v2 default path / legacy retirement / task / replay / mutation / resume tests still pass.

Run:
git status --short --branch
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts | Select-String -Pattern 'buildRuntimeExecutionState|RuntimeExecutionState|case "tool_call"|case "model_request"'
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/turn-replay-reader.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check

Output format:
Verdict: PASS / PASS_WITH_CONCERNS / FAIL
Branch / HEAD:
Worktree:
Evidence:
Test results:
P0 issues:
P1 issues:
P2 issues:
Conclusion:
```
