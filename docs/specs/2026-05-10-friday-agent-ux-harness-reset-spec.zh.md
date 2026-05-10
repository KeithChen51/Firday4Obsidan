# FRIDAY Agent UX Harness Reset Specification

> **For implementation window:** Use `superpowers:executing-plans` or an equivalent task-by-task execution discipline. The coordinating agent may dispatch subagents, but each subagent must own a disjoint write set and must not revert unrelated changes. Subagents should use the same model family and reasoning/intelligence level as the coordinating window unless the user explicitly approves a downgrade.

**Goal:** Rebuild FRIDAY's user-visible agent flow so ordinary Obsidian users can understand when FRIDAY has started, what it is doing, when they must decide, and what was actually delivered.

**Architecture:** Keep the runtime harness responsible for connection state, safety boundaries, mutation coordination, and fallback behavior. Move semantic task-shape decisions to model-authored intake. Keep ordinary UI language product-level and hide raw tool, checkpoint, model request, replay, debug, and permission-system concepts by default.

**Tech Stack:** Obsidian plugin, TypeScript, DOM rendering in `DailyBoardView`, Agent Kernel v2 runtime events, trajectory projector/view model, CSS in `styles.css`, tests via Node test runner and TypeScript build.

---

## Source Of Truth

This spec operationalizes `docs/plans/2026-05-10-friday-agent-ux-reset-record.zh.md`.

Use that document for product intent. Use this spec for development slicing, verification, and audit.

All P0, P1, and P2 changes captured in the reset record are in scope for this implementation. Do not stop after P0 unless the user explicitly narrows scope.

## Product Contract

FRIDAY is not an IDE terminal inside Obsidian. It is a friendly, restrained, non-clingy agent for broad document work: organizing, rewriting, archiving, generating, checking, reviewing, and connecting context.

Target user: ordinary white-collar Obsidian user who does not understand Agentic AI.

The user should only need to understand four things:

- Has FRIDAY started?
- What is FRIDAY doing now?
- Does FRIDAY need a decision from me?
- What did FRIDAY actually deliver?

Everything else is secondary and hidden by default.

## Non-Goals

Do not spend this implementation cycle on:

- context compaction;
- subagent runtime architecture;
- background task system redesign;
- workspace isolation;
- replay/debug UI for ordinary users;
- broad visual redesign of the whole plugin;
- new animation library or large dependency.

Subagents may be used by the coordinating development window as an execution method, but FRIDAY product behavior should not expose subagents to ordinary users in this cycle.

## Current Implementation Map

The implementation window should verify these anchors before editing:

- Local first response:
  - `src/views/DailyBoardView.ts`
  - `aiLocalIntakePreview`
  - `buildLocalIntakePreview`
  - existing copy: `FRIDAY 正在理解你的请求`
- Model-authored intake and plan:
  - `src/core/context/PromptContextEngine.ts`
  - `src/core/agent-kernel/PlanState.ts`
  - `src/core/agent-kernel/RuntimeProtocol.ts`
  - `src/core/agent-kernel/AgentLoopController.ts`
- Runtime heuristic currently competing with the model:
  - `AgentLoopController.buildIntakeDecision`
  - `AgentLoopController.classifyIntakeComplexity`
  - `AgentLoopController.shouldSuppressModelAuthoredProcess`
- Tool approval:
  - `src/services/ToolApprovalService.ts`
  - `src/features/workbench/ApprovalQueue.ts`
  - `DailyBoardView.renderApprovalCard`
  - `DailyBoardView.addApprovalDecisionButton`
- File mutation review:
  - `src/services/tools/ObsidianToolHandlers.ts`
  - `src/services/AgentRuntimeService.ts`
  - `src/services/ObsidianAgentStateAdapter.ts`
  - `src/features/workbench/WorkbenchStateStore.ts`
  - `DailyBoardView.renderEditPlanReviewPanel`
  - `DailyBoardView.renderEditPlanReviewItem`
- User-facing trace summaries:
  - `src/core/tools/ToolResultFormatter.ts`
  - `src/core/trajectory/AgentTrajectoryProjector.ts`
  - `src/views/agentProcessPanelViewModel.ts`
