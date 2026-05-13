# 现有 UI 对照 Native Kit 的差异清单

日期：2026-05-13

范围：本清单只对照现有代码与已确认的 FRIDAY Obsidian Native Kit 规范，不迁移 UI，不回滚本地改动。

## 对照基线

- Native Kit 首批迁移对象：工作台顶部栏、助手消息、对话输入区、Task Bar、审批强提醒、执行过程、设置页框架与状态反馈。
- Native Kit 元组件：状态徽标、文件类型图标、低强调事件行、运行中表面、浮层列表项、控制按钮组。
- 暂缓项：项目状态组仍不进入首批迁移，不从项目状态组抽样式 token 或组件。

参考文档：

- `docs/design/friday-native-kit.md`
- `docs/design/friday-native-kit-migration-map.md`
- `docs/design/native-kit-catalog.html`

## 总览

| 优先级 | 结论 | 影响面 |
| --- | --- | --- |
| P0 | 当前 UI 的整体视觉语言偏“自定义卡片系统”，与 Native Kit 的 Obsidian 原生密度和低品牌外显不一致 | 全局样式、工作台、助手、设置页、抽屉 |
| P0 | 审批仍存在重复呈现路径，需要收敛到输入区占用态 | 对话输入区、审批、助手消息 |
| P0 | Skill 展示仍有 `Skill /` 或前置 `/`，与已确认规则不一致 | 输入区、浮层、消息 token、能力中心 |
| P1 | Task Bar 已落到 composer 上方，但视觉上还未完全贴住输入框 | 对话输入区、Task Bar |
| P1 | 产物与 Diff 文件行没有复用文件类型图标元件 | 执行过程、产物、变更审阅、同步冲突 |
| P1 | 工具调用、后台记录、运行提示仍散落为多套局部样式 | 助手消息、执行过程、队列提示、后台状态 |
| P1 | 助手输出仍保留部分旧的卡片/气泡型任务与审批消息 | 助手消息、执行过程 |
| P2 | 能力控制中心、会话抽屉、首次引导已有功能形态，但未沉淀到 Kit 元组件 | 工具/Skill 管理、会话记录、onboarding |
| Hold | 项目状态组不审、不改 | 项目摘要、项目管理状态 |

## 视觉风格差异

这层问题不是“有没有复用同一个 class”，而是当前 UI 的基础视觉方向与 Native Kit 不完全一致。即使后续把组件抽成公共元件，如果视觉方向不先收敛，仍会得到一套统一但不像 Obsidian 原生的 FRIDAY UI。

| 维度 | 当前 UI 倾向 | Native Kit 目标 | 影响 | 优先级 |
| --- | --- | --- | --- | --- |
| 容器感 | 多处使用卡片壳、边框、背景、阴影，例如 assistant message、chat shell、approval card、native settings group | 更接近 Obsidian 原生设置项和面板密度，只有重复项、审批、产物等必要对象成卡片 | 看起来像另一个 Web app 嵌进 Obsidian，而不是 Obsidian 插件 | P0 |
| 圆角体系 | 12px、14px、16px、999px 胶囊混用，消息和控件偏软 | 常规控件以 Obsidian 原生圆角为主，Kit 卡片不超过小半径，胶囊只用于状态徽标 | UI 气质偏“定制 SaaS”，和 Obsidian 主题不够融合 | P0 |
| 色彩用法 | `interactive-accent` 被用于用户气泡、Task Bar、queue、badge、active item 等大量场景 | FRIDAY 色只用于身份、关键状态和少量入口；普通面板随 Obsidian 主题走 | 品牌色过度泛化，导致所有状态都像 FRIDAY 强提醒 | P0 |
| 阴影与浮层 | message、dropdown、shell 等出现明显 shadow 或浮层感 | 优先使用 Obsidian 的 border/background 层级，阴影只用于真正浮层 | 视觉层级变重，阅读区不够安静 | P1 |
| 信息密度 | padding 较大、行高较松、卡片间距大，例如消息区、设置组、过程面板 | 更像 Obsidian 设置页、侧边栏和命令面板：紧凑但可读 | FRIDAY 输出区占屏幕空间偏多，长任务和长对话浏览效率下降 | P1 |
| 品牌出现方式 | logo/avatar/wordmark 在顶部栏、助手头、过程头等多处出现 | 品牌出现要克制：顶部身份、助手身份、关键状态即可 | FRIDAY 存在感变成装饰，而不是信息结构 | P1 |
| 组件语气 | 任务、审批、过程、状态都容易变成“卡片 + 标题 + 描述 + 按钮” | Native Kit 要按信息类型区分：正文、低强调事件、运行中表面、审批强提醒、产物 | 结构看似统一，但用户难以快速判断哪类信息需要行动 | P1 |

