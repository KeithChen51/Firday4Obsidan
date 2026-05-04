# Agent Network Resilience Visibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make model/network instability visible as first-class trajectory events so FRIDAY can show Codex-style reconnecting/retrying states without pretending it can already resume from checkpoints.

**Architecture:** Keep the current retry policy in `AIService` and `LlmTransportPolicy`, but add transport telemetry that flows through model drivers, runtime progress, turn replay, and `AgentTrajectorySnapshot`. Batch M.1 is observability and UI fact plumbing only; it must not change retry semantics, checkpoint semantics, tool execution semantics, or task resume behavior.

**Tech Stack:** TypeScript, `AIService`, `LlmTransportPolicy`, Kernel v2 model driver ports, legacy runtime progress bridge, `TurnStateMachine`, `TurnEventLog`, `TurnReplayReader`, `AgentTrajectoryProjector`, Node test runner.

---

## Counterpart Document

Chinese counterpart: `docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md`

If implementation changes scope, contracts, file paths, test requirements, or acceptance criteria, update both documents.

## Position in the Roadmap

Batch M.1 comes before Batch L.

```text
Batch K: trajectory projection exists
-> Batch M.1: transport retry/reconnect facts enter trajectory
-> Batch L: redesigned process UI renders those facts
-> Batch M.2: checkpointed resume changes recovery semantics
```

M.1 exists because network instability is common in the target environment. Corporate gateways, internal proxies, and VPNs can make model calls fail with 429/502/503/504, timeout, reset, or temporary unavailable errors. Users need to see that FRIDAY is reconnecting instead of assuming the Agent is frozen.

## Current Reality

Already present:

- `src/core/llm/LlmTransportPolicy.ts` classifies retryable LLM failures and calculates retry delays.
- `src/services/AIService.ts` retries `chat`, `chatStream`, `chatWithTools`, and connection checks internally.
- `src/core/agent-kernel/AgentLoopController.ts` prevents retryable native transport failures from silently falling back to prompt mode.
- `src/core/agent-kernel/AgentFailureClassifier.ts` and `ToolGovernor` recognize transport instability.
- `AgentResumeController.retryTask()` can rerun from stored original input.

Missing:

- No retry attempt is emitted as a runtime progress event.
- No replay event records retry attempt, retry delay, endpoint switch, or final exhausted transport failure as structured data.
- `AgentTrajectorySnapshot` has no `model_transport` item kind/status or transport failure class.
- Daily Board cannot render "reconnecting" accurately.
- Retry after exhaustion still reruns from original input, not a checkpoint. M.1 must state this honestly.

## Scope

In scope:

- Add a small transport telemetry contract.
- Emit telemetry from `AIService` request loops.
- Forward telemetry through `AIServiceModelDriverAdapter` and Kernel v2 `ModelDriverPort`.
- Forward telemetry in legacy `AgentRuntimeService` paths while legacy remains wired.
- Add `model_retry` or equivalent runtime progress phase.
- Add step trace support for retry/reconnect events.
- Add turn event log support for model retry scheduled/exhausted events.
- Project live and replayed transport events into `AgentTrajectorySnapshot`.
- Classify transport instability as retryable/recoverable in trajectory.
- Add tests proving retry events are visible without changing resume behavior.

Out of scope:

- Do not implement checkpointed resume.
- Do not auto-continue a failed task from the middle of a loop.
- Do not persist model message checkpoints.
- Do not add new retry policies beyond the current retryable status/pattern rules unless a test proves an existing obvious gateway code is missing.
- Do not add Wiki/RAG/MCP/Build/background/multi-agent.
- Do not redesign UI in this batch; only make the facts available for Batch L.

## Target Event Model

Create a small transport telemetry type, preferably in:

- Create: `src/core/llm/LlmTransportTelemetry.ts`

Suggested contract:

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

The endpoint URL must not be emitted verbatim. If endpoint identity is useful, emit `endpointIndex` and `endpointCount`, or a redacted origin label.

Extend runtime progress with a transport phase:

```ts
phase: "model_retry"
```

Suggested optional fields:

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

If the existing `RuntimeProgressEvent` shape should remain flat, add flat optional fields instead. Prefer a nested object if tests and existing serialization support it.

## Implementation Tasks

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

**Step 1: Confirm clean worktree**

```powershell
git status --short --branch
```

