# Agent Kernel v2 Migration Batches H-I-J Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Chinese counterpart: `docs/plans/2026-05-02-agent-kernel-v2-migration-batches-h-i-j-plan.zh.md`.

**Goal:** Complete the post-Batch-G Kernel v2 migration by moving the model loop, task/replay/mutation ownership, and legacy runtime retirement gates into a staged plan.

**Architecture:** Batch G establishes contracts, execution context, ports, and a legacy adapter. Batch H moves the model/tool loop into Kernel v2. Batch I moves task state, replay events, approval waits, and mutation ownership into Kernel v2. Batch J removes or shrinks the legacy runtime path only after parity is proven by Harness, evals, static boundary checks, and product-level acceptance gates.

**Tech Stack:** TypeScript, Obsidian plugin runtime, Node test runner, existing Kernel v2 contracts, existing fake runtime harness, `AIService`, `ToolGateway`, `ToolRegistry`, `CapabilityPolicy`, `MutationPlan`, `AgentTask`, `TurnEventLog`, `TurnReplayReader`, and Daily Board UI adapters.

---

## 0. How To Read This Plan

This plan begins only after Batch G is accepted.

Batch G should have already made `AgentKernel` depend on a `RuntimeTurnExecutorPort`, introduced `AgentExecutionContext`, and placed `AgentRuntimeService` behind a `LegacyAgentRuntimeAdapter`.

This plan covers:

- **Batch H:** Kernel v2 owns the model/tool loop.
- **Batch I:** Kernel v2 owns task, replay, approval, and mutation state.
- **Batch J:** legacy runtime path retires behind a hard parity gate.

Do not implement H/I/J in one pull request unless the user explicitly requests a large migration. These are designed as separate checkpoints.

## 1. Shared Non-Goals

The following are still out of scope through Batch J:

- Build mode as a default Obsidian user mode
- Wiki/RAG/MCP/background agent/multi-agent expansion
- new provider SDKs inside the kernel
- remote sandbox or cloud task execution
- Daily Board redesign as a standalone app
- changing release versioning as part of kernel migration
- weakening A-F Harness or eval assertions to make migration easier

The short-term product remains an Obsidian-native knowledge work agent.

## 2. Cross-Batch Maturity Gates

Each batch must keep these gates passing:

```bash
npm run lint
npm test
git diff --check
```

Each batch must also run the relevant Kernel/Harness commands:

```bash
node --test tests/agent-kernel-contracts.test.mjs
node --test tests/agent-kernel-execution-context.test.mjs
node --test tests/agent-kernel-facade.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
```

By the end of Batch J, add and keep these boundary checks:

- `src/core/agent-kernel/**` does not import `AgentRuntimeService`.
- production UI does not call `AgentRuntimeService.runTurn` directly.
- `AgentRuntimeService` no longer owns model loop control.
- `AgentRuntimeService` no longer owns active task state.
- all agent-facing file mutation paths go through Kernel-owned mutation ports or Kernel-compatible adapters.

## 3. Batch H Overview: Move The Model Loop

**Batch H goal:** Move prompt/native model loop ownership from `AgentRuntimeService` into Kernel v2 while preserving existing behavior.

After Batch H, Kernel v2 should own:

- max iteration loop
- model request and response events
- native tool call protocol loop
- prompt-envelope fallback loop if still supported
- retryable transport failure policy
- native-to-prompt compatibility fallback policy
- final-answer extraction
- model request history repair through `ToolBoundaryFilter`
- context package handoff to model requests

After Batch H, `AgentRuntimeService` may still own Obsidian-specific capabilities and vault IO adapters, but it must not own the top-level model/tool loop.

## 4. Batch H Target Shape

Before Batch H:

```text
AgentKernel
  -> RuntimeTurnExecutorPort
    -> LegacyAgentRuntimeAdapter
      -> AgentRuntimeService.runTurn
        -> runTurnNative / runTurnPrompt
```

After Batch H:

```text
AgentKernel
  -> AgentLoopController
    -> ContextEnginePort
    -> ModelDriverPort
    -> ToolGatewayPort
    -> FailureClassifier
    -> EventSink
  -> ObsidianRuntimePorts
    -> vault IO, settings, approvals, skill loading, memory, project boundaries
```

`LegacyAgentRuntimeAdapter` may remain only for compatibility tests or fallback during the batch. It should no longer be the default executor once Batch H is accepted.

## 5. Batch H New Components

Recommended files:

- Create: `src/core/agent-kernel/AgentLoopController.ts`
- Create: `src/core/agent-kernel/AgentLoopTypes.ts`
- Create: `src/core/agent-kernel/ModelDriverPort.ts`
- Create: `src/core/agent-kernel/ToolExecutionPort.ts`
- Create: `src/core/agent-kernel/ContextEnginePort.ts`
- Create: `src/core/agent-kernel/RuntimeProtocol.ts`
- Create: `src/services/AIServiceModelDriverAdapter.ts`
- Create: `src/services/ObsidianKernelRuntimePorts.ts`
- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `src/main.ts`

Recommended tests:

- Create: `tests/agent-kernel-model-loop.test.mjs`
- Create: `tests/agent-kernel-model-driver-adapter.test.mjs`
- Create: `tests/agent-kernel-tool-loop-regression.test.mjs`
- Extend: `tests/agent-runtime-harness-e2e.test.mjs`
- Extend: `tests/agent-eval-runner.test.mjs`

## 6. Batch H Implementation Tasks

### H1: Write Failing Loop Ownership Tests

**Files:**

- Create: `tests/agent-kernel-model-loop.test.mjs`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. Assert `AgentKernel` can execute a turn using a fake `ModelDriverPort`.
2. Assert the fake model receives a repaired message history.
3. Assert `model_request`, `model_response`, `tool_call`, `tool_result`, and terminal events are emitted by Kernel.
4. Assert `AgentRuntimeService.runTurnNative` and `runTurnPrompt` are not required for the Kernel loop test.
5. Run the targeted test and confirm it fails before implementation.

### H2: Add ModelDriverPort

**Files:**

- Create: `src/core/agent-kernel/ModelDriverPort.ts`
- Create: `src/services/AIServiceModelDriverAdapter.ts`
- Create: `tests/agent-kernel-model-driver-adapter.test.mjs`

**ModelDriverPort minimum shape:**

- `requestText(input)`
- `requestWithTools(input)`
- supports `modelOverride`
- supports `signal`
- returns assistant text, reasoning content, and native tool calls
- normalizes provider errors into errors that `AgentFailureClassifier` can classify

**Acceptance:**

- adapter preserves `reasoningContent`
- adapter forwards abort signal
- adapter does not retry stream requests silently
- adapter keeps existing AIService transport policy intact

### H3: Add ContextEnginePort Bridge

**Files:**

- Create: `src/core/agent-kernel/ContextEnginePort.ts`
- Modify: `src/core/context/PromptContextEngine.ts` only if needed
- Create or extend: `tests/prompt-context-engine.test.mjs`

**Steps:**

1. Define a kernel-facing context request shape.
2. Wrap existing `PromptContextEngine` so Kernel gets a compact context package.
3. Preserve token budget diagnostics and trimmed channel reporting.
4. Ensure no raw oversized dynamic context leaks into final model request.

### H4: Add ToolExecutionPort Bridge

**Files:**

- Create: `src/core/agent-kernel/ToolExecutionPort.ts`
- Modify: `src/core/tools/ToolGateway.ts` only if necessary
- Create: `tests/agent-kernel-tool-loop-regression.test.mjs`

**Steps:**

1. Define a Kernel tool execution request.
2. Bridge to existing `ToolGateway`, `CapabilityPolicy`, and native tool handlers.
3. Preserve approval behavior and denial traces.
4. Preserve `use_skill` reinjection behavior.
5. Ensure debug/developer-only exec policy still holds.

### H5: Implement AgentLoopController

**Files:**

- Create: `src/core/agent-kernel/AgentLoopController.ts`
- Create: `src/core/agent-kernel/RuntimeProtocol.ts`
- Modify: `src/core/agent-kernel/AgentKernel.ts`
- Modify: `tests/agent-kernel-model-loop.test.mjs`

**Steps:**

1. Move max iteration loop semantics into `AgentLoopController`.
2. Support native tool calls.
3. Support prompt envelope tool calls if prompt mode is still enabled.
4. Emit Kernel events for every model and tool step.
5. Keep final answer extraction deterministic.
6. Treat max iterations as a typed `max_iterations` failure or safe-stop status, matching existing user-facing behavior.

### H6: Wire Kernel Default Executor To The New Loop

**Files:**

- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: `src/services/LegacyAgentRuntimeAdapter.ts`
- Modify: `tests/agent-kernel-facade.test.mjs`

**Steps:**

