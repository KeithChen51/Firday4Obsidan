# Agent Harness And Product Maturity Implementation Plan

> English counterpart: `docs/plans/2026-04-30-agent-harness-product-maturity.md`.
> 中文与英文版本应保持同一执行顺序：Harness First，然后 Kernel Governance，最后 Product Task Lifecycle。
> Kernel v2 的设计标准见：`docs/plans/2026-04-30-agent-kernel-v2-design-charter.zh.md`。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Agent Harness and maturity roadmap that moves FRIDAY from a promising Obsidian Agent runtime to a reliable, testable, reviewable, product-grade Obsidian-native Knowledge Work Agent.

**Architecture:** Treat Harness as the control shell around Agent execution, not merely a test helper. First make runtime behavior scriptable and observable, then consolidate tools, policy, event logging, mutation review, context management, evals, and task lifecycle around that shell.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner (`node --test`), esbuild, existing FRIDAY runtime services under `src/services`, `src/core`, `src/platform`, and test files under `tests/*.mjs`.

---

## 0. 这份规划解决什么问题

前面的 Agent Kernel 计划已经覆盖了工具注册、事件日志、权限、文件改动审查、上下文管理和 fake model 测试。但它还偏“内核工程改造”，没有把 Harness、成熟产品体验和最终门禁串成完整路线。

这份规划补齐三件事：

1. 明确 Harness 到底是什么。
2. 明确 Kernel 成熟和产品成熟的边界。
3. 给出从当前代码到成熟 Obsidian Agent 产品的阶段、文件、测试、验收标准。

本计划不是要把 FRIDAY 立刻做成 Codex、Manus、opencode 或 Hermes 的完整替代品，而是借鉴它们的成熟 Agent 运行结构，把 FRIDAY 推到“能稳定完成 Obsidian 多轮知识工作”的基础成熟度。

产品边界已经明确：

- FRIDAY 短期内是 Obsidian-native Knowledge Work Agent，不是通用 Coding Agent。
- 核心任务是理解当前笔记和 vault、跨文件检索、总结/对比、改写/整理、链接/标签/frontmatter、日记/项目笔记、草稿生成、笔记拆分/合并、任务提取，以及可审查的 vault 改动。
- Build、test、LSP、terminal-first loop 不是普通用户默认能力。
- 如果未来自然长出通用 Coding Agent 能力，可以接受，但它不能反向支配 v2 Kernel 和 Harness 的短期设计。

## 1. 核心判断

当前 FRIDAY 已经有 Agent runtime 雏形：

- `src/views/DailyBoardView.ts` 负责 UI 输入和调用。
- `src/core/execution/InvocationResolver.ts` 解析普通输入、slash 命令和 skill 调用。
- `src/core/execution/ExecutionPlanner.ts` 做轻量规划。
- `src/core/execution/ExecutionOrchestrator.ts` 组装上下文并调用 runtime。
- `src/services/AgentRuntimeService.ts` 执行模型循环、工具调用、fallback、trace 和结果返回。
- `src/platform/tools/ToolManifestCatalog.ts` 保存部分工具 manifest。
- `src/core/context/ContextAssembler.ts` 负责上下文拼装和粗裁剪。
- `src/core/execution/ExecutionGate.ts` 做 runtime 和 capability 开关检查。
- `tests/*.mjs` 有不少回归测试，但很多仍是源码字符串级测试。

问题不是“没有 Agent”，而是当前 Agent 还缺少成熟运行系统需要的硬边界：

- 工具协议没有单一事实源。
- 模型回合不可完整重放。
- 文件 mutation 缺少标准 plan-review-apply。
- 测试不能稳定模拟真实 Agent 多步行为。
- 失败和恢复不是产品级体验。
- 上下文管理和 tool message 边界不够强。

## 2. Harness 的定义

这里的 Harness 不只是 `tests/helpers/fakeAgentRuntime.mjs`。

Harness 应该是 FRIDAY Agent 的“可控执行外壳”，包含两层：

### 2.1 Runtime Harness

Runtime Harness 是生产 runtime 的可观测、可审查、可恢复执行边界。

它负责：

