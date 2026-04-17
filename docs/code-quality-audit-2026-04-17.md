# Code Quality Audit

Date: 2026-04-17
Repository: `Firday4Obsidan-upload`
Scope: `src/`, `tests/`, `scripts/`, root config files

## Purpose

This document records the maintainability and code-structure issues found during a manual audit of the current codebase.

The goal is not to prove that the code is broken. The current codebase is operational. The goal is to make clear where the implementation is carrying unnecessary complexity, duplication, or awkward structure that will increase change cost over time.

## Verification Snapshot

The audit was performed against the current working tree and then checked with the project's existing validation commands:

- `npm test`
- `npm run build`
- `npm run lint`

At the time of writing:

- Tests passed: `267/267`
- Build passed
- Lint passed

This means the findings below are primarily about maintainability, elegance, and long-term change risk, not immediate compilation failure.

## Review Boundaries

The audit focused on hand-maintained source files and supporting tests.

Primary review targets:

- `src/`
- `tests/`
- `scripts/`
- root configuration files such as `package.json`

Not treated as primary findings sources:

- `node_modules/`
- `release/`
- generated bundle `main.js`
- `package-lock.json`

## Executive Summary

The codebase currently has several "god objects" that mix UI rendering, domain coordination, async workflows, policy checks, and persistence concerns in the same file. The most important pattern is not one broken function, but a recurring structural issue:

1. Large classes are doing too many jobs.
2. Similar control flow has been copied instead of extracted.
3. Business rules appear in multiple layers, which makes future behavior drift likely.
4. UI state changes often rebuild too much surface area at once, forcing the code to carry extra recovery logic.

The highest-value refactor targets are:

- `src/views/DailyBoardView.ts`
- `src/services/AgentRuntimeService.ts`
- `src/settings/FridaySettingTab.ts`
- `src/services/AIService.ts`
- `src/main.ts`

## Hotspot Inventory

These files are large enough that file size itself is already a maintenance signal:

| File | Approx. lines | Why it matters |
| --- | ---: | --- |
| `src/views/DailyBoardView.ts` | 3437 | UI shell, chat flow, sync flow, tools page, session drawer, conflict UI, runtime preview, mention UI all live together |
| `src/services/AgentRuntimeService.ts` | 2704 | runtime loop, policy enforcement, tool execution, file access, edit plan rollback, path resolution, result formatting |
| `src/settings/FridaySettingTab.ts` | 2559 | all settings sections, project management, plugin update UI, project group management, project editor, git credential UI |
| `src/main.ts` | 1070 | plugin bootstrap, settings migration, project lifecycle, sync startup, update startup, wiki ingest orchestration |
| `src/services/AIService.ts` | 887 | endpoint selection, retries, streaming parsing, tool-calling transport, capability probing |

Large files are not automatically wrong, but in this repository they correlate directly with duplicated control flow and mixed responsibilities.

## Findings

### 1. `DailyBoardView` is rebuilding the whole workspace view for many local state changes

Severity: High

Evidence:

- `src/views/DailyBoardView.ts:206-232`
- `src/views/DailyBoardView.ts:2268-2455`
- `src/views/DailyBoardView.ts:3595-3623`

What is happening:

- `renderBoard()` destroys the composer, clears `contentEl`, rebuilds the shell header, top nav, and current page every time it runs.
- Chat streaming updates append text incrementally and repeatedly trigger `renderBoard()`.
- Because the whole message list can be reconstructed during normal chat updates, the file also needs extra code to capture and restore scroll position.

Why this is not elegant:

- A local change inside the chat page causes full-page reconstruction.
- The render model is forcing the file to solve problems it created itself, such as scroll recovery and composer recreation.
- It becomes hard to reason about what state is durable and what state is recreated on every render.

Practical risks:

- Subtle UI regressions when adding new interactive elements.
- More frequent coupling between unrelated UI areas.
- Extra work to preserve focus, selection, and scroll behavior.

Refactor direction:

- Keep the outer shell stable after `onOpen()`.
- Split page-level rendering into independently refreshed regions.
- Move chat transcript rendering, session drawer rendering, and sync rendering into separate view components or controllers.
- Replace full rerender calls with targeted updates for transcript, runtime preview, and status banners.

### 2. `DailyBoardView` mixes too many domains into one class

Severity: High

Evidence:

- `src/views/DailyBoardView.ts:86-128`
- `src/views/DailyBoardView.ts:644-1124`
- `src/views/DailyBoardView.ts:1130-2455`
- `src/views/DailyBoardView.ts:2777-3645`