- Process panel rendering:
  - `src/views/agentProcessPanelViewModel.ts`
  - `src/views/agentTrajectoryRenderer.ts`
  - `styles.css`
- Existing regression tests worth preserving:
  - `tests/daily-board-runtime-intake-preview.test.mjs`
  - `tests/agent-kernel-loop.test.mjs`
  - `tests/agent-runtime-mutation-review-e2e.test.mjs`
  - `tests/tool-result-formatter.test.mjs`
  - `tests/agent-process-panel-view-model.test.mjs`
  - `tests/daily-board-agent-trajectory-ui.test.mjs`
  - `tests/agent-process-panel-style-regression.test.mjs`

## Desired User Flow

### Normal Turn

```text
User sends a message
-> UI shows a transient local status: FRIDAY 正在响应……
-> Model request is successfully started
-> UI shows: FRIDAY 正在理解你的请求……
-> Model returns intake
-> UI switches to the route chosen by model intake
-> Runtime executes with safety and mutation constraints
-> Final answer becomes primary content
-> Process panel folds if the task completed
```

### Network Failure Before Model Processing

```text
User sends a message
-> UI shows: FRIDAY 正在响应……
-> Model request cannot start or is exhausted before model intake
-> UI shows: 暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。
-> No fake model-authored understanding appears
```

This failure copy must not imply that the model received, understood, or started the task.

## Intake Contract

### Canonical Routes

The model-facing intake route should use these product-level route names:

- `direct_answer`
- `clarify`
- `light_task`
- `task_with_process`

Implementation may keep legacy internal fields during migration, but UI decisions must be based on the canonical product route.

Recommended compatibility mapping:

```text
direct_answer      -> legacy route answer, complexity simple
clarify            -> legacy route clarify, complexity unclear
light_task         -> legacy route answer or plan_and_execute with shouldShowProcess true and shouldUseVisiblePlan false
task_with_process  -> legacy route plan_and_execute, complexity complex
```

Prefer adding an explicit `interactionRoute` field to `IntakeDecision` rather than breaking every replay/test call site at once. If the implementation chooses to replace `route` outright, update all replay readers, projectors, tests, and fixtures in the same task.

### Model Schema

Update the prompt schema so the model can return:

```json
{
  "type": "response",
  "assistant": "final response for user",
  "intake": {
    "interactionRoute": "direct_answer|clarify|light_task|task_with_process",
    "statement": "我理解你想要……我会……",
    "shouldShowProcess": true,
    "shouldUseVisiblePlan": true
  },
  "plan": {
    "type": "plan_create",
    "visibility": "visible|internal|hidden",
    "tasks": [
      {
        "id": "short-stable-id",
        "title": "user-readable task",
        "status": "pending|in_progress|completed|skipped|failed|blocked"
      }
    ]
  }
}
```

Rules:

- `direct_answer`: no visible process, no visible plan, direct answer only.
- `clarify`: ask one necessary question. Do not create a multi-step plan.
- `light_task`: may show a lightweight running status, but should not create a heavy plan unless needed.
- `task_with_process`: running process panel is visible and expanded; completed process folds afterward.

### Runtime Responsibility

Runtime may:

- validate the intake shape;
- map legacy route names to canonical routes;
- fall back conservatively when intake is missing or invalid;
- block unsafe tool or file actions;
- show connection/retry/failure states;
- preserve replay and trajectory integrity.

Runtime must not:

- use regex heuristics as the primary semantic task classifier;
- suppress a valid model-authored intake merely because runtime heuristics think the prompt is simple;
- fabricate a model understanding before the model returns;
- persist local first response as an assistant message.

### Fallback Behavior

If no valid intake is returned:

- pure final response with no tools: treat as `direct_answer`;
- tool call or mutation exists: treat as `light_task`;
- visible plan exists: treat as `task_with_process`;
- empty or ambiguous response: surface a concise failure or clarification.

## Local Status Contract

### Required User-Facing Copy

- Before model connection starts: `FRIDAY 正在响应……`
- After model request starts: `FRIDAY 正在理解你的请求……`
- Retry/reconnect: `模型连接不稳定，FRIDAY 正在重试。`
- Exhausted before intake: `暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。`
- Pending mutation: `已准备好 {count} 个待应用的文件修改，确认后才会写入 Obsidian。`
- Mutation applied: `已应用修改。`
- Mutation rejected: `已取消，未写入任何文件。`