- 给每轮 Agent 分配 `turnId`、`taskId`。
- 记录模型请求、模型响应、工具请求、工具结果、审批结果、最终回复。
- 把工具调用统一交给 registry、policy 和 gateway。
- 把写入动作转成 mutation plan。
- 把运行状态暴露给 UI。

### 2.2 Test Harness

Test Harness 是 Runtime Harness 的可脚本化替身。

它负责：

- 用 fake model 模拟模型响应。
- 用 fake vault 模拟 Obsidian 文件系统。
- 用 fake approval 模拟同意、拒绝、超时、取消。
- 用 scripted scenario 验证完整回合。
- 输出 event log、trace、pending mutation、assistant final answer 供断言。

成熟 Agent 产品必须同时有这两层。只有 Test Harness 没有 Runtime Harness，会变成“测试很漂亮但生产不可控”。只有 Runtime Harness 没有 Test Harness，会变成“看起来工程化但没人能证明它稳定”。

## 3. 目标架构

```text
User input
  |
  v
DailyBoardView
  |
  v
InvocationResolver
  |
  v
ExecutionPlanner
  |
  v
ExecutionOrchestrator
  |
  v
AgentRuntimeFacade
  |
  v
Agent Kernel v2 + Harness
  |
  +--> ModelDriver
  |      +--> AIService driver
  |      +--> Scripted fake driver
  |
  +--> ToolRegistry
  |      +--> prompt schemas
  |      +--> native tool definitions
  |      +--> manifest metadata
  |      +--> dispatch metadata
  |
  +--> CapabilityPolicy
  |      +--> read/write/delete/external risk
  |      +--> exec only in debug/developer profile
  |      +--> auto approval rules
  |      +--> project scope rules
  |
  +--> ToolGateway
  |      +--> approval
  |      +--> execution
  |      +--> result normalization
  |
  +--> MutationPlanner
  |      +--> pending write/edit/delete plans
  |      +--> apply/reject
  |
  +--> TurnEventLog
         +--> replay
         +--> debug
         +--> E2E assertions
```

目标不是把旧 `AgentRuntimeService` 修成更大的 service。目标是在它旁边建立 Kernel v2 和 Harness 边界，让旧 runtime 的高风险部分逐步迁出；每迁一步，都必须有 Harness scenario 和 eval 保护。

## 4. 成熟度分层

### Level 0: 当前状态

Agent 可以调用工具，能处理 prompt/native 模式，有权限审批和 trace，但协议分散，测试偏静态，产品恢复能力弱。

### Level 1: Testable Agent

有 fake model E2E Harness。可以稳定复现一轮或多轮 Agent 行为。

完成标准：

- 能脚本化模型 tool call。
- 能脚本化 final answer。
- 能断言工具调用顺序。
- 能断言 trace 和 event log。
- 能覆盖工具成功和失败。

### Level 2: Governed Agent

工具、权限、风险等级、执行入口统一。

完成标准：

- `ToolRegistry` 是工具定义唯一来源。
- `CapabilityPolicy` 是权限判断唯一入口。
- `exec` 只在 debug/developer profile allowlist。
- 普通 Obsidian modes 不暴露 exec/build/LSP。
- Wiki/RAG/MCP 继续 gated。

### Level 3: Reviewable Agent

所有高风险文件 mutation 默认可审查。

完成标准：

- `write`、`edit`、`delete` 默认生成 pending mutation plan。
- UI 可以 Apply / Reject。
- event log 记录 plan、apply、reject。
- auto apply 只能显式开启。

### Level 4: Recoverable Agent

Agent 失败可解释，回合可回放，状态可恢复。

完成标准：

- 每轮 runtime 都有 JSONL event log。
- 有 replay reader。
- 有 task lifecycle。
- 失败状态能展示给用户。

### Level 5: Product Mature Agent

FRIDAY 具备成熟产品体验，而不只是稳定内核。

完成标准：

- 用户能看到任务状态。
- 用户能理解失败原因。
- 用户能重试、取消、继续。
- 重要改动有 diff review。
- 有固定 eval suite 保护核心能力。

## 5. 不在本轮范围

这些工作暂不做：

