# FRIDAY Desktop v0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 Electron-first 桌面壳，做出可运行的 FRIDAY Desktop v0：本地项目、对话、PI runtime、项目资料库、产物画布、权限 trace 和状态恢复跑通。

**Architecture:** 先把现有 Obsidian 插件里的 Agent Kernel、PI runtime、权限、资料、产物和 trace 能力抽象到 Desktop HostAdapter contract 后面。Electron main process 负责 PI runtime、真实文件系统、权限、工具执行、trace 和落盘；preload 暴露受控 typed bridge；renderer 只负责 UI；Obsidian host 后续可以继续作为另一个 host surface。

**Tech Stack:** TypeScript、Electron、现有 npm / esbuild / `node --test` 测试体系、`@earendil-works/pi-agent-core`、现有 FRIDAY Agent Kernel。M2 已确认 v0 选择 Electron-first；M11 前必须补 Electron `BrowserWindow` + preload + renderer GUI smoke。

---

## 0. 执行原则

- 这个计划用于 `codex/friday-desktop-product-vision` 后续派生的实现分支，不直接回 main。
- 每个 milestone 都应由 implementer subagent 完成小粒度改动，再由 reviewer subagent 做 spec review 和 code quality review。
- 每个 milestone 至少有一个可运行验证命令，不能只提交类型或文档。
- 每个 milestone 尽量单独 commit，commit message 使用 `feat(desktop): ...`、`test(desktop): ...` 或 `docs(desktop): ...`。
- v0 不做完整模块市场、团队协作、日历系统、项目 Wiki 知识图谱和高级 Soul agent loop。
- v0 不做临时提权。权限模式是当前对话级，输入框底部显示 `+ · 模型名称 · 标准` 这类控件。
- 技术栈选择必须服务 HostAdapter 能力，不反过来让 Electron / Tauri 决定产品边界。
- M2 已完成技术栈决策：v0 主线是 Electron-first；未完成 Electron `BrowserWindow` + preload + renderer smoke 之前，不进入完整 UI integration。

## 1. 现有能力锚点

第一轮实现必须优先复用或抽象这些现有代码，不要重新发明一套 agent runtime。

| 能力 | 当前代码位置 | 桌面端用途 |
| --- | --- | --- |
| PI runtime | `src/core/agent-kernel/pi/FridayPiRuntime.ts`、`src/core/agent-kernel/pi/FridayPiRuntimePorts.ts`、`src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts` | Desktop 主 Agent Runtime |
| Obsidian PI host 参考 | `src/services/ObsidianFridayPiRuntimeHostAdapter.ts`、`src/services/FridayPiRuntimeStateStore.ts` | Desktop HostAdapter 的反例和复用参考 |
| Runtime 状态 | `src/services/RuntimeStateStore.ts`、`src/services/AgentRuntimeService.ts` | Conversation / Turn / Trace / runtime session 落盘 |
| 权限和工具 | `src/core/policy/CapabilityPolicy.ts`、`src/core/tools/ToolGateway.ts`、`src/services/ToolApprovalService.ts`、`src/core/mutations/*` | 安全 / 标准 / 自主、工具执行、diff 审查 |
| 项目和 Git | `src/features/workbench/ProjectEditorService.ts`、`src/features/workbench/WorkbenchStateStore.ts`、`src/features/sync/SyncOrchestrator.ts`、`src/platform/git/SimpleGitOperator.ts` | ProjectHost、WorkspaceState、GitProfile |
| 资料和引用 | `src/core/context/PromptContextEngine.ts`、`src/core/context/ContextAssembler.ts`、`src/core/context/mention/MentionResolver.ts`、`src/views/components/MentionComposer.ts` | 项目资料库、`@` 引用、回答底部参考文件 |
| 过程展示 | `src/views/agentProcessPanelViewModel.ts`、`src/views/agentTrajectoryRenderer.ts` | Desktop 右侧 FRIDAY 过程区 |
| 旧 host surface | `src/views/DailyBoardView.ts` | 历史遗留 UI，不作为桌面端产品语义中心 |
| Skill / Soul | `src/services/SkillCommandService.ts`、`src/services/SoulStore.ts`、`src/features/soul/*`、`src/types/soul.ts` | v0 列表、启用、引用和设置入口 |

## 2. 目标包结构