### Persistence Rules

- Local status rows are transient UI state, not conversation messages.
- Only user messages and model-produced assistant messages are persisted to conversation history.
- A model connection failure may be shown as UI error state, but must not be stored as a fake assistant response.
- A final assistant message with pending mutations must explicitly say the changes are prepared but not applied.

## Approval And Mutation Contract

### User Decision Types

Ordinary users should see only these decisions:

- File changes: `应用修改` / `不应用`
- High-risk non-file action: `允许执行` / `拒绝`
- Scope expansion not clearly requested: ask a natural-language confirmation question.

Do not show these by default:

- `Allow once`
- `Allow session`
- `Allow always`
- `Deny`
- `Tool approval required`
- raw tool names such as `write`, `edit`, `delete`, `exec`

### File Mutation Review

File create/write/edit/delete must go through a single mutation review in standard mode.

Rules:

- `pending_review` means not applied.
- Before user approval, never say `已创建`, `已修改`, or `已删除`.
- Pending mutation review may show a diff or preview, but the copy must use future/pending language.
- `本次改动` must include only actually applied artifacts.
- Rejecting a mutation must not write any file.
- Delete remains high risk, but in ordinary file mutation flow it still uses mutation review, not a second tool approval.

### Composer Approval Surface

Approval is an input-state, not a normal chat artifact.

When FRIDAY is waiting for a user decision, the approval panel must occupy the body of the bottom chat composer:

- The normal text input area is replaced by the approval panel.
- Composer chrome remains visible and usable where appropriate:
  - model selector;
  - permission mode indicator/control;
  - `+Skill`;
  - `@` context control;
  - other existing composer-level controls that do not conflict with the decision.
- The approval panel is the primary focus of the composer.
- File mutation review actions are `应用修改` / `不应用`.
- High-risk non-file approval actions are `允许执行` / `拒绝`.
- After the decision resolves, the composer returns to its normal input state.

The chat transcript and process panel may show that FRIDAY is waiting for a decision, but they should not be the primary approval surface. A transcript card alone is not sufficient.

If queued input remains supported while approval is pending, it must be visually secondary and must not compete with the approval decision.

### High-Risk Tool Approval

Tool approval is reserved for non-file side effects:

- shell execution;
- external network/API action;
- compile/generation action with side effects outside normal file mutation review;
- anything outside the allowed workspace/vault boundary.

The user-facing UI should describe the consequence, not the tool.

Example:

```text
FRIDAY 需要运行一个本地命令来检查结果。

[允许执行] [拒绝]
```

## Process Panel Contract

### Surface By Route

`direct_answer`:

- May show transient thinking/status while waiting.
- Do not keep a process panel after final answer.

`clarify`:

- Show the question as normal assistant content.
- No process panel unless there was a real nontrivial action before clarification.

`light_task`:

- Show a lightweight running state.
- Do not create a heavy multi-step plan by default.
- Completed state should not compete with the final answer.

`task_with_process`:

- Running process panel is expanded by default.
- Current action is visible.
- Tool details are folded.
- Completed process panel collapses after final answer.

Action-required states:

- Waiting for mutation review, user clarification, or high-risk approval remains visible.
- The UI should feel like a decision point, not a debug console.

### Hidden By Default

Do not expose these to ordinary users:

- raw tool calls;
- checkpoint names;
- model request internals;
- raw reasoning;
- runtime event names;
- replay/debug controls;
- raw JSON payloads.

Folded details may exist for diagnostics, but should use product labels and remain secondary.

## Motion Contract

Use quiet Obsidian-native micro-motion only.

Recommended states:

- `FRIDAY 正在响应……`: subtle breathing dot or three-dot rhythm.
- `FRIDAY 正在理解你的请求……`: process row fades in, current status point softly highlights.
- Running action: active timeline marker has subtle pulse.
- Reconnect/retry: warmer slow pulse with clear copy.
- Waiting for approval: one-time attention highlight, then static.
- Completion: short transition to folded completed state.

Implementation constraints:

- Use scoped `friday-*` CSS classes.
- Use Obsidian theme variables.
- Do not hard-code strong brand colors.
- Use `opacity`, `transform`, and restrained `box-shadow`.
- Do not animate layout properties directly.
- Do not add GSAP or another animation dependency.
- Must respect `prefers-reduced-motion`.
- Motion must reflect real runtime state, not fake local progress.

## Development Workstreams

The coordinating window should assign these as separate subagent workstreams with disjoint ownership.

Subagent configuration requirement: each implementation, verification, and audit subagent should inherit or match the coordinating window's model choice and reasoning/intelligence level. If the platform cannot enforce exact parity, the coordinator must state the limitation before dispatch and avoid silently using a weaker model for critical implementation or audit work.

### Workstream A: Intake Contract And Runtime Gating

**Owns:**

- `src/core/agent-kernel/PlanState.ts`
- `src/core/agent-kernel/RuntimeProtocol.ts`
- `src/core/context/PromptContextEngine.ts`
- `src/core/agent-kernel/AgentLoopController.ts`
- focused intake/runtime tests

**Tasks:**

1. Add canonical product route support: `direct_answer`, `clarify`, `light_task`, `task_with_process`.
2. Preserve legacy route compatibility where needed.
3. Update prompt schema and instructions.
4. Make model-authored intake the primary semantic route source.
5. Demote `buildIntakeDecision` / regex classification to fallback only.
6. Update `shouldSuppressModelAuthoredProcess` so it does not suppress valid model-authored intake because of runtime heuristic disagreement.
7. Add regression tests for all four routes.

**Must verify:**

- valid model intake is emitted as `source: "model"`;
- runtime fallback is used only when intake is missing/invalid;
- direct answers do not create visible plans;
- task_with_process creates visible running process.

### Workstream B: Local First Response And Connection Failure UI

**Owns:**

- `src/views/DailyBoardView.ts`
- relevant i18n files if copy keys are moved
- `tests/daily-board-runtime-intake-preview.test.mjs`
- focused DailyBoard UI regression tests

**Tasks:**

1. Change local pre-model status to `FRIDAY 正在响应……`.
2. Show `FRIDAY 正在理解你的请求……` only after model request/runtime execution has actually started.
3. Keep local status transient and non-persistent.
4. Add exhausted-before-intake failure copy.
5. Ensure mention-resolution or local validation failures clear local status cleanly.
6. Ensure cancellation and queued prompts do not leave stale local status.

**Must verify:**

- local status is never pushed into conversation as assistant content;
- network/model-start failure does not show model understanding copy;
- existing queue behavior still works.

### Workstream C: User-Level Approval And Mutation Review

**Owns:**

- `src/views/DailyBoardView.ts` approval and mutation review rendering sections
- `src/services/ToolApprovalService.ts` only if user-facing decision values need adapter support
- `src/features/workbench/ApprovalQueue.ts` only if needed
- `src/core/tools/ToolResultFormatter.ts`
- `src/services/AgentRuntimeService.ts`
- `src/services/ObsidianAgentStateAdapter.ts`
- bottom composer approval-state rendering in `src/views/DailyBoardView.ts`
- mutation review tests

**Tasks:**

1. Replace ordinary approval UI labels with user-level decision copy.
2. Keep internal `allow_once`, `deny`, etc. only as implementation details if cheaper.
3. Ensure file mutations use `应用修改` / `不应用`.
4. Ensure high-risk non-file actions use `允许执行` / `拒绝`.
5. Remove raw tool names from ordinary approval cards.
6. Ensure pending mutation summaries use pending language.
7. Ensure final answer guard appends or enforces “prepared but not applied” when pending mutations exist.
8. Ensure `本次改动` excludes pending mutations.
9. Render pending approvals inside the bottom composer body while preserving composer chrome.
10. Keep any transcript/process waiting state secondary to the composer approval surface.

**Must verify:**

- review-first write/edit/delete create exactly one mutation review;
- no separate tool approval appears for ordinary file mutation review;
- pending review never displays completed language;
- rejection leaves files untouched;
- approval state replaces the composer input body and restores it after resolution;
- model selector, permission mode, `+Skill`, and `@` remain present in approval state.

### Workstream D: Process Panel Surface And Motion

**Owns:**

