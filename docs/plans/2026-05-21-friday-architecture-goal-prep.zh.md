# FRIDAY Architecture Goal Preparation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare and execute a staged architecture-debt reduction for FRIDAY by extracting non-rendering logic out of `DailyBoardView.ts` and splitting `FridaySettingTab.ts` into focused, testable modules without changing user-visible behavior.

**Architecture:** Keep the current Agent Kernel v2 and service boundaries intact. Treat `DailyBoardView` as a view shell that renders state and delegates composer, mention, approval, and conversation-ingress logic; treat `FridaySettingTab` as a section router that delegates section rendering and section-specific state to smaller modules. Use TDD for every extraction so refactors are behavior-preserving.

**Tech Stack:** Obsidian plugin, TypeScript, esbuild, Node test runner, `jiti` for TS module tests, existing `npm test`, `npm run build`, and `npm run lint` commands.

---

## Goal Command Handoff

Suggested future `goal` objective:

```text
Reduce FRIDAY architecture debt in C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload by executing docs/plans/2026-05-21-friday-architecture-goal-prep.zh.md task-by-task. Preserve behavior, use TDD for each extraction, keep the dirty working tree safe, and do not perform a broad rewrite.
```

Suggested goal constraints:

- Start by reading this plan, `AGENTS.md`, and the referenced existing FRIDAY architecture plans.
- Do not create or switch branches unless explicitly asked.
- Preserve all pre-existing user changes in the working tree.
- Do not reset, checkout, or clean generated artifacts.
- Do not let multiple workers edit `src/views/DailyBoardView.ts` at the same time.
- Keep each refactor slice small enough to review independently.
- Commit only if the user explicitly asks for commits.

## Current Evidence Snapshot

Run on 2026-05-21 in `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload`:

```text
src/views/DailyBoardView.ts                   6200 lines, 45 imports, 274 private methods, 47 render methods
src/settings/FridaySettingTab.ts              4326 lines, 26 imports, 146 private methods, 34 render methods
src/views/agentProcessPanelViewModel.ts       3384 lines
src/views/agentTrajectoryRenderer.ts          1038 lines
src/core/agent-kernel/AgentLoopController.ts  3114 lines
src/services/AgentRuntimeService.ts           3933 lines
```

`AGENTS.md` says files over roughly 200-300 lines should be split into focused modules and each file should have a clear single responsibility.

Relevant existing design constraints:

- `docs/plans/2026-05-08-friday-document-context-entrypoints-design.zh.md` says conversation start logic is currently concentrated in `DailyBoardView` and should be extracted to support document-originated conversation entry points.
- `docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md` says Daily Board should render `AgentTrajectorySnapshot` instead of interpreting `RuntimeProgressEvent.phase` semantics.
- `docs/specs/2026-05-10-friday-agent-ux-harness-reset-spec.zh.md` warns not to let multiple subagents edit `DailyBoardView.ts` simultaneously.

## Non-Goals

- Do not redesign FRIDAY's user experience.
- Do not replace Agent Kernel v2, `AgentLoopController`, or `AgentRuntimeService`.
- Do not change manifest identity, command IDs, settings schema, release versioning, or storage format.
- Do not tune runtime behavior such as `maxToolIterations` as a substitute for boundary cleanup.
- Do not regenerate release artifacts unless verification commands require it; if they change, report that separately.
- Do not chase a target line count by making artificial wrapper files.

## Target Boundaries

`DailyBoardView.ts` should keep:

- Obsidian `ItemView` lifecycle.
- Top-level page switching.
- DOM mount points and event wiring.
- Calls into renderers, controllers, and presenters.

`DailyBoardView.ts` should delegate:

- Mention suggestion filtering and file-type classification.
- User-message UI segment construction.
- Composer queue and send-button state.
- Conversation-ingress creation.
- Approval and mutation review view models.
- Sync conflict proposal view models.

`FridaySettingTab.ts` should keep:

- Obsidian `PluginSettingTab` lifecycle.
- Current section selection.
- Delegation to section renderers.

`FridaySettingTab.ts` should delegate:

- LLM/model/provider settings.
- Soul management, Soul Lab, and Soul editor.
- Project registration and Git detection UI.
- Sync and ignore-manager UI.
- Official content and plugin-update UI.

## Task 0: Baseline and Safety Check

**Files:**
- Read: `AGENTS.md`
- Read: `docs/plans/2026-05-21-friday-architecture-goal-prep.zh.md`
- Read: `src/views/DailyBoardView.ts`
- Read: `src/settings/FridaySettingTab.ts`

**Step 1: Record working-tree state**

Run:

```powershell
git status --short
```

Expected: report existing dirty files before making edits. Do not reset them.

**Step 2: Record size metrics**

Run:

```powershell
$targets = @('src\views\DailyBoardView.ts','src\settings\FridaySettingTab.ts','src\views\agentProcessPanelViewModel.ts','src\views\agentTrajectoryRenderer.ts')
$rows = foreach ($target in $targets) {
  $content = Get-Content -LiteralPath $target
  [PSCustomObject]@{
    File=$target
    Lines=$content.Count
    Imports=($content | Select-String '^import ').Count
    PrivateMethods=($content | Select-String '^\s*private\s+(async\s+)?[a-zA-Z0-9_]+\(').Count
  }
}
$rows | Format-Table -AutoSize
```

