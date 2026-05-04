# Agent Checkpointed Resume 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加安全的 checkpointed resume，让 retryable 模型/网络失败可以从最后一个稳定 Agent loop 边界继续，而不是总是从原始用户 prompt 重跑。

**Architecture:** 新增 Kernel-owned checkpoint contract 和 persistence port，在 context 构建完成、tool result 完成后记录稳定 loop checkpoint，并让 task retry/resume 优先使用有效 checkpoint。M.2 会改变恢复语义，所以必须在 M.1 可观测性完成、过程 UI 能诚实说明“从头 retry”还是“从 checkpoint resume”之后实施。

**Tech Stack:** TypeScript, Kernel v2 loop controller, `AgentResumeController`, task store, turn event log/replay, trajectory projection, local JSON persistence, Node test runner.

---

## 对照文档

英文版必须同步维护：`docs/plans/2026-05-04-agent-checkpointed-resume-plan.md`

如果实施中修改契约、resume 安全策略、文件路径、task action 语义或验收标准，必须同步更新英文版。

## 路线位置

M.2 在 M.1 和 Batch L 之后。

```text
M.1：transport retry/reconnect facts 可见
-> L：过程 UI 能渲染 retrying/reconnecting/exhausted 状态
-> M.2：retryable failed work 可以从稳定 checkpoint 继续
```

M.2 不得混入 M.1。M.1 是可观测性，M.2 是执行语义。

## 当前现实

当前 retry 行为：

- `AgentResumeController.retryTask(taskId)` 要求 task 已进入 terminal status。
- 它从 `task.runInput` 重建新的 `AgentRuntimeFacadeInput`。
- `task.runInput` 只包含原始 prompt、model、depth、file、tool limits 等。
- 它不会恢复 model messages、completed tool results、loop cursor 或 mutation state。

所以今天的 retry 是 clean rerun，不是 continuation。

M.2 只在安全时改变这个行为：

- 如果存在有效 checkpoint，从 checkpoint resume。
- 如果没有有效 checkpoint，保持现有从原始输入 retry 的行为。
- 如果 checkpoint 安全性不确定，拒绝 checkpoint resume 并解释原因。

## 产品原则

UI 和 runtime 必须使用准确语言：

- “Retry” 表示从原始输入重跑。
- “Resume” 表示从已保存 checkpoint 继续。
- “Reconnecting” 表示当前 model request 正在重试，不代表 checkpoint resume 已经发生。

除非该任务确实具备 checkpoint resume，否则不要声称“不会从头开始”。

## 范围

本批范围：

- 新增 checkpoint contract 和本地 store。
- 在 Kernel v2 loop execution 中记录稳定 checkpoints。
- 把 checkpoint lifecycle events 加入 replay。
- 扩展 task state/actions，让 failed retryable task 在 checkpoint 有效时暴露 checkpoint resume。
- 让 `AgentResumeController` 对 retryable model/transport failures 优先使用 checkpoint resume。
- 保证从 checkpoint resume 时不会重复执行已完成 tool calls。
- 增加测试证明 checkpoint resume 能避免重复 tool execution。
- 为 stale/unsafe checkpoints 增加 guardrails。

非目标：

- 不 resume 任意 in-flight tool call。
- 不在 file mutation apply 中途 resume。
- 不新增 background agents、multi-agent orchestration、Wiki/RAG/MCP 或 Build capability。
- 不做 checkpoint cloud sync。
- 不做跨设备 resume。
- 不改变 M.1 的模型 retry 次数/backoff。
- 不把 API keys、Authorization headers、cookies 或 request headers 写入 checkpoint。

## 稳定 Resume 边界

M.2 v1 只支持以下安全边界：

1. `context_ready`
   - Context package 已构建。
   - 尚无 model request 完成。
   - Resume 可以请求第一次 model decision，避免重建无关 context。

2. `after_tool_result`
   - Tool call 已完成，且 model-facing result 已追加到 `modelMessages`。
   - Resume 可以请求下一次 model decision，不重新执行已完成 tool。

