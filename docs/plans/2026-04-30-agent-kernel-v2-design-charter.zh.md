# FRIDAY Agent Kernel v2 Design Charter

> English counterpart: `docs/plans/2026-04-30-agent-kernel-v2-design-charter.md`.
> 本文件是 Kernel v2 的设计宪章。实现前先读本文件，再读 `2026-04-30-agent-harness-product-maturity.zh.md`。

## 0. 结论

FRIDAY 应该新建 Agent Kernel v2，而不是继续在现有 `AgentRuntimeService` 上做大修。

Kernel v2 的目标不是复制 Codex、Manus、opencode、Hermes 或 obsidian-yolo 的全部功能，而是把这些成熟项目里的关键工程边界抽出来，做成一个适合 Obsidian 插件环境的 Agent 执行内核。

一句话定义：

> Agent Kernel v2 是一个 UI 无关、模型无关、工具无关、可事件回放、可审查、可测试的任务执行内核。

产品北极星：

> FRIDAY 短期内是 Obsidian-native Knowledge Work Agent，不是通用 Coding Agent。

这意味着 Kernel v2 首先服务于 Obsidian 中的多轮知识工作：读懂 vault、理解当前笔记、跨文件查找、总结归纳、改写整理、维护链接/标签/frontmatter/daily note/project note、生成草稿、拆分合并笔记、提取任务、提出下一步，并对 vault 内文件改动做可审查的 plan/apply/reject。

如果 Kernel v2 的设计最终顺带支持部分 Coding Agent 能力，这是架构成熟带来的奖励，不是短期产品目标。FRIDAY 不应该为了成为通用 Coding Agent 而牺牲 Obsidian 场景里的清晰性、安全性和体验。

它应该成为 FRIDAY 后续 Wiki、RAG、MCP、background agent、多 Agent 的基础，而不是这些功能的堆叠容器。

## 1. 为什么不是继续修旧 Runtime

当前 `src/services/AgentRuntimeService.ts` 已经承担了太多职责：

- 模型请求。
- prompt-mode 工具循环。
- native-tool 工具循环。
- fallback 判断。
- 工具定义。
- 工具 dispatch。
- 权限审批。
- 文件读写。
- exec。
- memory。
- Wiki context。
- trace。
- progress event。
- 上下文拼装。
- 工具结果压缩。

这不是单个函数的问题，而是边界问题。继续在里面修，会把旧结构制度化。

正确策略：

```text
Legacy AgentRuntimeService
  |
  | keep as compatibility shell / temporary fallback
  v
Agent Kernel v2
  |
  +-- contract-first execution
  +-- state machine
  +-- event log
  +-- tool governance
  +-- mutation review
  +-- harness-driven tests
```

旧 runtime 可以保留一段时间，但它应该逐步变成 adapter 或 legacy fallback。最终执行核心应该迁到 `src/core/agent-kernel/`。

## 2. 参考项目怎么用

参考项目不是模板，而是成熟边界的证据。

我们要问的不是“哪个项目最像 FRIDAY”，而是：

- 它把哪些职责拆开了？
- 它如何处理工具、权限、上下文、失败、会话、任务状态？
- 哪些设计适合 Obsidian 插件？
- 哪些设计太重，暂时不该引入？

## 3. 参考矩阵

### 3.1 Codex

参考重点：

- 任务执行不是一次聊天，而是可验证的工作流。
- 文件修改不是直接落盘，而是 patch / diff / review / apply。
- 执行结果需要 evidence；在 Obsidian 场景里，evidence 是引用笔记、路径、摘录、变更摘要、审查结果，而不是默认 build/test output。
- Agent 的最终回答要说明做了什么、验证了什么、没做到什么。

FRIDAY 应该借鉴：

- plan -> execute -> verify -> report 的工作流。
- 文件改动 review-first。
- 任务结果必须包含 evidence。
- 不把“模型说完成了”当成完成。

FRIDAY 暂不借鉴：

- 远程 sandbox。
- 完整代码 IDE 级工作流。
- Build/test 作为默认执行闭环。
- 多文件大型 patch UI 的全部复杂度。
- 云端任务调度。

落到 Kernel v2：

