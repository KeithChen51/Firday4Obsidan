# ADR: FRIDAY Desktop v0 M2 Desktop Shell Tech Spike

日期：2026-06-11

决策更新：2026-06-12

状态：M2 技术栈决策通过，v0 选择 **Electron-first**。M11 前仍需补一次真实 Electron GUI smoke。Tauri + Node sidecar 保留为后续平台化方向，不进入 v0 主线。

## 背景

M2 的目标不是接完整 UI，而是从 M1 `src/desktop/contracts` 的 HostAdapter 能力反推桌面壳技术栈。v0 的高风险点是 PI SDK、Node runtime、文件系统、命令执行和本地日志能否低成本落地。当前仓库已经有 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 依赖，`tests/real-pi-sdk-session-adapter.test.mjs` 覆盖 bundled PI SDK + faux provider 最小 session，`tests/friday-pi-desktop-bundle.test.mjs` 覆盖 Obsidian bundle 不应吞入 pi-ai Node 环境探测的风险。

M2 smoke 已证明 Node 侧关键原语可跑：Node 24.11.1、PI SDK import、最小 PI session、shell command、文件读写和本地日志。这些能力正是 Electron main process 可以直接承载的部分。

## v0 真实 host 能力

| 能力 | v0 需要的真实 host 行为 | 决策影响 |
| --- | --- | --- |
| 文件系统 | 项目内读写、managed artifact 写入、导入外部文件快照、路径归一化。 | 需要 Node `fs` 级别能力和项目边界校验。 |
| 命令执行 | Git、脚本、工具调用可控执行，返回 stdout/stderr/exit code。 | 需要 host 侧命令执行 API，renderer 不直接执行。 |
| 窗口 | 主窗口、子窗口或面板恢复、最小化/关闭生命周期。 | Electron/Tauri 都能提供，v0 只需主窗口。 |
| 拖拽 | 从系统拖入文件，进入 project import/snapshot 流程。 | 需要 renderer 事件 + host 文件路径授权。 |
| 剪贴板 | 复制引用、路径、artifact 内容，后续可支持粘贴导入。 | Electron/Tauri 都可做，需走受控桥。 |
| 原生菜单 | app 菜单、常用命令、开发菜单、窗口菜单。 | Electron 成熟；Tauri 也可做但菜单模型更偏 Rust。 |
| 本地 WebView | 渲染 FRIDAY desktop renderer，隔离 nodeIntegration，通过 preload 暴露 HostAdapter。 | Electron 的 BrowserWindow/WebContents 是直接路径；Tauri WebView 需要 Rust command bridge。 |
| 权限提示 | safe/standard/autonomous 模式下，文件写入、外部导入、命令执行需要可审计 approval。 | 需要 host 侧 PermissionHostPort，不应只靠 UI 状态。 |
| 日志路径 | 本地 main/preload/runtime 日志，默认在 app logs 目录；CLI smoke 用临时目录模拟。 | Electron 建议 `app.getPath("logs")/friday-desktop/main.log`。 |
| 自动更新后移 | v0 不接自动更新，把更新机制留到桌面基础稳定后。 | 避免 M2/M11 过早引入 release/update 复杂度。 |

## Candidate A: Electron

M2 新增 `spikes/desktop-shell/smoke.mjs`，只验证当前 Node-level 关键路径，不伪称跑过 Electron GUI。当前环境 Node 是 `24.11.1`，满足 Node 22+。

| 验证项 | 证据 | 结论 |
| --- | --- | --- |
| Node 22+ | smoke 脚本断言 `process.versions.node` major >= 22；当前实测为 Node 24.11.1。 | 通过。 |
| PI SDK import | smoke 直接 import `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`。 | 通过 Node import 门。 |
| 最小 PI session | smoke 用 `registerFauxProvider` + `fauxAssistantMessage` 驱动 `Agent.prompt()`，校验 final text 和 agent_start/agent_end。 | 通过最小 session 门。 |
| shell command | smoke 用 `execFile(process.execPath, ["-e", ...])` 验证受控命令执行。 | 通过 Node host 原语门。 |
| 文件读写 | smoke 在系统 temp 下 `mkdtemp`、`writeFile`、`readFile`。 | 通过文件系统原语门。 |
| WebView 渲染 | Electron 方案应在 M11 用 `BrowserWindow`/`webContents` 渲染本地 renderer，并通过 preload 暴露 HostAdapter。 | Electron GUI smoke 未执行，因为当前仓库未安装 Electron，M2 不新增依赖。 |
| 本地日志 | smoke 在 temp `logs/friday-desktop.log` 追加并回读；v0 Electron 落地时使用 `app.getPath("logs")`。 | 通过日志写入原语门。 |

Electron GUI smoke 未执行：当前 `package.json` 没有 Electron 依赖，M2 要求默认不改依赖。这个缺口不阻止 v0 技术栈决策，因为 v0 的决策风险集中在 PI SDK 是否能在 Node host 中运行、shell/fs/log 是否可控。Electron 的 WebView/窗口能力是成熟主路径，但 M11 接 UI 前必须新增一次真实 `BrowserWindow` smoke。

## Candidate B: Tauri

Tauri 的优势是体积和更收敛的默认权限面，但 FRIDAY v0 的核心 runtime 是 JS/Node 生态，PI SDK 当前也是 Node/JS 包。Tauri 要承载同等能力需要二选一：

1. Rust host + Node sidecar：Rust 负责窗口、文件权限、菜单和更新路径，Node sidecar 负责 PI SDK、shell、工具链和部分文件操作。
2. Rust host + 内嵌 runtime：把 Node runtime 嵌入或用额外 runtime 桥接 PI SDK。

