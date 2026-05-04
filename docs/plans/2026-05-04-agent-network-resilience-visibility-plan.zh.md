# Agent Network Resilience Visibility 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把模型/网络不稳定变成一等 trajectory 事件，让 FRIDAY 可以显示类似 Codex 的重连中、重试中状态，但不假装已经具备 checkpoint 续跑能力。

**Architecture:** 保留当前 `AIService` 和 `LlmTransportPolicy` 的 retry 策略，只新增 transport telemetry，让它流经 model driver、runtime progress、turn replay 和 `AgentTrajectorySnapshot`。Batch M.1 只做可观测性和 UI 事实链路，不改变 retry 语义、checkpoint 语义、工具执行语义或任务恢复语义。

**Tech Stack:** TypeScript, `AIService`, `LlmTransportPolicy`, Kernel v2 model driver ports, legacy runtime progress bridge, `TurnStateMachine`, `TurnEventLog`, `TurnReplayReader`, `AgentTrajectoryProjector`, Node test runner.

---

## 对照文档

英文版必须同步维护：`docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md`

如果实施中修改范围、契约、文件路径、测试要求或验收标准，必须同步更新英文版。

## 路线位置

Batch M.1 在 Batch L 之前完成。

```text
Batch K：trajectory projection 已存在
-> Batch M.1：transport retry/reconnect 事实进入 trajectory
-> Batch L：重做过程 UI，渲染这些事实
-> Batch M.2：checkpointed resume 改变恢复语义
```

M.1 的存在原因是：目标使用环境里网络不稳定不是边缘情况。企业网关、内网代理、VPN 都可能导致模型调用出现 429/502/503/504、timeout、connection reset 或 temporarily unavailable。用户需要看到 FRIDAY 正在重连，而不是误以为 Agent 卡死。

## 当前现实

已有能力：

- `src/core/llm/LlmTransportPolicy.ts` 能识别 retryable LLM failure，并计算 retry delay。
- `src/services/AIService.ts` 已在 `chat`、`chatStream`、`chatWithTools`、连接检查中做内部重试。
- `src/core/agent-kernel/AgentLoopController.ts` 已阻止 retryable native transport failure 悄悄 fallback 到 prompt mode。
- `src/core/agent-kernel/AgentFailureClassifier.ts` 和 `ToolGovernor` 已能识别 transport instability。
- `AgentResumeController.retryTask()` 可以从记录的原始输入重新跑任务。

缺口：

- retry attempt 没有作为 runtime progress event 发出来。
- replay event 没有结构化记录 retry attempt、retry delay、endpoint switch 或最终 transport exhausted failure。
- `AgentTrajectorySnapshot` 没有 `transport` item kind，也没有 transport failure class。
- Daily Board 无法准确显示“正在重连”。
- retry 耗尽后的任务重试仍然是从原始输入重跑，不是 checkpoint 续跑。M.1 必须如实表达这一点。

## 范围

本批范围：

- 新增小型 transport telemetry contract。
- 从 `AIService` 请求循环发出 telemetry。
- 通过 `AIServiceModelDriverAdapter` 和 Kernel v2 `ModelDriverPort` 转发 telemetry。
- legacy `AgentRuntimeService` 仍存在期间，也要转发 telemetry。
- 新增 `model_retry` 或等价 runtime progress phase。
- 让 step trace 支持 retry/reconnect events。
- 让 turn event log 支持 model retry scheduled/exhausted events。
- 把 live 和 replay transport events 投影进 `AgentTrajectorySnapshot`。
- 在 trajectory 中把 transport instability 标记为 retryable/recoverable。
- 增加测试证明 retry events 可见，但不改变 resume 行为。

非目标：

- 不实现 checkpointed resume。
- 不从 loop 中间自动继续 failed task。
- 不持久化 model message checkpoints。
- 除非测试证明当前漏掉明显的网关错误码，否则不新增 retry policy。
- 不新增 Wiki/RAG/MCP/Build/background/multi-agent。
- 不在本批重做 UI；Batch L 消费本批产出的 trajectory 事实。

