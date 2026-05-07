# Claude Code Grade Tool Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 FRIDAY 的工具层推进到 Claude Code 级别：模型可以用自然的项目内路径调用工具，工具层负责统一解析、权限收敛、结构化失败恢复、可诊断事件和稳定的上下文边界。

**Architecture:** 保持 Kernel v2 的单一 agent loop 不变，在 loop 外围强化 harness：`ToolRegistry -> ToolPathResolver -> CapabilityPolicy/ToolGateway -> ObsidianToolAdapter -> ToolResultFormatter -> TurnEventLog/Checkpoint`。核心原则是宽输入、窄权限、规范输出、可恢复失败、可回放轨迹。

**Tech Stack:** TypeScript, Obsidian plugin runtime, Kernel v2, Node test runner, native/prompt tool calling, TurnEventLog, Agent checkpoint/replay, mutation review.

---

## 1. 背景和结论

当前 FRIDAY 的 kernel 已经具备承载 Claude Code 级工具层的基础：有独立的 `ToolExecutionPort`、`ToolRegistry`、`ToolGateway`、`CapabilityPolicy`、checkpoint、replay 和 task lifecycle。

真正的短板不在模型循环，而在工具层契约：

- 路径解析不统一：`ls/glob/search_text/grep` 对空路径有 active project scope，`read` 不接受常见的 `workspace/...` 项目相对路径。
- 写路径和读路径不对称：`write` 已使用 `resolveAgentWritableVaultPath`，`read/edit/delete` 仍主要依赖各自处理。
- 失败结果太薄：模型只看到字符串错误，缺少 `code`、`recoverable`、`candidatePaths`、`suggestedArgs`。
- trace 不足以诊断：`RuntimeToolTrace` 只有 `targetPath`，没有 `inputPath`、`resolvedPath`、`displayPath`、`projectRoot`。
- max tool iteration 仍可能作为 assistant final text 污染会话历史。
- `AgentRuntimeService` 仍承担太多工具实现细节，不利于长期维护。

本计划不要求一次重写 AgentRuntimeService。我们按阶段把工具层能力从 runtime 内部抽出，先建立可测试 contract，再迁移具体工具行为。

## 2. Claude Code 级工具层标准

参考 `C:\Own Docm\Coding\Friday - Ob\.tmp\learn-claude-code`，成熟 harness 的关键标准是：

1. Agent loop 稳定：模型决定何时调用工具、何时停止；新增工具不改 loop。
2. 工具原子且可组合：每个工具是清晰 handler，schema 明确，输出稳定。
3. 路径安全在工具层完成：模型不用精确理解 vault root、project root、workspace root 的差异。
4. 权限边界独立于模型：读写、外部路径、删除、exec 都必须经过 policy/gateway。
5. 失败可恢复：错误不仅说明失败，还给出可尝试的修正路径或候选项。
6. 上下文干净：旧工具结果可压缩，错误循环不能污染后续历史。
7. 过程可回放：每个 tool call、policy decision、approval、result、checkpoint 都能被 replay 和 UI 解释。
8. 多代理可协作：开发任务和验收任务上下文隔离，验收不依赖开发子代理自述。

## 3. 当前代码落点

核心 loop 和 contract：

- `src/core/agent-kernel/AgentKernel.ts`
- `src/core/agent-kernel/AgentLoopController.ts`
- `src/core/agent-kernel/ToolExecutionPort.ts`
- `src/core/agent-kernel/contracts/AgentTurn.ts`
- `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- `src/core/agent-kernel/RuntimeProtocol.ts`

工具注册、权限和网关：

- `src/core/tools/ToolRegistry.ts`
- `src/core/tools/ToolGateway.ts`
- `src/core/policy/CapabilityPolicy.ts`
- `src/core/tool-governor/ToolGovernor.ts`
- `src/core/execution/ExecutionGate.ts`
- `src/core/execution/ExecutionOrchestrator.ts`

Obsidian runtime 和路径边界：

- `src/services/AgentRuntimeService.ts`
- `src/services/ObsidianKernelRuntimePorts.ts`
- `src/services/WorkspaceAccessService.ts`
- `src/services/ProjectBoundaryService.ts`
- `src/utils/projectWorkspacePolicy.ts`

检查点、任务和回放：

- `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- `src/core/agent-kernel/checkpoints/AgentLoopCheckpointStore.ts`
- `src/core/runtime/TurnEventLog.ts`
- `src/core/runtime/TurnReplayReader.ts`
- `src/core/tasks/AgentTask.ts`
- `src/core/agent-kernel/AgentResumeController.ts`