### P0. 先做视觉基线，而不是只做组件替换

现状证据：

- assistant message 使用较大圆角和阴影：`styles.css:1870`
- chat shell 是独立圆角面板：`styles.css:1845`
- shell header 是卡片式顶部栏：`styles.css:1634`
- composer 使用 14px 圆角：`styles.css:2983`
- Task Bar、status、select 等大量使用 accent 混色和胶囊样式：`styles.css:3080`、`styles.css:1700`、`styles.css:898`

差异：

- Native Kit 不是一套“更统一的自定义 UI”，而是一套“Obsidian 原生底座 + FRIDAY 克制品牌层”的约束。
- 当前 UI 的主要偏差是基础视觉语气：容器偏重、圆角偏软、品牌色偏多、信息密度偏松。
- 如果直接迁移元组件，很可能只是把旧视觉包装成统一版本，仍然不像 Obsidian 原生。

建议动作：

- 先定义全局视觉基线：圆角、边框、背景、阴影、间距、状态色使用范围。
- 明确哪些 surface 可以成卡片：审批、产物、重复列表项、设置分组；普通正文、工具事件、运行状态不成重卡。
- 建立“FRIDAY 品牌出现规则”：顶部栏可出现 logo + FRIDAY；助手身份可出现小 wordmark；过程事件和普通状态不重复放品牌图标。
- 将 `interactive-accent` 从装饰色降级为语义色，只给选中、执行中、关键入口和品牌状态使用。

验收：

- 截图第一眼应像 Obsidian 插件，而不是独立 Web dashboard。
- 主题切换后，普通面板主要跟随 Obsidian 变量，FRIDAY 只在身份和状态层出现。
- 即使还没完成所有组件迁移，整体密度、圆角和容器层级已经接近 Native Kit。

## 元组件差异矩阵

| Native Kit 元组件 | 现有代码状态 | 差异 | 建议 |
| --- | --- | --- | --- |
| 状态徽标 | 多套局部状态：`friday-ai-conn-status`、`friday-composer-task-bar-item-status`、`friday-agent-process-status`、`friday-ai-queue-pill` | 语义相近但 class、尺寸、色彩不统一 | 抽 `kit-status-badge`，逐步替换在线、等待审批、执行中、完成、失败、队列等状态 |
| 文件类型图标 | 产物只显示 `MD` / `Canvas` 文本；`@` 已选 token 不显示图标；Diff 文件行无图标 | 与 Kit 的 Markdown、Canvas、HTML/代码、普通笔记图标元件不一致 | 抽 `kit-file-type-icon`，优先用于产物、`@` 文件选择、Diff、同步冲突 |
| 低强调事件行 | 工具调用/过程记录主要走 timeline rail、queue hint、override bar 等局部结构 | 工具调用仍偏“过程组件”，没有统一的一行低强调事件语言 | 抽 `kit-event-row`，用于工具调用、同步日志、后台记录、队列提示 |
| 运行中表面 | 已有 `friday-agent-process-statusbar`，但过程头部仍有 avatar/marker 动效 | Kit 要求运行中靠整体背景和弱动效，不用前置 icon 抢注意力 | 将 statusbar 与 running surface 统一；running 行保持单行省略和 reduced motion |
| 浮层列表项 | `friday-mention-dropdown` 向上展开，但 item 仍是旧局部样式 | Skill/@ 列表还没复用同一浮层项，Skill 文案仍带前缀 | 抽 `kit-popover-item`，统一 Skill 列表与 `@` 文件选择 |
| 控制按钮组 | shell、composer toolbar、session drawer、process action 各自定义按钮 | 尺寸、圆角、图标/文字密度不完全一致 | 抽 `kit-control-button`，先覆盖模型、权限、@、+Skill、搜索、刷新、设置、菜单 |

