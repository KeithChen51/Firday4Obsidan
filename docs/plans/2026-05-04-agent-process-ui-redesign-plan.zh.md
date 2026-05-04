# Agent Process UI Redesign 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Batch K 的 `AgentTrajectorySnapshot` 之上，全面重做 FRIDAY 对话框中的 Agent 过程展示，让它接近 Codex / Manus 这类成熟 Agent 产品的过程可见性，同时保持 Obsidian-native。

**Architecture:** Kernel v2 和 trajectory projection 继续作为事实源。Batch L 只重做 UI presentation layer：新增 trajectory-to-process-view-model 适配层，重写 renderer 和 CSS，Daily Board 继续只消费 `AgentTrajectorySnapshot`。允许替换现有 `friday-runtime-card` DOM/CSS 主路径，但不把执行语义重新塞回 UI。

**Tech Stack:** TypeScript, Obsidian DOM APIs, `AgentTrajectorySnapshot`, DailyBoardView, `styles.css`, Node test runner, DOM fake tests, static CSS/architecture tests.

---

## 对照文档

英文版必须同步维护：`docs/plans/2026-05-04-agent-process-ui-redesign-plan.md`

如果实施中修改任务、文件路径、验收标准、非目标范围或 UI 信息架构，必须同步更新英文版。

## 背景

Batch K 已经完成了必要的底层前提：

```text
Kernel v2
  -> AgentTrajectorySnapshot
  -> DailyBoardView
  -> renderAgentTrajectoryCard()
```

这说明 FRIDAY 已经有了“过程 UI 的事实源”。但当前 UI 仍是最小迁移形态：

- `src/views/agentTrajectoryRenderer.ts` 仍是一个简单卡片：标题、摘要、阶段 rail、最近 10 条 timeline、动作按钮。
- `styles.css` 中的 `friday-runtime-*` 样式延续了旧的“工具执行摘要”思路。
- collapsed 状态只显示最近 3 个 pill，用户很难一眼看出“正在做什么、为什么停下、需要我做什么”。
- expanded 状态缺少成熟 Agent 常见的信息层次：当前状态、阶段进度、动作区、证据/工具、失败恢复、完成回放。
- 当前视觉可以工作，但不够像一个可信的长期工作 Agent。

用户明确允许推翻现有过程 UI 展示。因此 Batch L 不做小修小补，而是允许重做 renderer、CSS 和 UI 测试。

Batch L 应在 Batch M.1 完成之后实施。它消费 M.1 产出的 transport trajectory facts，并渲染重连中、重试中等状态；但它不能在 UI 本地发明网络状态，也不能声称已经具备 checkpoint resume。如果 M.1 尚未完成，Batch L 必须暂停，或明确跳过 transport UI 并记录后续补齐项。

## 产品方向

Batch L 要做的是 **Obsidian-native Agent process panel**，不是通用 Coding Agent 控制台。

这个 Manus 参考引入一个核心产品规则：**不是每个回答都应该展示完整过程 UI**。

Manus 只作为过程展开/收起的信息结构参考，不作为业务内容参考。不要把截图里的具体任务信息写进 FRIDAY 框架：简历章节、Notion 文案、联系方式、工作经历等示例内容都不应成为产品概念、类型、标签、测试夹具或默认文案。

- 如果用户问题可以直接回答，FRIDAY 只需要显示轻量状态，例如“FRIDAY 正在思考”，然后直接给出最终回答。
- 如果问题被拆解为可执行任务，或者进入记忆读取、工具调用、文件变更、审批、恢复等流程，才展示分步骤过程。
- 分步骤过程中的记忆、工具调用、证据、变更、恢复信息应支持按环节展开/收起。
- 简单回答不应该留下一个完成后的“工具执行记录”面板。

视觉和交互方向：

- 安静、密集、可信，像 Obsidian 内部的工作记录，而不是营销页或独立 IDE。
- collapsed 视图必须能回答：FRIDAY 现在处于什么状态，当前关键动作是什么，是否需要用户处理。
- expanded 视图必须能回答：它已经看了什么、调用了什么、为什么停下、哪些文件/变更相关、下一步动作是什么。
- 完成后的 disclosure 必须像 replay summary，而不是一堆临时日志。
- 等待审批、等待用户、失败、取消、safe stop、mutation conflict/apply failed 必须有清晰但克制的状态表达。
- Batch M.1 的网络 retry/reconnect 状态必须作为过程状态可见：请求模型、正在重连、网关不稳定后重试、transport retry exhausted。