重点现状：

- `AgentRuntimeService.executeTool` 仍负责 args normalization、target path、gateway、handler、trace、payload。
- `AgentRuntimeService.toolRead/toolList/toolGrep/toolSearchText/toolGlob/toolWrite/toolEdit/toolDelete` 是当前具体工具行为入口。
- `projectWorkspacePolicy.resolveAgentWritableVaultPath` 已经能表达 workspace/raw/wiki 的项目规则，但主要用于写入。
- `PromptContextEngine` 仍在提示模型绕开路径限制，而不是让工具层自然兼容这些路径。

## 4. 子代理模型和角色约定

当前可用子代理角色：

- `explorer`: 只读调查，适合代码映射、风险分析、验收策略。
- `worker`: 执行和生产工作，适合实现代码、测试、修复。
- `default`: 通用子代理。

当前可用模型 override：

- `gpt-5.5`: 复杂架构和高风险集成。
- `gpt-5.4`: 日常强代码任务。
- `gpt-5.4-mini`: 小范围快速修复。
- `gpt-5.3-codex`: 编码优化模型。
- `gpt-5.2`: 长任务和专业工作。

默认策略：

- 一般不显式指定模型，让子代理继承父模型，避免不必要的模型分歧。
- 开发子代理使用 `worker`，写明 owned files，必须直接编辑文件并列出改动路径。
- 验收子代理优先使用 `explorer` 做只读验证；如果需要写回测试修正建议，由主协调者派新的 `worker`。
- 同一阶段最多一个开发子代理写代码，一个验收子代理只读检查。不要让两个 worker 同时改同一批文件。

推荐职责：

- Dev Agent: 实现当前阶段，写 failing tests，最小实现，通过 targeted tests，自检，不碰 release artifacts。
- Validator Agent: 在阶段完成后独立阅读 diff、运行 gate、检查 eval/replay/trace/final answer，不修代码，只输出 findings。
- Coordinator: 负责任务切分、整合验收意见、决定是否返工、维护计划和最终合并门禁。

## 5. 总体架构目标

目标调用链：

```text
model tool call
  -> ToolRegistry schema
  -> ToolInvocationNormalizer
  -> ToolPathResolver
  -> CapabilityPolicy
  -> ToolGateway approval/execution
  -> ObsidianToolAdapter handler
  -> ToolResultFormatter
  -> RuntimeToolTrace + TurnEventLog + model TOOL_RESULT
  -> checkpoint/replay/trajectory
```

目标路径解析：

以下路径只表示形态，不是写死的项目名或文件名。实现必须对任意 active project root、任意子目录、任意文件名成立。

```text
workspace/<subdir>/<file.ext>
<activeProjectRoot>/workspace/<subdir>/<file.ext>
<file.ext>

=> same canonical vault path:
<activeProjectRoot>/workspace/<subdir>/<file.ext>
```

目标失败输出：

这是结构示例，字段语义要稳定，具体值来自当前 vault、active project 和用户输入，不能写死。

```json
{
  "ok": false,
  "tool": "read",
  "status": "failed",
  "failureClass": "invalid_input",
  "code": "vault_file_not_found",
  "recoverable": true,
  "retryable": false,
  "inputPath": "workspace/<subdir>/<file.ext>",
  "projectRoot": "<activeProjectRoot>",
  "candidatePaths": [
    "<activeProjectRoot>/workspace/<subdir>/<file.ext>"
  ],
  "suggestedArgs": {
    "path": "<activeProjectRoot>/workspace/<subdir>/<file.ext>"
  },
  "message": "Vault file was not found at the requested path. A likely active-project path exists."
}
```

