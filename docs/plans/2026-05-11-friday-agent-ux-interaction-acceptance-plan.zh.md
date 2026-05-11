# FRIDAY Agent UX Interaction Acceptance Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this acceptance plan task-by-task.

**Goal:** 验证 FRIDAY 在用户发送消息后的编排、首响、状态展示、审批、过程面板和普通用户语言是否已经按既定 Agent UX 设计落地。

**Architecture:** 这是一份验收计划，不是开发计划。验收必须从用户旅程出发，把代码证据、自动化测试、Obsidian CLI GUI 截图和 DOM 反向扫描串起来；不要只看测试通过，也不要只看截图。发现缺口时先记录证据和影响，再由统筹窗口决定是否进入修复。

**Tech Stack:** Obsidian plugin, TypeScript, Node test runner, esbuild, Obsidian CLI, live Obsidian test vault, screenshot and DOM inspection.

---

## 0. Scope And Principle

本计划验收的是前面规划过的交互体验，不验收上下文压缩、Subagent、真正后台任务、工作区隔离等明确暂不学习或差距明显的能力。

核心产品合同：

- 用户发送消息后，本地即时首响只能表达 FRIDAY 正在响应，不能伪装成模型已经理解。
- 模型请求发出后，才能显示 FRIDAY 正在理解你的请求。
- 模型返回 intake 后，由模型决定简单回答、澄清、轻量任务或完整任务过程。
- 任务执行中，FRIDAY 要展示“正在做什么”，但不能要求用户盯着每一步。
- 过程面板运行中默认展开，完成后默认折叠。
- 审批态占用底部 composer body，并保留模型选择、权限模式、`+Skill`、`@` 等 composer chrome。
- 文件修改审批前只能表达“已准备好/待应用/确认后才会写入”，不能表达“已创建/已修改/已删除”。
- 普通用户界面不暴露 `tool`、`checkpoint`、`model_request`、`model request`、`raw reasoning`、`debug`、`replay`、`Cancel`、`Continue`、`Apply`、`Reject` 等工程概念或英文 fallback。
- 模型连接失败、重试、请求耗尽必须用用户语言明确说明，不能让用户误以为产品卡死。

## 1. Acceptance Matrix

| Area | Required evidence | Failure signal |
| --- | --- | --- |
| Local first response | UI transiently shows `FRIDAY 正在响应……`; it is not persisted as assistant message | It says `已收到` / `我理解你要` before model intake |
| Model-start state | `FRIDAY 正在理解你的请求……` appears only after runtime/model request starts | Network has not connected but UI claims it is understanding |
| Network failure before intake | UI says `暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。` | Failure copy implies the model already started processing |
| Intake routing | `direct_answer` / `clarify` / `light_task` / `task_with_process` are model-authored or conservative fallback only | Runtime regex/heuristic suppresses valid model-authored route |
| Direct answer | Final answer is primary; no heavy process panel remains | Simple answer leaves a debug-like process panel |
| Clarify | FRIDAY asks for missing info without a fake plan/process | It shows a plan or tool process before user clarifies |
| Light task | May show concise progress if useful; no visible plan requirement | It behaves like a full coding-agent process |
| Task with process | Running process is expanded by default; completed process is folded | Running process hidden, or completed process stays dominant |
| Elapsed timer | Timer updates do not remove/reinsert the process shell | Whole process block flickers every second |
| Tool trajectory | Tool details are folded or summarized semantically | Raw tool names, args, results are visible by default |
| File mutation review | Composer body shows pending language and `应用修改` / `不应用` | UI says file was already created/modified before approval |
| High-risk approval | Composer body shows `允许执行` / `拒绝`; no fine-grained permission labels | `Allow once/session/always` or `Tool approval required` visible |
| Conflict state | User copy says file changed before confirmation and FRIDAY needs to recheck | `Before snapshot mismatch` visible |
| Ordinary language boundary | DOM banned-term scan returns `[]` | checkpoint/model_request/debug/replay/etc visible in ordinary UI |
| Navigation during work | Switching page/session does not cancel the in-flight task; status remains visible | Current turn is lost or final answer writes into wrong session |

Note: Completely closing the DailyBoard view and continuing the task is close to true background-task capability. Treat it as an observed limitation unless the implementation explicitly claims it.

## 2. Task 1: Preflight The Worktree And Test Vault

**Files:**

- Read: `docs/plans/2026-05-10-friday-agent-ux-reset-record.zh.md`
- Read: `docs/specs/2026-05-10-friday-agent-ux-harness-reset-spec.zh.md`
- Read: `docs/specs/2026-05-11-friday-agent-ux-surface-isolation-spec.zh.md`
- Read: `docs/plans/2026-05-11-friday-agent-ux-surface-isolation-plan.zh.md`