不追求：

- Codex / Manus 像素级复制。
- 大面积彩色渐变、玻璃拟态、装饰动效。
- 把 Obsidian 聊天区变成 IDE terminal。

## 成熟产品参照点

参考 Codex / Manus / opencode / hermes-agent 的这些点：

0. **先判断复杂度**：简单问答只显示短暂思考状态；任务型工作才进入过程面板。
1. **过程是一条可读轨迹**：用户能扫描，而不是读调试日志。
2. **当前状态优先**：运行时最重要的是“现在发生什么”和“是否需要我介入”。
3. **阶段是导航，不是装饰**：阶段条应帮助定位 context / reasoning / tools / review / finalize。
4. **工具调用要有语义摘要**：不要只显示 tool name，要显示目标和结果。
5. **动作与状态绑定**：retry/cancel/apply/reject/continue 必须出现在对应状态附近。
6. **失败有恢复路径**：失败不是红字结束，而是“发生什么、是否可重试、下一步做什么”。
7. **完成后可复盘**：completed disclosure 应该从 replay 重建，并保留关键证据。

## NOT in scope

- 不改 Kernel v2、AgentLoopController、AgentTaskManager、AgentReplayRecorder、AgentMutationCoordinator 的所有权。
- 不改变 `AgentTrajectorySnapshot` 的核心业务语义，除非 UI 需要极小的显示辅助字段且有测试证明必要。
- 不新增 Wiki/RAG/MCP/background/multi-agent。
- 不新增 Build 能力，也不把 FRIDAY 扩展为通用 Coding Agent。
- 不做全局主题系统重写。
- 不做 release artifact 手工改动；`release/` 生成物只由既有 release/build 流程处理。
- 不引入新前端框架，不引入图片资产，不引入网络依赖。

## What already exists

| 能力 | 文件 | Batch L 用法 |
| --- | --- | --- |
| Trajectory contract | `src/core/trajectory/AgentTrajectory.ts` | 继续作为 UI 输入，不改执行语义。 |
| Projection | `src/core/trajectory/AgentTrajectoryProjector.ts` | 不重写；只消费 snapshot。 |
| Live store | `src/core/trajectory/LiveTrajectoryStore.ts` | 不重写；提供 live snapshot。 |
| Daily Board wiring | `src/views/DailyBoardView.ts` | 保留入口，替换 renderer 输出。 |
| Current renderer | `src/views/agentTrajectoryRenderer.ts` | 允许重写或替换为新的 process panel renderer。 |
| Styles | `styles.css` | 允许新增 `friday-agent-process-*` 新命名空间，并逐步停用旧 `friday-runtime-*` 主路径。 |
| Tests | `tests/daily-board-agent-trajectory-ui.test.mjs` | 更新为新 UI contract。 |
| Boundary tests | `tests/agent-trajectory-boundary.test.mjs` | 保持：UI 不得重新拥有 runtime phase switch。 |

## UI 信息架构

目标 DOM 结构可以重做为 `friday-agent-process-*` 命名空间：

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

UI 必须先区分三种 presentation mode：

```text
simple_thinking
  用于直接回答型问题；只展示 "FRIDAY 正在思考" 这类轻量 live 状态。

stepped_process
  用于任务型工作；展示步骤、工具、证据、记忆、变更、审批、恢复。

completed_replay
  用于任务完成后的复盘；默认收起，可展开查看关键过程。
```

Collapsed 状态：

```text
[status] 正在检索资料                  [Cancel] [Details]
        已读取 2 个文件，正在整理证据
        Read: Notes/A.md  Search: project
```

Expanded 状态：

```text
FRIDAY is working
已获取新证据，正在决定下一步

Context -> Reasoning -> Tools -> Review -> Finalize

Current
  正在读取 Notes/today.md

Timeline
  ✓ 加载项目规则
  ✓ 分析第 1 步
  ✓ 搜索 当前项目
  → 读取 Notes/today.md

Evidence
  Notes/today.md  project search  step 2

Action
  Cancel / Retry / Apply / Reject / Continue
```

通用 step group 结构：