- `src/views/agentProcessPanelViewModel.ts`
- `src/views/agentTrajectoryRenderer.ts`
- `styles.css`
- process panel view/style tests

**Tasks:**

1. Map process surface behavior to canonical routes.
2. Keep running `task_with_process` expanded by default.
3. Keep completed process collapsed by default.
4. Keep action-required visible.
5. Keep tool trajectory folded by default.
6. Add scoped micro-motion classes and keyframes.
7. Extend reduced-motion CSS to cover new animations.

**Must verify:**

- process panel is hidden or transient for `direct_answer`;
- running task process is expanded;
- completed process is collapsed;
- action-required states remain visible;
- CSS uses scoped classes and reduced-motion override.

### Workstream E: Copy, I18n, And User Language Audit

**Owns:**

- `src/i18n/locales/zh-CN.ts`
- `src/i18n/locales/en-US.ts`
- any user-facing copy call sites touched by A-D
- copy-focused tests or snapshot assertions

**Tasks:**

1. Add stable i18n keys for the required copy.
2. Remove ordinary-surface copy that exposes tool/checkpoint/model request/debug concepts.
3. Ensure Chinese copy is primary and natural.
4. Keep English fallback accurate.
5. Run a string audit for forbidden default-surface phrases.

**Must verify:**

- no ordinary UI surface shows `Allow once`, `Allow session`, `Allow always`, `Tool approval required`;
- no ordinary UI surface shows `model_request`, `checkpoint`, `raw reasoning`, `debug replay`;
- failure copy is non-blaming and clear.

### Workstream F: Independent QA And Audit

**Owns:**

- no production files unless fixing test harness issues approved by coordinator
- audit report artifact if the coordinator wants one, e.g. `docs/specs/2026-05-10-friday-agent-ux-harness-audit.md`

**Tasks:**

1. Run targeted tests after each integrated workstream.
2. Run full `npm test` before handoff.
3. Review UI copy against this spec.
4. Review CSS for theming, reduced motion, layout stability, and no animation fatigue.
5. Review mutation review behavior using e2e tests.
6. Produce final audit findings ordered by severity.

**Must verify:**

- all P0, P1, and P2 acceptance criteria pass;
- no subagent introduced unrelated refactors;
- no generated build artifacts are committed unless the coordinator explicitly wants release artifacts.

## Recommended Execution Order

1. Baseline: run focused tests that currently describe this area and record current failures/known expected failures.
2. Workstream A: intake contract and runtime gating.
3. Workstream B: local status lifecycle.
4. Workstream C: approval and mutation review language.
5. Workstream D: process panel default surface and motion.
6. Workstream E: copy/i18n sweep.
7. Workstream F: independent audit and full test run.

Do not let multiple subagents edit `DailyBoardView.ts` simultaneously. The coordinator should serialize B and C or assign one subagent a narrow line-range patch and integrate manually.

## Required Tests

Run targeted tests as each workstream lands:

```bash
node --test tests/daily-board-runtime-intake-preview.test.mjs
node --test tests/agent-kernel-loop.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
node --test tests/tool-result-formatter.test.mjs
node --test tests/agent-process-panel-view-model.test.mjs
node --test tests/daily-board-agent-trajectory-ui.test.mjs
node --test tests/agent-process-panel-style-regression.test.mjs
```

Before final handoff:

```bash
npm test
```

If full `npm test` is too slow during subagent iteration, the coordinator may allow focused tests per workstream, but full `npm test` is required before claiming the implementation is complete.

## New Or Updated Test Cases

Add or update tests for these cases:

- Local pre-model status renders `FRIDAY 正在响应……`.
- Model-start status renders `FRIDAY 正在理解你的请求……`.
- Local status is not persisted as assistant message.
- Model connection failure before intake renders the explicit “还没有开始处理” copy.
- Model-authored `direct_answer` suppresses process panel after final answer.
- Model-authored `clarify` asks one question and does not create a visible plan.
- Model-authored `light_task` shows lightweight process without heavy plan.
- Model-authored `task_with_process` expands process while running and collapses after completion.
- Runtime heuristic does not suppress valid model-authored process.
- Invalid/missing intake uses conservative fallback.
- Pending mutation final answer says prepared/not applied.
- Pending mutations are excluded from `本次改动`.
- File mutation review buttons are `应用修改` / `不应用`.
- High-risk tool approval buttons are `允许执行` / `拒绝`.
- Pending approval replaces the bottom composer input body while preserving composer chrome.
- Composer returns to normal input after approval is applied or rejected.
- Ordinary user surfaces do not show forbidden engineering labels.
- New motion CSS is scoped and covered by `prefers-reduced-motion`.