What is happening:

- The same class owns sync UI, conflict resolution UI, AI chat orchestration, runtime progress rendering, conversation sessions, mention suggestions, and page navigation.

Why this is not elegant:

- The view is not just rendering state. It is also deciding workflow behavior, holding long-lived transient state, formatting runtime output, and coordinating service calls.
- A reader cannot understand one area without loading unrelated concerns into working memory.

Practical risks:

- New feature work inside chat can accidentally break sync behavior and vice versa.
- Tests tend to become large and brittle because the surface is too broad.
- Review cost rises sharply because every change appears inside the same file.

Refactor direction:

- Extract `ChatPanelController`, `SyncPanelController`, and `SessionDrawerController` style units.
- Move runtime-reply formatting and runtime-state shaping out of the view into dedicated services.
- Keep the view class responsible only for wiring UI containers to already-shaped state.

### 3. `FridaySettingTab` writes state too eagerly and re-renders aggressively

Severity: Medium

Evidence:

- `src/settings/FridaySettingTab.ts:1345-1363`
- `src/settings/FridaySettingTab.ts:1520-1530`
- `src/settings/FridaySettingTab.ts:2460-2463`
- `src/settings/FridaySettingTab.ts:2625-2630`

What is happening:

- Project-group rename is bound directly to text input changes and persists immediately through `upsertProjectGroup`.
- Several actions wrap async work in inline IIFEs and then call `display()` again.
- The settings page performs many whole-tab redraws after small state updates.

Why this is not elegant:

- Saving on every input change is usually the wrong persistence boundary for administrative configuration.
- Whole-tab redraws increase UI churn and make input lifecycle reasoning harder.
- Inline async IIFEs inside button handlers add visual noise without clarifying intent.

Practical risks:

- Input fields can feel jumpy if redraw timing changes.
- More opportunities for accidental repeated writes.
- Harder to add validation because the save boundary is spread across many handlers.

Refactor direction:

- Use explicit commit boundaries such as blur, Enter, or save buttons for text edits with persistence.
- Replace repeated `display()`-driven rerender patterns with section-level refresh helpers.
- Move project-group and project-editor mutations into small action methods with consistent save semantics.

### 4. `AgentRuntimeService` contains two largely duplicated runtime loops

Severity: Medium

Evidence:

- `src/services/AgentRuntimeService.ts:738-870`
- `src/services/AgentRuntimeService.ts:872-1067`

What is happening:

- `runTurnPrompt()` and `runTurnNative()` both perform similar setup, step iteration, progress reporting, subagent execution, tool result handling, loaded-skill context reinjection, and overflow behavior.
- The difference is mainly the model interaction mode, not the surrounding orchestration shape.

Why this is not elegant:

- Shared behavior is duplicated at the most important control-flow level in the runtime engine.
- Fixing a behavioral edge case in one path is easy to forget in the other path.

Practical risks:

- Prompt runtime and native runtime drift in subtle ways over time.
- Harder to add new step phases, trace fields, or error-handling rules consistently.

Refactor direction:

- Extract one step engine and inject a "decision source" adapter for prompt vs native tool calling.
- Normalize tool/subagent/result handling into shared helpers.
- Keep transport-specific behavior at the edges instead of inside the main runtime control loop.

### 5. `AIService` repeats transport orchestration across chat modes

Severity: Medium

Evidence:

- `src/services/AIService.ts:583-640`
- `src/services/AIService.ts:642-783`
- `src/services/AIService.ts:861-928`

What is happening:

- `chat`, `chatStream`, and `chatWithTools` each repeat large parts of the same workflow:
  - config validation
  - endpoint candidate resolution
  - fallback iteration
  - retry loop
  - normalized error handling

Why this is not elegant:

- The service has already started centralizing policy pieces such as header construction and retry decisions, but the main request orchestration is still copy-heavy.
- The repeated structure makes it difficult to prove that all modes obey the same rules.

Practical risks:

- One code path can silently gain better retry or fallback behavior than another.
- Future provider support work becomes more expensive because every mode needs the same edits.

Refactor direction:

- Create a shared request executor that owns endpoint iteration, retry policy, and normalized failure handling.
- Let `chat`, `chatStream`, and `chatWithTools` only define payload construction and response parsing.

### 6. `DailyBoardView` duplicates AI action lifecycle handling

Severity: Medium

Evidence:

- `src/views/DailyBoardView.ts:2268-2455`
- `src/views/DailyBoardView.ts:2457-2537`

