# Agent Trajectory Projection 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 FRIDAY 建立统一的 Agent 工作轨迹投影层，让 Obsidian 对话框里的过程展示由 Kernel v2 产生的执行轨迹驱动，而不是由 Daily Board 临时拼接进度事件。

**Architecture:** Kernel v2 继续拥有执行、任务、回放、变更审批和恢复状态。Batch K 新增一个 UI-facing 但非 DailyBoard 专属的 trajectory projection 模型，把 live progress、kernel replay、task lifecycle、mutation review 和 failure 信息统一投影成 `AgentTrajectorySnapshot`。Daily Board 只渲染 snapshot，不再直接解释 `RuntimeProgressEvent` 的 phase 语义。

**Tech Stack:** TypeScript, Obsidian plugin DOM APIs, Kernel v2 contracts, `AgentReplayRecorder`, `TurnReplayReader`, `AgentTaskManager`, `AgentMutationCoordinator`, `DailyBoardView`, Node test runner.

---

## 对照文档

英文版必须同步维护：`docs/plans/2026-05-04-agent-trajectory-projection-plan.md`

如果实施中修改了本文的任务、验收口径、文件路径或非目标范围，必须同步修改英文版，避免 AI 读取英文文档时产生信息差。

## 背景判断

现在可以开始考虑“对话框过程信息展示”了，但这不是单纯 UI 问题。当前代码已经具备成熟过程 UI 所需的一部分底层材料：

- `src/core/agent-kernel/AgentLoopController.ts` 已承载默认 model/tool loop。
- `src/core/agent-kernel/AgentTaskManager.ts` 已管理 Kernel v2 任务状态。
- `src/core/agent-kernel/AgentReplayRecorder.ts` 已记录 Kernel event stream。
- `src/core/runtime/TurnReplayReader.ts` 已能汇总 replay、tool、approval、mutation、task timeline。
- `src/core/agent-kernel/AgentMutationCoordinator.ts` 已管理 review-first mutation lifecycle。
- `src/core/agent-kernel/AgentResumeController.ts` 已管理 retry/continue 的 Kernel 边界。
- `src/services/ObsidianAgentStateAdapter.ts` 已把 task/replay/mutation/resume 组合为 Obsidian runtime adapter。

但 UI 仍然不是成熟 Agent 产品的过程模型：

- `src/views/DailyBoardView.ts` 仍然通过 `buildRuntimeExecutionState(event, previous)` 自己解释 `RuntimeProgressEvent.phase`。
- live 状态和 completed disclosure 不是从同一个 replay/projection 模型重建。
- 过程信息缺少统一身份：`turnId`、`taskId`、`traceId`、approval、mutation、failure、recovery action 没有被组织成一个 UI 可消费的 timeline。
- 视觉上可以显示若干阶段和工具 pill，但底层还不是 Codex / Manus 那种“执行轨迹是事实源，UI 只是渲染”的模型。

Batch K 的目标就是补上这个 projection 层。

## 成熟产品对齐标准

参考 Codex、Manus、opencode、hermes-agent 的不是外观，而是过程信息的结构：

1. 单一轨迹源：Agent 做过什么、正在做什么、为什么停下、下一步需要谁处理，应该来自统一 trajectory，而不是散落在 task/progress/replay/mutation 各处。
2. live 与 replay 同构：运行中看到的过程，完成后、刷新后、恢复后应该能从 replay 重建为同一类 snapshot。
3. 可恢复状态显式：等待审批、等待用户、失败可重试、取消、safe stop、mutation pending 都必须是 snapshot 的一等状态。
4. 工具和证据可解释：UI 至少能稳定展示工具名、目标文件、摘要、结果状态，不需要暴露完整隐私 payload。
5. UI 不拥有执行语义：Daily Board 不应该知道每个 runtime phase 如何推进 Agent 状态；它只应该渲染 projection。
6. Obsidian-native：FRIDAY 短期仍以 Obsidian 场景为主，不要求 Build 能力，不追求通用 Coding Agent UI 全量复制。

## NOT in scope

