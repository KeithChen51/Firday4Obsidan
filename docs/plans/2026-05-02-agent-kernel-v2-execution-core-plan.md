# Agent Kernel v2 Execution Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Chinese counterpart: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.zh.md`.

**Goal:** Turn `AgentKernel` from a facade over `AgentRuntimeService` into the owner of stable turn contracts, execution context, lifecycle boundaries, and adapter ports.

**Architecture:** Batch G builds the Kernel v2 execution boundary without migrating the full model/tool loop yet. The kernel will own typed `AgentTurnInput`, `AgentTurnResult`, `AgentTurnEvent`, `AgentExecutionContext`, and port interfaces; the legacy runtime remains behind a compatibility adapter until Batch H migrates the loop. This keeps A-F Harness coverage intact while preventing future runtime work from continuing to grow `AgentRuntimeService`.

**Tech Stack:** TypeScript, Obsidian plugin runtime, Node test runner, `jiti`-loaded TypeScript tests, existing fake runtime harness, existing Agent task/replay/mutation/context modules.

---

## 0. Current Baseline

This plan assumes the A-F closeout batch has passed:

- branch checkpoint exists, currently expected around `chore: close kernel v2 harness batches`
- `npm run lint` passes
- `npm test` passes
- `git diff --check` passes
- `tests/evals/agent-scenarios.json` and `docs/plans/agent-eval-quality-gates.md` agree on scenario coverage
- A-F files are committed, not left as untracked work

Current architectural state:

- `src/core/agent-kernel/AgentKernel.ts` exists, but it is still effectively a pass-through wrapper.
- `src/services/AgentRuntimeService.ts` still owns turn id creation, active task state, cancellation controller state, prompt/native model loops, tool execution, task lifecycle, mutation review, replay event persistence, and result shaping.
- A-F introduced the safety net needed for a careful migration: Harness, Tool Registry, Capability Policy, Tool Gateway, Turn Event Log, Replay Reader, Mutation Plan Review, Context budget/boundary checks, eval scenarios, and product task lifecycle.

This is the right point to stop expanding features and start moving ownership into Kernel v2.

## 1. Scope

Batch G is **Kernel v2 contracts and execution context**.

Batch G should make these things true:

1. `src/core/agent-kernel/` defines the stable Kernel v2 contracts.
2. `AgentKernel` depends on ports, not directly on `AgentRuntimeService`.
3. Each turn has an explicit `AgentExecutionContext` object.
4. Cancellation, turn identity, event collection, and failure classification are represented in kernel-level types.
5. The old runtime is called only through a compatibility adapter.
6. Existing A-F behavior and tests remain green.

Batch G should **not** do these things:

- migrate the native/prompt model loop out of `AgentRuntimeService`
- delete `AgentRuntimeService`
- add Build mode
- add Wiki/RAG/MCP/background agent/multi-agent features
- redesign Daily Board UI
- change release/version behavior
- introduce a new model provider SDK

## 2. Design Decision

Recommended approach: **port-first kernel boundary, legacy loop adapter**.

Other approaches considered:

- **Big-bang rewrite:** Move the model loop, tools, mutation, events, and task lifecycle into Kernel in one batch. This is too risky because `AgentRuntimeService` is large, stateful, and already product-facing.
- **Facade-only continuation:** Keep `AgentKernel` as a thin wrapper and continue adding features to `AgentRuntimeService`. This preserves short-term velocity but reinforces the exact boundary problem Kernel v2 was created to solve.
- **Port-first boundary:** Define contracts, execution context, and adapter interfaces now; keep legacy loop behavior behind an adapter; then migrate loop ownership in Batch H. This is the smallest step that changes architectural direction while keeping Harness evidence.

Batch G should use the third approach.

## 3. Target Runtime Shape After Batch G

Before Batch G:

```text
ExecutionOrchestrator
  -> AgentRuntimeFacade
    -> AgentKernel
      -> AgentRuntimeService.runTurn(input)
```

After Batch G:

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