## 详细差异

### P0. 审批应只作为输入区占用态

现状证据：

- 输入区内已经有 `friday-composer-decision-panel`：`src/views/DailyBoardView.ts:1691`
- 但仍保留独立聊天面板：`src/views/DailyBoardView.ts:2649`
- 也仍保留助手消息里的审批气泡：`src/views/DailyBoardView.ts:3839`
- 样式里同时存在 `friday-composer-decision-panel` 和 `friday-ai-approval-message`：`styles.css:3000`、`styles.css:1987`

差异：

- Native Kit 已确认“审批强提醒占用对话输入区”，不再保留独立审批卡片组件。
- 当前代码有三条呈现路径，用户可能同时看到输入区审批、聊天流审批提示、独立 inline approval panel，信息重复。

建议动作：

- 保留 `friday-composer-decision-panel` 作为唯一强提醒入口。
- 删除或降级 `renderInlineApprovalPanel` 与 `renderApprovalMessage` 的阻塞态视觉。
- 变更审阅 Diff 作为审批强提醒子系统，不另起强提醒样式。

验收：

- 有待审批时，主视觉只出现在输入区。
- 助手消息流最多保留一条低强调状态记录，不再出现审批气泡。

### P0. Skill 展示文案还未符合确认规则

现状证据：

- 输入 token 对 skill 格式化为 `Skill /xxx`：`src/core/editor/mention/MentionComposerDocument.ts:201`
- 能力中心 skill 标题显示 `/${skill.command}`：`src/views/DailyBoardView.ts:2108`
- 运行时仍构造 `Skill /${skillName}` label：`src/views/DailyBoardView.ts:5068`

差异：

- 用户已确认：目前能调用的都是 skill，不需要显示 `Skill` 前缀。
- 展示时应优先显示技能名；前置 `/` 只用于输入触发，不用于普通展示。

建议动作：

- Skill token、Skill 列表、能力中心统一显示 `json-canvas` 这类技能名。
- 输入框里用户正在键入 `/` 命令时可以保留 `/`，但插入后的 token 不保留 `Skill /`。
- i18n 中包含 `Skill /{command}` 的说明文案也要同步产品化。

验收：

- `@` token 继续显示 `@ 文件名` 或 `@ 当前笔记`。
- Skill token 显示 `json-canvas`，不显示 `Skill /json-canvas`。

### P1. Task Bar 已存在，但与输入框还有视觉间隙

现状证据：

- Task Bar host 已在 composer wrap 内、输入框前：`src/views/DailyBoardView.ts:1457`
- Task Bar 渲染支持收起/展开：`src/views/agentTrajectoryRenderer.ts:52`
- 展开态会渲染全部任务，包括未开始任务：`src/views/agentTrajectoryRenderer.ts:82`
- CSS 里 composer wrap 仍有 `gap: 8px`：`styles.css:2957`
- Task Bar 自身也有 `margin-bottom: 8px`，后面又局部覆写 host 直接子级为 0：`styles.css:3080`、`styles.css:2995`

差异：

- Native Kit 要求收起态贴住输入框上方。
- 当前结构正确，但 gap 仍来自父容器，视觉上会显得没贴住。

建议动作：

- 对 `friday-ai-composer-task-bar-host + .friday-ai-composer` 建立贴合样式，或在 Task Bar 存在时移除 composer wrap gap。
- 收起态与输入框可以共享边界或用 1px 分隔线，不再出现明显空隙。

验收：

- 收起态 Task Bar 与输入框视觉相连。
- 展开态仍保留完整步骤，输入框在下方。

### P1. 产物和文件差异缺少文件类型图标元件

现状证据：

- 产物图标目前用文本 `Canvas` / `MD`：`src/views/agentTrajectoryRenderer.ts:565`
- 产物卡片 class 只有扩展名状态：`src/views/agentTrajectoryRenderer.ts:559`
- Diff summary 文件行只显示 path/meta：`src/views/agentTrajectoryRenderer.ts:545`
- 变更审阅 Diff 只渲染增删行：`src/views/DailyBoardView.ts:1852`

