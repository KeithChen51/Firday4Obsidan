# FRIDAY Intake、Plan Tool 与过程叙事产品优化方案

> **给开发窗口：** 实施本文档时，请使用 `superpowers:executing-plans`，按任务逐项实现和验证。

**目标：** 明确定义 FRIDAY 从接收用户消息、理解任务、按需规划、执行过程展示，到模型请求重试文案的最新产品方向。

**架构思路：** FRIDAY 不再把工作过程展示做成固定节点流水线，而是增加一个轻量 Intake 入口判断任务复杂度；Plan 作为内部编排工具按需启用；过程面板消费结构化的理解、计划、当前阶段和恢复事件。底层模型请求、工具调用、trace 仍保留为诊断数据，但不直接变成用户看到的主叙事。

**技术范围：** Obsidian 插件、TypeScript、Agent Kernel 运行时事件、trajectory projection、Daily Board 过程面板 view model。

---

## 1. 背景

这份文档沉淀近期关于 FRIDAY 工作过程展示的最新决议。

最初暴露的问题包括：

- 执行中展开的工作过程，和最终回答后再次展开看到的内容不一致。
- 过程信息太技术化、太重复，用户很难理解 FRIDAY 每一步在做什么。
- 复杂任务没有稳定地先总结理解、再展示计划、再阶段性汇报。
- 普通模型请求被误显示成“正在重试”“模型连接不稳定”。
- 过程 UI 过于节点化，不像 Manus、Claude Code、Codex 这类成熟 agent 产品的分层过程展示。
- agent 运行中，历史对话消息上方看不到可展开的过程信息，往往要等任务完成后才出现。
- agent 执行任务时，用户无法自由点击其他页面，任务像阻塞了整个插件，而不是在后台运行。
- 审批相关设计已经拆到另一个窗口，本方案不再处理审批。

我们希望新的方向接近以下体验：

- FRIDAY 先理解用户请求，并在合适时用一句话说明自己的理解。
- 复杂任务先生成可见计划，再开始执行。
- 计划在执行中持续更新，而不是一次性静态文本。
- 工具调用、模型请求、重试等底层事件只作为当前阶段下的证据或技术细节。
- 普通模型请求不是异常，不应被包装成重连或重试。
- 用户可以离开对话页去做其他事情；任务在后台继续运行，只保留清晰的状态提醒。

## 2. 产品原则

### 2.1 用户看到的是叙事，不是遥测

过程面板要回答用户真正关心的问题：

- FRIDAY 理解了什么？
- FRIDAY 现在在做什么？
- 刚刚完成了什么？
- 接下来准备做什么？
- 是否遇到了问题？是否正在恢复？

过程面板不应该把 `model_request`、`request_started`、`tool_result`、`checkpoint`、`attempt 1/4` 这类底层事件直接当作一级步骤展示。

### 2.2 Plan 是能力，不是固定流程节点

不要把所有任务硬编码成：

```text
收到任务 -> 整理方案 -> 读取项目现状 -> 执行 -> 完成
```

更好的结构是：

```text
用户消息
-> Intake：理解任务并判断复杂度
-> 判断是否需要可见计划
-> 需要时创建 living plan
-> 执行中更新当前计划项
-> 情况变化时修订计划
-> 完成后总结结果
```

这样简单任务不会被迫展示无意义计划，复杂任务也能有清晰结构。

### 2.3 重试文案必须准确

普通模型请求不是“重连”。

只有真实 retry 生命周期事件才进入用户可见的恢复叙事：

- `retry_scheduled`
- `retry_started`
- `request_exhausted`

`request_started` 和 `request_succeeded` 可以继续作为内部诊断遥测，但不应显示为“正在重试”或“模型连接不稳定”。

### 2.4 渐进式披露

FRIDAY 应按任务复杂度决定展示多少过程：

- 简单任务：直接回答，不展示计划。
- 轻任务：可以只显示 `FRIDAY 正在思考` 或一个紧凑当前动作。
- 复杂任务：显示理解、计划、当前阶段、阶段性汇报。
- 出错或重试：只有真实需要恢复时才展示恢复状态。

### 2.5 agent 任务不应阻塞用户使用插件

用户发起一个复杂任务后，不应该被锁在当前对话界面。

FRIDAY 任务应被视为后台任务：