This is still not the final Kernel v2 loop. The important change is ownership: the kernel begins to own the turn contract and context, while legacy runtime becomes an adapter behind a port.

## 4. Core Contracts

Create kernel-owned contracts under `src/core/agent-kernel/contracts/`.

### AgentTurnInput

Purpose: the canonical input shape for Kernel v2.

Required fields:

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

Important rule: `AgentTurnInput` must not import from UI files. It may import shared core types only.

### AgentTurnResult

Purpose: the canonical result shape for Kernel v2.

Required fields:

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

Important rule: final status is explicit. Do not infer success only from non-empty assistant text.

### AgentTurnEvent

Purpose: streamable and replayable event shape independent of UI.

Minimum event families:

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

Batch G does not need to migrate every existing event emitter. It must define the canonical shape and adapt legacy output into it.

### AgentFailure

Purpose: typed failure classification instead of scattered string matching.

Initial categories:

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

Batch G should include a small classifier that maps current legacy result/failure information to these categories. Batch H can deepen this after the loop moves.

## 5. AgentExecutionContext

Create `src/core/agent-kernel/AgentExecutionContext.ts`.

The context should hold per-turn execution state:

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

Rules:

- No static singleton state.
- No dependency on `DailyBoardView`.
- No dependency on Obsidian UI APIs.
- No dependency on `AgentRuntimeService`.
- It may use small pure helpers from `src/core/`.

This context is the seed for removing `activeTurnId`, `activeTaskId`, and `activeTaskAbortController` from the old service in later batches.

## 6. Ports

Create `src/core/agent-kernel/AgentKernelPorts.ts`.

Initial ports:

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

Keep this intentionally small. Do not model every future port in Batch G.

Expected future ports, documented but not fully implemented in Batch G:

- `ModelDriverPort`
- `ToolGatewayPort`
- `ContextEnginePort`
- `MutationPort`
- `TaskStorePort`
- `ReplayStorePort`

## 7. Legacy Adapter

Create a compatibility adapter outside pure kernel contracts.

Recommended location:

- `src/services/LegacyAgentRuntimeAdapter.ts`

Responsibilities:

- Accept `AgentTurnInput` and `AgentExecutionContext`.
- Convert kernel input into the current `RuntimeTurnInput`.
- Forward cancellation signal.
- Call `AgentRuntimeService.runTurn`.
- Convert legacy `RuntimeTurnResult` into `AgentTurnResult`.
- Preserve `task`, `traces`, `pendingMutations`, `contextSummary`, and raw assistant text.
- Map parse errors, thrown errors, cancellation, and max-iteration stops to `AgentFailure`.

Important rule: `AgentKernel.ts` must not import `AgentRuntimeService`. Only the adapter may know about the legacy service.

## 8. AgentKernel Responsibilities

Modify `src/core/agent-kernel/AgentKernel.ts`.

After Batch G, `AgentKernel` should:

1. accept a `RuntimeTurnExecutorPort`
2. normalize input into `AgentTurnInput`
3. create `AgentExecutionContext`
4. emit `turn_started`
5. call the executor port
6. normalize terminal status
7. emit `turn_completed`, `turn_failed`, or `turn_cancelled`
8. return `AgentTurnResult`

It should not:

- call `AgentRuntimeService` directly
- inspect Obsidian UI state
- mutate vault files directly
- own tool implementations
- own model provider clients

## 9. Facade And Existing Runtime Compatibility

Modify:

- `src/core/agent-kernel/AgentKernel.ts`
- `src/core/execution/ExecutionOrchestrator.ts`
- `src/main.ts`
- `src/types/plugin.ts`
- `src/services/LegacyAgentRuntimeAdapter.ts`

`AgentRuntimeFacade` may temporarily keep the existing public method shape so `ExecutionOrchestrator` and `DailyBoardView` do not need a broad rewrite.

Compatibility expectation:

- Existing call sites still receive fields they expect, including `assistantText`, `traces`, `task`, `parseError` where needed.
- The Kernel result can carry richer fields, but adapters must not break existing tests.
- If a shape conversion is needed, keep it in one place rather than scattering compatibility code through UI.