- `MutationPlan` 必须是一等对象。
- `VerificationEvent` 或 `ToolEvent` 必须进入 event log。
- `AgentTurnResult` 不能只有 assistant text，还要有 events、mutations、status、failure。

### 3.2 Manus

参考重点：

- Agent 任务有长期状态。
- 用户能看到任务正在做什么。
- 用户能理解何时等待确认、何时失败、何时完成。
- 任务不是单个 LLM 回合，而是一个 lifecycle。

FRIDAY 应该借鉴：

- `AgentTask` 概念。
- task status：created、running、waiting_for_approval、waiting_for_user、failed、cancelled、completed。
- 用户可见进度。
- retry / cancel / continue。

FRIDAY 暂不借鉴：

- 浏览器自动化。
- 云端长任务环境。
- 复杂多 Agent 调度。
- 大规模外部工具生态。

落到 Kernel v2：

- Kernel v2 不只返回一段文本，而是驱动 `AgentTask` 状态变化。
- `DailyBoardView` 应显示 task state，而不是把所有状态塞进聊天文本。

### 3.3 obsidian-yolo

本地源码：

- `.tmp/obsidian-yolo/src/core/agent/tool-gateway.ts`
- `.tmp/obsidian-yolo/src/core/mcp/localFileTools.ts`
- `.tmp/obsidian-yolo/src/core/agent/compaction.ts`
- `.tmp/obsidian-yolo/utils/chat/tool-boundary.ts`
- `.tmp/obsidian-yolo/utils/chat/tool-context-pruning.ts`

参考重点：

- `AgentToolGateway` 把工具状态、审批、运行中、拒绝、workspace scope 统一起来。
- local file tools 明确区分 list/search/read/edit/delete/move。
- `fs_edit` 通过 review/snapshot 处理文件修改。
- 同一个文件的多个 edit 可以合并，避免前一个 edit 改完后后一个 edit 基于旧行号失败。
- context compaction 以高信号 summary 继续会话。
- tool boundary / tool context pruning 防止脏工具消息污染后续模型请求。

FRIDAY 应该借鉴：

- ToolGateway。
- workspace scope。
- file edit review snapshot。
- context compact boundary。
- tool message boundary filter。
- 大工具结果可 pruning。

FRIDAY 暂不借鉴：

- MCP-first 工具体系。
- Web search / RAG / skill / memory 全部一次性进 Kernel。
- 大量 local file action 全部开放给模型。

落到 Kernel v2：

- `ToolGateway` 是所有工具执行唯一入口。
- `MutationPlanner` 处理 write/edit/delete。
- `ContextManager` 负责 compact/prune/boundary repair。
- `ToolCallStatus` 必须区分 pending_approval、running、success、error、rejected、aborted。

### 3.4 Hermes Agent

本地源码：

- `.tmp/hermes-agent/agent/context_engine.py`
- `.tmp/hermes-agent/agent/error_classifier.py`
- `.tmp/hermes-agent/agent/trajectory.py`
- `.tmp/hermes-agent/acp_adapter/permissions.py`
- `.tmp/hermes-agent/gateway/`
- `.tmp/hermes-agent/agent/*adapter.py`

参考重点：

- Context 是 engine，有生命周期、token usage、压缩阈值、session start/end。
- Error 是 taxonomy，不是散落字符串匹配。
- Trajectory 可以保存完整 Agent 轨迹，用于 debug/eval/training。
- Permission bridge 有明确 approval option：allow once、allow always、deny。
- gateway/channel 与 agent execution 分离。
- model providers 是 adapter。

FRIDAY 应该借鉴：

- `ContextEngine` 接口。
- `ErrorClassifier`。
- `TurnTrajectory` / `TurnEventLog`。
- `HumanApprovalPort`。
- `ModelDriver`。
- channel/session 与 kernel 分离。

FRIDAY 暂不借鉴：

- Telegram/Discord/Slack/WhatsApp gateway。
- cron scheduler。
- remote terminal backend。
- autonomous skill creation。
- self-improving memory loop。
- batch trajectory generation for training。

落到 Kernel v2：

- 错误必须先分类再决定动作：retry、fallback、compress、deny、abort。
- context 不是字符串函数，而是 session-aware engine。
- trajectory/event log 是核心输出，不是调试副产物。