- Wiki 正式上线。
- RAG 检索增强。
- MCP marketplace。
- 多 Agent 协作。
- 后台 cron / background agent。
- 长周期 autonomic agent。
- 云端同步或远程执行。
- 大规模 UI 重设计。

原因：这些功能都会放大当前 runtime 不成熟带来的风险。先把 Harness 和 Kernel 稳住，再打开复杂外挂。

## 6. 推荐执行顺序

推荐分 8 个阶段。

```text
Phase 0  Freeze and baseline
Phase 1  Agent Test Harness
Phase 2  Tool Registry
Phase 3  Capability Policy and Tool Gateway
Phase 4  Turn Event Log and Replay
Phase 5  Mutation Plan Review
Phase 6  Context and Tool Boundary
Phase 7  Eval Suite and Quality Gates
Phase 8  Product Task Lifecycle
```

关键调整：把 Harness 提前到 Phase 1。不要等所有 runtime 改完后才补 Harness。

产品校准：模式和 evals 必须 Obsidian-first。不要新增默认 Build mode。coding-adjacent 工具只放进 debug/developer profile。

FRIDAY v2 modes:

- `ask`: 回答当前笔记或 vault 相关问题，必须引用可追溯证据。
- `research`: 跨文件检索、比较、总结，输出来源和不确定性。
- `write`: 生成或改写笔记内容，但写入必须先生成 mutation plan。
- `organize`: 整理链接、标签、frontmatter、日记、项目笔记、任务列表。
- `review`: 审查笔记结构、重复内容、断链、缺少来源、行动项遗漏。
- `debug`: 仅开发者使用，可启用 allowlisted exec 和 runtime diagnostic 工具。

## 7. Phase 0: 冻结外挂功能面

### 目标

明确在 Agent Kernel 成熟前，不继续扩大 Agent 功能面。

### 文件

- Create: `docs/plans/agent-kernel-maturity-gates.md`
- Modify: `CHANGELOG.md`
- Check: `src/constants/wikiFeature.ts`

### 任务

1. 写成熟度门禁文档。
2. 明确 Wiki、RAG、MCP、background agent、多 Agent 暂停。
3. 在 changelog 记录策略调整。
4. 保持 `WIKI_FEATURE_ENABLED=false`。

### 验收

- 用户不会在 UI 或 prompt 中看到未成熟的 Wiki 能力。
- 新工具不能绕过成熟度门禁进入 Agent prompt。
- 文档说明“为什么先做 Kernel/Harness”。

## 8. Phase 1: Agent Test Harness

### 目标

让 Agent 的输入到输出可脚本化、可复现、可断言。先建设测试外壳，再改内核。

### 文件

- Create: `tests/helpers/fakeAgentRuntime.mjs`
- Create: `tests/helpers/scriptedModelDriver.mjs`
- Create: `tests/helpers/fakeVault.mjs`
- Create: `tests/agent-runtime-harness-e2e.test.mjs`
- Modify only if necessary: `src/services/AgentRuntimeService.ts`

### 设计

Test Harness 输入：

```js
{
  files: {
    "Project/workspace/a.md": "alpha"
  },
  settings: {
    agentRuntime: {
      toolCallingMode: "native",
      toolRuntimeEnabled: true
    }
  },
  modelSteps: [
    { tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
    { assistant: "The file says alpha." }
  ],
  approvals: ["allow"]
}
```

Test Harness 输出：

```js
{
  assistantText: "The file says alpha.",
  traces: [],
  events: [],
  pendingMutations: [],
  files: {}
}
```

### 必须覆盖的场景

1. read -> final answer。
2. grep -> read -> final answer。
3. tool failure -> final answer reports failure。
4. permission denied -> no file change。
5. max tool iterations -> safe stop。
6. native mode success。
7. prompt mode success。
8. native incompatible -> prompt fallback。
9. retryable transport failure -> no prompt fallback。
10. malformed model JSON -> parse error event。
11. research mode: grep/search -> read multiple notes -> sourced synthesis。
12. organize mode: propose link/tag/frontmatter changes as pending mutation plans。

