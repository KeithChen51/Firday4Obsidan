# FRIDAY Agent Kernel v2 Design Charter

> Chinese counterpart: `docs/plans/2026-04-30-agent-kernel-v2-design-charter.zh.md`.
> This file is the design charter for Kernel v2. Read it before `2026-04-30-agent-harness-product-maturity.md`.

## 0. Conclusion

FRIDAY should build a new Agent Kernel v2 instead of continuing to heavily modify the existing `AgentRuntimeService`.

Kernel v2 should not clone Codex, Manus, opencode, Hermes, or obsidian-yolo. It should extract the mature engineering boundaries from those systems and turn them into an Obsidian-appropriate Agent execution kernel.

Definition:

> Agent Kernel v2 is a UI-independent, model-independent, tool-governed, event-replayable, reviewable, testable task execution kernel.

Product north star:

> FRIDAY is an Obsidian-native Knowledge Work Agent in the short term, not a general-purpose Coding Agent.

Kernel v2 must first serve multi-turn Obsidian work: understand the vault, understand the current note, search across files, summarize, compare, rewrite, organize, maintain links/tags/frontmatter/daily notes/project notes, draft content, split and merge notes, extract tasks, suggest next steps, and produce reviewable plans for vault file changes.

If Kernel v2 eventually enables some Coding Agent capabilities as a byproduct, that is an architectural bonus, not the short-term product goal. FRIDAY should not sacrifice Obsidian clarity, safety, or user experience to become a generic Coding Agent.

It should become the foundation for future Wiki, RAG, MCP, background Agent, and multi-agent features, not a container where all of those features are immediately mixed together.

## 1. Why Not Keep Fixing The Legacy Runtime

The current `src/services/AgentRuntimeService.ts` owns too many responsibilities:

- model requests
- prompt-mode tool loop
- native-tool loop
- fallback decisions
- tool definitions
- tool dispatch
- approvals
- file IO
- exec
- memory
- Wiki context
- trace
- progress events
- context assembly
- tool result formatting

This is not a single bad function. It is a boundary problem. Continuing to patch it will institutionalize the legacy structure.

Correct strategy:

```text
Legacy AgentRuntimeService
  |
  | keep as compatibility shell / temporary fallback
  v
Agent Kernel v2
  |
  +-- contract-first execution
  +-- state machine
  +-- event log
  +-- tool governance
  +-- mutation review
  +-- harness-driven tests
```

The legacy runtime can remain temporarily, but it should become an adapter or legacy fallback. The execution core should move to `src/core/agent-kernel/`.

## 2. How To Use Reference Projects

Reference projects are not templates. They are evidence for mature boundaries.

The questions are:

- Which responsibilities do they separate?
- How do they handle tools, permissions, context, failures, sessions, and task state?
- Which designs fit an Obsidian plugin?
- Which designs are too heavy for Kernel v2 MVP?

## 3. Reference Matrix

### 3.1 Codex

Reference focus:

- Task execution is a verifiable workflow, not a one-off chat reply.
- File changes go through patch / diff / review / apply.
- Results should be supported by evidence. In Obsidian workflows, evidence means note references, paths, excerpts, mutation summaries, and review results, not default build/test output.
- Final replies should report what changed, what was verified, and what could not be done.

Borrow:

- plan -> execute -> verify -> report workflow
- review-first file mutation
- result evidence
- no completion claim based only on model text

Do not borrow now:

- remote sandbox
- full IDE-grade coding workflow
- Build/test as the default execution loop
- complete multi-file patch UI complexity
- cloud task orchestration

Kernel v2 implications:

- `MutationPlan` is a first-class object.
- verification/tool events enter event log.
- `AgentTurnResult` includes events, mutations, status, and failure, not only assistant text.

### 3.2 Manus

Reference focus:

- Agent tasks have long-lived status.
- Users can see what the Agent is doing.
- Users can tell when the Agent waits for confirmation, fails, or completes.
- A task is a lifecycle, not just one LLM call.

Borrow:

- `AgentTask`
- task statuses: created, running, waiting_for_approval, waiting_for_user, failed, cancelled, completed
- user-visible progress
- retry / cancel / continue

Do not borrow now:

- browser automation
- cloud long-running execution environment
- complex multi-agent scheduling
- broad external tool ecosystem

Kernel v2 implications:

- Kernel v2 drives `AgentTask` state changes.
- `DailyBoardView` should show task state instead of encoding state as chat text.