3. `after_model_response_without_tool`
   - 已产出 final response 或 pending mutation plan。
   - 通常不需要 resume；主要用于 replay diagnostics。

不要自动 resume：

- `during_model_request`
- `after_model_response_before_tool_execution`
- `during_tool_execution`
- `during_mutation_apply`
- `waiting_for_approval`
- `waiting_for_user`

这些状态可以为诊断记录 checkpoint，但不能用于自动 continuation。

## Checkpoint Contract

新增：

- `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- `src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts`

建议契约：

```ts
export type AgentLoopCheckpointBoundary =
	| "context_ready"
	| "after_tool_result"
	| "after_model_response_without_tool";

export interface AgentLoopCheckpoint {
	schemaVersion: 1;
	id: string;
	turnId: string;
	taskId?: string;
	traceId?: string;
	conversationId: string;
	agentId: string;
	boundary: AgentLoopCheckpointBoundary;
	channel: "prompt" | "native";
	step: number;
	nextStep: number;
	createdAt: string;
	modelOverride?: string;
	mode: string;
	allowedTools?: string[];
	modelMessages: AgentCheckpointMessage[];
	traces: RuntimeToolTrace[];
	pendingMutations: RuntimeMutationPlan[];
	completedToolCalls: AgentCheckpointToolResultRef[];
	lastEventSequence?: number;
	safety: {
		canAutoResume: boolean;
		reason: string;
	};
	privacy: {
		redacted: boolean;
		localOnly: true;
	};
}
```

`modelMessages` 必须 local-only，并对明显 secrets 做 sanitize。不要存 headers、API keys、cookies 或 endpoint URLs。由于 checkpoint resume 需要重建模型上下文，不要过度截断 model-facing tool results，除非现有 runtime token limits 已经要求截断。

建议 port：

```ts
export interface AgentLoopCheckpointStorePort {
	save(checkpoint: AgentLoopCheckpoint): Promise<void>;
	getLatestForTask(taskId: string): Promise<AgentLoopCheckpoint | null>;
	getLatestForTurn(turnId: string): Promise<AgentLoopCheckpoint | null>;
	markConsumed(checkpointId: string, result: "resumed" | "rejected" | "expired", reason: string): Promise<void>;
}
```

## 实施任务

### Task M2.0: Preflight

**Files:**

- Read: `src/core/agent-kernel/AgentLoopController.ts`
- Read: `src/core/agent-kernel/AgentResumeController.ts`
- Read: `src/core/agent-kernel/AgentTaskManager.ts`
- Read: `src/core/tasks/AgentTask.ts`
- Read: `src/core/tasks/AgentTaskStore.ts`
- Read: `src/core/runtime/TurnEventLog.ts`
- Read: `src/core/runtime/TurnReplayReader.ts`
- Read: `src/core/trajectory/AgentTrajectory.ts`
- Read: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Read: `src/services/ObsidianKernelRuntimePorts.ts`
- Read: M.1 和 L plan docs。

**Step 1: 确认前置批次**

```powershell
git status --short --branch
node --test tests/llm-transport-telemetry.test.mjs tests/agent-process-panel-view-model.test.mjs
```

Expected: M.1 和 L tests 存在且通过。如果不存在，停止并确认是否不应开始 M.2。

**Step 2: 运行当前 resume gates**

```powershell
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: all pass.

### Task M2.1: 新增 checkpoint contract 和 store tests

**Files:**

- Create: `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- Create: `src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts`
- Create: `tests/agent-loop-checkpoint-store.test.mjs`

**Step 1: 写失败测试**

覆盖：

- save 并按 task id 读取 latest checkpoint。
- save 并按 turn id 读取 latest checkpoint。
- mark checkpoint consumed/rejected/expired。
- expiry policy 判定 stale 时不返回有效 checkpoint。
- sanitizer 移除 bearer tokens、`sk-*`、cookie-like values、authorization fields。

**Step 2: 运行失败测试**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs
```

