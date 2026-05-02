# Agent Kernel v2 Migration Batches H-I-J Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> English counterpart: `docs/plans/2026-05-02-agent-kernel-v2-migration-batches-h-i-j-plan.md`.

**Goal:** 完成 Batch G 之后的 Kernel v2 迁移路线，把模型循环、task/replay/mutation 所有权，以及旧 runtime 退场门禁拆成 H、I、J 三个可验收批次。

**Architecture:** Batch G 建立 contracts、execution context、ports 和 legacy adapter。Batch H 把模型/工具循环迁进 Kernel v2。Batch I 把任务状态、replay 事件、approval wait 和 mutation 状态迁进 Kernel v2。Batch J 只有在 Harness、eval、静态边界检查和产品验收都证明等价后，才删除或缩小旧 runtime 路径。

**Tech Stack:** TypeScript、Obsidian plugin runtime、Node test runner、现有 Kernel v2 contracts、现有 fake runtime harness、`AIService`、`ToolGateway`、`ToolRegistry`、`CapabilityPolicy`、`MutationPlan`、`AgentTask`、`TurnEventLog`、`TurnReplayReader` 和 Daily Board UI adapters。

---

## 0. 如何阅读本计划

本计划只在 Batch G 通过后开始。

Batch G 应该已经让 `AgentKernel` 依赖 `RuntimeTurnExecutorPort`，引入 `AgentExecutionContext`，并把 `AgentRuntimeService` 放到 `LegacyAgentRuntimeAdapter` 后面。

本计划覆盖：

- **Batch H:** Kernel v2 拥有模型/工具循环。
- **Batch I:** Kernel v2 拥有 task、replay、approval 和 mutation 状态。
- **Batch J:** 旧 runtime 路径只在硬性 parity gate 后退场。

除非用户明确要求大迁移，否则不要把 H/I/J 放进一个 PR。这三个批次是独立 checkpoint。

## 1. 共同非目标

H 到 J 期间仍然不做：

- Build mode 作为默认 Obsidian 用户模式
- Wiki/RAG/MCP/background agent/multi-agent 扩展
- 在 Kernel 里引入新的 provider SDK
- remote sandbox 或云端任务执行
- 把 Daily Board 重做成 standalone app
- 因 kernel migration 改 release versioning
- 为了让迁移更容易而削弱 A-F Harness 或 eval 断言

短期产品目标仍然是 Obsidian-native knowledge work agent。

## 2. 跨批次成熟门禁

每个批次都必须保持这些命令通过：

```bash
npm run lint
npm test
git diff --check
```

每个批次还必须运行相关 Kernel/Harness 命令：

```bash
node --test tests/agent-kernel-contracts.test.mjs
node --test tests/agent-kernel-execution-context.test.mjs
node --test tests/agent-kernel-facade.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
```

Batch J 结束时，需要增加并保留这些边界检查：

- `src/core/agent-kernel/**` 不 import `AgentRuntimeService`。
- production UI 不直接调用 `AgentRuntimeService.runTurn`。
- `AgentRuntimeService` 不再拥有模型循环控制。
- `AgentRuntimeService` 不再拥有 active task state。
- 所有 agent-facing 文件 mutation 路径都经过 Kernel-owned mutation ports 或 Kernel-compatible adapters。

## 3. Batch H 概览：迁移模型循环

**Batch H 目标：** 把 prompt/native model loop 的所有权从 `AgentRuntimeService` 迁到 Kernel v2，同时保持现有行为不变。

Batch H 后，Kernel v2 应拥有：

- max iteration loop
- model request 和 response events
- native tool call protocol loop
- 如果仍支持 prompt-envelope fallback，则拥有 prompt-envelope loop
- retryable transport failure policy
- native-to-prompt compatibility fallback policy
- final-answer extraction
- 通过 `ToolBoundaryFilter` 修复 model request history
- context package 交给模型请求的过程

Batch H 后，`AgentRuntimeService` 仍可拥有 Obsidian-specific capabilities 和 vault IO adapters，但不能再拥有顶层 model/tool loop。

