# FRIDAY 桌面端产品落地实施计划

> **For Codex/Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 基于 PI-first runtime 分支，把 FRIDAY 从 Obsidian 插件形态推进到可独立运行的桌面端，并让长期的模块平台、Module Builder 和 Soul 扩展愿景有可执行落地点。

**Architecture:** 第一阶段不把 Obsidian 删除，而是把 Obsidian 降级为一个 host surface；桌面端成为新的主 host。核心 runtime 继续复用 `AgentKernel`、`FridayPiRuntime`、PI SDK adapter、tool trace、state persistence 和 SoulStore 的可复用部分，同时新增 Desktop HostAdapter、桌面 shell、模块注册表和模块页面。

**Tech Stack:** TypeScript、Electron 桌面壳、现有 esbuild/Node test runner、`@earendil-works/pi-agent-core`、FRIDAY Agent Kernel、FRIDAY Native Kit、Obsidian plugin bundle 作为兼容 host。

---

## 0. 当前基线

新分支从 `codex/friday-pi-runtime-rebuild` 的本地 HEAD 创建，包含以下基础：

- `src/core/agent-kernel/pi/FridayPiRuntime.ts`：PI runtime executor contract。
- `src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts`：真实 PI SDK session adapter。
- `src/services/ObsidianFridayPiRuntimeHostAdapter.ts`：Obsidian host bridge。
- `src/services/FridayPiRuntimeStateStore.ts`：PI session、tool trace、package metadata 和 workspace policy 的持久化基础。
- `src/services/SoulStore.ts` 与 `src/features/soul/*`：Soul 的本地定义、模板和 profile 基础。
- `src/views/DailyBoardView.ts`：现有主界面，但命名和职责已经是历史遗留问题。
- `docs/plans/2026-06-06-friday-desktop-module-platform-vision.zh.md`：长期产品愿景记录。

基线验证命令：

```powershell
npm install
npm test
npm run build
```

当前已知事项：

- `npm test` 会运行 TypeScript、esbuild 和 Node tests。
- `npm run build` 会刷新 plugin release artifacts。
- 构建脚本可能改动生成快照或发布日期；桌面端计划提交前只保留和本计划直接相关的变更。
- `npm install` 当前会报告 npm audit 风险，但这不是桌面端分支的第一阻塞项。

## 1. 产品落地形态

桌面端第一版不做完整 marketplace，也不做完整 Obsidian 替代品。它要先证明 FRIDAY 可以作为独立 host 运行：

- 左侧主导航：`工作台`、`模块`、`Soul`、`项目`、`设置`。
- 工作台：聊天输入、任务过程、tool trace、审批、结果 artifact。
- 模块页：本地模块、已安装模块、社区候选模块、草稿模块。
- Soul 页：从 prompt/persona 扩展到可配置的 agent 行为画像。
- 项目页：Vault 和项目路径作为默认可信边界，外部路径继续显式处理。
- 设置页：模型、PI runtime source、权限、存储位置、开发者模式。

第一版桌面端的产品定义：

```text
FRIDAY Desktop = 独立桌面 Host + PI-first Runtime + 本地项目权限 + 模块/Soul 管理入口
Obsidian Plugin = 兼容 surface，不再是唯一产品中心
```

## 2. 实施原则

1. 先做可运行桌面壳，再做完整产品闭环。
2. 先抽 host contract，再迁移复杂业务。
3. `DailyBoardView` 只作为现有 surface 的实现细节，不再承载新的产品语义。
4. 桌面端的 v0 必须可以打开、加载本地状态、显示 runtime 诊断、运行最小 prompt smoke。
5. 模块系统第一阶段只允许声明式模块，不允许任意远程代码执行。
6. 社区能力先做 source review 和 schema absorption，不直接全量 host 外部 package。
7. 所有写入、shell、外部路径、网络和应用集成都必须经过 FRIDAY 的权限/审批层。

## 3. 目标里程碑

### M0: 新分支和基线