```text
✓ 当前任务生成的步骤标题                  [collapse]
    使用过的上下文或记忆                  [expand]
    工具或证据摘要
    结果或下一步摘要

→ 当前任务生成的下一步骤标题              [expand]
    使用过的上下文或记忆
```

状态优先级：

1. waiting_for_approval / waiting_for_user
2. failed / cancelled / safe_stopped
3. running
4. completed
5. idle

## 视觉规范

Batch L 的视觉方向是 **quiet operational Obsidian panel**：

- 使用 Obsidian CSS variables：`--background-secondary`、`--background-modifier-border`、`--text-muted`、`--interactive-accent` 等。
- 不使用大面积渐变、不使用发光、不使用装饰性图形。
- 卡片半径不超过现有 Obsidian 风格；过程 panel 内不再嵌套卡片。
- 状态色要克制：running 用 accent，waiting 用 warning/interactive accent，failed 用 error，completed 用 success 或 muted green。
- 文本层级紧凑：标题、摘要、行标题、meta 四层即可。
- 动作按钮使用原生 Obsidian button 风格，主动作只有一个，其他为 ghost/secondary。
- timeline 行要稳定，不因文字长度改变整体布局。
- 移动/窄宽度下：阶段导航可横向滚动，timeline 保持单列，action slot 换行。

## 交互规范

- collapsed 默认显示，不占用过多聊天空间。
- live running 时 collapsed 展示 current focus + last evidence。
- expanded 展示完整 process panel，但默认只显示最近若干条，提供“Show all”或渐进展开。
- completed disclosure 默认 collapsed，用户点开看 replay。
- action button 必须来自 `snapshot.actions`，renderer 不判断业务可用性。
- disabled action 必须有 title/aria reason。
- toggle 必须有 `aria-expanded`。
- process panel 必须支持键盘触达，不用 div 模拟 button。

## 建议文件结构

允许替换现有 renderer。推荐最小新增：

- Create: `src/views/agentProcessPanelViewModel.ts`
- Replace or heavily modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `styles.css`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Create: `tests/agent-process-panel-view-model.test.mjs`
- Create: `tests/agent-process-panel-style-regression.test.mjs`
- Read: `docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md`
- Read: `docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md`

不要新增超过两个生产逻辑文件。推荐结构：

```text
AgentTrajectorySnapshot
  -> buildAgentProcessPanelViewModel()
  -> renderAgentTrajectoryCard()
  -> styles.css
```

其中 `buildAgentProcessPanelViewModel()` 只做展示组织：

- status label
- tone
- current item
- visible timeline
- evidence chips
- action groups
- empty/completed/waiting/failure display metadata

它不可以：

- 判断工具是否真的可执行。
- 推导 retry/apply/reject 是否允许。
- 读取文件、读取 replay、访问 runtime service。
- 解释 `RuntimeProgressEvent.phase`。

## View model 草案

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

设计原则：

- View model 可以把 `AgentTrajectoryItem` 分组、截断、排序、生成 display label。
- View model 必须能识别 simple answer / stepped process / completed replay。
- simple answer 的 live UI 只显示轻量 thinking，不渲染完整 process panel。
- stepped process 要把 context/model/tool/mutation/approval/failure 组织成可展开 step groups。
- View model 不改变 snapshot 的事实。
- Renderer 只渲染 view model，不做复杂分支。
- Tests 应覆盖 view model 多状态，不靠视觉快照猜。

## 实施任务

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
- Renderer is allowed to be fully rewritten, but it must remain snapshot-driven.
- Simple direct-answer turns show only lightweight “FRIDAY 正在思考” style live state and do not leave a heavy completed process panel.
- Task-like turns show a stepped process with collapsible groups for memory/context/tools/evidence/mutations.
- Manus 参考只保留通用结构，不得把简历、Notion、联系方式、工作经历等截图示例内容硬编码进产品标签、类型、测试或夹具。
- Collapsed view clearly shows status, current activity, summary, and available primary action.
- Expanded view shows stage navigation, current focus, timeline, evidence, mutation/review, recovery, and actions.
- Waiting approval/user, failed, cancelled, safe_stopped, completed, running states have explicit visual coverage.
- Batch M.1 的 network reconnecting/retrying/exhausted transport states 有明确视觉和测试覆盖。
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

## 开发提示词

给新窗口执行 Batch L：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中开发。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。