Expected: FAIL because modules do not exist.

**Step 3: 实现本地 JSON/JSONL store**

沿用仓库现有持久化风格。保持 local-only，不引入数据库。

**Step 4: 运行测试**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs
```

Expected: PASS.

### Task M2.2: 给 Kernel loop 增加 checkpoint port

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopTypes.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `tests/agent-kernel-loop.test.mjs`

**Step 1: 新增 checkpoint lifecycle port**

建议：

```ts
export interface AgentLoopCheckpointPort {
	save(checkpoint: AgentLoopCheckpoint): Promise<void>;
	getResumeCheckpoint?(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentLoopCheckpoint | null>;
}
```

**Step 2: 给 input metadata 增加 resume 信息**

支持：

```ts
input.metadata?.resumeFromCheckpointId
```

或代码库更偏好的 typed field：

```ts
resumeFromCheckpointId?: string;
```

不要把 `retryOfTaskId` 重载成 checkpoint resume。

**Step 3: 添加测试**

覆盖：

- loop 在第一次 model request 前保存 `context_ready` checkpoint。
- loop 在 tool result 追加到 model messages 后保存 `after_tool_result` checkpoint。
- checkpoint save failure 不导致用户 turn 失败。
- checkpoint 内容不包含 request headers 或 endpoint URL。

**Step 4: 运行测试**

```powershell
node --test tests/agent-kernel-loop.test.mjs tests/agent-loop-checkpoint-store.test.mjs
```

Expected: PASS.

### Task M2.3: 从 checkpoint 恢复 loop

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `tests/agent-kernel-loop.test.mjs`
- Create: `tests/agent-kernel-checkpoint-resume.test.mjs`

**Step 1: 写失败 resume 测试**

场景：

1. Step 1 请求模型。
2. 模型请求一个 read-only tool。
3. Tool 成功。
4. 保存 `after_tool_result` checkpoint。
5. 下一次 model request 因 retryable transport exhaustion 失败。
6. `resumeFromCheckpointId` 重新进入 loop。
7. 已完成 tool 不再执行。
8. 下一次 model request 使用恢复的 `modelMessages`。

**Step 2: 实现 resume entry**

当传入有效 checkpoint：

- 如果 checkpoint 包含可恢复 `modelMessages`，跳过 context build。
- 恢复 `traces`。
- 从 `checkpoint.nextStep` 开始。
- 继续使用原 channel：`prompt` 或 `native`，除非设置已经明确不允许。
- 发出 progress event 表示 checkpoint resume。

**Step 3: 添加 unsafe boundary tests**

覆盖：

- `canAutoResume: false` 的 checkpoint 被拒绝。
- `during_tool_execution` checkpoint 被拒绝。
- incompatible schema version 被拒绝。

**Step 4: 运行测试**

```powershell
node --test tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: PASS.

### Task M2.4: 接入 AgentResumeController 和 task actions

**Files:**

- Modify: `src/core/agent-kernel/AgentResumeController.ts`
- Modify: `src/core/agent-kernel/AgentTaskManager.ts`
- Modify: `src/core/tasks/AgentTask.ts`
- Modify: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/agent-task-lifecycle.test.mjs`
- Test: `tests/agent-kernel-checkpoint-resume.test.mjs`

**Step 1: 扩展 task metadata**

给 task 增加 checkpoint metadata，但不替代原始 `runInput`：

```ts
checkpoint?: {
	latestId: string;
	boundary: string;
	canResume: boolean;
	reason: string;
	updatedAt: string;
}
```

**Step 2: Resume controller 优先使用 checkpoint**

对 failed terminal tasks：

- 如果有效 checkpoint 存在，且 failure retryable/recoverable，构建带 `resumeFromCheckpointId` 的 input。
- 否则使用当前 retry-from-original 行为。

返回 metadata，告诉 UI/result 这次是 checkpoint resume 还是 original retry。

**Step 3: 增加 trajectory action**

增加以下之一：

- checkpoint resume 可用时增加 `resume` action，同时保留 `retry` fallback；或
- 如果 action id contract 不宜变更，则使用 `retry` action 但 label 为 `Resume from checkpoint`。

只要测试能覆盖且不破坏现有 action handler，优先显式 `resume`。

**Step 4: 添加测试**

覆盖：

- failed retryable task with checkpoint exposes resume action。
- failed retryable task without checkpoint exposes retry action。
- non-retryable failure 不暴露 resume。
- 现有 approval continue 行为不变。

**Step 5: 运行测试**

```powershell
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

### Task M2.5: 增加 replay events 和 trajectory explanation

**Files:**

- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/turn-replay-checkpoint-events.test.mjs`
- Test: `tests/agent-trajectory-projector.test.mjs`

**Step 1: 增加 event types**

建议：

```ts
| "checkpoint_saved"
| "checkpoint_resume_started"
| "checkpoint_resume_rejected"
| "checkpoint_resume_completed"
```

**Step 2: 增加 replay summary fields**

```ts
checkpoints: {
	saved: number;
	resumed: number;
	rejected: number;
	latestBoundary: string;
};
checkpointTimeline: Array<{
	event: "saved" | "resume_started" | "resume_rejected" | "resume_completed";
	checkpointId: string;
	boundary: string;
	reason: string;
}>;
```

**Step 3: 投影到 trajectory**

增加 checkpoint/system items，用于解释：

- stable tool result 后保存了 checkpoint。
- 从 checkpoint 开始 resume。
- checkpoint resume 被拒绝，并 fallback 为原始 input retry。

**Step 4: 添加测试**

覆盖：

- replay summary 能统计 checkpoint events。
- 使用 checkpoint 时，trajectory 显示 resume 而不是 retry。
- checkpoint rejection reason 可见且已 sanitize。

**Step 5: 运行测试**

```powershell
node --test tests/turn-replay-checkpoint-events.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

### Task M2.6: Safety and idempotency gates

**Files:**

- Modify: `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Test: `tests/agent-kernel-checkpoint-safety.test.mjs`

**Step 1: 定义 safety policy**

只有满足以下条件才允许 checkpoint resume：

- schema version supported。
- task/conversation/agent identity 匹配。
- checkpoint boundary 属于允许的 stable boundary list。
- checkpoint 未过期。
- 不存在 in-flight tool call。
- 不存在 in-flight mutation apply。
- model/tool settings 仍允许所需 channel/tool set。

**Step 2: 添加测试**

覆盖：

- stale checkpoint 被拒绝。
- tool set mismatch 被拒绝。
- pending mutation apply 被拒绝。
- in-flight tool call checkpoint 被拒绝。
- rejection 只有在安全且明确时才 fallback 到 original retry。

**Step 3: 运行测试**

```powershell
node --test tests/agent-kernel-checkpoint-safety.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs
```

Expected: PASS.

### Task M2.7: Full regression

**Files:**

- No required code changes.

**Step 1: focused suite**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

**Step 2: integration suite**

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
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
- full tests pass.
- no whitespace errors.
- no unrelated generated release artifacts remain dirty.

## 验收标准

Batch M.2 只有在以下条件全部满足时才完成：

- Kernel 在安全边界保存 stable checkpoints。
- failed retryable model/transport tasks 可以从 latest valid checkpoint resume。
- checkpoint resume 不可用或不安全时，合适情况下仍保留现有 retry-from-original-input 行为。
- checkpoint resume 不会重复执行已完成 tool calls。
- pending/in-flight tool calls 和 mutation apply operations 不会被 auto-resume。
- task/trajectory actions 能区分 resume 和 retry，或 label 明确不含糊。
- replay 记录 checkpoint saved/resume/rejected events。
- process UI 能准确解释 FRIDAY 是从 checkpoint resume，还是从原始 input rerun。
- checkpoints 不包含 API keys、Authorization headers、cookies、endpoint URLs 或 request headers。
- 现有 approval、mutation review、cancellation、transport fallback tests 继续通过。

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Resume 重复执行已完成 tool | duplicate writes 或重复 external effects | checkpoint resume no duplicate tool test |
| 从 unsafe in-flight state resume | execution state 损坏 | checkpoint safety tests |
| 声称 checkpoint resume 但实际重跑原 prompt | 产品行为误导 | resume vs retry action tests |
| Checkpoint 存储 secrets | 安全/隐私问题 | sanitizer tests |
| Checkpoint save failure 导致正常 run 失败 | 可靠性回归 | checkpoint save failure ignored test |
| settings/tool 变化后仍使用 stale checkpoint | model/tool context 无效 | stale/mismatch tests |
| mutation apply 中途 resume | 文件损坏风险 | mutation safety test |

## 开发提示词

给新窗口执行：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中开发。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。

目标：实现 Batch M.2: Agent Checkpointed Resume。

前置条件：
- Batch M.1 必须已经完成。
- Batch L 应已经完成，或至少能渲染 trajectory resume/retry facts。

先阅读：
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.zh.md
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md

范围：
- 新增 Kernel-owned checkpoint contract/store。
- 在 context_ready 和 after_tool_result 保存 stable checkpoints。
- failed retryable model/transport tasks 优先使用 valid checkpoint resume。
- 确保 resume 时不重复执行 completed tools。
- 在 task/trajectory actions 中区分 resume 和 retry。
- 不 resume in-flight tool calls 或 mutation apply。
- 不新增 Wiki/RAG/MCP/Build/background/multi-agent。

开始前运行：
git status --short --branch
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-kernel-loop.test.mjs

按 TDD 执行。每个任务先写 focused failing tests，再实现。

完成后运行：
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

最后输出：
- 改了哪些文件；
- checkpoint contract 和 persistence path；
- 准确的 safe resume boundaries；
- 证明 tools 没有重复执行；
- retry vs resume 语义；
- 测试结果；
- 剩余风险。
```

## 检查提示词

给另一个窗口只读验收：

```text
你在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 工作树中做只读验收。请先阅读 AGENTS.md，并严格遵守每回合 myskills-router 规则。不要改代码，除非我明确要求修复。

目标：验收 Batch M.2: Agent Checkpointed Resume。

验收依据：
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.zh.md
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.md

检查：
1. Kernel 是否在 context_ready 和 after_tool_result 边界保存 stable checkpoints。
2. Checkpoint store 是否 local、tested，且不保存 API keys、Authorization headers、cookies、endpoint URLs 或 request headers。
3. failed retryable model/transport tasks 是否优先 valid checkpoint resume。
4. checkpoint 缺失或不安全时，现有 retry-from-original-input 是否仍可用。
5. checkpoint resume 是否不会重复执行 completed tool calls。
6. in-flight tool calls、waiting approval/user、mutation apply 是否不会 auto-resume。
7. task/trajectory actions 是否区分 resume 和 retry，或 label 明确不含糊。
8. replay 是否记录 checkpoint saved/resume/rejected events。
9. Process UI 是否能从 trajectory facts 解释 resume vs retry。
10. 是否没有混入 Wiki/RAG/MCP/Build/background/multi-agent。

运行：
git status --short --branch
Get-ChildItem -Path 'src' -Recurse -File -Include *.ts | Select-String -Pattern 'checkpoint|resumeFromCheckpoint|checkpoint_resume'
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
npm run lint
npm test
git diff --check

输出格式：
Verdict: PASS / PASS_WITH_CONCERNS / FAIL
Branch / HEAD:
Worktree:
Evidence:
Checkpoint contract:
Resume semantics:
Safety / idempotency:
Replay / trajectory:
Test results:
P0 issues:
P1 issues:
P2 issues:
Conclusion:
```