## 6. 分阶段实现路线

### Phase 0: Preflight 和冻结范围

目标：确认当前工作区状态、基线测试和脏改范围，避免子代理覆盖用户或其他任务改动。

**Files:**

- Read: `git status --short`
- Read: `package.json`
- Read: `tests/agent-runtime-harness-e2e.test.mjs`
- Read: `tests/project-workspace-policy.test.mjs`
- Read: `tests/evals/agent-scenarios.json`

**Dev Agent instructions:**

- 不修改代码。
- 记录当前 dirty files。
- 确认本计划阶段需要触碰的文件，避免 release/main.js/styles.css/generated artifacts。

**Commands:**

```powershell
git status --short
node --test tests/tool-registry.test.mjs tests/project-workspace-policy.test.mjs
```

**Acceptance:**

- 明确后续阶段允许触碰的源文件和测试文件。
- 如果基线测试已失败，先记录失败，不把失败归因到本计划。

### Phase 1: Tool Result Contract 和 Formatter

目标：建立统一工具结果契约，让模型、UI、replay 和 checkpoint 使用同一份结构化结果。

**Files:**

- Create: `src/core/tools/ToolResultContract.ts`
- Create: `src/core/tools/ToolResultFormatter.ts`
- Modify: `src/core/agent-kernel/ToolExecutionPort.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurn.ts`
- Modify: `src/services/ObsidianKernelRuntimePorts.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/tool-result-formatter.test.mjs`
- Test: `tests/agent-kernel-tool-execution.test.mjs`

**Contract sketch:**

```ts
export type ToolExecutionStatus = "ok" | "failed" | "denied";

export type ToolFailureClass =
  | "invalid_input"
  | "dependency_unavailable"
  | "transport_unstable"
  | "permission_denied"
  | "tool_runtime_error";

export interface ToolRecoveryHint {
  recoverable: boolean;
  retryable: boolean;
  code?: string;
  message?: string;
  suggestedArgs?: Record<string, unknown>;
  candidatePaths?: string[];
}

export interface StructuredToolResult {
  ok: boolean;
  status: ToolExecutionStatus;
  tool: string;
  data?: unknown;
  error?: string;
  failureClass?: ToolFailureClass;
  recovery?: ToolRecoveryHint;
  trace?: {
    inputPath?: string;
    targetPath?: string;
    resolvedPath?: string;
    displayPath?: string;
    projectRoot?: string;
  };
}
```

**Steps:**

1. 写 `tests/tool-result-formatter.test.mjs`，覆盖 success、failed、denied、truncation、candidate paths。
2. 实现 `ToolResultFormatter.formatForModel(result)`，输出 `TOOL_RESULT {...}`。
3. 实现 `ToolResultFormatter.summarizeForTrace(result)`，替代 `AgentRuntimeService.buildSummaryFromData` 的散落逻辑。
4. 扩展 `ToolExecutionPort` payload 类型，但保持旧字段 `ok/tool/data/error` 兼容。
5. 将 `ObsidianKernelRuntimePorts` 改为调用新 formatter。
6. 保留 `AgentRuntimeService.formatToolResultForModel` 作为临时 wrapper，内部委托新模块。

**Targeted commands:**

```powershell
node --test tests/tool-result-formatter.test.mjs
node --test tests/agent-kernel-tool-execution.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
```

**Validator gate:**

- 模型看到的是结构化 `TOOL_RESULT`。
- failed/denied 都有 `status`、`failureClass`、`recoverable`、`retryable`。
- 旧 e2e 不因 payload 扩展而破坏。

### Phase 2: ToolPathResolver

目标：统一 read/list/search/write/edit/delete 的路径解析，解决 active project、workspace、raw、wiki、bare filename 和 external path 的兼容。

**Files:**

- Create: `src/core/tools/ToolPathResolver.ts`
- Modify: `src/utils/projectWorkspacePolicy.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/WorkspaceAccessService.ts` only if permission helper needs a typed reason
- Test: `tests/tool-path-resolver.test.mjs`
- Test: `tests/agent-runtime-project-relative-paths.test.mjs`
- Modify: `tests/project-workspace-policy.test.mjs`