**Step 1: Confirm branch and status**

Run:

```powershell
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --short
```

Expected:

- You are in the intended implementation worktree.
- Branch is the implementation branch to verify, usually `codex/friday-agent-ux-harness-reset`.
- Dirty files are understood before verification begins.

**Step 2: Confirm test plugin directory**

Run:

```powershell
Test-Path "C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin"
```

Expected:

```text
True
```

**Step 3: Check artifact sync before any GUI claim**

Run:

```powershell
$repo = (git rev-parse --show-toplevel).Trim()
$plugin = "C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin"
"main.js","styles.css","manifest.json" | ForEach-Object {
  $src = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo $_)).Hash
  $dst = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $plugin $_)).Hash
  [pscustomobject]@{ file = $_; match = $src -eq $dst; hash = $src }
} | Format-Table -AutoSize
```

Expected:

- `match` is `True` for all three files.

If any artifact does not match:

```powershell
npm run build
Copy-Item -Force -LiteralPath ".\main.js",".\styles.css",".\manifest.json" -Destination "C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin"
```

Then rerun the hash check. Do not continue GUI verification until the hash check passes.

## 3. Task 2: Static Contract Audit

**Files:**

- Read: `src/core/context/PromptContextEngine.ts`
- Read: `src/views/DailyBoardView.ts`
- Read: `src/views/agentProcessPanelViewModel.ts`
- Read: `src/views/agentUserFacingPresenter.ts`
- Read: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Read: `src/core/mutations/MutationApplier.ts`
- Read: `src/i18n/locales/zh-CN.ts`
- Read: `styles.css`

**Step 1: Check intake route contract**

Run:

```powershell
rg -n "interactionRoute|direct_answer|clarify|light_task|task_with_process|shouldShowProcess|shouldUseVisiblePlan|intake" src tests
```

Expected:

- Model-facing contract includes route names for direct answer, clarify, light task, and task with process.
- Tests assert the UI uses intake route semantics.
- Runtime fallback exists only for missing/invalid intake, not as the primary semantic classifier.

**Step 2: Check local first response is transient**

Run:

```powershell
rg -n "FRIDAY 正在响应|FRIDAY 正在理解你的请求|aiLocalIntakePreview|content: this\\.aiLocalIntakePreview|aiConversation|persistConversation" src/views/DailyBoardView.ts tests
```

Expected:

- Local preview is a transient UI field.
- There is no path that persists local preview as an assistant message.
- The model-start copy appears only after runtime/model progress.

**Step 3: Check composer approval ownership**

Run:

```powershell
rg -n "syncComposerDecisionPanel|renderComposerDecisionPanel|getPendingEditPlans|isCurrentSessionEditPlan|hasPendingComposerDecision|approval\\.allowExecute|approval\\.reject|mutation\\.review\\.applyChanges|mutation\\.review\\.doNotApply" src/views/DailyBoardView.ts src/i18n tests
```

Expected:

- Approval and file mutation review render inside composer body.
- Composer chrome is still rendered outside the body.
- `getPendingEditPlans()` counts only current-session pending items.
- Ordinary approval buttons are user-level decisions, not permission-policy variants.

**Step 4: Check process panel expansion and non-flicker architecture**

Run:

```powershell
rg -n "expanded_live_process|collapsed_completed_replay|defaultExpanded|syncLiveRuntimeElapsedProcess|aiRuntimeElapsedTimer|friday-agent-process-enter|friday-agent-process-pulse|prefers-reduced-motion" src tests styles.css
```

Expected:

- Running process uses expanded live surface.
- Completed task process uses collapsed completed surface.
- Elapsed timer updates text/status without rebuilding the full message list or process shell.
- Animations use opacity/transform-like lightweight motion and support reduced motion.

**Step 5: Check ordinary user projection boundary**

Run:

```powershell
rg -n "productizeRuntimeText|productizeActionLabel|formatUserFacingTaskStatus|formatMutationApplyReasonForUser|view_replay|checkpoint|model_request|raw reasoning|debug|replay|Cancel|Continue|Apply|Reject|Before snapshot mismatch" src tests
```

Expected:

- Internal strings may exist in runtime/tests/internal data.
- Ordinary UI render paths pass through user-facing presenter/view model.
- `view_replay` is filtered from ordinary action views.
- Mutation conflicts use structured reason codes or mapped product copy before display.