- 不做 Wiki/RAG/MCP/background/multi-agent 新功能。
- 不把 FRIDAY 变成通用 Coding Agent。
- 不做 Build/test runner 的新执行能力。
- 不做完整视觉 redesign、主题系统重写或 Codex/Manus 像素级复刻。
- 不删除旧 runtime 的剩余兼容 shell；旧 runtime 退场继续按 retirement checklist 独立推进。
- 不扩大 Obsidian vault 读写权限，不引入额外网络行为。
- 不改变现有审批、apply/reject、retry/cancel/continue 的业务语义。

## What already exists

| 子问题 | 已有能力 | Batch K 处理方式 |
| --- | --- | --- |
| 执行 loop | `AgentLoopController` | 只消费其事件和 progress，不重写 loop。 |
| 执行身份 | `AgentExecutionContext` with `turnId/taskId/traceId/budget` | snapshot 必须保留这些 identity。 |
| replay 记录 | `AgentReplayRecorder` + `TurnEventLog` | completed/reload UI 从 replay projection 重建。 |
| replay 汇总 | `TurnReplayReader.readSummary()` | projector 先支持 summary，再按需支持 raw event records。 |
| task lifecycle | `AgentTaskManager` | task status 投影为 snapshot status/action。 |
| mutation review | `AgentMutationCoordinator` | mutation timeline 投影为 pending/applied/rejected/conflicted。 |
| resume/retry | `AgentResumeController` | action model 暴露 retry/continue/cancel 等可用操作。 |
| 当前 UI | `DailyBoardView.renderRuntimeExecutionCard()` | 保留视觉骨架，替换数据来源和 view model。 |

## 当前断点

```text
-------------------+       +-------------------------+
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

问题在下面这个边界：Daily Board 正在拥有“phase 到过程状态”的解释权。成熟 Agent 的 UI 不应该这样做。

Batch K 后目标：

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

## 目标架构

新增 projection 层应放在 `src/core/trajectory/`。原因：

- 它不是 Kernel 的执行核心，不应该让 `src/core/agent-kernel/` 继续膨胀。
- 它也不是 Daily Board 私有 UI 逻辑，未来可以被其他 Obsidian view 或 task panel 复用。
- 它是纯 TypeScript 数据投影，便于用 Node test runner 独立测试。

建议生产文件控制在 4 个以内：

- Create: `src/core/trajectory/AgentTrajectory.ts`
- Create: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Create: `src/core/trajectory/LiveTrajectoryStore.ts`
- Create: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`

不要为每种事件单独建 service。Batch K 只允许两个真正的逻辑单元：projector 和 live store。renderer 是 UI extraction，不承担业务解释。

## 数据模型草案

`src/core/trajectory/AgentTrajectory.ts` 应定义 UI-neutral 的稳定 contract：

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

字段命名可以在实施时微调，但必须满足这些约束：

- snapshot 不暴露完整 prompt、模型原始响应、未脱敏文件内容。
- `identity.turnId` 必填；`taskId` 和 `traceId` 有则必须贯穿。
- `status` 必须能表达 waiting/failure/cancel/safe stop，不允许只用 running/completed。
- `items` 必须稳定排序，刷新后 replay 重建不能乱序。
- `actions` 必须由状态推导，不能在 UI 按字符串猜。

## 事件映射规则

`AgentTrajectoryProjector` 至少支持两类输入：

```ts
projectRuntimeProgress(events: RuntimeProgressEvent[]): AgentTrajectorySnapshot
projectReplaySummary(summary: TurnReplaySummary): AgentTrajectorySnapshot
```

后续可以扩展为：

```ts
projectTurnEvents(events: TurnEventRecord[]): AgentTrajectorySnapshot
```

Batch K 不强制一次性支持 raw `TurnEventRecord[]` 全量投影；如果 `TurnReplayReader` 的 summary 信息足够，先从 summary 做 completed path 是更小范围。但 live path 必须收敛到同一个 snapshot contract。

最小映射：