### 第一批测试

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
```

期望：

- 新测试可以驱动 `AgentRuntimeService.runTurn()` 完整执行。
- 如果当前 runtime 不支持注入 fake model，要先加最小注入点，不做大重写。

### 实现建议

优先测试当前 public surface。只有当 `AgentRuntimeService` 被具体 `AIService` 卡死时，再引入小接口：

- Create: `src/core/runtime/ModelDriver.ts`
- Modify: `src/services/AgentRuntimeService.ts`

接口保持很薄：

```ts
export interface ModelDriver {
  chat(messages: unknown[], options: unknown): Promise<string>;
  chatWithTools(messages: unknown[], tools: unknown[], options: unknown): Promise<unknown>;
}
```

不要在 Phase 1 引入复杂 AgentKernel 新类。先把 Harness 跑起来。

### 验收

- 至少 12 个 E2E 场景通过。
- 每个场景都能断言 assistant text、tool traces、events。
- 测试失败时能定位到具体工具或模型步骤。

## 9. Phase 2: Tool Registry

### 目标

工具定义单一事实源，消除 prompt/native/manifest/dispatch 漂移。

### 文件

- Create: `src/core/tools/ToolRegistry.ts`
- Modify: `src/platform/tools/ToolManifestCatalog.ts`
- Modify: `src/core/context/PromptContextEngine.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/tool-registry.test.mjs`
- Test: `tests/native-tool-registry-regression.test.mjs`

### Registry 应包含

- tool name
- description
- json schema
- native tool schema
- risk level
- capability
- read/write/delete/external category
- debug/developer-only exec category
- gated feature flag
- handler name
- prompt exposure rules

### 数据流

```text
ToolRegistry
  |
  +--> prompt tool instructions
  +--> native tool definitions
  +--> manifest catalog
  +--> capability policy
  +--> dispatch lookup
```

### 验收

- 不再手写多套工具列表。
- `compile_wiki` 受 feature gate 控制。
- `exec` 不会因为 prompt 漏写而绕过 policy。
- 测试能比较 registry、native definitions、manifest 输出。

## 10. Phase 3: Capability Policy And Tool Gateway

### 目标

把工具执行前的判断统一到 policy 和 gateway，而不是散在 runtime 分支里。

### 文件

- Create: `src/core/policy/CapabilityPolicy.ts`
- Create: `src/core/tools/ToolGateway.ts`
- Modify: `src/core/execution/ExecutionGate.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/CommandExecService.ts`
- Test: `tests/capability-policy.test.mjs`
- Test: `tests/tool-gateway.test.mjs`
- Test: `tests/exec-profile-policy.test.mjs`

### Policy 决策

```ts
type CapabilityDecision =
  | { allow: true; approval: "none" | "standard" | "strict"; reason: string }
  | { allow: false; code: string; reason: string };
```

### exec 策略

默认策略：

- `ask` / `research` / `write` / `organize` / `review` 不暴露 exec。
- `debug` / `developer` profile 可以启用 allowlisted exec。

debug/developer allowlist：

- `npm test`
- `git status`
- `git diff`
- `rg`

拒绝：

- 任意 shell chaining。
- 任意未列入 allowlist 的命令。
- workspace 外 cwd。
- 远程下载后执行。
- 删除类命令。

### 验收

- 所有工具执行都经过 ToolGateway。
- 所有高风险动作都经过 CapabilityPolicy。
- exec 风险从 blocklist 转为 debug-profile allowlist。
- ask/research/write/organize/review 模式下 exec 不进入工具面。
- denied 结果进入 trace 和 event log。

## 11. Phase 4: Turn Event Log And Replay

### 目标

每轮 Agent 可追踪、可回放、可诊断。

### 文件

- Create: `src/core/runtime/TurnEventLog.ts`
- Create: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/RuntimeStateStore.ts`
- Test: `tests/turn-event-log.test.mjs`
- Test: `tests/turn-replay-reader.test.mjs`
- Extend: `tests/agent-runtime-harness-e2e.test.mjs`

### 事件类型