**Resolver contract:**

```ts
export type ToolPathIntent =
  | "read_file"
  | "read_directory"
  | "search"
  | "write_file"
  | "edit_file"
  | "delete_path"
  | "external_read"
  | "exec_cwd";

export interface ToolPathResolution {
  ok: boolean;
  scope: "vault" | "external" | "any";
  inputPath: string;
  normalizedInput: string;
  targetPath: string;
  resolvedPath?: string;
  displayPath: string;
  projectRoot?: string;
  candidates: string[];
  reason?: string;
  code?: string;
  suggestedArgs?: Record<string, unknown>;
}
```

**Resolution rules:**

- If input is absolute path, treat as external and require external read allowlist.
- If active project root exists and input starts with `workspace/`, `raw/`, or `wiki/`, prefix active project root.
- If input already starts with active project root, keep it.
- If input has no slash and exactly one file basename matches inside active project, resolve to that file.
- If input is empty for discovery tools, resolve to active project root.
- If project root is `/`, default generated writes to `workspace/`.
- Write/edit/delete under `<projectRoot>/raw/` must be denied unless explicitly allowed by a future user-facing policy.
- Missing file errors should include candidates when a likely prefixed active-project path exists.

**Example regression fixture:**

下面是可替换测试 fixture，用来表达 active-project-relative path 的行为。实现和测试不应依赖这个项目名、目录名或文件名本身。

```js
files: {
  "ProjectA/workspace/subdir/example.html": "<html>...</html>"
}
projectRoot: "ProjectA"
tool: { name: "read", args: { path: "workspace/subdir/example.html" } }
```

Expected:

- trace `status === "ok"`.
- result data path is canonical vault path.
- model result includes canonical path and no file-not-found error.

**Targeted commands:**

```powershell
node --test tests/tool-path-resolver.test.mjs
node --test tests/agent-runtime-project-relative-paths.test.mjs
node --test tests/project-workspace-policy.test.mjs
node --test tests/agent-runtime-whole-vault-tools.test.mjs
```

**Validator gate:**

- `workspace/...` read/list/glob/search/edit/delete behavior is symmetric where safe.
- Raw writes/edits/deletes remain blocked.
- External writes remain impossible.
- Wrong-case path and bare filename behavior are deterministic.

### Phase 3: Tool Invocation Normalizer 和 Loop Prevention

目标：防止同一 turn 内重复执行同一失败调用，减少 max-tool-iteration 循环。

**Files:**

- Create: `src/core/tools/ToolInvocationNormalizer.ts`
- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Test: `tests/tool-invocation-normalizer.test.mjs`
- Test: `tests/agent-kernel-loop-prevention.test.mjs`
- Modify: `tests/agent-runtime-harness-e2e.test.mjs`
- Modify: `tests/evals/agent-scenarios.json`

**Rules:**

- Normalize tool args before execution and before duplicate detection.
- Same tool name + same normalized args + same failure class cannot execute twice in one turn unless args changed.
- Duplicate recoverable invalid input should return a synthetic failed result with clear explanation and suggested args, not consume real tool IO again.
- `max_tool_iterations` should be an event/state, not a normal final answer body.

**Event additions:**

- Add `tool_resolution` if path resolution is useful as a separate replay point.
- Add `max_tool_iterations` to kernel event contract if not already represented there.
- Ensure legacy `TurnEventLog` and kernel `AgentTurnEvent` do not diverge.

**Targeted commands:**

```powershell
node --test tests/tool-invocation-normalizer.test.mjs
node --test tests/agent-kernel-loop-prevention.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-eval-runner.test.mjs
```

**Validator gate:**

- Repeated bad `workspace/...` path does not execute six times.
- Final user response is actionable and does not contain raw `Maximum tool-iteration limit reached` unless explicitly testing legacy compatibility.
- Turn status is `safe_stopped` only when actual loop budget is exhausted.

### Phase 4: Gateway Audit Object

目标：让 policy、approval、execution、failure 都进入同一个可诊断 decision object。