第一轮先在现有仓库内建立 host-neutral desktop package，并把 Electron shell 与 renderer 隔离在明确目录下。M2 已选择 Electron-first；v0 先保留在 `src/desktop/`，等可运行后再决定是否移动到 `apps/desktop/`。

```text
src/desktop/
  contracts/
    DesktopHostAdapter.ts
    ProjectHostPort.ts
    FileSystemHostPort.ts
    RuntimeStateHostPort.ts
    PermissionHostPort.ts
    TraceHostPort.ts
    ToolExecutionHostPort.ts
    ArtifactHostPort.ts
    ProjectLibraryHostPort.ts
    SkillHostPort.ts
  host/
    node/
      NodeDesktopHostAdapter.ts
      NodeFileSystemHost.ts
      DesktopProjectHost.ts
      DesktopPermissionHost.ts
      DesktopTraceHost.ts
      DesktopToolExecutionHost.ts
  state/
    WorkspaceStateStore.ts
    ConversationStore.ts
    TurnStore.ts
    ReferenceStore.ts
    ArtifactStore.ts
    ProjectLibraryStore.ts
    ImportStore.ts
  runtime/
    DesktopFridayPiRuntimeHostAdapter.ts
    DesktopRuntimeSmoke.ts
  shell/
    electron/
      main/
      preload/
      adapters/
  ui/
    project-home/
    conversation/
    resources/
    artifact-canvas/

tests/
  desktop-host-adapter-contract.test.mjs
  desktop-shell-electron-smoke.test.mjs
  desktop-project-state-store.test.mjs
  desktop-filesystem-host.test.mjs
  desktop-permission-trace.test.mjs
  desktop-conversation-reference-store.test.mjs
  desktop-artifact-store.test.mjs
  desktop-project-library-store.test.mjs
  desktop-pi-runtime-smoke.test.mjs
```

最小 contract 草案：

```ts
export interface DesktopHostAdapter {
  project: ProjectHostPort;
  fileSystem: FileSystemHostPort;
  runtimeState: RuntimeStateHostPort;
  permissions: PermissionHostPort;
  trace: TraceHostPort;
  tools: ToolExecutionHostPort;
  artifacts: ArtifactHostPort;
  library: ProjectLibraryHostPort;
  skills: SkillHostPort;
}

export type DesktopPermissionMode = "safe" | "standard" | "autonomous";

export interface DesktopTurnContext {
  projectId: string;
  conversationId: string;
  turnId: string;
  permissionMode: DesktopPermissionMode;
  projectRoot: string;
}
```

## M0. Baseline and Constraints

**目标：** 先证明当前分支能安装、测试和构建。如果 baseline 失败，先分类记录，不进入桌面端改造。

**Files:**
- Read: `package.json`
- Read: `tsconfig.json`
- Read: `tests/*.mjs`
- Optional create: `docs/plans/friday-desktop/implementation-notes/2026-06-11-baseline.zh.md`

**Steps:**

1. Run: `git status --short --branch`
2. Run: `npm install`
3. Run: `npm test`
4. Run: `npm run build`
5. 如果失败，按 `环境问题 / 既有测试失败 / 新分支冲突 / PI SDK 阻塞` 分类记录到 baseline note。
6. 如果通过，commit baseline note 或直接进入 M1。

**Expected verification:**

```powershell
npm test
npm run build
git status --short --branch
```

## M1. Desktop HostAdapter Ports

**目标：** 定义 Desktop Runtime 能请求什么，不绑定 Electron / Tauri，也不让 Runtime 直接触碰文件系统、命令、Git 或 UI。

**Files:**
- Create: `src/desktop/contracts/DesktopHostAdapter.ts`
- Create: `src/desktop/contracts/ProjectHostPort.ts`
- Create: `src/desktop/contracts/FileSystemHostPort.ts`
- Create: `src/desktop/contracts/RuntimeStateHostPort.ts`
- Create: `src/desktop/contracts/PermissionHostPort.ts`
- Create: `src/desktop/contracts/TraceHostPort.ts`
- Create: `src/desktop/contracts/ToolExecutionHostPort.ts`
- Create: `src/desktop/contracts/ArtifactHostPort.ts`
- Create: `src/desktop/contracts/ProjectLibraryHostPort.ts`
- Create: `src/desktop/contracts/SkillHostPort.ts`
- Test: `tests/desktop-host-adapter-contract.test.mjs`

**Steps:**