## 4. Task 3: Automated Tests

**Files:**

- Test: `tests/daily-board-runtime-intake-preview.test.mjs`
- Test: `tests/agent-process-panel-view-model.test.mjs`
- Test: `tests/daily-board-ui-regression.test.mjs`
- Test: `tests/daily-board-agent-task-ui-regression.test.mjs`
- Test: `tests/daily-board-agent-trajectory-ui.test.mjs`
- Test: `tests/user-facing-surface-contract.test.mjs`
- Test: `tests/chat-composer-queue-regression.test.mjs`
- Test: `tests/i18n-parity.test.mjs`

**Step 1: Run targeted interaction tests**

Run:

```powershell
node --test `
  tests/daily-board-runtime-intake-preview.test.mjs `
  tests/agent-process-panel-view-model.test.mjs `
  tests/daily-board-ui-regression.test.mjs `
  tests/daily-board-agent-task-ui-regression.test.mjs `
  tests/daily-board-agent-trajectory-ui.test.mjs `
  tests/user-facing-surface-contract.test.mjs `
  tests/chat-composer-queue-regression.test.mjs `
  tests/i18n-parity.test.mjs
```

Expected:

- Exit code 0.
- Zero failed tests.

**Step 2: Run full verification**

Run:

```powershell
npm test
git diff --check
```

Expected:

- `npm test` exit code 0.
- `git diff --check` no output.

If tests pass but GUI later fails, GUI wins. This class of issue is often session-state or renderer-state dependent.

## 5. Task 4: Obsidian CLI Baseline

**Files:**

- Use: test vault named `test`
- Use plugin id: `friday-obsidian-plugin`
- Output screenshots under: `%TEMP%\friday-agent-ux-interaction-acceptance-<short-sha>\`

**Step 1: Reload plugin and clear errors**

Run:

```powershell
$shortSha = (git rev-parse --short HEAD).Trim()
$outDir = Join-Path $env:TEMP "friday-agent-ux-interaction-acceptance-$shortSha"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
obsidian vault="test" dev:errors clear
obsidian vault="test" plugin:reload id=friday-obsidian-plugin
obsidian vault="test" command id=friday-obsidian-plugin:open-daily-board
obsidian vault="test" dev:errors
```

Expected:

```text
No errors captured.
```

**Step 2: Use short eval snippets only**

Do not run one giant `obsidian eval`. Long eval scripts can hang the renderer. Prefer short scenario-specific snippets and reload the plugin if the renderer becomes unreliable.

Recommended wrapper for multiline eval:

```powershell
function Invoke-FridayEval {
  param([string]$Code)
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Code))
  $wrapped = "eval(new TextDecoder().decode(Uint8Array.from(atob(``$encoded``), c => c.charCodeAt(0))))"
  obsidian vault="test" eval code="$wrapped"
}
```

## 6. Task 5: GUI Scenario Acceptance

Each scenario must produce:

- eval output;
- screenshot path;
- DOM banned-term scan output;
- `obsidian dev:errors` output.

### Scenario A: Local First Response

**Goal:** Confirm local first response is transient and does not fake understanding.

Implementation choices:

- If the implementation exposes a deterministic test helper, use it.
- Otherwise inspect current code and test coverage, then use a manual live run with a model endpoint that can be delayed.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\01-local-first-response.png"
```

Required visual outcome:

- `FRIDAY 正在响应……` is visible before model intake.
- No assistant bubble says `我理解你想要...`.
- If the model fails before intake, the local status is replaced by explicit failure copy.

### Scenario B: Model Start State

**Goal:** Confirm model-start copy appears only after runtime/model progress begins.

Use a short eval that injects a model request progress event into the DailyBoard view, or use the existing verification script if it already covers this.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\02-model-start-understanding.png"
```

Required visual outcome:

- UI shows `FRIDAY 正在理解你的请求……` or an equivalent user-level understanding state.
- Visible DOM does not contain `model_request` or `model request`.

### Scenario C: Network Failure Before Intake

**Goal:** Confirm FRIDAY does not claim the model started processing when connection fails before intake.

Required visual outcome:

- Copy includes `暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。`
- No copy implies FRIDAY understood the user request.

If no deterministic live hook exists, record this as a code/test-backed acceptance item and cite the exact test that covers it.

### Scenario D: Direct Answer

**Goal:** Confirm simple direct answer does not leave a heavy process panel.

Required visual outcome:

- Final answer is the main content.
- No persistent process panel remains.
- No composer task bar remains.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\04-direct-answer-no-process.png"
```

### Scenario E: Task With Process