**Files:**

- Modify: `src/core/tools/ToolGateway.ts`
- Modify: `src/core/policy/CapabilityPolicy.ts`
- Modify: `src/core/tool-governor/ToolGovernor.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/tool-gateway.test.mjs`
- Test: `tests/capability-policy.test.mjs`
- Test: `tests/tool-governor.test.mjs`

**Decision object sketch:**

```ts
export interface ToolExecutionDecision {
  tool: string;
  capability: string;
  scope: "vault" | "external" | "any";
  targetPath: string;
  policy: {
    allow: boolean;
    code?: string;
    reason: string;
    approval: "none" | "standard" | "strict";
  };
  approval?: {
    requested: boolean;
    allowed: boolean;
    persisted: boolean;
    viaRule: boolean;
    reason: string;
  };
  execution: {
    attempted: boolean;
    status: "ok" | "failed" | "denied";
    failureClass?: ToolFailureClass;
  };
}
```

**Targeted commands:**

```powershell
node --test tests/tool-gateway.test.mjs tests/capability-policy.test.mjs tests/tool-governor.test.mjs
node --test tests/native-tool-registry-regression.test.mjs tests/exec-profile-policy.test.mjs
```

**Validator gate:**

- denied tool 不执行 handler。
- approval denied 不执行 handler。
- exec 在 normal mode 不暴露。
- debug profile exec 仍只允许 allowlist。

### Phase 5: ObsidianToolAdapter

目标：把具体工具 handler 从 `AgentRuntimeService` 抽离出来，使 runtime 成为 wiring/state compatibility shell。

**Files:**

- Create: `src/services/tools/ObsidianToolAdapter.ts`
- Create: `src/services/tools/ObsidianToolHandlers.ts`
- Create: `src/services/tools/ObsidianToolContext.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/ObsidianKernelRuntimePorts.ts`
- Test: `tests/obsidian-tool-adapter.test.mjs`
- Modify: `tests/agent-runtime-harness-e2e.test.mjs`

**Migration strategy:**

1. 先抽 pure helper，不改变行为。
2. 再把 `toolList/read/grep/search_text/glob/write/edit/delete/exec/memory/use_skill/compile_wiki` 逐个迁入 adapter。
3. 每迁一个工具，跑对应 e2e。
4. 保留 `AgentRuntimeService` public API，不破坏现有 UI/service wiring。

**Targeted commands:**

```powershell
node --test tests/obsidian-tool-adapter.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
node --test tests/agent-runtime-mutation-review-e2e.test.mjs
node --test tests/memory-tool-runtime-regression.test.mjs
```

**Validator gate:**

- `AgentRuntimeService` 不再拥有大段具体工具 handler 逻辑。
- 所有工具仍通过 registry -> gateway -> adapter。
- mutation review 行为不变。

### Phase 6: Prompt 和 Native Tool Surface 对齐

目标：prompt 示例和工具实际行为一致，减少模型从历史中学习到错误路径。

**Files:**

- Modify: `src/core/context/PromptContextEngine.ts`
- Modify: `src/core/tools/ToolRegistry.ts`
- Test: `tests/prompt-context-engine.test.mjs`
- Test: `tests/native-tool-registry-regression.test.mjs`
- Test: `tests/tool-registry.test.mjs`

**Prompt changes:**

- 删除“模型必须自己用 active project root”的负担。
- 明确工具接受 project-relative paths。
- 示例同时包含 `workspace/test.md` 和 canonical path，但说明工具层会规范化。
- 失败恢复指令：优先使用 `TOOL_RESULT.recovery.suggestedArgs`。

**Targeted commands:**

```powershell
node --test tests/prompt-context-engine.test.mjs
node --test tests/native-tool-registry-regression.test.mjs
node --test tests/tool-registry.test.mjs
```

**Validator gate:**

- Prompt 不再和实际 tool behavior 冲突。
- Native tool description 和 prompt argument lines 一致。

### Phase 7: Checkpoint、Replay 和 Context Hygiene