## 4. Batch H 目标形态

Batch H 前：

```text
AgentKernel
  -> RuntimeTurnExecutorPort
    -> LegacyAgentRuntimeAdapter
      -> AgentRuntimeService.runTurn
        -> runTurnNative / runTurnPrompt
```

Batch H 后：

```text
AgentKernel
  -> AgentLoopController
    -> ContextEnginePort
    -> ModelDriverPort
    -> ToolGatewayPort
    -> FailureClassifier
    -> EventSink
  -> ObsidianRuntimePorts
    -> vault IO, settings, approvals, skill loading, memory, project boundaries
```

`LegacyAgentRuntimeAdapter` 可以暂时只保留给兼容测试或 fallback。Batch H 通过后，它不应该再是默认 executor。

## 5. Batch H 新组件

推荐文件：

- Create: `src/core/agent-kernel/AgentLoopController.ts`
- Create: `src/core/agent-kernel/AgentLoopTypes.ts`
- Create: `src/core/agent-kernel/ModelDriverPort.ts`
- Create: `src/core/agent-kernel/ToolExecutionPort.ts`
- Create: `src/core/agent-kernel/ContextEnginePort.ts`
- Create: `src/core/agent-kernel/RuntimeProtocol.ts`
- Create: `src/services/AIServiceModelDriverAdapter.ts`
- Create: `src/services/ObsidianKernelRuntimePorts.ts`
- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `src/main.ts`

推荐测试：

- Create: `tests/agent-kernel-model-loop.test.mjs`
- Create: `tests/agent-kernel-model-driver-adapter.test.mjs`
- Create: `tests/agent-kernel-tool-loop-regression.test.mjs`
- Extend: `tests/agent-runtime-harness-e2e.test.mjs`
- Extend: `tests/agent-eval-runner.test.mjs`

## 6. Batch H 实施任务

### H1: 写模型循环所有权失败测试

**Files:**

- Create: `tests/agent-kernel-model-loop.test.mjs`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. 断言 `AgentKernel` 可以用 fake `ModelDriverPort` 执行一个 turn。
2. 断言 fake model 收到的是修复后的 message history。
3. 断言 `model_request`、`model_response`、`tool_call`、`tool_result` 和 terminal events 由 Kernel 发出。
4. 断言 Kernel loop 测试不需要 `AgentRuntimeService.runTurnNative` 和 `runTurnPrompt`。
5. 运行 targeted test，确认实现前失败。

### H2: 增加 ModelDriverPort

**Files:**

- Create: `src/core/agent-kernel/ModelDriverPort.ts`
- Create: `src/services/AIServiceModelDriverAdapter.ts`
- Create: `tests/agent-kernel-model-driver-adapter.test.mjs`

**ModelDriverPort 最小形态：**

- `requestText(input)`
- `requestWithTools(input)`
- 支持 `modelOverride`
- 支持 `signal`
- 返回 assistant text、reasoning content 和 native tool calls
- 把 provider errors normalize 成 `AgentFailureClassifier` 可分类的错误

**Acceptance:**

- adapter 保留 `reasoningContent`
- adapter 转发 abort signal
- adapter 不静默重试 stream request
- adapter 保持现有 AIService transport policy

### H3: 增加 ContextEnginePort Bridge

**Files:**

- Create: `src/core/agent-kernel/ContextEnginePort.ts`
- Modify: `src/core/context/PromptContextEngine.ts` only if needed
- Create or extend: `tests/prompt-context-engine.test.mjs`

**Steps:**

1. 定义 Kernel-facing context request shape。
2. 包装现有 `PromptContextEngine`，让 Kernel 拿到 compact context package。
3. 保留 token budget diagnostics 和 trimmed channel reporting。
4. 确保 raw oversized dynamic context 不泄漏到最终 model request。

### H4: 增加 ToolExecutionPort Bridge

**Files:**

- Create: `src/core/agent-kernel/ToolExecutionPort.ts`
- Modify: `src/core/tools/ToolGateway.ts` only if necessary
- Create: `tests/agent-kernel-tool-loop-regression.test.mjs`