### 3.5 Open Agent SDK TypeScript

本地源码：

- `.tmp/open-agent-sdk-typescript/src/agent.ts`
- `.tmp/open-agent-sdk-typescript/src/engine.ts`
- `.tmp/open-agent-sdk-typescript/src/types.ts`
- `.tmp/open-agent-sdk-typescript/src/session.ts`

参考重点：

- 高层 `Agent` API 和底层 `QueryEngine` 分离。
- 工具定义有 `ToolDefinition`、`ToolContext`、`ToolResult`。
- query 以 streaming events 输出。
- session 可以保存、恢复、fork。
- permissions 以 `CanUseToolFn` 插入。
- tools 可以 filter by allowed/disallowed。

FRIDAY 应该借鉴：

- 高层 facade 和底层 engine 分离。
- 类型 contract 先行。
- session persistence。
- streaming event 模型。
- tool definition shape。
- permission callback hook。

FRIDAY 暂不借鉴：

- 直接绑定某个 provider SDK。
- 默认 bypass permission。
- MCP/subagent/cron 作为 Kernel MVP。
- Node CLI 风格 session 存储路径。

落到 Kernel v2：

- `AgentKernel` 是底层 engine。
- `AgentRuntimeFacade` 或 adapter 对接现有 FRIDAY UI。
- `AgentTurnEvent` 流式输出。
- `AgentSessionStore` 支持 resume/fork，但默认落在 FRIDAY 项目工作区。

### 3.6 opencode

参考重点：

- Agent 核心应该像 server/kernel，被多个前端驱动，而不是绑死在 TUI 或某个 UI 里。
- session、message、task、diff、revert、abort、permission response 都应该是 API/facade 能力。
- Plan/Build 这类 mode 是 capability profile，不只是提示词风格。
- permission 可以按工具、路径、agent mode、session override 配置。
- MCP 是外部工具扩展层，不是核心 runtime。

FRIDAY 应该借鉴：

- Kernel/service API 思维。
- session/task 一等对象。
- frontend/kernel 分离。
- permission profile。
- diff/revert 的产品意识。

FRIDAY 暂不借鉴：

- terminal-first 产品形态。
- coding-first 的默认工具组合。
- LSP-first。
- Build mode 作为 Obsidian 用户默认模式。
- 完整 server/OpenAPI 暴露。

落到 Kernel v2：

- `AgentRuntimeFacade` 应提供 createTask/sendPrompt/abortTask/getEvents/applyMutation/rejectMutation/revertTurn 等内部 API。
- mode 应该按 FRIDAY 的 Obsidian 工作流定义，而不是照搬 coding agent 的 Build/Plan。

### 3.7 当前 FRIDAY

保留资产：

- Obsidian 插件生命周期。
- `DailyBoardView` 作为用户入口。
- `InvocationResolver` 和 slash/skill 入口经验。
- `ExecutionOrchestrator` 的上层调用位置。
- `WorkspaceAccessService` / project boundary。
- `ToolApprovalService` 的审批经验。
- 现有工具能力：read、list、grep、glob、write、edit、delete、memory。
- exec 只作为开发者/调试模式能力，不进入普通 Obsidian 工作流默认工具面。
- settings、conversation、project workspace 相关基础设施。

不继承：

- `AgentRuntimeService` 的职责混合结构。
- prompt/native 两套路由各自维护工具协议。
- 工具 schema 多处手写。
- 上下文字符级粗裁剪。
- regex/string-matching fallback 作为主要可靠性机制。
- 文件 mutation 直接落盘。

## 4. Kernel v2 做成什么

Kernel v2 的目标形态：