1. Instantiate model/context/tool ports in `main.ts`.
2. Instantiate `AgentLoopController`.
3. Use it as the default Kernel executor.
4. Keep `LegacyAgentRuntimeAdapter` available only as a temporary fallback if the plan explicitly allows it.
5. Add a test proving the default path is Kernel loop, not legacy runTurn.

### H7: Migrate Fallback And Error Policy

**Files:**

- Modify: `src/core/agent-kernel/AgentFailureClassifier.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Extend: `tests/agent-kernel-model-loop.test.mjs`
- Extend: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. Preserve current rule: retryable native transport failure must not fallback to prompt mode.
2. Preserve current rule: native protocol incompatibility may fallback to prompt mode once if configured.
3. Represent fallback as an event.
4. Represent failure as typed `AgentFailure`.
5. Keep final reply honest when fallback happened.

### H8: Harness And Eval Parity

**Files:**

- Extend: `tests/agent-runtime-harness-e2e.test.mjs`
- Extend: `tests/evals/agent-scenarios.json` only if behavior changes
- Extend: `tests/agent-eval-runner.test.mjs`

**Steps:**

1. Run all existing A-F scenarios through the Kernel loop.
2. If the helper still calls legacy runtime directly, route helper through facade/kernel path.
3. Do not remove existing assertions.
4. Add a scenario only if Kernel loop changes externally visible behavior.

### H9: Batch H Documentation And Commit

**Files:**

- Modify: this plan if implementation deviates
- Modify: `docs/plans/agent-eval-quality-gates.md` only if scenarios change

**Verification:**

```bash
node --test tests/agent-kernel-model-loop.test.mjs
node --test tests/agent-kernel-model-driver-adapter.test.mjs
node --test tests/agent-kernel-tool-loop-regression.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "feat: move agent model loop into kernel v2"
```

## 7. Batch H Acceptance Criteria

Batch H is accepted only if:

- Kernel v2 owns the model/tool iteration loop.
- `AgentRuntimeService.runTurnNative` and `runTurnPrompt` are no longer the default production loop.
- model request/response/tool events are Kernel events.
- retryable transport failure policy is preserved.
- prompt fallback behavior is explicit, typed, and tested.
- all A-F harness/eval tests pass without weakened assertions.
- `npm run lint`, `npm test`, and `git diff --check` pass.

## 8. Batch I Overview: Move Task, Replay, Approval, And Mutation Ownership

**Batch I goal:** Make Kernel v2 the producer of task state, replay timeline, approval waits, and mutation state transitions.

After Batch I, Kernel should own:

- task creation and lifecycle transitions
- task cancellation, retry, and continue semantics
- replay event emission and terminal state
- approval wait/resolution events
- mutation plan creation, pending state, apply/reject/conflict transitions
- final result status derived from task/event/mutation state

After Batch I, `AgentRuntimeService` should no longer keep active task state. It may remain an Obsidian-facing adapter for vault IO, settings, workbench state, and UI action methods.

## 9. Batch I Target Shape

Before Batch I:

```text
AgentRuntimeService
  -> activeTaskId
  -> activeTaskAbortController
  -> AgentTaskStore
  -> TurnEventLog
  -> MutationPlanStore
  -> WorkbenchStateStore edit plans
```

After Batch I:

```text
AgentKernel
  -> AgentExecutionContext
  -> AgentTaskManager
  -> AgentReplayRecorder
  -> AgentMutationCoordinator
  -> HumanApprovalPort
  -> AgentResumeController

Obsidian adapters
  -> persist task/event/mutation state
  -> render state in Daily Board
  -> apply approved file changes through vault IO
```

The UI should read state from facade methods. It should not decide runtime truth from chat text.

## 10. Batch I New Components

Recommended files:

- Create: `src/core/agent-kernel/AgentTaskManager.ts`
- Create: `src/core/agent-kernel/AgentReplayRecorder.ts`
- Create: `src/core/agent-kernel/AgentMutationCoordinator.ts`
- Create: `src/core/agent-kernel/AgentResumeController.ts`
- Create: `src/core/agent-kernel/HumanApprovalPort.ts`
- Create: `src/services/ObsidianAgentStateAdapter.ts`
- Modify: `src/core/tasks/AgentTask.ts`
- Modify: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/views/agentTaskPanelActions.ts`
- Modify: `src/views/DailyBoardView.ts` only for adapter calls, not UI redesign

Recommended tests:

- Create: `tests/agent-kernel-task-manager.test.mjs`
- Create: `tests/agent-kernel-replay-recorder.test.mjs`
- Create: `tests/agent-kernel-mutation-coordinator.test.mjs`
- Create: `tests/agent-kernel-resume-controller.test.mjs`
- Extend: `tests/agent-task-lifecycle.test.mjs`
- Extend: `tests/agent-runtime-mutation-review-e2e.test.mjs`
- Extend: `tests/turn-replay-reader.test.mjs`
- Extend: `tests/daily-board-agent-task-ui-regression.test.mjs`

## 11. Batch I Implementation Tasks

### I1: Write Ownership Boundary Tests

**Files:**

- Create: `tests/agent-kernel-task-manager.test.mjs`
- Create: `tests/agent-kernel-replay-recorder.test.mjs`

**Steps:**

1. Assert Kernel creates task lifecycle events without `AgentRuntimeService`.
2. Assert replay events come from Kernel event stream.
3. Assert terminal state is derived from Kernel result status.
4. Assert direct active task fields are not required for the Kernel task path.
5. Run tests and confirm expected failures.

### I2: Add AgentTaskManager

**Files:**

- Create: `src/core/agent-kernel/AgentTaskManager.ts`
- Modify: `src/core/tasks/AgentTask.ts` only if status/action model needs small additions
- Extend: `tests/agent-kernel-task-manager.test.mjs`

**Responsibilities:**

- create task for turn
- mark running
- mark waiting for approval
- mark waiting for user
- mark failed
- mark cancelled
- mark completed
- derive available actions
- redact sensitive text before persistence

**Rules:**

- no UI dependency
- no direct vault IO
- no string-only terminal inference

### I3: Add AgentReplayRecorder

**Files:**

- Create: `src/core/agent-kernel/AgentReplayRecorder.ts`
- Extend: `tests/agent-kernel-replay-recorder.test.mjs`
- Extend: `tests/turn-replay-reader.test.mjs`

**Responsibilities:**

- receive `AgentTurnEvent`
- convert Kernel events into persisted replay records
- preserve sequence order
- mark gaps and late terminal events as replay diagnostics
- redact sensitive payloads before persistence

**Acceptance:**

- replay reader can summarize Kernel-produced events
- task timeline appears in replay summary
- cancelled, failed, safe-stopped, approval, mutation states are distinguishable

### I4: Add HumanApprovalPort

**Files:**

- Create: `src/core/agent-kernel/HumanApprovalPort.ts`
- Modify: existing approval adapter/service only as needed
- Create or extend: `tests/agent-kernel-task-manager.test.mjs`

**Responsibilities:**

- request approval for risky tools
- request approval for mutation apply/reject if needed
- represent approval as `waiting_for_approval`
- resume task after approval
- fail or cancel task after denial

**Important:**

- approval is not a UI modal concept inside Kernel
- approval is a state transition and event
- UI decides how to ask, Kernel decides what state means

### I5: Add AgentMutationCoordinator

**Files:**

- Create: `src/core/agent-kernel/AgentMutationCoordinator.ts`
- Extend: `tests/agent-kernel-mutation-coordinator.test.mjs`
- Extend: `tests/agent-runtime-mutation-review-e2e.test.mjs`

**Responsibilities:**

- convert model/tool write intent into `MutationPlan`
- save pending plan through port/adapter
- keep review-first default
- apply approved plan
- reject pending plan
- detect conflict on external file edit
- emit mutation events
- update associated task state

**Rules:**

- no direct bypass of review-first file writes
- folder delete remains strict
- auto-approved mode must still be governed and tested

### I6: Add AgentResumeController

**Files:**

- Create: `src/core/agent-kernel/AgentResumeController.ts`
- Create: `tests/agent-kernel-resume-controller.test.mjs`
- Extend: `tests/agent-task-lifecycle.test.mjs`

**Responsibilities:**

- retry failed task from recorded kernel input
- continue waiting task with user-provided input
- cancel running or waiting task
- preserve relationship fields such as `retryOfTaskId` and `continueFromTaskId`
- avoid re-applying already applied mutation plans

**Acceptance:**

- retry uses prior input plus current context policy
- continue includes user continuation text
- retry/continue produce new task IDs
- completed/cancelled tasks remain terminal

