# Agent Kernel v2 旧 Runtime 退场 Checklist

英文版：`docs/plans/agent-kernel-v2-retirement-checklist.md`。
中文版：本文件。

## 范围

Batch J 是退场门禁，不是新增功能批次。目标是证明 Kernel v2 已经是默认 Agent 执行路径，并且旧 runtime 代码只作为明确的兼容壳保留。

## Default execution path

默认路径是：

```text
UI command or Daily Board action
  -> ExecutionOrchestrator
  -> AgentRuntimeFacade
  -> AgentKernel
  -> AgentLoopController
  -> ObsidianKernelRuntimePorts
  -> ObsidianAgentStateAdapter
```

默认路径不得实例化 `LegacyAgentRuntimeAdapter`，也不得调用 `AgentRuntimeService.runTurn`。

## 身份门禁

默认路径必须用同一个 Kernel `AgentExecutionContext` 贯穿 task、replay、approval、resume、mutation、model 和 tool events：

- `taskId`
- `traceId`
- `budget`

该门禁由 `tests/agent-kernel-v2-default-path.test.mjs` 覆盖。

## Allowed legacy runtime references

| 文件 | 状态 | 保留原因 |
| --- | --- | --- |
| `src/services/AgentRuntimeService.ts` | 暂时允许 | Obsidian adapter shell，用于 vault IO、settings、tool handlers、mutation apply IO 和 UI compatibility facades。它必须带有 `LEGACY_RUNTIME_RETIREMENT_ALLOWED` 标记，且不能作为默认整轮执行引擎。 |
| `src/services/LegacyAgentRuntimeAdapter.ts` | 暂时允许 | migration shim，只能用于显式 legacy fallback 或兼容测试。它必须带有 `LEGACY_RUNTIME_RETIREMENT_ALLOWED` 标记。 |
| `tests/**` | 允许 | 边界测试可以引用旧 runtime 名称，用于防止默认路径回退。 |
| `docs/**` | 允许 | 文档必须解释为什么仍保留任何 legacy shell。 |

任何新的 production `LegacyAgentRuntimeAdapter` 引用，或默认路径对 `AgentRuntimeService.runTurn` 的直接调用，都必须让 retirement gate 失败。

## Batch J 后不允许

- `src/core/agent-kernel/**` import 或命名 `AgentRuntimeService`。
- `src/main.ts` 接入 `LegacyAgentRuntimeAdapter`。
- `ExecutionOrchestrator` 依赖 `AgentRuntimeService`。
- production UI 直接调用 `AgentRuntimeService.runTurn`。
- 默认路径绕开 Kernel-owned mutation、replay、task 或 approval boundary。

## 剩余 legacy responsibility inventory

| 职责 | 当前位置 | 退场决策 |
| --- | --- | --- |
| model/tool loop ownership | `AgentLoopController` | 已迁入 Kernel v2；旧方法只能作为非默认兼容能力保留。 |
| task lifecycle | `AgentTaskManager` through `ObsidianAgentStateAdapter` | 已迁入 Kernel v2。 |
| replay recording | `AgentReplayRecorder` through `ObsidianAgentStateAdapter` | 已迁入 Kernel v2。 |
| approval state | `AgentTaskManager` / `HumanApprovalPort` boundary | 已迁入 Kernel v2。 |
| mutation planning and review events | `AgentMutationCoordinator` through `ObsidianAgentStateAdapter` | 已迁入 Kernel v2。 |
| vault IO and tool handlers | `AgentRuntimeService` adapter shell | 暂时保留，后续可拆成更小的 Obsidian adapter services。 |
| settings/project boundary access | `AgentRuntimeService` and `ObsidianKernelRuntimePorts` | 作为 adapter 职责暂时保留。 |
| UI compatibility methods | `AgentRuntimeService` | 作为现有 UI 调用的 facade methods 暂时保留。 |

## 必跑测试

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

## 验收规则

Batch J 只有在 static retirement gate 和 product parity tests 都通过，且没有削弱 harness/eval 覆盖时，才算通过。