```text
src/core/agent-kernel/
  contracts/
    AgentTurn.ts
    AgentTask.ts
    AgentEvent.ts
    ToolContract.ts
    MutationContract.ts
    ErrorContract.ts

  kernel/
    AgentKernel.ts
    AgentTurnStateMachine.ts
    AgentLoopController.ts

  model/
    ModelDriver.ts
    ModelRequestBuilder.ts
    ModelResponseNormalizer.ts

  context/
    ContextEngine.ts
    TokenBudget.ts
    ContextPackage.ts
    ToolBoundaryFilter.ts
    ContextCompactor.ts

  tools/
    ToolRegistry.ts
    ToolGateway.ts
    ToolResultNormalizer.ts

  policy/
    CapabilityPolicy.ts
    WorkspaceScopePolicy.ts
    ExecPolicy.ts              # developer/debug profile only

  mutations/
    MutationPlanner.ts
    MutationPlanStore.ts
    MutationApplier.ts

  events/
    TurnEventLog.ts
    TurnReplayReader.ts
    TrajectoryExporter.ts

  tasks/
    AgentTaskStore.ts
    AgentTaskLifecycle.ts

  harness/
    ScriptedModelDriver.ts
    FakeVault.ts
    FakeApprovalPort.ts
    KernelScenarioRunner.ts
```

说明：

- `contracts/` 是最重要的第一步。
- `kernel/` 只做执行状态机和循环控制，不直接知道 Obsidian UI。
- `model/` 屏蔽 OpenAI、Anthropic、兼容网关差异。
- `context/` 负责预算、压缩、引用和边界。
- `tools/` 负责工具注册和调用入口。
- `policy/` 负责权限和风险判断。
- `mutations/` 负责文件变更计划和应用。
- `events/` 负责可观测、可回放和 eval。
- `tasks/` 负责产品级任务生命周期。
- `harness/` 负责测试驱动，不是生产逻辑。

## 5. 核心 Contract

### 5.1 AgentTurnInput

```ts
export interface AgentTurnInput {
  taskId: string;
  turnId: string;
  conversationId: string;
  userPrompt: string;
  messages: AgentMessage[];
  invocation: AgentInvocation;
  workspace: WorkspaceRef;
  model: ModelSelection;
  agentMode: "ask" | "research" | "write" | "organize" | "review" | "debug";
  allowedTools?: string[];
  mode: "auto" | "native" | "prompt";
  signal?: AbortSignal;
}
```

必须包含：

- 任务标识。
- 回合标识。
- 会话标识。
- 原始用户输入。
- 规范化消息。
- 工作区引用。
- 模型选择。
- Obsidian 工作模式。
- 工具限制。
- abort signal。

不能包含：

- DOM 对象。
- Obsidian View 实例。
- 模糊的 settings 大对象。
- 具体 provider client。

### 5.2 AgentTurnResult

```ts
export interface AgentTurnResult {
  taskId: string;
  turnId: string;
  status: "completed" | "failed" | "cancelled" | "waiting_for_approval";
  assistantText: string;
  events: AgentTurnEvent[];
  toolCalls: ToolCallRecord[];
  pendingMutations: MutationPlan[];
  usage?: ModelUsage;
  failure?: AgentFailure;
}
```

`assistantText` 只是输出的一部分。成熟 Kernel 的结果必须包含：

- 状态。
- 事件。
- 工具调用记录。
- pending mutation。
- usage。
- failure。

### 5.3 AgentTurnEvent

```ts
export type AgentTurnEvent =
  | { type: "turn_started"; turnId: string; taskId: string; at: string }
  | { type: "context_built"; summary: ContextSummary; at: string }
  | { type: "model_requested"; requestId: string; model: string; at: string }
  | { type: "model_completed"; requestId: string; usage?: ModelUsage; at: string }
  | { type: "model_failed"; requestId: string; failure: AgentFailure; at: string }
  | { type: "tool_requested"; call: ToolCallRequest; at: string }
  | { type: "tool_policy_checked"; callId: string; decision: CapabilityDecision; at: string }
  | { type: "tool_approval_requested"; callId: string; approvalId: string; at: string }
  | { type: "tool_completed"; callId: string; result: ToolResultSummary; at: string }
  | { type: "tool_failed"; callId: string; failure: AgentFailure; at: string }
  | { type: "mutation_planned"; plan: MutationPlanSummary; at: string }
  | { type: "assistant_final"; text: string; at: string }
  | { type: "turn_failed"; failure: AgentFailure; at: string };
```

事件是 Kernel 的事实记录。UI、Harness、Replay、Eval 都读事件。

### 5.4 AgentFailure

