# Agent Harness And Product Maturity Implementation Plan

> Kernel v2 design source of truth: `docs/plans/2026-04-30-agent-kernel-v2-design-charter.md`.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Agent Harness and maturity roadmap that moves FRIDAY from a promising Obsidian Agent runtime to a reliable, testable, reviewable, product-grade Obsidian-native Knowledge Work Agent.

**Architecture:** Treat Harness as the control shell around Agent execution, not merely a test helper. First make runtime behavior scriptable and observable, then consolidate tools, policy, event logging, mutation review, context management, evals, and task lifecycle around that shell.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner (`node --test`), esbuild, existing FRIDAY runtime services under `src/services`, `src/core`, `src/platform`, and test files under `tests/*.mjs`.

---

## 0. What This Plan Solves

The earlier Agent Kernel plan covers tool registration, event logging, permissions, file mutation review, context management, and fake-model tests. That plan is still useful as low-level implementation detail, but it is too focused on kernel refactoring. It does not fully connect Harness, mature product behavior, and final release gates into one route.

This plan fills three gaps:

1. Define what Harness means for FRIDAY.
2. Separate Kernel maturity from Product maturity.
3. Provide phases, files, tests, and acceptance criteria from the current codebase to a mature Obsidian Agent product.

This plan is not trying to turn FRIDAY into a full Codex, Manus, opencode, or Hermes clone immediately. The goal is to borrow mature Agent runtime structure from them and make FRIDAY mature enough to reliably complete multi-turn Obsidian knowledge work.

The product boundary is now explicit:

- FRIDAY is an Obsidian-native Knowledge Work Agent in the short term, not a general-purpose Coding Agent.
- Core work means understanding the current note and vault, cross-file search, summarize/compare, rewrite/organize, links/tags/frontmatter, daily/project notes, draft generation, note split/merge, task extraction, and reviewable vault mutations.
- Build, test, LSP, and terminal-first loops are not default capabilities for normal users.
- If general Coding Agent capability naturally emerges later, accept it as upside, but it must not drive the short-term v2 Kernel and Harness design.

## 1. Current Diagnosis

FRIDAY already has the shape of an Agent runtime:

- `src/views/DailyBoardView.ts` owns UI input and invocation.
- `src/core/execution/InvocationResolver.ts` resolves plain prompts, slash commands, and skill calls.
- `src/core/execution/ExecutionPlanner.ts` performs lightweight execution planning.
- `src/core/execution/ExecutionOrchestrator.ts` assembles context and calls the runtime.
- `src/services/AgentRuntimeService.ts` runs model loops, tool calls, fallback, trace, and final result shaping.
- `src/platform/tools/ToolManifestCatalog.ts` stores part of the tool manifest surface.
- `src/core/context/ContextAssembler.ts` assembles and trims context.
- `src/core/execution/ExecutionGate.ts` checks runtime and capability switches.
- `tests/*.mjs` contains many regression tests, but many still assert source strings rather than real Agent behavior.

The problem is not that FRIDAY has no Agent. The problem is that the Agent does not yet have the hard boundaries a mature runtime needs:

- Tool protocol has no single source of truth.
- Model turns cannot be fully replayed.
- File mutations do not yet follow a standard plan-review-apply path.
- Tests cannot reliably simulate multi-step Agent behavior.
- Failure and recovery are not yet product-grade experiences.
- Context management and tool-message boundaries are not strict enough.

## 2. Harness Definition

Harness is not just `tests/helpers/fakeAgentRuntime.mjs`.

Harness should be FRIDAY Agent's controllable execution shell. It has two layers.

### 2.1 Runtime Harness

Runtime Harness is the observable, reviewable, recoverable execution boundary around the production runtime.

It should:

- Assign `turnId` and `taskId` to each Agent turn.
- Record model requests, model responses, tool requests, tool results, approvals, and final replies.
- Route tool calls through registry, policy, and gateway.
- Convert write actions into mutation plans.
- Expose runtime state to the UI.