## 目标事件模型

建议新增：

- Create: `src/core/llm/LlmTransportTelemetry.ts`

建议契约：

```ts
export type LlmTransportEventType =
	| "request_started"
	| "retry_scheduled"
	| "retry_started"
	| "request_succeeded"
	| "request_failed"
	| "request_exhausted";

export interface LlmTransportEvent {
	type: LlmTransportEventType;
	requestId: string;
	channel: "chat" | "chat_stream" | "chat_with_tools" | "connection_check";
	endpointIndex: number;
	endpointCount: number;
	attempt: number;
	maxAttempts: number;
	delayMs?: number;
	httpStatus?: number;
	retryable: boolean;
	message: string;
}

export interface LlmTransportObserver {
	onTransportEvent?: (event: LlmTransportEvent) => void;
}
```

不能发出原始 endpoint URL。如果需要 endpoint 身份，只发 `endpointIndex`、`endpointCount` 或脱敏后的 origin label。

扩展 runtime progress：

```ts
phase: "model_retry"
```

建议增加可选字段：

```ts
transport?: {
	type: LlmTransportEventType;
	requestId: string;
	attempt: number;
	maxAttempts: number;
	delayMs?: number;
	httpStatus?: number;
	retryable: boolean;
	channel: string;
};
```

如果现有 `RuntimeProgressEvent` 更适合保持扁平字段，也可以加扁平字段。但只要现有序列化和测试能支持，优先使用嵌套对象。

## 实施任务

### Task M1.0: Preflight

**Files:**

- Read: `src/core/llm/LlmTransportPolicy.ts`
- Read: `src/services/AIService.ts`
- Read: `src/services/AIServiceModelDriverAdapter.ts`
- Read: `src/core/agent-kernel/ModelDriverPort.ts`
- Read: `src/core/agent-kernel/AgentLoopController.ts`
- Read: `src/services/AgentRuntimeService.ts`
- Read: `src/core/turn-state/TurnStateMachine.ts`
- Read: `src/core/orchestrator/TurnOrchestrator.ts`
- Read: `src/core/runtime/TurnEventLog.ts`
- Read: `src/core/runtime/TurnReplayReader.ts`
- Read: `src/core/trajectory/AgentTrajectory.ts`
- Read: `src/core/trajectory/AgentTrajectoryProjector.ts`

**Step 1: 确认工作树干净**

```powershell
git status --short --branch
```

Expected: 没有无关 dirty files。

**Step 2: 运行现有 transport / trajectory gates**