```ts
export interface AgentFailure {
  code: string;
  category:
    | "model"
    | "tool"
    | "permission"
    | "context"
    | "mutation"
    | "workspace"
    | "cancelled"
    | "internal";
  retryable: boolean;
  userMessage: string;
  technicalMessage?: string;
  cause?: unknown;
}
```

失败不是字符串。失败必须有 category、retryable、userMessage。

## 6. 状态机

Kernel v2 必须先是状态机，然后才是循环。

```text
created
  |
  v
context_building
  |
  v
model_requesting
  |
  v
model_responded
  |
  +--> assistant_final -> completed
  |
  +--> tool_requested
          |
          v
       policy_checking
          |
          +--> denied -> model_requesting or failed
          |
          v
       approval_checking
          |
          +--> waiting_for_approval
          |       |
          |       +--> approved -> tool_executing
          |       +--> rejected -> model_requesting or failed
          |
          v
       tool_executing
          |
          +--> tool_completed -> model_requesting
          +--> tool_failed -> model_requesting or failed

Any state
  +--> cancelled
  +--> failed
```

原则：

- 状态转移必须显式。
- 每次转移写 event。
- waiting state 不能假装成普通 assistant 文本。
- max iterations 是状态机规则，不是循环里的散落判断。

## 7. 工具调用路径

成熟路径：

```text
ModelResponse
  |
  v
ModelResponseNormalizer
  |
  v
ToolCallRequest
  |
  v
ToolRegistry.lookup()
  |
  v
CapabilityPolicy.evaluate()
  |
  v
HumanApprovalPort.requestIfNeeded()
  |
  v
ToolGateway.execute()
  |
  v
ToolResultNormalizer
  |
  v
TurnEventLog.append()
  |
  v
Model input for next step
```

不允许：

- 模型工具名直接进入 `switch` 执行。
- prompt/native 各自维护一份工具定义。
- policy 只检查 invocation，不检查实际 tool call。
- 工具返回任意对象直接塞回模型。

## 8. 文件 Mutation 路径

成熟路径：

```text
write/edit/delete tool call
  |
  v
MutationPlanner.createPlan()
  |
  v
MutationPlanStore.savePending()
  |
  v
TurnEventLog.mutation_planned
  |
  v
UI shows Apply / Reject
  |
  +--> Apply -> MutationApplier.apply() -> mutation_applied
  +--> Reject -> mutation_rejected
  +--> Conflict -> mutation_conflicted
```

默认：

- `write/edit/delete` 不直接落盘。
- `fileMutationMode="review"`。
- auto apply 必须显式开启。
- delete 永远高风险。

## 9. ContextEngine

Kernel v2 的 context 不能再是简单字符串拼接。

应该做成：

```ts
export interface ContextEngine {
  build(input: ContextBuildInput): Promise<ContextPackage>;
  updateFromModelUsage(usage: ModelUsage): void;
  shouldCompact(state: ContextState): boolean;
  compact(state: ContextState): Promise<ContextPackage>;
  repairToolBoundaries(messages: AgentMessage[]): AgentMessage[];
}
```

必须记录：

- 每段 context 来源。
- token 预算。
- 是否被裁剪。
- 裁剪原因。
- compact summary。
- tool boundary 修复。

参考 Hermes：

- context engine 有 session lifecycle。
- token usage 来自模型响应。
- 压缩阈值是 engine 的职责。

参考 obsidian-yolo：

- compact summary 保留当前目标、限制、已完成工作、失败、下一步。
- compaction boundary 不能破坏工具消息结构。

## 10. ErrorClassifier

错误处理不能继续靠散落 regex。

Kernel v2 应该有：

```ts
export interface ErrorClassifier {
  classify(error: unknown, context: ErrorContext): AgentFailure;
}
```

分类：

- auth。
- billing。
- rate_limit。
- provider_overloaded。
- timeout。
- context_overflow。
- payload_too_large。
- model_not_found。
- format_error。
- tool_error。
- permission_denied。
- workspace_denied。
- mutation_conflict。
- cancelled。
- unknown。

每类错误对应动作：

- retry。
- fallback model。
- compress context。
- ask user。
- abort。
- deny。

参考 Hermes 的价值是 taxonomy。FRIDAY 不需要照搬 provider 细节，但必须有集中分类器。

## 11. HumanApprovalPort