**Steps:**

1. 定义 Kernel tool execution request。
2. 桥接现有 `ToolGateway`、`CapabilityPolicy` 和 native tool handlers。
3. 保留 approval 行为和 denial traces。
4. 保留 `use_skill` reinjection 行为。
5. 确保 debug/developer-only exec policy 仍然成立。

### H5: 实现 AgentLoopController

**Files:**

- Create: `src/core/agent-kernel/AgentLoopController.ts`
- Create: `src/core/agent-kernel/RuntimeProtocol.ts`
- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `tests/agent-kernel-model-loop.test.mjs`

**Steps:**

1. 把 max iteration loop 语义迁到 `AgentLoopController`。
2. 支持 native tool calls。
3. 如果 prompt mode 仍开启，则支持 prompt envelope tool calls。
4. 每个 model/tool step 都 emit Kernel events。
5. 保持 final answer extraction deterministic。
6. max iterations 按现有用户可见行为处理为 typed `max_iterations` failure 或 safe-stop status。

### H6: 把 Kernel 默认 executor 接到新 loop

**Files:**

- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. 在 `main.ts` 初始化 model/context/tool ports。
2. 初始化 `AgentLoopController`。
3. 将它作为默认 Kernel executor。
4. 只有在计划明确允许时，才保留 `LegacyAgentRuntimeAdapter` 作为临时 fallback。
5. 增加测试证明默认路径是 Kernel loop，不是 legacy runTurn。

### H7: 迁移 Fallback And Error Policy

**Files:**

- Modify: `src/core/agent-kernel/AgentFailureClassifier.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Extend: `tests/agent-kernel-model-loop.test.mjs`
- Extend: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. 保留现有规则：retryable native transport failure 不允许 fallback 到 prompt mode。
2. 保留现有规则：native protocol incompatibility 如配置允许，可 fallback 到 prompt mode 一次。
3. fallback 表达为 event。
4. failure 表达为 typed `AgentFailure`。
5. fallback 发生时，final reply 仍然诚实说明。

### H8: Harness And Eval Parity

**Files:**

- Extend: `tests/agent-runtime-harness-e2e.test.mjs`
- Extend: `tests/evals/agent-scenarios.json` only if behavior changes
- Extend: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. 让所有 A-F scenarios 跑在 Kernel loop 上。
2. 如果 helper 仍直接调用 legacy runtime，则改为 facade/kernel path。
3. 不移除现有 assertions。
4. 只有 externally visible behavior 改变时，才新增 scenario。

### H9: Batch H 文档和提交

**Files:**

- Modify: this plan if implementation deviates
- Modify: `docs/plans/agent-eval-quality-gates.md` only if scenarios change

**Verification:**

```bash
node --test tests/agent-kernel-model-loop.test.mjs
node --test tests/agent-kernel-model-driver-adapter.test.mjs
node --test tests/agent-kernel-tool-loop-regression.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "feat: move agent model loop into kernel v2"
```

## 7. Batch H 验收标准

Batch H 只有全部满足才算通过：

- Kernel v2 拥有 model/tool iteration loop。
- `AgentRuntimeService.runTurnNative` 和 `runTurnPrompt` 不再是默认 production loop。
- model request/response/tool events 是 Kernel events。
- retryable transport failure policy 被保留。
- prompt fallback behavior 是 explicit、typed、tested。
- 所有 A-F harness/eval tests 不削弱断言仍通过。
- `npm run lint`、`npm test`、`git diff --check` 通过。

## 8. Batch I 概览：迁移 Task、Replay、Approval 和 Mutation 所有权

**Batch I 目标：** 让 Kernel v2 成为 task state、replay timeline、approval waits 和 mutation state transitions 的生产者。

Batch I 后，Kernel 应拥有：

- task creation 和 lifecycle transitions
- task cancellation、retry、continue semantics
- replay event emission 和 terminal state
- approval wait/resolution events
- mutation plan creation、pending state、apply/reject/conflict transitions
- 从 task/event/mutation state 推导 final result status

Batch I 后，`AgentRuntimeService` 不应再保存 active task state。它可以作为 Obsidian-facing adapter 保留，用于 vault IO、settings、workbench state 和 UI action methods。

## 9. Batch I 目标形态

Batch I 前：

```text
AgentRuntimeService
  -> activeTaskId
  -> activeTaskAbortController
  -> AgentTaskStore
  -> TurnEventLog
  -> MutationPlanStore
  -> WorkbenchStateStore edit plans