```powershell
node --test tests/ai-service-retry-regression.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: all pass.

### Task M1.1: 新增 transport telemetry contract 和测试

**Files:**

- Create: `src/core/llm/LlmTransportTelemetry.ts`
- Create: `tests/llm-transport-telemetry.test.mjs`

**Step 1: 写失败测试**

覆盖：

- request event 不包含原始 endpoint URL。
- retry scheduled event 包含 `attempt`、`maxAttempts`、`delayMs`、retryable，以及可用时的 http status。
- exhausted event 在 max attempts 后标记 `retryable: false`。
- 同一次 model request 的 request id 在多次 attempt 间保持稳定。

**Step 2: 运行失败测试**

```powershell
node --test tests/llm-transport-telemetry.test.mjs
```

Expected: FAIL because module does not exist.

**Step 3: 实现最小 contract helper**

只有在能减少重复代码时才加 helper：

```ts
export function createLlmTransportRequestId(prefix = "llm"): string;
export function summarizeTransportError(error: unknown): { httpStatus?: number; message: string };
```

**Step 4: 运行测试**

```powershell
node --test tests/llm-transport-telemetry.test.mjs
```

Expected: PASS.

### Task M1.2: 从 AIService retry 中发出 telemetry

**Files:**

- Modify: `src/services/AIService.ts`
- Modify: `tests/ai-service-retry-regression.test.mjs`

**Step 1: 扩展 options**

扩展内部 options：

```ts
interface ChatOptions extends LlmTransportObserver {
	temperature?: number;
	maxTokens?: number;
	modelOverride?: string;
	signal?: AbortSignal;
}
```

应用到：

- `chat`
- `chatStream`
- `chatWithTools`
- `checkConnection`，如果不会明显扩大 public 行为

**Step 2: 发出事件但不改变 retry 行为**

每个 request loop：

- 第一次 attempt 前发 `request_started`。
- `shouldRetryLlmRequest(...)` 为 true 时，在 delay 前发 `retry_scheduled`。
- 下一次 attempt 开始时发 `retry_started`。
- 成功时发 `request_succeeded`。
- 不可重试失败时发 `request_failed`。
- retryable failure 达到 max attempts 时发 `request_exhausted`。

不要改变：

- `AIService.MAX_RETRY_ATTEMPTS`
- retry delay calculation
- endpoint fallback rules
- stream fallback behavior

**Step 3: 增加测试**

覆盖：

- `chatWithTools` 在 504 后 retry 前发 retry scheduled。
- `chat` 达到最大 retry 次数后发 exhausted event。
- 成功 retry 后发 request succeeded。
- event 不泄露 Authorization/API key/endpoint。

**Step 4: 运行测试**

```powershell
node --test tests/ai-service-retry-regression.test.mjs tests/llm-transport-telemetry.test.mjs
```

Expected: PASS.

### Task M1.3: 通过 Kernel model driver 转发 telemetry

**Files:**

- Modify: `src/core/agent-kernel/ModelDriverPort.ts`
- Modify: `src/services/AIServiceModelDriverAdapter.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Modify: `src/core/agent-kernel/AgentLoopTypes.ts`
- Test: `tests/agent-kernel-loop.test.mjs`

**Step 1: 扩展 model request ports**

给 `ModelDriverRequest` 加：

```ts
onTransportEvent?: (event: LlmTransportEvent) => void;
```

**Step 2: Adapter 转发 callback**

`AIServiceModelDriverAdapter` 把 `onTransportEvent` 传给 `aiService.chat` 和 `aiService.chatWithTools`。

**Step 3: AgentLoopController 映射为 progress**

构造 model driver input 时传：

```ts
onTransportEvent: (event) => this.emitModelTransport(input, context, step, event)
```

`emitModelTransport()` 发出 `RuntimeProgressEvent`：

- `phase: "model_retry"`
- `depth`
- `step`
- 可读 message，例如 `Model request retrying after gateway timeout (attempt 2/4)`
- transport payload

**Step 4: 添加 Kernel 测试**

覆盖：

- model driver retry event 能到达 progress reporter。
- retryable transport failure 仍然不触发 prompt fallback。
- transport progress 本身不会把 turn 标记为 completed 或 failed。

**Step 5: 运行测试**

```powershell
node --test tests/agent-kernel-loop.test.mjs
```

Expected: PASS.

### Task M1.4: legacy runtime 仍存在期间也要转发 telemetry

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/core/turn-state/TurnStateMachine.ts`
- Modify: `src/core/orchestrator/TurnOrchestrator.ts`
- Test: `tests/agent-runtime-harness-e2e.test.mjs`
- Test: `tests/agent-runtime-transport-fallback-regression.test.mjs`

**Step 1: 扩展 RuntimeProgressEvent**

在 legacy exported type 和 Kernel contract type 中加入 `"model_retry"`。

**Step 2: 扩展 TurnStateMachine**

加入：

```ts
| "STEP_MODEL_RETRY"
```

**Step 3: 扩展 TurnOrchestrator mapping**

映射：

```ts
model_retry: "STEP_MODEL_RETRY"
```

**Step 4: legacy prompt/native 调用传入 AIService telemetry**

在 `AgentRuntimeService` 调用：

- `aiService.chat`
- `aiService.chatWithTools`

时传 callback，并调用 `reportProgress(input, ...)`。

**Step 5: 添加测试**

覆盖：

- retryable 504 在最终失败或成功前发出 `model_retry` progress。
- progress sequence 仍然有效。
- retryable transport failure 不 prompt fallback。

**Step 6: 运行测试**

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs
```

