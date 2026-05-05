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

- 如果用户问题可以直接回答，FRIDAY 只需要显示轻量状态，例如 `FRIDAY 思考中`，然后直接给出最终回答。
- 如果问题被拆解为可执行任务，或者进入记忆读取、工具调用、文件变更、审批、恢复等流程，才展示分步骤过程。
- 分步骤过程中的记忆、工具调用、证据、变更、恢复信息应支持按环节展开/收起。
- 简单回答不应该留下一个完成后的“工具执行记录”面板。
- 生命周期卡不是产品表面。task lifecycle records 继续作为内部事实存在，但 UI 默认不显示臃肿的 “task running / completed / final delivered” 卡片。

视觉和交互方向：

- 安静、密集、可信，像 Obsidian 内部的工作记录，而不是营销页或独立 IDE。
- collapsed 视图必须能回答：FRIDAY 现在处于什么状态，当前关键动作是什么，是否需要用户处理。
- expanded 视图必须能回答：它已经看了什么、调用了什么、为什么停下、哪些文件/变更相关、下一步动作是什么。
- 完成后的 disclosure 必须像 replay summary，而不是一堆临时日志。
- 等待审批、等待用户、失败、取消、safe stop、mutation conflict/apply failed 必须有清晰但克制的状态表达。
- Batch M.1 的网络 retry/reconnect 状态必须作为过程状态可见：请求模型、正在重连、网关不稳定后重试、transport retry exhausted。

## 回答、过程与产物显示契约

Batch L 必须把回答区域拆成三个协同表面：

1. **回答表面**
   - 最终 assistant answer 永远是主内容。
   - 对简单直接回答，这是唯一持久内容。
   - 回答表面不能被 completed lifecycle card 顶下去。
   - FRIDAY 的回答应当是文档流，不再用大号 assistant 气泡包住。用户消息可以继续保留气泡形态。

2. **过程表面**
   - 过程表面是临时或次级信息。
   - 只有当它能帮助用户理解正在执行的工作、需要介入的动作、失败恢复或事后审计时才出现。
   - 它必须比回答更轻，默认使用 compact/collapsed 状态。
   - 过程表面如需显示，位于最终回答之前；展开后也在原位展开，仍然位于回答正文之前。

3. **产物表面**
   - 产物表面位于最终回答之后，展示本轮创建或修改的具体文件。
   - 它是结果 UI，不是过程 UI。过程里可以说“修改了 2 个文件”，但可点击文件卡片和 diff 摘要属于这里。
   - 如果本轮没有创建或修改文件，则完全隐藏。

显示规则：

| 情况 | 回答过程中 | 回答完成后 |
| --- | --- | --- |
| 简单直接回答 | 只显示 inline “FRIDAY 思考中” | 不显示 process panel、不显示 completed replay、不显示 lifecycle card |
| 纯模型回答且无工具/重试 | 只显示 inline thinking | 不显示 process panel |
| 工具/文件/上下文工作 | compact process strip，显示当前动作和 Details toggle | 最终回答优先；下方/附近保留折叠 replay 入口 |
| 网络 retry/reconnect | 来自 M.1 trajectory facts 的 compact reconnecting row | 恢复后 replay 仍折叠；耗尽后显示 compact recovery |
| 等待审批/用户 | compact action-required row，必要时可展开 | action-required row 保留到解决 |
| 失败/可恢复停止 | compact recovery row，包含 retry/resume action | recovery row 保留；只有存在最终回答时才显示最终回答 |
| Mutation review | compact review row，包含 apply/reject | review row 保留到 applied/rejected |

实现必须显式压制 lifecycle-only cards：

- 不为 `task_created`、`task_running`、`task_completed` 或 “final answer delivered” 渲染可见卡片，除非它们附着在等待、失败、恢复、mutation review 或 replay 这类对用户有意义的状态上。
- 简单回答不显示 `completed_replay`。
- 不在最终回答上方显示 “process completed” card。
- 复杂任务完成后如有 replay，只显示一个小型折叠 disclosure，例如 “Process replay”，附带简短摘要，并且默认折叠。