### I7: Move Active Task State Out Of AgentRuntimeService

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/ObsidianAgentStateAdapter.ts`
- Extend: boundary tests

**Steps:**

1. Identify `activeTaskId`, `activeTaskAbortController`, `taskAbortControllers`, and task lifecycle helper usage.
2. Move ownership to Kernel task/resume components.
3. Keep public service methods as adapter shims if UI still calls them.
4. Add static or focused tests proving the runtime service no longer owns active task state for the default path.

### I8: UI Adapter Compatibility

**Files:**

- Modify: `src/views/agentTaskPanelActions.ts`
- Modify only if necessary: `src/views/DailyBoardView.ts`
- Extend: `tests/daily-board-agent-task-ui-regression.test.mjs`

**Steps:**

1. Keep visible task panel behavior stable.
2. Route retry/cancel/continue/apply/reject through facade/kernel APIs.
3. Do not redesign UI in this batch.
4. Ensure task hydration reads Kernel-owned state.

### I9: Batch I Verification And Commit

**Commands:**

```bash
node --test tests/agent-kernel-task-manager.test.mjs
node --test tests/agent-kernel-replay-recorder.test.mjs
node --test tests/agent-kernel-mutation-coordinator.test.mjs
node --test tests/agent-kernel-resume-controller.test.mjs
node --test tests/agent-task-lifecycle.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
node --test tests/turn-replay-reader.test.mjs
node --test tests/daily-board-agent-task-ui-regression.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "feat: move agent state ownership into kernel v2"
```

## 12. Batch I Acceptance Criteria

Batch I is accepted only if:

- Kernel owns task lifecycle transitions for default agent turns.
- Kernel owns replay event emission for default agent turns.
- Kernel owns mutation plan state transitions.
- approval waits are Kernel states, not UI-only prompts.
- retry/continue/cancel operate through Kernel/facade APIs.
- `AgentRuntimeService` no longer keeps active task state for the default path.
- Daily Board task UI remains behaviorally stable.
- A-F/H harness and eval gates still pass.

## 13. Batch J Overview: Legacy Runtime Retirement Gate

**Batch J goal:** Retire the old runtime path safely after Kernel v2 owns execution loop and agent state.

Batch J is not a refactor-for-cleanliness batch. It is a removal gate.

It should only delete or shrink old runtime code after the team can prove:

- Kernel path has behavior parity for supported Obsidian workflows.
- no production caller depends on legacy loop ownership.
- legacy-only tests have been migrated or intentionally deleted.
- all agent-facing behaviors are covered by Kernel/Harness/eval tests.

## 14. Batch J Target Shape

After Batch J:

```text
AgentRuntimeService
  -> no model loop ownership
  -> no active task ownership
  -> no mutation review ownership
  -> no replay ownership
  -> may remain as Obsidian service adapter, settings bridge, or deprecated shell

AgentKernel
  -> owns supported agent execution
  -> owns lifecycle semantics
  -> owns event stream semantics
  -> owns mutation state semantics
```

If `AgentRuntimeService` remains, its name should no longer imply it is the runtime engine. A later rename may be appropriate, such as `ObsidianAgentRuntimeAdapter` or split services by responsibility.

## 15. Batch J New Checks And Tools

Recommended files:

- Create: `tests/agent-kernel-legacy-retirement.test.mjs`
- Create: `docs/plans/agent-kernel-v2-retirement-checklist.md`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Modify: old tests that assume legacy runtime ownership

Static checks should assert:

- no default production path calls `AgentRuntimeService.runTurn`
- no `runTurnNative` default path remains
- no `runTurnPrompt` default path remains
- no direct task lifecycle ownership remains in `AgentRuntimeService`
- no direct mutation plan ownership remains in `AgentRuntimeService`
- all Kernel APIs are reachable through facade

## 16. Batch J Implementation Tasks

### J1: Inventory Legacy Runtime Responsibilities

**Files:**

- Create: `docs/plans/agent-kernel-v2-retirement-checklist.md`
- Create: `tests/agent-kernel-legacy-retirement.test.mjs`

**Steps:**

1. List every remaining responsibility inside `AgentRuntimeService`.
2. Classify each item:
   - delete now
   - move to Kernel
   - move to Obsidian adapter
   - keep temporarily with explicit reason
3. Add static tests for responsibilities that must not return.

### J2: Remove Legacy Loop Entry Points

**Files:**

- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/main.ts`
- Modify: `src/types/plugin.ts`
- Extend: `tests/agent-kernel-legacy-retirement.test.mjs`

**Steps:**

1. Remove or privatize legacy loop methods if no longer needed.
2. If methods must stay temporarily, mark them deprecated and ensure no default production caller uses them.
3. Make facade route only to Kernel v2.
4. Run static boundary tests.

### J3: Split Obsidian Adapter Responsibilities

**Files:**

