# FRIDAY Agent Kernel 成熟化计划（中文版）

> **已被新版规划取代：** `docs/plans/2026-04-30-agent-harness-product-maturity.zh.md` 与 `docs/plans/2026-04-30-agent-harness-product-maturity.md`。
> 本文件仍可作为底层 Kernel 实现参考，但最新执行顺序是 Harness 先行，再做 ToolRegistry/Policy/EventLog/Mutation Review，最后做产品级任务生命周期。AI 读取计划时应优先读取新版 Harness/Product maturity 文档，避免拿到过时顺序。

> 这份是给项目负责人和产品决策使用的中文可读版。英文版 `2026-04-30-agent-kernel-maturity.md` 是更细的工程执行清单。

## 目标

在继续增加 Wiki、RAG、MCP、后台自动化、多 Agent 等复杂功能之前，先把 FRIDAY 的 Agent 核心做成熟。

这里的“成熟”不是功能更多，而是：

- Agent 收到输入后，能稳定决定下一步。
- 工具调用有统一定义，不会出现提示词、manifest、native tools 三套口径不一致。
- 每一次模型回复、工具调用、权限判断、文件改动都能追踪和复盘。
- 写文件、删文件、执行命令这些高风险动作默认可审查。
- 上下文不会靠字符串粗暴裁剪，而是有预算、有压缩、有边界清理。
- 测试能覆盖真实 Agent 回合，而不只是检查源码里有没有某个字符串。

## 当前判断

FRIDAY 现在已经不是简单聊天插件，它有 `InvocationResolver`、`ExecutionPlanner`、`ExecutionOrchestrator`、`AgentRuntimeService`、权限审批、工具执行、trace、记忆和技能上下文。

所以它的方向是合理的，已经具备 Agent runtime 的雏形。

但如果对标 Codex、Manus、obsidian-yolo 这类成熟 Agent 框架，当前的问题是“框架骨架有了，但运行时可靠性还不够”。最主要的短板不在功能数量，而在执行内核：

- 工具定义分散，容易漂移。
- 回合执行不是完整可恢复的事件流。
- 文件修改路径还是偏“直接执行”，缺少 plan-review-apply。
- 权限控制有基础，但能力模型还不够硬。
- 上下文管理偏字符裁剪，不是 token-aware。
- 测试偏静态回归，缺少 fake model 驱动的端到端 Agent 测试。

## 战略原则

接下来一段时间不要继续堆外挂功能。

暂停扩张：

- 不上复杂 Wiki 编译链路。
- 不上 RAG。
- 不上 MCP marketplace。
- 不上后台 cron / background agent。
- 不上多 Agent 协同。
- 不扩大高风险工具面。

优先做 Agent Kernel：

1. 工具协议稳定。
2. 回合可追踪、可复盘、可恢复。
3. 写入动作可审查。
4. 权限边界清楚。
5. 上下文预算可控。
6. 测试能模拟真实 Agent 行为。

obsidian-yolo 可以作为参考，但不要照搬它的功能规模。现在最值得借鉴的是它的几个基础设施概念：

- Tool Gateway：工具入口统一。
- Local file tools：本地文件工具边界明确。
- Apply review：文件改动先生成计划，再由用户确认应用。
- Context compaction：上下文自动压缩。
- Tool boundary filtering：工具调用消息边界清理。

## 里程碑 0：冻结外挂功能面

先写一份成熟度门禁文档，明确在 Agent Kernel 达标前，不继续加复杂 Agent 外挂。

要做的事：

- 新增 `docs/plans/agent-kernel-maturity-gates.md`。
- 在 `CHANGELOG.md` 里记录这次工程方向调整。

门禁标准：

- 工具有单一注册源。
- runtime turn 是可回放事件流。
- 文件写入默认经过 plan-review-apply。
- exec 有 allowlist 和明确风险等级。
- 上下文管理 token-aware。
- 有 fake model 端到端测试。

## 里程碑 1：统一工具注册表

现在工具定义分散在多个地方：

- `ToolManifestCatalog`
- `AgentRuntimeService.buildNativeToolDefinitions`
- `PromptContextEngine` 的提示词工具 schema
- `runToolByName` 的实际 dispatch

这会造成一个成熟 Agent 框架最忌讳的问题：模型看到的工具、native API 暴露的工具、实际能执行的工具不一致。

要做的事：

- 新增 `src/core/tools/ToolRegistry.ts`。
- 每个工具只在 registry 里定义一次。
- 从 registry 派生：
  - prompt JSON schema
  - native tool definitions
  - manifest catalog
  - tool handler dispatch
  - capability metadata

验收标准：

- 不再手写多套工具 schema。
- `compile_wiki` 这类 gated tool 不会因为漏同步而出现在某个入口、消失在另一个入口。
- 测试能检查所有工具定义的一致性。

## 里程碑 2：持久化 Turn Event Log

成熟 Agent 不能只靠内存里的循环状态。每一轮应该有事件日志。

要记录：

- `turn_started`
- `model_requested`
- `model_completed`
- `tool_requested`
- `tool_approved`
- `tool_completed`
- `tool_failed`
- `assistant_final`
- `turn_failed`

要做的事：

- 新增 `src/core/runtime/TurnEventLog.ts`。
- 每次 Agent runtime 执行时，把关键事件写入项目工作区，例如 `.friday/runtime/<conversationId>/<turnId>.jsonl`。
- 现有 trace 可以保留，但要和 event log 分工明确：
  - trace 给 UI 和调试看。
  - event log 给恢复、审计和测试看。