目标：建立桌面端工作的独立分支和 clean baseline。

验收：

- 新分支基于 `codex/friday-pi-runtime-rebuild`。
- 新 worktree 可运行 `npm install`、`npm test`、`npm run build`。
- 工作树干净。
- 本计划文档提交到新分支。

### M1: 可启动桌面壳

目标：新增 Electron 桌面入口，不接复杂 runtime 也要能打开真实窗口。

用户可见结果：

- `npm run desktop:dev` 打开 FRIDAY Desktop 窗口。
- 第一屏是工作台，不是营销页。
- 页面包含主导航、工作台区域、运行状态条和设置入口。

技术结果：

- 新增 `desktop/main.ts`：Electron main process。
- 新增 `desktop/preload.ts`：安全 preload bridge。
- 新增 `desktop/renderer/index.html` 和 `desktop/renderer/App.ts`。
- 新增 `scripts/desktop-dev.mjs` 和 `scripts/desktop-build.mjs`。
- `package.json` 增加 `desktop:dev`、`desktop:build`、`desktop:test`。
- renderer 不直接 import Obsidian API。

测试：

```powershell
npm run desktop:build
node --test tests/desktop-*.mjs
```

### M2: Host Surface contract

目标：把 Obsidian 相关 surface 和 Desktop surface 拆成同一个产品 contract 的两个实现。

新增文件：

- `src/platform/host/FridayHostSurface.ts`
- `src/platform/host/FridayHostAdapter.ts`
- `src/platform/host/FridayWorkspacePolicy.ts`
- `src/platform/host/FridayTracePresenter.ts`

改造方向：

- `DailyBoardView` 实现 Obsidian surface，不再被新架构当作产品中心。
- Desktop renderer 通过 preload IPC 调用 Desktop HostAdapter。
- Runtime 不直接知道 UI surface，只发 progress、trace、approval 和 artifact event。

测试：

- contract test：Obsidian surface 和 Desktop surface 都能消费同一类 runtime event。
- regression test：现有 Obsidian command、settings、view registration 不崩。

### M3: Desktop runtime smoke

目标：桌面端能真正调用 FRIDAY runtime。

最小链路：

```text
Desktop input
  -> Desktop HostAdapter
  -> AgentRuntimeFacade
  -> AgentKernel
  -> FridayPiRuntime
  -> Real PI SDK session 或 FRIDAY local bridge
  -> RuntimeProgressEvent stream
  -> Desktop process panel
```

实现要求：

- 桌面端支持选择 `obsidian-host` 和 `real-pi-sdk` 以外的 `desktop-host` source。
- 没有模型配置时，桌面端显示可恢复的配置状态，不崩溃。
- 有模型配置时，可以运行最小 prompt smoke。
- tool trace 可折叠显示。
- session state 可落盘。

测试：

```powershell
npm run desktop:test
npm test
```

手工 smoke：

```text
打开 FRIDAY Desktop
输入一个简单 prompt
看到过程流
看到最终回答
看到 session state 文件更新
关闭并重新打开，最近 session 可恢复
```

### M4: 项目和权限边界

目标：让桌面端有独立的 Vault/Project path 权限模型。

实现要求：

- 桌面端设置可添加一个 Vault path 和一个当前项目 path。
- 默认可信边界：Vault + 当前项目路径。
- 外部路径默认只读或显式审批。
- shell/exec 默认折叠展示，但每次执行都进入 trace。
- 权限策略落盘，和 PI session metadata 关联。

复用或调整：

- `src/utils/projectWorkspacePolicy.ts`
- `src/services/ProjectBoundaryService.ts`
- `src/core/tool-governor/*`
- `src/services/FridayPiRuntimeStateStore.ts`

测试：

- 项目内 read/write 正常。
- 项目外 write 被拦截或进入审批。
- shell trace 在桌面 UI 可见。
- policy metadata 写入 PI runtime state。

### M5: 模块协议 v0

目标：定义 FRIDAY module 的本地协议，先支持声明式模块。