### 2.2 Test Harness

Test Harness is the scriptable substitute for Runtime Harness.

It should:

- Use a fake model to simulate model responses.
- Use a fake vault to simulate Obsidian files.
- Use fake approval to simulate allow, deny, timeout, and cancel.
- Use scripted scenarios to verify complete turns.
- Return event logs, traces, pending mutations, and final assistant output for assertions.

A mature Agent product needs both layers. Test Harness without Runtime Harness means tests may look clean while production remains uncontrolled. Runtime Harness without Test Harness means the architecture may look mature while nobody can prove it stays stable.

## 3. Target Architecture

```text
User input
  |
  v
DailyBoardView
  |
  v
InvocationResolver
  |
  v
ExecutionPlanner
  |
  v
ExecutionOrchestrator
  |
  v
AgentRuntimeFacade
  |
  v
Agent Kernel v2 + Harness
  |
  +--> ModelDriver
  |      +--> AIService driver
  |      +--> Scripted fake driver
  |
  +--> ToolRegistry
  |      +--> prompt schemas
  |      +--> native tool definitions
  |      +--> manifest metadata
  |      +--> dispatch metadata
  |
  +--> CapabilityPolicy
  |      +--> read/write/delete/external risk
  |      +--> exec only in debug/developer profile
  |      +--> auto approval rules
  |      +--> project scope rules
  |
  +--> ToolGateway
  |      +--> approval
  |      +--> execution
  |      +--> result normalization
  |
  +--> MutationPlanner
  |      +--> pending write/edit/delete plans
  |      +--> apply/reject
  |
  +--> TurnEventLog
         +--> replay
         +--> debug
         +--> E2E assertions
```

Do not turn the old `AgentRuntimeService` into an even larger service. Build Kernel v2 and Harness boundaries beside it, then migrate risky runtime responsibilities out incrementally; every migration step must be protected by Harness scenarios and evals.

## 4. Maturity Levels

### Level 0: Current State

Agent can call tools, handle prompt/native modes, use approvals, and emit traces. Protocols are dispersed, tests are mostly static, and product recovery is weak.

### Level 1: Testable Agent

Fake-model E2E Harness exists. One-turn and multi-turn Agent behavior can be reproduced.

Done means:

- Model tool calls can be scripted.
- Final answers can be scripted.
- Tool-call order can be asserted.
- Trace and event log can be asserted.
- Tool success and failure are covered.

### Level 2: Governed Agent

Tools, permission, risk level, and execution entrypoint are unified.

Done means:

- `ToolRegistry` is the only source of tool definitions.
- `CapabilityPolicy` is the only source of capability decisions.
- `exec` is allowlisted only in the debug/developer profile.
- Normal Obsidian modes do not expose exec/build/LSP.
- Wiki/RAG/MCP remain gated.

### Level 3: Reviewable Agent

All high-risk file mutations are reviewable by default.

Done means:

- `write`, `edit`, and `delete` create pending mutation plans by default.
- UI supports Apply / Reject.
- Event log records plan, apply, and reject.
- Auto apply requires explicit opt-in.

### Level 4: Recoverable Agent

Agent failures are explainable, turns are replayable, and state can be recovered.

Done means:

- Every runtime turn has a JSONL event log.
- A replay reader exists.
- Task lifecycle exists.
- Failure state is visible to users.

### Level 5: Product Mature Agent

FRIDAY has mature product behavior, not only a stable kernel.

Done means:

- Users can see task state.
- Users can understand failure reasons.
- Users can retry, cancel, and continue.
- Important file changes have reviewable diffs or clear mutation summaries.
- A fixed eval suite protects core capabilities.

## 5. Not In Scope For This Roadmap

Do not implement these in this roadmap:

- Wiki general availability.
- RAG.
- MCP marketplace.
- Multi-agent collaboration.
- Background cron / background Agent.
- Long-running autonomous Agent.
- Cloud sync or remote execution.
- Large UI redesign.

