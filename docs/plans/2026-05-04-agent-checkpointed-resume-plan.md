# Agent Checkpointed Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add safe checkpointed resume so retryable model/network failures can continue from the last stable Agent loop boundary instead of always restarting from the original user prompt.

**Architecture:** Add a Kernel-owned checkpoint contract and persistence port, record stable loop checkpoints after context construction and after completed tool results, and teach task retry/resume to prefer valid checkpoints. M.2 changes recovery semantics, so it must be implemented after M.1 observability and after the process UI can truthfully explain whether FRIDAY is retrying from the beginning or resuming from a checkpoint.

**Tech Stack:** TypeScript, Kernel v2 loop controller, `AgentResumeController`, task store, turn event log/replay, trajectory projection, local JSON persistence, Node test runner.

---

## Counterpart Document

Chinese counterpart: `docs/plans/2026-05-04-agent-checkpointed-resume-plan.zh.md`

If implementation changes contracts, resume safety policy, file paths, task action semantics, or acceptance criteria, update both documents.

## Position in the Roadmap

M.2 comes after M.1 and Batch L.

```text
M.1: transport retry/reconnect facts are visible
-> L: process UI can render retrying/reconnecting/exhausted states
-> M.2: failed retryable work can resume from stable checkpoints
```

M.2 must not be mixed into M.1. M.1 is observability. M.2 is execution semantics.

## Current Reality

Current retry behavior:

- `AgentResumeController.retryTask(taskId)` requires a terminal task.
- It rebuilds a new `AgentRuntimeFacadeInput` from `task.runInput`.
- `task.runInput` contains the original prompt/model/depth/file/tool limits.
- It does not restore model messages, completed tool results, loop cursor, or mutation state.

That means today's retry is a clean rerun, not a continuation.

M.2 should change this only where it is safe:

- If a valid checkpoint exists, resume from the checkpoint.
- If no valid checkpoint exists, keep the existing retry-from-original-input behavior.
- If checkpoint safety is uncertain, refuse checkpoint resume and explain why.

## Product Principle

The UI and runtime must use accurate language:

- "Retry" means rerun from original input.
- "Resume" means continue from a stored checkpoint.
- "Reconnecting" means the current model request is being retried, not that checkpoint resume is already happening.

Do not claim "won't start over" unless checkpoint resume is actually available for that task.

## Scope

In scope:

- Add checkpoint contract and local store.
- Record stable checkpoints in Kernel v2 loop execution.
- Add checkpoint lifecycle events to replay.
- Extend task state/actions so a failed retryable task can expose checkpoint resume when valid.
- Teach `AgentResumeController` to prefer checkpoint resume for retryable model/transport failures.
- Guarantee completed tool calls are not re-executed when resuming from a checkpoint.
- Add tests proving checkpoint resume avoids duplicate tool execution.
- Add guardrails for stale/unsafe checkpoints.

Out of scope:

- Do not resume arbitrary in-flight tool calls.
- Do not resume in the middle of a file mutation apply.
- Do not add background agents, multi-agent orchestration, Wiki/RAG/MCP, or Build capability.
- Do not add cloud sync for checkpoints.
- Do not implement cross-device resume.
- Do not change model retry counts/backoff from M.1.
- Do not store raw API keys, Authorization headers, cookies, or request headers in checkpoints.

## Stable Resume Boundaries

M.2 v1 should support only these safe boundaries:

1. `context_ready`
   - Context package has been built.
   - No model request has completed yet.
   - Resume can request the first model decision without rebuilding unrelated context.

2. `after_tool_result`
   - A tool call completed and its model-facing result was appended to `modelMessages`.
   - Resume can request the next model decision without re-running the completed tool.

3. `after_model_response_without_tool`
   - A final response or pending mutation plan has been produced.
   - Usually no resume is needed; record only if useful for replay diagnostics.

Do not auto-resume from:

- `during_model_request`
- `after_model_response_before_tool_execution`
- `during_tool_execution`
- `during_mutation_apply`
- `waiting_for_approval`
- `waiting_for_user`

Those states may have checkpoints for diagnostics, but not for automatic continuation.

## Checkpoint Contract