### 3.3 obsidian-yolo

Local source:

- `.tmp/obsidian-yolo/src/core/agent/tool-gateway.ts`
- `.tmp/obsidian-yolo/src/core/mcp/localFileTools.ts`
- `.tmp/obsidian-yolo/src/core/agent/compaction.ts`
- `.tmp/obsidian-yolo/utils/chat/tool-boundary.ts`
- `.tmp/obsidian-yolo/utils/chat/tool-context-pruning.ts`

Reference focus:

- `AgentToolGateway` unifies tool status, approval, running state, rejection, and workspace scope.
- local file tools separate list/search/read/edit/delete/move.
- `fs_edit` uses review and snapshots.
- multiple edits to the same file can be grouped to avoid stale line-number failures.
- context compaction continues with a high-signal summary.
- tool boundary and tool context pruning prevent dirty tool messages from poisoning model requests.

Borrow:

- ToolGateway
- workspace scope
- file edit review snapshot
- context compact boundary
- tool message boundary filter
- pruning oversized tool results

Do not borrow now:

- MCP-first tool architecture
- enabling web search, RAG, skills, and memory all at once
- exposing a broad local file action surface in MVP

Kernel v2 implications:

- `ToolGateway` is the only tool execution entrypoint.
- `MutationPlanner` handles write/edit/delete.
- `ContextManager` handles compact/prune/boundary repair.
- `ToolCallStatus` distinguishes pending_approval, running, success, error, rejected, and aborted.

### 3.4 Hermes Agent

Local source:

- `.tmp/hermes-agent/agent/context_engine.py`
- `.tmp/hermes-agent/agent/error_classifier.py`
- `.tmp/hermes-agent/agent/trajectory.py`
- `.tmp/hermes-agent/acp_adapter/permissions.py`
- `.tmp/hermes-agent/gateway/`
- `.tmp/hermes-agent/agent/*adapter.py`

Reference focus:

- Context is an engine with lifecycle, token usage, thresholds, and session boundaries.
- Errors are taxonomy-driven, not scattered string matching.
- Trajectories can be saved for debug, eval, and training.
- Permission bridge has explicit approval options: allow once, allow always, deny.
- gateway/channel is separate from agent execution.
- model providers are adapters.

Borrow:

- `ContextEngine`
- `ErrorClassifier`
- `TurnTrajectory` / `TurnEventLog`
- `HumanApprovalPort`
- `ModelDriver`
- channel/session separated from kernel

Do not borrow now:

- Telegram/Discord/Slack/WhatsApp gateway
- cron scheduler
- remote terminal backend
- autonomous skill creation
- self-improving memory loop
- batch trajectory generation for training

Kernel v2 implications:

- classify errors before deciding retry, fallback, compress, deny, or abort.
- context is a session-aware engine, not a string helper.
- trajectory/event log is a primary output, not a debug side effect.

### 3.5 Open Agent SDK TypeScript

Local source:

- `.tmp/open-agent-sdk-typescript/src/agent.ts`
- `.tmp/open-agent-sdk-typescript/src/engine.ts`
- `.tmp/open-agent-sdk-typescript/src/types.ts`
- `.tmp/open-agent-sdk-typescript/src/session.ts`

Reference focus:

- high-level `Agent` API is separated from lower-level `QueryEngine`.
- tool definitions use `ToolDefinition`, `ToolContext`, and `ToolResult`.
- query emits streaming events.
- sessions can be saved, resumed, and forked.
- permissions can be injected through `CanUseToolFn`.
- tools can be filtered by allowed/disallowed lists.

Borrow:

- high-level facade / low-level engine split
- contract-first types
- session persistence
- streaming event model
- tool definition shape
- permission callback hook

Do not borrow now:

- direct dependency on one provider SDK inside the kernel
- default permission bypass
- MCP/subagent/cron as Kernel MVP
- Node CLI storage paths

Kernel v2 implications:

- `AgentKernel` is the low-level engine.
- `AgentRuntimeFacade` or adapter connects existing FRIDAY UI to the kernel.
- `AgentTurnEvent` is streamable.
- `AgentSessionStore` supports resume/fork inside FRIDAY project state.

### 3.6 opencode

Reference focus:

- Agent core should behave like a server/kernel driven by multiple frontends, not logic tied to a TUI or one UI.
- session, message, task, diff, revert, abort, and permission response should be API/facade capabilities.
- Plan/Build-style modes are capability profiles, not just prompt styles.
- permission can be configured by tool, path, agent mode, and session override.
- MCP is an external tool-extension layer, not the core runtime.

Borrow:

- kernel/service API thinking
- session/task as first-class objects
- frontend/kernel separation
- permission profiles
- product-level diff/revert awareness

Do not borrow now:

- terminal-first product shape
- coding-first default tools
- LSP-first architecture
- Build mode as a default Obsidian user mode
- full server/OpenAPI exposure

Kernel v2 implications:

- `AgentRuntimeFacade` should provide internal APIs such as createTask, sendPrompt, abortTask, getEvents, applyMutation, rejectMutation, and revertTurn.
- modes should be defined around FRIDAY's Obsidian workflows instead of copying coding-agent Build/Plan semantics.

### 3.7 Current FRIDAY

Keep:

- Obsidian plugin lifecycle.
- `DailyBoardView` as the user entrypoint.
- `InvocationResolver` and slash/skill routing experience.
- `ExecutionOrchestrator` as the likely call site.
- `WorkspaceAccessService` / project boundary.
- `ToolApprovalService` experience.
- existing tools: read, list, grep, glob, write, edit, delete, memory.
- exec is developer/debug-profile only, not part of the default Obsidian workflow surface.
- settings, conversation, and project workspace infrastructure.

Do not inherit:

- mixed responsibilities in `AgentRuntimeService`.
- separate prompt/native tool protocols.
- tool schemas handwritten in multiple places.
- rough character-based context trimming.
- regex/string-matching fallback as the main reliability mechanism.
- direct file mutation from tool calls.

## 4. Target Shape

Target file structure:

```text
src/core/agent-kernel/
  contracts/
    AgentTurn.ts
    AgentTask.ts
    AgentEvent.ts
    ToolContract.ts
    MutationContract.ts
    ErrorContract.ts

  kernel/
    AgentKernel.ts
    AgentTurnStateMachine.ts
    AgentLoopController.ts

  model/
    ModelDriver.ts
    ModelRequestBuilder.ts
    ModelResponseNormalizer.ts

  context/
    ContextEngine.ts
    TokenBudget.ts
    ContextPackage.ts
    ToolBoundaryFilter.ts
    ContextCompactor.ts

  tools/
    ToolRegistry.ts
    ToolGateway.ts
    ToolResultNormalizer.ts

  policy/
    CapabilityPolicy.ts
    WorkspaceScopePolicy.ts
    ExecPolicy.ts              # developer/debug profile only

  mutations/
    MutationPlanner.ts
    MutationPlanStore.ts
    MutationApplier.ts

  events/
    TurnEventLog.ts
    TurnReplayReader.ts
    TrajectoryExporter.ts

  tasks/
    AgentTaskStore.ts
    AgentTaskLifecycle.ts

  harness/
    ScriptedModelDriver.ts
    FakeVault.ts
    FakeApprovalPort.ts
    KernelScenarioRunner.ts
```

Notes:

- `contracts/` is the first and most important step.
- `kernel/` owns execution state machine and loop control only.
- `model/` hides OpenAI, Anthropic, and compatible gateway differences.
- `context/` owns budget, compaction, references, and boundaries.
- `tools/` owns registration and execution entry.
- `policy/` owns permission and risk decisions.
- `mutations/` owns file change planning and application.
- `events/` owns observability, replay, and eval.
- `tasks/` owns product task lifecycle.
- `harness/` drives tests; it is not production logic.

## 5. Core Contracts

### 5.1 AgentTurnInput

```ts
export interface AgentTurnInput {
  taskId: string;
  turnId: string;
  conversationId: string;
  userPrompt: string;
  messages: AgentMessage[];
  invocation: AgentInvocation;
  workspace: WorkspaceRef;
  model: ModelSelection;
  agentMode: "ask" | "research" | "write" | "organize" | "review" | "debug";
  allowedTools?: string[];
  mode: "auto" | "native" | "prompt";
  signal?: AbortSignal;
}
```

Must include:

- task id
- turn id
- conversation id
- original user prompt
- normalized messages
- workspace reference
- model selection
- Obsidian work mode
- tool restrictions
- abort signal

Must not include:

- DOM objects
- Obsidian view instances
- broad settings objects
- concrete provider clients

### 5.2 AgentTurnResult