差异：

- Native Kit 已确认：产物、`@` 文件选择、Diff、同步冲突都用同一文件类型图标元件。
- 当前产物使用文字标签，无法统一到 Markdown/Canvas/HTML/普通笔记图标。

建议动作：

- 在 view model 中输出 `fileType` 或通过路径统一推导。
- `renderArtifactCard`、Diff summary、变更审阅文件标题、同步冲突文件行都调用同一渲染函数。
- 已选 `@` token 不加文件图标，保持轻量。

验收：

- `.md`、`.canvas`、`.html`/代码、普通文件至少有 4 类图标。
- 产物列表和同步冲突文件行视觉一致。

### P1. 工具调用和过程记录未统一为低强调事件行

现状证据：

- 执行过程 timeline item 使用 rail/marker/detail 结构：`src/views/agentTrajectoryRenderer.ts:370`
- statusbar 是单行结构：`src/views/agentTrajectoryRenderer.ts:313`
- queue hint 独立定义：`src/views/DailyBoardView.ts:5302`
- override bar 独立定义：`src/views/DailyBoardView.ts:5323`

差异：

- Native Kit 认为工具调用、后台记录、同步日志应共用低强调事件行。
- 当前 timeline、queue、override 都是单独设计，用户会看到多套“系统事件”视觉。

建议动作：

- 将工具调用、后台记录、同步日志、queue hint 归一到 `kit-event-row`。
- 当前执行步骤继续用 Task Bar/Process 表达，工具调用只保留 icon + 工具名 + 操作内容。
- `override bar` 可以改成低强调事件行或状态徽标组。

验收：

- 工具调用不再是重卡片。
- queue/override 不再拥有独立视觉体系。

### P1. 助手输出仍有旧气泡/任务卡片遗留

现状证据：

- 普通用户消息是右侧气泡：`src/views/DailyBoardView.ts:3007`
- FRIDAY answer flow 已经存在文档流：`src/views/agentTrajectoryRenderer.ts:472`
- 但旧任务卡片仍作为 assistant message bubble 渲染：`src/views/DailyBoardView.ts:3772`
- 审批提示仍作为 assistant message bubble 渲染：`src/views/DailyBoardView.ts:3839`

差异：

- Native Kit 方向是：用户右侧气泡，FRIDAY 走文档流，按正文、工具调用、产物区分输出内容。
- 旧任务卡片和审批气泡会把 FRIDAY 输出重新拉回“消息卡片”风格。

建议动作：

- 保留用户右侧气泡。
- FRIDAY 输出统一进入 `renderAgentAnswerFlow`。
- 任务摘要交给 Task Bar，执行细节交给 Process，审批交给输入区。

验收：

- FRIDAY 不再出现与用户类似的大气泡。
- 正文、工具调用、产物、审批各有明确位置。

### P1. 运行中表面还夹杂过程 icon 和 marker 动效

现状证据：

- 过程头部仍渲染 avatar/icon：`src/views/agentTrajectoryRenderer.ts:251`
- timeline running marker 有 pulse 动画：`styles.css:2632`
- reduced motion 已处理：`styles.css:2900`
- statusbar 已具备单行信息条雏形：`styles.css:2482`

差异：

- Native Kit 要求运行中表面不放前置 icon，靠整体背景和弱动效表达进行中。
- 当前 statusbar 方向正确，但 process header/marker 仍偏“节点时间线”视觉。

建议动作：

- 将当前步骤提示迁到 `kit-running-surface`。
- timeline marker 保留在展开过程详情里，但主运行提示不使用 icon。
- 所有运行中弱动效继续遵守 `prefers-reduced-motion`。

验收：

- 收起态/提示态是一行信息条。
- 主文本单行省略，不换行撑高。

### P2. 对话输入区工具栏还不是统一控制按钮组

现状证据：

- 模型和权限是 select：`src/views/DailyBoardView.ts:1469`、`src/views/DailyBoardView.ts:1503`
- `+Skill` 与 `@` 是局部 toolbar button：`src/views/DailyBoardView.ts:1519`、`src/views/DailyBoardView.ts:1533`
- toolbar 样式独立：`styles.css:3413`