1. 写 contract test，验证 `DesktopHostAdapter` 必须暴露 project、fileSystem、runtimeState、permissions、trace、tools、artifacts、library、skills。
2. Run: `node --test tests/desktop-host-adapter-contract.test.mjs`，预期失败。
3. 创建 `src/desktop/contracts/*`，只放类型、枚举和轻量 helper，不做真实 IO。
4. 在 `DesktopHostAdapter.ts` 统一导出所有 ports。
5. Run: `node --test tests/desktop-host-adapter-contract.test.mjs`，预期通过。
6. Run: `npm test`。
7. Commit: `feat(desktop): define host adapter ports`

**Contract scope:**

- ProjectHostPort: 当前项目、项目根目录、`FRIDAY/` 初始化、GitProfile。
- FileSystemHostPort: 项目内文件读写、外部文件 import 快照、路径归一化、原子写入。
- RuntimeStateHostPort: Conversation、Turn、Trace、Reference、Artifact、WorkspaceState。
- PermissionHostPort: 安全 / 标准 / 自主、turn permission snapshot、拒绝和停止。
- TraceHostPort: 结构化 trace event append、query、replay。
- ToolExecutionHostPort: shell、Git、文件工具、后续模块工具的执行边界。
- ArtifactHostPort: 产物 manifest、版本文件、打开项目文件 wrapper。
- ProjectLibraryHostPort: 资料库登记、说明、启用状态、项目文件树。
- SkillHostPort: 项目技能、全局技能、启用状态、composer 引用。

## M2. Desktop Shell Tech Spike

**目标：** 用 HostAdapter 能力需求反推桌面壳技术，而不是先选择壳。M2 结论已经更新为：v0 选择 Electron-first；Tauri + Node sidecar 保留为后续平台化方向，不进入当前主线。

**Files:**
- Create: `docs/plans/friday-desktop/adr/2026-06-11-desktop-shell-tech-spike.zh.md`
- Create: `spikes/desktop-shell/smoke.mjs`
- Test: `tests/desktop-shell-tech-spike.test.mjs`

**Steps:**

1. 列出 v0 需要的真实 host 能力：文件系统、命令执行、窗口、拖拽、剪贴板、原生菜单、本地 WebView、权限提示、日志路径、自动更新后移。
2. 验证 Electron main process 所需 Node 原语：Node 22+、PI SDK import、最小 PI session、shell command、文件读写和本地日志。
3. 在 ADR 中明确 Electron、Tauri-only、Tauri + Node sidecar 三个选项的差异。
4. 记录 v0 推荐技术栈：Electron shell，main process 承载 Node/PI runtime。
5. 记录后续风险：Electron GUI smoke、renderer 隔离、命令权限、路径边界和 Windows 打包。
6. Run: `node --test tests/desktop-shell-tech-spike.test.mjs`。
7. Run: `node spikes/desktop-shell/smoke.mjs`。
8. Run: `npm test`，确保 spike 不污染现有插件构建。
9. Commit: `docs(desktop): record shell technology spike`

**Decision result:**

- 选择 Electron-first。
- Electron main process 负责窗口、菜单、Node runtime、PI SDK、文件系统、shell、Git、trace、state persistence 和 HostAdapter implementations。
- Preload 负责暴露 typed bridge。
- Renderer 不直接触碰 Node、fs、child_process、Electron API 或 PI SDK。
- M11 前必须补真实 Electron `BrowserWindow` + preload + renderer smoke。

## M3. ProjectHost and WorkspaceState

**目标：** 桌面端可以识别一个本地项目，初始化 `FRIDAY/`，读取项目主页所需状态，并恢复上次打开项目。

**Files:**
- Create: `src/desktop/host/node/DesktopProjectHost.ts`
- Create: `src/desktop/state/WorkspaceStateStore.ts`
- Create: `src/desktop/state/ProjectManifestStore.ts`
- Test: `tests/desktop-project-state-store.test.mjs`
- Reference: `src/features/workbench/ProjectEditorService.ts`
- Reference: `src/features/workbench/WorkbenchStateStore.ts`

**Steps:**

1. 写测试：空临时目录调用 `initializeProject()` 后生成 `FRIDAY/project.json` 和必要目录。
2. 写测试：已有项目再次打开时不移动原文件，只读取 manifest 和 workspace state。
3. 写测试：`WorkspaceStateStore` 保存 `activeProjectId`、`activeConversationId`、`activeArtifactId`、`layout`、`resourcePanelState`。
4. Run: `node --test tests/desktop-project-state-store.test.mjs`，预期失败。
5. 实现 `DesktopProjectHost` 和 `WorkspaceStateStore`。
6. Run: `node --test tests/desktop-project-state-store.test.mjs`，预期通过。
7. Run: `npm test`。
8. Commit: `feat(desktop): add project host and workspace state`

