# Native Kit UI Reconstruction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 FRIDAY 插件的真实 UI 严格还原 `docs/design/native-kit-catalog.html` 中已经确认的 Native Kit 状态，而不是沿用当前旧 UI 惯性做局部美化。

**Architecture:** `native-kit-catalog.html` 是视觉真源，`friday-native-kit.md` 是产品与信息结构真源，真实代码只负责把运行时数据投影成这些状态。实现时优先修正 view model 的字段语义，再改 renderer DOM，最后移植 CSS token 和动效。

**Tech Stack:** Obsidian plugin DOM API, TypeScript, `styles.css`, Node test runner, existing FRIDAY runtime trajectory and composer view models.

---

## 给聚合开发窗口的开场指令

把下面这段作为开发窗口第一条任务说明：

```text
你要执行的是 FRIDAY Native Kit UI 还原，不是现有 UI 的微调。

必须先阅读并对照：
- docs/design/native-kit-catalog.html
- docs/design/friday-native-kit.md
- docs/design/friday-native-kit-migration-map.md
- docs/design/obsidian-plugin-ui-contract.md
- docs/plans/2026-05-14-native-kit-ui-reconstruction-handoff.zh.md

视觉真源是 native-kit-catalog.html。现有 src/views 和 styles.css 只能作为数据来源和待迁移实现参考，不能作为设计依据。

实现时必须按 HTML 中的 class、DOM 层级、信息顺序、动效和状态拆分还原。若现有 UI 与 HTML 冲突，以 HTML 为准；若现有数据字段不足，先补 view model 字段，不要用旧 UI 结构凑视觉结果。
```

## 不可妥协规则

- 不要把当前过程面板当成设计真源。它是待迁移对象。
- 不要新增独立的“执行过程时间线”组件。复杂任务过程属于助手消息的过程态和结果态展开。
- 不要把工具调用做成大卡片。工具调用是低强调子层级。
- 不要在正在执行且结果未返回的步骤下显示阶段性叙述。
- 不要把过程叙述放在工具调用细节上方。展开后顺序必须是：步骤行 -> 工具调用细节 -> 过程叙述。
- 不要用硬编码颜色、强渐变、发光、玻璃态、营销卡片或饱和成功绿。
- 不要只做静态颜色近似。运行中表面的低幅度扫光动效必须落到真实 CSS，并支持 `prefers-reduced-motion`。
- 不要用“现有测试没失败”作为验收。必须增加 Native Kit 契约测试和截图/浏览器核对。

## 视觉真源定位

开发窗口必须按这些 HTML 位置还原：

- 助手消息：`docs/design/native-kit-catalog.html` 中 `data-component="助手消息"`。
- 过程步骤：`.assistant-process-step-v6`。
- 过程步骤行：`.assistant-process-event-v6`。
- 工具调用细节：`.assistant-tool-call-v5`。
- 过程叙述：`.assistant-step-narration-v6`。
- 运行中表面：`.kit-running-surface-v1`。
- 对话输入区与 Task Bar：`data-component="对话输入区"`。
- Task Bar：`.composer-taskbar-kit-v5`、`.composer-taskbar-summary-v5`、`.composer-taskbar-task-v5`。
- 产物列表：`.assistant-artifact-list-v4`、`.assistant-artifact-row-v4`。

## 产品状态契约

### 助手消息状态

View model 应输出这些明确状态，不要让 renderer 猜：

| 状态 | 顶部显示 | 过程显示 | 正文 |
| --- | --- | --- | --- |
| `thinking` | `FRIDAY 正在思考 {elapsed}` | 不显示 | 不显示或流式占位 |
| `working` | `FRIDAY 正在工作 {elapsed}` | 自然展开过程步骤 | 可无正文 |
| `simple_result` | `FRIDAY 已思考 {elapsed}` | 不显示 | 普通文档流正文 |
| `complex_result` | `FRIDAY 已完成工作 {elapsed} >` | 默认收起，可展开 | 正文 + 可选产物 |

字段建议：

```ts
type AssistantMessageState =
  | "thinking"
  | "working"
  | "simple_result"
  | "complex_result";

interface AssistantMessageView {
  state: AssistantMessageState;
  elapsedLabel: string;
  bodyText?: string;
  process?: AssistantProcessView;
  artifacts?: AssistantArtifactView[];
}
```

### 过程步骤字段

```ts
interface AssistantProcessStepView {
  id: string;
  title: string;
  detail: string;
  status: "completed" | "running" | "pending" | "waiting" | "failed";
  toolCalls: AssistantToolCallView[];
  narration?: AssistantStepNarrationView;
}

interface AssistantToolCallView {
  id: string;
  name: string;
  detail: string;
  status: "completed" | "running" | "failed";
}

interface AssistantStepNarrationView {
  text: string;
  source: "runtime" | "model" | "fallback";
}
```