Expected: no unrelated dirty files.

**Step 2: Run existing transport and trajectory gates**

```powershell
node --test tests/ai-service-retry-regression.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: all pass.

### Task M1.1: Add transport telemetry contract and tests

**Files:**

- Create: `src/core/llm/LlmTransportTelemetry.ts`
- Create: `tests/llm-transport-telemetry.test.mjs`

**Step 1: Write failing tests**

Cover:

- request event has no raw endpoint URL.
- retry scheduled event includes `attempt`, `maxAttempts`, `delayMs`, retryable, and http status when present.
- exhausted event marks `retryable: false` after max attempts.
- request id is stable across attempts for one model request.

**Step 2: Run failure**

```powershell
node --test tests/llm-transport-telemetry.test.mjs
```

Expected: FAIL because the module does not exist.

**Step 3: Implement minimal contract helpers**

Add helpers only if they reduce repeated code:

```ts
export function createLlmTransportRequestId(prefix = "llm"): string;
export function summarizeTransportError(error: unknown): { httpStatus?: number; message: string };
```

**Step 4: Run test**

```powershell
node --test tests/llm-transport-telemetry.test.mjs
```

Expected: PASS.

### Task M1.2: Emit telemetry from AIService retries

**Files:**

- Modify: `src/services/AIService.ts`
- Modify: `tests/ai-service-retry-regression.test.mjs`

**Step 1: Extend options**

Extend internal options:

```ts
interface ChatOptions extends LlmTransportObserver {
	temperature?: number;
	maxTokens?: number;
	modelOverride?: string;
	signal?: AbortSignal;
}
```

Apply to:

- `chat`
- `chatStream`
- `chatWithTools`
- `checkConnection` only if practical without widening public behavior too much

**Step 2: Emit events without changing retry behavior**

For each request loop:

- emit `request_started` before the first attempt.
- when `shouldRetryLlmRequest(...)` is true, emit `retry_scheduled` before delay.
- emit `retry_started` when the next attempt begins.
- emit `request_succeeded` on success.
- emit `request_failed` for non-retryable failures.
- emit `request_exhausted` when retryable failure hits max attempts.

Do not change:

- `AIService.MAX_RETRY_ATTEMPTS`
- retry delay calculation
- endpoint fallback rules
- stream fallback behavior

**Step 3: Add tests**

Cover:

- `chatWithTools` emits retry scheduled before retrying 504.
- `chat` emits exhausted event when max retry attempts are reached.
- successful retry emits request succeeded.
- no event leaks raw Authorization/API key/endpoint.

**Step 4: Run tests**

```powershell
node --test tests/ai-service-retry-regression.test.mjs tests/llm-transport-telemetry.test.mjs
```

Expected: PASS.

### Task M1.3: Forward telemetry through Kernel model driver

**Files:**

- Modify: `src/core/agent-kernel/ModelDriverPort.ts`
- Modify: `src/services/AIServiceModelDriverAdapter.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Modify: `src/core/agent-kernel/AgentLoopTypes.ts`
- Test: `tests/agent-kernel-loop.test.mjs`

**Step 1: Extend model request ports**

Add optional telemetry callback to `ModelDriverRequest`:

```ts
onTransportEvent?: (event: LlmTransportEvent) => void;
```

**Step 2: Adapter forwards callback**

`AIServiceModelDriverAdapter` passes `onTransportEvent` into `aiService.chat` and `aiService.chatWithTools`.

**Step 3: AgentLoopController maps telemetry to progress**

When building model driver input, pass:

```ts
onTransportEvent: (event) => this.emitModelTransport(input, context, step, event)
```

`emitModelTransport()` reports `RuntimeProgressEvent` with:

- `phase: "model_retry"`
- `depth`
- `step`
- readable message such as `Model request retrying after gateway timeout (attempt 2/4)`
- transport payload

**Step 4: Add kernel tests**

Cover:

- model driver retry event reaches progress reporter.
- retryable transport failure still does not trigger prompt fallback.
- transport progress does not mark turn completed or failed by itself.

**Step 5: Run tests**

```powershell
node --test tests/agent-kernel-loop.test.mjs
```

Expected: PASS.