差异：

- Native Kit 要求模型、权限、`@`、`+Skill`、发送按钮等作为输入区控制按钮组定义。
- 当前控件功能完整，但 class 与密度规则没有沉淀成 Kit 元组件。

建议动作：

- 提取 `kit-control-button` / `kit-control-select`。
- 保持 Obsidian 原生控件语义，统一尺寸、圆角、hover、disabled。

验收：

- 输入区按钮组与工作台顶部按钮、会话抽屉按钮的视觉密度一致。

### P2. Skill 与 @ 浮层已有向上展开，但还不是 Kit 列表项

现状证据：

- dropdown 已定位在输入框上方：`styles.css:1134`
- item 仍使用 `friday-mention-item`、`friday-mention-item-button`：`src/views/components/MentionDropdown.ts:105`
- `@`/Skill 数据模型没有向 item 传入文件类型图标：`src/views/components/MentionDropdown.ts:3`

差异：

- Native Kit 要求 Skill 列表和 `@` 文件选择都使用同一浮层列表项。
- `@` 文件选择需要按文件类型显示图标，但已选 token 不需要。

建议动作：

- 将 `MentionDropdown` 改成消费 `kit-popover-item`。
- Skill item 只显示技能名，描述作为次级文本。
- `@` 文件 item 显示文件类型图标、标题、路径。

验收：

- Skill 列表、`@` 文件选择、未来菜单浮层在 hover/active/spacing 上一致。

### P2. 能力控制中心需要接入元组件

现状证据：

- 工具列表与 Skill 列表使用 `friday-control-center-item`：`src/views/DailyBoardView.ts:1955`、`src/views/DailyBoardView.ts:2105`
- Skill 标题仍带 `/`：`src/views/DailyBoardView.ts:2108`
- toggle 使用 Obsidian `ToggleComponent`：`src/views/DailyBoardView.ts:1982`

差异：

- Native Kit 要求工具 icon 统一行动类 icon，Skill icon 统一组件/流程类 icon。
- 当前控制中心没有统一 icon 语义，文字说明偏长，和输入区/执行过程没有共用元组件。

建议动作：

- 工具项使用统一 tool icon，不为每个工具定制图标。
- Skill 项使用统一 skill icon，不显示 `Skill` 前缀与 `/`。
- 状态与审批策略复用状态徽标，不新增小 chip。

验收：

- 能力中心看起来像管理面板，不像营销卡片。
- 工具、Skill、权限状态的信息层级清晰。

### P2. 会话抽屉基本可保留，但按钮和状态需统一

现状证据：

- 会话抽屉使用 `friday-ai-session-drawer`：`src/views/DailyBoardView.ts:2396`
- header actions 使用 shell icon button：`src/views/DailyBoardView.ts:2403`
- session item 不强制差异化 icon，符合已确认方向：`src/views/DailyBoardView.ts:2513`

差异：

- 会话抽屉不是首批核心矛盾，但搜索、批量、菜单、空状态应逐步使用 Kit 控制按钮和状态徽标。

建议动作：

- 保留当前信息结构。
- 只迁移按钮密度、菜单按钮、批量状态，不增加会话类型图标。

验收：

- 会话列表每行不做文件/对话差异化 icon。
- 搜索、批量、菜单按钮与工作台按钮一致。

### P2. 工作台顶部栏接近目标，但仍需检查按钮体系

现状证据：

- 左侧已有 logo + FRIDAY：`src/views/DailyBoardView.ts:419`
- 右侧有项目选择和设置按钮：`src/views/DailyBoardView.ts:431`
- shell icon button 样式独立：`styles.css:1716`
- chat 内部还有 session title、连接状态、agent select、新会话按钮：`src/views/DailyBoardView.ts:1403`

差异：

- Native Kit 目标是工作台顶部栏稳定表达品牌、项目选择和紧凑操作按钮。
- 当前已保留品牌 logo，但顶部栏、chat focus meta、session drawer header 分别定义按钮，尚未完全共用控制按钮组。

建议动作：

- 将 `friday-shell-icon-button`、`friday-ai-meta-button`、session header button 收敛到同一控制按钮元件。
- 保留左侧品牌 logo + FRIDAY，不恢复旧的强图标方案。