```

Batch I 后：

```text
AgentKernel
  -> AgentExecutionContext
  -> AgentTaskManager
  -> AgentReplayRecorder
  -> AgentMutationCoordinator
  -> HumanApprovalPort
  -> AgentResumeController

Obsidian adapters
  -> persist task/event/mutation state
  -> render state in Daily Board
  -> apply approved file changes through vault IO
```

UI 应通过 facade method 读取状态。它不应该再从 chat text 判断 runtime 真相。

## 10. Batch I 新组件

推荐文件：

- Create: `src/core/agent-kernel/AgentTaskManager.ts`
- Create: `src/core/agent-kernel/AgentReplayRecorder.ts`
- Create: `src/core/agent-kernel/AgentMutationCoordinator.ts`
- Create: `src/core/agent-kernel/AgentResumeController.ts`
- Create: `src/core/agent-kernel/HumanApprovalPort.ts`
- Create: `src/services/ObsidianAgentStateAdapter.ts`
- Modify: `src/core/tasks/AgentTask.ts`
- Modify: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/views/agentTaskPanelActions.ts`
- Modify: `src/views/DailyBoardView.ts` only for adapter calls, not UI redesign

推荐测试：

- Create: `tests/agent-kernel-task-manager.test.mjs`
- Create: `tests/agent-kernel-replay-recorder.test.mjs`
- Create: `tests/agent-kernel-mutation-coordinator.test.mjs`
- Create: `tests/agent-kernel-resume-controller.test.mjs`
- Extend: `tests/agent-task-lifecycle.test.mjs`
- Extend: `tests/agent-runtime-mutation-review-e2e.test.mjs`
- Extend: `tests/turn-replay-reader.test.mjs`
- Extend: `tests/daily-board-agent-task-ui-regression.test.mjs`

## 11. Batch I 实施任务

### I1: 写所有权边界测试

**Files:**

- Create: `tests/agent-kernel-task-manager.test.mjs`
- Create: `tests/agent-kernel-replay-recorder.test.mjs`

**Steps:**

1. 断言 Kernel 不通过 `AgentRuntimeService` 也能创建 task lifecycle events。
2. 断言 replay events 来自 Kernel event stream。
3. 断言 terminal state 来自 Kernel result status。
4. 断言 Kernel task path 不依赖 direct active task fields。
5. 运行测试，确认预期失败。

### I2: 增加 AgentTaskManager

**Files:**

- Create: `src/core/agent-kernel/AgentTaskManager.ts`
- Modify: `src/core/tasks/AgentTask.ts` only if status/action model needs small additions
- Extend: `tests/agent-kernel-task-manager.test.mjs`

**Responsibilities:**

- create task for turn
- mark running
- mark waiting for approval
- mark waiting for user
- mark failed
- mark cancelled
- mark completed
- derive available actions
- redact sensitive text before persistence

**Rules:**

- 无 UI dependency
- 无 direct vault IO
- 不通过 string-only terminal inference 判断状态

### I3: 增加 AgentReplayRecorder

**Files:**

- Create: `src/core/agent-kernel/AgentReplayRecorder.ts`
- Extend: `tests/agent-kernel-replay-recorder.test.mjs`
- Extend: `tests/turn-replay-reader.test.mjs`

**Responsibilities:**

- 接收 `AgentTurnEvent`
- 把 Kernel events 转换成 persisted replay records
- 保留 sequence order
- 将 sequence gaps 和 late terminal events 标为 replay diagnostics
- 持久化前 redaction sensitive payloads