| 来源 | Snapshot 映射 |
| --- | --- |
| `RuntimeProgressEvent.phase = "start"` | status `running`, context stage running |
| `phase = "context"` | context item running/ok |
| `phase = "model_request"` | reasoning stage running, model item running |
| `phase = "model_response"` | model item ok |
| `phase = "tool_approval"` | status `waiting_for_approval` 或 tools/review waiting |
| `phase = "tool_call"` | tool item running |
| `phase = "tool_result" + ok` | tool item ok |
| `phase = "tool_result" + failed` | tool item failed, failure optional |
| `phase = "fallback"` | system/failure item, status still running unless terminal |
| `phase = "done"` | finalize stage ok, status completed/safe_stopped by final result if available |
| `phase = "error"` | status failed, failure item |
| `TurnReplaySummary.toolCalls` | replay tool items |
| `TurnReplaySummary.approvals` | approval item/action summary |
| `TurnReplaySummary.mutationTimeline` | mutation items + mutation list |
| `TurnReplaySummary.taskTimeline` | task status, waiting/failure/cancel/completed |
| `TurnReplaySummary.errors` | failure summary |
| `TurnReplaySummary.terminalStatus` | final snapshot status |

## 实施任务

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

Expected: you know the active worktree, branch, and whether uncommitted files exist.

**Step 2: Run Kernel v2 gate tests**

Run:

```powershell
node --test tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: all pass. If these fail, stop and fix Kernel v2 regression before Batch K.

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

Cover at least these cases:

1. live progress maps context -> model -> tool -> done into ordered stages/items.
2. failed tool result creates failed tool item and failure summary.
3. approval event creates waiting state and approval item.
4. replay summary with tool/mutation/task timeline becomes completed snapshot.
5. replay summary with failed/cancelled/safe_stopped terminal status maps status correctly.
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

Add types equivalent to the model in this plan. Keep the file type-only where possible.

**Step 2: Keep labels out of core business logic**

Use stable semantic labels in core where needed, but avoid calling Obsidian UI translation helpers from `src/core/trajectory`.

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

Create a deterministic empty/default snapshot builder:

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
- Duplicate progress events should update existing item when they refer to the same step/tool/target.
- Output should retain only safe summaries, not raw payloads.

**Step 3: Implement replay summary projection**

Create:

```ts
export function projectReplaySummary(summary: TurnReplaySummary): AgentTrajectorySnapshot
```

Rules:

- Use `summary.toolCalls`, `summary.mutationTimeline`, `summary.taskTimeline`, `summary.errors`, `summary.terminalStatus`.
- If task timeline has `waiting_for_approval`, snapshot status must be `waiting_for_approval` even if the turn terminal event is open.
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

Change Daily Board fields from `RuntimeExecutionState`-centric to `AgentTrajectorySnapshot`-centric. The UI can temporarily keep compatibility aliases, but the primary state should be:

```ts
private aiRuntimeTrajectoryStore = new LiveTrajectoryStore();
private aiRuntimeTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
private aiLastCompletedTrajectorySnapshot: AgentTrajectorySnapshot | null = null;
```

**Step 2: Update progress handler**

`handleRuntimeProgress(event)` should:

1. append event to `LiveTrajectoryStore`;
2. assign `aiRuntimeTrajectorySnapshot`;
3. on terminal progress, assign `aiLastCompletedTrajectorySnapshot`;
4. render board.

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

If the view cannot access `TurnReplayReader` directly without awkward coupling, add a narrow method to the existing runtime/facade layer rather than importing storage concerns into the view.

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

Create a test that fails if `DailyBoardView.ts` again owns the old large phase switch:

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

Only commit if there are real cleanup changes after the prior commits.

## 验收标准

Batch K 完成后必须满足：

- `src/views/DailyBoardView.ts` 不再把 `RuntimeProgressEvent.phase` 作为过程 UI 的主要事实源。
- live process UI 和 completed disclosure 都消费 `AgentTrajectorySnapshot`。
- replay summary 可以在 live store 丢失后重建 completed trajectory。
- snapshot 保留 `turnId`、`taskId`、`traceId`、`conversationId`。
- waiting approval、waiting user、failed、cancelled、safe stopped、mutation conflict/apply failed 都能被 snapshot 表达。
- renderer 不决定业务动作是否可用；它只渲染 `snapshot.actions`。
- 不引入 Wiki/RAG/MCP/Build/background/multi-agent 新功能。
- Kernel v2 默认路径、legacy retirement、task/replay/mutation/resume 测试继续通过。

## 测试矩阵

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

## 生产失败模式

| 失败模式 | 风险 | 必须覆盖 |
| --- | --- | --- |
| progress event 重复到达 | timeline 重复、UI 抖动 | projector/live store 去重测试 |
| 新 turn 开始但旧 snapshot 未清理 | UI 混入上一轮过程 | live store reset 测试 |
| completed replay 缺少事件 | 完成后过程为空或误报成功 | replay empty/open/failed 测试 |
| mutation apply failed | 用户以为修改已完成 | mutation failure snapshot 测试 |
| approval waiting 被映射成 running | 用户不知道需要操作 | waiting approval UI 测试 |
| error payload 含敏感内容 | UI 泄露 prompt 或文件内容 | projector safe summary 测试 |
| DailyBoard 再次添加 phase switch | 架构回退 | static boundary test |

## 开发提示词

给新窗口执行 Batch K 时使用：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中开发。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。

目标：执行 Batch K: Agent Trajectory Projection。

先阅读并执行计划：
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

关键约束：
- 先做 trajectory projection 模型，再改 DailyBoard UI。
- 不做 Wiki/RAG/MCP/Build/background/multi-agent。
- 不做 Codex/Manus 像素级 UI 复刻。
- 不破坏 Kernel v2 默认路径、legacy retirement、task/replay/mutation/resume。
- 用 TDD：每个任务先写失败测试，再实现，再运行对应测试。
- 尽量控制生产新增模块：src/core/trajectory/AgentTrajectory.ts、AgentTrajectoryProjector.ts、LiveTrajectoryStore.ts、src/views/agentTrajectoryRenderer.ts。
- DailyBoardView 最终应渲染 AgentTrajectorySnapshot，而不是自己 switch RuntimeProgressEvent.phase。

开始前运行：
git status --short --branch
node --test tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs

完成后运行：
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/turn-replay-reader.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

请按计划逐任务提交，最后给出变更文件、测试结果、剩余风险。
```