目标：工具结果可恢复、可压缩、可回放；失败循环和 max iteration 不污染长期上下文。

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/checkpoints/AgentLoopCheckpoint.ts`
- Modify: `src/core/runtime/TurnEventLog.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/context/ToolBoundaryFilter.ts` if needed
- Test: `tests/agent-kernel-checkpoint-resume.test.mjs`
- Test: `tests/agent-kernel-checkpoint-safety.test.mjs`
- Test: `tests/turn-replay-reader.test.mjs`
- Test: `tests/tool-boundary-filter.test.mjs`
- Test: `tests/native-tool-call-history-regression.test.mjs`

**Requirements:**

- Tool result checkpoint includes enough model-facing result to resume without re-running completed tools.
- Failed recoverable result may be checkpointed, but `canAutoResume` must reflect safety.
- Max iteration emits event and safe-stopped status.
- Dirty/dangling tool messages are repaired before next model request.
- Old bulky tool results remain compressible.

**Targeted commands:**

```powershell
node --test tests/agent-kernel-checkpoint-resume.test.mjs tests/agent-kernel-checkpoint-safety.test.mjs
node --test tests/turn-replay-reader.test.mjs tests/tool-boundary-filter.test.mjs
node --test tests/native-tool-call-history-regression.test.mjs
```

**Validator gate:**

- Checkpoint resume never re-executes completed write/edit/delete.
- Replay explains path recovery and loop prevention.
- Raw reasoning, secrets, headers, cookies do not enter checkpoint.

### Phase 8: Eval Scenarios 和 Product Gate

目标：把 Claude Code 级工具层能力固化为 eval，防止未来回退。

**Files:**

- Modify: `tests/evals/agent-scenarios.json`
- Modify: `tests/agent-eval-runner.test.mjs`
- Modify: `docs/plans/agent-eval-quality-gates.md`
- Test: `tests/agent-eval-runner.test.mjs`

**Mandatory scenarios:**

- `project-relative-read-resolves-workspace-path`
- `bare-filename-resolves-unique-active-project-file`
- `ambiguous-bare-filename-returns-candidates`
- `raw-write-denied-with-workspace-suggestion`
- `repeated-invalid-path-does-not-loop`
- `tool-iteration-limit-safe-stop`
- `dirty-tool-history-is-repaired-before-model-request`
- `write-request-creates-mutation-plan`
- `reject-mutation-keeps-file-unchanged`
- `edit-conflict-becomes-conflicted`
- `delete-requires-strict-approval`
- `normal-mode-hides-exec`
- `debug-profile-allows-exec`

**Targeted commands:**

```powershell
node --test tests/agent-eval-runner.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
```

**Final merge gate:**

```powershell
npm test
```

## 7. 开发子代理工作协议

每个阶段派一个 fresh `worker`。

Dev Agent prompt template:

```text
You are the development worker for Phase <N> of the Claude Code grade tool layer plan.

You are not alone in the codebase. Preserve existing uncommitted changes. Do not revert edits you did not make.

Owned files:
- <explicit files>

Do not touch:
- main.js
- release/
- output/
- generated assets
- unrelated UI files

Task:
1. Read the phase section from docs/plans/2026-05-06-claude-code-grade-tool-layer-plan.zh.md.
2. Write failing tests first.
3. Implement the minimal production code.
4. Run targeted commands listed in the phase.
5. Self-review your diff.
6. Return changed file paths, tests run, failures remaining, and any compatibility risks.
```

Development constraints:

- 不并行派两个 worker 修改同一模块。
- 不让 worker 自行扩大范围。
- 每阶段都必须先有测试。
- 阶段失败时，优先返给同一个 worker 修复；如果上下文污染或方向错误，再派 fresh worker。

## 8. 验收子代理工作协议

每个阶段开发完成后派一个 fresh `explorer`。

Validator prompt template:

```text
You are the validation subagent for Phase <N> of the Claude Code grade tool layer plan.

Read-only. Do not edit files.

Validate:
1. Diff matches phase scope.
2. Required tests exist and are meaningful.
3. Targeted commands pass or failures are clearly unrelated baseline failures.
4. Tool result includes ok/status/failureClass/recoverable/retryable where applicable.
5. Path failures include candidate paths or suggested args when recoverable.
6. Replay/event/checkpoint behavior is covered, not just thrown errors.
7. No release artifacts or unrelated generated files were touched.