- 任务继续执行。
- 用户可以切换到其他页面、查看文件、使用同步或工具页面。
- 全局只显示一个轻量任务状态提醒。
- 用户需要时可以点击状态提醒回到对应对话和任务过程。

任务运行状态至少包括：

- `正在运行`
- `运行异常`
- `任务完成`

如果任务需要用户处理审批或澄清问题，这属于另一个审批/输入交互设计，不在本文档展开，但状态提醒必须能进入“需要关注”语义。

## 3. Intake 设计

### 3.1 作用

Intake 是用户发出消息后的轻量入口判断。

它不是完整计划，不加载完整 skill，不执行工具，也不写文件。它只负责快速判断这条请求应该如何处理，并在合适时告诉用户 FRIDAY 是怎么理解的。

### 3.2 用户可见表现

工作开始前，FRIDAY 可以短暂显示：

```text
FRIDAY 正在理解你的请求
```

对于很短的请求，也可以只显示：

```text
FRIDAY 正在思考
```

随后，FRIDAY 可以输出一句简短理解：

```text
我理解你希望整理工作过程展示规则，并修正模型请求重试文案。
```

这句话应作为 FRIDAY 的自然开场，不要用 `已理解任务`、`任务理解` 这类结构化标题包起来。表达应使用第一人称，并结合 SOUL 设置调整语气；例如 SOUL 偏稳重时更克制，SOUL 偏亲近时可以更口语，但都不应变成系统字段说明。

简单任务可以跳过这一步，直接进入回答。

### 3.3 Intake 决策结构

建议内部结构：

```ts
type IntakeDecision = {
  complexity: "simple" | "light" | "complex" | "unclear";
  understanding: string;
  route: "answer" | "clarify" | "plan_and_execute";
  shouldShowProcess: boolean;
  shouldUseVisiblePlan: boolean;
  expectedNeedsTools: boolean;
  expectedNeedsFileMutation: boolean;
  candidateSkills: Array<{
    id: string;
    reason: string;
    confidence: "low" | "medium" | "high";
  }>;
};
```

### 3.4 复杂度规则

`simple`

- 一次性问答、短句改写、解释类请求，或不需要规划的小操作。
- 不展示可见计划。
- 模型请求默认隐藏，必要时只显示 `FRIDAY 正在思考`。

`light`

- 需要一两个本地动作，但没有明显多步骤协调。
- 默认不展示完整计划。
- UI 可以显示紧凑当前动作，例如 `正在读取项目现状`。

`complex`

- 多步骤工作、文件修改、设计规划、调试、研究，或明显需要多轮推进的任务。
- 使用 `plan_create`。
- 默认展示过程面板和 visible plan。

`unclear`

- 先询问澄清问题，或说明当前不确定点。
- 不创建计划，直到下一步足够明确。

### 3.5 Skill 处理边界

Intake 可以识别候选 skill，但不加载完整 skill 内容。

推荐边界：

- Intake 可以判断：“这个任务可能需要文档/规划/设计类 skill。”
- 真正加载 skill 发生在后续正常 skill/tool 阶段。
- 这样可以保持渐进式披露，避免一开始就塞入大量上下文。

## 4. Plan 作为内部工具

### 4.1 决议

Plan 应该实现成内部编排工具，而不是前端固定流程阶段。

用户不需要知道 Plan 是 tool。用户看到的只是：当任务确实复杂时，FRIDAY 展示了一个清晰计划，并随着执行更新。

### 4.2 工具协议

建议提供一组内部工具或等价状态协议：

```ts
plan_create({
  reason: string;
  visibility: "visible" | "internal";
  tasks: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed";
  }>;
})
```

```ts
plan_update({
  taskId: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  summary?: string;
  justDone?: string;
  next?: string;
})
```

```ts
plan_revise({
  reason: string;
  changes: Array<{
    type: "add" | "remove" | "rename" | "reorder" | "status";
    taskId?: string;
    title?: string;
    status?: "pending" | "in_progress" | "completed" | "blocked";
  }>;
})
```

```ts
plan_complete({
  summary: string;
})
```

```ts
plan_skip({
  reason: string;
})
```

### 4.3 不变量