- `turn_started`
- `context_built`
- `model_requested`
- `model_completed`
- `model_failed`
- `tool_requested`
- `tool_policy_checked`
- `tool_approval_requested`
- `tool_approved`
- `tool_denied`
- `tool_completed`
- `tool_failed`
- `mutation_planned`
- `mutation_applied`
- `mutation_rejected`
- `assistant_final`
- `turn_failed`

### 存储位置

建议：

```text
.friday/runtime/
  conversations/
    <conversationId>/
      turns/
        <turnId>.jsonl
```

如果项目已有 runtime state 路径，应优先复用 `RuntimeStateStore` 的 path helper，不要新开一套隐藏目录体系。

### Replay Reader

Replay Reader 不需要第一版恢复执行，只要能：

- 读取某个 turn。
- 校验事件顺序。
- 输出摘要。
- 给测试断言。

### 验收

- 任意 Harness E2E 都能断言 event log。
- 失败回合也能写入 `turn_failed`。
- event log 不包含完整敏感内容时，要有摘要和 redaction 策略。

## 12. Phase 5: Mutation Plan Review

### 目标

文件写入、编辑、删除默认从“直接执行”变成“生成计划，用户审查后应用”。

### 文件

- Create: `src/core/mutations/MutationPlan.ts`
- Create: `src/core/mutations/MutationPlanStore.ts`
- Create: `src/core/mutations/MutationApplier.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/AgentActionService.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/types/settings.ts`
- Test: `tests/mutation-plan.test.mjs`
- Test: `tests/mutation-applier.test.mjs`
- Test: `tests/agent-runtime-mutation-review-e2e.test.mjs`

### Settings

新增：

```ts
fileMutationMode: "review" | "autoApproved";
```

默认：

```ts
fileMutationMode: "review";
```

### Mutation Plan 内容

- id
- turnId
- conversationId
- toolCallId
- operation: write/edit/delete
- target path
- before snapshot hash
- proposed content or patch
- risk level
- summary
- status: pending/applied/rejected/conflicted

### UI 行为

`DailyBoardView` 中显示：

- 文件路径。
- 操作类型。
- 摘要。
- Apply。
- Reject。
- 冲突提示。

第一版可以不做复杂 diff UI，但必须给出明确路径、操作和摘要。第二版再做 diff。

### 验收

- 默认 review 模式下，Agent 工具不会直接落盘。
- Apply 后才调用真实写入。
- Reject 后文件不变。
- before snapshot 不匹配时进入 conflicted。
- event log 记录 plan/apply/reject/conflict。

## 13. Phase 6: Context And Tool Boundary

### 目标

上下文按 token 预算组织，工具消息边界合法，避免模型请求被历史污染。

### 文件

- Create: `src/core/context/TokenBudget.ts`
- Create: `src/core/context/ToolBoundaryFilter.ts`
- Modify: `src/core/context/ContextAssembler.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/token-budget.test.mjs`
- Test: `tests/tool-boundary-filter.test.mjs`
- Test: `tests/context-assembler-token-budget.test.mjs`

### TokenBudget 第一版

可以先用近似 tokenizer，避免引入过大依赖：

```ts
export interface TokenCounter {
  count(text: string): number;
}
```

第一版近似：

- 英文按 4 字符约 1 token。
- 中文按 1.5 到 2 字符约 1 token。
- 后续再接真实 tokenizer。

### ToolBoundaryFilter 必须处理

- tool result 没有对应 tool call。
- assistant tool call 丢失。
- 重复 tool result。
- tool call id 不匹配。
- 被压缩历史截断后的孤立工具消息。

### 验收

- `ContextAssembler` 不再只靠 `text.length`。
- 超大工具结果会摘要或标记 trimmed。
- 发给模型的消息序列始终合法。
- Harness 场景覆盖脏历史。

## 14. Phase 7: Eval Suite And Quality Gates

### 目标

建立固定评估集，防止 Agent runtime 改动后能力退化。

### 文件

- Create: `tests/evals/agent-scenarios.json`
- Create: `tests/agent-eval-runner.test.mjs`
- Extend: `tests/helpers/fakeAgentRuntime.mjs`
- Create: `docs/plans/agent-eval-quality-gates.md`

### Eval 场景