身份与文案契约：

- 每条 FRIDAY 回答必须显示 FRIDAY 图标。
- 不再在过程区域上方单独渲染一个臃肿的 “FRIDAY” 标签。过程 disclosure 行本身就是身份/标题行。
- 简单回答生成中显示：`[FRIDAY 图标] FRIDAY 思考中`。
- 简单或纯模型回答完成后，临时 thinking 行消失，只保留文档流形式的最终回答。
- 折叠的思路入口使用：`[FRIDAY 图标] FRIDAY 的思路 {duration}s >`。
- 任务型工作使用：`[FRIDAY 图标] FRIDAY 的工作过程 {duration}s >`；展开状态使用同一文案和展开 affordance。
- 加载项目规则、AGENTS 指令、技能、上下文读取、工具调用、模型重试、网络重连都属于展开后的过程 disclosure。
- 思考/推理内容只展示摘要，不渲染原始 chain-of-thought。

最终回答与产物布局：

```text
[FRIDAY 图标] FRIDAY 的思路 6s >

最终回答正文以文档流展示。

本次改动

[文档图标] 2026-05-04-agent-process-ui-redesign-plan.md
文档 · MD                                      [打开 ˅]

[画布图标] Project Map.canvas
画布 · Canvas                                  [打开 ˅]

2 个文件已修改  +298 -34
docs/plans/agent-process-ui-redesign-plan.md    +149 -17    [展开]
docs/maps/project-map.canvas                     +149 -17    [展开]
```

文件产物要求：

- 创建、修改、已应用的文件统一放在 `本次改动` 区。
- 如果未来增加只读引用文件，应使用 `参考文件` 等独立标签；不要把只读引用混进 `本次改动`。
- 每个文件行必须显示类型感知信息，例如 `文档 · MD`、`画布 · Canvas`。
- 主操作文案是 `打开`。点击后必须在 Obsidian 工作区打开目标 vault 文件，而不是打开系统文件管理器。
- `.md` 文件按 Markdown 笔记打开；`.canvas` 文件按 Obsidian Canvas 打开；其他 vault 文件在 Obsidian 支持时走原生打开路径。
- 下拉操作可包含 `查看差异`、`在文件夹中定位`、`复制 Obsidian 链接`，但只在对应能力可用时显示。
- 待审批 mutation review 不是已完成产物。apply/reject 前显示为 `action_required` 或 mutation review UI；apply/reject 后再把已应用文件显示到 `本次改动`。
- 产物元数据必须来自 trajectory mutations、tool target paths、replay summaries 或 runtime result 显式元数据。renderer 不得扫描 vault 或自行推断改动。

推荐 presentation surface values：

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

推荐 trigger reasons：

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

回答/结果 DOM 应与过程命名空间分离：

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

过程 renderer 可以渲染过程 disclosure，但文件产物卡片应跟随最终回答或由独立 result-artifact renderer 渲染。不要把文件卡片放进展开的过程步骤里，否则它会变成审计日志，而不是可操作结果。

UI 必须先区分三种 presentation mode：

```text
simple_thinking
  用于直接回答型问题；只展示 "FRIDAY 思考中" 这类轻量 live 状态。

stepped_process
  用于任务型工作；展示步骤、工具、证据、记忆、变更、审批、恢复。

completed_replay
  用于任务完成后的复盘；默认收起，可展开查看关键过程。
```

Collapsed 状态：