- 同一时间最多只能有一个 `in_progress` 计划项。
- 复杂任务正式执行前应调用 `plan_create`。
- 当前阶段变化、完成重要步骤、准备进入下一阶段时，应调用 `plan_update`。
- 如果新上下文推翻了原计划，应调用 `plan_revise`，而不是硬套旧计划。
- 计划状态必须能 replay，最终回答后再次展开也要一致。
- Plan 状态不是审批状态，不处理权限确认。

### 4.4 可见性策略

`visible`

- 用于复杂任务。
- 展示在过程面板里。
- 最终回答可以总结已完成计划项。

`internal`

- 用于轻任务。
- 模型内部仍可用计划保持秩序，但用户不一定看到完整计划。
- UI 最多展示当前动作。

### 4.5 为什么不做硬编码 Plan 阶段

硬编码 Plan 阶段假设所有任务形状一致，会导致简单任务被迫展示假计划，也会在执行中发现新情况时变得僵硬。

Plan tool 更合适：

- 需要时才创建计划。
- 可以在工具结果改变情况时修订计划。
- UI 消费稳定结构化数据，不靠猜测底层事件。
- 模型会更有纪律，类似 Claude Code 的 TodoWrite 思路。
- Plan 是一个可进入、可更新、可退出的能力，而不是所有任务必经的固定 UI 阶段。

## 5. 用户可见过程模型

### 5.1 收起态

过程区属于触发本次任务的 FRIDAY 消息，而不是 composer bar。

收起态只显示一个高信号状态：

```text
FRIDAY 正在思考
```

```text
正在执行：读取项目现状 · 18s
```

```text
网络波动，正在恢复请求（第 1/5 次）
```

```text
已处理 2m 11s
```

不要显示原始事件名，也不要重复展示 transport 细节。

### 5.2 展开态

展开过程区应位于 FRIDAY Intake 回答下方，按时间线一条一条展示。

结构参考 Manus：先有一条自然的 Intake 句，下面是任务节点；每个任务节点可以包含“做了什么”、关键工具活动、阶段性判断和必要的技术细节。用户不需要在 composer bar 里阅读过程。

推荐结构：

```text
已处理 2m 11s

我理解你希望优化工作过程展示，并修正模型请求重试文案。

✓ 明确 Intake 与复杂度判断
  我已经确认：复杂任务需要先输出自然理解句，再决定是否创建 visible plan。
  · 查看现有 narration payload
  · 对齐 SOUL 语气规则

⏳ 设计 Plan tool 与过程展示
  正在把计划进度和工作过程拆成两层：Task Bar 只显示进度，过程区展示具体执行。
  · 参考 Manus 的任务节点表达
  · 调整 Composer Task Bar 的职责边界

○ 修正模型请求/重试文案
○ 整理开发验收口径

技术细节
  已读取 3 个文件
  已运行 1 条命令
```

主表面是 FRIDAY 的自然开场和 Intake 下方的线性工作过程。技术细节是二级信息，默认折叠，不能和上层叙事重复。

注意：`understanding` 是数据字段，不是 UI 标题。UI 里不要显示 `已理解任务` 这类字段名，除非进入开发者诊断视图。

### 5.3 Composer Task Bar

触发 visible plan 后，composer/input box 内部可以显示一个轻量 Task Bar。

这个 bar 只负责回答“当前任务总进度走到哪一步”。它是任务定位器和进度提醒，不承载工作过程叙事。

工作过程叙事必须放在 FRIDAY Intake 回答下方，一条一条线性体现“任务节点 + 做了什么”。

收起态示例：

```text
正在执行 · 2/5 · 设计 Plan 展示 · 42s  ˅
```

展开态示例：

```text
✅ 1/5 明确问题
⏳ 2/5 设计 Plan 展示
⭕ 3/5 排查重试文案
⭕ 4/5 整理开发验收口径
⭕ 5/5 汇总结果
```

交互要求：

- bar 占用对话框内部空间，不做 modal，也不悬浮遮挡对话。
- bar 位于输入框上方，但仍属于 composer 容器。
- 当前任务行高亮，显示加载中状态。
- 收起态只显示当前任务序号、任务名、状态和执行时间。
- 展开后只显示完整计划任务列表，不显示“当前/刚刚/接下来”这类过程摘要。
- 完整计划任务列表和工作过程叙事是两个层次：前者在 Composer Task Bar，回答“总共几步、走到哪一步”；后者在 Intake 下方，回答“这一刻具体做了什么、正在做什么、遇到了什么”。
- 展开态不展示底层工具事件。
- 技术细节仍放在 Intake 下方过程 disclosure 的二级展开区或诊断展开区。
- 当任务运行时，输入框仍可输入；如果当前任务不能并发处理新消息，提示 `当前任务正在执行，新消息会自动排队。`