**Minimum disk layout:**

```text
FRIDAY/
  project.json
  context/
  artifacts/
  imports/
  archive/
  skills/
  conversations/
  traces/
  references/
  state/
  runtime/
  local/
```

## M4. FileSystemHost and RuntimeState Store

**目标：** 所有项目文件、FRIDAY 管理文件和外部 import 都经由 Desktop FileSystemHost 访问，避免 Runtime 直接读写路径。

**Files:**
- Create: `src/desktop/host/node/NodeFileSystemHost.ts`
- Create: `src/desktop/state/DesktopRuntimeStateStore.ts`
- Create: `src/desktop/state/ImportStore.ts`
- Test: `tests/desktop-filesystem-host.test.mjs`
- Reference: `src/services/RuntimeStateStore.ts`
- Reference: `src/services/FridayPiRuntimeStateStore.ts`

**Steps:**

1. 写测试：项目内文件以相对路径读取，不能通过 `..` 越界。
2. 写测试：项目外文件通过 `importExternalFile()` 复制到 `FRIDAY/imports/<conversationId>/<importId>/`。
3. 写测试：`FRIDAY/imports/<conversationId>/<importId>/import.json` 保存原路径、hash、mime、createdTurnId。
4. 写测试：`writeManagedFile()` 对 `FRIDAY/` 内文件使用原子写入。
5. Run: `node --test tests/desktop-filesystem-host.test.mjs`，预期失败。
6. 实现 `NodeFileSystemHost`、`DesktopRuntimeStateStore`、`ImportStore`。
7. Run: `node --test tests/desktop-filesystem-host.test.mjs`，预期通过。
8. Run: `npm test`。
9. Commit: `feat(desktop): add filesystem host and imports`

**Rules:**

- 项目根目录和现有文件树是直接信息来源，不复制项目内文件。
- 通过 `+` 添加的项目外文件必须复制快照。
- `imports/` 默认不进入项目资料库。
- 归档对话时，`FRIDAY/imports/<conversationId>/` 随对话一起移动。

## M5. PermissionHost, TraceHost and ToolExecution Boundary

**目标：** 安全 / 标准 / 自主三档权限进入工程模型，并让工具调用、读写文件、命令执行和拒绝全部进入 trace。

**Files:**
- Create: `src/desktop/host/node/DesktopPermissionHost.ts`
- Create: `src/desktop/host/node/DesktopTraceHost.ts`
- Create: `src/desktop/host/node/DesktopToolExecutionHost.ts`
- Create: `src/desktop/state/TraceStore.ts`
- Test: `tests/desktop-permission-trace.test.mjs`
- Reference: `src/core/policy/CapabilityPolicy.ts`
- Reference: `src/core/tools/ToolGateway.ts`
- Reference: `src/services/ToolApprovalService.ts`
- Reference: `src/core/mutations/*`

**Steps:**

1. 写测试：`safe` 模式下真实项目文件写入、命令、网络、删除都需要确认。
2. 写测试：`standard` 模式下项目内读取和 `FRIDAY/artifacts/` 保存可直接执行，真实项目文件写回必须生成审查动作。
3. 写测试：`autonomous` 模式对齐 Codex full access，在本机账号权限内允许文件、命令、网络、Git 和依赖安装。
4. 写测试：每次拦截、确认、拒绝、执行开始、成功、失败、取消都会 append trace event。
5. Run: `node --test tests/desktop-permission-trace.test.mjs`，预期失败。
6. 实现 PermissionHost、TraceHost、ToolExecutionHost 的最小闭环。
7. 接入现有 `CapabilityPolicy` 和 `ToolGateway`，不要绕过既有工具治理。
8. Run: `node --test tests/desktop-permission-trace.test.mjs`，预期通过。
9. Run: `npm test`。
10. Commit: `feat(desktop): add permission and trace boundary`

**Permission contract:**

```ts
export interface PermissionDecision {
  allowed: boolean;
  requiresReview: boolean;
  reason?: string;
  traceEventId: string;
}
```

## M6. Conversation, Turn and Reference Store