Create:

- `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- `src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts`

Suggested contract:

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

`modelMessages` must be local-only and sanitized for obvious secrets. Do not store headers, API keys, cookies, or endpoint URLs. Because checkpoint resume requires reconstructing model context, do not over-truncate model-facing tool results unless existing runtime token limits require it.

Suggested port:

```ts
export interface AgentLoopCheckpointStorePort {
	save(checkpoint: AgentLoopCheckpoint): Promise<void>;
	getLatestForTask(taskId: string): Promise<AgentLoopCheckpoint | null>;
	getLatestForTurn(turnId: string): Promise<AgentLoopCheckpoint | null>;
	markConsumed(checkpointId: string, result: "resumed" | "rejected" | "expired", reason: string): Promise<void>;
}
```

## Implementation Tasks

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
- Read: M.1 and L plan docs.

**Step 1: Confirm prerequisites**

```powershell
git status --short --branch
node --test tests/llm-transport-telemetry.test.mjs tests/agent-process-panel-view-model.test.mjs
```

Expected: M.1 and L tests exist and pass. If they do not exist, stop and confirm M.2 should not start yet.

**Step 2: Run current resume gates**

```powershell
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: all pass.

### Task M2.1: Add checkpoint contract and store tests

**Files:**

- Create: `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- Create: `src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts`
- Create: `tests/agent-loop-checkpoint-store.test.mjs`

**Step 1: Write failing tests**

Cover:

- save and retrieve latest checkpoint by task id.
- save and retrieve latest checkpoint by turn id.
- mark checkpoint consumed/rejected/expired.
- stale checkpoint is not returned as valid when expiry policy says no.
- sanitizer removes bearer tokens, `sk-*`, cookie-like values, and authorization fields.

**Step 2: Run failure**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs
```

Expected: FAIL because modules do not exist.

**Step 3: Implement local JSON/JSONL store**

Use existing repo persistence style. Keep it local. Do not introduce a database.

**Step 4: Run test**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs
```

Expected: PASS.

### Task M2.2: Add checkpoint port to Kernel loop

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopTypes.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `tests/agent-kernel-loop.test.mjs`

**Step 1: Add checkpoint lifecycle port**

Suggested:

```ts
export interface AgentLoopCheckpointPort {
	save(checkpoint: AgentLoopCheckpoint): Promise<void>;
	getResumeCheckpoint?(input: AgentTurnInput, context: AgentExecutionContext): Promise<AgentLoopCheckpoint | null>;
}
```

**Step 2: Add input metadata for resume**

Support:

```ts
input.metadata?.resumeFromCheckpointId
```

or a typed field if the codebase prefers:

```ts
resumeFromCheckpointId?: string;
```

Do not overload `retryOfTaskId` to mean checkpoint resume.

**Step 3: Add tests**

Cover:

- loop saves `context_ready` checkpoint before first model request.
- loop saves `after_tool_result` checkpoint after appending tool result to model messages.
- checkpoint save failure does not fail the user turn.
- checkpoint content does not include request headers or endpoint URL.

**Step 4: Run tests**

```powershell
node --test tests/agent-kernel-loop.test.mjs tests/agent-loop-checkpoint-store.test.mjs
```

Expected: PASS.

### Task M2.3: Resume loop from checkpoint

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `tests/agent-kernel-loop.test.mjs`
- Create: `tests/agent-kernel-checkpoint-resume.test.mjs`

**Step 1: Write failing resume test**

Scenario:

1. Step 1 requests model.
2. Model requests a read-only tool.
3. Tool succeeds.
4. Checkpoint is saved at `after_tool_result`.
5. Next model request fails with retryable transport exhaustion.
6. `resumeFromCheckpointId` reruns loop.
7. The completed tool is not executed again.
8. The next model request uses restored `modelMessages`.

**Step 2: Implement resume entry**

When a valid checkpoint is provided:

- skip context build if checkpoint includes restorable `modelMessages`.
- restore `traces`.
- start loop at `checkpoint.nextStep`.
- continue in the original channel (`prompt` or `native`) unless settings explicitly make that impossible.
- emit progress event indicating checkpoint resume.

**Step 3: Add unsafe boundary tests**

Cover:

- checkpoint with `canAutoResume: false` is rejected.
- checkpoint at `during_tool_execution` is rejected.
- checkpoint with incompatible schema version is rejected.

**Step 4: Run tests**

```powershell
node --test tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-loop.test.mjs
```

Expected: PASS.

### Task M2.4: Wire AgentResumeController and task actions

**Files:**

- Modify: `src/core/agent-kernel/AgentResumeController.ts`
- Modify: `src/core/agent-kernel/AgentTaskManager.ts`
- Modify: `src/core/tasks/AgentTask.ts`
- Modify: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/agent-task-lifecycle.test.mjs`
- Test: `tests/agent-kernel-checkpoint-resume.test.mjs`