未来扩展：

- Composer Task Bar 可以预留 action slot，用于以后承接审批、确认、选择等动作。
- 本次不实现审批动作，不改变审批权限、文件 mutation review 或全自动模式策略。
- 预留只意味着结构上不要把 bar 写死为“只能展示计划”；不要在本轮放入审批 UI 或审批逻辑。

参考素材：

- 当前主参考图：`docs/assets/friday-process-ux/friday-process-four-states-reference.png`。
- 该图覆盖四个验收状态：简单回答任务、计划型任务执行中 Bar 收起、计划型任务执行中 Bar 展开、计划型任务已完成 Bar 收起。
- 历史参考图：`docs/assets/friday-process-ux/composer-task-bar-expanded-plan-reference.png`。
- 历史参考图只参考 composer 内部占位、Task Bar 位置和进度入口形态；如果图里把过程摘要放进 bar，应以当前主参考图和本文档文字为准。
- 开发时以本文档的信息分层为准，不要求逐像素复刻图像细节。

### 5.4 最终回答区域

完成后，最终回答下方应立即显示产物和修改摘要，不需要切换对话才出现。

本文档不重新定义这块 UI 细节，但保留之前的要求：

- 最终回答。
- 产物。
- 修改文件。
- 关键差异或验证说明。

### 5.5 运行中历史消息也要可展开过程

当前问题：agent 正在工作时，上方历史对话消息看不到可展开的过程信息，通常要等任务完成后才能看到。

目标行为：

- 用户消息一旦触发 agent task，就应立即在对应对话位置生成过程 disclosure。
- 过程 disclosure 在任务运行中也可以展开和收起。
- 展开后看到的 live 过程，应与任务完成后的 replay 过程使用同一套 view model 和视觉结构。
- 任务完成后，原位置的过程 disclosure 更新为已完成状态，而不是重新生成另一套不同内容。
- 如果用户向上滚动查看历史消息，仍能看到每个相关任务的过程入口。

这意味着过程展示不能只挂在“当前正在输出的底部区域”，也不能只在 final answer 渲染后才生成。

推荐数据关系：

```text
conversation message
  -> taskId / turnId
  -> live AgentTrajectorySnapshot
  -> process disclosure
```

同一条任务的 live snapshot 和 replay summary 必须最终收敛到同一个过程视图。

### 5.6 后台任务状态提醒

当用户离开对话页面时，agent task 继续后台运行。

界面上保留一个轻量状态提醒即可：

```text
FRIDAY 正在运行：整理工作过程展示方案
```

```text
FRIDAY 运行异常：需要查看
```

```text
FRIDAY 已完成：查看结果
```

交互要求：

- 状态提醒不应阻挡页面点击。
- 状态提醒应可点击，点击后回到对应对话和任务位置。
- 如果有多个任务，第一版可以只支持当前 active task；后续再扩展为任务列表。
- 任务完成提醒可以短暂保留，用户查看后降级或消失。
- 运行异常提醒应保留，直到用户查看或任务被恢复/取消。

实现上应避免用一个全局 `aiBusy` 禁用整个 Daily Board 或插件主界面。`aiBusy` 只应该限制会与当前 agent task 冲突的输入或操作，不应阻塞普通导航、页面切换、查看文件、查看设置等动作。

## 6. 模型请求与重试语义

### 6.1 当前问题

当前运行时可能产生以下 transport 事件：

- `request_started`
- `request_succeeded`
- `retry_scheduled`
- `retry_started`
- `request_exhausted`

问题是 UI 容易把所有 transport 事件都当成 retry/reconnect，导致普通模型请求也显示成：

```text
正在重试
模型连接不稳定，正在恢复。
第 1/4 次重试
```

这是不准确的。

### 6.2 产品规则

普通模型请求默认隐藏，或者只显示：

```text
FRIDAY 正在思考
```

只有真实 retry 事件才进入恢复叙事。

### 6.3 重试文案

使用：

```text
网络波动，正在恢复请求
```

可选次数：