**目标：** 对话可以按历史完整恢复；用户 `@` 引用、FRIDAY 实际读取、回答底部参考文件和 trace source 分开落盘。

**Files:**
- Create: `src/desktop/state/ConversationStore.ts`
- Create: `src/desktop/state/TurnStore.ts`
- Create: `src/desktop/state/ReferenceStore.ts`
- Create: `src/desktop/state/AnswerReferenceBuilder.ts`
- Test: `tests/desktop-conversation-reference-store.test.mjs`
- Reference: `src/core/context/mention/MentionResolver.ts`
- Reference: `src/views/components/MentionComposer.ts`
- Reference: `src/core/context/ContextAssembler.ts`

**Steps:**

1. 写测试：创建 conversation 后生成 `FRIDAY/conversations/<conversationId>/conversation.json`。
2. 写测试：每轮 turn 写入 `turns/<turnId>.json`，发送后 composer snapshot 冻结，输入框下一轮必须清空。
3. 写测试：Explicit Reference、Resolved Reference、Trace Source、Answer Reference 分不同字段或文件保存。
4. 写测试：Answer Reference 使用候选来源池加受限筛选，展开字段只有文件类型、文件名、来源类型。
5. 写测试：归档 conversation 时，conversation 目录和 imports 目录一起转入 archive。
6. Run: `node --test tests/desktop-conversation-reference-store.test.mjs`，预期失败。
7. 实现 stores 和 `AnswerReferenceBuilder`。
8. Run: `node --test tests/desktop-conversation-reference-store.test.mjs`，预期通过。
9. Run: `npm test`。
10. Commit: `feat(desktop): add conversation and reference stores`

**Answer Reference rules:**

- 来源类型先收敛为 `@引用`、`FRIDAY 读取`、`当前产物`、`选区`。
- 同一文件按 `targetType + targetUri` 去重。
- 默认不显示完整路径，完整路径只属于 UI hover / right click。
- `AnswerReference` 跟随 assistant turn 冻结，后续文件变化不改历史引用。

## M7. ArtifactStore and Canvas State

**目标：** 产物作为对话页面里的组件存在，支持生成文件、打开已有可显示文件、版本 manifest 和下次恢复。

**Files:**
- Create: `src/desktop/state/ArtifactStore.ts`
- Create: `src/desktop/state/CanvasStateStore.ts`
- Test: `tests/desktop-artifact-store.test.mjs`
- Reference: `src/core/mutations/*`

**Steps:**

1. 写测试：生成产物时创建 `FRIDAY/artifacts/<artifactId>/artifact.json` 和 `files/`。
2. 写测试：artifact manifest 记录 `conversationId`、`artifactType`、`renderable`、`currentVersionId`、`source`、`versions[]`。
3. 写测试：打开项目内已有可显示文件时创建轻量 wrapper，`storageMode` 为 `project_file_reference`，不复制原文件。
4. 写测试：当前 conversation 的 artifact list 只显示该对话产物。
5. 写测试：canvas state 恢复 active artifact 和 tab 顺序。
6. Run: `node --test tests/desktop-artifact-store.test.mjs`，预期失败。
7. 实现 `ArtifactStore` 和 `CanvasStateStore`。
8. Run: `node --test tests/desktop-artifact-store.test.mjs`，预期通过。
9. Run: `npm test`。
10. Commit: `feat(desktop): add artifact store and canvas state`

**Rules:**

- FRIDAY 新生成的文件默认先是产物，保存到 `FRIDAY/artifacts/`。
- 用户可选择把产物加入项目资料库，或写入项目文件树指定位置。
- 产物不在项目主页作为一级管理模块显示，只在对话视图出现。

## M8. Project Library, File Tree and Imports

**目标：** 项目资料库以项目文件树为直接信息来源，只登记文件成为资料，不复制项目内已有文件。

**Files:**
- Create: `src/desktop/state/ProjectLibraryStore.ts`
- Create: `src/desktop/state/ProjectFileTreeReader.ts`
- Test: `tests/desktop-project-library-store.test.mjs`
- Reference: `src/core/context/PromptContextEngine.ts`
- Reference: `src/core/context/ContextAssembler.ts`

**Steps:**

