# Agent Kernel v2 Execution Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> English counterpart: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.md`.

**Goal:** 把 `AgentKernel` 从 `AgentRuntimeService` 外面的一层 facade，推进成拥有稳定 turn contract、execution context、生命周期边界和 adapter port 的执行内核边界。

**Architecture:** Batch G 只建立 Kernel v2 的执行边界，不在本批次迁移完整模型/工具循环。Kernel 先拥有 `AgentTurnInput`、`AgentTurnResult`、`AgentTurnEvent`、`AgentExecutionContext` 和 port interface；旧 runtime 暂时留在兼容 adapter 后面，等 Batch H 再迁移循环。这样既保留 A-F Harness 的保护，又阻止后续继续把 `AgentRuntimeService` 做得更大。

**Tech Stack:** TypeScript、Obsidian plugin runtime、Node test runner、通过 `jiti` 加载 TypeScript 的测试、现有 fake runtime harness、现有 Agent task/replay/mutation/context 模块。

---

## 0. 当前基线

本计划假设 A-F 收口批次已经通过：

- 已有分支 checkpoint，预期最近提交类似 `chore: close kernel v2 harness batches`
- `npm run lint` 通过
- `npm test` 通过
- `git diff --check` 通过
- `tests/evals/agent-scenarios.json` 与 `docs/plans/agent-eval-quality-gates.md` 的场景数量和 ID 对齐
- A-F 文件已经提交，不再作为 untracked 文件留在工作树

当前架构状态：

- `src/core/agent-kernel/AgentKernel.ts` 已存在，但本质上仍然是 pass-through wrapper。
- `src/services/AgentRuntimeService.ts` 仍然拥有 turn id 创建、active task 状态、cancellation controller 状态、prompt/native 模型循环、工具执行、任务生命周期、mutation review、replay event 持久化和结果拼装。
- A-F 已经补上迁移需要的安全网：Harness、Tool Registry、Capability Policy、Tool Gateway、Turn Event Log、Replay Reader、Mutation Plan Review、Context budget/boundary、eval 场景和产品任务生命周期。

现在是停止扩展功能面、开始把所有权迁到 Kernel v2 的时间点。

## 1. 范围

Batch G 是 **Kernel v2 contracts and execution context**。

Batch G 完成后应满足：

1. `src/core/agent-kernel/` 定义稳定的 Kernel v2 contract。
2. `AgentKernel` 依赖 port，而不是直接依赖 `AgentRuntimeService`。
3. 每个 turn 都有明确的 `AgentExecutionContext` 对象。
4. cancellation、turn identity、event collection 和 failure classification 都进入 kernel-level 类型。
5. 旧 runtime 只能通过兼容 adapter 调用。
6. 现有 A-F 行为和测试继续通过。

Batch G 不做：

- 不把 native/prompt 模型循环迁出 `AgentRuntimeService`
- 不删除 `AgentRuntimeService`
- 不增加 Build mode
- 不增加 Wiki/RAG/MCP/background agent/multi-agent 功能
- 不重做 Daily Board UI
- 不改变 release/version 行为
- 不引入新的模型 provider SDK

## 2. 设计决策

推荐方案：**port-first kernel boundary, legacy loop adapter**。

考虑过的其他方案：

- **一次性大重写：** 一批迁移模型循环、工具、mutation、事件和任务生命周期。风险太高，因为 `AgentRuntimeService` 体量大、有状态、已经连着产品界面。
- **继续 facade：** 保持 `AgentKernel` 只是薄包装，继续往 `AgentRuntimeService` 里加能力。短期快，但会继续固化我们正想摆脱的边界问题。
- **先建 port 边界：** 现在先定义 contract、execution context 和 adapter interface；旧 loop 先放在 adapter 后面；Batch H 再迁移 loop 所有权。这是最小但方向正确的一步。

Batch G 应采用第三种。

## 3. Batch G 后的目标 Runtime 形态

Batch G 之前：