Expected: PASS.

### Task M1.5: 持久化并 replay transport events

**Files:**

- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: 当前 runtime event persistence owner，可能是 `src/services/AgentRuntimeService.ts` 或 Kernel lifecycle adapter。
- Test: `tests/turn-replay-reader.test.mjs` 如果存在；否则 Create: `tests/turn-replay-transport-events.test.mjs`

**Step 1: 增加 replay event types**

加入：

```ts
| "model_retry_scheduled"
| "model_retry_started"
| "model_retry_exhausted"
```

如果实现选择单一事件：

```ts
| "model_retry"
```

payload 必须包含 transport type。

**Step 2: 更新 replay summary**

给 `TurnReplaySummary` 加：

```ts
transport: {
	retries: number;
	exhausted: number;
	lastStatus?: number;
	lastMessage: string;
};
transportTimeline: Array<{
	type: "retry_scheduled" | "retry_started" | "request_exhausted";
	step: number;
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	httpStatus?: number;
	message: string;
}>;
```

**Step 3: 添加测试**

覆盖：

- summary 能统计 retries。
- replay order 仍然有效。
- terminal event 之后不允许出现 transport event。
- payload 会被 sanitize/truncate。

**Step 4: 运行测试**

```powershell
node --test tests/turn-replay-transport-events.test.mjs tests/agent-replay-reader.test.mjs
```

如果 `tests/agent-replay-reader.test.mjs` 不存在，运行仓库中已有 replay tests。

### Task M1.6: 把 transport events 投影进 trajectory

**Files:**

- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/agent-trajectory-projector.test.mjs`

**Step 1: 扩展 trajectory types**

新增 item kind：

```ts
| "transport"
```

必要时扩展 failure class：

```ts
| "model_transport"
```

不要替换现有 `model` item；transport 是同级 item，用来解释 reconnecting/retry 行为。

**Step 2: 投影 live progress**

对 `phase: "model_retry"`：

- retry 中保持 snapshot status 为 `running`。
- headline 设为 `Reconnecting to model` 或等价文案。
- summary 显示 attempt/backoff 信息。
- 在 reasoning stage 中新增或更新 transport item。
- retry scheduled/started 状态为 `running`。
- 如果 exhausted 在 error 前作为 progress 表示，则标记 failed/retryable。

**Step 3: 投影 replay summary**

对 transport timeline：

- 增加 transport items。
- 保留 retry attempt counts。
- 如果 transport exhausted 导致 terminal failure，则 failure class 为 `model_transport`，`retryable: true`，`recoverable: true`。

**Step 4: 添加测试**

覆盖：

- live retry progress 投影成 running transport item。
- exhausted replay 投影成 retryable transport failure。
- status priority 仍然让 waiting states 高于 transport states。
- 现有 mutation conflict/apply_failed tests 仍通过。

**Step 5: 运行测试**

```powershell
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: PASS.

### Task M1.7: Boundary and regression checks

**Files:**

- Modify tests only if needed.

**Step 1: 静态边界检查**

```powershell
Get-ChildItem -Path 'src\core\trajectory','src\views' -Recurse -File -Include *.ts |
  Select-String -Pattern 'AIService|requestUrl|fetch\\(|AgentRuntimeService'
```

Expected:

- trajectory/view code 不直接调用 AIService 或 fetch。
- view code 仍只消费 trajectory snapshots。

**Step 2: focused suite**