**Step 1: Extend task metadata**

Add checkpoint metadata to task without replacing original `runInput`:

```ts
checkpoint?: {
	latestId: string;
	boundary: string;
	canResume: boolean;
	reason: string;
	updatedAt: string;
}
```

**Step 2: Resume controller prefers checkpoint**

For failed terminal tasks:

- if valid checkpoint exists and failure is retryable/recoverable, build input with `resumeFromCheckpointId`.
- otherwise use current retry-from-original behavior.

Return metadata that tells UI/result whether this was checkpoint resume or original retry.

**Step 3: Add trajectory action**

Add either:

- `resume` action when checkpoint resume is available, plus `retry` fallback; or
- `retry` with label `Resume from checkpoint` only if the action id contract cannot change safely.

Prefer explicit `resume` if tests can cover it without breaking existing action handlers.

**Step 4: Add tests**

Cover:

- failed retryable task with checkpoint exposes resume action.
- failed retryable task without checkpoint exposes retry action.
- non-retryable failure does not expose resume.
- existing approval continue behavior is unchanged.

**Step 5: Run tests**

```powershell
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

### Task M2.5: Add replay events and trajectory explanation

**Files:**

- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/turn-replay-checkpoint-events.test.mjs`
- Test: `tests/agent-trajectory-projector.test.mjs`

**Step 1: Add event types**

Suggested:

```ts
| "checkpoint_saved"
| "checkpoint_resume_started"
| "checkpoint_resume_rejected"
| "checkpoint_resume_completed"
```

**Step 2: Add replay summary fields**

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

**Step 3: Project to trajectory**

Add checkpoint/system items that explain:

- checkpoint saved after stable tool result.
- resume started from checkpoint.
- resume rejected and fallback retry from original input.

**Step 4: Add tests**

Cover:

- replay summary counts checkpoint events.
- trajectory shows resume rather than retry when checkpoint was used.
- checkpoint rejection reason is visible but sanitized.

**Step 5: Run tests**

```powershell
node --test tests/turn-replay-checkpoint-events.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

### Task M2.6: Safety and idempotency gates

**Files:**

- Modify: `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Test: `tests/agent-kernel-checkpoint-safety.test.mjs`

**Step 1: Define safety policy**

Checkpoint resume is allowed only when:

- schema version is supported.
- task/conversation/agent identity matches.
- checkpoint boundary is in the allowed stable boundary list.
- checkpoint is not expired.
- no in-flight tool call exists.
- no in-flight mutation apply exists.
- model/tool settings still allow the required channel/tool set.

**Step 2: Add tests**

Cover:

- stale checkpoint rejected.
- tool set mismatch rejected.
- pending mutation apply rejected.
- in-flight tool call checkpoint rejected.
- rejection falls back to original retry only when safe and explicit.

**Step 3: Run tests**

```powershell
node --test tests/agent-kernel-checkpoint-safety.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs
```

Expected: PASS.

### Task M2.7: Full regression

**Files:**

- No required code changes.

**Step 1: Focused suite**

```powershell
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs
```

Expected: PASS.