```text
ExecutionOrchestrator
  -> AgentRuntimeFacade
    -> AgentKernel
      -> AgentRuntimeService.runTurn(input)
```

Batch G 之后：

```text
ExecutionOrchestrator
  -> AgentRuntimeFacade
    -> AgentKernel
      -> create AgentExecutionContext
      -> normalize AgentTurnInput
      -> call RuntimeTurnExecutorPort
        -> LegacyAgentRuntimeAdapter
          -> AgentRuntimeService.runTurn(legacy input)
      -> normalize AgentTurnResult
      -> classify failure / terminal status
```

这仍然不是最终 Kernel v2 loop。真正重要的变化是所有权：Kernel 开始拥有 turn contract 和 context，旧 runtime 变成 port 后面的 adapter。

## 4. 核心 Contract

在 `src/core/agent-kernel/contracts/` 下创建 kernel-owned contract。

### AgentTurnInput

用途：Kernel v2 的标准输入形态。

必需字段：

- `turnId?: string`
- `conversationId: string`
- `agentId: string`
- `userPrompt: string`
- `conversation: ChatMessage[]`
- `mode: AgentMode`
- `allowedTools?: string[]`
- `modelOverride?: string`
- `currentFilePath?: string`
- `extraSystemContext?: string`
- `depth?: number`
- `signal?: AbortSignal`
- `metadata?: Record<string, unknown>`

重要规则：`AgentTurnInput` 不能从 UI 文件导入类型。只能依赖 shared core 类型。

### AgentTurnResult

用途：Kernel v2 的标准结果形态。

必需字段：

- `turnId: string`
- `conversationId: string`
- `status: "completed" | "waiting_for_approval" | "waiting_for_user" | "failed" | "cancelled"`
- `assistantText: string`
- `events: AgentTurnEvent[]`
- `task?: AgentTask`
- `traces?: RuntimeToolTrace[]`
- `pendingMutations?: MutationPlan[]`
- `failure?: AgentFailure`
- `raw?: unknown`

重要规则：最终状态必须显式。不能只因为 assistant text 非空就推断成功。

### AgentTurnEvent

用途：UI 无关、可流式输出、可 replay 的事件形态。

最小事件族：

- `turn_started`
- `model_request`
- `model_response`
- `tool_call`
- `tool_result`
- `approval_requested`
- `approval_resolved`
- `mutation_planned`
- `mutation_applied`
- `mutation_rejected`
- `context_compacted`
- `task_updated`
- `turn_completed`
- `turn_failed`
- `turn_cancelled`

Batch G 不需要迁移所有现有 event emitter。它必须先定义标准形态，并把 legacy 输出适配成这个形态。

### AgentFailure

用途：用类型化 failure classification 替代分散的字符串判断。

第一版类别：

- `model_transport`
- `model_protocol`
- `tool_denied`
- `tool_failed`
- `approval_denied`
- `mutation_conflict`
- `mutation_failed`
- `context_overflow`
- `cancelled`
- `max_iterations`
- `unknown`

Batch G 应包含一个小 classifier，把当前 legacy result/failure 信息映射到这些类别。Batch H 迁移 loop 后再加深。

## 5. AgentExecutionContext

创建 `src/core/agent-kernel/AgentExecutionContext.ts`。

context 保存每个 turn 的执行状态：

- `turnId`
- `conversationId`
- `agentId`
- `mode`
- `startedAt`
- `abortController`
- `events`
- `metadata`
- helper: `get signal()`
- helper: `emit(event)`
- helper: `cancel(reason)`
- helper: `isCancelled()`
- helper: `snapshotEvents()`

规则：

- 不使用 static singleton state。
- 不依赖 `DailyBoardView`。
- 不依赖 Obsidian UI API。
- 不依赖 `AgentRuntimeService`。
- 可以使用 `src/core/` 里小型 pure helper。

这个 context 是后续从旧 service 移除 `activeTurnId`、`activeTaskId`、`activeTaskAbortController` 的起点。