```text
网络波动，正在恢复请求（第 1/5 次）
```

全部失败：

```text
请求多次未成功，请稍后重试
```

避免：

```text
模型连接不稳定
重新连接模型
第 1/4 次重试
```

除非系统能够证明真的发生了连接断开，否则不要使用“重连”。多数情况下，“恢复请求”更准确。

### 6.4 重试次数

设置：

```ts
MAX_RETRY_ATTEMPTS = 5
```

产品口径：

```text
首次请求 + 最多 5 次恢复请求
```

技术含义：

```text
最多总尝试次数 = 6
```

UI 只暴露 `maxRetries = 5`，不要暴露总尝试次数。

推荐 UI 展示结构：

```ts
type RetryDisplayState = {
  retryAttempt: number;
  maxRetries: number;
  status: "scheduled" | "running" | "exhausted";
  delayMs?: number;
  httpStatus?: number;
};
```

不要再从原始 `attempt/maxAttempts` 推导用户文案。

## 7. 事件映射规则

### 7.1 模型 transport 事件

| 运行时事件 | 用户可见行为 |
| --- | --- |
| `request_started` | 隐藏，或显示 `FRIDAY 正在思考` |
| `request_succeeded` | 隐藏 |
| `retry_scheduled` | `网络波动，正在恢复请求（第 n/5 次）` |
| `retry_started` | `网络波动，正在恢复请求（第 n/5 次）` |
| `request_exhausted` | `请求多次未成功，请稍后重试` |
| 非 retryable 的 `request_failed` | 显示简短失败说明，不进入 retry 恢复叙事 |

### 7.2 工具和运行细节

工具调用应挂在当前计划项下面。

推荐：

```text
当前执行：读取项目现状
  已读取 4 个文件
  已运行 1 条命令
```

避免：

```text
读取上下文
ls
ls 123
Model step 2
重新连接模型
读取上下文
```

### 7.3 阶段性汇报

FRIDAY 应在适当时机总结：

- 刚刚完成了什么。
- 当前在做什么。
- 接下来做什么。

示例：

```text
阶段性汇报
已查看项目结构和现有过程面板实现。
接下来会修正 retry 事件映射，并补充测试覆盖。
```

如果有 visible plan，这些汇报应挂在当前计划项下。

## 8. 不在本文档范围内

以下内容不在本方案处理：

- 审批动作的具体 UI、权限分级和交互流程。
- 文件 mutation review 策略。
- 全自动模式下是否跳过文档生成审批。

这些内容已经拆到单独的审批规划窗口。

本方案只做一个结构预留：Composer Task Bar 未来可以承接审批、确认、选择等 action，但本次不实现审批 UI 或审批逻辑。

本文档只处理：

- Intake。
- Plan 作为内部工具。
- 过程叙事。
- 模型请求与重试文案。
- 复杂任务过程结构。

## 9. 实施计划

### 任务 1：区分模型 transport 遥测与 retry UI

**文件：**

- 修改：`src/core/trajectory/AgentTrajectoryProjector.ts`
- 修改：`src/views/agentProcessPanelViewModel.ts`
- 修改：`src/services/AgentRuntimeService.ts`
- 修改：`src/core/agent-kernel/AgentLoopController.ts`
- 测试：`tests/agent-trajectory-projector.test.mjs`
- 测试：`tests/agent-process-panel-view-model.test.mjs`
- 测试：`tests/daily-board-agent-trajectory-ui.test.mjs`

**步骤：**

1. 增加 transport 分类 helper，将事件分为 `normal_request`、`retry_recovery`、`failed`。
2. 先写失败测试，证明 `request_started` 不会触发 `transport_retry`。
3. 再写失败测试，证明 `retry_scheduled` 仍显示恢复状态。
4. 修改 projection，只让真实 retry 事件生成 retry/recovery UI 条目。
5. 修改 view model 文案，统一使用 `网络波动，正在恢复请求`。
6. 运行聚焦测试。

**验收：**

- 普通请求不显示重试。
- retry scheduled/started 显示恢复。
- request exhausted 显示失败。

### 任务 2：将最大重试次数改为 5

**文件：**

- 修改：`src/services/AIService.ts`
- 测试：`tests/ai-service-retry-regression.test.mjs`
- 测试：`tests/llm-transport-telemetry.test.mjs`