1. 写测试：读取项目文件树时排除 `FRIDAY/local/`、运行缓存和可配置忽略项。
2. 写测试：勾选项目内文件加入资料库时只写 metadata，记录相对路径、说明、启用状态、摘要字段占位。
3. 写测试：已加入资料库的文件在文件树中显示浅色勾选状态。
4. 写测试：从外部导入资料时先复制到 import，再由用户选择是否纳入资料库。
5. 写测试：项目资料库完整页左侧是文件树，右侧是已加入资料库的文件列表及说明。
6. Run: `node --test tests/desktop-project-library-store.test.mjs`，预期失败。
7. 实现 store 和 file tree reader。
8. Run: `node --test tests/desktop-project-library-store.test.mjs`，预期通过。
9. Run: `npm test`。
10. Commit: `feat(desktop): add project library store`

**UI contract for later:**

- 资料库首页只显示 `已配置 xx 份资料`。
- 完整视图不做推荐。
- 右侧资源窗口的资料库 tab 只显示文件类型和文件名，并保留“进入项目资料库”按钮。
- 文件树 tab 支持点击文件打开到画布，右键只显示“在画布中打开”和“添加到对话”。

## M9. Skill and Soul Minimal Surface

**目标：** v0 只做项目技能、全局技能、启用状态和 composer 引用，不做模块协议和高级 Soul loop。

**Files:**
- Create: `src/desktop/state/DesktopSkillStore.ts`
- Create: `src/desktop/state/DesktopSoulStateStore.ts`
- Test: `tests/desktop-skill-soul-store.test.mjs`
- Reference: `src/services/SkillCommandService.ts`
- Reference: `src/services/SoulStore.ts`
- Reference: `src/features/soul/*`

**Steps:**

1. 写测试：项目技能从 `FRIDAY/skills/` 读取，全局技能从本机全局 skills 目录读取。
2. 写测试：技能列表项只需要名称、说明、scope、enabled、sourcePath。
3. 写测试：项目技能可以被标记为可提升到全局，但 v0 不自动复制。
4. 写测试：点击技能只把它作为 `@技能` 加入当前输入，不直接执行。
5. 写测试：Soul 只恢复现有 basic profile，不暴露高级 loop 编辑。
6. Run: `node --test tests/desktop-skill-soul-store.test.mjs`，预期失败。
7. 实现 stores。
8. Run: `node --test tests/desktop-skill-soul-store.test.mjs`，预期通过。
9. Run: `npm test`。
10. Commit: `feat(desktop): add skill and soul stores`

## M10. PI Runtime Through Desktop Host

**目标：** 证明 PI SDK 可以通过 Desktop HostAdapter 跑最小 session，而不是只在 Obsidian host 里可用。

**Files:**
- Create: `src/desktop/runtime/DesktopFridayPiRuntimeHostAdapter.ts`
- Create: `src/desktop/runtime/DesktopRuntimeSmoke.ts`
- Test: `tests/desktop-pi-runtime-smoke.test.mjs`
- Reference: `src/core/agent-kernel/pi/FridayPiRuntime.ts`
- Reference: `src/core/agent-kernel/pi/FridayPiRuntimePorts.ts`
- Reference: `src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts`
- Reference: `tests/real-pi-sdk-session-adapter.test.mjs`
- Reference: `tests/friday-pi-runtime.test.mjs`

**Steps:**

1. 写 smoke test：创建临时项目，初始化 DesktopHostAdapter，创建 PI session。
2. 写 smoke test：发送最小 prompt，能收到 stream event。
3. 写 smoke test：工具 trace 能通过 `TraceHostPort` 落盘。
4. 写 smoke test：session dispose 后 runtime state 可保存。
5. Run: `node --test tests/desktop-pi-runtime-smoke.test.mjs`，预期失败。
6. 实现 `DesktopFridayPiRuntimeHostAdapter`，把 PI runtime port 请求映射到 Desktop host ports。
7. Run: `node --test tests/desktop-pi-runtime-smoke.test.mjs`，预期通过或在缺少真实模型凭据时明确 skip 原因。
8. Run: `npm test`。
9. Run: `npm run build`。
10. Commit: `feat(desktop): run pi runtime through desktop host`

**Acceptance:**

```text
prompt -> stream event -> trace event -> persisted session -> dispose
```

## M11. UI Integration Smoke

**目标：** 在选定桌面壳或本地 Web shell 中跑通项目主页、对话页、资源窗口、产物画布和输入框权限控件的最小闭环。