Reason: each item amplifies risk from the current runtime gaps. Stabilize Harness and Kernel before enabling complex add-ons.

## 6. Recommended Execution Order

Use 8 phases:

```text
Phase 0  Freeze and baseline
Phase 1  Agent Test Harness
Phase 2  Tool Registry
Phase 3  Capability Policy and Tool Gateway
Phase 4  Turn Event Log and Replay
Phase 5  Mutation Plan Review
Phase 6  Context and Tool Boundary
Phase 7  Eval Suite and Quality Gates
Phase 8  Product Task Lifecycle
```

Key correction from the earlier kernel-only plan: move Harness to Phase 1. Do not wait until all runtime refactors are finished before building Harness.

Product correction: modes and evals must be Obsidian-first. Do not add a default Build mode. Coding-adjacent tools belong only in the debug/developer profile.

FRIDAY v2 modes:

- `ask`: answer questions about the current note or vault with traceable evidence.
- `research`: search, compare, and summarize across files with sources and uncertainty.
- `write`: generate or rewrite note content, but writes must become mutation plans first.
- `organize`: manage links, tags, frontmatter, daily notes, project notes, and task lists.
- `review`: inspect note structure, duplicates, broken links, missing sources, and missing action items.
- `debug`: developer-only mode that may enable allowlisted exec and runtime diagnostic tools.

## 7. Phase 0: Freeze Add-On Surface

### Goal

Make it explicit that FRIDAY will not expand Agent-facing feature surface until the Agent Kernel is mature.

### Files

- Create: `docs/plans/agent-kernel-maturity-gates.md`
- Modify: `CHANGELOG.md`
- Check: `src/constants/wikiFeature.ts`

### Tasks

1. Write the maturity-gate document.
2. State that Wiki, RAG, MCP, background Agent, and multi-agent work are paused.
3. Record the engineering direction change in the changelog.
4. Keep `WIKI_FEATURE_ENABLED=false`.

### Acceptance

- Users do not see immature Wiki capability in UI or Agent prompt.
- New tools cannot bypass maturity gates into Agent prompt.
- Documentation explains why Kernel/Harness work comes first.

## 8. Phase 1: Agent Test Harness

### Goal

Make Agent input-to-output behavior scriptable, reproducible, and assertable. Build the test shell before refactoring the kernel.

### Files

- Create: `tests/helpers/fakeAgentRuntime.mjs`
- Create: `tests/helpers/scriptedModelDriver.mjs`
- Create: `tests/helpers/fakeVault.mjs`
- Create: `tests/agent-runtime-harness-e2e.test.mjs`
- Modify only if necessary: `src/services/AgentRuntimeService.ts`

### Design

Test Harness input:

```js
{
  files: {
    "Project/workspace/a.md": "alpha"
  },
  settings: {
    agentRuntime: {
      toolCallingMode: "native",
      toolRuntimeEnabled: true
    }
  },
  modelSteps: [
    { tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
    { assistant: "The file says alpha." }
  ],
  approvals: ["allow"]
}
```

Test Harness output:

```js
{
  assistantText: "The file says alpha.",
  traces: [],
  events: [],
  pendingMutations: [],
  files: {}
}
```

### Required Scenarios

1. read -> final answer.
2. grep -> read -> final answer.
3. tool failure -> final answer reports failure.
4. permission denied -> no file change.
5. max tool iterations -> safe stop.
6. native mode success.
7. prompt mode success.
8. native incompatible -> prompt fallback.
9. retryable transport failure -> no prompt fallback.
10. malformed model JSON -> parse error event.
11. research mode: grep/search -> read multiple notes -> sourced synthesis.
12. organize mode: propose link/tag/frontmatter changes as pending mutation plans.