关键复杂度：

| 维度 | Tauri 评估 |
| --- | --- |
| PI SDK | PI SDK 是 Node/JS 包，Rust host 不能直接运行；需要 Node sidecar 或内嵌 runtime。 |
| shell | Tauri shell 权限模型更细，但 FRIDAY 仍要把命令执行和 approval 状态跨 Rust/JS 边界同步。 |
| 文件权限 | Tauri 文件 scope 有安全收益，但 FRIDAY 的 project/import/artifact 策略仍要做自己的路径策略。 |
| 打包 | Tauri + Node sidecar 会带来双 runtime 打包、签名、路径发现和崩溃恢复。 |
| 更新路径 | Tauri updater 可用，但 v0 已决定自动更新后移；现在引入不能抵消 sidecar 成本。 |
| Rust host | 后续需要维护 Rust command、JS bridge、Node sidecar protocol 三层边界。 |
| Node sidecar | 需要定义启动、健康检查、日志、IPC、退出、版本兼容和权限同步。 |
| 内嵌 runtime | 复杂度高于 v0 目标，且会放大调试和分发成本。 |

## 推荐技术栈

推荐技术栈：v0 选择 Electron shell，主进程承载 Node 22+ runtime、PI SDK、文件系统、shell command、本地日志和 permission approval；renderer 只通过 preload bridge 调用 M1 HostAdapter port。

理由：

1. 当前仓库的 PI SDK 最小 session 已能在 Node 环境跑通，新增 smoke 也直接验证 PI SDK import、faux provider、最小 PI session、shell command、文件读写和本地日志。
2. Electron 的 main/preload/renderer 分层天然匹配 HostAdapter：受信 host 在 main，受控 bridge 在 preload，UI 在 renderer。
3. v0 不追求最小包体，也不接自动更新；Electron 的体积劣势在 v0 不如 runtime 风险重要。
4. M11 需要先交付桌面 UI integration，Electron 迁入成本低于先建设 Tauri sidecar protocol。
5. Tauri + Node sidecar 是长期可考虑的平台化方向，但不应该作为 v0 的第一条工程主线。

## 不选另一个的原因

不选 Tauri + Node sidecar 作为 v0 主线的原因：Tauri 的安全和体积收益真实存在，sidecar 也更利于长期 runtime 平台化；但 v0 需要优先降低 PI SDK 与工具执行链路的不确定性。选择 Tauri 会把一个已验证的 Node PI runtime 拆成 Rust host + Node sidecar 或内嵌 runtime，并提前引入打包、IPC、日志、退出恢复和权限同步问题。对于 M2 到 M11 的路径，这些复杂度不会产出直接用户价值。

## v0 风险

1. Electron GUI smoke 未执行，M11 前必须安装 Electron 并跑真实 `BrowserWindow` + preload + 本地 renderer smoke。
2. Electron 主进程权限面更宽，必须强制 renderer 不直接拿 Node 能力，所有 fs/shell 走 HostAdapter 和 PermissionHostPort。
3. shell command 需要命令白名单、cwd 限制、超时、输出截断和审计日志，否则会扩大本地破坏面。
4. 文件导入和项目路径需要继续沿用 M1 的 project boundary，不允许任意外部写入。
5. 自动更新后移意味着 v0 交付需要先用手动安装或内部打包流程，不把 updater 当成首版能力。

## 后续迁移成本

从 Electron 迁移到 Tauri 的主要成本不在 UI，而在 host bridge 和 runtime ownership：

1. 如果 M11 后保留 HostAdapter port 边界，renderer UI 可以较低成本迁移。
2. 主进程里的 PI SDK、shell、日志、权限、文件系统需要迁成 Node sidecar 或 Rust/JS 双层实现，成本中高。
3. 权限提示、trace、tool execution 的审计语义必须保持一致，否则迁移会影响 agent runtime 行为。
4. 如果 v0 把 Electron API 泄漏到 UI 组件，迁移成本会显著上升；因此 M11 需要禁止 renderer 直接 import Electron。

## M11 UI integration

M11 UI integration 应使用的目录结构：

```text
src/desktop/contracts/                 # M1 host-neutral ports, kept free of Electron/Tauri imports
src/desktop/shell/electron/main/        # app lifecycle, BrowserWindow, menu, logs, native dialogs
src/desktop/shell/electron/preload/     # typed bridge from renderer to HostAdapter IPC
src/desktop/shell/electron/adapters/    # FileSystemHostPort, PermissionHostPort, ToolExecutionHostPort implementations
src/desktop/shell/renderer/             # desktop renderer entry and UI composition
src/desktop/shared/                     # shared DTOs, IPC channel names, validation helpers
tests/desktop-shell-*.test.mjs          # shell contract and smoke assertions
spikes/desktop-shell/                   # M2-only spike scripts, not imported by production build
```

Rules for M11:

1. `src/desktop/contracts` stays host-neutral and type-only.
2. Electron imports live only under `src/desktop/shell/electron/**`.
3. Renderer calls host through preload bridge; no direct `fs`, `child_process`, `electron`, or PI SDK imports in renderer components.
4. The first M11 task should add a real Electron GUI smoke before building the full UI.

## M2 结论

M2 决策：选择 Electron for v0，Tauri + Node sidecar 暂不进入 v0 主线。当前 spike 足以通过技术栈决策门，但不是 UI integration 完成证明。下一次进入 M11 前，应把 Electron 依赖作为明确变更引入，并补 `BrowserWindow`/preload/WebView 渲染 smoke。