## 6. Ports

创建 `src/core/agent-kernel/AgentKernelPorts.ts`。

第一版 ports：

```ts
export interface RuntimeTurnExecutorPort {
  execute(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentTurnResult>;
}

export interface AgentEventSinkPort {
  emit(event: AgentTurnEvent): void | Promise<void>;
}

export interface AgentFailureClassifierPort {
  classify(error: unknown, partial?: Partial<AgentTurnResult>): AgentFailure;
}
```

这一批保持克制，不要把所有未来 port 都实现出来。

后续可能的 ports 只记录，不在 Batch G 完整实现：

- `ModelDriverPort`
- `ToolGatewayPort`
- `ContextEnginePort`
- `MutationPort`
- `TaskStorePort`
- `ReplayStorePort`

## 7. Legacy Adapter

创建兼容 adapter，放在纯 kernel contract 外。

推荐位置：

- `src/services/LegacyAgentRuntimeAdapter.ts`

职责：

- 接收 `AgentTurnInput` 和 `AgentExecutionContext`。
- 转换成当前 `RuntimeTurnInput`。
- 转发 cancellation signal。
- 调用 `AgentRuntimeService.runTurn`。
- 将 legacy `RuntimeTurnResult` 转成 `AgentTurnResult`。
- 保留 `task`、`traces`、`pendingMutations`、`contextSummary` 和原始 assistant text。
- 把 parse error、throw error、cancellation、max-iteration stop 映射到 `AgentFailure`。

重要规则：`AgentKernel.ts` 不能 import `AgentRuntimeService`。只有 adapter 可以知道 legacy service。

## 8. AgentKernel 职责

修改 `src/core/agent-kernel/AgentKernel.ts`。

Batch G 后，`AgentKernel` 应该：

1. 接收 `RuntimeTurnExecutorPort`
2. 把输入 normalize 成 `AgentTurnInput`
3. 创建 `AgentExecutionContext`
4. emit `turn_started`
5. 调用 executor port
6. normalize terminal status
7. emit `turn_completed`、`turn_failed` 或 `turn_cancelled`
8. 返回 `AgentTurnResult`

它不应该：

- 直接调用 `AgentRuntimeService`
- 读取 Obsidian UI state
- 直接改 vault 文件
- 拥有 tool implementation
- 拥有模型 provider client

## 9. Facade 与现有 Runtime 兼容

需要修改：

- `src/core/agent-kernel/AgentKernel.ts`
- `src/core/execution/ExecutionOrchestrator.ts`
- `src/main.ts`
- `src/types/plugin.ts`
- `src/services/LegacyAgentRuntimeAdapter.ts`

`AgentRuntimeFacade` 可以暂时保留现有 public method shape，避免 `ExecutionOrchestrator` 和 `DailyBoardView` 发生大范围改动。

兼容预期：

- 现有 call site 仍能拿到 `assistantText`、`traces`、`task`、必要时的 `parseError`。
- Kernel result 可以带更丰富字段，但 adapter 不能破坏现有测试。
- 如果需要 shape conversion，集中放在一个地方，不要散到 UI 里。

## 10. 测试

Batch G 必须 test-first。

### Task-level tests

创建或扩展：

- `tests/agent-kernel-contracts.test.mjs`
- `tests/agent-kernel-execution-context.test.mjs`
- `tests/agent-kernel-facade.test.mjs`
- `tests/agent-runtime-harness-e2e.test.mjs`

必须断言：

1. `AgentKernel` 不再 import `AgentRuntimeService`。
2. Kernel 创建带稳定 `turnId`、`conversationId`、`agentId` 的 `AgentExecutionContext`。
3. Kernel 对 success、failure、cancellation 都 emit terminal event。
4. Kernel 使用 `RuntimeTurnExecutorPort`。
5. Legacy adapter 映射 legacy result 到 kernel result 时不丢 task/traces/mutations。
6. cancellation signal 会传入 legacy runtime path。
7. 现有 `ExecutionOrchestrator` 仍然通过 `AgentRuntimeFacade`。
8. A-F harness scenarios 继续通过。