### First Test Command

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
```

Expected:

- New tests drive `AgentRuntimeService.runTurn()` through complete turns.
- If current runtime cannot inject a fake model, add the smallest injection point needed.

### Implementation Guidance

Prefer testing the current public surface. Only introduce a thin interface if `AgentRuntimeService` is blocked by a concrete `AIService` dependency.

Possible minimal interface:

- Create: `src/core/runtime/ModelDriver.ts`
- Modify: `src/services/AgentRuntimeService.ts`

Keep it thin:

```ts
export interface ModelDriver {
  chat(messages: unknown[], options: unknown): Promise<string>;
  chatWithTools(messages: unknown[], tools: unknown[], options: unknown): Promise<unknown>;
}
```

Do not introduce a large `AgentKernel` abstraction in Phase 1. Get Harness running first.

### Acceptance

- At least 12 E2E scenarios pass.
- Every scenario can assert assistant text, tool traces, and events.
- Failures identify the specific model step, tool step, or runtime boundary.

## 9. Phase 2: Tool Registry

### Goal

Make tool definitions a single source of truth and remove prompt/native/manifest/dispatch drift.

### Files

- Create: `src/core/tools/ToolRegistry.ts`
- Modify: `src/platform/tools/ToolManifestCatalog.ts`
- Modify: `src/core/context/PromptContextEngine.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/tool-registry.test.mjs`
- Test: `tests/native-tool-registry-regression.test.mjs`

### Registry Fields

- tool name
- description
- JSON schema
- native tool schema
- risk level
- capability
- read/write/delete/external category
- debug/developer-only exec category
- gated feature flag
- handler name
- prompt exposure rules

### Data Flow

```text
ToolRegistry
  |
  +--> prompt tool instructions
  +--> native tool definitions
  +--> manifest catalog
  +--> capability policy
  +--> dispatch lookup
```

### Acceptance

- Tool lists are not handwritten in multiple places.
- `compile_wiki` is controlled by a feature gate.
- `exec` cannot bypass policy because of prompt drift.
- Tests compare registry, native definitions, and manifest output.

## 10. Phase 3: Capability Policy And Tool Gateway

### Goal

Move tool preflight decisions into policy and gateway instead of scattering them through runtime branches.

### Files

- Create: `src/core/policy/CapabilityPolicy.ts`
- Create: `src/core/tools/ToolGateway.ts`
- Modify: `src/core/execution/ExecutionGate.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/CommandExecService.ts`
- Test: `tests/capability-policy.test.mjs`
- Test: `tests/tool-gateway.test.mjs`
- Test: `tests/exec-profile-policy.test.mjs`

### Policy Decision

```ts
type CapabilityDecision =
  | { allow: true; approval: "none" | "standard" | "strict"; reason: string }
  | { allow: false; code: string; reason: string };
```

### Exec Policy

Default policy:

- `ask` / `research` / `write` / `organize` / `review` do not expose exec.
- `debug` / `developer` profiles may enable allowlisted exec.

debug/developer allowlist:

- `npm test`
- `git status`
- `git diff`
- `rg`

Reject:

- shell chaining
- any command not on the allowlist
- `cwd` outside workspace
- download-and-execute flows
- deletion commands

### Acceptance

- All tool execution passes through `ToolGateway`.
- All high-risk actions pass through `CapabilityPolicy`.
- exec risk changes from blocklist-first to debug-profile allowlist.
- exec is not present in the tool surface for ask/research/write/organize/review.
- denied results enter trace and event log.

## 11. Phase 4: Turn Event Log And Replay

### Goal

Make every Agent turn traceable, replayable, and diagnosable.

### Files

- Create: `src/core/runtime/TurnEventLog.ts`
- Create: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/RuntimeStateStore.ts`
- Test: `tests/turn-event-log.test.mjs`
- Test: `tests/turn-replay-reader.test.mjs`
- Extend: `tests/agent-runtime-harness-e2e.test.mjs`

### Event Types