新增文件建议：

- `src/modules/ModuleManifest.ts`
- `src/modules/ModuleRegistry.ts`
- `src/modules/ModuleStore.ts`
- `src/modules/ModuleValidator.ts`
- `tests/module-manifest.test.mjs`
- `tests/module-registry.test.mjs`

模块 v0 文件结构：

```text
modules/
  <module-id>/
    manifest.json
    README.md
    skills/
    prompts/
    workflows/
    permissions.json
    tests/
```

manifest v0 字段：

```json
{
  "id": "weekly-report",
  "name": "Weekly report",
  "version": "0.1.0",
  "kind": "workflow",
  "source": "local",
  "enabled": false,
  "permissions": {
    "vault": "read",
    "project": "write-review",
    "externalPaths": "ask",
    "network": "deny",
    "shell": "ask"
  }
}
```

验收：

- 可以扫描本地 modules 目录。
- 可以校验 manifest。
- 可以标记 enabled/disabled。
- 无效模块不会进入 runtime。
- 权限摘要可供 UI 展示。

### M6: 桌面模块页面

目标：把长期愿景里的模块页做成第一版产品界面。

页面分区：

- 本地模块
- 已安装模块
- 草稿模块
- 社区候选模块
- 开发者详情

每个模块至少展示：

- 名称、摘要、来源、版本。
- 启用状态。
- 权限摘要。
- 触发方式。
- 最近运行记录。
- 最近错误。
- 查看文件、启用/禁用、验证、卸载。

测试：

- renderer view-model test：不同模块状态渲染正确。
- module registry test：启用/禁用会更新本地状态。
- permission summary test：用户文案不暴露内部 runtime 术语。

### M7: Module Builder Agent 草稿流

目标：用户可以让 FRIDAY 生成一个模块草稿，但默认不自动安装。

流程：

```text
用户提出能力需求
  -> FRIDAY 澄清目标和边界
  -> 生成 module design
  -> 生成文件草稿
  -> 校验 manifest/permissions/tests
  -> 展示权限和行为预览
  -> 用户选择安装、继续编辑或放弃
```

实现要求：

- 生成内容落在 `modules/.drafts/<draft-id>/`。
- 草稿默认 disabled。
- 安装前必须显示权限摘要和生成文件 diff。
- 生成测试必须可运行，即使只是 schema smoke。
- 失败时保留草稿和错误 trace。

测试：

- draft generation 不会启用模块。
- invalid manifest 被拦截。
- 安装前必须经过 approval。
- 拒绝安装不会写入 enabled registry。

### M8: Soul 扩展到 agent 行为画像

目标：让 Soul 可以引用模块、工具策略、planning style 和 UI preference，而不只是一段 prompt。

类型扩展建议：

- `src/types/soul.ts`
- `src/features/soul/SoulProfile.ts`
- `src/services/SoulStore.ts`

新增字段建议：

```ts
interface SoulBehaviorProfile {
  moduleRefs: string[];
  disabledModuleRefs: string[];
  planningStyle: "light" | "structured" | "research" | "operator";
  clarificationStyle: "minimal" | "confirm-risky" | "ask-first";
  memoryPolicy: "focused" | "broad" | "project-first";
  toolPolicyPreset: "safe" | "standard" | "operator";
  uiPreference: "compact" | "process-rich";
}
```

验收：

- 旧 Soul 定义可迁移。
- Soul 页面仍对普通用户可读。
- 高级详情页能看到底层 module/tool policy。
- runtime prompt assembly 能读取 Soul 行为画像，但不破坏现有 Soul v2 tests。

### M9: 社区模块吸收路径

目标：先让 FRIDAY 能“研究和吸收”社区模块，而不是直接执行任意社区 package。

第一阶段实现：

- 社区模块作为只读 candidate。
- 支持 source URL、package metadata、license、权限声明、风险标签。
- 支持“转为本地草稿”。
- 转为草稿后走 Module Builder/Module Validator 流程。

