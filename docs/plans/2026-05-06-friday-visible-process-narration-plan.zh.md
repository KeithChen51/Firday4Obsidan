# FRIDAY Visible Process Narration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 FRIDAY 在复杂任务中先向用户说明“我收到了什么、我如何理解、我准备怎么做”，并在执行过程中用线性时间线持续汇报“刚刚做了什么、接下来做什么”。

**Architecture:** 新增一层用户可见过程叙事契约，运行时负责产生安全、简短、可 replay 的叙事事件，trajectory projector 负责把事件投影成 timeline item，前端只负责按既定模块展示。不要让前端从 `model_request`、`tool_result`、`checkpoint` 等底层机器事件里硬猜用户文案。

**Tech Stack:** TypeScript, Agent Kernel v2 contracts, RuntimeProgressEvent, TurnEventLog, TurnReplayReader, AgentTrajectorySnapshot, AgentProcessTimelineView, Obsidian DOM APIs, Node test runner.

---

## Current Baseline

本轮已先修复四个直接影响当前体验的问题：

- `src/views/DailyBoardView.ts`
  - 过程区现在使用 `timeline.defaultExpanded` 作为默认展开来源。
  - 新增手动折叠集合，避免用户折叠后又被默认展开逻辑顶开。
  - mutation apply / reject 后会重新 hydrate completed replay snapshot，让最终回答下方的产物和修改点立即刷新。
- `src/views/agentTaskPanelActions.ts`
  - apply / reject 后新增 `afterMutationReview` 回调，用于让调用方刷新 replay 数据。
- `src/views/agentProcessPanelViewModel.ts`
  - 技术细节会和上层标题、摘要、meta 去重。
  - `Context package built before native model request`、`context_ready` 等内部 checkpoint 文案不再泄漏给用户。
- `src/services/AgentRuntimeService.ts`
  - 标准模式下 `write` / `edit` 不再触发单独工具审批，而是直接进入 mutation review。
  - `delete`、`exec`、`compile_wiki` 仍保留独立审批或阻断能力。
- `src/services/ObsidianKernelRuntimePorts.ts`
  - kernel task approval tracking 不再把 `write` / `edit` 作为独立人工审批。

这些修复只解决当前缺口，不等于已经实现“用户可见过程叙事”。下面的方案定义下一步需要补齐的产品能力。

## Product Requirement

复杂任务开始后，用户应先看到一条类似 Manus 的收到反馈：

```text
收到。我理解你要把目前的工作过程展示重新整理成更清楚的时间线体验。
我会先确认现有实现，再修掉已知问题，最后把后续叙事协议写成可执行方案。
```

执行过程中，FRIDAY 应按阶段补充简短汇报：

```text
刚刚：我已经确认过程区没有使用默认展开状态。
接下来：我会改成默认展开和手动折叠分离。
```

这些内容必须满足：

- 面向用户，不是调试日志。
- 不暴露 chain-of-thought。
- 不重复最终答案。
- 不把 `Step 2`、`model_request`、`checkpoint`、`status 500` 这类原始机器词直接显示给普通用户。
- live 和 completed replay 内容一致。
- 简单问答不强行展示复杂过程。

## Event Contract

新增用户可见叙事事件，建议先落在 kernel contract，再桥接 legacy runtime。

```ts
export type AgentNarrationKind =
	| "task_acknowledged"
	| "plan_declared"
	| "stage_report";

export interface AgentNarrationPayload {
	kind: AgentNarrationKind;
	summary: string;
	understanding?: string;
	plan?: string[];
	justDone?: string;
	next?: string;
	status?: "running" | "waiting" | "done" | "blocked";
	source: "runtime" | "model" | "fallback";
	visibility: "user";
}
```

扩展 `RuntimeProgressEvent`：

```ts
phase: "narration";
narration: AgentNarrationPayload;
message: string;
```

扩展 `AgentTurnEventType`：

```ts
"narration"
```

扩展 replay log：

```ts
type TurnEventType =
	| ...
	| "narration_report";
```

映射规则：

```text
RuntimeProgressEvent.phase=narration
  -> AgentTurnEvent.type=narration
  -> TurnEventLog.type=narration_report
  -> TurnReplaySummary.narrationTimeline[]
  -> AgentTrajectoryItem.kind=narration
  -> AgentProcessTimelineItem.kind=receipt / reasoning / tool_batch / done
```

## Narration Sources

### 1. Deterministic Start Acknowledgement

运行时开始后，在构建上下文前立即产生 fallback 版本：

```text
收到。FRIDAY 已收到任务，正在结合当前项目和对话上下文处理。
```

如果可安全提取用户意图，则包含一句短理解：

```text
我理解你要处理的是：优化 FRIDAY 工作过程展示和结果区刷新。
```

不要额外调用模型来生成这条。第一版用 deterministic fallback，避免增加延迟和成本。

建议位置：

- `src/core/agent-kernel/AgentLoopController.ts`
- `src/services/ObsidianKernelRuntimePorts.ts`
- `src/services/AgentRuntimeService.ts` legacy bridge