### Static boundary test

新增测试或断言，扫描 `src/core/agent-kernel/**/*.ts` 的 forbidden imports：

- `src/services/AgentRuntimeService`
- `DailyBoardView`
- Obsidian UI view modules

如确实需要，允许从 shared core contracts 做 type-only import。Kernel core 内尽量完全避免 Obsidian import。

### Verification commands

运行：

```bash
node --test tests/agent-kernel-contracts.test.mjs
node --test tests/agent-kernel-execution-context.test.mjs
node --test tests/agent-kernel-facade.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

## 11. 实施任务

### Task 1: Baseline And Failing Boundary Test

**Files:**

- Create: `tests/agent-kernel-contracts.test.mjs`
- Modify: none initially

**Steps:**

1. 断言 `src/core/agent-kernel/AgentKernel.ts` 不得包含 `AgentRuntimeService`。
2. 断言 contract 文件存在。
3. 运行测试，确认实现前失败。

预期失败：

- contract 文件不存在
- 当前 `AgentKernel.ts` import 或引用 legacy runtime

### Task 2: Add Kernel Contracts

**Files:**

- Create: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Create: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Create: `src/core/agent-kernel/contracts/AgentFailure.ts`
- Create: `src/core/agent-kernel/contracts/index.ts`
- Modify: `tests/agent-kernel-contracts.test.mjs`

**Steps:**

1. 定义稳定 input/result/event/failure 类型。
2. 保持 imports core-only。
3. 增加 exported shape names 和 allowed status/failure values 测试。
4. 运行 targeted test。

### Task 3: Add AgentExecutionContext

**Files:**

- Create: `src/core/agent-kernel/AgentExecutionContext.ts`
- Create: `tests/agent-kernel-execution-context.test.mjs`

**Steps:**

1. 先写 context creation、event emission、cancellation、snapshot behavior 测试。
2. 实现最小 context class。
3. 确保 snapshot clone event arrays，不暴露可变内部数组。
4. 运行 targeted test。

### Task 4: Add Ports And Failure Classifier

**Files:**

- Create: `src/core/agent-kernel/AgentKernelPorts.ts`
- Create: `src/core/agent-kernel/AgentFailureClassifier.ts`
- Modify: `tests/agent-kernel-contracts.test.mjs`

**Steps:**

1. 定义 `RuntimeTurnExecutorPort`。
2. 定义可选 event sink/failure classifier ports。
3. 实现当前 legacy errors 的简单 failure classifier。
4. 测试 cancellation、max iterations、retryable transport、tool denial、mutation conflict 和 unknown。

### Task 5: Refactor AgentKernel To Use Ports

**Files:**

- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. 写 fake `RuntimeTurnExecutorPort` 测试。
2. 让 `AgentKernel` constructor 接收 port。
3. 让 `AgentKernel.runTurn` 创建 `AgentExecutionContext`。
4. 确保 success/failure/cancellation terminal events 被追加。
5. 保留 `AgentRuntimeFacade` 作为兼容表面。

预期结果：

- `AgentKernel` 不再是直接 delegate。
- 测试证明它创建 context 并调用 executor port。

### Task 6: Add LegacyAgentRuntimeAdapter

**Files:**

- Create: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. 实现 kernel input 到现有 `RuntimeTurnInput` 的转换。
2. 实现 legacy `RuntimeTurnResult` 到 kernel result 的转换。
3. 保留 `task`、`traces`、`pendingMutations` 和 parse/failure metadata。
4. 在 `main.ts` 中按这个顺序 wire：
   - create `AgentRuntimeService`
   - create `LegacyAgentRuntimeAdapter`
   - create `AgentKernel(adapter)`
   - create `AgentRuntimeFacade(kernel)`
5. 运行 facade tests。

### Task 7: Keep ExecutionOrchestrator Stable

**Files:**

- Modify only if necessary: `src/core/execution/ExecutionOrchestrator.ts`
- Modify only if necessary: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. 确认 orchestrator 仍然依赖 facade，不依赖 legacy runtime。
2. 如果 result shape 改了，把兼容转换隔离在 facade，不要放到 UI。
3. 运行 orchestrator/facade test。

### Task 8: Harness And Eval Regression

**Files:**

- Modify only if necessary: `tests/helpers/fakeAgentRuntime.mjs`
- Modify only if necessary: `tests/agent-runtime-harness-e2e.test.mjs`
- Modify only if necessary: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. 运行 A-F harness tests。
2. 如果 helper wiring 假设直接 runtime service，则改成 facade/kernel path。
3. 不削弱现有 assertions。
4. 运行完整 eval runner。

### Task 9: Documentation Update

**Files:**

- Modify: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.md`
- Modify: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.zh.md`
- Modify only if needed: `docs/plans/agent-eval-quality-gates.md`

**Steps:**

1. 如果实施过程中有偏离，更新本计划。
2. 记录 Batch G 是完成、部分完成，还是被拆分。
3. 保持中英文文档一致。

### Task 10: Final Verification And Commit

**Commands:**

```bash
node --test tests/agent-kernel-contracts.test.mjs
node --test tests/agent-kernel-execution-context.test.mjs
node --test tests/agent-kernel-facade.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch
```

Commit message:

```bash
git add src tests docs
git commit -m "feat: establish agent kernel v2 execution boundary"
```

## 12. 验收标准

Batch G 只有全部满足才算通过：

- `AgentKernel.ts` 不再 import `AgentRuntimeService`。
- `AgentKernel` 创建并使用 `AgentExecutionContext`。
- `AgentKernel` 调用 executor port，而不是 concrete service。
- 旧 runtime 只能通过 `LegacyAgentRuntimeAdapter` 进入。
- 现有 `ExecutionOrchestrator` 继续通过 `AgentRuntimeFacade`。
- Kernel contracts 定义明确 status 和 failure taxonomy。
- 新测试覆盖 contracts、context、facade、adapter mapping 和 forbidden imports。
- A-F harness/eval tests 继续通过。
- `npm run lint`、`npm test`、`git diff --check` 通过。
- 不增加新的功能面。

## 13. 风险和处理

### Risk: Adapter 变成另一个垃圾桶

处理：

- Adapter 只做 shape conversion 和调用 legacy runtime。
- 除 failure/result mapping 外，不放新业务逻辑。

### Risk: Kernel Contracts 太贴旧 Runtime

处理：

- Kernel status 和 event 用产品语义。
- 不把 legacy parse detail 变成 first-class concept，除非兼容必需。

### Risk: 测试只证明 wiring，不证明行为

处理：

- A-F harness/eval scenarios 继续作为行为门禁。
- 新增 import boundary 和 ownership 测试。

### Risk: 一批 refactor 过大

处理：

- 本批止步于 contracts/context/ports/adapter。
- 完整 model loop migration 放到 Batch H。

## 14. G 之后的下一批

### Batch H: Move The Model Loop

把 prompt/native model loop 所有权从 `AgentRuntimeService` 迁到 Kernel v2。旧 service 变成提供 Obsidian-specific ports 的 adapter。

### Batch I: Move Task, Replay, And Mutation Ownership

Kernel 成为 task state、replay events 和 mutation plan events 的生产者。UI 只渲染状态并触发被批准的动作。

### Batch J: Legacy Runtime Retirement Gate

只有当 Kernel v2 拥有等价 harness/eval 覆盖和 production adapter parity 后，才删除或缩小旧 runtime 代码。

## 15. 确认问题

如果下一步实现应优先解决架构所有权，而不是继续加用户可见功能，就批准 Batch G。

如果你想走更激进路线，需要先改这份计划。激进路线会合并 Batch G 和 H，但风险更高，因为它会同时迁移 contract 和 model loop 行为。