## Acceptance Matrix

| Area | Required Outcome | Evidence |
| --- | --- | --- |
| Local first response | `FRIDAY 正在响应……` appears before model start and is transient | DailyBoard UI test |
| Model start | `FRIDAY 正在理解你的请求……` appears only after runtime/model request starts | Runtime/progress UI test |
| Network failure | Failure before intake says model has not started processing | DailyBoard/runtime failure test |
| Intake routing | Model-authored route controls direct/clarify/light/process behavior | Agent kernel tests |
| Runtime fallback | Regex classifier is fallback only, not primary routing | Agent kernel regression |
| Mutation review | Pending review never implies applied change | Mutation e2e tests |
| File approval | File changes use one mutation review, not extra tool approval | Mutation e2e tests |
| High-risk approval | Non-file risk uses `允许执行` / `拒绝` | Approval UI test |
| Composer approval surface | Approval occupies composer body while model, permission, `+Skill`, and `@` chrome remain visible | DailyBoard composer UI test |
| Process panel | Running task expanded, completed folded | Process panel tests |
| Tool details | Tool trajectory/details folded and product-labeled | Trajectory UI tests |
| Motion | Scoped, subtle, theme-aware, reduced-motion safe | Style regression test |
| Copy | No default engineering labels on ordinary UI | String audit/test |

## Audit Checklist

The audit subagent should inspect the integrated branch and answer these questions with file/test evidence:

- Does any ordinary user-facing surface still show `Allow once`, `Allow session`, `Allow always`, `Tool approval required`, `checkpoint`, `model request`, `debug`, `replay`, or raw tool names?
- Can the user distinguish “prepared pending changes” from “applied changes” without reading implementation details?
- Does a network failure before model intake avoid fake understanding?
- Does final answer remain visually primary after a task completes?
- Does action-required UI remain noticeable without feeling like a terminal prompt?
- Does approval occupy the bottom composer body, rather than relying only on a transcript/process card?
- Does composer chrome remain available during approval without distracting from the decision?
- Are process details folded by default?
- Does the process panel respect Obsidian theme variables?
- Does every new animation have a `prefers-reduced-motion` fallback?
- Do focused tests and `npm test` pass?
- Are unrelated files untouched?

## Coordinator Notes

Recommended coordinator behavior:

- Create a fresh local worktree before implementation.
- Keep this spec and the UX reset record open as source-of-truth documents.
- Keep all P0, P1, and P2 reset items in scope unless the user explicitly narrows scope.
- Dispatch subagents with the same model family and reasoning/intelligence level as the coordinating window whenever the platform allows it.
- Ask each subagent to list changed files in its final answer.
- Review each subagent patch before starting the next dependent workstream.
- Run focused tests immediately after integrating each subagent.
- Keep commits small by workstream.
- Do not accept broad refactors that are not required by this spec.

Recommended subagent prompt skeleton:

```text
You are working in the FRIDAY Obsidian plugin worktree.
Use docs/specs/2026-05-10-friday-agent-ux-harness-reset-spec.zh.md as the contract.
Use the same model family and reasoning/intelligence level as the coordinating window. If you cannot verify this, say so before editing.
You own Workstream <X> only.
Do not edit files outside your ownership unless you first explain why.
Do not revert unrelated user or other-agent changes.
Write or update focused tests before/with implementation.
Run the focused tests listed for your workstream.
Final response must list changed files, tests run, and any unresolved risks.
```

## Completion Definition

This spec is complete only when:

- all P0, P1, and P2 user-facing behavior is implemented;
- targeted tests pass;
- full `npm test` passes or any failure is explicitly documented as unrelated and accepted by the coordinator;
- audit finds no critical or high-severity UX regressions;
- final code does not expose internal engineering concepts to ordinary users by default;
- pending file changes and applied file changes are impossible to confuse in the UI.