### 2. Model Authored Tool Note

当前 prompt schema 已允许：

```json
{"type":"tool_call","assistant":"optional note","tool":{...}}
```

但现在 `assistant` 没有进入 timeline。下一步要把这段安全文本当作 `stage_report` 候选。

要求：

- 如果 `assistant` 是 `Calling tool:`、`continuing with tool calls` 这类中间占位，丢弃。
- 如果 `assistant` 简短且面向用户，记录为 `narration_report`。
- 如果文本超过 240 字，截断。
- 如果包含原始 JSON、工具参数、栈信息，丢弃或降级为 fallback。

### 3. Deterministic Stage Report

每完成一个有意义阶段后，如果模型没有提供合格叙事，系统补一条 deterministic report。

阶段触发点：

- 上下文构建完成。
- 一组 read / ls / grep / search_text 结束。
- write / edit mutation planned。
- mutation applied / rejected / conflicted。
- transport retry 开始或耗尽。
- 最终回答前。

示例：

```text
刚刚：我已经读取了相关文件和项目上下文。
接下来：我会整理判断并准备下一步操作。
```

```text
刚刚：我已经准备了 1 个文件改动。
接下来：需要你确认后再应用到工作区。
```

## Timeline Mapping

用户可见 timeline item 建议保持这些模块：

```ts
type AgentProcessTimelineItemKind =
	| "receipt"
	| "reasoning"
	| "context"
	| "tool_batch"
	| "file_change"
	| "approval"
	| "retry"
	| "blocked"
	| "done";
```

叙事事件映射：

- `task_acknowledged` -> `receipt`
- `plan_declared` -> `reasoning`
- `stage_report` with context wording -> `context`
- `stage_report` with file mutation wording -> `file_change`
- `stage_report` with waiting wording -> `approval`
- `stage_report` with retry wording -> `retry`
- terminal stage report -> `done`

同一个 step 下如果已经有工具事件，可以把 stage report 作为该 item 的 summary，而不是新增重复 item。

## Prompt Update

修改 `src/core/context/PromptContextEngine.ts` 的规则，加入可见过程叙事约束：

```text
- For complex tasks, set the tool_call.assistant field to a concise user-visible progress note before using a tool.
- The note must say what you are about to do or what you just learned.
- Do not reveal private reasoning, hidden chain-of-thought, raw tool arguments, or internal JSON.
- Keep progress notes under 120 Chinese characters or 80 English words.
- For simple direct answers, omit progress notes.
```

少量 few-shot：

```text
User: 帮我整理这个项目的介绍文档
Assistant: {"type":"tool_call","assistant":"我会先读取当前项目资料，确认现有内容和边界。","tool":{"name":"ls","args":{"path":"","recursive":false}}}
```

```text
User: 把这份文档改得更精简
Assistant: {"type":"tool_call","assistant":"我会先读取原文，再保留核心意思做精简。","tool":{"name":"read","args":{"path":"Project/workspace/doc.md"}}}
```

## Implementation Tasks

### Task 1: Add Narration Contracts

**Files:**

- Modify: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Modify: `src/core/runtime/TurnEventLog.ts`
- Test: `tests/agent-kernel-contracts.test.mjs`

**Steps:**

1. Add `AgentNarrationKind` and `AgentNarrationPayload`.
2. Add `phase: "narration"` to `RuntimeProgressEvent`.
3. Add `narration?: AgentNarrationPayload` to progress events.
4. Add `"narration"` to `AGENT_TURN_EVENT_TYPES`.
5. Add `"narration_report"` to `TurnEventType`.
6. Write failing contract tests.
7. Run `node --test tests/agent-kernel-contracts.test.mjs`.
8. Implement minimal contract changes.
9. Run the same test again.

### Task 2: Emit Start Acknowledgement

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/services/ObsidianKernelRuntimePorts.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/agent-kernel-loop-controller.test.mjs` or nearest existing kernel loop test

**Steps:**

1. Write a test that starts a complex turn and expects the first user-visible event to be `narration.kind=task_acknowledged`.
2. Verify the test fails.
3. Add `emitTaskAcknowledged(...)`.
4. Use a deterministic fallback summary.
5. Include `taskId`, `turnId`, `conversationId`, and `traceId` through existing identity flow.
6. Verify live progress receives the narration event before `model_request`.

### Task 3: Capture Model Tool Notes

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/orchestrator/RuntimeEnvelopeParser.ts` only if parsing currently drops fields
- Modify: `src/services/AgentRuntimeService.ts` legacy path
- Test: `tests/agent-loop-controller-tool-note.test.mjs` or nearest runtime scenario test

**Steps:**

1. Add a scripted model step with `tool_call.assistant`.
2. Assert replay contains `narration_report`.
3. Assert intermediate placeholders are ignored.
4. Implement sanitizer:
   - trim
   - max 240 chars
   - reject raw JSON
   - reject known placeholder phrases