**步骤：**

1. 将 `MAX_RETRY_ATTEMPTS` 从 `3` 改为 `5`。
2. 更新原先假设 `maxAttempts: 4` 的测试。
3. 增加 UI 口径 helper 测试，验证 `retryAttempt/maxRetries`。
4. 确保用户文案是 `第 n/5 次`，不是 `attempt n/6`。

**验收：**

- 首次请求后最多可以重试 5 次。
- UI 只暴露最多恢复请求 5 次。

### 任务 3：增加 Intake 决策事件

**文件：**

- 修改：`src/core/agent-kernel/contracts/AgentTurn.ts`
- 修改：`src/core/agent-kernel/AgentLoopController.ts`
- 修改：`src/services/AgentRuntimeService.ts`
- 修改：`src/core/trajectory/AgentTrajectoryProjector.ts`
- 测试：`tests/agent-kernel-loop.test.mjs`
- 测试：`tests/agent-trajectory-projector.test.mjs`

**步骤：**

1. 定义 `IntakeDecision`。
2. 在规划和执行前发出 intake event。
3. 支持 `simple`、`light`、`complex`、`unclear` 分类。
4. 第一版保持保守，保证 fallback 安全。
5. 只有在有帮助时，把 intake 投影成用户可见理解项。

**验收：**

- 复杂任务先显示第一人称自然理解句，不显示 `已理解任务` 这类结构化标题。
- 理解句语气能跟随 SOUL 设置，而不是固定系统口吻。
- 简单任务可以跳过 visible intake，直接回答。

### 任务 4：实现 Plan 内部工具/状态协议

**文件：**

- 新建或修改：`src/core/agent-kernel/PlanState.ts`
- 修改：`src/core/agent-kernel/AgentLoopController.ts`
- 修改：`src/core/trajectory/AgentTrajectoryProjector.ts`
- 修改：`src/views/agentProcessPanelViewModel.ts`
- 测试：`tests/agent-kernel-loop.test.mjs`
- 测试：`tests/agent-process-panel-view-model.test.mjs`

**步骤：**

1. 定义 `plan_create`、`plan_update`、`plan_revise`、`plan_complete`、`plan_skip` 事件 payload。
2. 强制同一时间最多一个 `in_progress` 任务。
3. 支持 `visible` 和 `internal` 两种计划可见性。
4. 在 Composer Task Bar 渲染 visible plan 的当前任务进度和展开列表。
5. 将 `plan_update.summary/justDone/next` 投射到 Intake 下方的过程叙事区，而不是投射到 Composer Task Bar。
6. internal plan 不展示完整计划，但可以驱动 Intake 下方的当前动作摘要。

**验收：**

- 复杂任务会创建 visible plan。
- visible plan 的进度入口是 Composer Task Bar，而不是聊天区大卡片。
- 工作过程叙事出现在 FRIDAY Intake 回答下方，而不是 Composer Task Bar 里。
- 计划可以线性更新。
- 新上下文改变路线时可以 revise plan。

### 任务 5：实现 Intake 下方过程叙事与 Composer Task Bar 分层

**文件：**

- 修改：`src/views/agentProcessPanelViewModel.ts`
- 修改：`src/views/DailyBoardView.ts`
- 测试：`tests/agent-process-panel-view-model.test.mjs`
- 测试：`tests/daily-board-agent-trajectory-ui.test.mjs`

**步骤：**

1. 在触发任务的 FRIDAY Intake 回答下方创建过程叙事容器。
2. 过程叙事容器按时间线显示任务节点，每个节点包含任务名、状态、已做事项、阶段判断和必要的工具活动。
3. 技术细节默认折叠，工具活动和 retry 事件优先挂到当前任务节点下。
4. 在 composer/input box 顶部增加 Composer Task Bar。
5. Composer Task Bar 收起态只显示当前状态、任务序号、任务名、执行时间。
6. Composer Task Bar 展开态只额外显示完整计划任务列表，区分 completed、in_progress、pending。
7. Composer Task Bar 不显示“当前/刚刚/接下来”这类过程摘要。
8. 当前任务行高亮并显示加载中状态。
9. 保持 Composer Task Bar、live 过程 disclosure 和 final replay 数据一致。
10. 为未来审批动作预留 action slot，但本次不渲染审批 UI、不实现审批逻辑。
11. 验证宽插件和窄插件布局。