**Files:**
- Create or modify after M2 decision: `apps/desktop/src/*` or `src/desktop/ui/*`
- Test: `tests/desktop-ui-state-smoke.test.mjs`
- Reference: `docs/plans/friday-desktop/index.html`
- Reference: `docs/plans/friday-desktop/previews/codex-reference-workbench.html`
- Reference: `docs/plans/friday-desktop/previews/no-canvas-workbench.html`
- Reference: `docs/plans/friday-desktop/previews/composer-permission-toolbar.html`

**Steps:**

1. 实现全局左 rail：搜索、项目、团队、日历、模块、Soul、设置。
2. 实现项目第二层菜单：当前项目、返回项目主页、本项目对话、底部资料库 / Wiki / 技能入口。
3. 实现项目主页：输入框、对话列表、资料库摘要、技能摘要、Wiki 占位、日历占位、协作和远端状态占位。
4. 实现对话页无画布状态：主区显示完整对话，右侧资源窗口可切换资料库、文件树、技能、产物。
5. 实现对话页有画布状态：主区显示 artifact canvas，右侧 FRIDAY 过程区保持完整对话和 trace，资源窗口由标题行 icons 触发悬浮展示。
6. 实现 composer toolbar：`+ · 模型名称 · 当前权限模式`。
7. 用 Browser 或 Computer Use 做截图验收，检查文字不重叠，资源入口位置符合当前 HTML 定稿。
8. Run: `npm test`。
9. Run: `npm run build`。
10. Commit: `feat(desktop): add v0 workbench smoke UI`

**UI rules:**

- 视觉基于 FRIDAY VI：Graphite、Warm Bone、Muted Teal、Stone、Accent。
- 不 1:1 复制 Codex 视觉，只参考多面板桌面 Agent 工作台结构。
- 资源入口是一排与对话标题平行的 icons，下方共用资源窗口。
- Wiki 不在当前对话资源窗口显示，当前第二个 tab 是项目文件树。

## M12. Final Verification

**目标：** 证明 v0 runtime skeleton、HostAdapter、权限、trace、资料库、产物和恢复路径能连起来。

**Files:**
- Read: all changed files
- Update if needed: `docs/plans/friday-desktop/2026-06-08-friday-desktop-product-master-plan.zh.md`
- Update if needed: `docs/plans/friday-desktop/2026-06-08-friday-desktop-product-decisions.zh.md`

**Steps:**

1. Run: `npm test`
2. Run: `npm run build`
3. Run runtime smoke：创建项目 -> prompt -> stream event -> trace -> artifact -> persisted session。
4. Run restore smoke：关闭 shell -> 重新打开 -> 恢复 active project、active conversation、active artifact、resource panel state。
5. Run archive smoke：归档 conversation -> imports 同步归档 -> 对话列表隐藏 -> 恢复后回到活跃列表。
6. Run UI smoke：项目主页、无画布对话页、有画布对话页、资料库页、composer 权限控件。
7. Review diff，确认没有把旧 `DailyBoardView` 产品语义继续扩散到 Desktop。
8. Commit final docs or cleanup changes。
9. Push branch。

**Final commands:**

```powershell
npm test
npm run build
git diff --check
git status --short --branch
```

## 3. 第一轮执行建议

第一轮不要直接做完整 UI。建议按这个顺序启动：

1. M0 baseline。
2. M1 HostAdapter ports。
3. M2 Desktop shell tech spike，确认 Electron-first。
4. M3 ProjectHost / WorkspaceState。
5. M4 FileSystemHost / ImportStore。
6. M5 Permission / Trace / ToolExecution。
7. M10 PI Runtime through Desktop Host。

原因：M1 先定义 FRIDAY 需要的 host 能力，M2 确认桌面壳和 runtime ownership，M3 到 M10 再证明“FRIDAY Desktop 是否真的能作为 PI-first Runtime host 跑起来”。等 runtime skeleton 可跑，再做 M6 到 M9 的对象完善和 M11 的 UI 集成，成本更可控。

## 4. 暂缓项

以下内容不进入本计划第一轮实现：

- 项目 Wiki 知识图谱的节点 / 关系模型。
- 团队协作、组织权限、云账号。
- 日历真实任务、会议、排期模型。
- 模块协议、社区 marketplace、Module Builder。
- 高级 Soul agent loop、用户自定义底层 Agent 行为。
- 发布安装包、自动更新、跨平台安装器。

这些内容保留在产品愿景和后续专项规划里，不能作为 v0 验收阻塞项。