Expected: use this only as a baseline; do not fail the run on size alone.

## Task 1: Extract Mention Suggestion Classification

**Files:**
- Create: `src/views/mentionSuggestions.ts`
- Create: `tests/mention-suggestions.test.mjs`
- Modify: `src/views/DailyBoardView.ts`

**Step 1: Write the failing test**

Create `tests/mention-suggestions.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/mentionSuggestions.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("classifies mention file types from Obsidian file metadata", async () => {
	const mod = await loadModule();

	assert.equal(mod.getMentionFileTypeIcon({ extension: "md" }), "markdown");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "canvas" }), "canvas");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "ts" }), "code");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "TXT" }), "note");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "png" }), "note");
});

test("filters mentionable files without depending on DailyBoardView", async () => {
	const mod = await loadModule();
	const files = [
		{ path: "Project/a.md", basename: "a", extension: "md" },
		{ path: "Project/code.ts", basename: "code", extension: "ts" },
		{ path: "Project/whiteboard.canvas", basename: "whiteboard", extension: "canvas" },
		{ path: "Project/image.png", basename: "image", extension: "png" },
	];

	assert.deepEqual(
		files.filter((file) => mod.isMentionableFile(file)).map((file) => file.path),
		["Project/a.md", "Project/code.ts", "Project/whiteboard.canvas"],
	);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/mention-suggestions.test.mjs
```

Expected: FAIL because `src/views/mentionSuggestions.ts` does not exist.

**Step 3: Write minimal implementation**

Create `src/views/mentionSuggestions.ts`:

```ts
import type { MentionFileTypeIconKind } from "./components/MentionDropdown";

interface MentionFileLike {
	extension?: string | null;
}

const CODE_MENTION_FILE_EXTENSIONS = new Set([
	"c",
	"cc",
	"cpp",
	"cs",
	"css",
	"go",
	"h",
	"htm",
	"html",
	"java",
	"js",
	"json",
	"jsx",
	"mjs",
	"py",
	"rs",
	"sh",
	"ts",
	"tsx",
	"xml",
	"yaml",
	"yml",
]);

const NOTE_MENTION_FILE_EXTENSIONS = new Set(["", "txt"]);

export function getMentionFileTypeIcon(file: MentionFileLike): MentionFileTypeIconKind {
	const extension = (file.extension ?? "").toLowerCase();
	if (extension === "md") {
		return "markdown";
	}
	if (extension === "canvas") {
		return "canvas";
	}
	if (CODE_MENTION_FILE_EXTENSIONS.has(extension)) {
		return "code";
	}
	return "note";
}

export function isMentionableFile(file: MentionFileLike): boolean {
	const extension = (file.extension ?? "").toLowerCase();
	return extension === "md"
		|| extension === "canvas"
		|| CODE_MENTION_FILE_EXTENSIONS.has(extension)
		|| NOTE_MENTION_FILE_EXTENSIONS.has(extension);
}
```

Modify `DailyBoardView.ts` to import `getMentionFileTypeIcon` and `isMentionableFile`, remove local duplicate constants and methods, and update call sites:

```ts
import { getMentionFileTypeIcon, isMentionableFile } from "./mentionSuggestions";
```

Call sites should become:

```ts
fileTypeIcon: activeFile instanceof TFile ? getMentionFileTypeIcon(activeFile) : "note",
```

and:

```ts
const files = this.app.vault.getFiles().filter((file) => isMentionableFile(file));
```

**Step 4: Run test to verify it passes**

Run:

```powershell
node --test tests/mention-suggestions.test.mjs
```

Expected: PASS.

**Step 5: Run focused regression**

Run:

```powershell
node --test tests/mention-resolver.test.mjs
```

Expected: PASS.

## Task 2: Extract User Message Segment Builder

**Files:**
- Create: `src/views/chatMessageSegments.ts`
- Create: `tests/chat-message-segments.test.mjs`
- Modify: `src/views/DailyBoardView.ts`

**Step 1: Write the failing test**

Create `tests/chat-message-segments.test.mjs` around a public function:

```ts
buildUserMessageSegments({
	snapshot,
	mentionResolution,
	resolution,
	formatSkillDisplayName,
	formatMentionBadgeLabel,
})
```

Cover:

- Adjacent text parts are merged.
- Skill tokens become `kind: "skill"` UI tokens.
- Context tokens use resolved mention entries when available.
- Missing context entries fall back to `formatMentionTokenLabel`.

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/chat-message-segments.test.mjs
```

Expected: FAIL because `chatMessageSegments.ts` does not exist.

**Step 3: Implement by moving existing logic**

Move only these concerns out of `DailyBoardView.ts`:

- `buildUserMessageSegments`
- `normalizeUserMessageSegments`
- direct calls to `listMentionComposerParts`
- direct calls to `restoreMentionComposerDoc`

Keep translation and label formatting injected from `DailyBoardView`.

**Step 4: Run focused tests**

Run:

```powershell
node --test tests/chat-message-segments.test.mjs tests/mention-resolver.test.mjs
```

Expected: PASS.

## Task 3: Extract Conversation Ingress Boundary

**Files:**
- Create: `src/core/chat/ConversationIngressService.ts`
- Create: `tests/conversation-ingress-service.test.mjs`
- Modify: `src/views/DailyBoardView.ts`

**Step 1: Write failing tests for the desired API**

Test a service API like:

```ts
createConversationIngressPayload({
	snapshot,
	activeProject,
	currentFilePath,
	mentionResolution,
	selectedModel,
	selectedPermissionMode,
})
```

Cover:

- Empty prompts are rejected before runtime dispatch.
- Mention context is attached as structured metadata.
- Active project and session identity are preserved.
- Runtime-facing payload does not depend on DOM or Obsidian `ItemView`.

**Step 2: Move logic gradually**

Extract logic from `DailyBoardView.submitAiPrompt` without changing the runtime call path in the first pass. `DailyBoardView` may still orchestrate:

- UI busy state.
- appending messages.
- calling `plugin.agentRuntimeService`.
- persistence.

The extracted service owns only payload creation and validation first.

**Step 3: Verify**

Run:

```powershell
node --test tests/conversation-ingress-service.test.mjs tests/agent-runtime-harness-e2e.test.mjs
```

Expected: PASS.

## Task 4: Split Settings Sections One at a Time

**Files:**
- Create directory: `src/settings/sections/`
- Create: `src/settings/sections/LlmSettingsSection.ts`
- Create: `src/settings/sections/SoulSettingsSection.ts`
- Create: `src/settings/sections/ProjectSettingsSection.ts`
- Create tests only where logic can be isolated from Obsidian DOM.
- Modify: `src/settings/FridaySettingTab.ts`

**Step 1: Start with LLM settings**

Extract these first because they are bounded and already use helper services:

- `renderLlmSection`
- model preset loading helpers
- OpenCode snapshot reading
- connection-test state descriptions

Keep `FridaySettingTab` as owner of section navigation.

**Step 2: Then Soul settings**

Extract:

- `renderSoulSection`
- `renderSoulEditorSection`
- `renderSoulLabSection`
- Soul template install/remove helpers

Avoid changing Soul semantics or templates during this refactor.

**Step 3: Then project settings**

Extract:

- `renderProjectSection`
- `renderProjectEditorCard`
- Git detection UI state
- ignore manager UI

Keep `ProjectEditorService` as the domain service; do not duplicate its logic.

**Step 4: Verify after each section**

Run after each section extraction:

```powershell
npm run build
node --test tests/settings-project-ui-regression.test.mjs tests/settings-native-groups-regression.test.mjs tests/agent-model-mode-regression.test.mjs
```

Expected: build succeeds and focused settings tests pass. If generated release artifacts change, report them instead of silently reverting.

## Task 5: Add Architecture Boundary Regression Checks

**Files:**
- Create: `tests/architecture-boundary-regression.test.mjs`

**Step 1: Add tests for specific regressions, not arbitrary line counts**

Good checks:

- `DailyBoardView.ts` should not define local `CODE_MENTION_FILE_EXTENSIONS`.
- `DailyBoardView.ts` should not define local `normalizeUserMessageSegments`.
- `DailyBoardView.ts` should not reintroduce a `RuntimeProgressEvent.phase` switch for process UI.
- `FridaySettingTab.ts` should import section renderers from `src/settings/sections/` after section extraction starts.

Avoid brittle checks:

- Failing only because a file has more than N lines.
- Failing because an import count changes.

**Step 2: Run**

```powershell
node --test tests/architecture-boundary-regression.test.mjs
```

Expected: PASS after the corresponding extractions exist.

## Task 6: Full Verification

Run:

```powershell
npm test
npm run build
npm run lint
git diff --stat
git diff --check
```

Expected:

- `npm test` exits 0.
- `npm run build` exits 0.
- `npm run lint` has 0 errors; if warnings pre-existed, report exact warnings.
- `git diff --check` has no real whitespace errors. Existing CRLF/LF warnings should be distinguished from blocking whitespace errors.
- Diff is limited to planned source/test files plus any generated release artifacts caused by build.

## Acceptance Criteria

- `DailyBoardView.ts` loses concrete non-rendering responsibilities in at least three areas: mention classification, message segment construction, and conversation-ingress payload preparation.
- `FridaySettingTab.ts` begins section-level extraction with at least one real section module and no behavior change.
- Existing runtime, mutation review, model selection, and sync behavior remain covered by focused tests.
- No public command IDs, manifest fields, settings schema, or release version numbers change.
- The final report includes exact verification commands and results.

## Recommended First Goal Slice

Start with Tasks 0-2 only. They are small, testable, and reduce `DailyBoardView` risk before touching runtime or settings. After Tasks 0-2 pass, reassess before attempting conversation ingress or settings extraction.