Return:
- Approved or rejected.
- Findings with file paths and line references.
- Missing tests.
- Commands run and results.
- Residual risks.
```

Validator rejection criteria:

- 只修 prompt，不修 tool contract。
- 只让模型“更努力猜路径”，不让 resolver 兼容路径。
- 失败结果仍只是字符串。
- 新增路径能力绕开 `WorkspaceAccessService` 或 `CapabilityPolicy`。
- 删除/写入/raw/exec 权限被放宽。
- 没有 eval 场景覆盖循环防护。
- max iteration 仍作为正常 final answer 污染历史。

## 9. 阶段门禁总表

Loop gate:

```powershell
node --test tests/agent-kernel-loop.test.mjs
node --test tests/agent-runtime-harness-e2e.test.mjs
```

Tool layer gate:

```powershell
node --test tests/tool-registry.test.mjs tests/tool-gateway.test.mjs tests/tool-governor.test.mjs tests/tool-manifest-capability.test.mjs
node --test tests/native-tool-registry-regression.test.mjs tests/exec-profile-policy.test.mjs
```

Path safety gate:

```powershell
node --test tests/project-workspace-policy.test.mjs tests/agent-runtime-whole-vault-tools.test.mjs tests/agent-eval-runner.test.mjs
```

Replay/checkpoint gate:

```powershell
node --test tests/turn-event-log.test.mjs tests/turn-replay-reader.test.mjs tests/turn-replay-checkpoint-events.test.mjs
node --test tests/agent-kernel-checkpoint-safety.test.mjs tests/agent-kernel-checkpoint-resume.test.mjs
```

Mutation review gate:

```powershell
node --test tests/mutation-plan.test.mjs tests/mutation-applier.test.mjs tests/agent-runtime-mutation-review-e2e.test.mjs
node --test tests/approval-queue.test.mjs
```

Context hygiene gate:

```powershell
node --test tests/token-budget.test.mjs tests/context-assembler-token-budget.test.mjs tests/tool-boundary-filter.test.mjs
node --test tests/native-tool-call-history-regression.test.mjs tests/agent-eval-runner.test.mjs
```

Product task gate:

```powershell
node --test tests/agent-task-lifecycle.test.mjs tests/daily-board-agent-task-ui-regression.test.mjs
node --test tests/agent-process-panel-view-model.test.mjs
```

Final gate:

```powershell
npm test
```

## 10. 风险和非目标

主要风险：

- `AgentRuntimeService` 当前很大，过快抽离会破坏 e2e。
- Windows path、Obsidian normalizePath、大小写兼容需要专门测试。
- Native tool calling 和 prompt envelope 的 tool result message shape 不同，formatter 必须同时保留。
- Checkpoint resume 依赖 model-facing messages，不能过度裁剪工具结果。
- Claude Code 级工具层不等于开放任意 shell。FRIDAY 正常模式仍应隐藏 exec。
- 当前工作区已有大量 dirty files，子代理必须只处理自己阶段文件。

非目标：

- 不在本计划里做 MCP 全量 runtime。
- 不引入任意网络/browser 工具。
- 不改变 Obsidian plugin 发布流程。
- 不把 raw/ 变成 agent 可写目录。
- 不把 maxToolIterations 简单调高来掩盖路径失败。

## 11. 第一批执行建议

第一批只做 Phase 1 和 Phase 2，因为它们直接解决当前用户遇到的工具层问题，并为后续阶段提供 contract。

推荐顺序：

1. Dev Worker A: Phase 1 ToolResultContract + Formatter。
2. Validator A: 验收 Phase 1。
3. Dev Worker B: Phase 2 ToolPathResolver。
4. Validator B: 验收 Phase 2，并重点复现“active project root + workspace-relative path”案例，fixture 名称可任意替换。

暂不启动 Phase 3 之后的 worker，直到 Phase 1/2 通过 targeted tests 和 validator gate。