5. Emit `stage_report` before the tool call is displayed.

### Task 4: Replay Reader Support

**Files:**

- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/agent-kernel/AgentReplayRecorder.ts`
- Test: `tests/turn-replay-reader.test.mjs`
- Test: `tests/agent-kernel-replay-recorder.test.mjs`

**Steps:**

1. Add `narrationTimeline` to `TurnReplaySummary`.
2. Map `AgentTurnEvent.type=narration` to `TurnEventLog.type=narration_report`.
3. Summarize timeline entries with `kind`, `summary`, `justDone`, `next`, `status`, `source`, `at`.
4. Verify terminal replay still allows post-turn mutation events.
5. Run targeted replay tests.

### Task 5: Project Narration Into Trajectory

**Files:**

- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/agent-trajectory-projector.test.mjs` or existing trajectory tests

**Steps:**

1. Add `AgentTrajectoryItem.kind="narration"` if the current union requires it.
2. Project live `phase=narration` events.
3. Project replay `narrationTimeline`.
4. Place acknowledgement before context/tool items.
5. Mark narration privacy as redacted and user-visible.
6. Assert raw reasoning is never copied.

### Task 6: Convert Narration To Timeline Items

**Files:**

- Modify: `src/views/agentProcessPanelViewModel.ts`
- Test: `tests/agent-process-panel-view-model.test.mjs`

**Steps:**

1. Update `timelineKindForStep` to classify narration items.
2. Use `task_acknowledged` as the receipt summary.
3. Use `stage_report.justDone` and `stage_report.next` as visible summary lines.
4. Avoid duplicate detail rows.
5. Keep technical details collapsed and only when they add information.
6. Keep simple direct answers hidden.

### Task 7: Renderer And Copy

**Files:**

- Modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `styles.css`
- Test: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Test: `tests/agent-process-panel-style-regression.test.mjs`

**Steps:**

1. Render acknowledgement as the first timeline item.
2. Render stage reports inline under the relevant item.
3. Keep final answer body separate from process narration.
4. Ensure wide plugin widths do not leave large blank space.
5. Verify mobile width wraps without overlap.

### Task 8: End-to-End Runtime Scenarios

**Files:**

- Modify: `tests/agent-runtime-mutation-review-e2e.test.mjs`
- Modify: `tests/helpers/scriptedModelDriver.mjs`
- Modify: `tests/helpers/fakeAgentRuntime.mjs`

**Scenarios:**

1. Complex document creation:
   - first visible process item is `task_acknowledged`
   - context read report appears
   - file mutation report appears
   - only mutation review asks for confirmation
2. Simple direct answer:
   - no expanded complex process
3. Model transport retry:
   - retry stage report hides raw HTTP detail in primary summary
4. Apply mutation:
   - artifacts and diff summary appear without switching conversation

## Acceptance Criteria

功能验收：

- 复杂任务开始后，过程区第一条是“收到任务 / 理解任务”，不是 `Runtime started`。
- 工具调用前后能看到阶段性汇报。
- 汇报包含“刚刚”和“接下来”的信息，但不冗长。
- replay 后内容和 live 内容一致。
- 写入文档时只有 mutation review 一道用户确认。
- 文件应用后，最终回答下方的产物和修改点立即出现。
- 技术细节不会重复上层信息。

安全验收：

- 不显示 chain-of-thought。
- 不显示 raw reasoning。
- 不显示完整工具参数 JSON。
- 不把隐藏 checkpoint、安全策略、内部 trace 当成用户文案。
- `delete`、`exec`、`compile_wiki` 仍可独立审批或阻断。

视觉验收：

- 展开区仍是线性时间线。
- 复杂任务运行中默认展开。
- 用户手动折叠后保持折叠。
- completed replay 默认收起，除非用户手动展开。
- 宽屏时回答和过程区自然使用可读宽度，不出现当前图 2 那种大面积空档。

## Verification Commands

```powershell
node --test tests/agent-process-panel-view-model.test.mjs
node --test tests/daily-board-agent-trajectory-ui.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
npm run build
```

如果实现完整叙事协议，还要补充：

```powershell
node --test tests/turn-replay-reader.test.mjs tests/agent-kernel-replay-recorder.test.mjs
node --test tests/agent-kernel-contracts.test.mjs
```

## Product Copy Rules

推荐中文文案：

```text
收到。我理解你要……
我会先……，再……。
刚刚：……
接下来：……
需要你确认：……
已完成：……
```

避免文案：

```text
Step 1 requesting model decision
Context package built before native model request
Tool write finished
Model transport request_succeeded
Task failed
```

## Rollout Strategy

建议分两步落地：

1. **Contract first:** 先接入 deterministic acknowledgement 和 deterministic stage report，让 UI 有稳定数据。
2. **Model assisted:** 再把 `tool_call.assistant` 的高质量文本接入，但永远保留 deterministic fallback。

这样做可以避免前端继续基于现有 UI 妥协，也能避免为了自然文案增加额外模型调用。