审批必须是协议，不是 UI 弹窗副作用。

```ts
export interface HumanApprovalPort {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export type ApprovalDecision =
  | { type: "allow_once" }
  | { type: "allow_always"; scope: ApprovalScope }
  | { type: "deny" }
  | { type: "cancel" }
  | { type: "timeout" };
```

参考 Hermes ACP permission bridge：

- allow once。
- allow always。
- deny。
- timeout 默认 deny。

FRIDAY 需要扩展：

- workspace scope。
- tool risk。
- file path。
- command preview。
- mutation summary。

## 12. ModelDriver

Kernel 不认识具体 provider。

```ts
export interface ModelDriver {
  request(input: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
```

`ModelResponse` 必须归一化：

- assistant text。
- tool calls。
- usage。
- raw provider metadata。
- stop reason。
- provider error。

参考 Open Agent SDK：

- high-level Agent 和 engine 分离。
- query engine 输出 streaming events。

参考 Hermes：

- 多 provider adapter。
- provider error 进入 error classifier。

FRIDAY 第一版只需要：

- `AIServiceModelDriver`。
- `ScriptedModelDriver`。

## 13. Harness

Harness 对准 Kernel v2 contract，而不是旧 runtime 行为。

Harness 应支持：

```ts
const scenario = {
  name: "read file then answer",
  files: {
    "Project/workspace/a.md": "alpha"
  },
  modelSteps: [
    { toolCall: { name: "read", args: { path: "Project/workspace/a.md" } } },
    { final: "The file says alpha." }
  ],
  approvals: ["allow_once"],
  expect: {
    finalIncludes: "alpha",
    events: ["turn_started", "model_requested", "tool_requested", "tool_completed", "assistant_final"],
    noFileChanges: true
  }
};
```

Harness 必须能模拟：

- fake model。
- fake vault。
- fake approval。
- fake tool failure。
- fake context overflow。
- fake cancellation。
- fake mutation conflict。
- fake exec policy denial。

Harness 是 Kernel v2 的验收标准，不是可选测试工具。

## 14. UI / Channel 边界

Kernel v2 不直接依赖 `DailyBoardView`。

边界：

```text
DailyBoardView
  |
  v
AgentRuntimeFacade
  |
  v
AgentKernel
```

`DailyBoardView` 只负责：

- 收集用户输入。
- 展示 task state。
- 展示 events/progress。
- 展示 pending mutation。
- 触发 Apply/Reject/Retry/Cancel/Continue。

Kernel 只负责：

- 执行状态机。
- 产生事件。
- 维护 task state。
- 返回结构化结果。

参考 Hermes gateway：

- channel 是入口，不是内核。
- 同一个 Agent 可以从 CLI/gateway 接入。

FRIDAY 不做多 channel，但要保持边界干净。

## 15. Kernel v2 MVP

第一版 Kernel v2 只做这些：

- single task。
- single conversation turn loop。
- native-style normalized model response。
- Obsidian-first modes：ask、research、write、organize、review。
- read/list/grep/glob/search_text。
- note_create_plan、note_edit_plan、note_split_plan、note_merge_plan。
- link_suggest、tag_suggest、frontmatter_update_plan。
- task_extract、daily_note_update_plan、project_note_update_plan。
- write/edit/delete 只能通过 note/file mutation plan，不直接 apply。
- memory 暂时作为外部工具，不做 self-improving loop。
- exec 默认关闭；只在 debug/developer profile 中 allowlist。
- event log。
- fake harness。
- task states。

不做：

- Wiki。
- RAG。
- MCP。
- multi-agent。
- cron。
- autonomous skill creation。
- remote sandbox。
- cloud sync。
- build/test/LSP 作为默认 Obsidian 用户能力。

## 16. Kernel v2 成熟标准

Kernel v2 不能以“能回答问题”作为完成标准。

必须满足：

### Contract Gate

- 所有核心类型在 `contracts/` 下定义。
- UI、model、tools、policy 不互相引用具体实现。
- 旧 runtime 不能成为 v2 contract 的来源。

### State Machine Gate

- 所有 turn 状态显式。
- 所有状态转移可测试。
- cancel、failure、waiting approval 是一等状态。

### Tool Gate