**Goal:** Confirm full tasks show process while running, then fold after final answer.

Required visual outcome while running:

- Process panel is visible and expanded.
- Current step is highlighted.
- Tool details are folded or summarized.
- UI copy is user-level.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\05-task-process-running-expanded.png"
```

Required visual outcome after completion:

- Process panel is collapsed.
- Final answer is primary.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\06-task-process-completed-folded.png"
```

### Scenario F: No-Flicker Timer

**Goal:** Confirm elapsed timer updates do not remount the process shell.

Run a scenario with a `MutationObserver` attached to `.friday-agent-process-shell` or its stable parent. Wait at least two elapsed ticks.

Expected eval output:

```json
{
  "processAdds": 0,
  "processRemoves": 0
}
```

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\07-running-no-flicker.png"
```

### Scenario G: File Mutation Review In Composer

**Goal:** Confirm pending file changes are reviewed before applying and composer owns the decision.

Inject a current-session pending edit plan. Use the local implementation's actual store API; if available, prefer the same approach as `scripts/verify-friday-agent-surface-isolation.ps1`.

Required visual outcome:

- Composer body is replaced by a decision panel.
- Composer chrome remains visible: model selector, permission mode, `+Skill`, `@`.
- Copy says prepared/pending and `确认后才会写入 Obsidian`.
- Buttons are `应用修改` and `不应用`.
- No `已创建`, `已修改`, `已删除` before approval.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\08-file-mutation-composer-review.png"
```

### Scenario H: High-Risk Approval In Composer

**Goal:** Confirm non-file high-risk approval uses a simple user decision model.

Required visual outcome:

- Composer body is replaced by a decision panel.
- Buttons are `允许执行` and `拒绝`.
- No `Allow once`, `Allow session`, `Allow always`, or `Tool approval required`.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\09-high-risk-approval-composer.png"
```

### Scenario I: Conflict Product Copy

**Goal:** Confirm mutation conflict uses product copy, not engineering diagnostics.

Required visual outcome:

- UI says the file changed before confirmation and FRIDAY needs to recheck.
- No `Before snapshot mismatch`.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\10-conflict-product-copy.png"
```

### Scenario J: Navigate During Work

**Goal:** Confirm user can switch page/session while an agent continues in the background.

Required visual outcome:

- Switch away from chat or switch session while a run is active.
- A compact `FRIDAY 正在运行` or equivalent status remains visible.
- The final answer is persisted to the original session.
- The currently visible session is not polluted by the old turn.

Required screenshot:

```powershell
obsidian vault="test" dev:screenshot path="$outDir\11-background-status-while-navigating.png"
```

Limitation to record:

- If closing the DailyBoard view aborts the run, do not mark this scenario failed unless the implementation claims true background task support. Record it as outside this acceptance scope.

## 7. Task 6: DOM Banned-Term Scan

Run this scan after every GUI scenario.

```powershell
$scan = @'
(()=>{const root=document.querySelector(".friday-daily-board");
if(!root) return "missing";
const terms=[
  "Allow once","Allow session","Allow always","Tool approval required",
  "Waiting for user","Waiting for you","Waiting for approval",
  "Before snapshot mismatch","file change(s) pending review",
  "Pending file changes","Applied file creation","Applied file update","Applied file deletion",
  "checkpoint","model_request","model request","raw reasoning","debug","replay","View replay",
  "Cancel","Continue","Apply","Reject"
];
const matches=[...root.querySelectorAll("*")]
  .filter(el=>terms.some(term=>(el.textContent||"").includes(term)))
  .filter(el=>![...el.children].some(child=>terms.some(term=>(child.textContent||"").includes(term))))
  .map(el=>({tag:el.tagName,className:String(el.className||""),text:(el.textContent||"").replace(/\s+/g," ").trim()}));
return JSON.stringify(matches,null,2);
})()
'@
Invoke-FridayEval $scan
```

Expected:

```json
[]
```

If output is not `[]`, save:

- scenario name;
- screenshot path;
- exact matched DOM text;
- likely code path.

## 8. Task 7: Existing Acceptance Script

If the branch includes `scripts/verify-friday-agent-surface-isolation.ps1`, run it after the broader interaction checks:

```powershell
.\scripts\verify-friday-agent-surface-isolation.ps1
```

or, if artifacts need refresh:

```powershell
.\scripts\verify-friday-agent-surface-isolation.ps1 -RefreshArtifacts
```

Expected:

- artifact hash preflight all `True`;
- plugin reload succeeds;
- screenshots are created;
- DOM banned-term scans return `[]`;
- `obsidian dev:errors` returns `No errors captured.`;
- no-flicker result has `processAdds=0` and `processRemoves=0`.

Do not treat this script as sufficient by itself. It mainly validates ordinary-surface isolation; this plan also requires first response, intake routing, network failure, and navigation-during-work checks.

## 9. Task 8: Evidence Report Template

Create a short report in the implementation window using this structure:

```markdown
# FRIDAY Agent UX Interaction Acceptance Report

Branch:
HEAD:
Verifier:
Date:

## Verdict

- Overall: PASS / PARTIAL / FAIL
- Blocking issues:
- Non-blocking limitations:

## Commands Run

- `git rev-parse --abbrev-ref HEAD` -> ...
- `node --test ...` -> ...
- `npm test` -> ...
- `git diff --check` -> ...
- `scripts/verify-friday-agent-surface-isolation.ps1` -> ...

## Artifact Sync

| file | match | hash |
| --- | --- | --- |
| main.js |  |  |
| styles.css |  |  |
| manifest.json |  |  |

## Scenario Results

| Scenario | Result | Screenshot | DOM scan | Notes |
| --- | --- | --- | --- | --- |
| Local first response | PASS/FAIL | path | [] / matches | |
| Model start state | PASS/FAIL | path | [] / matches | |
| Network failure before intake | PASS/FAIL | path/test | [] / matches | |
| Direct answer | PASS/FAIL | path | [] / matches | |
| Task with process running | PASS/FAIL | path | [] / matches | |
| Completed folded | PASS/FAIL | path | [] / matches | |
| No-flicker timer | PASS/FAIL | path | [] / matches | processAdds/processRemoves |
| File mutation review | PASS/FAIL | path | [] / matches | |
| High-risk approval | PASS/FAIL | path | [] / matches | |
| Conflict copy | PASS/FAIL | path | [] / matches | |
| Navigate during work | PASS/FAIL | path | [] / matches | |

## Code Evidence

- Intake route:
- Local first response:
- Composer approval:
- Process expansion/folding:
- User-facing projection:
- Mutation reason mapping:
- Navigation/background status:

## Findings

### P0

### P1

### P2

## Final Notes

- Any remaining gap versus Claude Code / Codex / Manus philosophy:
- Whether this is implementation gap, test gap, or out-of-scope background-task gap:
```

## 10. Pass/Fail Rules

Mark the whole acceptance as `PASS` only if:

- targeted interaction tests pass;
- `npm test` passes;
- `git diff --check` passes;
- artifact hash check passes before screenshots;
- Obsidian plugin reload has no captured errors;
- all required screenshots exist;
- DOM banned-term scan returns `[]` in ordinary GUI scenarios;
- no-flicker check returns `processAdds=0` and `processRemoves=0`;
- the evidence report identifies code-level ownership, not only visual screenshots.

Mark as `PARTIAL` if:

- most behavior works but one scenario lacks deterministic GUI coverage;
- true background task support is missing but navigation-with-open-view works;
- implementation is correct but test coverage is incomplete.

Mark as `FAIL` if:

- approval does not occupy composer body;
- file mutation copy claims changes are applied before approval;
- first response fakes model understanding before model intake;
- ordinary UI exposes banned engineering terms;
- process panel flickers on elapsed timer updates;
- final answer writes into the wrong session after navigation.

## 11. Handoff Prompt For Another Window

Use this prompt in the verification window:

```text
请在实现工作树中执行这份验收计划：

docs/plans/2026-05-11-friday-agent-ux-interaction-acceptance-plan.zh.md

目标不是继续开发，而是验证 FRIDAY 的 Agent UX 交互设计是否真实落地：用户发送消息后的本地首响、模型开始状态、网络失败前置文案、模型 intake 路由、过程面板运行展开/完成折叠、审批占用 composer、文件修改审批前文案、普通用户界面隔离工程概念、计时刷新不闪烁，以及切换页面/会话时任务继续。

请严格按计划执行：
1. 先确认 branch、HEAD、工作树状态和测试 vault 插件产物 hash。
2. 跑 targeted tests、npm test、git diff --check。
3. 用 Obsidian CLI reload 插件、检查 dev errors。
4. 逐个 GUI 场景截图，并在每个场景后运行 DOM banned-term scan。
5. 输出验收报告，按 PASS / PARTIAL / FAIL 判定。

不要只描述现象；每个失败都要指出问题出在哪个代码边界或工程层。
如果发现缺口，先写证据和建议，不要直接大规模改代码，除非我明确要求你进入修复。
```