字段规则：

- `running` 步骤不允许有 `narration`，除非该叙述属于上一个已经完成的步骤。
- `completed` 步骤可以有 `narration`。
- `narration.text` 是阶段性工作日志，不是模型私有推理。
- `toolCalls` 可以在步骤收起时隐藏，但数据必须保留。
- 步骤标题和 detail 必须单行省略，不换行撑高。

### 过程 DOM 顺序

每个完成步骤必须渲染为：

```html
<div class="assistant-process-step-v6">
  <button class="kit-event-row-v1 assistant-process-event-v6 assistant-step-toggle-v6">...</button>
  <div class="assistant-step-detail-v6">
    <div class="assistant-step-detail-inner-v6">
      <div class="kit-event-row-v1 assistant-tool-call-v5">...</div>
    </div>
  </div>
  <div class="assistant-step-narration-v6">...</div>
</div>
```

正在执行步骤必须渲染为：

```html
<div class="assistant-process-step-v6">
  <button class="kit-event-row-v1 kit-running-surface-v1 assistant-process-event-v6 assistant-step-toggle-v6">...</button>
  <div class="assistant-step-detail-v6">
    <div class="assistant-step-detail-inner-v6">
      <div class="kit-event-row-v1 assistant-tool-call-v5">...</div>
    </div>
  </div>
</div>
```

## Task Bar 字段契约

```ts
interface ComposerTaskBarView {
  expanded: boolean;
  statusLabel: "正在执行" | "待确认" | "已暂停" | "已完成";
  currentIndex: number;
  total: number;
  title: string;
  elapsedLabel: string;
  tasks: ComposerTaskView[];
}

interface ComposerTaskView {
  id: string;
  index: number;
  title: string;
  status: "completed" | "in_progress" | "pending" | "blocked" | "failed";
}
```

规则：

- 收起态贴住输入框上方。
- 展开态仍在输入框上方，输入框不能被 Task Bar 占用。
- 展开态必须显示 pending 后续步骤，不能只显示 completed 和 in_progress。
- 正在执行步骤用整体弱背景，不给每个子项单独强 icon。
- 长标题单行省略。

## 动效还原契约

运行中表面必须还原 HTML 中 `.kit-running-surface-v1` 的细腻效果：

- 弱背景：使用 `color-mix()` 混合 `var(--interactive-accent)` 和 Obsidian 背景变量。
- 扫光层：用 `::after`，`pointer-events: none`。
- 动画：`transform: translateX(...)`，`1600ms` 到 `1800ms`，`ease-in-out`，无限循环。
- 动画范围：只作用在运行中行或 Task Bar，不让大块正文持续动。
- reduced motion：`@media (prefers-reduced-motion: reduce)` 中禁用动画并隐藏扫光层。
- 实现时可以沿用生产 CSS 中已有 `friday-kit-running-line`，但视觉必须接近 catalog 的扫光效果；如果不够接近，就按 catalog 的 `friday-kit-running-sheen` 调整。

验收时必须检查：

- 正在执行的过程步骤有缓慢扫光，不只是静态浅色背景。
- Task Bar 运行中状态有同一类低幅度扫光。
- 明暗主题下扫光不刺眼。
- reduced motion 下无持续动画。

## 文件 Ownership

并行开发时必须按下面拆分，避免互相覆盖：

### Worker A: 过程/消息 view model

负责：

- `src/views/agentProcessPanelViewModel.ts`
- `src/core/trajectory/AgentTrajectoryProjector.ts`，仅限必要字段投影
- `tests/agent-process-panel-view-model.test.mjs`

目标：

- 输出 `thinking / working / simple_result / complex_result` 的稳定视图状态。
- 明确 `process.steps[].toolCalls` 和 `process.steps[].narration`。
- 保证 running step 不输出阶段性叙述。

### Worker B: 助手消息 renderer

负责：

- `src/views/agentTrajectoryRenderer.ts`
- `tests/daily-board-agent-trajectory-ui.test.mjs`

目标：

- DOM 层级还原 HTML。
- FRIDAY 身份行、复杂结果展开、步骤展开、产物列表按 catalog 实现。
- 工具调用细节弱于步骤行。

### Worker C: Composer / Task Bar / 审批组合态

负责：

- `src/views/DailyBoardView.ts`
- `src/views/components/MentionComposer.ts`
- `src/views/components/MentionDropdown.ts`
- `tests/daily-board-ui-regression.test.mjs`
- `tests/chat-composer-queue-regression.test.mjs`
- `tests/mention-dropdown-pointer-regression.test.mjs`

目标：

