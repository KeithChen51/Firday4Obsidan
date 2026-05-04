# Agent Kernel v2 Legacy Runtime Retirement Checklist

English counterpart: this file.
Chinese counterpart: `docs/plans/agent-kernel-v2-retirement-checklist.zh.md`.

## Scope

Batch J is a retirement gate, not a feature batch. The goal is to prove that Kernel v2 is the default Agent execution path and that legacy runtime code remains only as an explicit compatibility shell.

## Default execution path

The default path is:

```text
UI command or Daily Board action
  -> ExecutionOrchestrator
  -> AgentRuntimeFacade
  -> AgentKernel
  -> AgentLoopController
  -> ObsidianKernelRuntimePorts
  -> ObsidianAgentStateAdapter
```

The default path must not instantiate `LegacyAgentRuntimeAdapter` and must not call `AgentRuntimeService.runTurn`.

## Identity gate

The default path must preserve the same Kernel `AgentExecutionContext` identity through task, replay, approval, resume, mutation, model, and tool events:

- `taskId`
- `traceId`
- `budget`

The gate is enforced by `tests/agent-kernel-v2-default-path.test.mjs`.

## Allowed legacy runtime references

| File | Status | Reason |
| --- | --- | --- |
| `src/services/AgentRuntimeService.ts` | allowed temporarily | Obsidian adapter shell for vault IO, settings, tool handlers, mutation apply IO, and UI compatibility facades. It is marked `LEGACY_RUNTIME_RETIREMENT_ALLOWED` and must not be the default whole-turn engine. |
| `src/services/LegacyAgentRuntimeAdapter.ts` | allowed temporarily | Migration shim for explicit legacy fallback or compatibility tests only. It is marked `LEGACY_RUNTIME_RETIREMENT_ALLOWED`. |
| `tests/**` | allowed | Boundary tests may mention legacy runtime names to prevent default-path regressions. |
| `docs/**` | allowed | Documentation must explain why any legacy shell remains. |

Any new production reference to `LegacyAgentRuntimeAdapter` or direct default-path call to `AgentRuntimeService.runTurn` fails the retirement gate.

## Not allowed after Batch J

- `src/core/agent-kernel/**` importing or naming `AgentRuntimeService`.
- `src/main.ts` wiring `LegacyAgentRuntimeAdapter`.
- `ExecutionOrchestrator` depending on `AgentRuntimeService`.
- production UI directly calling `AgentRuntimeService.runTurn`.
- bypassing Kernel-owned mutation, replay, task, or approval boundaries in the default path.

## Remaining legacy responsibility inventory

| Responsibility | Current location | Retirement decision |
| --- | --- | --- |
| model/tool loop ownership | `AgentLoopController` | moved to Kernel v2; legacy methods may remain only for non-default compatibility. |
| task lifecycle | `AgentTaskManager` through `ObsidianAgentStateAdapter` | moved to Kernel v2. |
| replay recording | `AgentReplayRecorder` through `ObsidianAgentStateAdapter` | moved to Kernel v2. |
| approval state | `AgentTaskManager` / `HumanApprovalPort` boundary | moved to Kernel v2. |
| mutation planning and review events | `AgentMutationCoordinator` through `ObsidianAgentStateAdapter` | moved to Kernel v2. |
| vault IO and tool handlers | `AgentRuntimeService` adapter shell | keep temporarily until split into smaller Obsidian adapter services. |
| settings/project boundary access | `AgentRuntimeService` and `ObsidianKernelRuntimePorts` | keep as adapter responsibility. |
| UI compatibility methods | `AgentRuntimeService` | keep temporarily as facade methods for existing UI calls. |

## Required tests

```bash
npm run lint
npm test
node --test tests/agent-kernel-legacy-retirement.test.mjs
node --test tests/agent-kernel-v2-default-path.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
git diff --check
git status --short --branch
```

## Acceptance rule

Batch J is accepted only if the static retirement gate and product parity tests pass without weakening harness or eval coverage.