- 工具定义唯一来源。
- 所有工具调用经过 registry/policy/gateway。
- 工具结果归一化。
- prompt/native 不存在两套协议。

### Mutation Gate

- write/edit/delete 默认生成 plan。
- apply/reject/conflict 都有事件。
- 文件快照 hash 防止误应用。

### Context Gate

- token budget 可见。
- compaction 可测试。
- tool boundary 可修复。
- 大工具结果可摘要。

### Failure Gate

- 所有失败有 category/code/retryable/userMessage。
- provider 错误集中分类。
- 用户取消和权限拒绝不是 exception 字符串。

### Harness Gate

- 至少 12 个 scripted scenarios。
- 覆盖 success、tool failure、permission denied、mutation review、context overflow、cancel、max iteration。
- 每个 scenario 断言 events 和 result。

### Product Gate

- UI 能展示 running/waiting/failed/completed。
- 用户能 retry/cancel/continue。
- 用户能 apply/reject mutation。
- 用户能在 ask/research/write/organize/review 模式间理解 Agent 能力边界。
- 最终回答能说明已做、未做、验证情况。

## 17. 迁移策略

```text
Step 1: Write Kernel v2 contracts
Step 2: Build Harness against contracts
Step 3: Implement minimal Kernel v2 loop
Step 4: Add read-only tools through ToolGateway
Step 5: Add mutation planning
Step 6: Add event log and replay
Step 7: Add task lifecycle
Step 8: Wire ExecutionOrchestrator to Kernel v2 behind feature flag
Step 9: Run parity/eval suite
Step 10: Deprecate legacy AgentRuntimeService path
```

Feature flag：

```ts
agentRuntime.engine = "legacy" | "kernel_v2";
```

默认迁移顺序：

1. 开发环境默认 `kernel_v2`。
2. 旧 runtime 保留为 fallback。
3. eval 通过后移除 fallback。

## 18. 参考项目采纳清单

### 必须采纳

- Codex: reviewable file mutation and verification culture。
- Manus: task lifecycle and user-visible progress。
- obsidian-yolo: ToolGateway, edit review snapshot, compaction boundary。
- Hermes: ContextEngine, ErrorClassifier, trajectory, approval protocol。
- Open Agent SDK: type contracts, Agent/Engine split, streaming events, session persistence。
- opencode: session/task API, permission profile, diff/revert, frontend/kernel separation。

### 可以后续采纳

- MCP integration。
- subagents。
- cron。
- remote execution。
- coding Build mode。
- LSP tools。
- advanced memory。
- eval trajectory export for training。
- multi-channel gateway。

### 不采纳

- 默认 bypass permission。
- 把所有工具一次性暴露给模型。
- 把 Wiki/RAG/MCP 塞进 Kernel MVP。
- 把 build/test/exec 作为普通 Obsidian 用户默认能力。
- 把 UI 状态和 Kernel 状态混在一起。
- 把旧 runtime 行为当作正确行为。

## 19. 最终做成什么

最终 FRIDAY 应该变成：

> 一个 Obsidian-native 的成熟 Knowledge Work Agent：内核可测试、工具可治理、vault 改动可审查、多轮知识工作可完成、任务状态可见、失败可恢复，未来可以安全接入 Wiki/RAG/MCP。

不是：

> 一个把聊天、工具、记忆、Wiki、文件写入、exec 全塞进一个 service 的大函数。

也不是：

> Codex/Manus/opencode/Hermes 的完整复制品。

更不是：

> 以 build/test/exec/LSP 为默认闭环的通用 Coding Agent。

FRIDAY 的差异化应该是：

- 深度 Obsidian 集成。
- Vault/project 边界安全。
- Markdown/knowledge workflow 友好。
- 用户可审查的本地 Agent。
- 插件环境内可维护。

## 20. 下一步

下一步不是立刻写完整 Kernel。

下一步应该写第一份实现计划：

**Kernel v2 Contracts + Harness Foundation Implementation Plan**

范围只包括：

- `contracts/`
- `harness/`
- `ScriptedModelDriver`
- `FakeVault`
- `FakeApprovalPort`
- 12 个 scenario 的测试骨架。

等 contract 和 Harness 稳定后，再实现真正的 `AgentKernel` 循环。