```ts
export interface AgentTurnResult {
  taskId: string;
  turnId: string;
  status: "completed" | "failed" | "cancelled" | "waiting_for_approval";
  assistantText: string;
  events: AgentTurnEvent[];
  toolCalls: ToolCallRecord[];
  pendingMutations: MutationPlan[];
  usage?: ModelUsage;
  failure?: AgentFailure;
}
```

`assistantText` is only one output. A mature result includes status, events, tool calls, pending mutations, usage, and failure.

### 5.3 AgentTurnEvent

```ts
export type AgentTurnEvent =
  | { type: "turn_started"; turnId: string; taskId: string; at: string }
  | { type: "context_built"; summary: ContextSummary; at: string }
  | { type: "model_requested"; requestId: string; model: string; at: string }
  | { type: "model_completed"; requestId: string; usage?: ModelUsage; at: string }
  | { type: "model_failed"; requestId: string; failure: AgentFailure; at: string }
  | { type: "tool_requested"; call: ToolCallRequest; at: string }
  | { type: "tool_policy_checked"; callId: string; decision: CapabilityDecision; at: string }
  | { type: "tool_approval_requested"; callId: string; approvalId: string; at: string }
  | { type: "tool_completed"; callId: string; result: ToolResultSummary; at: string }
  | { type: "tool_failed"; callId: string; failure: AgentFailure; at: string }
  | { type: "mutation_planned"; plan: MutationPlanSummary; at: string }
  | { type: "assistant_final"; text: string; at: string }
  | { type: "turn_failed"; failure: AgentFailure; at: string };
```

Events are the factual record. UI, Harness, Replay, and Eval all read events.

### 5.4 AgentFailure

```ts
export interface AgentFailure {
  code: string;
  category:
    | "model"
    | "tool"
    | "permission"
    | "context"
    | "mutation"
    | "workspace"
    | "cancelled"
    | "internal";
  retryable: boolean;
  userMessage: string;
  technicalMessage?: string;
  cause?: unknown;
}
```

Failure is not a string. It must have category, retryable, and userMessage.

## 6. State Machine

Kernel v2 should be a state machine first and a loop second.

```text
created
  |
  v
context_building
  |
  v
model_requesting
  |
  v
model_responded
  |
  +--> assistant_final -> completed
  |
  +--> tool_requested
          |
          v
       policy_checking
          |
          +--> denied -> model_requesting or failed
          |
          v
       approval_checking
          |
          +--> waiting_for_approval
          |       |
          |       +--> approved -> tool_executing
          |       +--> rejected -> model_requesting or failed
          |
          v
       tool_executing
          |
          +--> tool_completed -> model_requesting
          +--> tool_failed -> model_requesting or failed

Any state
  +--> cancelled
  +--> failed
```

Rules:

- State transitions are explicit.
- Every transition emits an event.
- waiting states are not rendered as normal assistant text.
- max iterations are state-machine rules, not scattered loop checks.

## 7. Tool Call Path

Mature path:

```text
ModelResponse
  |
  v
ModelResponseNormalizer
  |
  v
ToolCallRequest
  |
  v
ToolRegistry.lookup()
  |
  v
CapabilityPolicy.evaluate()
  |
  v
HumanApprovalPort.requestIfNeeded()
  |
  v
ToolGateway.execute()
  |
  v
ToolResultNormalizer
  |
  v
TurnEventLog.append()
  |
  v
Model input for next step
```

Not allowed:

- model tool names directly entering a `switch`
- prompt/native maintaining separate tool definitions
- policy only checking invocation but not actual tool calls
- arbitrary tool result objects being sent back to the model

## 8. File Mutation Path

Mature path:

```text
write/edit/delete tool call
  |
  v
MutationPlanner.createPlan()
  |
  v
MutationPlanStore.savePending()
  |
  v
TurnEventLog.mutation_planned
  |
  v
UI shows Apply / Reject
  |
  +--> Apply -> MutationApplier.apply() -> mutation_applied
  +--> Reject -> mutation_rejected
  +--> Conflict -> mutation_conflicted
```

Defaults:

- `write/edit/delete` do not write directly.
- `fileMutationMode="review"`.
- auto apply must be explicitly enabled.
- delete is always high risk.

## 9. ContextEngine

Kernel v2 context must not be simple string concatenation.

Target interface:

```ts
export interface ContextEngine {
  build(input: ContextBuildInput): Promise<ContextPackage>;
  updateFromModelUsage(usage: ModelUsage): void;
  shouldCompact(state: ContextState): boolean;
  compact(state: ContextState): Promise<ContextPackage>;
  repairToolBoundaries(messages: AgentMessage[]): AgentMessage[];
}
```

Must record:

- source of every context segment
- token budget
- trim state
- trim reason
- compact summary
- tool boundary repair

Hermes reference:

- context engine has session lifecycle
- token usage comes from model responses
- compression threshold belongs to the engine

obsidian-yolo reference:

- compact summary preserves current goal, constraints, completed work, failures, and next step
- compaction boundary must not break tool message structure

## 10. ErrorClassifier

Do not rely on scattered regex checks.

Kernel v2 should have:

```ts
export interface ErrorClassifier {
  classify(error: unknown, context: ErrorContext): AgentFailure;
}
```

Categories:

- auth
- billing
- rate_limit
- provider_overloaded
- timeout
- context_overflow
- payload_too_large
- model_not_found
- format_error
- tool_error
- permission_denied
- workspace_denied
- mutation_conflict
- cancelled
- unknown

Each class maps to one of:

- retry
- fallback model
- compress context
- ask user
- abort
- deny

Hermes is valuable for taxonomy. FRIDAY does not need its provider-specific details, but it does need a centralized classifier.

## 11. HumanApprovalPort

Approval must be a protocol, not a UI side effect.

```ts
export interface HumanApprovalPort {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export type ApprovalDecision =
  | { type: "allow_once" }
  | { type: "allow_always"; scope: ApprovalScope }
  | { type: "deny" }
  | { type: "cancel" }
  | { type: "timeout" };
```

Hermes ACP permission bridge reference:

- allow once
- allow always
- deny
- timeout defaults to deny

FRIDAY additions:

- workspace scope
- tool risk
- file path
- command preview
- mutation summary

## 12. ModelDriver

Kernel should not know concrete providers.

```ts
export interface ModelDriver {
  request(input: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
```

`ModelResponse` must normalize:

- assistant text
- tool calls
- usage
- raw provider metadata
- stop reason
- provider error

Open Agent SDK reference:

- high-level Agent and engine split
- query engine emits streaming events

Hermes reference:

- provider adapters
- provider errors go through classifier

FRIDAY v1 needs only:

- `AIServiceModelDriver`
- `ScriptedModelDriver`

## 13. Harness

Harness targets Kernel v2 contracts, not legacy runtime behavior.

Harness scenario shape:

```ts
const scenario = {
  name: "read file then answer",
  files: {
    "Project/workspace/a.md": "alpha"
  },
  modelSteps: [
    { toolCall: { name: "read", args: { path: "Project/workspace/a.md" } } },
    { final: "The file says alpha." }
  ],
  approvals: ["allow_once"],
  expect: {
    finalIncludes: "alpha",
    events: ["turn_started", "model_requested", "tool_requested", "tool_completed", "assistant_final"],
    noFileChanges: true
  }
};
```

Harness must simulate:

- fake model
- fake vault
- fake approval
- fake tool failure
- fake context overflow
- fake cancellation
- fake mutation conflict
- fake exec policy denial

Harness is the acceptance mechanism for Kernel v2, not an optional testing helper.

## 14. UI / Channel Boundary

Kernel v2 does not depend directly on `DailyBoardView`.

Boundary:

```text
DailyBoardView
  |
  v
AgentRuntimeFacade
  |
  v
AgentKernel
```

`DailyBoardView` owns:

- collecting user input
- showing task state
- showing events/progress
- showing pending mutations
- triggering Apply/Reject/Retry/Cancel/Continue

Kernel owns:

- state machine execution
- event production
- task state changes
- structured result

Hermes gateway reference:

- channel is an entrypoint, not the kernel
- the same agent can be reached through different channels

FRIDAY does not need multi-channel support now, but it must keep this boundary clean.

## 15. Kernel v2 MVP

First version includes:

- single task
- single conversation turn loop
- native-style normalized model response
- Obsidian-first modes: ask, research, write, organize, review
- read/list/grep/glob/search_text
- note_create_plan, note_edit_plan, note_split_plan, note_merge_plan
- link_suggest, tag_suggest, frontmatter_update_plan
- task_extract, daily_note_update_plan, project_note_update_plan
- write/edit/delete only through note/file mutation plans, not direct writes
- memory as external tool, not a self-improving loop
- exec disabled by default; only allowlisted in debug/developer profile
- event log
- fake harness
- task states