**Step 2: Integration suite**

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
```

Expected: PASS.

**Step 3: Full verification**

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

## Acceptance Criteria

Batch M.2 is complete only when:

- Kernel saves stable checkpoints at safe boundaries.
- Failed retryable model/transport tasks can resume from the latest valid checkpoint.
- If checkpoint resume is unavailable or unsafe, existing retry-from-original-input behavior remains available where appropriate.
- Completed tool calls are not re-executed during checkpoint resume.
- Pending/in-flight tool calls and mutation apply operations are not auto-resumed.
- Task/trajectory actions distinguish resume from retry, or labels make the difference unambiguous.
- Replay records checkpoint saved/resume/rejected events.
- Process UI can accurately explain whether FRIDAY resumed from checkpoint or reran from original input.
- Checkpoints do not contain API keys, Authorization headers, cookies, endpoint URLs, or request headers.
- Existing approval, mutation review, cancellation, and transport fallback tests still pass.

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Resume repeats a completed tool | duplicate writes or duplicated external effects | checkpoint resume no duplicate tool test |
| Resume from unsafe in-flight state | corrupt execution state | checkpoint safety tests |
| Resume claims checkpoint but reruns original prompt | misleading product behavior | resume vs retry action tests |
| Checkpoint stores secrets | security/privacy issue | sanitizer tests |
| Checkpoint save failure breaks normal run | reliability regression | checkpoint save failure ignored test |
| Stale checkpoint used after settings/tool change | invalid model/tool context | stale/mismatch tests |
| Mutation apply resumed mid-write | file corruption risk | mutation safety test |

## Development Prompt

Use this in a new implementation window:

```text
You are working in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule.

Goal: implement Batch M.2: Agent Checkpointed Resume.

Prerequisites:
- Batch M.1 must already be complete.
- Batch L should already be complete or at least able to render trajectory resume/retry facts.

Read first:
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.zh.md
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.zh.md
- docs/plans/2026-05-04-agent-process-ui-redesign-plan.md

Scope:
- Add Kernel-owned checkpoint contract/store.
- Save stable checkpoints at context_ready and after_tool_result.
- Make failed retryable model/transport tasks prefer valid checkpoint resume.
- Ensure completed tools are not re-executed on resume.
- Distinguish resume from retry in task/trajectory actions.
- Do not resume in-flight tool calls or mutation apply.
- Do not add Wiki/RAG/MCP/Build/background/multi-agent.

Start with:
git status --short --branch
node --test tests/agent-task-lifecycle.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-kernel-loop.test.mjs

Use TDD task by task. Write failing focused tests before implementation.

When done, run:
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

Final output:
- changed files;
- checkpoint contract and persistence path;
- exact safe resume boundaries;
- proof that tools are not duplicated;
- retry vs resume semantics;
- test results;
- remaining risks.
```

## Review Prompt

Use this in a separate verification window:

```text
You are doing read-only verification in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule. Do not change code unless I explicitly ask you to fix something.

Goal: verify Batch M.2: Agent Checkpointed Resume.

Acceptance source:
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.zh.md
- docs/plans/2026-05-04-agent-checkpointed-resume-plan.md

Check:
1. Kernel saves stable checkpoints at context_ready and after_tool_result boundaries.
2. Checkpoint store is local, tested, and does not store API keys, Authorization headers, cookies, endpoint URLs, or request headers.
3. Failed retryable model/transport tasks prefer valid checkpoint resume.
4. Existing retry-from-original-input remains available when checkpoint is missing or unsafe.
5. Completed tool calls are not re-executed during checkpoint resume.
6. In-flight tool calls, waiting approval/user, and mutation apply are not auto-resumed.
7. Task/trajectory actions distinguish resume from retry, or labels are unambiguous.
8. Replay records checkpoint saved/resume/rejected events.
9. Process UI can explain resume vs retry from trajectory facts.
10. No Wiki/RAG/MCP/Build/background/multi-agent work was mixed in.

Run:
git status --short --branch
Get-ChildItem -Path 'src' -Recurse -File -Include *.ts | Select-String -Pattern 'checkpoint|resumeFromCheckpoint|checkpoint_resume'
node --test tests/agent-loop-checkpoint-store.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs tests/turn-replay-checkpoint-events.test.mjs tests/agent-task-lifecycle.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs tests/agent-kernel-approval-resume.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs tests/agent-process-panel-view-model.test.mjs
npm run lint
npm test
git diff --check

Output format:
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