What is happening:

- `submitAiPrompt()` and `compileWikiByButton()` both repeat state reset, busy flags, runtime progress handling, streaming behavior, conversation persistence, notices, and final cleanup.

Why this is not elegant:

- These methods are not just similar. They are two versions of the same UI action lifecycle with slightly different inputs.
- Shared lifecycle work should not have to be reimplemented for every AI-triggered action.

Practical risks:

- Error handling and persistence behavior will drift.
- New AI actions will likely copy one of these methods and make the duplication worse.

Refactor direction:

- Introduce a single view-level helper for "run AI action with busy/progress/cleanup semantics".
- Pass action-specific runtime inputs into that helper.

### 7. Plugin update eligibility rules are duplicated across UI, service, and startup flow

Severity: Low

Evidence:

- `src/services/PluginUpdateService.ts:76-108`
- `src/settings/FridaySettingTab.ts:335-339`
- `src/settings/FridaySettingTab.ts:467-488`
- `src/settings/FridaySettingTab.ts:2625-2630`
- `src/main.ts:1049-1058`

What is happening:

- The same prerequisites are checked in several places:
  - service-level availability logic
  - settings-page prerequisite display
  - settings-page enablement checks
  - startup auto-check gating

Why this is not elegant:

- The rule is conceptually one business policy, but it is represented several times in separate layers.

Practical risks:

- One location may be updated while another is forgotten.
- UI can claim updates are available while startup flow refuses to run, or vice versa.

Refactor direction:

- Centralize plugin-update readiness into one reusable policy object or service response.
- Let the UI consume structured readiness state instead of recomputing it.

### 8. Runtime discovery tools duplicate vault/external traversal logic

Severity: Low

Evidence:

- `src/services/AgentRuntimeService.ts:1599-1768`
- `src/services/AgentRuntimeService.ts:2239-2347`

What is happening:

- `toolList`, `toolRead`, `toolGrep`, and `toolGlob` all branch on vault vs external scope.
- External traversal is split across separate helpers with slightly different limits and behaviors.
- Vault traversal repeats path checks and filtering logic in each tool path.

Why this is not elegant:

- The runtime tool layer is doing too much low-level filesystem orchestration directly.
- Similar search and traversal concerns are being reimplemented per tool.

Practical risks:

- Inconsistent behavior between tools for the same path scope.
- More edge cases around limits, path filtering, and permission error wording.

Refactor direction:

- Extract a unified scoped-file-access layer with shared traversal primitives.
- Keep tool methods focused on intent: list, read, grep, or glob.

## Supporting Smells

These are lower-priority signals that reinforce the findings above:

- `default-group` is duplicated as a raw string in multiple settings code paths instead of being reused from one shared constant.
- Large UI/service files rely on many booleans and ad hoc transient fields rather than a smaller number of shaped state objects.
- Inline async wrappers such as `void (async () => { ... })()` appear repeatedly where named handlers would be clearer.

None of these are the main problem by themselves. They matter because they appear inside already-large files and amplify cognitive load.

## Recommended Refactor Order

### Phase 1: Stabilize the view layer

1. Split `DailyBoardView` into shell + page controllers.
2. Remove full-page rerender as the default refresh mechanism.
3. Centralize AI action lifecycle handling.

Expected outcome:

- Safer UI changes
- Less scroll/focus recovery code
- Smaller regression surface for chat and sync work

### Phase 2: Consolidate runtime orchestration

1. Unify prompt/native runtime loop behavior in `AgentRuntimeService`.
2. Extract shared tool/subagent result handling.
3. Move runtime result formatting out of the view.

Expected outcome:

- Less behavior drift
- Easier testing of runtime semantics
- Lower cost for future runtime features

### Phase 3: Normalize transport and policy rules

1. Extract one request executor from `AIService`.
2. Centralize plugin-update readiness policy.
3. Consolidate scoped filesystem traversal for runtime tools.

Expected outcome:

- More predictable behavior across modes
- Fewer duplicated business rules
- Easier provider and tool-surface expansion

## Final Assessment

The project is not in a failing state, but it is entering the stage where adding features will cost more than necessary because responsibility boundaries are blurred.

The most important conclusion is this:

- The codebase does not primarily suffer from "bad syntax" or isolated messy lines.
- It primarily suffers from a small number of oversized files that have become workflow owners, state stores, renderers, and policy coordinators at the same time.

If future work continues inside those files without extraction, the code will still compile, but each feature will become slower to implement, slower to review, and easier to regress.