**验收：**

- 用户能在 Intake 回答下方看懂 FRIDAY 当前正在做什么、刚刚做了什么。
- 用户不用翻历史，也能在对话框顶部看到当前计划进度。
- 展开 Composer Task Bar 能看到 `1/5` 到 `5/5` 的计划列表。
- Composer Task Bar 中不出现工作过程摘要。
- 过程不再像原始节点堆叠。
- 执行中展开和完成后展开内容一致。
- 本次没有新增审批行为。

### 任务 6：让运行中的历史消息也能展开过程

**文件：**

- 修改：`src/views/DailyBoardView.ts`
- 修改：`src/views/agentProcessPanelViewModel.ts`
- 修改：任务/消息绑定相关渲染代码
- 测试：`tests/daily-board-agent-trajectory-ui.test.mjs`
- 测试：`tests/agent-process-panel-view-model.test.mjs`

**步骤：**

1. 找出当前 live process 只在底部或最终回答后渲染的路径。
2. 为触发 agent task 的消息建立稳定的 `taskId/turnId -> process disclosure` 绑定。
3. 让 live snapshot 可以驱动历史消息位置的 disclosure。
4. 保证运行中可展开，完成后同一 disclosure 更新为 completed replay。
5. 增加测试，证明任务运行中历史消息也能看到过程入口。

**验收：**

- agent 运行时，用户向上查看历史对话，也能展开对应任务过程。
- 任务完成后不出现第二套不同的过程 UI。
- live 过程和完成 replay 内容一致。

### 任务 7：后台任务与非阻塞导航

**文件：**

- 修改：`src/views/DailyBoardView.ts`
- 修改：任务状态管理相关代码
- 修改：顶部/底部状态提示相关渲染代码
- 测试：`tests/daily-board-agent-trajectory-ui.test.mjs`

**步骤：**

1. 梳理所有受 `aiBusy` 或等价 busy 状态影响的导航、页面切换和普通查看动作。
2. 将 agent task busy 从“全局阻塞 UI”改为“后台任务状态”。
3. 保留对冲突操作的限制，例如同一对话继续发送可能需要排队，但不要阻止用户打开其他页面。
4. 增加后台任务状态提醒：`正在运行`、`运行异常`、`任务完成`。
5. 状态提醒支持点击回到对应对话和任务位置。
6. 增加测试，证明 agent 运行时仍可切换页面或点击非冲突 UI。

**验收：**

- agent 工作时用户可以点击其他页面。
- 任务在后台继续运行。
- 用户能通过状态提醒知道任务正在运行、异常或完成。
- 点击状态提醒可以回到对应任务。

## 10. 验收标准

- 普通模型请求不显示“重试”“重连”“模型连接不稳定”。
- retry 事件显示 `网络波动，正在恢复请求`。
- 重试耗尽显示清晰失败状态。
- UI 口径是最多恢复请求 5 次。
- 复杂任务先显示第一人称自然理解句，不显示 `已理解任务` 这类结构化标题。
- 理解句语气能跟随 SOUL 设置，而不是固定系统口吻。
- 复杂任务会创建 visible living plan。
- visible plan 的进度入口是 Composer Task Bar：收起态显示当前任务 `2/5`、任务名和执行时间，展开态额外显示完整任务列表。
- 工作过程叙事出现在 FRIDAY Intake 回答下方，按任务节点线性展示做了什么、正在做什么和遇到的问题。
- 简单任务不展示无意义计划 UI。
- 同一时间只有一个 visible plan task 是 `in_progress`。
- 工具调用挂在当前阶段下。
- 阶段性汇报在 Intake 下方过程区说明刚刚完成什么、接下来做什么。
- agent 运行中，历史消息也能展开对应任务过程。
- agent 运行时，用户可以自由切换页面和查看其他内容，任务后台继续运行。
- 全局状态提醒能表达 `正在运行`、`运行异常`、`任务完成`。
- 最终回答后，相关产物和修改摘要立即显示。
- Composer Task Bar 仅预留未来 action slot，本次工作不改变审批行为。

## 11. 开发提示词

在开发窗口使用：