验收标准：

- 任意一次 Agent 回合结束后，都能从 jsonl 里看出模型说了什么、调用了什么工具、工具结果是什么、最后输出是什么。
- 模型或工具失败时，也有明确失败事件。

## 里程碑 3：Plan-Review-Apply 文件修改模式

现在的写文件工具已经有权限审批和快照，但成熟度还不够。

理想行为：

1. Agent 先生成文件修改计划。
2. 用户或系统策略确认。
3. 再统一 apply。

这和 Codex、obsidian-yolo 的方向一致：高风险 mutation 不应该默认直接落盘。

要做的事：

- 新增 `src/core/mutations/MutationPlan.ts`。
- `write`、`edit`、`delete` 默认生成 pending mutation plan。
- UI 里提供 Apply / Reject。
- settings 增加 `fileMutationMode`：
  - `review`
  - `autoApproved`

验收标准：

- 默认模式下，Agent 不能直接改文件。
- 用户可以看见将要修改哪些路径、修改摘要、风险等级。
- 选择 Apply 后才真正调用 `AgentActionService`。

## 里程碑 4：能力策略和 exec 加固

当前有 `ExecutionGate`、`ToolApprovalService`、`WorkspaceAccessService`，这是好的基础。

但成熟 Agent 需要更明确的 capability policy。

要做的事：

- 新增 `src/core/policy/CapabilityPolicy.ts`。
- 每个工具标注：
  - 风险等级：read / write / delete / exec / external
  - 是否需要用户确认
  - 是否允许自动批准
  - 是否允许在当前项目运行
- `exec` 改成 allowlist，而不是主要依赖 blocklist。

建议第一批允许的命令：

- `npm test`
- `npm run build`
- `npm run dev`
- `git status`
- `git diff`
- `rg`

验收标准：

- 未列入 allowlist 的命令默认拒绝或要求强确认。
- `cwd` 必须限制在 workspace 内。
- event log 记录 exec 命令、cwd、退出码和摘要。

## 里程碑 5：Token-aware 上下文和工具边界清理

当前 `ContextAssembler` 主要按字符长度裁剪。这个方式简单，但不够可靠。

成熟 Agent 需要知道 token 预算，并且要清理历史中的工具调用边界。

要做的事：

- 新增 `src/core/context/TokenBudget.ts`。
- 替换字符比例裁剪，按 token 预算组织上下文。
- 新增 `src/core/context/ToolBoundaryFilter.ts`。
- 避免历史里出现孤立 tool result、缺失 tool call、重复 tool result 等脏边界。

验收标准：

- 大上下文不会简单截断到语义破碎。
- 工具结果过大时会摘要或压缩。
- 发给模型的消息序列始终合法。

## 里程碑 6：Fake Model 端到端测试

现在测试不少，但很多是源码正则回归测试。这类测试能防止误删关键字，但不能证明 Agent 真的能稳定跑完一轮。

要做的事：

- 新增 fake model adapter。
- 用脚本化模型响应模拟：
  - 先读文件再回答。
  - 先 grep 再读文件。
  - 请求写文件但进入 review plan。
  - 工具失败后恢复。
  - 达到工具迭代上限后安全退出。

验收标准：

- 测试能驱动 `AgentRuntimeService.runTurn()` 跑完整回合。
- 能断言最终输出、工具调用顺序、event log、pending mutation plan。

## 里程碑 7：产品门禁清理

最后回到产品层面，把 Wiki 和其他复杂外挂继续保持 gated。

要做的事：

- 保持 `WIKI_FEATURE_ENABLED=false`，直到 Kernel 门禁通过。
- UI 上不要暗示 Wiki 已经是成熟能力。
- 文档里明确：Wiki/RAG/MCP 是下一阶段，不是当前阶段。

验收标准：

- 用户不会误以为 Wiki 功能已可用。
- Agent prompt 里不会暴露还没成熟的工具能力。
- 新功能只能在 Kernel 成熟后再打开。

## 推荐执行顺序

第一优先级：

1. 冻结外挂功能面。
2. 统一工具注册表。
3. 建立 Turn Event Log。

第二优先级：

4. Plan-Review-Apply。
5. Capability Policy。
6. Exec allowlist。

第三优先级：

7. Token-aware context。
8. Tool boundary filter。
9. Fake model E2E。

最后：

10. 检查 Wiki/RAG/MCP 是否可以重新进入路线图。

## 成熟度完成标准

这轮计划完成后，FRIDAY 应该达到下面状态：

- Agent 工具定义只有一个来源。
- 每轮 Agent 执行都有持久化事件日志。
- 文件修改默认可审查。
- 高风险命令默认不可自动执行。
- 上下文不会靠粗暴字符串裁剪维持。
- 工具调用边界不会污染模型历史。
- 测试可以模拟真实 Agent 输入到输出。
- Wiki、RAG、MCP 等外挂能力继续 gated，不干扰核心成熟化。

## 一句话结论

FRIDAY 现在最该做的不是“更聪明”，而是“更可信”。

先把 Agent Kernel 做成一个稳定、可审计、可恢复、可测试的执行系统，再去接 Wiki、RAG、MCP 和后台自动化，技术债会少很多，后续扩展也会更稳。