第一批建议 14 个：

1. 读取单文件并引用证据。
2. grep 后读取命中文件。
3. 找不到文件时给清晰失败说明。
4. 请求写文件时生成 mutation plan。
5. 用户拒绝 mutation 后文件不变。
6. edit 冲突进入 conflicted。
7. delete 默认 strict approval。
8. organize mode 生成 daily/project note 整理计划。
9. review mode 发现重复内容、结构问题、断链或缺少来源。
10. debug profile 下 exec allowlist 放行 `npm test`。
11. 普通 Obsidian modes 下 exec 不进入工具面。
12. native tool failure 不错误 fallback 到 prompt。
13. 上下文过大触发 compaction。
14. 工具迭代上限触发安全停止。

### 质量门禁

每次 runtime 相关 PR 至少跑：

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm test
```

### 验收

- eval runner 输出每个 scenario 的 pass/fail 和失败原因。
- 失败能定位到 model step、tool step、policy step 或 mutation step。
- eval 文件可以扩展，不需要改 runner。

## 15. Phase 8: Product Task Lifecycle

### 目标

把 Agent 从“一次聊天回复”提升为“可管理任务”。

### 文件

- Create: `src/core/tasks/AgentTask.ts`
- Create: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/services/ConversationService.ts`
- Test: `tests/agent-task-lifecycle.test.mjs`
- Test: `tests/daily-board-agent-task-ui-regression.test.mjs`

### 任务状态

```text
created
running
waiting_for_approval
waiting_for_user
failed
cancelled
completed
```

### UI 最小形态

每个 Agent 回合显示：

- 当前状态。
- 正在做什么。
- 等待用户确认的动作。
- 失败原因。
- 可用操作：Retry、Cancel、Continue、Apply、Reject。

第一版不需要复杂项目管理 UI。只要让用户知道 Agent 当前卡在哪里，以及有没有改动文件。

### 验收

- 失败不是静默失败。
- 等待审批不是普通聊天消息。
- 用户可以取消正在进行的任务。
- 用户可以从失败状态重试。
- event log 和 task state 一致。

## 16. 最终成熟产品门禁

FRIDAY 可以重新考虑 Wiki/RAG/MCP 的条件：

### Kernel Gate

- ToolRegistry 是唯一工具定义来源。
- ToolGateway 是唯一工具执行入口。
- CapabilityPolicy 覆盖所有工具。
- exec 只在 debug/developer profile allowlist。
- TurnEventLog 覆盖所有 runtime 分支。
- Mutation review 默认开启。

### Harness Gate

- Fake model E2E 覆盖 prompt/native/fallback/error/review。
- E2E 覆盖 ask/research/write/organize/review 五个 Obsidian-first modes。
- Eval suite 至少 14 个核心场景。
- 所有 runtime PR 必须跑 eval。
- 测试不再主要依赖源码字符串匹配。

### Product Gate

- 用户能看到任务状态。
- 用户能审查文件改动。
- 用户能理解失败原因。
- 用户能重试、取消、继续。
- 产品文案不暴露未成熟功能。

全部通过后，才进入下一阶段：

- Wiki 正式能力。
- RAG。
- MCP。
- background agent。
- 多 Agent。

## 17. 风险和处理

### 风险 1: 改造范围过大

处理：

- Harness 先行。
- 每个阶段独立合并。
- 不做大重写。
- 每阶段都保留已有 runtime 行为。

### 风险 2: ToolRegistry 变成过度抽象

处理：

- 只抽现有工具需要的字段。
- 不为了未来 MCP 预留复杂插件系统。
- registry 只解决“当前多套定义漂移”。

### 风险 3: Mutation review 拖慢体验

处理：

- 默认 review。
- 提供显式 `autoApproved`。
- 只对 write/edit/delete 生效。
- read-only 工具不增加确认。

### 风险 4: Event log 写入敏感内容

处理：

- 对模型输入输出做摘要。
- 文件内容默认不完整写入 log。
- 记录 hash、path、summary。
- 需要完整内容时依赖 snapshot 或 vault 文件本身。

### 风险 5: Eval 变成维护负担

处理：