```text
请实现 docs/plans/2026-05-07-friday-intake-plan-tool-process-optimization.zh.md。

重点：
1. 普通模型请求不要进入重试/恢复叙事。
2. 只有 retry_scheduled/retry_started/request_exhausted 才显示“网络波动，正在恢复请求”或失败状态。
3. 将 MAX_RETRY_ATTEMPTS 改为 5；UI 口径是最多恢复请求 5 次，不展示 total attempts = 6。
4. 增加 Intake 决策事件：simple/light/complex/unclear。
5. 将 Plan 做成内部 orchestration tool/state protocol，而不是固定 UI 阶段。
6. 复杂任务先显示第一人称自然理解句，例如“我理解你希望……”，不要显示“已理解任务/任务理解”这类结构化标题；语气应结合 SOUL 设置。
7. 复杂任务使用 visible living plan；visible plan 的进度入口放在 composer/input box 顶部的 Composer Task Bar。
8. Composer Task Bar 收起态只显示当前任务序号、任务名和执行时间；展开态只额外显示完整任务列表，不放“当前/刚刚/接下来”这类过程摘要。
9. Composer Task Bar 可预留未来 action slot，但本次不要实现审批 UI、审批权限或审批逻辑。
10. 工作过程叙事放在 FRIDAY Intake 回答下方，参考 Manus 的分层表达：任务节点 + 做了什么 + 阶段性判断 + 折叠技术细节。
11. 参考当前主参考图 `docs/assets/friday-process-ux/friday-process-four-states-reference.png`。该图覆盖简单回答、执行中 Bar 收起、执行中 Bar 展开、已完成 Bar 收起四种状态；旧图 `docs/assets/friday-process-ux/composer-task-bar-expanded-plan-reference.png` 只作为 composer 占位历史参考。
12. 简单任务不展示计划。
13. 工具调用和 retry 事件挂到当前 plan item/stage 下，技术细节默认折叠。
14. agent 运行中，历史消息也要能展开对应过程，不要等任务完成后才出现。
15. agent 任务后台运行，不阻塞用户切换页面或查看其他内容。
16. 增加轻量任务状态提醒：正在运行、运行异常、任务完成；点击可回到对应任务。
17. 不处理审批相关设计。

先补测试，再改实现。完成后运行相关 agent/process/transport 测试。
```

## 12. 验收提示词

在验收窗口使用：

```text
请验收 docs/plans/2026-05-07-friday-intake-plan-tool-process-optimization.zh.md 的实现。

重点检查：
1. 普通 request_started/request_succeeded 不会显示“重试”“重连”“模型连接不稳定”。
2. retry_scheduled/retry_started 显示“网络波动，正在恢复请求（第 n/5 次）”。
3. request_exhausted 显示清晰失败状态。
4. MAX_RETRY_ATTEMPTS 已改为 5，测试不再假设 maxAttempts = 4。
5. Intake 能区分 simple/light/complex/unclear，并驱动是否显示过程/计划。
6. Plan 是内部 tool/state protocol，不是前端硬编码固定阶段。
7. complex task 先显示第一人称自然理解句，不出现“已理解任务/任务理解”这类 UI 标题，并能跟随 SOUL 语气；再显示 living plan，并随执行更新当前阶段。
8. visible plan 的进度入口在 Composer Task Bar：收起态能看当前任务 `2/5`、任务名和执行时间，展开态能额外看完整计划列表；bar 内不显示过程摘要。
9. Composer Task Bar 只预留未来 action slot，本次没有实现审批 UI 或改变审批行为。
10. 工作过程叙事出现在 FRIDAY Intake 回答下方，按任务节点线性展示“做了什么/正在做什么/遇到的问题”，技术细节默认折叠。
11. 实现形态参考当前主参考图 `docs/assets/friday-process-ux/friday-process-four-states-reference.png`，并逐项覆盖其中四种状态；如果旧图 `docs/assets/friday-process-ux/composer-task-bar-expanded-plan-reference.png` 与本文档冲突，以当前主参考图和本文档文字为准。
12. simple task 不显示不必要的计划节点。
13. 技术细节不与上层叙事重复。
14. agent 运行中，历史消息也能展开对应任务过程。
15. agent 运行时，用户可以切换到其他页面，任务后台继续运行。
16. 全局状态提醒能显示正在运行、运行异常、任务完成，并能跳回对应任务。
17. 审批行为没有被本次改动误改。

请给出文件级发现、测试结果、截图或 UI 行为证据。
```