## 10. Tests

Batch G must be test-first.

### Task-level tests

Create or extend:

- `tests/agent-kernel-contracts.test.mjs`
- `tests/agent-kernel-execution-context.test.mjs`
- `tests/agent-kernel-facade.test.mjs`
- `tests/agent-runtime-harness-e2e.test.mjs`

Required assertions:

1. `AgentKernel` no longer imports `AgentRuntimeService`.
2. Kernel creates an `AgentExecutionContext` with stable `turnId`, `conversationId`, and `agentId`.
3. Kernel emits terminal events for success, failure, and cancellation.
4. Kernel uses `RuntimeTurnExecutorPort`.
5. Legacy adapter maps legacy result to kernel result without dropping task/traces/mutations.
6. Cancellation signal is forwarded into the legacy runtime path.
7. Existing `ExecutionOrchestrator` still routes through `AgentRuntimeFacade`.
8. A-F harness scenarios still pass.

### Static boundary test

Add a test or assertion that scans `src/core/agent-kernel/**/*.ts` for forbidden imports:

- `src/services/AgentRuntimeService`
- `DailyBoardView`
- Obsidian UI view modules

Allow type-only imports from shared core contracts where needed. Prefer avoiding Obsidian imports entirely inside kernel core.

### Verification commands

Run:

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

## 11. Implementation Tasks

### Task 1: Baseline And Failing Boundary Test

**Files:**

- Create: `tests/agent-kernel-contracts.test.mjs`
- Modify: none initially

**Steps:**

1. Assert `src/core/agent-kernel/AgentKernel.ts` must not contain `AgentRuntimeService`.
2. Assert contract files exist.
3. Run the test and confirm it fails before implementation.

Expected failure:

- contract files missing
- current `AgentKernel.ts` imports or references legacy runtime

### Task 2: Add Kernel Contracts

**Files:**

- Create: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Create: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Create: `src/core/agent-kernel/contracts/AgentFailure.ts`
- Create: `src/core/agent-kernel/contracts/index.ts`
- Modify: `tests/agent-kernel-contracts.test.mjs`

**Steps:**

1. Define stable input/result/event/failure types.
2. Keep imports core-only.
3. Add tests for exported shape names and allowed status/failure values.
4. Run targeted test.

### Task 3: Add AgentExecutionContext

**Files:**

- Create: `src/core/agent-kernel/AgentExecutionContext.ts`
- Create: `tests/agent-kernel-execution-context.test.mjs`

**Steps:**

1. Write tests for context creation, event emission, cancellation, and snapshot behavior.
2. Implement minimal context class.
3. Ensure snapshots clone event arrays rather than exposing mutable internal arrays.
4. Run targeted test.

### Task 4: Add Ports And Failure Classifier

**Files:**

- Create: `src/core/agent-kernel/AgentKernelPorts.ts`
- Create: `src/core/agent-kernel/AgentFailureClassifier.ts`
- Modify: `tests/agent-kernel-contracts.test.mjs`

**Steps:**

1. Define `RuntimeTurnExecutorPort`.
2. Define optional event sink/failure classifier ports.
3. Implement a simple failure classifier for current legacy errors.
4. Test categories for cancellation, max iterations, retryable transport, tool denial, mutation conflict, and unknown.

### Task 5: Refactor AgentKernel To Use Ports

**Files:**

- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. Write a fake `RuntimeTurnExecutorPort` test.
2. Make `AgentKernel` accept the port in its constructor.
3. Make `AgentKernel.runTurn` create `AgentExecutionContext`.
4. Ensure success/failure/cancellation terminal events are appended.
5. Keep `AgentRuntimeFacade` as compatibility surface.

Expected result:

- `AgentKernel` is no longer a direct delegate.
- Tests prove it creates context and calls the executor port.

### Task 6: Add LegacyAgentRuntimeAdapter

**Files:**

