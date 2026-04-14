# W0 Builtin Skill Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Register all four builtin orchestration skills (`compile-wiki`, `lookup-wiki`, `maintain-memory`, `resolve-conflict`) via `builtin://` virtual paths and make `SkillCommandService` consume them.

**Architecture:** Extract builtin skill metadata and markdown content into a dedicated module under `src/skills/packs/builtin/`, then refactor `SkillCommandService` to build index/context from that module instead of hardcoding only `compile-wiki`. Keep tool intent matching backward-compatible for `compile-wiki`.

**Tech Stack:** TypeScript, existing plugin runtime services, Node test runner (`node --test`) with `jiti` for TS module loading.

---

### Task 1: Add Failing Tests for Builtin Skill Pack Contract

**Files:**
- Create: `tests/skill-command-builtin-pack.test.mjs`
- Test: `tests/skill-command-builtin-pack.test.mjs`

**Step 1: Write the failing test**
- Assert builtin skill pack exports exactly four skills.
- Assert commands include `compile-wiki`, `lookup-wiki`, `maintain-memory`, `resolve-conflict`.
- Assert virtual path format is `builtin://<command>/SKILL.md`.

**Step 2: Run test to verify it fails**
Run: `node --test tests/skill-command-builtin-pack.test.mjs`
Expected: FAIL (module/exports missing before implementation).

**Step 3: Write minimal implementation**
- Add builtin definitions module with metadata + markdown constants.

**Step 4: Run test to verify it passes**
Run: `node --test tests/skill-command-builtin-pack.test.mjs`
Expected: PASS.

### Task 2: Refactor SkillCommandService to Consume Builtin Pack

**Files:**
- Modify: `src/services/SkillCommandService.ts`
- Modify: `src/skills/packs/builtin/index.ts`

**Step 1: Write the failing test**
- Extend test to assert exported helper can resolve markdown for all builtin commands.

**Step 2: Run test to verify it fails**
Run: `node --test tests/skill-command-builtin-pack.test.mjs`
Expected: FAIL on helper behavior.

**Step 3: Write minimal implementation**
- Replace single-skill hardcode with array-driven builtin index.
- Keep `compile-wiki` intent detection and alias matching behavior.

**Step 4: Run test to verify it passes**
Run: `node --test tests/skill-command-builtin-pack.test.mjs`
Expected: PASS.

### Task 3: Verify Quality Gate for This Slice

**Files:**
- Modify: `package.json` (if adding `test` script)

**Step 1: Run focused test**
Run: `node --test tests/skill-command-builtin-pack.test.mjs`
Expected: PASS.

**Step 2: Run lint/typecheck/build**
Run: `npm run lint && npm run build`
Expected: PASS.