## 检查提示词

给另一个窗口验收 Batch K 时使用：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中做只读验收。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。不要改代码，除非我明确要求修复。

目标：检查 Batch K: Agent Trajectory Projection 是否完成。

验收依据：
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

重点检查：
1. 是否存在 src/core/trajectory/AgentTrajectory.ts、AgentTrajectoryProjector.ts、LiveTrajectoryStore.ts。
2. 是否存在 renderer extraction，例如 src/views/agentTrajectoryRenderer.ts。
3. DailyBoardView 是否主要消费 AgentTrajectorySnapshot，而不是继续用 buildRuntimeExecutionState(event, previous) 解释 RuntimeProgressEvent.phase。
4. live process UI 与 completed disclosure 是否走同一个 trajectory snapshot contract。
5. completed/reload path 是否能从 TurnReplayReader/TurnReplaySummary 重建 trajectory。
6. waiting approval、waiting user、failed、cancelled、safe_stopped、mutation conflict/apply_failed 是否有 projector 测试。
7. renderer 是否只渲染 snapshot.actions，不自己判断 retry/apply/reject 是否可用。
8. 是否没有混入 Wiki/RAG/MCP/Build/background/multi-agent。
9. Kernel v2 default path / legacy retirement / task / replay / mutation / resume 测试是否仍通过。

请运行：
git status --short --branch
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts | Select-String -Pattern 'buildRuntimeExecutionState|RuntimeExecutionState|case "tool_call"|case "model_request"'
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/turn-replay-reader.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-task-manager.test.mjs tests/agent-kernel-replay-recorder.test.mjs tests/agent-kernel-mutation-coordinator.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check

输出格式：
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