- Create or extend: `src/services/ObsidianKernelRuntimePorts.ts`
- Create or extend: `src/services/ObsidianAgentStateAdapter.ts`
- Modify: `src/services/AgentRuntimeService.ts`

**Steps:**

1. Move vault IO helpers into adapter modules.
2. Move settings/project boundary access into adapter modules.
3. Move skill/memory/wiki disabled gates into capability adapters where appropriate.
4. Keep service files below a maintainable size target.

Recommended target:

- `AgentRuntimeService.ts` should stop being a 3000+ line core service.
- If still large, every remaining section needs a named retirement reason in the checklist.

### J4: Remove Legacy-Only Tests Or Convert Them

**Files:**

- Modify tests that directly assert legacy service internals
- Extend Kernel/Harness tests with equivalent product behavior assertions

**Steps:**

1. For each legacy test, decide whether it protects product behavior or implementation detail.
2. Convert product behavior tests to Kernel/facade path.
3. Delete implementation detail tests only if Kernel boundary tests replace the risk.
4. Do not reduce eval scenario coverage.

### J5: Product Parity Gate

**Files:**

- Extend: `tests/evals/agent-scenarios.json` only if gaps are found
- Extend: `docs/plans/agent-eval-quality-gates.md` if scenarios change
- Extend: `tests/agent-eval-runner.test.mjs`

**Required parity areas:**

- ask/research/read behavior
- grep/read evidence behavior
- missing file failure
- write/edit/delete review-first behavior
- reject/apply/conflict behavior
- organize/review mode behavior
- debug exec allowlist behavior
- normal exec hidden behavior
- retryable transport failure behavior
- context compaction behavior
- dirty tool history repair
- max iteration safe stop
- task lifecycle UI state

### J6: Delete Or Rename Legacy Runtime Shell

**Files:**

- Modify or move: `src/services/AgentRuntimeService.ts`
- Modify imports throughout `src/`
- Extend static boundary tests

**Options:**

- If the file still holds useful Obsidian adapters, rename/split it.
- If the file is no longer needed, delete it.
- If deletion is too risky, keep a small deprecated shell with no execution ownership.

Do not choose the shell option without documenting why.

### J7: Final Verification And Commit

**Commands:**

```bash
node --test tests/agent-kernel-legacy-retirement.test.mjs
node --test tests/agent-kernel-model-loop.test.mjs
node --test tests/agent-kernel-task-manager.test.mjs
node --test tests/agent-kernel-replay-recorder.test.mjs
node --test tests/agent-kernel-mutation-coordinator.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm run lint
npm test
git diff --check
```

**Commit:**

```bash
git add src tests docs
git commit -m "refactor: retire legacy agent runtime path"
```

## 17. Batch J Acceptance Criteria

Batch J is accepted only if:

- Kernel v2 is the only default agent execution path.
- legacy runtime loop is deleted, renamed, or explicitly deprecated with no default callers.
- static boundary tests prevent reintroducing legacy ownership.
- all product parity scenarios pass.
- task/replay/mutation state remains recoverable.
- release-facing Obsidian plugin behavior remains stable.
- `npm run lint`, `npm test`, and `git diff --check` pass.

## 18. Final Product State After J

After J, FRIDAY is not automatically equal to Codex or Manus as a product. It should, however, have the same class of execution foundation:

- Kernel-owned execution loop
- structured event stream
- task lifecycle as product state
- review-first file mutation
- typed failure and recovery semantics
- deterministic Harness and eval gates
- UI-independent replayable trajectory

That is the point where it becomes reasonable to build a richer Agent workbench UI similar in maturity to Codex or Manus, adapted to Obsidian rather than copied from coding-agent products.

## 19. Recommended Order

Do not start Batch H until Batch G is reviewed and committed.

Recommended sequence:

1. Implement and verify Batch G.
2. Run a focused architecture review on Kernel contracts and ports.
3. Implement Batch H.
4. Run full A-F/G/H eval gates.
5. Implement Batch I.
6. Run product workflow review in Obsidian.
7. Implement Batch J only after the legacy ownership inventory is clear.

## 20. Stop Conditions

Stop the migration and ask for direction if any of these happen:

- Kernel contracts require UI imports.
- Harness coverage has to be weakened to pass.
- model loop migration changes user-visible behavior without an explicit eval update.
- retry/continue cannot preserve existing task semantics.
- mutation review can be bypassed by a default tool path.
- `AgentRuntimeService` keeps growing during H/I instead of shrinking.