目标：执行 Batch L: Agent Process UI Redesign。

先阅读：
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

关键要求：
- 这次允许推翻现有过程 UI，不是小修旧 friday-runtime-card。
- 只参考 Manus 的结构规则：简单直接回答只显示轻量“FRIDAY 正在思考”，不要展示完整过程面板；任务型工作才展示可展开/收起的步骤过程。不要复制或固化截图里的简历、Notion、联系方式等具体业务内容。
- 只重做 trajectory-driven presentation layer。
- 不改 Kernel v2 所有权，不重新解释 RuntimeProgressEvent.phase。
- DailyBoard 继续只传 AgentTrajectorySnapshot、expanded、action handler、translator、avatar renderer。
- 可以新增 src/views/agentProcessPanelViewModel.ts。
- 可以重写 src/views/agentTrajectoryRenderer.ts。
- 可以新增 friday-agent-process-* CSS，并让它成为主 DOM/CSS contract。
- 必须支持 step groups：每个执行环节可以展开/收起其中的记忆、工具调用、证据和变更信息。
- 必须把 Batch M.1 的 transport trajectory facts 渲染成 reconnecting/retrying/exhausted 过程状态。Batch L 不得声称 checkpoint resume。
- 不做 Wiki/RAG/MCP/Build/background/multi-agent。
- 不做 Codex/Manus 像素级复制，要做 Obsidian-native process panel。

开始前运行：
git status --short --branch
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs

按计划 TDD 执行，每个任务先写失败测试，再实现，再跑 focused test，再提交。

完成后运行：
node --test tests/agent-process-panel-view-model.test.mjs tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

最后输出：
- 改了哪些文件；
- UI 信息架构如何变化；
- 是否仍保持 snapshot-driven；
- 测试结果；
- 剩余风险。
```

## 检查提示词

给另一个窗口验收 Batch L：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中做只读验收。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。不要改代码，除非我明确要求修复。

目标：检查 Batch L: Agent Process UI Redesign 是否完成。

验收依据：
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md

重点检查：
1. 是否存在 src/views/agentProcessPanelViewModel.ts 或等价 view model 层。
2. src/views/agentTrajectoryRenderer.ts 是否已从旧 runtime-card 小卡片改成新的 process panel renderer。
3. 主 DOM/CSS contract 是否是 friday-agent-process-*，而不是 friday-runtime-card。
4. DailyBoardView 是否仍只传 snapshot/expanded/action/translator/avatar，不重新解释 RuntimeProgressEvent.phase。
5. collapsed view 是否显示 status/current activity/summary/primary action。
6. 简单直接回答是否只显示轻量 thinking 状态，并且不会留下沉重 completed process panel。
7. 任务型工作是否显示可展开/收起的 step groups，且每个环节能容纳记忆、工具调用、证据、变更信息；同时确认没有硬编码 Manus 截图里的简历、Notion、联系方式、工作经历等具体业务内容。
8. expanded view 是否显示 stage/current/timeline/evidence/mutation/recovery/actions。
9. Batch M.1 的 network reconnecting/retrying/exhausted 状态是否从 trajectory items 渲染，而不是 UI timer 本地推断。
10. waiting approval/user、failed、cancelled、safe_stopped、completed、running 是否有测试覆盖。
11. actions 是否仍来自 snapshot.actions，renderer 不自行判断业务可用性。
12. CSS 是否 Obsidian-native、responsive、accessible，且无 nested card/decorative blob/glassmorphism。
13. 是否没有混入 Wiki/RAG/MCP/Build/background/multi-agent。

请运行：
git status --short --branch
Get-ChildItem -Path 'src\views' -Recurse -File -Include *.ts | Select-String -Pattern 'buildRuntimeExecutionState|RuntimeExecutionState|case "tool_call"|case "model_request"'
Select-String -Path 'src\views\agentTrajectoryRenderer.ts','styles.css' -Pattern 'friday-agent-process|friday-runtime-card'
node --test tests/agent-process-panel-view-model.test.mjs tests/agent-process-panel-style-regression.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-trajectory-boundary.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs tests/agent-kernel-v2-default-path.test.mjs tests/agent-kernel-legacy-retirement.test.mjs tests/agent-kernel-loop.test.mjs
npm run lint
npm test
git diff --check

输出格式：
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