- Task Bar 贴住输入框。
- Skill 和 `@` 浮层向上展开。
- 审批强提醒占用输入区。
- 移除输入框下方小上下文状态条。

### Worker D: CSS / 动效 / 元组件

负责：

- `styles.css`
- `tests/agent-process-panel-style-regression.test.mjs`
- `tests/design-guidelines-regression.test.mjs`

目标：

- 移植 `kit-event-row-v1`、`assistant-tool-call-v5`、`assistant-step-narration-v6`、`kit-running-surface-v1`。
- 确保运行中扫光和 reduced motion。
- 禁止大卡片、强绿成功态、硬编码主题色。

## 实施顺序

### Task 1: 写 Native Kit 契约测试

**Files:**

- Modify: `tests/agent-process-panel-view-model.test.mjs`
- Modify: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Modify: `tests/agent-process-panel-style-regression.test.mjs`

**Steps:**

1. 添加测试：running step 没有 narration。
2. 添加测试：completed step 的 DOM 顺序是 tool call detail 在 narration 上方。
3. 添加测试：complex result 默认收起过程，点击 FRIDAY 行可展开。
4. 添加测试：`.kit-running-surface-v1::after` 存在动画，reduced motion 禁用动画。
5. 运行对应测试，确认新增测试在当前实现下能暴露差异。

Run:

```powershell
node --test tests/agent-process-panel-view-model.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-style-regression.test.mjs
```

### Task 2: 修 view model 字段

**Files:**

- Modify: `src/views/agentProcessPanelViewModel.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts` only if required

**Steps:**

1. 定义或收敛助手消息状态字段。
2. 把 narration 绑定到 completed step。
3. 把 tool calls 保留为 step 子层级。
4. 不用旧 timeline phase 标题作为用户可见信息。
5. 运行 Task 1 的 view model 测试。

### Task 3: 修 renderer DOM

**Files:**

- Modify: `src/views/agentTrajectoryRenderer.ts`

**Steps:**

1. 按 HTML 还原 FRIDAY 身份行。
2. 按 HTML 还原 working / simple_result / complex_result。
3. 按 HTML 还原 step toggle、step detail、narration 的顺序。
4. 确保简单回答不渲染过程。
5. 确保 complex result 默认收起，展开后可见每个步骤。

### Task 4: 移植 CSS 和动效

**Files:**

- Modify: `styles.css`

**Steps:**

1. 对齐 `.kit-event-row-v1` 单行省略规则。
2. 对齐 `.assistant-tool-call-v5` 的低强调高度、边框、透明度。
3. 新增或对齐 `.assistant-step-narration-v6`。
4. 对齐 `.kit-running-surface-v1::after` 扫光。
5. 确保 `@media (prefers-reduced-motion: reduce)` 禁用持续动画。

### Task 5: Composer / Task Bar 组合态

**Files:**

- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/views/components/MentionComposer.ts`
- Modify: `src/views/components/MentionDropdown.ts`
- Modify: `styles.css`

**Steps:**

1. Task Bar 收起态贴住输入框上方。
2. Task Bar 展开态显示 pending 后续步骤。
3. 输入框保留模型、权限、`@`、`+Skill`、发送。
4. Skill 列表项显示技能名，不显示 `Skill` 前缀。
5. Skill token 显示技能名，不显示 `/`。
6. `@` 文件选择列表用文件类型 icon，已选 token 不带 icon。
7. 审批强提醒占用输入区。

### Task 6: 浏览器和 Obsidian 视觉验收

**Steps:**

1. 打开 catalog：`http://127.0.0.1:4177/docs/design/native-kit-catalog.html`。
2. 打开真实插件界面。
3. 对照以下状态截图：
   - working assistant message。
   - complex result collapsed。
   - complex result expanded。
   - completed step expanded。
   - running step with sheen。
   - Task Bar collapsed attached to composer。
   - Task Bar expanded with pending tasks。
   - Skill picker above input。
   - `@` file picker above input。
   - approval occupying composer.
4. 对每张截图写一句差异结论；没有差异才进入最终测试。

### Task 7: 全量验证

Run:

```powershell
npm test
```

最低验收：

- Native Kit catalog tests pass.
- Agent process view model tests pass.
- DailyBoard UI regression tests pass.
- Style regression tests pass.
- Obsidian live UI 与 catalog 的信息层级、间距、动效一致。

## 最终交付格式

开发窗口最终回复必须包含：

- 修改过的文件列表。
- 哪些 HTML 状态已还原。
- 哪些字段契约已落地。
- 哪些旧 UI 惯性结构被移除。
- 动效如何实现，reduced motion 如何处理。
- 测试命令和结果。
- 仍未处理的差异，不能笼统写“基本一致”。