验收：

- 工作台顶部、输入区、会话抽屉按钮视觉一致。

### P2. 首次引导步骤可作为 Kit 候选，但不应优先迁移

现状证据：

- onboarding step 由 `friday-onboarding-step` 渲染：`src/views/DailyBoardView.ts:382`
- marker 使用 icon：`src/views/DailyBoardView.ts:383`
- action 使用页面按钮：`src/views/DailyBoardView.ts:388`

差异：

- HTML 画板已把首次引导步骤列为扫描候选，但它不是助手/执行/输入的核心信息系统。

建议动作：

- 等元组件稳定后，再迁移 step marker、状态徽标和 action button。
- 不先从 onboarding 抽 token，避免反向污染核心组件。

### P2. 同步冲突差异应独立定义，但不解除项目状态组暂缓

现状证据：

- 同步页仍大量复用 approval/card 类：`src/views/DailyBoardView.ts:1272`
- 同步冲突记录来自 workbench state：`src/views/DailyBoardView.ts:792`

差异：

- Native Kit 明确同步冲突差异可独立于项目状态组先定义。
- 当前同步冲突和项目状态视觉边界不够清晰，文件行也没有文件类型图标元件。

建议动作：

- 只定义“同步冲突差异”组件，不动项目状态组。
- 文件行使用 `kit-file-type-icon`，双栏差异只用于本地/远端来源对比。

验收：

- 同步冲突不被混入项目状态组迁移。
- 冲突文件行能快速看出类型、来源和动作。

## 可保留项

- 设置页已经有 `SettingsKit.ts`，并通过 `createNativeSettingsGroup`、`renderNativeSectionTabs`、`renderFridaySettingsTitle` 复用原生设置组结构。
- 工作台外壳已保留品牌 logo + FRIDAY，方向正确。
- Task Bar 数据层已经支持展开全部步骤，包括未开始步骤。
- `prefers-reduced-motion` 已在执行过程相关动画中处理，Native Kit 动效可以在 Obsidian DOM/CSS 中落地。
- 会话抽屉没有为每条记录做差异化 icon，符合当前确认方向。

## 暂缓项

### 项目状态组

保持暂缓。当前扫描到的项目页、项目摘要、项目编辑器和项目状态相关 UI 不进入本轮清单的迁移任务。

不要做：

- 不迁移项目状态组。
- 不从项目状态组抽 token。
- 不把同步冲突差异等同于项目状态组。

## 建议迁移顺序

1. 先定视觉基线：圆角、边框、阴影、背景、间距、品牌色使用范围和 FRIDAY 出现规则。
2. 再抽 Native Kit 元组件落地层：状态徽标、文件类型图标、低强调事件行、运行中表面、浮层列表项、控制按钮。
3. 收敛对话输入区：Task Bar 贴合、审批占用态唯一化、Skill/@ 文案与浮层。
4. 收敛助手输出：FRIDAY 文档流、工具调用低强调、任务摘要移交 Task Bar。
5. 收敛执行过程和产物：运行中表面、产物文件类型图标、Diff 文件行。
6. 迁移能力控制中心、会话抽屉、首次引导等外围组件。
7. 单独定义同步冲突差异；继续暂缓项目状态组。

## 回归测试建议

- 视觉截图检查：整体应像 Obsidian 原生插件，而不是独立 Web dashboard。
- 样式测试：普通信息行不应引入大圆角、重阴影或高饱和 accent 背景。
- 静态测试：禁止生产 UI 新增 `Skill /` 展示文案，除非是用户输入中的原始 slash 命令。
- 静态测试：审批阻塞态只允许出现在 composer decision panel。
- 静态测试：产物、Diff、同步冲突文件行必须出现统一 file type icon class。
- 静态测试：Task Bar host 必须在 composer wrap 内，并且在 composer input 前。
- 样式测试：Task Bar 收起态与输入框无明显 gap；运行中表面主文本单行省略。
- 浏览器/Obsidian 手测：明暗主题、缩窄宽度、reduced motion、审批阻塞、Skill 列表、`@` 文件选择、Task Bar 展开收起。