```powershell
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: PASS.

**Step 3: full verification**

```powershell
npm run lint
npm test
git diff --check
git status --short --branch
```

Expected:

- lint passes.
- full test suite passes.
- no whitespace errors.
- no unrelated release artifacts remain dirty.

## 验收标准

Batch M.1 只有在以下条件全部满足时才完成：

- `AIService` 对 retry scheduling、retry start、success、failure、exhaustion 发出结构化 transport telemetry。
- Telemetry 不泄露原始 endpoint URL、API key、Authorization header 或完整 request body。
- Kernel model driver path 把 telemetry 转为 runtime progress。
- legacy runtime path 仍存在期间也转发 telemetry。
- `RuntimeProgressEvent` 支持 model retry/reconnect state。
- `TurnStateMachine` 和 `TurnOrchestrator` 能记录 model retry progress。
- `TurnEventLog` 和 `TurnReplayReader` 能持久化并总结 transport retry events。
- `AgentTrajectoryProjector` 能把 live/replay transport facts 变成 trajectory transport items。
- retryable transport exhaustion 被标记为 recoverable/retryable，但不做 checkpoint resume。
- 现有“retryable transport 不 prompt fallback”的行为保持。
- 不混入 UI redesign、checkpoint store 或 resume semantic change。

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Retry 静默发生 | UI 无法显示 reconnecting | AIService telemetry test |
| Telemetry 泄露 endpoint/API key | 隐私和安全问题 | redaction/no-url test |
| Kernel 能看到 retry 但 legacy 看不到 | 当前 wired path 仍然盲区 | legacy runtime test |
| Retry progress 过早把 turn 标记 failed | live state 混乱 | trajectory live test |
| Exhausted retry 不可恢复 | 用户看到死胡同失败 | trajectory failure test |
| gateway timeout 后 prompt fallback | 重复模型成本和不稳定行为 | transport fallback regression |
| M.1 开始实现 checkpoints | 批次过大且语义风险高 | static/diff review |

## 开发提示词

给新窗口执行：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中开发。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。

目标：实现 Batch M.1: Agent Network Resilience Visibility。

先阅读：
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

范围：
- 从 AIService 把 transport retry/reconnect telemetry 接入 runtime progress、replay 和 AgentTrajectorySnapshot。
- 不实现 checkpointed resume。
- 不改变 retry 次数/backoff 语义，除非测试证明漏掉明显的 retryable case。
- 不重做 UI。Batch L 会渲染这些新 trajectory facts。
- 不新增 Wiki/RAG/MCP/Build/background/multi-agent。

开始前运行：
git status --short --branch
node --test tests/ai-service-retry-regression.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs

按 TDD 执行。每个任务先补 focused tests，再实现。

完成后运行：
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

最后输出：
- 改了哪些文件；
- transport event contract 的准确形态；
- retry 行为是否改变；
- replay 和 trajectory 如何暴露 reconnecting；
- 测试结果；
- 剩余风险。
```

## 检查提示词

给另一个窗口只读验收：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中做只读验收。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。不要改代码，除非我明确要求修复。

目标：验收 Batch M.1: Agent Network Resilience Visibility。

验收依据：
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md

检查：
1. AIService 是否对 chat/chatStream/chatWithTools 发出结构化 transport retry/reconnect telemetry。
2. Telemetry 是否没有暴露原始 endpoint URL、API key、Authorization header 或 request body。
3. Kernel model driver path 是否把 telemetry 转为 RuntimeProgressEvent。
4. legacy AgentRuntimeService path 是否仍然转发 telemetry。
5. RuntimeProgressEvent、TurnStateMachine、TurnOrchestrator 是否支持 model retry/reconnect progress。
6. TurnEventLog/TurnReplayReader 是否持久化并总结 transport retry events。
7. AgentTrajectoryProjector 是否把 live/replay transport events 投影成 trajectory items。
8. retryable transport exhaustion 是否 recoverable/retryable，但没有声称 checkpoint resume。
9. 现有 retryable transport 不 prompt fallback 的行为是否保持。
10. 是否没有混入 UI redesign、checkpoint store、Wiki/RAG/MCP/Build/background/multi-agent。

运行：
git status --short --branch
Get-ChildItem -Path 'src' -Recurse -File -Include *.ts | Select-String -Pattern 'model_retry|transport|retry_scheduled|request_exhausted'
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
npm run lint
npm test
git diff --check

输出格式：
Verdict: PASS / PASS_WITH_CONCERNS / FAIL
Branch / HEAD:
Worktree:
Evidence:
Transport contract:
Replay / trajectory:
Test results:
P0 issues:
P1 issues:
P2 issues:
Conclusion:
```