```text
[FRIDAY 图标] FRIDAY 的工作过程 58s >        [Cancel]
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
- 生命周期卡必须从主路径退场。替代形态应是 compact row/strip/disclosure，而不是另一个大卡片。
- 状态色要克制：running 用 accent，waiting 用 warning/interactive accent，failed 用 error，completed 用 success 或 muted green。
- 文本层级紧凑：标题、摘要、行标题、meta 四层即可。
- 动作按钮使用原生 Obsidian button 风格，主动作只有一个，其他为 ghost/secondary。
- timeline 行要稳定，不因文字长度改变整体布局。
- 移动/窄宽度下：阶段导航可横向滚动，timeline 保持单列，action slot 换行。

## 交互规范

- collapsed 默认显示，不占用过多聊天空间。
- hidden 是简单 completed answer 的默认状态。
- inline thinking 只允许在简单回答生成过程中出现；完成后消失。
- live running 时 collapsed 展示 current focus + last evidence。
- expanded 展示完整 process panel，但默认只显示最近若干条，提供“Show all”或渐进展开。
- completed disclosure 默认 collapsed，且只在复杂工作存在有意义 replay 时出现。
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
- process visibility gates
- completed replay visibility gates
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

设计原则：

- View model 可以把 `AgentTrajectoryItem` 分组、截断、排序、生成 display label。
- View model 必须能识别 simple answer / stepped process / completed replay。
- simple answer 的 live UI 只显示轻量 thinking，不渲染完整 process panel。
- simple answer 完成后不渲染任何 process surface，也不显示 completed replay。
- lifecycle-only task events 不生成可见 lifecycle cards。
- completed replay 只有在 trigger reasons 证明存在有意义工作时才显示。
- stepped process 要把 context/model/tool/mutation/approval/failure 组织成可展开 step groups。
- 文件产物是结果元数据，不是过程元数据。它属于 `resultArtifacts` / `diffSummary`，并在回答正文之后渲染。
- `resultArtifacts` 必须从现有 trajectory/runtime facts 派生；view model 可以按扩展名分类文件类型，但不得访问 vault。
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
- simple answer completed snapshot returns `surface: "hidden"`、`shouldRenderProcessPanel: false`、`shouldRenderCompletedReplay: false`。
- lifecycle-only task events do not render visible lifecycle cards.
- running snapshot exposes current item, compact summary, cancel action.
- 工具/文件/上下文工作默认返回 `surface: "compact_live_process"`。
- 工具/文件/mutation 工作应为 created/modified/applied vault 文件返回 `resultArtifacts`，并在有统计时返回 diff summary。
- 文件产物类型标签应把 `.md` 归为 `文档 · MD`，`.canvas` 归为 `画布 · Canvas`，不支持的扩展名归为 `文件`。
- waiting approval snapshot prioritizes approval state and action/reason.
- failed snapshot exposes recovery panel and retry action when retryable.
- transport retry snapshot exposes reconnecting state, attempt/backoff summary, and no false checkpoint-resume claim.
- completed complex task snapshot exposes collapsed replay summary and evidence strip, with final answer priority preserved.
- mutation conflict/apply_failed snapshot exposes review/mutation strip.
- pending mutation review 在 apply/reject 解决前不渲染成已完成的 `本次改动` 产物。
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
- 这一行必须包含 FRIDAY 图标和 `FRIDAY 思考中` 文案。
- do not render stage navigation, evidence, mutation strip, completed replay, or lifecycle card.
- remove this row once the answer is complete.

**Step 3: Render compact process state**

Compact process view must render:

- status mark
- FRIDAY 图标
- disclosure label（`FRIDAY 的思路 {duration}s >` 或 `FRIDAY 的工作过程 {duration}s >`）
- headline
- summary
- current item or latest meaningful item
- primary available action if present
- details toggle

它应该是 strip/row/disclosure，而不是臃肿卡片。

compact process header 替代旧的独立 FRIDAY wordmark。不要在同一个过程 header 里同时渲染单独的 FRIDAY 标签和 `FRIDAY 的思路...`。

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

最终回答 renderer 或 DailyBoard wrapper 必须在回答正文之后渲染 `view.resultArtifacts`：

- 标题：`本次改动`
- 为 created/modified/applied vault 文件渲染文件卡片。
- 类型信息：`文档 · MD`、`画布 · Canvas` 或克制的 fallback。
- 主按钮：`打开`。
- 如果有增删行统计，显示 compact diff summary。
- 简单回答且无文件改动时不渲染 artifact section。
- apply/reject 尚未解决前，不把 pending mutation review 渲染成已完成产物。

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

测试应断言：

- new `friday-agent-process-*` classes exist.
- lightweight `friday-agent-process-thinking` exists.
- compact `friday-agent-process-strip` or equivalent row/disclosure class exists.
- assistant answer 的 document-flow class 存在，且 FRIDAY 回答不再依赖旧的大号 assistant 气泡。
- `friday-agent-artifacts`, `friday-agent-artifact-card`, and `friday-agent-artifact-diff-summary` exist.
- no nested card pattern is introduced for process panel.
- no bulky lifecycle-card primary path remains.
- process panel uses Obsidian variables.
- reduced motion media query exists if transitions are added.
- old `friday-runtime-card` is not required by renderer tests.

**Step 2: Implement CSS**

CSS 应覆盖：

- hidden/no-process state with no reserved whitespace.
- inline thinking row.
- 不带大号 assistant 气泡的回答文档流。
- compact process strip.
- compact header layout
- status tones
- stage navigation
- timeline rows and current row
- evidence/mutation chips
- recovery panel
- action row
- result artifact 文件卡片和 compact diff summary
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
- 如果 result artifacts 在 process renderer 之外渲染，则传入 artifact open handler

DailyBoard 不应自己构建显示分区。

**Step 2: Improve expansion behavior**

要求：

- simple completed answers render no process UI.
- lifecycle-only task records do not render visible cards.
- live running defaults collapsed unless user expanded.
- waiting/failure states may auto-expand only if existing UX supports it without surprise; otherwise show action prominently collapsed.
- completed disclosure remains collapsed by default and only appears for complex work.
- final answer remains visually primary over completed replay.
- FRIDAY assistant answers 以文档流渲染；用户消息可以继续使用气泡。
- result artifacts 在最终回答之后渲染，绝不放在回答上方。

**Step 3: Preserve action plumbing**

`handleTrajectoryAction()` should remain the only DailyBoard action bridge.

**Step 4: Wire file artifact opening**

要求：

- `打开` resolves the artifact path as a vault path.
- 如果文件存在，通过 app/workspace/vault API 在 Obsidian 工作区打开它，不通过 OS shell。
- `.md` 和 `.canvas` 必须都有测试覆盖。
- 缺失文件应显示克制的 notice 或 disabled state；点击处理器不得直接抛错。
- renderer 可以接收 `onOpenArtifact(path)` callback；除非 renderer 已经拥有这个边界，否则不得直接 import Obsidian API。

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
- Renderer is allowed to be fully rewritten, but it must remain snapshot-driven.
- Simple direct-answer turns show only lightweight `FRIDAY 思考中` live state and do not leave a heavy completed process panel.
- 每条 FRIDAY 回答/过程行都显示 FRIDAY 图标。
- 折叠过程文案遵循已确认标签：reasoning-only 回答使用 `FRIDAY 的思路 {duration}s >`，任务型工作使用 `FRIDAY 的工作过程 {duration}s >`。
- FRIDAY assistant answers 渲染为文档流内容，而不是大号 assistant 气泡。
- 简单 completed answers 不渲染持久 process UI、不渲染 completed replay、不渲染 lifecycle card。
- `task running/completed/final-delivered` 这类 lifecycle-only task records 不应独立生成可见卡片。
- Task-like turns show a stepped process with collapsible groups for memory/context/tools/evidence/mutations.
- Manus 参考只保留通用结构，不得把简历、Notion、联系方式、工作经历等截图示例内容硬编码进产品标签、类型、测试或夹具。
- Collapsed view clearly shows status, current activity, summary, and available primary action.
- Expanded view shows stage navigation, current focus, timeline, evidence, mutation/review, recovery, and actions.
- Waiting approval/user, failed, cancelled, safe_stopped, completed, running states have explicit visual coverage.
- Batch M.1 的 network reconnecting/retrying/exhausted transport states 有明确视觉和测试覆盖。
- Completed replay 只是复杂工作的次级折叠审计入口；最终回答保持视觉优先。
- created/modified/applied 文件在回答之后的 `本次改动` artifact section 中渲染。
- 文件产物卡包含类型感知标签，例如 `文档 · MD` 和 `画布 · Canvas`。
- 文件 `打开` 操作在 Obsidian 工作区打开 vault 文件，并覆盖 `.md` 和 `.canvas`。
- Pending mutation review 在 apply/reject 解决之前不显示为已完成产物。
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
- 生命周期卡过于臃肿，不能继续作为默认展示。请用 hidden/inline/compact strip/collapsed disclosure 这些轻量表面替代。
- 只参考 Manus 的结构规则：简单直接回答只显示轻量 `FRIDAY 思考中`，不要展示完整过程面板；任务型工作才展示可展开/收起的步骤过程。不要复制或固化截图里的简历、Notion、联系方式等具体业务内容。
- 简单 completed answer 必须不渲染持久 process UI，也不渲染 completed replay。
- 最终回答必须保持视觉主位；completed replay 只作为复杂工作的次级折叠入口。
- 只重做 trajectory-driven presentation layer。
- 不改 Kernel v2 所有权，不重新解释 RuntimeProgressEvent.phase。
- DailyBoard 继续只传 AgentTrajectorySnapshot、expanded、action handler、translator、avatar renderer。
- 可以新增 src/views/agentProcessPanelViewModel.ts。
- 可以重写 src/views/agentTrajectoryRenderer.ts。
- 可以新增 friday-agent-process-* CSS，并让它成为主 DOM/CSS contract。
- 必须支持 step groups：每个执行环节可以展开/收起其中的记忆、工具调用、证据和变更信息。
- 必须把 Batch M.1 的 transport trajectory facts 渲染成 reconnecting/retrying/exhausted 过程状态。Batch L 不得声称 checkpoint resume。
- 必须在 FRIDAY 回答/过程行显示 FRIDAY 图标。
- 使用已确认过程文案：`FRIDAY 思考中`、`FRIDAY 的思路 {duration}s >`、`FRIDAY 的工作过程 {duration}s >`。
- FRIDAY assistant answers 应以文档流渲染，不再使用大号 assistant 气泡；用户消息可以继续保留气泡。
- 在最终回答之后，用 `本次改动` artifact section 渲染本轮创建、修改、已应用的具体文件。
- 文件产物卡必须支持 `.md` 和 `.canvas`，显示 `文档 · MD` / `画布 · Canvas`，并通过 Obsidian API 在工作区打开 vault 文件。
- apply/reject 解决之前，不要把 pending mutation review 渲染成已完成文件产物。
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
7. 简单 completed answers 是否不渲染持久 process UI、不渲染 completed replay、不渲染 lifecycle card。
8. lifecycle-only task records 是否不会生成可见 running/completed/final-delivered 卡片。
9. 任务型工作是否显示可展开/收起的 step groups，且每个环节能容纳记忆、工具调用、证据、变更信息；同时确认没有硬编码 Manus 截图里的简历、Notion、联系方式、工作经历等具体业务内容。
10. FRIDAY 图标和已确认过程文案是否正确渲染：`FRIDAY 思考中`、`FRIDAY 的思路 {duration}s >`、`FRIDAY 的工作过程 {duration}s >`。
11. FRIDAY assistant answers 是否以文档流渲染，而不是大号 assistant 气泡。
12. expanded view 是否显示 stage/current/timeline/evidence/mutation/recovery/actions。
13. Batch M.1 的 network reconnecting/retrying/exhausted 状态是否从 trajectory items 渲染，而不是 UI timer 本地推断。
14. completed replay 是否默认折叠、次级显示，并且不会出现在最终回答上方。
15. `本次改动` 是否只为 created/modified/applied files 出现在回答之后。
16. 文件产物卡是否显示类型感知标签、compact diff summary 和 `打开` 操作。
17. `打开` 是否在 Obsidian 工作区打开 `.md` / `.canvas` vault 文件，而不是打开系统文件管理器。
18. waiting approval/user、failed、cancelled、safe_stopped、completed、running 是否有测试覆盖。
19. actions 是否仍来自 snapshot.actions，renderer 不自行判断业务可用性。
20. CSS 是否 Obsidian-native、responsive、accessible，且无 nested card/decorative blob/glassmorphism。
21. 是否没有混入 Wiki/RAG/MCP/Build/background/multi-agent。

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