- scenario 数据化。
- runner 稳定。
- 每个 eval 只验证关键行为。
- 不要求模型真实生成，只用 scripted fake model。

## 18. 执行批次

### Batch A: Harness First

任务：

1. 新增 fake runtime harness。
2. 新增 scripted model driver。
3. 新增 fake vault。
4. 写 12 个 E2E 场景，覆盖普通工具流和 Obsidian-first modes。

验收命令：

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
```

### Batch B: Governed Tools

任务：

1. 新增 ToolRegistry。
2. 迁移 manifest/native/prompt schema。
3. 新增 CapabilityPolicy。
4. 新增 ToolGateway。
5. exec 改为 debug/developer profile allowlist，普通 Obsidian modes 不暴露。

验收命令：

```powershell
node --test tests/tool-registry.test.mjs
node --test tests/capability-policy.test.mjs
node --test tests/tool-gateway.test.mjs
node --test tests/exec-profile-policy.test.mjs
```

### Batch C: Replayable Runtime

任务：

1. 新增 TurnEventLog。
2. 新增 TurnReplayReader。
3. runtime 写入关键事件。
4. Harness 断言事件顺序。

验收命令：

```powershell
node --test tests/turn-event-log.test.mjs
node --test tests/turn-replay-reader.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
```

### Batch D: Reviewable Mutations

任务：

1. 新增 MutationPlan。
2. 新增 MutationPlanStore。
3. 新增 MutationApplier。
4. UI 显示 Apply / Reject。

验收命令：

```powershell
node --test tests/mutation-plan.test.mjs
node --test tests/mutation-applier.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
```

### Batch E: Context And Eval

任务：

1. TokenBudget。
2. ToolBoundaryFilter。
3. Eval scenarios。
4. Eval runner。

验收命令：

```powershell
node --test tests/token-budget.test.mjs
node --test tests/tool-boundary-filter.test.mjs
node --test tests/agent-eval-runner.test.mjs
```

### Batch F: Product Task Lifecycle

任务：

1. AgentTask。
2. AgentTaskStore。
3. UI 状态呈现。
4. Retry / Cancel / Continue。

验收命令：

```powershell
node --test tests/agent-task-lifecycle.test.mjs
node --test tests/daily-board-agent-task-ui-regression.test.mjs
npm test
```

## 19. 判断是否对齐成熟产品

如果只完成 Batch A 到 Batch E：

- 可以说 FRIDAY 对齐成熟 Obsidian Agent 框架的基础工程标准。
- 还不能说对齐成熟 Obsidian Agent 产品。

如果完成 Batch F，并且通过最终门禁：

- 可以说 FRIDAY 具备成熟 Obsidian-native Knowledge Work Agent 产品的最小形态。
- 但仍不是 Codex、Manus、opencode 或 Hermes 的完整等价物，因为那些产品还包含 remote sandbox、terminal/server-first loop、长期任务调度、多 Agent、生态工具和大规模 eval。

最准确的目标表述是：

> FRIDAY should become a reliable Obsidian-native Knowledge Work Agent with mature runtime primitives, not a clone of Codex, Manus, opencode, or Hermes.

中文表述：

> FRIDAY 应该先成为 Obsidian 内可信、可审查、可恢复的成熟知识工作 Agent，而不是急着复制 Codex、Manus、opencode 或 Hermes 的全部能力。

## 20. 下一步建议

立即从 Batch A 开始，不从 ToolRegistry 开始。

理由：

- Harness 是所有后续改造的安全网。
- 现有 runtime 复杂，直接改 registry/policy 容易引入回归。
- 有了 scripted fake model，就能证明每次改动是否破坏真实 Agent 回合。

第一张 PR 建议只做：

- `tests/helpers/fakeAgentRuntime.mjs`
- `tests/helpers/scriptedModelDriver.mjs`
- `tests/helpers/fakeVault.mjs`
- `tests/agent-runtime-harness-e2e.test.mjs`
- 必要时只给 `AgentRuntimeService` 加最小注入点。

这张 PR 的成功标准不是功能变多，而是让 FRIDAY 第一次拥有可靠的 Agent 行为回归测试外壳。