**Acceptance:**

- replay reader 能总结 Kernel-produced events
- task timeline 出现在 replay summary
- cancelled、failed、safe-stopped、approval、mutation states 可区分

### I4: 增加 HumanApprovalPort

**Files:**

- Create: `src/core/agent-kernel/HumanApprovalPort.ts`
- Modify: existing approval adapter/service only as needed
- Create or extend: `tests/agent-kernel-task-manager.test.mjs`

**Responsibilities:**

- 为 risky tools 请求 approval
- 必要时为 mutation apply/reject 请求 approval
- 把 approval 表达为 `waiting_for_approval`
- approval 后恢复 task
- denial 后 fail 或 cancel task

**Important:**

- approval 在 Kernel 内不是 UI modal 概念
- approval 是 state transition 和 event
- UI 决定怎么问，Kernel 决定状态含义

### I5: 增加 AgentMutationCoordinator

**Files:**

- Create: `src/core/agent-kernel/AgentMutationCoordinator.ts`
- Extend: `tests/agent-kernel-mutation-coordinator.test.mjs`
- Extend: `tests/agent-runtime-mutation-review-e2e.test.mjs`

**Responsibilities:**

- 将 model/tool write intent 转成 `MutationPlan`
- 通过 port/adapter 保存 pending plan
- 保持 review-first default
- apply approved plan
- reject pending plan
- 检测 external file edit conflict
- emit mutation events
- 更新关联 task state

**Rules:**

- 不允许直接绕过 review-first file writes
- folder delete 仍然 strict
- auto-approved mode 也必须 governed and tested

### I6: 增加 AgentResumeController

**Files:**

- Create: `src/core/agent-kernel/AgentResumeController.ts`
- Create: `tests/agent-kernel-resume-controller.test.mjs`
- Extend: `tests/agent-task-lifecycle.test.mjs`

**Responsibilities:**

- 从 recorded kernel input retry failed task
- 用 user-provided input continue waiting task
- cancel running or waiting task
- 保留 `retryOfTaskId`、`continueFromTaskId` 等关系字段
- 避免重新 apply 已经 applied mutation plans

**Acceptance:**

- retry 使用 prior input 加当前 context policy
- continue 包含 user continuation text
- retry/continue 产生新的 task ID
- completed/cancelled tasks 保持 terminal

### I7: 从 AgentRuntimeService 移出 Active Task State

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/ObsidianAgentStateAdapter.ts`
- Extend: boundary tests

**Steps:**

1. 识别 `activeTaskId`、`activeTaskAbortController`、`taskAbortControllers` 和 task lifecycle helper usage。
2. 把所有权移到 Kernel task/resume components。
3. 如果 UI 仍调用 public service methods，可以保留 adapter shim。
4. 增加静态或 focused tests，证明默认路径下 runtime service 不再拥有 active task state。

### I8: UI Adapter 兼容

**Files:**

- Modify: `src/views/agentTaskPanelActions.ts`
- Modify only if necessary: `src/views/DailyBoardView.ts`
- Extend: `tests/daily-board-agent-task-ui-regression.test.mjs`

**Steps:**

1. 保持可见 task panel 行为稳定。
2. retry/cancel/continue/apply/reject 通过 facade/kernel APIs。
3. 本批不 redesign UI。
4. task hydration 读取 Kernel-owned state。

### I9: Batch I 验证和提交

**Commands:**

```bash
node --test tests/agent-kernel-task-manager.test.mjs
node --test tests/agent-kernel-replay-recorder.test.mjs
node --test tests/agent-kernel-mutation-coordinator.test.mjs
node --test tests/agent-kernel-resume-controller.test.mjs
node --test tests/agent-task-lifecycle.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
node --test tests/turn-replay-reader.test.mjs
node --test tests/daily-board-agent-task-ui-regression.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "feat: move agent state ownership into kernel v2"
```

## 12. Batch I 验收标准

Batch I 只有全部满足才算通过：

- Kernel 拥有默认 agent turns 的 task lifecycle transitions。
- Kernel 拥有默认 agent turns 的 replay event emission。
- Kernel 拥有 mutation plan state transitions。
- approval waits 是 Kernel states，不是 UI-only prompts。
- retry/continue/cancel 通过 Kernel/facade APIs。
- `AgentRuntimeService` 不再为默认路径保存 active task state。
- Daily Board task UI 行为稳定。
- A-F/H harness 和 eval gates 继续通过。

## 13. Batch J 概览：旧 Runtime 退场门禁

**Batch J 目标：** 在 Kernel v2 已拥有 execution loop 和 agent state 后，安全退役旧 runtime 路径。

Batch J 不是为了代码洁癖而 refactor。它是 removal gate。

只有团队能证明下面几点后，才删除或缩小旧 runtime 代码：

- Kernel path 对支持的 Obsidian workflows 有行为等价。
- 没有 production caller 依赖 legacy loop ownership。
- legacy-only tests 已经迁移或被有意识删除。
- 所有 agent-facing behaviors 都被 Kernel/Harness/eval tests 覆盖。

## 14. Batch J 目标形态

Batch J 后：

```text
AgentRuntimeService
  -> no model loop ownership
  -> no active task ownership
  -> no mutation review ownership
  -> no replay ownership
  -> may remain as Obsidian service adapter, settings bridge, or deprecated shell