Not included:

- Wiki
- RAG
- MCP
- multi-agent
- cron
- autonomous skill creation
- remote sandbox
- cloud sync
- build/test/LSP as default Obsidian user capabilities

## 16. Maturity Gates

Kernel v2 is not complete just because it can answer questions.

### Contract Gate

- core types are defined under `contracts/`
- UI, model, tools, and policy do not reference each other's concrete implementations
- legacy runtime is not the source of v2 contracts

### State Machine Gate

- all turn states are explicit
- all transitions are testable
- cancel, failure, and waiting approval are first-class states

### Tool Gate

- tool definitions have a single source
- all tool calls pass through registry/policy/gateway
- tool results are normalized
- prompt/native do not have separate protocols

### Mutation Gate

- write/edit/delete create plans by default
- apply/reject/conflict all emit events
- file snapshot hash prevents stale application

### Context Gate

- token budget is visible
- compaction is testable
- tool boundaries are repairable
- large tool results can be summarized

### Failure Gate

- all failures have category/code/retryable/userMessage
- provider errors are centrally classified
- user cancellation and permission denial are not exception strings

### Harness Gate

- at least 12 scripted scenarios
- cover success, tool failure, permission denial, mutation review, context overflow, cancel, max iteration
- every scenario asserts events and result

### Product Gate

- UI shows running/waiting/failed/completed
- users can retry/cancel/continue
- users can apply/reject mutations
- users understand the capability boundary between ask/research/write/organize/review modes
- final answers report completed work, skipped work, and verification

## 17. Migration Strategy

```text
Step 1: Write Kernel v2 contracts
Step 2: Build Harness against contracts
Step 3: Implement minimal Kernel v2 loop
Step 4: Add read-only tools through ToolGateway
Step 5: Add mutation planning
Step 6: Add event log and replay
Step 7: Add task lifecycle
Step 8: Wire ExecutionOrchestrator to Kernel v2 behind feature flag
Step 9: Run parity/eval suite
Step 10: Deprecate legacy AgentRuntimeService path
```

Feature flag:

```ts
agentRuntime.engine = "legacy" | "kernel_v2";
```

Default migration:

1. development defaults to `kernel_v2`
2. legacy runtime remains as fallback
3. remove fallback after eval passes

## 18. Reference Adoption List

### Must Adopt

- Codex: reviewable file mutation and verification culture
- Manus: task lifecycle and user-visible progress
- obsidian-yolo: ToolGateway, edit review snapshot, compaction boundary
- Hermes: ContextEngine, ErrorClassifier, trajectory, approval protocol
- Open Agent SDK: type contracts, Agent/Engine split, streaming events, session persistence
- opencode: session/task API, permission profile, diff/revert, frontend/kernel separation

### Later

- MCP integration
- subagents
- cron
- remote execution
- coding Build mode
- LSP tools
- advanced memory
- eval trajectory export for training
- multi-channel gateway

### Do Not Adopt

- default permission bypass
- exposing all tools to the model at once
- putting Wiki/RAG/MCP into Kernel MVP
- making build/test/exec default capabilities for normal Obsidian users
- mixing UI state with Kernel state
- treating legacy runtime behavior as correct behavior

## 19. Final Product Shape

FRIDAY should become:

> An Obsidian-native mature Knowledge Work Agent: testable kernel, governed tools, reviewable vault changes, reliable multi-turn knowledge work, visible task state, recoverable failures, and a safe path to future Wiki/RAG/MCP.

Not:

> A large service where chat, tools, memory, Wiki, file mutation, and exec are all mixed together.

Also not:

> A complete clone of Codex, Manus, opencode, or Hermes.

Also not:

> A generic Coding Agent whose default loop is build/test/exec/LSP.

FRIDAY's differentiation should be:

- deep Obsidian integration
- safe vault/project boundaries
- Markdown and knowledge-work friendliness
- local reviewable Agent execution
- maintainability inside a plugin environment

## 20. Next Step

Do not implement the full Kernel immediately.

Next plan should be:

**Kernel v2 Contracts + Harness Foundation Implementation Plan**

Scope only:

- `contracts/`
- `harness/`
- `ScriptedModelDriver`
- `FakeVault`
- `FakeApprovalPort`
- test skeleton for 12 scenarios

After contracts and Harness are stable, implement the real `AgentKernel` loop.