- `turn_started`
- `context_built`
- `model_requested`
- `model_completed`
- `model_failed`
- `tool_requested`
- `tool_policy_checked`
- `tool_approval_requested`
- `tool_approved`
- `tool_denied`
- `tool_completed`
- `tool_failed`
- `mutation_planned`
- `mutation_applied`
- `mutation_rejected`
- `assistant_final`
- `turn_failed`

### Storage Location

Recommended:

```text
.friday/runtime/
  conversations/
    <conversationId>/
      turns/
        <turnId>.jsonl
```

If the project already has runtime state path helpers, prefer reusing `RuntimeStateStore` instead of creating a separate hidden directory system.

### Replay Reader

The first replay reader does not need to resume execution. It only needs to:

- read a turn
- validate event order
- output a summary
- support test assertions

### Acceptance

- Any Harness E2E can assert event log output.
- Failed turns still write `turn_failed`.
- Event log avoids full sensitive payloads by using summaries and redaction.

## 12. Phase 5: Mutation Plan Review

### Goal

Change file write, edit, and delete from direct execution to plan first, review second, apply third.

### Files

- Create: `src/core/mutations/MutationPlan.ts`
- Create: `src/core/mutations/MutationPlanStore.ts`
- Create: `src/core/mutations/MutationApplier.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/AgentActionService.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/types/settings.ts`
- Test: `tests/mutation-plan.test.mjs`
- Test: `tests/mutation-applier.test.mjs`
- Test: `tests/agent-runtime-mutation-review-e2e.test.mjs`

### Settings

Add:

```ts
fileMutationMode: "review" | "autoApproved";
```

Default:

```ts
fileMutationMode: "review";
```

### Mutation Plan Fields

- id
- turnId
- conversationId
- toolCallId
- operation: write/edit/delete
- target path
- before snapshot hash
- proposed content or patch
- risk level
- summary
- status: pending/applied/rejected/conflicted

### UI Behavior

`DailyBoardView` should show:

- file path
- operation type
- summary
- Apply
- Reject
- conflict state

The first version does not need complex diff UI. It must show clear path, operation, and summary. Diff review can come second.

### Acceptance

- In default review mode, Agent tools do not write directly to disk.
- Apply performs the real write.
- Reject leaves files unchanged.
- before-snapshot mismatch becomes `conflicted`.
- event log records plan/apply/reject/conflict.

## 13. Phase 6: Context And Tool Boundary

### Goal

Organize context by token budget and keep tool-message boundaries legal so history does not poison model requests.

### Files

- Create: `src/core/context/TokenBudget.ts`
- Create: `src/core/context/ToolBoundaryFilter.ts`
- Modify: `src/core/context/ContextAssembler.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/token-budget.test.mjs`
- Test: `tests/tool-boundary-filter.test.mjs`
- Test: `tests/context-assembler-token-budget.test.mjs`

### TokenBudget First Version

Start with an approximate tokenizer to avoid pulling in heavy dependencies too early:

```ts
export interface TokenCounter {
  count(text: string): number;
}
```

First approximation:

- English: around 4 characters per token.
- Chinese: around 1.5 to 2 characters per token.
- Later phase can replace this with a real tokenizer.

### ToolBoundaryFilter Must Handle

- tool result without matching tool call
- missing assistant tool call
- duplicate tool result
- mismatched tool call id
- orphaned tool messages after history compaction

### Acceptance

- `ContextAssembler` no longer relies only on `text.length`.
- Oversized tool results are summarized or marked as trimmed.
- Messages sent to the model are always structurally valid.
- Harness covers dirty-history scenarios.

## 14. Phase 7: Eval Suite And Quality Gates

### Goal

Create a fixed evaluation suite so runtime changes do not quietly regress Agent capability.

### Files

- Create: `tests/evals/agent-scenarios.json`
- Create: `tests/agent-eval-runner.test.mjs`
- Extend: `tests/helpers/fakeAgentRuntime.mjs`
- Create: `docs/plans/agent-eval-quality-gates.md`

### Eval Scenarios

First 14:

1. Read one file and cite evidence.
2. grep then read the matched file.
3. Explain clearly when a file is missing.
4. Create a mutation plan for a write request.
5. Keep files unchanged when the user rejects mutation.
6. Mark edit conflict as `conflicted`.
7. Require strict approval for delete.
8. In organize mode, create a daily/project note organization plan.
9. In review mode, detect duplicates, structure problems, broken links, or missing sources.
10. In debug profile, allow `npm test` through the exec allowlist.
11. In normal Obsidian modes, keep exec out of the tool surface.
12. Do not fallback to prompt on native retryable transport failure.
13. Trigger compaction for oversized context.
14. Stop safely at tool iteration limit.

### Quality Gate

Every runtime-related PR should run at least:

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
npm test
```

### Acceptance

- Eval runner reports pass/fail and reason for each scenario.
- Failure can be localized to model step, tool step, policy step, or mutation step.
- Eval file can grow without changing the runner.

## 15. Phase 8: Product Task Lifecycle

### Goal

Move Agent from a one-off chat response into a manageable task lifecycle.

### Files

- Create: `src/core/tasks/AgentTask.ts`
- Create: `src/core/tasks/AgentTaskStore.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/views/DailyBoardView.ts`
- Modify: `src/services/ConversationService.ts`
- Test: `tests/agent-task-lifecycle.test.mjs`
- Test: `tests/daily-board-agent-task-ui-regression.test.mjs`

### Task States

```text
created
running
waiting_for_approval
waiting_for_user
failed
cancelled
completed
```

### Minimum UI Shape

Each Agent turn should show:

- current state
- what the Agent is doing
- actions waiting for user confirmation
- failure reason
- available actions: Retry, Cancel, Continue, Apply, Reject

The first version does not need a full project-management UI. It only needs to show where the Agent is blocked and whether it changed files.

### Acceptance

- Failure is not silent.
- Approval waiting state is not rendered as plain chat.
- User can cancel a running task.
- User can retry from failed state.
- event log and task state agree.

## 16. Final Maturity Gates

FRIDAY can reconsider Wiki/RAG/MCP only after all gates pass.

### Kernel Gate

- `ToolRegistry` is the only source of tool definitions.
- `ToolGateway` is the only tool execution entrypoint.
- `CapabilityPolicy` covers every tool.
- exec is allowlisted only in the debug/developer profile.
- `TurnEventLog` covers all runtime branches.
- Mutation review is enabled by default.

### Harness Gate

- Fake-model E2E covers prompt/native/fallback/error/review.
- E2E covers the five Obsidian-first modes: ask/research/write/organize/review.
- Eval suite has at least 14 core scenarios.
- All runtime PRs run eval.
- Tests no longer rely primarily on source-string checks.

### Product Gate

- Users can see task state.
- Users can review file changes.
- Users can understand failure reasons.
- Users can retry, cancel, and continue.
- Product copy does not expose immature features.

Only after all gates pass should the next stage begin:

- Wiki general availability.
- RAG.
- MCP.
- background Agent.
- multi-agent.

## 17. Risks And Mitigations

### Risk 1: Refactor Scope Is Too Large

Mitigation:

- Harness first.
- Merge each phase independently.
- Avoid a large rewrite.
- Preserve existing runtime behavior in every phase.

### Risk 2: ToolRegistry Becomes Over-Abstracted

Mitigation:

- Only model fields current tools need.
- Do not prebuild a complex plugin system for future MCP.
- Use registry only to fix current definition drift.

### Risk 3: Mutation Review Slows The Experience

Mitigation:

- Default to review.
- Provide explicit `autoApproved`.
- Apply only to write/edit/delete.
- Do not add confirmation to read-only tools.

### Risk 4: Event Log Stores Sensitive Content

Mitigation:

- Summarize model inputs and outputs.
- Do not write full file content to logs by default.
- Record hash, path, and summary.
- Use snapshots or the vault file itself when full content is required.

### Risk 5: Eval Becomes Maintenance Burden

Mitigation:

- Keep scenarios data-driven.
- Keep runner stable.
- Each eval verifies one key behavior.
- Use scripted fake model instead of real model output.

## 18. Execution Batches

### Batch A: Harness First

Tasks:

1. Add fake runtime harness.
2. Add scripted model driver.
3. Add fake vault.
4. Add 12 E2E scenarios covering basic tool flow and Obsidian-first modes.

Verification:

```powershell
node --test tests/agent-runtime-harness-e2e.test.mjs
```

### Batch B: Governed Tools

Tasks:

1. Add ToolRegistry.
2. Migrate manifest/native/prompt schemas.
3. Add CapabilityPolicy.
4. Add ToolGateway.
5. Convert exec to a debug/developer profile allowlist and keep it hidden from normal Obsidian modes.

Verification:

```powershell
node --test tests/tool-registry.test.mjs
node --test tests/capability-policy.test.mjs
node --test tests/tool-gateway.test.mjs
node --test tests/exec-profile-policy.test.mjs
```

### Batch C: Replayable Runtime

Tasks:

1. Add TurnEventLog.
2. Add TurnReplayReader.
3. Write runtime events.
4. Assert event order in Harness.

Verification:

```powershell
node --test tests/turn-event-log.test.mjs
node --test tests/turn-replay-reader.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
```

### Batch D: Reviewable Mutations

Tasks:

1. Add MutationPlan.
2. Add MutationPlanStore.
3. Add MutationApplier.
4. Add UI Apply / Reject.

Verification:

```powershell
node --test tests/mutation-plan.test.mjs
node --test tests/mutation-applier.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
```

### Batch E: Context And Eval

Tasks:

1. Add TokenBudget.
2. Add ToolBoundaryFilter.
3. Add eval scenarios.
4. Add eval runner.

Verification:

```powershell
node --test tests/token-budget.test.mjs
node --test tests/tool-boundary-filter.test.mjs
node --test tests/agent-eval-runner.test.mjs
```

### Batch F: Product Task Lifecycle

Tasks:

1. Add AgentTask.
2. Add AgentTaskStore.
3. Add UI state presentation.
4. Add Retry / Cancel / Continue.

Verification:

```powershell
node --test tests/agent-task-lifecycle.test.mjs
node --test tests/daily-board-agent-task-ui-regression.test.mjs
npm test
```

## 19. How To Judge Product Alignment

If FRIDAY completes only Batch A through Batch E:

- It can claim alignment with mature Obsidian Agent framework foundations.
- It cannot yet claim alignment with mature Obsidian Agent products.

If FRIDAY completes Batch F and passes all final gates:

- It can claim a minimum mature Obsidian-native Knowledge Work Agent product shape.
- It is still not a full Codex, Manus, opencode, or Hermes equivalent, because those products also include remote sandboxes, terminal/server-first loops, long-running task orchestration, multi-agent workflows, broad tool ecosystems, and large-scale evals.

Most accurate target statement:

> FRIDAY should become a reliable Obsidian-native Knowledge Work Agent with mature runtime primitives, not a clone of Codex, Manus, opencode, or Hermes.

## 20. Next Step Recommendation

Start with Batch A immediately. Do not start with ToolRegistry.

Reasons:

- Harness is the safety net for all later runtime changes.
- Current `AgentRuntimeService` is already complex, so registry/policy refactors without Harness are risky.
- Scripted fake model proves whether every change breaks real Agent turns.

The first PR should only cover:

- `tests/helpers/fakeAgentRuntime.mjs`
- `tests/helpers/scriptedModelDriver.mjs`
- `tests/helpers/fakeVault.mjs`
- `tests/agent-runtime-harness-e2e.test.mjs`
- the smallest necessary injection point in `AgentRuntimeService`, if required.

The success criterion of that PR is not new user-facing capability. It is giving FRIDAY a reliable regression shell for Agent behavior for the first time.