- Create: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. Implement conversion from kernel input to existing `RuntimeTurnInput`.
2. Implement conversion from legacy `RuntimeTurnResult` to kernel result.
3. Preserve `task`, `traces`, `pendingMutations`, and parse/failure metadata.
4. Wire `main.ts` as:
   - create `AgentRuntimeService`
   - create `LegacyAgentRuntimeAdapter`
   - create `AgentKernel(adapter)`
   - create `AgentRuntimeFacade(kernel)`
5. Run facade tests.

### Task 7: Keep ExecutionOrchestrator Stable

**Files:**

- Modify only if necessary: `src/core/execution/ExecutionOrchestrator.ts`
- Modify only if necessary: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. Verify orchestrator still depends on facade, not legacy runtime.
2. If result shape changed, isolate compatibility conversion in facade, not UI.
3. Run orchestrator/facade test.

### Task 8: Harness And Eval Regression

**Files:**

- Modify only if necessary: `tests/helpers/fakeAgentRuntime.mjs`
- Modify only if necessary: `tests/agent-runtime-harness-e2e.test.mjs`
- Modify only if necessary: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. Run A-F harness tests.
2. If helper wiring assumes direct runtime service, update it to use facade/kernel path.
3. Do not weaken assertions.
4. Run full eval runner.

### Task 9: Documentation Update

**Files:**

- Modify: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.md`
- Modify: `docs/plans/2026-05-02-agent-kernel-v2-execution-core-plan.zh.md`
- Modify only if needed: `docs/plans/agent-eval-quality-gates.md`

**Steps:**

1. Update the plan with implementation deviations if needed.
2. Record whether Batch G completed, partially completed, or was split.
3. Keep English and Chinese docs aligned.

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

## 12. Acceptance Criteria

Batch G is accepted only if all criteria pass:

- `AgentKernel.ts` no longer imports `AgentRuntimeService`.
- `AgentKernel` creates and uses `AgentExecutionContext`.
- `AgentKernel` calls an executor port, not a concrete service.
- Legacy runtime is reachable only through `LegacyAgentRuntimeAdapter`.
- Existing `ExecutionOrchestrator` continues to run through `AgentRuntimeFacade`.
- Kernel contracts define explicit status and failure taxonomy.
- New tests cover contracts, context, facade, adapter mapping, and forbidden imports.
- A-F harness and eval tests still pass.
- `npm run lint`, `npm test`, and `git diff --check` pass.
- No new feature surface is added.

## 13. Risks And Mitigations

### Risk: Adapter Becomes Another Dumping Ground

Mitigation:

- Adapter only converts shapes and calls legacy runtime.
- No new business logic inside adapter except failure/result mapping.

### Risk: Kernel Contracts Mirror Legacy Runtime Too Closely

Mitigation:

- Keep kernel statuses and events product-oriented.
- Do not expose legacy parse details as first-class concepts unless needed for compatibility.

### Risk: Tests Only Prove Wiring, Not Behavior

Mitigation:

- Keep A-F harness and eval scenarios as behavioral gates.
- Add boundary tests for imports and ownership.

### Risk: Too Much Refactor In One Batch

Mitigation:

- Stop at contracts/context/ports/adapter.
- Leave full model loop migration to Batch H.

## 14. Next Batches After G

### Batch H: Move The Model Loop

Move prompt/native model loop ownership from `AgentRuntimeService` into Kernel v2. Legacy service becomes a provider of Obsidian-specific ports.

### Batch I: Move Task, Replay, And Mutation Ownership

Kernel becomes the producer of task state, replay events, and mutation plan events. UI only renders state and triggers approved actions.

### Batch J: Legacy Runtime Retirement Gate

Delete or shrink old runtime code only after Kernel v2 has equivalent harness/eval coverage and production adapter parity.

## 15. Confirmation Question

Approve Batch G if the next implementation should prioritize architectural ownership over new user-visible features.

If you want a more aggressive route, change this plan before implementation. The aggressive alternative would combine Batch G and H, but that increases risk because it moves contracts and model loop behavior at the same time.