不做：

- 不自动执行远程代码。
- 不自动更新社区模块。
- 不做完整 marketplace 支付/账号/发布系统。

## 4. 推荐执行顺序

1. M1：先让桌面窗口跑起来。
2. M2：抽 Host Surface contract。
3. M3：接 runtime smoke。
4. M4：接桌面路径权限。
5. M5：定义模块协议 v0。
6. M6：做模块页面。
7. M7：做模块生成草稿流。
8. M8：扩展 Soul。
9. M9：接社区候选模块。

## 5. 第一批子代理任务建议

### Task A: Desktop shell scaffold

**Files:**

- Create: `desktop/main.ts`
- Create: `desktop/preload.ts`
- Create: `desktop/renderer/index.html`
- Create: `desktop/renderer/App.ts`
- Create: `scripts/desktop-dev.mjs`
- Create: `scripts/desktop-build.mjs`
- Modify: `package.json`
- Test: `tests/desktop-shell.test.mjs`

**Verification:**

```powershell
npm run desktop:build
node --test tests/desktop-shell.test.mjs
```

### Task B: Host Surface contract

**Files:**

- Create: `src/platform/host/FridayHostSurface.ts`
- Create: `src/platform/host/FridayHostAdapter.ts`
- Create: `tests/friday-host-surface-contract.test.mjs`
- Modify: `src/views/DailyBoardView.ts` only where necessary to implement the contract.

**Verification:**

```powershell
node --test tests/friday-host-surface-contract.test.mjs
npm test
```

### Task C: Desktop runtime bridge

**Files:**

- Create: `desktop/runtime/DesktopRuntimeBridge.ts`
- Create: `desktop/runtime/DesktopFridayHostAdapter.ts`
- Create: `tests/desktop-runtime-smoke.test.mjs`
- Modify: `src/types/agent.ts`
- Modify: `src/services/AgentRuntimeService.ts` only if shared factory extraction is needed.

**Verification:**

```powershell
node --test tests/desktop-runtime-smoke.test.mjs
npm test
```

### Task D: Module protocol v0

**Files:**

- Create: `src/modules/ModuleManifest.ts`
- Create: `src/modules/ModuleRegistry.ts`
- Create: `src/modules/ModuleStore.ts`
- Create: `src/modules/ModuleValidator.ts`
- Create: `tests/module-manifest.test.mjs`
- Create: `tests/module-registry.test.mjs`

**Verification:**

```powershell
node --test tests/module-manifest.test.mjs tests/module-registry.test.mjs
npm test
```

### Task E: Desktop module page

**Files:**

- Create: `desktop/renderer/modules/ModulePage.ts`
- Create: `desktop/renderer/modules/ModulePageViewModel.ts`
- Create: `tests/desktop-module-page-view-model.test.mjs`
- Modify: `desktop/renderer/App.ts`

**Verification:**

```powershell
node --test tests/desktop-module-page-view-model.test.mjs
npm run desktop:build
```

## 6. Controller 验收标准

每个任务完成后必须检查：

- 是否保持 Obsidian plugin 的现有 tests 通过。
- 是否没有把 Obsidian API 泄漏到 Desktop renderer。
- 是否没有新增未审批的文件写入、shell 或网络执行路径。
- 是否使用产品语言展示权限和过程，不把 internal runtime 术语直接暴露给普通用户。
- 是否有最小可复现 smoke，而不是只靠类型检查。
- 是否把桌面端新增能力沉淀成可复用 host/runtime/module contract。

## 7. 暂不进入范围

- 完整 marketplace。
- 账号系统和云同步。
- 模块自动更新。
- 远程代码执行。
- 移动端。
- 完整 Obsidian 嵌入桌面端。
- 发布安装包和自动升级。

## 8. 下一步

下一步建议从 Task A 开始：先做 Electron 桌面壳和 `desktop:build`，只验证窗口、导航和本地状态加载。桌面壳可运行后，再进入 Host Surface contract 和 runtime bridge。