AgentKernel
  -> owns supported agent execution
  -> owns lifecycle semantics
  -> owns event stream semantics
  -> owns mutation state semantics
```

如果 `AgentRuntimeService` 还保留，它的名字不应该继续暗示它是 runtime engine。后续可以考虑重命名，例如 `ObsidianAgentRuntimeAdapter`，或者按职责拆成多个 services。

## 15. Batch J 新检查和工具

推荐文件：

- Create: `tests/agent-kernel-legacy-retirement.test.mjs`
- Create: `docs/plans/agent-kernel-v2-retirement-checklist.md`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: old tests that assume legacy runtime ownership

静态检查应断言：

- no default production path calls `AgentRuntimeService.runTurn`
- no `runTurnNative` default path remains
- no `runTurnPrompt` default path remains
- no direct task lifecycle ownership remains in `AgentRuntimeService`
- no direct mutation plan ownership remains in `AgentRuntimeService`
- all Kernel APIs are reachable through facade

## 16. Batch J 实施任务

### J1: 盘点旧 Runtime 职责

**Files:**

- Create: `docs/plans/agent-kernel-v2-retirement-checklist.md`
- Create: `tests/agent-kernel-legacy-retirement.test.mjs`

**Steps:**

1. 列出 `AgentRuntimeService` 内剩余每一类职责。
2. 分类每项：
   - delete now
   - move to Kernel
   - move to Obsidian adapter
   - keep temporarily with explicit reason
3. 给不允许回归的职责加静态测试。

### J2: 移除 Legacy Loop Entry Points

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Extend: `tests/agent-kernel-legacy-retirement.test.mjs`

**Steps:**

1. 如果不再需要，删除或 privatize legacy loop methods。
2. 如果方法必须暂留，标记 deprecated，并确保没有 default production caller。
3. facade 只路由到 Kernel v2。
4. 运行 static boundary tests。

### J3: 拆出 Obsidian Adapter 职责

**Files:**

- Create or extend: `src/services/ObsidianKernelRuntimePorts.ts`
- Create or extend: `src/services/ObsidianAgentStateAdapter.ts`
- Modify: `src/services/AgentRuntimeService.ts`

**Steps:**

1. 把 vault IO helpers 移到 adapter modules。
2. 把 settings/project boundary access 移到 adapter modules。
3. 视情况把 skill/memory/wiki disabled gates 移到 capability adapters。
4. 让 service 文件回到可维护体量。

推荐目标：

- `AgentRuntimeService.ts` 不应继续作为 3000+ 行 core service。
- 如果仍然很大，每个保留 section 都需要在 checklist 中写明退场理由。

### J4: 删除或转换 Legacy-Only Tests

**Files:**

- Modify tests that directly assert legacy service internals
- Extend Kernel/Harness tests with equivalent product behavior assertions

**Steps:**

1. 对每个 legacy test 判断它保护的是产品行为还是实现细节。
2. 产品行为测试迁移到 Kernel/facade path。
3. 只有 Kernel boundary tests 已替代对应风险时，才删除实现细节测试。
4. 不减少 eval scenario coverage。

### J5: Product Parity Gate

**Files:**

- Extend: `tests/evals/agent-scenarios.json` only if gaps are found
- Extend: `docs/plans/agent-eval-quality-gates.md` if scenarios change
- Extend: `tests/agent-eval-runner.test.mjs`

必须覆盖的 parity 区域：

- ask/research/read behavior
- grep/read evidence behavior
- missing file failure
- write/edit/delete review-first behavior
- reject/apply/conflict behavior
- organize/review mode behavior
- debug exec allowlist behavior
- normal exec hidden behavior
- retryable transport failure behavior
- context compaction behavior
- dirty tool history repair
- max iteration safe stop
- task lifecycle UI state

### J6: 删除或重命名 Legacy Runtime Shell

**Files:**

- Modify or move: `src/services/AgentRuntimeService.ts`
- Modify imports throughout `src/`
- Extend static boundary tests

**Options:**

- 如果文件仍保存有用的 Obsidian adapters，则重命名或拆分。
- 如果文件不再需要，则删除。
- 如果删除风险太高，保留小型 deprecated shell，但不能拥有 execution ownership。

不允许在没有文档理由的情况下选择 shell 方案。

### J7: 最终验证和提交

**Commands:**

```bash
node --test tests/agent-kernel-legacy-retirement.test.mjs
node --test tests/agent-kernel-model-loop.test.mjs
node --test tests/agent-kernel-task-manager.test.mjs
node --test tests/agent-kernel-replay-recorder.test.mjs
node --test tests/agent-kernel-mutation-coordinator.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "refactor: retire legacy agent runtime path"
```

## 17. Batch J 验收标准

Batch J 只有全部满足才算通过：

- Kernel v2 是唯一默认 agent execution path。
- legacy runtime loop 被删除、重命名，或明确 deprecated 且无 default callers。
- static boundary tests 防止重新引入 legacy ownership。
- 所有 product parity scenarios 通过。
- task/replay/mutation state 保持可恢复。
- release-facing Obsidian plugin behavior 稳定。
- `npm run lint`、`npm test`、`git diff --check` 通过。

## 18. J 之后的最终产品状态

J 之后，FRIDAY 不会自动等于 Codex 或 Manus 的完整产品。但它应该拥有同一类执行基础：

- Kernel-owned execution loop
- structured event stream
- task lifecycle as product state
- review-first file mutation
- typed failure and recovery semantics
- deterministic Harness and eval gates
- UI-independent replayable trajectory

这时再建设更成熟的 Agent workbench UI 才合理。那个 UI 可以接近 Codex/Manus 的成熟度，但应适配 Obsidian，而不是复制 coding-agent 产品。

## 19. 推荐顺序

不要在 Batch G 审查和提交前启动 Batch H。

推荐顺序：

1. 实施并验证 Batch G。
2. 对 Kernel contracts 和 ports 做一次 focused architecture review。
3. 实施 Batch H。
4. 跑完整 A-F/G/H eval gates。
5. 实施 Batch I。
6. 在 Obsidian 中做 product workflow review。
7. 只有旧所有权盘点清楚后，才实施 Batch J。

## 20. 停止条件

出现以下任一情况，停止迁移并请求方向：

- Kernel contracts 需要 import UI。
- Harness coverage 必须削弱才能通过。
- model loop migration 改变了用户可见行为，但没有明确 eval 更新。
- retry/continue 无法保留现有 task semantics。
- mutation review 能被默认 tool path 绕过。
- H/I 期间 `AgentRuntimeService` 继续变大，而不是缩小。