### Task M1.4: Forward telemetry through legacy runtime while it exists

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/core/turn-state/TurnStateMachine.ts`
- Modify: `src/core/orchestrator/TurnOrchestrator.ts`
- Test: `tests/agent-runtime-harness-e2e.test.mjs`
- Test: `tests/agent-runtime-transport-fallback-regression.test.mjs`

**Step 1: Extend RuntimeProgressEvent**

Add `"model_retry"` to the phase union in the legacy exported type and Kernel contract type.

**Step 2: Extend TurnStateMachine**

Add:

```ts
| "STEP_MODEL_RETRY"
```

**Step 3: Extend TurnOrchestrator mapping**

Map:

```ts
model_retry: "STEP_MODEL_RETRY"
```

**Step 4: Pass AIService telemetry in legacy prompt/native calls**

Where `AgentRuntimeService` calls:

- `aiService.chat`
- `aiService.chatWithTools`

pass a callback that calls `reportProgress(input, ...)`.

**Step 5: Add tests**

Cover:

- a retryable 504 emits `model_retry` progress before final failure or success.
- progress sequence remains valid.
- no prompt fallback for retryable transport failure.

**Step 6: Run tests**

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs
```

Expected: PASS.

### Task M1.5: Persist and replay transport events

**Files:**

- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: runtime event persistence location in `src/services/AgentRuntimeService.ts` or Kernel lifecycle adapter, depending on current event owner.
- Test: `tests/turn-replay-reader.test.mjs` if it exists; otherwise create `tests/turn-replay-transport-events.test.mjs`.

**Step 1: Add replay event types**

Add event types:

```ts
| "model_retry_scheduled"
| "model_retry_started"
| "model_retry_exhausted"
```

If implementation prefers one event:

```ts
| "model_retry"
```

then payload must include the transport type.

**Step 2: Update replay summary**

Add to `TurnReplaySummary`:

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

**Step 3: Add tests**

Cover:

- summary counts retries.
- replay order remains valid.
- transport event after terminal is rejected unless it is explicitly post-turn review, which it should not be.
- payload is sanitized/truncated.

**Step 4: Run tests**

```powershell
node --test tests/turn-replay-transport-events.test.mjs tests/agent-replay-reader.test.mjs
```

If `tests/agent-replay-reader.test.mjs` does not exist, run the existing replay tests discovered in the repo.

### Task M1.6: Project transport events into trajectory

**Files:**

- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/agent-trajectory-projector.test.mjs`

**Step 1: Extend trajectory types**

Add item kind:

```ts
| "transport"
```

Extend failure class if needed:

```ts
| "model_transport"
```

Do not replace existing `model` items; transport is a sibling item used to explain reconnecting/retry behavior.

**Step 2: Project live progress**

For `phase: "model_retry"`:

- keep snapshot status `running` while retrying.
- set headline to `Reconnecting to model` or equivalent.
- set summary to attempt/backoff information.
- add/update a transport item in the reasoning stage.
- mark status `running` for retry scheduled/started.
- if exhausted and represented as progress before error, mark failed/retryable.

**Step 3: Project replay summary**

For transport timeline:

- add transport items.
- preserve retry attempt counts.
- if transport exhausted caused terminal failure, set failure class `model_transport`, `retryable: true`, `recoverable: true`.

**Step 4: Add tests**

Cover:

- live retry progress projects to running transport item.
- exhausted replay projects to retryable transport failure.
- status priority still keeps waiting states above transport states.
- existing mutation conflict/apply_failed tests still pass.

**Step 5: Run tests**

```powershell
node --test tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
```

Expected: PASS.

### Task M1.7: Boundary and regression checks

**Files:**

- Modify tests only if needed.

**Step 1: Static boundary checks**

```powershell
Get-ChildItem -Path 'src\core\trajectory','src\views' -Recurse -File -Include *.ts |
  Select-String -Pattern 'AIService|requestUrl|fetch\\(|AgentRuntimeService'
```

Expected:

- trajectory/view code must not call AIService or fetch directly.
- view code still only consumes trajectory snapshots.

**Step 2: Focused suite**

```powershell
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
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
- full test suite passes.
- no whitespace errors.
- no unrelated release artifacts remain dirty.

## Acceptance Criteria

Batch M.1 is complete only when:

- `AIService` emits structured transport telemetry for retry scheduling, retry start, success, failure, and exhaustion.
- Telemetry does not leak raw endpoint URLs, API keys, Authorization headers, or full request bodies.
- Kernel model driver path forwards telemetry to runtime progress.
- Legacy runtime path forwards telemetry while it still exists.
- `RuntimeProgressEvent` supports model retry/reconnect state.
- `TurnStateMachine` and `TurnOrchestrator` can record model retry progress.
- `TurnEventLog` and `TurnReplayReader` can persist and summarize transport retry events.
- `AgentTrajectoryProjector` turns live/replay transport facts into trajectory transport items.
- Retryable transport exhaustion is classified as recoverable/retryable, but not checkpoint-resumed.
- Existing "no prompt fallback for retryable transport" behavior remains.
- No UI redesign, checkpoint store, or resume semantic change is mixed into M.1.

## Failure Modes

| Failure mode | Risk | Required coverage |
| --- | --- | --- |
| Retry happens silently | UI cannot show reconnecting | AIService telemetry test |
| Telemetry leaks endpoint/API key | privacy/security issue | redaction/no-url test |
| Kernel sees retry but legacy path does not | current wired path remains blind | legacy runtime test |
| Retry progress marks turn failed too early | confusing live state | trajectory live test |
| Exhausted retry is not recoverable | user sees dead failure | trajectory failure test |
| Prompt fallback returns after gateway timeout | duplicate model cost and unstable behavior | transport fallback regression |
| M.1 starts implementing checkpoints | oversized batch and risky semantics | static/diff review |

## Development Prompt

Use this in a new implementation window:

```text
You are working in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule.

Goal: implement Batch M.1: Agent Network Resilience Visibility.

Read first:
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md
- docs/plans/2026-05-04-agent-trajectory-projection-plan.md

Scope:
- Add transport retry/reconnect telemetry from AIService into runtime progress, replay, and AgentTrajectorySnapshot.
- Do not implement checkpointed resume.
- Do not change retry counts/backoff semantics unless tests prove an obvious missing retryable case.
- Do not redesign UI. Batch L will render the new trajectory facts.
- Do not add Wiki/RAG/MCP/Build/background/multi-agent.

Start with:
git status --short --branch
node --test tests/ai-service-retry-regression.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs

Use TDD task by task. Add focused tests before implementation.

When done, run:
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
npm run lint
npm test
git diff --check
git status --short --branch

Final output:
- changed files;
- exact transport event contract;
- whether retry behavior changed;
- how replay and trajectory expose reconnecting;
- test results;
- remaining risks.
```

## Review Prompt

Use this in a separate verification window:

```text
You are doing read-only verification in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload. First read AGENTS.md and strictly follow the per-turn myskills-router rule. Do not change code unless I explicitly ask you to fix something.

Goal: verify Batch M.1: Agent Network Resilience Visibility.

Acceptance source:
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.zh.md
- docs/plans/2026-05-04-agent-network-resilience-visibility-plan.md

Check:
1. AIService emits structured transport retry/reconnect telemetry for chat/chatStream/chatWithTools.
2. Telemetry does not expose raw endpoint URLs, API keys, Authorization headers, or request bodies.
3. Kernel model driver path forwards telemetry to RuntimeProgressEvent.
4. Legacy AgentRuntimeService path forwards telemetry while legacy still exists.
5. RuntimeProgressEvent, TurnStateMachine, and TurnOrchestrator support model retry/reconnect progress.
6. TurnEventLog/TurnReplayReader persist and summarize transport retry events.
7. AgentTrajectoryProjector projects live/replay transport events into trajectory items.
8. Retryable transport exhaustion is recoverable/retryable but does not claim checkpoint resume.
9. Existing no-prompt-fallback behavior for retryable transport still holds.
10. No UI redesign, checkpoint store, Wiki/RAG/MCP/Build/background/multi-agent work was mixed in.

Run:
git status --short --branch
Get-ChildItem -Path 'src' -Recurse -File -Include *.ts | Select-String -Pattern 'model_retry|transport|retry_scheduled|request_exhausted'
node --test tests/llm-transport-telemetry.test.mjs tests/ai-service-retry-regression.test.mjs tests/agent-kernel-loop.test.mjs tests/agent-runtime-transport-fallback-regression.test.mjs tests/agent-runtime-harness-e2e.test.mjs tests/turn-replay-transport-events.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-trajectory-live-store.test.mjs
npm run lint
npm test
git diff --check

Output format:
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
